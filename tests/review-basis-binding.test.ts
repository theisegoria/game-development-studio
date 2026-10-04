import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach, expect, test, vi } from 'vitest';
import { BASIS_COMMIT, BASIS_VERSION } from '../src/production/basis.js';
import { configureTool } from '../src/installation/tool-config.js';
import { basisReviewEvidenceSchema } from '../src/review/basis-binding.js';
import { createAssetReview, decideAssetReview, packageReviewedAsset } from '../src/review/workspace.js';
import { verifyRunBundle } from '../src/harness/run-bundle.js';
import { registerProductionTools } from '../src/tools/production.js';
import { RecipeStore } from '../src/production/recipes.js';
import { connectTools } from './helpers/tool-harness.js';
import { writeGameReadyGlb } from './helpers/model-fixture.js';

const roots: string[] = [];
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'basis review binding ')); roots.push(root);
  const modelPath = await writeGameReadyGlb(path.join(root, 'candidate.glb'));
  const executable = path.join(root, process.platform === 'win32' ? 'basisu.exe' : 'basisu');
  await fs.writeFile(executable, 'test identity bytes; this file must never execute', { mode: 0o700 });
  const identity = { path: executable, sha256: createHash('sha256').update(await fs.readFile(executable)).digest('hex'), supportedVersion: BASIS_VERSION, upstreamCommit: BASIS_COMMIT };
  const runner = vi.fn(async () => { throw new Error('PNG review and approval must not invoke Basis'); });
  return { root, modelPath, executable, identity, runner };
}

test('opt-in PNG reviews seal a zero-process decoder profile and approval checks it without launching', async () => {
  const f = await fixture();
  const session = await createAssetReview(f.root, [{ name: 'PNG candidate', modelPath: f.modelPath }], { mode: 'appearance', resolution: 128, decodeBasisTextures: true }, f);
  const candidate = session.candidates[0]!;
  expect(candidate.basisDecode).toMatchObject({ processCount: 0, textures: [], decoder: { sha256: f.identity.sha256 } });
  const run = await verifyRunBundle(candidate.previewRunPath!);
  const binding = JSON.parse(await fs.readFile(path.join(run.runPath, 'source-binding.json'), 'utf8'));
  expect(binding.basisDecode).toEqual(candidate.basisDecode);
  expect(run.manifest.evidence.commandExecuted).toBe(false);
  expect(run.manifest.evidence.evidenceCeiling).toContain('No Basis decoder subprocess ran');
  const args = { sessionId: session.id, candidateId: candidate.id, decision: 'approve' as const, reviewer: 'Test artist', reason: 'Inspected saved PNG appearance' };
  await decideAssetReview(f.root, args, f);
  expect(f.runner).not.toHaveBeenCalled();
  await fs.writeFile(f.executable, 'changed tool bytes');
  await expect(decideAssetReview(f.root, args, f)).rejects.toThrow('identity changed');
  expect(f.runner).not.toHaveBeenCalled();
});

test('a different configured decoder invalidates approval and packaging even for unchanged PNG pixels', async () => {
  const f = await fixture();
  const configuration = path.join(f.root, 'tools.json'); vi.stubEnv('GAME_DEV_TOOL_CONFIG_PATH', configuration);
  vi.stubEnv('GAME_DEV_BASISU_PATH', ''); vi.stubEnv('GAME_DEV_BASISU_SHA256', '');
  await configureTool({ tool: 'basisu', executablePath: f.executable });
  const session = await createAssetReview(f.root, [{ name: 'Candidate', modelPath: f.modelPath }], { mode: 'appearance', resolution: 128, decodeBasisTextures: true }, f);
  const args = { sessionId: session.id, candidateId: session.candidates[0]!.id, decision: 'approve' as const, reviewer: 'Artist', reason: 'Inspected appearance' };
  const decision = await decideAssetReview(f.root, args, f);
  await fs.writeFile(f.executable, 'new verified Basis fixture bytes');
  await configureTool({ tool: 'basisu', executablePath: f.executable });
  await expect(decideAssetReview(f.root, args)).rejects.toThrow('decoder changed');
  const options = { decisionId: decision.id, packagesRoot: path.join(f.root, 'packages'), catalogPath: path.join(f.root, 'catalog.sqlite'), name: 'Reviewed', license: 'CC0-1.0' };
  await expect(packageReviewedAsset(f.root, options)).rejects.toThrow('decoder changed');
  await expect(fs.access(options.packagesRoot)).rejects.toThrow();
  expect(f.runner).not.toHaveBeenCalled();
});

