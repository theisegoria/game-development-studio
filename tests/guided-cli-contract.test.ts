import { execFile } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, test } from 'vitest';
import { writeGameReadyGlb } from './helpers/model-fixture.js';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'guided CLI spaces ')); roots.push(root);
  const model = await writeGameReadyGlb(path.join(root, 'model source.glb'));
  return { root, model };
}
async function run(root: string, args: string[]) {
  return new Promise<{ code: number; payload: Record<string, any> }>((resolve, reject) => {
    execFile(process.execPath, [cli, ...args, '--output-dir', root, '--json'], {
      env: { ...process.env, TRIPO_API_KEY: '', LEONARDO_API_KEY: '', ASSET_LOG_LEVEL: 'error',
        GAME_DEV_TOOL_CONFIG_PATH: path.join(root, 'optional tools.json'), BLENDER_PATH: '', GAME_DEV_BASISU_PATH: '', GAME_DEV_COACD_PYTHON: '' },
      maxBuffer: 8 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      try { resolve({ code: typeof error?.code === 'number' ? error.code : 0, payload: JSON.parse(stdout) as Record<string, any> }); }
      catch (failure) { reject(new Error(`Invalid CLI result: ${stdout}\n${stderr}`, { cause: failure })); }
    });
  });
}
test('friendly workflow completes inspection, validation and packaging through actual result bindings', async () => {
  const { root, model } = await setup();
  const args = ['workflow', 'create', 'inspect-validate-package', model, '--name', 'CLI sample', '--license', 'CC0-1.0', '--recipe-id', 'cli_sample'];
  const preview = await run(root, args);
  expect(preview.payload.ok).toBe(true); expect(preview.payload.data.executes).toBe(false);
  await expect(fs.stat(path.join(root, '.production', 'recipes', 'cli_sample.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await run(root, [...args, '--confirm'])).payload.ok).toBe(true);
  for (const stepId of ['inspect', 'validate', 'package']) {
    const plan = (await run(root, ['workflow', 'plan', 'cli_sample'])).payload.data;
    const step = plan.steps.find((item: { id: string }) => item.id === stepId);
    expect(step.status).toBe('ready');
    expect((await run(root, ['workflow', 'step', 'cli_sample', stepId, '--fingerprint', step.fingerprint])).payload.error.error).toBe('APPROVAL_REQUIRED');
    const result = await run(root, ['workflow', 'step', 'cli_sample', stepId, '--fingerprint', step.fingerprint, '--confirm']);
    expect(result.payload.ok, JSON.stringify(result.payload)).toBe(true);
  }
  const completed = (await run(root, ['workflow', 'plan', 'cli_sample'])).payload.data;
  expect(completed.steps.every((step: { status: string }) => step.status === 'complete')).toBe(true);
  expect(completed.nextStep.kind).toBe('complete');
});
test('optional selections require confirmation, persist across CLI restarts and fail closed after drift', async () => {
  const { root } = await setup();
  const executable = path.join(root, 'fake optional executable');
  await fs.writeFile(executable, '#!/bin/sh\nexit 99\n', { mode: 0o700 });
  const args = ['tool', 'configure', 'basisu', '--executable', executable];
  expect((await run(root, args)).payload.error.error).toBe('APPROVAL_REQUIRED');
  await expect(fs.stat(path.join(root, 'optional tools.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await run(root, [...args, '--confirm'])).payload.data.processLaunched).toBe(false);
  const selected = (await run(root, ['tool', 'list'])).payload.data.tools.find((tool: { tool: string }) => tool.tool === 'basisu');
  expect(selected.available).toBe(true);
  await fs.appendFile(executable, '# changed\n');
  const changed = (await run(root, ['tool', 'list'])).payload.data.tools.find((tool: { tool: string }) => tool.tool === 'basisu');
  expect(changed.available).toBe(false); expect(changed.code).toBe('changed');
});
test('doctor returns a failing exit for an unexpected version while support reports stay redacted and local', async () => {
  const { root } = await setup();
  const wrongVersion = await run(root, ['doctor', '--workflow', 'generic-capture', '--expected-version', '0.0.1']);
  expect(wrongVersion.code).toBe(1); expect(wrongVersion.payload.ok).toBe(false);
  const preview = await run(root, ['support', 'report']);
  expect(preview.payload.data.sharing).toEqual({ transmitted: false, userReviewRequired: true });
  expect(JSON.stringify(preview.payload.data)).not.toContain(root);
  const output = path.join(root, 'review before sharing.json');
  expect((await run(root, ['support', 'report', '--output', output])).payload.error.error).toBe('APPROVAL_REQUIRED');
  expect((await run(root, ['support', 'report', '--output', output, '--confirm'])).payload.ok).toBe(true);
  expect((await run(root, ['support', 'report', '--output', output, '--confirm'])).payload.ok).toBe(false);
});
