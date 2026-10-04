import { describe, expect, test } from 'vitest';
import type { ClipInfo } from '../src/review/pose.js';
import {
  aggregateTimelineResources,
  assertTimelineRenderSettings,
  assertTimelineResources,
  createReviewTimelineSchedule,
  REVIEW_TIMELINE_LIMITS,
  reviewTimelineSchema,
  type ReviewTimelineSampleResources,
} from '../src/review/timeline.js';

const clips: ClipInfo[] = [
  { index: 0, name: 'Walk', durationSeconds: 2, channels: 3, interpolation: ['LINEAR'], supported: true },
  { index: 1, name: 'Still', durationSeconds: 0, channels: 1, interpolation: ['STEP'], supported: true },
  { index: 2, name: 'No-op', durationSeconds: 1, channels: 0, interpolation: [], supported: false, ignoredChannels: 1 },
];

function resources(overrides: Partial<ReviewTimelineSampleResources> = {}): ReviewTimelineSampleResources {
  return {
    triangles: 20,
    vertexInstances: 60,
    decodedTexturePixels: 1024,
    rasterSampleChecks: 300,
    uvMetricsTriangles: 20,
    imageBytes: 500,
    ...overrides,
  };
}

const resolvedFraming = {
  policy: 'default-pose' as const,
  center: [0, 1, 2],
  extent: 4,
  referenceBounds: { minimum: [-1, 0, 1], maximum: [1, 2, 3] },
  posedBounds: { minimum: [-1, 0, 1], maximum: [1, 2, 3] },
  clippedViews: [],
};

describe('bounded review animation timeline schedules', () => {
  test('creates inclusive ordered static samples with exact pose times and labels', () => {
    const schedule = createReviewTimelineSchedule(clips, {
      clipIndex: 0, startSeconds: 0.25, endSeconds: 1.25, frameCount: 3,
    });

    expect(schedule.kind).toBe('static-samples');
    expect(schedule.samples.map(({ timeSeconds }) => timeSeconds)).toEqual([0.25, 0.75, 1.25]);
    expect(schedule.samples.map(({ pose }) => pose)).toEqual([
      { clipIndex: 0, timeSeconds: 0.25 },
      { clipIndex: 0, timeSeconds: 0.75 },
      { clipIndex: 0, timeSeconds: 1.25 },
    ]);
    expect(schedule.samples.map(({ label }) => label)).toEqual([
      'Frame 1 of 3 at 0.25 s', 'Frame 2 of 3 at 0.75 s', 'Frame 3 of 3 at 1.25 s',
    ]);
    expect(schedule.samples.map(({ frameIndex, ordinal }) => [frameIndex, ordinal])).toEqual([[0, 1], [1, 2], [2, 3]]);
  });

  test('strict schema rejects malformed ranges, counts and unknown fields', () => {
    const valid = { clipIndex: 0, startSeconds: 0, endSeconds: 1, frameCount: 2 };
    expect(reviewTimelineSchema.parse(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, startSeconds: -1 },
      { ...valid, endSeconds: 86_401 },
      { ...valid, startSeconds: Number.NaN },
      { ...valid, endSeconds: Number.POSITIVE_INFINITY },
      { ...valid, startSeconds: 1, endSeconds: 1 },
      { ...valid, startSeconds: 1, endSeconds: 0 },
      { ...valid, frameCount: 1 },
      { ...valid, frameCount: 17 },
      { ...valid, clipIndex: 0.5 },
      { ...valid, extra: true },
    ]) {
      expect(() => reviewTimelineSchema.parse(invalid)).toThrow();
      expect(() => createReviewTimelineSchedule(clips, invalid)).toThrow();
    }
  });

  test('requires an existing supported active clip and a nonzero in-duration range', () => {
    const request = { clipIndex: 0, startSeconds: 0, endSeconds: 1, frameCount: 2 };
    expect(() => createReviewTimelineSchedule(clips, { ...request, clipIndex: 9 })).toThrow('does not exist');
    expect(() => createReviewTimelineSchedule(clips, { ...request, clipIndex: 1 })).toThrow('zero-duration');
    expect(() => createReviewTimelineSchedule(clips, { ...request, clipIndex: 2 })).toThrow('no supported active channels');
    expect(() => createReviewTimelineSchedule(clips, { ...request, endSeconds: 2.01 })).toThrow('exceeds');
  });

  test('refuses ranges whose intermediate timestamps cannot remain distinct', () => {
    expect(() => createReviewTimelineSchedule(clips, {
      clipIndex: 0, startSeconds: 1, endSeconds: 1 + Number.EPSILON, frameCount: 16,
    })).toThrow('distinct sample timestamps');
  });
});