test('current records require explicit opt-in fields; old renderer records remain readable and demand fresh review', async () => {
  const f = await fixture();
  const session = await createAssetReview(f.root, [{ name: 'Historical candidate', modelPath: f.modelPath }]);
  const file = path.join(f.root, 'reviews', `${session.id}.json`), record = JSON.parse(await fs.readFile(file, 'utf8'));
  const args = { sessionId: session.id, candidateId: session.candidates[0]!.id, decision: 'approve' as const, reviewer: 'Artist', reason: 'Historical review' };
  delete record.settings.decodeBasisTextures;
  await fs.writeFile(file, JSON.stringify(record));
  await expect(decideAssetReview(f.root, args)).rejects.toThrow('explicit Basis decode setting');
  record.renderer.version = '2.1.0';
  await fs.writeFile(file, JSON.stringify(record));
  await expect(decideAssetReview(f.root, args)).rejects.toThrow('renderer changed');
});

test('receipt schema refuses forged process counts, duplicate indices and decoded mip byte amplification', () => {
  const decoder = { sha256: 'a'.repeat(64), supportedVersion: BASIS_VERSION, upstreamCommit: BASIS_COMMIT, output: 'rgba32-dx10-dds-v1' };
  const texture = { imageIndex: 0, sourceSha256: 'b'.repeat(64), decodedSha256: 'c'.repeat(64), width: 4, height: 4, levels: 3, codec: 'uastc', transfer: 'linear', decodedBytes: 84 };
  const receipt = { schema: 'gds.review.basis_decode.v1', processCount: 2, decoder, textures: [texture] };
  expect(basisReviewEvidenceSchema.parse(receipt)).toEqual(receipt);
  for (const invalid of [{ ...receipt, processCount: 0 }, { ...receipt, textures: [texture, texture], processCount: 3 }, { ...receipt, textures: [{ ...texture, decodedBytes: 85 }] }]) expect(() => basisReviewEvidenceSchema.parse(invalid)).toThrow();
});

test('recipe planning resolves Basis only for explicit appearance opt-in and changing its selection rejects stale authorization', async () => {
  const f = await fixture();
  vi.stubEnv('GAME_DEV_TOOL_CONFIG_PATH', path.join(f.root, 'tools.json'));
  vi.stubEnv('GAME_DEV_BASISU_PATH', ''); vi.stubEnv('GAME_DEV_BASISU_SHA256', '');
  const dispatch = vi.fn(async () => { throw new Error('Stale authorization must not dispatch a review'); });
  const tools = await connectTools((registry, ctx) => registerProductionTools(registry, ctx, dispatch), f.root);
  const request = { recipeId: 'basis-review', name: 'Reviewed', license: 'CC0-1.0', modelPath: f.modelPath, reviewSettings: { mode: 'appearance', resolution: 128 } };
  expect((await tools.call('save_production_template', { templateId: 'review-select-package', request })).isError).toBe(false);
  const store = new RecipeStore(path.join(f.root, '.production', 'recipes'), 'read-only');
  const recipe = (await store.read(request.recipeId)).recipe;
  recipe.steps[0]!.arguments.settings = { ...request.reviewSettings, decodeBasisTextures: true };
  expect((await tools.call('save_production_recipe', { recipe })).isError).toBe(false);
  let plan = (await tools.call('plan_production_recipe', { recipeId: request.recipeId })).payload as unknown as Awaited<ReturnType<RecipeStore['plan']>>;
  expect(plan.steps[0]?.state).toBe('blocked'); expect(plan.steps[0]?.reasons.join(' ')).toContain('verified Basis configuration');
  await configureTool({ tool: 'basisu', executablePath: f.executable });
  plan = (await tools.call('plan_production_recipe', { recipeId: request.recipeId })).payload as unknown as Awaited<ReturnType<RecipeStore['plan']>>;
  expect(plan.steps[0]?.state).toBe('ready'); const fingerprint = plan.steps[0]!.fingerprint!;
  await fs.writeFile(f.executable, 'new identity'); await configureTool({ tool: 'basisu', executablePath: f.executable });
  const changed = (await tools.call('plan_production_recipe', { recipeId: request.recipeId })).payload as unknown as Awaited<ReturnType<RecipeStore['plan']>>;
  expect(changed.steps[0]?.fingerprint).not.toBe(fingerprint);
  expect((await tools.call('run_production_step', { recipeId: request.recipeId, stepId: 'review', approvedFingerprint: fingerprint })).isError).toBe(true);
  expect(dispatch).not.toHaveBeenCalled(); expect(f.runner).not.toHaveBeenCalled();
});
