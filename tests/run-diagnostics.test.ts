/**
 * Diagnostics are validated end to end: a small C engine writes them through
 * the real probe SDK, and the harness, knowing nothing about the C code,
 * groups and diffs them. The engine repeats one validation error with a
 * different handle each time -- the case that makes raw logs unreadable --
 * and the "broken" build adds exactly one new error. That one must be the
 * answer.
 */

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAdapter, planScenarioRun } from '../src/harness/adapter.js';
import { GAME_DEV_ADAPTER_SCHEMA, telemetryEventSchema } from '../src/harness/contracts.js';
import { listRunDiagnostics, normalizeDiagnosticMessage } from '../src/harness/diagnostics.js';
import { executeScenarioRun } from '../src/harness/run-bundle.js';
import { canonicalJson } from '../src/packages/format.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const sdk = path.join(repoRoot, 'probe', 'c', 'gdprobe.c');

function compilerAvailable(): boolean {
  try { execFileSync('cc', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const haveCompiler = compilerAvailable();

const ENGINE = String.raw`
#include "gdprobe.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc, char **argv) {
  int broken = argc > 1 && atoi(argv[1]) == 1;
  gdprobe_status status;
  gdprobe_run *run = gdprobe_run_begin(&status);
  if (!run) return status == GDPROBE_NOT_ATTACHED ? 0 : 1;
  gdprobe_declare_backend(run, GDPROBE_BACKEND_UNKNOWN, "cpu", "test", GDPROBE_RENDERER_SOFTWARE);
  unsigned char rgba[4 * 4 * 4];
  memset(rgba, 128, sizeof rgba);
  for (int frame = 0; frame < 3; frame += 1) {
    gdprobe_frame *f = gdprobe_frame_begin(run, (uint32_t) frame, "main");
    gdprobe_attach_rgba8(f, GDPROBE_KIND_COLOR, NULL, rgba, 4, 4, 16);
    gdprobe_frame_end(f);
    char message[160];
    snprintf(message, sizeof message, "vkCmdDraw: VkImage 0x%x is in layout UNDEFINED, expected SHADER_READ_ONLY (binding %d)", 0x1000 + frame * 16, frame);
    gdprobe_diagnostic(run, "vulkan-validation", GDPROBE_SEVERITY_ERROR, "VUID-vkCmdDraw-None-09600", message, frame);
    if (broken && frame == 1) {
      gdprobe_diagnostic(run, "vulkan-validation", GDPROBE_SEVERITY_ERROR, "VUID-VkGraphicsPipelineCreateInfo-layout-07988",
                         "Shader uses descriptor slot 0.2 not declared in the pipeline layout", frame);
    }
  }
  gdprobe_diagnostic(run, "engine", GDPROBE_SEVERITY_WARNING, NULL, "texture atlas 3 is 4096 pixels wide, over budget", -1);
  if (!broken) gdprobe_diagnostic(run, "engine", GDPROBE_SEVERITY_INFO, NULL, "shader cache warm", -1);
  /* A message past the bound, with a multi-byte character straddling it. */
  char *long_message = malloc(4100);
  memset(long_message, 'a', 3999);
  memcpy(long_message + 3999, "\xC3\xA9", 2);
  memset(long_message + 4001, 'b', 98);
  long_message[4099] = '\0';
  gdprobe_diagnostic(run, "engine", GDPROBE_SEVERITY_INFO, "long", long_message, -1);
  free(long_message);
  return gdprobe_run_end(run) == GDPROBE_OK ? 0 : 1;
}
`;

let root: string;
let projectRoot: string;

beforeAll(async () => {
  if (!haveCompiler) return;
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'run-diagnostics-'));
  projectRoot = path.join(root, 'engine');
  await fs.mkdir(path.join(projectRoot, '.game-dev'), { recursive: true });
  await fs.writeFile(path.join(root, 'engine.c'), ENGINE);
  execFileSync('cc', ['-std=c99', '-Wall', '-Wextra', '-Werror', `-I${path.dirname(sdk)}`,
    sdk, path.join(root, 'engine.c'), '-o', path.join(projectRoot, 'engine')], { stdio: 'pipe' });
  await fs.writeFile(path.join(projectRoot, '.game-dev', 'adapter.json'), canonicalJson({
    schema: GAME_DEV_ADAPTER_SCHEMA,
    id: 'diagnostics-fixture',
    name: 'Diagnostics fixture',
    version: '1.0.0',
    scenarios: [{
      id: 'capture',
      title: 'Three frames with validation output',
      command: { executable: 'engine', arguments: ['{param.broken}'], workingDirectory: '.' },
      timeoutSeconds: 20,
      capabilities: ['software-raster', 'project-write'],
      parameters: { broken: { type: 'integer', required: false, default: 0, minimum: 0, maximum: 1 } },
      outputs: { format: 'game-dev-capture-v1', path: 'capture.json' },
    }],
  }));
});

afterAll(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

async function capture(broken: number): Promise<string> {
  const adapter = await loadAdapter(projectRoot);
  const plan = await planScenarioRun({ adapter, scenarioId: 'capture', runsRoot: path.join(root, 'runs'), parameters: { broken } });
  const result = await executeScenarioRun({ adapter, plan, confirm: true, allowGpu: false, allowPerformance: false });
  expect(result.manifest.status, JSON.stringify(result.manifest.failure)).toBe('completed');
  return result.runPath;
}

describe('message normalisation', () => {
  it('folds handles and numbers, and keeps different messages apart', () => {
    expect(normalizeDiagnosticMessage('VkImage 0x1000 binding 0')).toBe(normalizeDiagnosticMessage('VkImage 0x1f30 binding 7'));
    expect(normalizeDiagnosticMessage('layout UNDEFINED')).not.toBe(normalizeDiagnosticMessage('layout GENERAL'));
    // An identifier with digits in it is a name, not a count.
    expect(normalizeDiagnosticMessage('uses vec4 at set2')).toContain('vec4');
  });

  it('refuses a diagnostic the harness could not classify', () => {
    const base = {
      schema: 'game_dev.telemetry_event.v1', runId: 'run_1', sequence: 0, timestampNs: '1',
      category: 'diagnostic', name: 'message',
    };
    expect(telemetryEventSchema.safeParse({ ...base, attributes: { severity: 'error', message: 'x' } }).success).toBe(true);
    expect(telemetryEventSchema.safeParse({ ...base, attributes: { severity: 'fatal', message: 'x' } }).success).toBe(false);
    expect(telemetryEventSchema.safeParse({ ...base, attributes: { severity: 'error' } }).success).toBe(false);
    expect(telemetryEventSchema.safeParse({ ...base, attributes: { severity: 'error', message: 'x'.repeat(4097) } }).success).toBe(false);
  });
});

describe.skipIf(!haveCompiler)('diagnostics written by the C SDK', () => {
  it('groups one error repeated with different handles into one group, placed in its frames', async () => {
    const diagnostics = await listRunDiagnostics({ runPath: await capture(0) });
    const draw = diagnostics.groups.find((group) => group.messageId === 'VUID-vkCmdDraw-None-09600')!;

    expect(draw).toMatchObject({ severity: 'error', source: 'vulkan-validation', count: 3, frames: [0, 1, 2], outsideFrames: 0 });
    expect(diagnostics.totals).toEqual({ error: 3, warning: 1, info: 2 });
    expect(diagnostics.verdict).toBe('errors');
    // Worst first.
    expect(diagnostics.groups[0]!.severity).toBe('error');
  }, 60_000);

  it('bounds a long message without cutting a character in half', async () => {
    const diagnostics = await listRunDiagnostics({ runPath: await capture(0) });
    const long = diagnostics.groups.find((group) => group.messageId === 'long')!;

    expect(Buffer.byteLength(long.example, 'utf8')).toBeLessThanOrEqual(4000);
    expect(long.example).not.toContain('�');
    expect(long.example.endsWith('a')).toBe(true);
  }, 60_000);

  it('names exactly the error a change introduced, and what it resolved', async () => {
    const good = await capture(0);
    const broken = await capture(1);
    const diagnostics = await listRunDiagnostics({ runPath: broken, baselineRunPath: good });

    expect(diagnostics.baseline?.introduced.map((group) => group.messageId)).toEqual(['VUID-VkGraphicsPipelineCreateInfo-layout-07988']);
    expect(diagnostics.baseline?.introduced[0]?.frames).toEqual([1]);
    expect(diagnostics.baseline?.resolved.map((group) => group.example)).toEqual(['shader cache warm']);
    expect(diagnostics.summary.join('\n')).toContain('New since baseline');
    expect(diagnostics.summary.join('\n')).toContain('descriptor slot');
  }, 60_000);
});
