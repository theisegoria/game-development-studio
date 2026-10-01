import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from 'vitest';
import { writeHarnessProject } from './helpers/harness-fixture.js';
import { loadAdapter, planScenarioRun } from '../src/harness/adapter.js';
import { executeScenarioRun } from '../src/harness/run-bundle.js';
import { encodePNG } from '../src/inspection/image.js';
import { measureRunStability } from '../src/harness/stability.js';
import { compareRunVisuals } from '../src/harness/visual.js';
import { describeComparison } from '../src/harness/describe-comparison.js';
import { createOptimizationGoal, evaluateOptimizationGoal } from '../src/harness/goals.js';

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'capture-evidence-'));
  const project = await writeHarnessProject(root);
  async function run(name: string, rgb: number, alpha = 255, milliseconds = 20) {
    const data = new Uint8Array(64);
    for (let pixel = 0; pixel < 16; pixel += 1) data.set([rgb, rgb, rgb, alpha], pixel * 4);
    await fs.writeFile(path.join(project.projectRoot, name), encodePNG({ width: 4, height: 4, data }));
    const adapter = await loadAdapter(project.projectRoot);
    const plan = await planScenarioRun({
      adapter, scenarioId: 'capture', runsRoot: path.join(root, 'runs'),
      parameters: { source: name, objectIds: 'objects.png', frameTime: milliseconds, mode: 'normal' },
    });
    return (await executeScenarioRun({ adapter, plan, confirm: true, allowGpu: false, allowPerformance: false })).runPath;
  }
  return { root, project, run };
}

test('alpha changes are not bit deterministic and contribute to the noise floor', async () => {
  const { root, run } = await fixture();
  try {
    const baseline = await run('a.png', 100, 0);
    const candidate = await run('b.png', 100, 255);
    const stability = await measureRunStability({ runPaths: [baseline, candidate], outputPath: path.join(root, 'stability') });
    const comparison = await compareRunVisuals({ baselineRunPath: baseline, candidateRunPath: candidate });
    expect(comparison.verdict).toBe('changed');
    expect(stability.verdict).not.toBe('bit-deterministic');
    expect(stability.attachments.find((entry) => entry.kind === 'color')?.maximumNoise).toBe(1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('noise floors must belong to the compared adapter scenario', async () => {
  const { root, project, run } = await fixture();
  try {
    const first = await run('a.png', 0);
    const second = await run('b.png', 255);
    const stability = await measureRunStability({ runPaths: [first, second], outputPath: path.join(root, 'stability') });
    const manifestPath = path.join(project.projectRoot, '.game-dev/adapter.json');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
    manifest.id = 'other-project';
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    const baseline = await run('c.png', 0);
    const candidate = await run('d.png', 200);
    await expect(compareRunVisuals({
      baselineRunPath: baseline, candidateRunPath: candidate, noiseFloorPath: stability.recordPath,
    })).rejects.toThrow(/adapter scenario/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('optimization cannot meet a raw-sample target with a candidate p99 aggregate', async () => {
  const { root, project, run } = await fixture();
  try {
    const baseline = await run('a.png', 100, 255, 20);
    const goal = await createOptimizationGoal({
      projectRoot: project.projectRoot, baselineRunPath: baseline, metric: 'render.frame_time', unit: 'ms',
      direction: 'lower', target: 10, maximumIterations: 3, allowedPaths: ['src/renderer.cpp'], confirm: true,
    });
    const runner = path.join(project.projectRoot, 'capture-runner.mjs');
    await fs.writeFile(runner, (await fs.readFile(runner, 'utf8')).replace("aggregation: 'sample'", "aggregation: 'p99'"));
    const candidate = await run('b.png', 100, 255, 5);
    await expect(evaluateOptimizationGoal({
      goalPath: goal.goalPath, candidateRunPath: candidate, confirm: false,
    })).rejects.toThrow(/metric is absent/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('missing attachments cannot produce identical or bit-deterministic verdicts', async () => {
  const { root, project, run } = await fixture();
  try {
    const baseline = await run('a.png', 100);
    const runner = path.join(project.projectRoot, 'capture-runner.mjs');
    await fs.writeFile(runner, (await fs.readFile(runner, 'utf8')).replace(
      "{ kind: 'color', path: 'captures/color.png', encoding: 'png' },", '',
    ));
    const candidate = await run('b.png', 100);
    const comparison = await compareRunVisuals({ baselineRunPath: baseline, candidateRunPath: candidate });
    expect(comparison.verdict).toBe('incomparable');
    expect(describeComparison({ ...comparison, pairs: [], unmatchedBaseline: [], unmatchedCandidate: [] }).verdict)
      .toBe('incomparable');
    await expect(measureRunStability({
      runPaths: [baseline, candidate], outputPath: path.join(root, 'stability'),
    })).rejects.toThrow(/same PNG attachment identities/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
