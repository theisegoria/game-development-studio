/**
 * Measuring how much a scenario differs from ITSELF.
 *
 * A diff threshold is a guess. Real renderers are not bit-deterministic --
 * anti-aliasing sample order, particle RNG, a driver's rasterisation rule,
 * an animated HUD clock -- and a threshold picked to silence that noise also
 * silences real regressions of the same size. The principled replacement is
 * to measure the noise: capture the same scenario N times with no change and
 * record, per pixel, how far it moved. That range is the noise floor, and a
 * later comparison counts a pixel as changed only when it exceeds it.
 *
 * The floor is the per-pixel RANGE across all runs, which equals the maximum
 * pairwise delta and costs O(N * pixels) rather than O(N^2). It is stored as
 * a PNG per attachment identity and a record naming those files; the record
 * is what a comparison consumes, so a stray PNG beside it cannot become
 * anyone's noise floor.
 *
 * A high floor is itself a finding: it names where the renderer is
 * non-deterministic, which is usually a bug report of its own.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RasterImage } from '../inspection/image.js';
import { decodeImage, encodePNG } from '../inspection/image.js';
import { canonicalJson } from '../packages/format.js';
import { invalidInput } from '../util/errors.js';
import { attachmentIdentity, loadCapture, safeFileComponent } from './visual.js';

export const GAME_DEV_VISUAL_STABILITY_SCHEMA = 'game_dev.visual_stability.v1';

export interface AttachmentStability {
  identity: string;
  kind: string;
  width: number;
  height: number;
  /** Fraction of pixels that moved at all between identical runs. */
  unstablePixelRatio: number;
  meanNoise: number;
  maximumNoise: number;
  /** Where the noise floor PNG lives, relative to the record. */
  noiseFloorPath: string;
  /** The single noisiest 8x8 window, so a caller has somewhere to look. */
  noisiestWindow: { x: number; y: number; meanNoise: number };
}

export interface VisualStability {
  schema: typeof GAME_DEV_VISUAL_STABILITY_SCHEMA;
  runIds: string[];
  adapterId: string;
  scenarioId: string;
  attachments: AttachmentStability[];
  /** 1.0 means every pixel of every attachment was identical across all runs. */
  stabilityScore: number;
  verdict: 'bit-deterministic' | 'stable' | 'noisy';
  summary: string[];
  outputPath: string;
  recordPath: string;
  evidence: {
    sealedRunsVerified: true;
    noiseMeasuredAcrossRuns: number;
    codeUnchangedBetweenRunsAssumed: true;
    humanVisualReviewPerformed: false;
  };
  evidenceCeiling: string;
}

function noisiestWindow(noise: RasterImage): { x: number; y: number; meanNoise: number } {
  const size = 8;
  let best = { x: 0, y: 0, meanNoise: -1 };
  for (let y = 0; y + size <= noise.height; y += size) {
    for (let x = 0; x + size <= noise.width; x += size) {
      let total = 0;
      for (let dy = 0; dy < size; dy += 1) {
        for (let dx = 0; dx < size; dx += 1) {
          total += noise.data[((y + dy) * noise.width + (x + dx)) * 4] ?? 0;
        }
      }
      const mean = total / (size * size) / 255;
      if (mean > best.meanNoise) best = { x, y, meanNoise: mean };
    }
  }
  return best.meanNoise < 0 ? { x: 0, y: 0, meanNoise: 0 } : best;
}

