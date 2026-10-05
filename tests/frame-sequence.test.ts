/**
 * Temporal analysis is tested against a run whose defects are planted and
 * known exactly: one object's pixels oscillate in brightness every frame,
 * one object appears halfway through, one stays perfectly still, and the
 * frame times alternate short/long. Each finding must be attributed to the
 * right object -- and the still object must not be accused of anything.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAdapter, planScenarioRun } from '../src/harness/adapter.js';
import { GAME_DEV_ADAPTER_SCHEMA } from '../src/harness/contracts.js';
import { executeScenarioRun } from '../src/harness/run-bundle.js';
import { analyzeFrameSequence } from '../src/harness/temporal.js';
import { decodeImage, encodePNG } from '../src/inspection/image.js';
import { canonicalJson } from '../src/packages/format.js';

const WIDTH = 16;
const HEIGHT = 8;

let root: string;
let project: string;

/**
 * Object 1: columns 0-3, brightness alternating 100/160 (flicker).
 * Object 2: columns 4-11, constant (steady).
 * Object 3: columns 12-15, present only from frame 3 (pops in).
 */
function frame(index: number, flicker: boolean): { color: Uint8Array; ids: Uint8Array } {
  const color = new Uint8Array(WIDTH * HEIGHT * 4);
  const ids = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const offset = (y * WIDTH + x) * 4;
      let value = 60;
      let id = 0;
      if (x < 4) { id = 1; value = flicker && index % 2 === 1 ? 160 : 100; }
      else if (x < 12) { id = 2; value = 80; }
      else if (index >= 3) { id = 3; value = 200; }
      color.set([value, value, value, 255], offset);
      ids.set([0, 0, id, 255], offset);
    }
  }
  return { color: encodePNG({ width: WIDTH, height: HEIGHT, data: color }), ids: encodePNG({ width: WIDTH, height: HEIGHT, data: ids }) };
}

async function writeProject(flicker: boolean, frameTimes: number[]): Promise<void> {
  project = path.join(root, `game-${flicker ? 'flicker' : 'steady'}`);
  await fs.mkdir(path.join(project, '.game-dev'), { recursive: true });
  await fs.mkdir(path.join(project, 'frames'));
  for (let index = 0; index < frameTimes.length; index += 1) {
    const { color, ids } = frame(index, flicker);
    await fs.writeFile(path.join(project, 'frames', `${index}.color.png`), color);
    await fs.writeFile(path.join(project, 'frames', `${index}.ids.png`), ids);
  }
  // The "engine": copies the pre-rendered frames into the run and writes the
  // manifest and per-frame telemetry, exactly as a probe-instrumented engine would.
  await fs.writeFile(path.join(project, 'engine.mjs'), `#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
const times = ${JSON.stringify(frameTimes)};
const runDir = process.env.GAME_DEV_RUN_DIR;
const runId = process.env.GAME_DEV_RUN_ID;
const frames = [];
const telemetry = [];
await fs.mkdir(path.join(runDir, 'frames'));
for (let index = 0; index < times.length; index += 1) {
  for (const kind of ['color', 'ids']) {
    await fs.copyFile(path.join('frames', index + '.' + kind + '.png'), path.join(runDir, 'frames', index + '.' + kind + '.png'));
  }
  frames.push({ index, label: 'main', attachments: [
    { kind: 'color', path: 'frames/' + index + '.color.png', encoding: 'png' },
    { kind: 'object_id', path: 'frames/' + index + '.ids.png', encoding: 'png' },
  ] });
  telemetry.push(JSON.stringify({ schema: 'game_dev.telemetry_event.v1', runId, sequence: index, timestampNs: String(index + 1),
    category: 'performance', name: 'frame_time', frameIndex: index, value: times[index], unit: 'ms', attributes: {} }));
}
await fs.writeFile(path.join(runDir, 'telemetry.jsonl'), telemetry.join('\\n') + '\\n');
await fs.writeFile(path.join(runDir, 'capture.json'), JSON.stringify({
  schema: 'game_dev.capture.v1', runId, adapterId: process.env.GAME_DEV_ADAPTER_ID, scenarioId: process.env.GAME_DEV_SCENARIO_ID,
  sourceFormat: 'game-dev-capture-v1', frames, telemetry: ['telemetry.jsonl'], profiles: [], measurements: [],
  adapterEvidence: { windowless: true, graphicsApi: 'fixture', gpuExecutionReported: false, gpuCompletionIdentityReported: false,
    hardwarePerformanceReported: false, pixelVisualInspectionPerformed: false, notes: ['temporal fixture'] },
}));
`);
  await fs.chmod(path.join(project, 'engine.mjs'), 0o755);
  await fs.writeFile(path.join(project, '.game-dev', 'adapter.json'), canonicalJson({
    schema: GAME_DEV_ADAPTER_SCHEMA,
    id: 'temporal-fixture',
    name: 'Temporal fixture',
    version: '1.0.0',
    scenarios: [{
      id: 'sequence',
      title: 'Several frames',
      command: { executable: 'engine.mjs', arguments: [], workingDirectory: '.' },
      timeoutSeconds: 20,
      capabilities: ['cpu', 'project-write'],
      parameters: {},
      outputs: { format: 'game-dev-capture-v1', path: 'capture.json' },
    }],
  }));
}

