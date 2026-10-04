import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { createSampleProject } from '../src/harness/templates.js';
import { loadAdapter, planScenarioRun } from '../src/harness/adapter.js';
import { executeScenarioRun, verifyRunBundle } from '../src/harness/run-bundle.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'node adapter spaces '));
  roots.push(root);
  const project = path.join(root, 'sample project');
  await createSampleProject(project, true);
  return { root, project, adapter: await loadAdapter(project) };
}
test('the compiler-free sample executes through the exact Node runtime with a sealed identity', async () => {
  const { root, project, adapter } = await setup();
  await fs.chmod(path.join(project, 'capture.mjs'), 0o600);
  const plan = await planScenarioRun({ adapter, scenarioId: 'capture', runsRoot: path.join(root, 'runs') });
  expect(plan.runtime).toBe('node');
  expect(plan.runtimeExecutable).toBe(await fs.realpath(process.execPath));
  expect(plan.executableSHA256).toMatch(/^[a-f0-9]{64}$/);
  const run = await executeScenarioRun({ adapter, plan, confirm: true, allowGpu: false, allowPerformance: false });
  expect(run.manifest.status).toBe('completed');
  expect(run.manifest.process.runtime).toBe('node');
  expect((await verifyRunBundle(run.runPath)).manifestSha256).toBe(run.manifestSha256);
});
test('a script change after planning requires a new plan before any launch', async () => {
  const { root, project, adapter } = await setup();
  const plan = await planScenarioRun({ adapter, scenarioId: 'capture', runsRoot: path.join(root, 'runs') });
  await fs.appendFile(path.join(project, 'capture.mjs'), '\n// changed after review\n');
  await expect(executeScenarioRun({ adapter, plan, confirm: true, allowGpu: false, allowPerformance: false })).rejects.toThrow('changed after planning');
  await expect(fs.stat(plan.runPath)).rejects.toMatchObject({ code: 'ENOENT' });
});
test('a substituted runtime or stale digest is refused before launch', async () => {
  const { root, adapter } = await setup();
  const plan = await planScenarioRun({ adapter, scenarioId: 'capture', runsRoot: path.join(root, 'runs') });
  plan.runtimeSHA256 = '0'.repeat(64);
  await expect(executeScenarioRun({ adapter, plan, confirm: true, allowGpu: false, allowPerformance: false })).rejects.toThrow('changed after planning');
  await expect(fs.stat(plan.runPath)).rejects.toMatchObject({ code: 'ENOENT' });
});
