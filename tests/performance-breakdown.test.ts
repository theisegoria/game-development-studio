/**
 * "frame_time regressed" is a fact without a direction. These tests plant a
 * 3ms growth in one shadow cascade and require the breakdown to name that
 * cascade, through both span sources: the C SDK's v2 telemetry and a
 * Chrome-format trace of the kind an engine's existing profiler exports.
 */

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAdapter, planScenarioRun } from '../src/harness/adapter.js';
import { GAME_DEV_ADAPTER_SCHEMA, telemetrySpanEventSchema } from '../src/harness/contracts.js';
import { summarizeRunPerformance } from '../src/harness/performance.js';
import { executeScenarioRun } from '../src/harness/run-bundle.js';
import { breakdownRunPerformance, spanName, spansFromTrace } from '../src/harness/spans.js';
import { canonicalJson } from '../src/packages/format.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sdk = path.join(repoRoot, 'probe', 'c', 'gdprobe.c');
function compilerAvailable(): boolean {
  try { execFileSync('cc', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const haveCompiler = compilerAvailable();

// Per frame, on the GPU: frame 10ms > shadows 4ms > (cascade0 1ms, cascade1 2ms), lighting 5ms.
// Broken: cascade1 takes 5ms instead of 2ms, and the frame and shadows grow to match.
const ENGINE = String.raw`
#include "gdprobe.h"
#include <stdlib.h>
#include <string.h>
#define MS 1000000ull
int main(int argc, char **argv) {
  int broken = argc > 1 && atoi(argv[1]) == 1;
  gdprobe_status status;
  gdprobe_run *run = gdprobe_run_begin(&status);
  if (!run) return status == GDPROBE_NOT_ATTACHED ? 0 : 1;
  gdprobe_declare_backend(run, GDPROBE_BACKEND_UNKNOWN, "cpu", "test", GDPROBE_RENDERER_SOFTWARE);
  if (gdprobe_span_record(run, 999, 0, "bogus", 0, 0, 1, GDPROBE_CLOCK_GPU, GDPROBE_MEASURED_UNKNOWN) != GDPROBE_ERR_ARGUMENT) return 3;
  unsigned char rgba[4 * 4 * 4];
  memset(rgba, 90, sizeof rgba);
  uint64_t extra = broken ? 3 * MS : 0;
  for (int frame = 0; frame < 4; frame += 1) {
    gdprobe_frame *f = gdprobe_frame_begin(run, (uint32_t) frame, "main");
    gdprobe_attach_rgba8(f, GDPROBE_KIND_COLOR, NULL, rgba, 4, 4, 16);
    gdprobe_frame_end(f);
    uint64_t t = (uint64_t) frame * 100 * MS;
    uint64_t root = gdprobe_span_reserve(run);
    uint64_t shadows = gdprobe_span_reserve(run);
    gdprobe_span_record(run, gdprobe_span_reserve(run), shadows, "cascade0", frame, t, 1 * MS, GDPROBE_CLOCK_GPU, GDPROBE_MEASURED_GPU_TIMESTAMP_QUERY);
    gdprobe_span_record(run, gdprobe_span_reserve(run), shadows, "cascade1", frame, t + MS, 2 * MS + extra, GDPROBE_CLOCK_GPU, GDPROBE_MEASURED_GPU_TIMESTAMP_QUERY);
    gdprobe_span_record(run, shadows, root, "shadows", frame, t, 4 * MS + extra, GDPROBE_CLOCK_GPU, GDPROBE_MEASURED_GPU_TIMESTAMP_QUERY);
    gdprobe_span_record(run, gdprobe_span_reserve(run), root, "lighting pass", frame, t + 4 * MS + extra, 5 * MS, GDPROBE_CLOCK_GPU, GDPROBE_MEASURED_GPU_TIMESTAMP_QUERY);
    gdprobe_span_record(run, root, 0, "frame", frame, t, 10 * MS + extra, GDPROBE_CLOCK_GPU, GDPROBE_MEASURED_GPU_TIMESTAMP_QUERY);
    /* A CPU span that names a GPU parent: different clocks, must not nest. */
    gdprobe_span_record(run, gdprobe_span_reserve(run), root, "submit", frame, t, MS / 2, GDPROBE_CLOCK_CPU, GDPROBE_MEASURED_WALL_CLOCK);
  }
  return gdprobe_run_end(run) == GDPROBE_OK ? 0 : 1;
}
`;

let root: string;

beforeAll(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'breakdown-'));
});

