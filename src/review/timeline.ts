import { z } from 'zod';
import type { ClipInfo } from './pose.js';

/** Timeline review is a bounded set of still samples, not real-time playback. */
export const REVIEW_TIMELINE_LIMITS = {
  minFrameCount: 2,
  maxFrameCount: 16,
  resolution: 128,
  imageBytes: 12_000_000,
  rasterSampleChecks: 48_000_000,
  uvMetricsTriangles: 8_000_000,
  triangles: 500_000,
  vertexInstances: 1_500_000,
  decodedTexturePixels: 32_000_000,
} as const;

export const reviewTimelineSchema = z.object({
  clipIndex: z.number().int().min(0),
  startSeconds: z.number().finite().min(0).max(86_400),
  endSeconds: z.number().finite().min(0).max(86_400),
  frameCount: z.number().int().min(REVIEW_TIMELINE_LIMITS.minFrameCount).max(REVIEW_TIMELINE_LIMITS.maxFrameCount),
}).strict().superRefine((request, context) => {
  if (request.endSeconds <= request.startSeconds) {
    context.addIssue({ code: 'custom', path: ['endSeconds'], message: 'endSeconds must be greater than startSeconds' });
  }
});

export type ReviewTimelineRequest = z.infer<typeof reviewTimelineSchema>;

export interface ReviewTimelineSample {
  /** Zero-based frame position in the schedule. */
  frameIndex: number;
  /** Human-facing ordinal. */
  ordinal: number;
  label: string;
  timeSeconds: number;
  pose: { clipIndex: number; timeSeconds: number };
}

export interface ReviewTimelineSchedule {
  kind: 'static-samples';
  clipIndex: number;
  startSeconds: number;
  endSeconds: number;
  frameCount: number;
  samples: ReviewTimelineSample[];
}

/**
 * Create inclusive, evenly spaced static samples for one validated animation clip.
 * The returned frame times are also the exact values passed to pose evaluation.
 */
export function createReviewTimelineSchedule(clips: readonly ClipInfo[], input: unknown): ReviewTimelineSchedule {
  const request = reviewTimelineSchema.parse(input);
  const clip = clips[request.clipIndex];
  if (!clip) throw new Error('Selected animation clip does not exist');
  if (clip.index !== request.clipIndex) throw new Error('Selected animation clip metadata does not match its index');
  if (!clip.supported || !Number.isSafeInteger(clip.channels) || clip.channels < 1) {
    throw new Error('Selected animation clip has no supported active channels');
  }
  if (!Number.isFinite(clip.durationSeconds) || clip.durationSeconds < 0) {
    throw new Error('Selected animation clip has an invalid duration');
  }
  if (clip.durationSeconds === 0) throw new Error('Cannot sample a zero-duration animation clip');
  if (request.endSeconds > clip.durationSeconds) throw new Error('Timeline range exceeds selected animation clip duration');

  const span = request.endSeconds - request.startSeconds;
  const lastIndex = request.frameCount - 1;
  const times = Array.from({ length: request.frameCount }, (_, index) => {
    if (index === 0) return request.startSeconds;
    if (index === lastIndex) return request.endSeconds;
    return request.startSeconds + span * (index / lastIndex);
  });
  for (let index = 1; index < times.length; index += 1) {
    if (!(times[index]! > times[index - 1]!)) {
      throw new Error('Timeline range is too small to represent distinct sample timestamps');
    }
  }

  const samples = times.map((timeSeconds, frameIndex) => {
    const ordinal = frameIndex + 1;
    return {
      frameIndex,
      ordinal,
      label: `Frame ${ordinal} of ${request.frameCount} at ${timeSeconds} s`,
      timeSeconds,
      pose: { clipIndex: request.clipIndex, timeSeconds },
    };
  });
  return {
    kind: 'static-samples',
    clipIndex: request.clipIndex,
    startSeconds: request.startSeconds,
    endSeconds: request.endSeconds,
    frameCount: request.frameCount,
    samples,
  };
}

export interface ReviewTimelineFraming {
  policy: 'default-pose' | 'manual';
  center: readonly number[];
  extent: number;
  referenceBounds: { minimum: readonly number[]; maximum: readonly number[] };
  posedBounds: { minimum: readonly number[]; maximum: readonly number[] };
  clippedViews: readonly number[];
}

export interface ReviewTimelineRenderFrame {
  resolution: typeof REVIEW_TIMELINE_LIMITS.resolution;
  /** The common center/extent copied from the initial resolved preview frame. */
  framing: { center: [number, number, number]; extent: number };
}

