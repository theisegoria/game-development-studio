import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { ExecutionGate } from '../src/mcp/execution-gate.js';
import { ROADMAP_MUTATION_TOOLS } from '../src/commands/mutation-policy.js';
import { writeGameReadyGlb } from './helpers/model-fixture.js';
const exec = promisify(execFile);
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });
async function cli(root: string, name: string, input: unknown, confirm = false) {
  const args = ['dist/cli.js', 'tool', 'call', name, '--input', JSON.stringify(input), '--output-dir', root, '--json', ...(confirm ? ['--confirm'] : [])];
  try { return JSON.parse((await exec(process.execPath, args)).stdout); }
  catch (error) { return JSON.parse((error as { stdout: string }).stdout); }
}
it('every roadmap mutation refuses model arguments without human MCP elicitation', async () => {
  let calls = 0;
  for (const name of ROADMAP_MUTATION_TOOLS) {
    const gated = new ExecutionGate({}).wrap(name, async () => { calls += 1; return { content: [] }; });
    expect((await gated({ confirm: true, reviewer: 'Human', approved: true })).isError, name).toBe(true);
  }
  expect(calls).toBe(0);
});
it('CLI validates and packages a real synthetic GLB through resumable confirmed steps', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'roadmap-transports-')); roots.push(root);
  const modelPath = await writeGameReadyGlb(path.join(root, 'model.glb'));
  const recipe = { schema: 'game_dev.production_recipe.v1', id: 'test', name: 'Test', steps: [
    { id: 'validate', operation: 'validate_game_asset', arguments: { modelPath } },
    { id: 'package', operation: 'build_asset_package', dependsOn: ['validate'], arguments: { modelPath, name: 'Test', license: 'CC0-1.0' } },
  ] };
  expect((await cli(root, 'save_production_recipe', { recipe })).error.error).toBe('APPROVAL_REQUIRED');
  expect((await cli(root, 'save_production_recipe', { recipe }, true)).ok).toBe(true);
  let plan = (await cli(root, 'plan_production_recipe', { recipeId: 'test' })).data;
  const stepInput = { recipeId: 'test', stepId: 'validate', approvedFingerprint: plan.steps[0].fingerprint };
  expect((await cli(root, 'run_production_step', stepInput)).error.error).toBe('APPROVAL_REQUIRED');
  expect((await cli(root, 'run_production_step', stepInput, true)).data.state).toBe('complete');
  plan = (await cli(root, 'plan_production_recipe', { recipeId: 'test' })).data;
  expect(plan.steps[1].status).toBe('ready');
  const packaged = await cli(root, 'run_production_step', { recipeId: 'test', stepId: 'package', approvedFingerprint: plan.steps[1].fingerprint }, true);
  expect(packaged.data.state).toBe('complete');
  expect(packaged.data.result.packageId).toMatch(/^pkg_/);
  const finalPlan = (await cli(root, 'plan_production_recipe', { recipeId: 'test' })).data;
  expect(finalPlan.steps.map((s: { status: string }) => s.status)).toEqual(['complete', 'complete']);
}, 20_000);

it('MCP approval evidence stays scoped to the accepted paid invocation', async () => {
  const { SpendGate } = await import('../src/mcp/spend-gate.js');
  const { currentSpendApproval } = await import('../src/util/spend-approval.js');
  const accepted = new SpendGate({ mode: 'elicit', limitCents: 100, elicit: async () => true });
  const declined = new SpendGate({ mode: 'elicit', limitCents: 100, elicit: async () => false });
  let declinedCalls = 0;
  const results = await Promise.all([
    accepted.wrap('create_3d_asset', async () => {
      await Promise.resolve();
      expect(currentSpendApproval()).toMatchObject({ source: 'mcp elicitation', userApprovalVerified: true });
      return { content: [] };
    })({}),
    declined.wrap('create_3d_asset', async () => { declinedCalls += 1; return { content: [] }; })({}),
  ]);
  expect(results[1]?.isError).toBe(true);
  expect(declinedCalls).toBe(0);
  expect(currentSpendApproval()).toBeUndefined();
});