afterAll(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function project(name: string, executable: string, args: string[], parameters: Record<string, unknown>): Promise<string> {
  const projectRoot = path.join(root, name);
  await fs.mkdir(path.join(projectRoot, '.game-dev'), { recursive: true });
  await fs.writeFile(path.join(projectRoot, '.game-dev', 'adapter.json'), canonicalJson({
    schema: GAME_DEV_ADAPTER_SCHEMA,
    id: `breakdown-${name}`,
    name: 'Breakdown fixture',
    version: '1.0.0',
    scenarios: [{
      id: 'capture', title: 'Spans', command: { executable, arguments: args, workingDirectory: '.' },
      timeoutSeconds: 20, capabilities: ['cpu', 'project-write'], parameters,
      outputs: { format: 'game-dev-capture-v1', path: 'capture.json' },
    }],
  }));
  return projectRoot;
}

async function capture(projectRoot: string, parameters: Record<string, unknown> = {}): Promise<string> {
  const adapter = await loadAdapter(projectRoot);
  const plan = await planScenarioRun({ adapter, scenarioId: 'capture', runsRoot: path.join(root, 'runs'), parameters });
  const result = await executeScenarioRun({ adapter, plan, confirm: true, allowGpu: false, allowPerformance: false });
  expect(result.manifest.status, JSON.stringify(result.manifest.failure)).toBe('completed');
  return result.runPath;
}

describe('span plumbing', () => {
  it('cleans names to the metric alphabet without dropping them', () => {
    expect(spanName('Shadow Pass (cascade 2)')).toBe('Shadow_Pass_cascade_2_');
    expect(spanName('  ')).toBe('unnamed');
  });

  it('refuses a span that is its own parent', () => {
    expect(telemetrySpanEventSchema.safeParse({
      schema: 'game_dev.telemetry_event.v2', runId: 'run_1', sequence: 0, kind: 'span', spanId: '7', parentSpanId: '7',
      name: 'x', startNs: '0', durationNs: '1', clockDomain: 'gpu',
    }).success).toBe(false);
  });

  it('recovers nesting from time containment and pairs B/E events', () => {
    const spans = spansFromTrace([
      { name: 'Frame', ph: 'X', ts: 0, dur: 10_000, tid: 1, args: { frame: 3 } },
      { name: 'Shadow Pass', ph: 'X', ts: 100, dur: 4_000, tid: 1 },
      { name: 'Cascade', ph: 'B', ts: 200, tid: 1 },
      { name: 'Cascade', ph: 'E', ts: 1_200, tid: 1 },
      { name: 'Other thread', ph: 'X', ts: 150, dur: 50, tid: 2 },
    ], 't:');
    const byName = new Map(spans.map((span) => [span.name, span]));
    expect(byName.get('Shadow_Pass')?.parentId).toBe(byName.get('Frame')?.id);
    expect(byName.get('Cascade')?.parentId).toBe(byName.get('Shadow_Pass')?.id);
    expect(byName.get('Cascade')?.durationNs).toBe(1_000_000);
    expect(byName.get('Cascade')?.frameIndex).toBe(3);
    expect(byName.get('Other_thread')?.parentId).toBeUndefined();
  });
});

describe.skipIf(!haveCompiler)('spans written by the C SDK', () => {
  let projectRoot: string;

  beforeAll(async () => {
    projectRoot = await project('sdk', 'engine', ['{param.broken}'], {
      broken: { type: 'integer', required: false, default: 0, minimum: 0, maximum: 1 },
    });
    await fs.writeFile(path.join(root, 'engine.c'), ENGINE);
    execFileSync('cc', ['-std=c99', '-Wall', '-Wextra', '-Werror', `-I${path.dirname(sdk)}`,
      sdk, path.join(root, 'engine.c'), '-o', path.join(projectRoot, 'engine')], { stdio: 'pipe' });
  });

  it('computes self-time and the longest chain, and keeps the CPU span out of the GPU tree', async () => {
    const breakdown = await breakdownRunPerformance({ runPath: await capture(projectRoot, { broken: 0 }) });
    const node = (nodePath: string) => breakdown.nodes.find((candidate) => candidate.path === nodePath);

    expect(breakdown.frames).toBe(4);
    expect(node('gpu:frame')?.medianSelfNs).toBe(1_000_000);              // 10 - 4 - 5
    expect(node('gpu:frame > shadows')?.medianSelfNs).toBe(1_000_000);    // 4 - 1 - 2
    expect(node('gpu:frame > shadows > cascade1')?.medianSelfNs).toBe(2_000_000);
    expect(node('gpu:frame > lighting_pass')?.shareOfRoot).toBeCloseTo(0.5, 6);
    expect(breakdown.criticalPaths).toContainEqual({ clockDomain: 'gpu', path: 'gpu:frame > lighting_pass', frames: 4 });
    // Named a GPU parent from the CPU clock: shown as its own root, and counted.
    expect(node('cpu:submit')?.depth).toBe(0);
    expect(breakdown.orphanSpans).toBe(4);
  }, 60_000);

  it('names the cascade that grew, and nothing else', async () => {
    const good = await capture(projectRoot, { broken: 0 });
    const slow = await capture(projectRoot, { broken: 1 });
    const breakdown = await breakdownRunPerformance({ runPath: slow, baselineRunPath: good });

    const moved = breakdown.baseline!.changes.filter((change) => change.deltaNs !== 0);
    expect(moved).toEqual([{
      path: 'gpu:frame > shadows > cascade1', baselineSelfNs: 2_000_000, candidateSelfNs: 5_000_000, deltaNs: 3_000_000, percentDelta: 150,
    }]);
    expect(breakdown.summary.join('\n')).toContain('frame > shadows > cascade1 grew by 3.00ms (+150%)');
  }, 60_000);

  it('makes every span a measurement the existing summary can read', async () => {
    const summary = await summarizeRunPerformance(await capture(projectRoot, { broken: 0 }));
    const cascade = summary.metrics.find((metric) => metric.metric === 'span.gpu.cascade1');
    expect(cascade).toMatchObject({ unit: 'ns', samples: 4, median: 2_000_000, measuredBy: 'gpu_timestamp_query' });
  }, 60_000);
});

describe('a Chrome trace an engine already exports', () => {
  it('is read from profiles instead of being ignored', async () => {
    const projectRoot = await project('trace', 'engine.mjs', [], {});
    await fs.writeFile(path.join(projectRoot, 'engine.mjs'), `#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
const runDir = process.env.GAME_DEV_RUN_DIR;
const runId = process.env.GAME_DEV_RUN_ID;
const events = [];
for (let frame = 0; frame < 3; frame += 1) {
  const t = frame * 20000;
  events.push({ name: 'Frame', ph: 'X', ts: t, dur: 16000, pid: 1, tid: 1, args: { frame } });
  events.push({ name: 'Shadow Pass', ph: 'X', ts: t + 10, dur: 6000, pid: 1, tid: 1 });
  events.push({ name: 'Post FX', ph: 'X', ts: t + 7000, dur: 2000, pid: 1, tid: 1 });
}
await fs.writeFile(path.join(runDir, 'trace.json'), JSON.stringify({ traceEvents: events }));
await fs.mkdir(path.join(runDir, 'f'));
await fs.copyFile(${JSON.stringify(path.join(repoRoot, 'assets', 'icon.png'))}, path.join(runDir, 'f', 'c.png'));
await fs.writeFile(path.join(runDir, 'capture.json'), JSON.stringify({
  schema: 'game_dev.capture.v1', runId, adapterId: process.env.GAME_DEV_ADAPTER_ID, scenarioId: process.env.GAME_DEV_SCENARIO_ID,
  sourceFormat: 'game-dev-capture-v1', frames: [{ index: 0, attachments: [{ kind: 'color', path: 'f/c.png', encoding: 'png' }] }],
  telemetry: [], profiles: ['trace.json'], measurements: [],
  adapterEvidence: { windowless: true, graphicsApi: 'fixture', gpuExecutionReported: false, gpuCompletionIdentityReported: false,
    hardwarePerformanceReported: false, pixelVisualInspectionPerformed: false, notes: ['trace fixture'] },
}));
`);
    await fs.chmod(path.join(projectRoot, 'engine.mjs'), 0o755);
    const runPath = await capture(projectRoot);

    const breakdown = await breakdownRunPerformance({ runPath });
    expect(breakdown.frames).toBe(3);
    expect(breakdown.nodes.find((node) => node.path === 'cpu:Frame > Shadow_Pass')?.medianSelfNs).toBe(6_000_000);
    expect(breakdown.nodes.find((node) => node.path === 'cpu:Frame')?.medianSelfNs).toBe(8_000_000);

    const summary = await summarizeRunPerformance(runPath);
    expect(summary.metrics.find((metric) => metric.metric === 'span.cpu.Post_FX')).toMatchObject({ samples: 3, median: 2_000_000 });
  }, 60_000);
});