function validVector3(value: unknown, absoluteLimit: number): value is [number, number, number] {
  return Array.isArray(value) && value.length === 3 && value.every((component) =>
    typeof component === 'number' && Number.isFinite(component) && Math.abs(component) <= absoluteLimit,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validBounds(bounds: unknown): boolean {
  if (!isRecord(bounds)) return false;
  const minimum = bounds.minimum, maximum = bounds.maximum;
  if (!validVector3(minimum, 1e12) || !validVector3(maximum, 1e12)) return false;
  return minimum.every((value, axis) => value <= maximum[axis]!);
}

/**
 * Validate one initial preview's resolved framing and lock timeline samples to
 * the renderer's maximum timeline resolution. Call once, then reuse the returned
 * framing for every sample.
 */
export function assertTimelineRenderSettings(settings: unknown): ReviewTimelineRenderFrame {
  if (!isRecord(settings) || settings.resolution !== REVIEW_TIMELINE_LIMITS.resolution) {
    throw new Error(`Timeline review resolution must be ${REVIEW_TIMELINE_LIMITS.resolution}`);
  }
  const framing = settings.framing;
  if (!isRecord(framing) || (framing.policy !== 'default-pose' && framing.policy !== 'manual')) {
    throw new Error('Timeline samples require one resolved shared framing from the initial preview');
  }
  if (!validVector3(framing.center, 1e12) || typeof framing.extent !== 'number' || !Number.isFinite(framing.extent) || framing.extent <= 0 || framing.extent > 2e12) {
    throw new Error('Timeline shared framing is invalid');
  }
  if (!validBounds(framing.referenceBounds) || !validBounds(framing.posedBounds)) {
    throw new Error('Timeline shared framing bounds are invalid');
  }
  if (!Array.isArray(framing.clippedViews) || framing.clippedViews.some((view: unknown) =>
    typeof view !== 'number' || !Number.isInteger(view) || view < 0 || view > 7,
  )) {
    throw new Error('Timeline shared framing clipped-view metadata is invalid');
  }
  return {
    resolution: REVIEW_TIMELINE_LIMITS.resolution,
    framing: { center: [...framing.center] as [number, number, number], extent: framing.extent },
  };
}

/** Minimal structural costs read from a preview envelope plus the final encoded still. */
export interface ReviewTimelineSampleResources {
  triangles: number;
  vertexInstances: number;
  decodedTexturePixels: number;
  rasterSampleChecks: number;
  uvMetricsTriangles: number;
  imageBytes: number;
}

export interface ReviewTimelineResources extends ReviewTimelineSampleResources {
  sampleCount: number;
}

const RESOURCE_FIELDS = [
  'triangles',
  'vertexInstances',
  'decodedTexturePixels',
  'rasterSampleChecks',
  'uvMetricsTriangles',
  'imageBytes',
] as const satisfies readonly (keyof ReviewTimelineSampleResources)[];

/** Sum per-sample resource measurements after checking their numeric shape. */
export function aggregateTimelineResources(samples: readonly ReviewTimelineSampleResources[]): ReviewTimelineResources {
  if (samples.length < REVIEW_TIMELINE_LIMITS.minFrameCount || samples.length > REVIEW_TIMELINE_LIMITS.maxFrameCount) {
    throw new Error(`Timeline resource aggregation requires ${REVIEW_TIMELINE_LIMITS.minFrameCount}–${REVIEW_TIMELINE_LIMITS.maxFrameCount} samples`);
  }
  const totals: ReviewTimelineSampleResources = {
    triangles: 0,
    vertexInstances: 0,
    decodedTexturePixels: 0,
    rasterSampleChecks: 0,
    uvMetricsTriangles: 0,
    imageBytes: 0,
  };
  for (const [index, sample] of samples.entries()) {
    for (const field of RESOURCE_FIELDS) {
      const value: unknown = sample[field];
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`Timeline sample ${index + 1} has invalid ${field}`);
      }
      const sum = totals[field] + value;
      if (!Number.isSafeInteger(sum)) throw new Error(`Timeline aggregate ${field} exceeds safe integer range`);
      totals[field] = sum;
    }
  }
  return { sampleCount: samples.length, ...totals };
}

/** Sum and enforce cumulative budgets over the full static sample sequence. */
export function assertTimelineResources(samples: readonly ReviewTimelineSampleResources[]): ReviewTimelineResources {
  const totals = aggregateTimelineResources(samples);
  for (const field of RESOURCE_FIELDS) {
    const limit = REVIEW_TIMELINE_LIMITS[field];
    if (totals[field] > limit) throw new Error(`Timeline ${field} budget exceeded (${totals[field]} > ${limit})`);
  }
  return totals;
}