describe('timeline rendering invariants', () => {
  test('locks all samples to 128px and returns one copied resolved framing', () => {
    const frame = assertTimelineRenderSettings({ resolution: 128, framing: resolvedFraming });
    expect(frame).toEqual({ resolution: 128, framing: { center: [0, 1, 2], extent: 4 } });
    expect(frame.framing.center).not.toBe(resolvedFraming.center);
    expect(() => assertTimelineRenderSettings({ resolution: 256, framing: resolvedFraming })).toThrow('must be 128');
    expect(() => assertTimelineRenderSettings({ resolution: 128 })).toThrow('resolved shared framing');
  });

  test('rejects malformed resolved frame data', () => {
    expect(() => assertTimelineRenderSettings({ resolution: 128, framing: { ...resolvedFraming, center: [0, Number.NaN, 0] } })).toThrow('framing is invalid');
    expect(() => assertTimelineRenderSettings({ resolution: 128, framing: { ...resolvedFraming, extent: 0 } })).toThrow('framing is invalid');
    expect(() => assertTimelineRenderSettings({ resolution: 128, framing: { ...resolvedFraming, referenceBounds: { minimum: [1, 0, 0], maximum: [0, 1, 1] } } })).toThrow('bounds are invalid');
    expect(() => assertTimelineRenderSettings({ resolution: 128, framing: { ...resolvedFraming, clippedViews: [8] } })).toThrow('clipped-view');
  });
});

describe('timeline cumulative resource budgets', () => {
  test('sums all per-sample costs and returns the aggregate when within caps', () => {
    const totals = aggregateTimelineResources([resources(), resources({ triangles: 30, imageBytes: 700 })]);
    expect(totals).toEqual({
      sampleCount: 2,
      triangles: 50,
      vertexInstances: 120,
      decodedTexturePixels: 2048,
      rasterSampleChecks: 600,
      uvMetricsTriangles: 40,
      imageBytes: 1200,
    });
    expect(assertTimelineResources([resources(), resources()])).toEqual(aggregateTimelineResources([resources(), resources()]));
  });

  test('enforces each cumulative budget across samples', () => {
    const fields = [
      'imageBytes', 'rasterSampleChecks', 'uvMetricsTriangles', 'triangles', 'vertexInstances', 'decodedTexturePixels',
    ] as const;
    for (const field of fields) {
      const limit = REVIEW_TIMELINE_LIMITS[field];
      expect(() => assertTimelineResources([resources({ [field]: limit }), resources({ [field]: 1 })])).toThrow(`Timeline ${field} budget exceeded`);
      expect(() => assertTimelineResources([resources({ [field]: Math.floor(limit / 2) }), resources({ [field]: limit - Math.floor(limit / 2) })])).not.toThrow();
    }
  });

  test('rejects too few or too many samples and malformed costs', () => {
    expect(() => aggregateTimelineResources([resources()])).toThrow('requires 2–16 samples');
    expect(() => aggregateTimelineResources(Array.from({ length: 17 }, () => resources()))).toThrow('requires 2–16 samples');
    expect(() => aggregateTimelineResources([resources({ rasterSampleChecks: -1 }), resources()])).toThrow('invalid rasterSampleChecks');
    expect(() => aggregateTimelineResources([resources({ imageBytes: 0.5 }), resources()])).toThrow('invalid imageBytes');
    expect(() => aggregateTimelineResources([resources({ triangles: Number.MAX_SAFE_INTEGER }), resources({ triangles: 1 })])).toThrow('safe integer range');
  });
});
