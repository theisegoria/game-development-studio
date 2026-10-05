/**
 * Bugs a single frame cannot show.
 *
 * Every other visual tool compares one frame with another frame of a
 * different run. A whole class of rendering defects lives instead in the
 * sequence WITHIN one run, and looks fine in any still:
 *
 *   - Flicker. Z-fighting, shimmering specular, an unstable TAA history or a
 *     shadow cascade swapping: a pixel brightens, darkens, brightens again.
 *     It is detected as reversals of luminance DIRECTION, not as change, so a
 *     slow fade or a moving camera does not register and an oscillation does.
 *   - Popping. An object id present in one frame and absent in the next, or
 *     its coverage jumping by more than half between adjacent frames: LOD
 *     transitions without a blend, culling errors, streaming hitches.
 *   - Frame pacing. Steady 16.6ms frames and frames alternating 8ms/25ms have
 *     the same mean; the second feels like stutter. Reported from the raw
 *     per-frame samples, so it says what the mean hides.
 *
 * The analysis reads only sealed, verified runs and writes only into a new
 * output directory. It never decides intent: a flickering pixel may be a
 * deliberate blinking light, which is why findings are attributed to object
 * ids rather than declared bugs.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RasterImage } from '../inspection/image.js';
import { decodeImage, encodePNG } from '../inspection/image.js';
import { invalidInput } from '../util/errors.js';
import { summarizeRunPerformance } from './performance.js';
import { luminancePlane } from './ssim.js';
import { formatObjectId, loadCapture, objectIdAt } from './visual.js';

export const GAME_DEV_FRAME_SEQUENCE_SCHEMA = 'game_dev.frame_sequence.v1' as const;

/** Enough for minutes of sampled capture; beyond this the caller should sample. */
const MAX_FRAMES = 512;
/** Luminance steps (0..255) smaller than this are not a direction at all. */
const DEFAULT_THRESHOLD = 2;
/** Up, down, up: two reversals is the smallest oscillation. */
const DEFAULT_MIN_REVERSALS = 2;
const MAX_POP_EVENTS = 64;

export interface FlickerFinding {
  /** Pixels whose luminance reversed direction at least minReversals times. */
  pixels: number;
  pixelRatio: number;
  threshold: number;
  minReversals: number;
  /** Flickering pixels by the object the id buffer said was there when it last reversed. */
  objects: Array<{ objectId: string; pixels: number; ratioOfObject: number }>;
  /** The 8x8 window with the most reversals, so a caller has somewhere to look. */
  worstWindow?: { x: number; y: number; reversals: number };
  heatmapPath?: string;
}

export interface PopEvent {
  fromFrame: number;
  toFrame: number;
  objectId: string;
  change: 'appeared' | 'disappeared' | 'coverage-jump';
  pixelsBefore: number;
  pixelsAfter: number;
}

export interface PacingFinding {
  metric: string;
  unit: string;
  frames: number;
  median: number;
  /** Mean absolute difference between consecutive frames: zero for perfectly even pacing. */
  meanFrameToFrameDelta: number;
  /**
   * Fraction of consecutive deltas that reverse sign while exceeding a quarter
   * of the median: the signature of alternating short/long frames.
   */
  alternationRatio: number;
  /** Frames longer than 1.5x the median, and the longest unbroken run of them. */
  slowFrames: number;
  longestSlowRun: number;
}

export interface FrameSequenceAnalysis {
  schema: typeof GAME_DEV_FRAME_SEQUENCE_SCHEMA;
  runId: string;
  adapterId: string;
  scenarioId: string;
  attachment: { kind: string; label?: string };
  frames: number[];
  width: number;
  height: number;
  objectIdsAvailable: boolean;
  flicker?: FlickerFinding;
  popping: PopEvent[];
  poppingTruncated: boolean;
  pacing?: PacingFinding;
  verdict: 'steady' | 'temporal-artifacts' | 'insufficient-frames';
  summary: string[];
  evidence: {
    sealedRunVerified: true;
    rasterBytesDecoded: boolean;
    intentInferred: false;
    humanVisualReviewPerformed: false;
  };
  evidenceCeiling: string;
}

interface SequenceFrame {
  index: number;
  image: RasterImage;
  ids?: RasterImage;
}

function percent(ratio: number): string {
  if (ratio === 0) return '0%';
  if (ratio < 0.0001) return '<0.01%';
  return `${(ratio * 100).toFixed(ratio < 0.01 ? 2 : 1)}%`;
}

