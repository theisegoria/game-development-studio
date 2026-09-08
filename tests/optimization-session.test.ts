import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createSampleProject } from '../src/harness/templates.js';
import { loadAdapter, planScenarioRun } from '../src/harness/adapter.js';
import { executeScenarioRun } from '../src/harness/run-bundle.js';
import { planOptimization, startOptimization, evaluateOptimization, exportOptimization, recoverOptimization } from '../src/optimization/session.js';
import { runCommand } from '../src/optimization/process.js';
const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'studio-optimization-')); roots.push(root);
  const project = path.join(root, 'game');
  await createSampleProject(project, true);
  await runCommand('git', ['init', '-q'], project);
  await runCommand('git', ['add', '.'], project);
  // Include a tracked dirty working-tree change in the starting snapshot.
  await writeFile(path.join(project, 'src/renderer.json'), '{"frameTime":14,"visualRegression":false}\n');
  const adapter = await loadAdapter(project);
  const parameters = { mode: 'normal' };
  const plan = await planScenarioRun({ adapter, scenarioId: 'capture', runsRoot: path.join(root, 'runs'), parameters });
  const baseline = await executeScenarioRun({ adapter, plan, request: parameters, confirm: true, allowGpu: false, allowPerformance: false });
  const spec = { scenarioId: 'capture', parameters, metric: 'render.frame_time', unit: 'ms', target: 10, allowedPaths: ['src'],
    build: { executable: process.execPath, arguments: ['--check', 'capture.mjs'] }, tests: [{ executable: process.execPath, arguments: ['test.mjs'] }] };
  const optimization = await planOptimization(project, baseline.runPath, spec);
  const session = await startOptimization(optimization, path.join(root, 'sessions'), optimization.planHash);
  return { root, project, session, optimization };
}
it('evaluates an external-agent edit and exports a reviewable patch without modifying the original checkout', async () => {
  const { root, project, session } = await setup();
  const before = await runCommand('git', ['status', '--porcelain=v1'], project);
  await writeFile(path.join(session.checkout, 'src/renderer.json'), '{"frameTime":8,"visualRegression":false}\n');
  const result = await evaluateOptimization(session.directory, { allowGpu: false, allowPerformance: false });
  expect(result.attempts[0]?.error).toBeUndefined();
  expect(result).toMatchObject({ status: 'met', bestAttempt: 1 });
  await exportOptimization(session.directory, path.join(root, 'review'));
  expect(await readFile(path.join(root, 'review', 'candidate.patch'), 'utf8')).toContain('+{"frameTime":8');
  expect(await readFile(path.join(project, 'src/renderer.json'), 'utf8')).toContain('14');
  expect(await runCommand('git', ['status', '--porcelain=v1'], project)).toBe(before);
  await writeFile(path.join(project, 'src/renderer.json'), '{"frameTime":15,"visualRegression":false}\n');
  await expect(exportOptimization(session.directory, path.join(root, 'drifted'))).rejects.toThrow('original source changed');
}, 20000);
it('rejects visual regressions and source changes outside the allowlist, recording failures', async () => {
  const { session } = await setup();
  await writeFile(path.join(session.checkout, 'src/renderer.json'), '{"frameTime":8,"visualRegression":true}\n');
  const visual = await evaluateOptimization(session.directory, { allowGpu: false, allowPerformance: false });
  expect(visual.attempts[0]).toMatchObject({ status: 'failed', error: 'candidate failed the visual acceptance limit' });
  await writeFile(path.join(session.checkout, 'test.mjs'), 'process.exit(0);\n');
  const outside = await evaluateOptimization(session.directory, { allowGpu: false, allowPerformance: false });
  expect(outside.attempts[1]?.error).toContain('outside the approved allowlist');
}, 20000);
it('requires matching plan hashes and refuses concurrent session access', async () => {
  const { root, session, optimization } = await setup();
  await expect(startOptimization(optimization, path.join(root, 'other'), 'wrong')).rejects.toThrow('plan changed');
  await writeFile(path.join(session.directory, 'session.lock'), JSON.stringify({ pid: process.pid }));
  await expect(evaluateOptimization(session.directory, { allowGpu: false, allowPerformance: false })).rejects.toThrow('locked');
  await expect(recoverOptimization(session.directory)).rejects.toThrow('still running');
}, 20000);
it('retains interrupted attempts and requires explicit recovery before a new evaluation', async () => {
  const { session } = await setup();
  session.attempts.push({ number: 1, startedAt: new Date().toISOString(), status: 'running' });
  await writeFile(path.join(session.directory, 'session.json'), JSON.stringify(session));
  await expect(evaluateOptimization(session.directory, { allowGpu: false, allowPerformance: false })).rejects.toThrow('requires explicit recovery');
  const recovered = await recoverOptimization(session.directory);
  expect(recovered.attempts[0]?.status).toBe('interrupted');
  await mkdir(path.join(session.checkout, 'src/new'));
  await writeFile(path.join(session.checkout, 'src/new/file.txt'), 'external candidate');
  const failed = await evaluateOptimization(session.directory, { allowGpu: false, allowPerformance: false });
  expect(failed.attempts).toHaveLength(2);
  expect(failed.status).toBe('active');
}, 20000);