export async function measureRunStability(options: {
  runPaths: string[];
  outputPath: string;
}): Promise<VisualStability> {
  if (options.runPaths.length < 2) {
    throw invalidInput('stability needs at least two runs of the same scenario', {
      runs: options.runPaths.length,
    });
  }
  const outputPath = path.resolve(options.outputPath);
  await fs.mkdir(outputPath, { recursive: false, mode: 0o700 }).catch(() => {
    throw invalidInput('stability output directory must not already exist', { outputPath });
  });

  const captures = [];
  for (const runPath of options.runPaths) captures.push(await loadCapture(runPath));
  const [first, ...rest] = captures;
  if (!first) throw invalidInput('no runs');
  for (const other of rest) {
    if (other.adapterId !== first.adapterId || other.scenarioId !== first.scenarioId) {
      throw invalidInput('stability requires runs from the same adapter scenario', {
        expected: `${first.adapterId}/${first.scenarioId}`,
        actual: `${other.adapterId}/${other.scenarioId}`,
      });
    }
  }

  // Identities present in EVERY run, with their file per run.
  const perRun = captures.map((capture) => {
    const files = new Map<string, { kind: string; path: string }>();
    for (const frame of capture.manifest.frames) {
      for (const attachment of frame.attachments) {
        if (attachment.encoding !== 'png') continue;
        files.set(attachmentIdentity(frame, attachment), {
          kind: attachment.kind,
          path: path.resolve(capture.runPath, attachment.path),
        });
      }
    }
    return files;
  });
  const shared = [...(perRun[0]?.keys() ?? [])].filter((identity) => perRun.every((files) => files.has(identity)));
  if (shared.length === 0) throw invalidInput('the runs share no PNG attachment identity');

  const attachments: AttachmentStability[] = [];
  let totalPixels = 0;
  let totalUnstable = 0;

  for (const identity of shared.sort()) {
    const images: RasterImage[] = [];
    for (const files of perRun) images.push(decodeImage(await fs.readFile(files.get(identity)!.path)));
    const reference = images[0]!;
    if (images.some((image) => image.width !== reference.width || image.height !== reference.height)) {
      throw invalidInput('attachment extent differs between runs', { identity });
    }

    const pixels = reference.width * reference.height;
    const noise = new Uint8Array(pixels * 4);
    let unstable = 0;
    let sum = 0;
    let maximum = 0;
    for (let pixel = 0; pixel < pixels; pixel += 1) {
      const offset = pixel * 4;
      let range = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        let low = 255;
        let high = 0;
        for (const image of images) {
          const value = image.data[offset + channel] ?? 0;
          if (value < low) low = value;
          if (value > high) high = value;
        }
        range = Math.max(range, high - low);
      }
      noise[offset] = range;
      noise[offset + 1] = range;
      noise[offset + 2] = range;
      noise[offset + 3] = 255;
      if (range > 0) unstable += 1;
      sum += range;
      if (range > maximum) maximum = range;
    }
    const raster: RasterImage = { width: reference.width, height: reference.height, data: noise };
    const noiseFloorPath = `${safeFileComponent(identity)}.noise.png`;
    await fs.writeFile(path.join(outputPath, noiseFloorPath), encodePNG(raster), { flag: 'wx', mode: 0o600 });

    totalPixels += pixels;
    totalUnstable += unstable;
    attachments.push({
      identity,
      kind: perRun[0]!.get(identity)!.kind,
      width: reference.width,
      height: reference.height,
      unstablePixelRatio: unstable / pixels,
      meanNoise: sum / pixels / 255,
      maximumNoise: maximum / 255,
      noiseFloorPath,
      noisiestWindow: noisiestWindow(raster),
    });
  }

  const stabilityScore = totalPixels > 0 ? 1 - totalUnstable / totalPixels : 1;
  const verdict: VisualStability['verdict'] = totalUnstable === 0
    ? 'bit-deterministic'
    : stabilityScore >= 0.99 ? 'stable' : 'noisy';

  const summary: string[] = [];
  summary.push(
    verdict === 'bit-deterministic'
      ? `Across ${captures.length} runs every pixel of every attachment was identical. A zero ` +
        'threshold is a valid hard gate for this scenario.'
      : `Across ${captures.length} runs ${((1 - stabilityScore) * 100).toFixed(2)}% of pixels moved ` +
        'with no change to the code. That is the noise floor; comparisons that apply it will not ' +
        'report it as a regression.',
  );
  for (const attachment of [...attachments].sort((a, b) => b.unstablePixelRatio - a.unstablePixelRatio).slice(0, 3)) {
    if (attachment.unstablePixelRatio === 0) continue;
    summary.push(
      `${attachment.identity}: ${(attachment.unstablePixelRatio * 100).toFixed(2)}% of pixels unstable, ` +
      `noisiest around (${attachment.noisiestWindow.x}, ${attachment.noisiestWindow.y}). ` +
      'Non-determinism this localized usually has one cause: a clock, a counter, unseeded randomness, ' +
      'or a sort order the driver does not promise.',
    );
  }

  const record: VisualStability = {
    schema: GAME_DEV_VISUAL_STABILITY_SCHEMA,
    runIds: captures.map((capture) => capture.runId),
    adapterId: first.adapterId,
    scenarioId: first.scenarioId,
    attachments,
    stabilityScore,
    verdict,
    summary,
    outputPath,
    recordPath: path.join(outputPath, 'stability.json'),
    evidence: {
      sealedRunsVerified: true,
      noiseMeasuredAcrossRuns: captures.length,
      codeUnchangedBetweenRunsAssumed: true,
      humanVisualReviewPerformed: false,
    },
    evidenceCeiling:
      'The noise floor is the per-pixel range observed across the given runs. It assumes nothing ' +
      'changed between them, which the harness cannot verify; it bounds noise for THESE runs and ' +
      'says nothing about a run captured on other hardware or after a driver update.',
  };
  await fs.writeFile(record.recordPath, canonicalJson(record), { flag: 'wx', mode: 0o600 });
  return record;
}