function analyzeFlicker(
  frames: SequenceFrame[],
  threshold: number,
  minReversals: number,
): { finding: FlickerFinding; reversals: Uint16Array; width: number } {
  const first = frames[0]!.image;
  const pixels = first.width * first.height;
  const reversals = new Uint16Array(pixels);
  const lastSign = new Int8Array(pixels);
  const lastId = new Int32Array(pixels).fill(-1);
  let previous = luminancePlane(first);

  for (let index = 1; index < frames.length; index += 1) {
    const frame = frames[index]!;
    const current = luminancePlane(frame.image);
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const delta = (current[pixel] ?? 0) - (previous[pixel] ?? 0);
      if (Math.abs(delta) <= threshold) continue;
      const sign = delta > 0 ? 1 : -1;
      if (lastSign[pixel] !== 0 && lastSign[pixel] !== sign) {
        reversals[pixel] = Math.min(65_535, (reversals[pixel] ?? 0) + 1);
        if (frame.ids) lastId[pixel] = objectIdAt(frame.ids, pixel * 4);
      }
      lastSign[pixel] = sign;
    }
    previous = current;
  }

  let flickering = 0;
  const byObject = new Map<number, number>();
  for (let pixel = 0; pixel < pixels; pixel += 1) {
    if ((reversals[pixel] ?? 0) < minReversals) continue;
    flickering += 1;
    const id = lastId[pixel] ?? -1;
    if (id >= 0) byObject.set(id, (byObject.get(id) ?? 0) + 1);
  }

  // Object sizes from the first id buffer, so "ratio of object" is meaningful.
  const objectSize = new Map<number, number>();
  const firstIds = frames.find((frame) => frame.ids)?.ids;
  if (firstIds) {
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const id = objectIdAt(firstIds, pixel * 4);
      objectSize.set(id, (objectSize.get(id) ?? 0) + 1);
    }
  }

  let worstWindow: FlickerFinding['worstWindow'];
  const size = 8;
  for (let y = 0; y + size <= first.height; y += size) {
    for (let x = 0; x + size <= first.width; x += size) {
      let total = 0;
      for (let dy = 0; dy < size; dy += 1) {
        for (let dx = 0; dx < size; dx += 1) total += reversals[(y + dy) * first.width + x + dx] ?? 0;
      }
      if (total > 0 && (!worstWindow || total > worstWindow.reversals)) worstWindow = { x, y, reversals: total };
    }
  }

  const finding: FlickerFinding = {
    pixels: flickering,
    pixelRatio: flickering / pixels,
    threshold,
    minReversals,
    objects: [...byObject.entries()]
      .map(([id, count]) => ({
        objectId: formatObjectId(id),
        pixels: count,
        ratioOfObject: count / Math.max(1, objectSize.get(id) ?? count),
      }))
      .sort((left, right) => right.pixels - left.pixels),
    ...(worstWindow ? { worstWindow } : {}),
  };
  return { finding, reversals, width: first.width };
}

