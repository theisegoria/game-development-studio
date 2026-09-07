/**
 * The Metal example, driven through the real harness on a real GPU.
 *
 * Like the C SDK test, this validates against the harness rather than
 * against golden files. What is new here is the claim being checked: a
 * hardware renderer, a resolved timestamp pair as the completion identity,
 * and per-pass time whose provenance names the counter that measured it.
 *
 * macOS only, and skipped loudly elsewhere. CI's macOS job asserts it ran.
 */

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAdapter, planScenarioRun } from '../src/harness/adapter.js';
import { GAME_DEV_ADAPTER_SCHEMA } from '../src/harness/contracts.js';
import { summarizeRunPerformance } from '../src/harness/performance.js';
import { executeScenarioRun } from '../src/harness/run-bundle.js';
import { compareRunVisuals } from '../src/harness/visual.js';
import { canonicalJson } from '../src/packages/format.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sdkSource = path.join(repoRoot, 'probe', 'c', 'gdprobe.c');
const exampleSource = path.join(repoRoot, 'probe', 'examples', 'metal', 'main.m');

const onMacOS = process.platform === 'darwin';
let root: string;
let projectRoot: string;
let compiled = false;
const savedEnvironment: Record<string, string | undefined> = {};

beforeAll(async () => {
  if (!onMacOS) return;
  for (const name of ['CI', 'GAME_DEV_CI_HARDWARE_ATTESTED']) {
    savedEnvironment[name] = process.env[name];
  }
  // The timing claim is what this test checks, and a hosted macOS runner is
  // deliberately refused it. The run is declared attested for the duration
  // of this test only; the assertion is about the SDK's claim, not the
  // runner's hardware.
  process.env.GAME_DEV_CI_HARDWARE_ATTESTED = '1';
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'probe-metal-'));
  projectRoot = path.join(root, 'engine');
  await fs.mkdir(path.join(projectRoot, '.game-dev'), { recursive: true });
  execFileSync('clang', [
    '-fobjc-arc', '-std=c99', '-Wall', '-Wextra', '-Werror', '-x', 'objective-c',
    '-framework', 'Metal', '-framework', 'Foundation',
    sdkSource, exampleSource, '-o', path.join(projectRoot, 'engine'),
  ], { stdio: 'pipe' });
  compiled = true;
  await fs.writeFile(path.join(projectRoot, '.game-dev', 'adapter.json'), canonicalJson({
    schema: GAME_DEV_ADAPTER_SCHEMA,
    id: 'probe_metal',
    name: 'Probe SDK Metal example',
    version: '1.0.0',
    scenarios: [{
      id: 'capture',
      title: 'Capture one frame on the GPU',
      command: { executable: 'engine', arguments: ['{param.brightness}'], workingDirectory: '.' },
      timeoutSeconds: 60,
      capabilities: ['metal', 'gpu', 'performance', 'project-write'],
      parameters: { brightness: { type: 'integer', required: false, default: 0, minimum: 0, maximum: 50 } },
      outputs: { format: 'game-dev-capture-v1', path: 'capture.json' },
    }],
  }));
});

afterAll(async () => {
  for (const [name, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (root) await fs.rm(root, { recursive: true, force: true });
});

async function run(brightness: number) {
  const adapter = await loadAdapter(projectRoot);
  const plan = await planScenarioRun({ adapter, scenarioId: 'capture', runsRoot: path.join(root, 'runs'), parameters: { brightness } });
  return executeScenarioRun({ adapter, plan, confirm: true, allowGpu: true, allowPerformance: true });
}

describe.skipIf(!onMacOS)('the Metal example on a real GPU', () => {
  it('compiles under the strictest flags and runs outside the harness', () => {
    expect(compiled).toBe(true);
    const output = execFileSync(path.join(projectRoot, 'engine'), [], { encoding: 'utf8' });
    expect(output).toContain('not attached');
  });

  it('attests completion by a resolved timestamp pair, and the harness admits it', async () => {
    const result = await run(0);
    const evidence = result.manifest.evidence;

    expect(evidence.rendererClass).toBe('hardware');
    expect(evidence.softwareRasterizedLane).toBe(false);
    expect(evidence.adapterReportedGpuExecution).toBe(true);
    expect(evidence.adapterReportedGpuCompletionIdentity).toBe(true);
    expect(evidence.hardwarePerformanceEvidenceAdmitted).toBe(true);
    // Still a claim the adapter made, never one the harness proved alone.
    expect(evidence.hardwareGpuExecutionProvenByHarnessAlone).toBe(false);
  }, 60_000);

  it('names what measured each timing, and only the hardware ones are admitted', async () => {
    const summary = await summarizeRunPerformance((await run(0)).runPath);
    const byMetric = new Map(summary.metrics.map((metric) => [metric.metric, metric]));

    expect(byMetric.get('render.pass.main.gpu_duration_ns')).toMatchObject({
      measuredBy: 'gpu_timestamp_query', hardwareMeasurementAdmitted: true,
    });
    expect(byMetric.get('render.commandbuffer.gpu_duration_ns')).toMatchObject({
      measuredBy: 'driver_report', hardwareMeasurementAdmitted: true,
    });
    expect(byMetric.get('performance.frame_time')).toMatchObject({
      measuredBy: 'wall_clock', hardwareMeasurementAdmitted: false,
    });
    expect(byMetric.get('render.draw_calls')).toMatchObject({
      measuredBy: 'engine_counter', hardwareMeasurementAdmitted: false,
    });
    expect(summary.measurementProvenance.gpu_timestamp_query).toBe(1);
  }, 60_000);

  it('renders the two objects the semantic diff can tell apart', async () => {
    const baseline = await run(0);
    const changed = await run(40);
    const comparison = await compareRunVisuals({
      baselineRunPath: baseline.runPath, candidateRunPath: changed.runPath, threshold: 0,
    });
    const color = comparison.pairs.find((pair) => pair.kind === 'color')!;
    // Object 1 (left half) is the only thing brightness touches.
    expect(color.changedPixelRatio).toBeCloseTo(0.5, 2);
    const regions = color.semanticRegions ?? [];
    const changedObjects = regions.filter((region) => region.changedPixelRatio > 0).map((region) => region.objectId);
    expect(changedObjects).toEqual(['0x000001']);
  }, 90_000);
});
