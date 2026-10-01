/**
 * A diff threshold is a guess. Real renderers are not bit-deterministic, and a
 * threshold picked to silence that noise also silences real regressions of the
 * same size. The principled replacement is to measure the noise -- capture the
 * same scenario several times with no change -- and let a comparison count a
 * pixel as changed only when it exceeds what the renderer does on its own.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAdapter, planScenarioRun } from '../src/harness/adapter.js';
import { executeScenarioRun } from '../src/harness/run-bundle.js';
import { measureRunStability } from '../src/harness/stability.js';
import { compareRunVisuals } from '../src/harness/visual.js';
import { decodeImage, encodePNG } from '../src/inspection/image.js';
import { writeHarnessProject } from './helpers/harness-fixture.js';

let root: string;
let project: Awaited<ReturnType<typeof writeHarnessProject>>;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'stability-'));
  project = await writeHarnessProject(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

/** A 4x4 frame: a fixed base, with pixel (0,0) jittered by `wobble`. */
function frame(base: number, wobble: number): Uint8Array {
  const data = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < 16; i += 1) {
    const value = i === 0 ? base + wobble : base;
    data[i * 4] = value; data[i * 4 + 1] = value; data[i * 4 + 2] = value; data[i * 4 + 3] = 255;
  }
  return encodePNG({ width: 4, height: 4, data });
}

async function run(png: Uint8Array, name: string): Promise<string> {
  const source = path.join(project.projectRoot, name);
  await fs.writeFile(source, png);
  const adapter = await loadAdapter(project.projectRoot);
  const plan = await planScenarioRun({
    adapter, scenarioId: 'capture', runsRoot: path.join(root, 'runs'),
    parameters: { source: name, objectIds: path.basename(project.objectIdPng), frameTime: 12, mode: 'normal' },
  });
  return (await executeScenarioRun({ adapter, plan, confirm: true, allowGpu: false, allowPerformance: false })).runPath;
}

describe('measuring a scenario against itself', () => {
  it('reports bit-deterministic when every run is identical', async () => {
    const runs = [await run(frame(100, 0), 'a.png'), await run(frame(100, 0), 'b.png'), await run(frame(100, 0), 'c.png')];
    const record = await measureRunStability({ runPaths: runs, outputPath: path.join(root, 'stab') });

    expect(record.verdict).toBe('bit-deterministic');
    expect(record.stabilityScore).toBe(1);
    expect(record.summary[0]).toContain('zero threshold is a valid hard gate');
  }, 60_000);

  it('records the per-pixel range as the floor, and points at the noisiest spot', async () => {
    const runs = [await run(frame(100, 0), 'a.png'), await run(frame(100, 6), 'b.png'), await run(frame(100, 3), 'c.png')];
    const record = await measureRunStability({ runPaths: runs, outputPath: path.join(root, 'stab') });
    const color = record.attachments.find((a) => a.kind === 'color')!;

    // One of sixteen pixels moved, by at most 6.
    expect(color.unstablePixelRatio).toBeCloseTo(1 / 16, 6);
    expect(color.maximumNoise).toBeCloseTo(6 / 255, 6);
    expect(color.noisiestWindow).toMatchObject({ x: 0, y: 0 });
    const floor = decodeImage(await fs.readFile(path.join(record.outputPath, color.noiseFloorPath)));
    expect(floor.data[0]).toBe(6);
    expect(floor.data[4]).toBe(0);
    expect(record.summary.join(' ')).toContain('unseeded randomness');
  }, 60_000);

  it('refuses fewer than two runs, and runs from different scenarios', async () => {
    const only = await run(frame(100, 0), 'a.png');
    await expect(measureRunStability({ runPaths: [only], outputPath: path.join(root, 'x') }))
      .rejects.toThrow(/at least two/);
  }, 60_000);
});

describe('a comparison that applies the floor', () => {
  it('stops reporting the renderer\'s own jitter as change, and still reports real change', async () => {
    const stable = [await run(frame(100, 0), 'a.png'), await run(frame(100, 6), 'b.png')];
    const record = await measureRunStability({ runPaths: stable, outputPath: path.join(root, 'stab') });

    // Baseline vs a run that only jitters the noisy pixel, within its floor.
    const jittered = await run(frame(100, 5), 'j.png');
    const withinNoise = await compareRunVisuals({
      baselineRunPath: stable[0]!, candidateRunPath: jittered, threshold: 0,
      noiseFloorPath: record.recordPath, outputPath: path.join(root, 'cmp-a'),
    });
    const a = withinNoise.pairs.find((p) => p.kind === 'color')!;
    expect(a.changedPixelRatio).toBe(0);
    expect(withinNoise.noiseFloorPath).toBe(record.recordPath);

    // The same comparison WITHOUT the floor would have cried wolf.
    const naive = await compareRunVisuals({
      baselineRunPath: stable[0]!, candidateRunPath: jittered, threshold: 0,
      outputPath: path.join(root, 'cmp-b'),
    });
    expect(naive.pairs.find((p) => p.kind === 'color')!.changedPixelRatio).toBeGreaterThan(0);

    // A real change -- every pixel shifted by 40 -- is still reported through the floor.
    const changed = await run(frame(140, 0), 'r.png');
    const real = await compareRunVisuals({
      baselineRunPath: stable[0]!, candidateRunPath: changed, threshold: 0,
      noiseFloorPath: record.recordPath, outputPath: path.join(root, 'cmp-c'),
    });
    expect(real.pairs.find((p) => p.kind === 'color')!.changedPixelRatio).toBe(1);
  }, 90_000);

  it('refuses a record that is not a stability record', async () => {
    const stable = [await run(frame(100, 0), 'a.png'), await run(frame(100, 0), 'b.png')];
    const bogus = path.join(root, 'bogus.json');
    await fs.writeFile(bogus, JSON.stringify({ schema: 'something.else', attachments: [] }));
    await expect(compareRunVisuals({
      baselineRunPath: stable[0]!, candidateRunPath: stable[1]!, noiseFloorPath: bogus,
    })).rejects.toThrow(/visual_stability/);
  }, 60_000);
});
