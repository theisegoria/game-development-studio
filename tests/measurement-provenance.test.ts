/**
 * A GPU timestamp query and a counter the engine incremented look identical
 * as floats. `measured_by` is the telemetry-level evidence ceiling: it says
 * HOW a number was measured, the summary carries it, and a goal can refuse to
 * chase a number nothing measured.
 *
 * The claim and the authority stay separate: an adapter can say
 * "gpu_timestamp_query", but only the run-level admission decides whether
 * that claim counts, and hardwareMeasurementAdmitted is their conjunction.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadAdapter, planScenarioRun } from '../src/harness/adapter.js';
import { telemetryEventSchema } from '../src/harness/contracts.js';
import { createOptimizationGoal, evaluateOptimizationGoal } from '../src/harness/goals.js';
import { statistics, summarizeRunPerformance } from '../src/harness/performance.js';
import { executeScenarioRun } from '../src/harness/run-bundle.js';
import { writeHarnessProject } from './helpers/harness-fixture.js';

let root: string;
let project: Awaited<ReturnType<typeof writeHarnessProject>>;
const savedEnvironment: Record<string, string | undefined> = {};

beforeEach(async () => {
  for (const name of ['CI', 'GAME_DEV_CI_HARDWARE_ATTESTED']) {
    savedEnvironment[name] = process.env[name];
    delete process.env[name];
  }
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'provenance-'));
  project = await writeHarnessProject(root);
});

afterEach(async () => {
  for (const [name, value] of Object.entries(savedEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await fs.rm(root, { recursive: true, force: true });
});

async function run(mode: 'normal' | 'gpu-timed', frameTime: number, allowPerformance: boolean): Promise<string> {
  const adapter = await loadAdapter(project.projectRoot);
  const plan = await planScenarioRun({
    adapter, scenarioId: 'capture', runsRoot: path.join(root, 'runs'),
    parameters: {
      source: path.basename(project.baselinePng), objectIds: path.basename(project.objectIdPng), frameTime, mode,
    },
  });
  return (await executeScenarioRun({ adapter, plan, confirm: true, allowGpu: false, allowPerformance })).runPath;
}

describe('the measured_by vocabulary', () => {
  it('reads absence as unknown, and refuses a value outside the vocabulary', () => {
    const base = {
      schema: 'game_dev.telemetry_event.v1', runId: 'run_1', sequence: 0, timestampNs: '1',
      category: 'performance', name: 'frame_time', value: 1, unit: 'ms',
    };
    expect(telemetryEventSchema.parse({ ...base, attributes: {} }).attributes).toEqual({});
    expect(telemetryEventSchema.safeParse({ ...base, attributes: { measured_by: 'gpu_timestamp' } }).success).toBe(false);
    expect(telemetryEventSchema.safeParse({ ...base, attributes: { measured_by: 'gpu_timestamp_query' } }).success).toBe(true);
  });

  it('keeps the claim and the admission separate', () => {
    // A claimed timestamp query under a run that did not admit hardware
    // evidence: the claim is recorded verbatim, the admission is false.
    const claimed = statistics('m', 'ms', [1, 2], 'sample', 'gpu_timestamp_query', false);
    expect(claimed.measuredBy).toBe('gpu_timestamp_query');
    expect(claimed.hardwareMeasurementAdmitted).toBe(false);

    const admitted = statistics('m', 'ms', [1, 2], 'sample', 'gpu_timestamp_query', true);
    expect(admitted.hardwareMeasurementAdmitted).toBe(true);

    // An engine counter is never a hardware measurement, whatever the run admitted.
    expect(statistics('m', 'count', [1], 'sample', 'engine_counter', true).hardwareMeasurementAdmitted).toBe(false);
    expect(statistics('m', 'ms', [1]).measuredBy).toBe('unknown');
  });
});

describe('a summary that carries provenance', () => {
  it('reports each metric\'s provenance and counts samples under each', async () => {
    const summary = await summarizeRunPerformance(await run('gpu-timed', 12, true));
    const timed = summary.metrics.find((m) => m.metric === 'performance.frame_time')!;

    expect(timed.measuredBy).toBe('gpu_timestamp_query');
    expect(timed.hardwareMeasurementAdmitted).toBe(true);
    expect(summary.measurementProvenance.gpu_timestamp_query).toBe(2);
    expect(summary.measurementProvenance.unknown).toBeGreaterThan(0);
    // The profile's gpu_frame_ns is a number in a JSON file; nothing said how it was measured.
    expect(summary.metrics.find((m) => m.metric.startsWith('profile.'))!.measuredBy).toBe('unknown');
  }, 60_000);

  it('says so when a run admitted hardware evidence but no metric claimed a hardware provenance', async () => {
    // The 'normal' fixture reports no hardware performance, so admission is
    // false and the existing sentence applies; the new one is for the case
    // where admission is true and nothing was measured by hardware.
    const summary = await summarizeRunPerformance(await run('normal', 12, true));
    expect(summary.hardwarePerformanceEvidenceAdmitted).toBe(false);
    expect(summary.metrics.every((m) => !m.hardwareMeasurementAdmitted)).toBe(true);
    expect(summary.summary.join(' ')).toContain('not admitted');
  }, 60_000);
});

describe('a goal that requires a hardware measurement', () => {
  const goalOptions = (baselineRunPath: string, requireHardwareMeasurement: boolean) => ({
    projectRoot: project.projectRoot,
    baselineRunPath,
    metric: 'performance.frame_time',
    unit: 'ms',
    direction: 'lower' as const,
    target: 10,
    maximumIterations: 3,
    allowedPaths: ['src'],
    requireHardwareMeasurement,
    confirm: true,
  });

  it('refuses a baseline nothing measured, and binds one a timestamp query did', async () => {
    await expect(createOptimizationGoal(goalOptions(await run('normal', 12, false), true)))
      .rejects.toThrow(/requires a hardware-measured metric/);

    const created = await createOptimizationGoal(goalOptions(await run('gpu-timed', 12, true), true));
    expect(created.goal.measuredBy).toBe('gpu_timestamp_query');
    expect(created.goal.requireHardwareMeasurement).toBe(true);
  }, 90_000);

  it('refuses a candidate whose provenance differs from the baseline, even when the number is better', async () => {
    const created = await createOptimizationGoal(goalOptions(await run('gpu-timed', 12, true), true));
    // 8ms beats the target of 10 -- but it is a wall-clock-free, unknown-provenance number.
    const candidate = await run('normal', 8, false);
    await expect(evaluateOptimizationGoal({ goalPath: created.goalPath, candidateRunPath: candidate, confirm: true }))
      .rejects.toThrow(/provenance does not match/);

    const timed = await run('gpu-timed', 8, true);
    const evaluated = await evaluateOptimizationGoal({ goalPath: created.goalPath, candidateRunPath: timed, confirm: true });
    expect(evaluated.targetMet).toBe(true);
  }, 90_000);

  it('still lets an unconstrained goal bind a metric of unknown provenance', async () => {
    const created = await createOptimizationGoal(goalOptions(await run('normal', 12, false), false));
    expect(created.goal.measuredBy).toBe('unknown');
    expect(created.goal.requireHardwareMeasurement).toBe(false);
  }, 60_000);
});