function coverage(ids: RasterImage): Map<number, number> {
  const counts = new Map<number, number>();
  for (let offset = 0; offset < ids.data.length; offset += 4) {
    const id = objectIdAt(ids, offset);
    if (id === 0) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

function analyzePopping(frames: SequenceFrame[]): { events: PopEvent[]; truncated: boolean } {
  const events: PopEvent[] = [];
  let truncated = false;
  let previous: { index: number; counts: Map<number, number> } | undefined;
  for (const frame of frames) {
    if (!frame.ids) continue;
    const counts = coverage(frame.ids);
    if (previous) {
      const ids = new Set([...previous.counts.keys(), ...counts.keys()]);
      for (const id of [...ids].sort((left, right) => left - right)) {
        const before = previous.counts.get(id) ?? 0;
        const after = counts.get(id) ?? 0;
        let change: PopEvent['change'] | undefined;
        if (before === 0 && after > 0) change = 'appeared';
        else if (before > 0 && after === 0) change = 'disappeared';
        // Small objects jitter by whole pixels; only judge coverage jumps on
        // objects big enough for half their area to mean something.
        else if (Math.max(before, after) >= 16 && Math.abs(after - before) > 0.5 * Math.max(before, after)) change = 'coverage-jump';
        if (!change) continue;
        if (events.length >= MAX_POP_EVENTS) { truncated = true; continue; }
        events.push({
          fromFrame: previous.index, toFrame: frame.index, objectId: formatObjectId(id), change,
          pixelsBefore: before, pixelsAfter: after,
        });
      }
    }
    previous = { index: frame.index, counts };
  }
  return { events, truncated };
}

async function analyzePacing(runPath: string, metric: string): Promise<PacingFinding | undefined> {
  const summary = await summarizeRunPerformance(runPath);
  const byFrame = new Map<number, { value: number; unit: string }>();
  for (const measurement of summary.measurements) {
    if (measurement.metric !== metric || measurement.aggregation !== 'sample' || measurement.frameIndex === undefined) continue;
    // First source wins: the summary already names metrics reported twice.
    if (!byFrame.has(measurement.frameIndex)) byFrame.set(measurement.frameIndex, { value: measurement.value, unit: measurement.unit });
  }
  const ordered = [...byFrame.entries()].sort(([left], [right]) => left - right).map(([, sample]) => sample);
  if (ordered.length < 4) return undefined;
  const values = ordered.map((sample) => sample.value);
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle]! : ((sorted[middle - 1]! + sorted[middle]!) / 2);
  const deltas = values.slice(1).map((value, index) => value - values[index]!);
  const meanFrameToFrameDelta = deltas.reduce((sum, delta) => sum + Math.abs(delta), 0) / deltas.length;
  let alternations = 0;
  for (let index = 1; index < deltas.length; index += 1) {
    const before = deltas[index - 1]!;
    const after = deltas[index]!;
    if (Math.sign(before) !== Math.sign(after) && Math.abs(before) > median * 0.25 && Math.abs(after) > median * 0.25) alternations += 1;
  }
  let slowFrames = 0;
  let longestSlowRun = 0;
  let run = 0;
  for (const value of values) {
    if (median > 0 && value > median * 1.5) {
      slowFrames += 1;
      run += 1;
      longestSlowRun = Math.max(longestSlowRun, run);
    } else {
      run = 0;
    }
  }
  return {
    metric,
    unit: ordered[0]!.unit,
    frames: values.length,
    median,
    meanFrameToFrameDelta,
    alternationRatio: deltas.length > 1 ? alternations / (deltas.length - 1) : 0,
    slowFrames,
    longestSlowRun,
  };
}

function describe(analysis: Omit<FrameSequenceAnalysis, 'summary' | 'verdict'>): {
  verdict: FrameSequenceAnalysis['verdict'];
  summary: string[];
} {
  const summary: string[] = [];
  if (analysis.frames.length < 2) {
    return {
      verdict: 'insufficient-frames',
      summary: [`Only ${analysis.frames.length} ${analysis.attachment.kind} frame in this run; temporal analysis needs at least two, and flicker needs three.`],
    };
  }
  let artifacts = false;
  const flicker = analysis.flicker;
  if (flicker && flicker.pixels > 0) {
    artifacts = true;
    const where = flicker.worstWindow ? `, worst around (${flicker.worstWindow.x}, ${flicker.worstWindow.y})` : '';
    summary.push(
      `${percent(flicker.pixelRatio)} of pixels flickered: their brightness reversed direction at least ` +
      `${flicker.minReversals} times across ${analysis.frames.length} frames${where}. This is consistent with ` +
      'z-fighting, an unstable temporal filter or shimmering specular, or with a light that is meant to blink.',
    );
    for (const object of flicker.objects.slice(0, 3)) {
      summary.push(`  Object ${object.objectId}: ${object.pixels} flickering pixels, ${percent(object.ratioOfObject)} of its area.`);
    }
  } else if (flicker) {
    summary.push(`No pixel reversed brightness direction ${flicker.minReversals} or more times across ${analysis.frames.length} frames.`);
  }
  if (analysis.popping.length > 0) {
    artifacts = true;
    const shown = analysis.popping.slice(0, 3).map((event) => (
      `${event.objectId} ${event.change === 'coverage-jump' ? `jumped from ${event.pixelsBefore} to ${event.pixelsAfter} pixels` : event.change} between frames ${event.fromFrame} and ${event.toFrame}`
    ));
    summary.push(
      `${analysis.popping.length}${analysis.poppingTruncated ? '+' : ''} popping event${analysis.popping.length === 1 ? '' : 's'}: ${shown.join('; ')}. ` +
      'Objects appearing, vanishing or halving in one frame are consistent with LOD switches without a blend, culling errors or streaming.',
    );
  } else if (analysis.objectIdsAvailable) {
    summary.push('No object appeared, disappeared or jumped in coverage between adjacent frames.');
  } else {
    summary.push('No object-id attachment, so popping could not be checked. Attach one to attribute temporal changes to objects.');
  }
  const pacing = analysis.pacing;
  if (pacing) {
    const uneven = pacing.alternationRatio >= 0.3 || pacing.longestSlowRun >= 3;
    if (uneven) artifacts = true;
    summary.push(
      `${pacing.metric}: median ${pacing.median.toFixed(2)}${pacing.unit} over ${pacing.frames} frames, consecutive frames differ by ` +
      `${pacing.meanFrameToFrameDelta.toFixed(2)}${pacing.unit} on average` +
      (pacing.alternationRatio >= 0.3 ? `, and ${percent(pacing.alternationRatio)} of steps alternate short/long. That cadence reads as stutter even when the mean looks fine.` : '.') +
      (pacing.longestSlowRun >= 3 ? ` ${pacing.longestSlowRun} consecutive frames ran over 1.5x the median.` : ''),
    );
  }
  return { verdict: artifacts ? 'temporal-artifacts' : 'steady', summary };
}

export async function analyzeFrameSequence(options: {
  runPath: string;
  kind?: string;
  label?: string;
  threshold?: number;
  minReversals?: number;
  pacingMetric?: string;
  outputPath?: string;
}): Promise<FrameSequenceAnalysis> {
  const kind = options.kind ?? 'color';
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const minReversals = options.minReversals ?? DEFAULT_MIN_REVERSALS;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 255) throw invalidInput('threshold must be from 0 through 255');
  if (!Number.isInteger(minReversals) || minReversals < 1 || minReversals > 64) throw invalidInput('minReversals must be an integer from 1 through 64');

  const capture = await loadCapture(options.runPath);
  const ordered = [...capture.manifest.frames].sort((left, right) => left.index - right.index);
  if (ordered.length > MAX_FRAMES) throw invalidInput('run has more frames than temporal analysis reads', { frames: ordered.length, maximum: MAX_FRAMES });

  const frames: SequenceFrame[] = [];
  for (const frame of ordered) {
    const attachment = frame.attachments.find((candidate) => (
      candidate.kind === kind && candidate.encoding === 'png' && (options.label === undefined || candidate.label === options.label)
    ));
    if (!attachment) continue;
    const image = decodeImage(await fs.readFile(path.resolve(capture.runPath, attachment.path)));
    const idAttachment = frame.attachments.find((candidate) => candidate.kind === 'object_id' && candidate.encoding === 'png');
    const ids = idAttachment ? decodeImage(await fs.readFile(path.resolve(capture.runPath, idAttachment.path))) : undefined;
    const reference = frames[0]?.image;
    if (reference && (image.width !== reference.width || image.height !== reference.height)) {
      throw invalidInput('frame extent changes within the run; temporal analysis needs one resolution', { frame: frame.index });
    }
    frames.push({
      index: frame.index,
      image,
      ...(ids && ids.width === image.width && ids.height === image.height ? { ids } : {}),
    });
  }

  const first = frames[0]?.image;
  let flicker: FlickerFinding | undefined;
  if (frames.length >= 3) {
    const analysed = analyzeFlicker(frames, threshold, minReversals);
    flicker = analysed.finding;
    if (options.outputPath && flicker.pixels > 0 && first) {
      const outputPath = path.resolve(options.outputPath);
      await fs.mkdir(outputPath, { recursive: false, mode: 0o700 }).catch(() => {
        throw invalidInput('temporal output directory must not already exist', { outputPath });
      });
      let peak = 1;
      for (const count of analysed.reversals) peak = Math.max(peak, count);
      const data = new Uint8Array(first.width * first.height * 4);
      for (let pixel = 0; pixel < analysed.reversals.length; pixel += 1) {
        const intensity = Math.round(((analysed.reversals[pixel] ?? 0) / peak) * 255);
        data[pixel * 4] = intensity;
        data[pixel * 4 + 1] = Math.round(intensity * 0.25);
        data[pixel * 4 + 2] = 0;
        data[pixel * 4 + 3] = 255;
      }
      const heatmapPath = path.join(outputPath, `${kind}.flicker.png`);
      await fs.writeFile(heatmapPath, encodePNG({ width: first.width, height: first.height, data }), { flag: 'wx', mode: 0o600 });
      flicker.heatmapPath = heatmapPath;
    }
  }
  const popping = analyzePopping(frames);
  const pacing = await analyzePacing(capture.runPath, options.pacingMetric ?? 'performance.frame_time');

  const partial = {
    schema: GAME_DEV_FRAME_SEQUENCE_SCHEMA,
    runId: capture.runId,
    adapterId: capture.adapterId,
    scenarioId: capture.scenarioId,
    attachment: { kind, ...(options.label !== undefined ? { label: options.label } : {}) },
    frames: frames.map((frame) => frame.index),
    width: first?.width ?? 0,
    height: first?.height ?? 0,
    objectIdsAvailable: frames.some((frame) => frame.ids),
    ...(flicker ? { flicker } : {}),
    popping: popping.events,
    poppingTruncated: popping.truncated,
    ...(pacing ? { pacing } : {}),
    evidence: {
      sealedRunVerified: true as const,
      rasterBytesDecoded: frames.length > 0,
      intentInferred: false as const,
      humanVisualReviewPerformed: false as const,
    },
    evidenceCeiling:
      'Flicker, popping and pacing are measured from the frames and samples this run sealed. They say a ' +
      'pixel oscillated or an object vanished between captured frames, not why, and not whether it was ' +
      'intended; frames the engine did not capture are not observed.',
  };
  return { ...partial, ...describe(partial) };
}