async function capture(): Promise<string> {
  const adapter = await loadAdapter(project);
  const plan = await planScenarioRun({ adapter, scenarioId: 'sequence', runsRoot: path.join(root, 'runs') });
  const result = await executeScenarioRun({ adapter, plan, confirm: true, allowGpu: false, allowPerformance: false });
  expect(result.manifest.status).toBe('completed');
  return result.runPath;
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'frame-sequence-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('temporal analysis within one run', () => {
  it('finds the flickering object, names it, and leaves the steady one alone', async () => {
    await writeProject(true, [16, 16, 16, 16, 16, 16]);
    const outputPath = path.join(root, 'sequence-out');
    const analysis = await analyzeFrameSequence({ runPath: await capture(), outputPath });

    expect(analysis.frames).toEqual([0, 1, 2, 3, 4, 5]);
    expect(analysis.verdict).toBe('temporal-artifacts');
    // Object 1 is 4 of 16 columns: a quarter of the frame, every pixel of it.
    expect(analysis.flicker?.pixelRatio).toBeCloseTo(0.25, 6);
    expect(analysis.flicker?.objects).toEqual([{ objectId: '0x000001', pixels: 32, ratioOfObject: 1 }]);
    expect(analysis.summary.join(' ')).toContain('z-fighting');

    const heatmap = decodeImage(await fs.readFile(analysis.flicker!.heatmapPath!));
    expect(heatmap.data[0]).toBe(255);            // object 1: maximum reversals
    expect(heatmap.data[(0 * WIDTH + 6) * 4]).toBe(0); // object 2: none
  }, 60_000);

  it('reports the object that popped in, between the right two frames', async () => {
    await writeProject(false, [16, 16, 16, 16, 16, 16]);
    const analysis = await analyzeFrameSequence({ runPath: await capture() });

    expect(analysis.flicker?.pixels).toBe(0);
    expect(analysis.popping).toEqual([
      { fromFrame: 2, toFrame: 3, objectId: '0x000003', change: 'appeared', pixelsBefore: 0, pixelsAfter: 32 },
    ]);
  }, 60_000);

  it('hears stutter the mean hides: alternating short and long frames', async () => {
    // Mean 16.5ms either way. The second run alternates 8/25.
    await writeProject(false, [8, 25, 8, 25, 8, 25, 8, 25]);
    const analysis = await analyzeFrameSequence({ runPath: await capture() });

    expect(analysis.pacing?.frames).toBe(8);
    expect(analysis.pacing?.alternationRatio).toBe(1);
    expect(analysis.summary.join(' ')).toContain('alternate short/long');
  }, 60_000);

  it('calls a steady run steady once the pop is accounted for', async () => {
    await writeProject(false, [16, 16.2, 15.9, 16.1, 16, 16.1]);
    const analysis = await analyzeFrameSequence({ runPath: await capture() });

    expect(analysis.flicker?.pixels).toBe(0);
    expect(analysis.pacing?.alternationRatio).toBe(0);
    expect(analysis.pacing?.longestSlowRun).toBe(0);
    // Only the planted pop remains.
    expect(analysis.popping).toHaveLength(1);
  }, 60_000);

  it('refuses arguments that would make a finding meaningless', async () => {
    await writeProject(true, [16, 16, 16]);
    const runPath = await capture();
    await expect(analyzeFrameSequence({ runPath, threshold: -1 })).rejects.toThrow(/threshold/);
    await expect(analyzeFrameSequence({ runPath, minReversals: 0 })).rejects.toThrow(/minReversals/);
  }, 60_000);
});
