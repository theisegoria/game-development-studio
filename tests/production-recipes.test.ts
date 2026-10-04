import { mkdtemp, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecipeStore, validateRecipe, fileDigest, type Recipe } from '../src/production/recipes.js';
import { FamilyStore } from '../src/production/families.js';
import { planPlatform, prepareCollisionBox, validatePlatformAsset } from '../src/production/platform.js';
import { ok } from '../src/tools/context.js';
import { writeGameReadyGlb } from './helpers/model-fixture.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
async function setup() { const root = await mkdtemp(path.join(os.tmpdir(), 'recipes-')); roots.push(root); return { root, store: new RecipeStore(path.join(root, 'recipes'), 'test-v1') }; }
const recipe = (file: string): Recipe => ({ schema: 'game_dev.production_recipe.v1', id: 'test', name: 'Test', steps: [
  { id: 'validate', operation: 'validate_game_asset', arguments: { modelPath: file }, files: [], dependsOn: [] },
  { id: 'package', operation: 'build_asset_package', arguments: { modelPath: file, name: 'Test' }, files: [], dependsOn: ['validate'] },
] });
async function run(store: RecipeStore, id: string, step: string, dispatch = vi.fn(async () => ok({ passed: true }))) {
  const planned = (await store.plan(id)).steps.find(s => s.id === step);
  return store.run(id, step, planned?.fingerprint ?? '', dispatch);
}
describe('production recipes', () => {
  it('checkpoints successful steps, blocks failed validation, invalidates edited inputs and descendants', async () => {
    const { root, store } = await setup(); const source = path.join(root, 'asset.bin'); await writeFile(source, 'a'); await store.save(recipe(source));
    expect((await store.plan('test')).steps[1]?.status).toBe('blocked');
    await run(store, 'test', 'validate', vi.fn(async () => ok({ passed: false })));
    expect((await store.plan('test')).steps[1]?.status).toBe('blocked');
    await run(store, 'test', 'validate'); await run(store, 'test', 'package');
    expect((await store.plan('test')).steps.map(s => s.status)).toEqual(['complete', 'complete']);
    await writeFile(source, 'changed');
    expect((await store.plan('test')).steps.map(s => s.status)).toEqual(['ready', 'blocked']);
  });
  it('rejects stale approvals and reexecution, verifies output bytes and tool version', async () => {
    const { root, store } = await setup(); const source = path.join(root, 'a.bin'); const output = path.join(root, 'out.bin'); await writeFile(source, 'a'); await writeFile(output, 'out'); await store.save(recipe(source));
    const plan = await store.plan('test'); await writeFile(source, 'b');
    const call = vi.fn(async () => ok({ passed: true, outputPath: output }));
    await expect(store.run('test', 'validate', plan.steps[0]!.fingerprint!, call)).rejects.toThrow(/approval/); expect(call).not.toHaveBeenCalled();
    await run(store, 'test', 'validate', call); expect((await store.plan('test')).steps[0]?.status).toBe('complete');
    await writeFile(output, 'tampered'); expect((await store.plan('test')).steps[0]?.status).toBe('ready');
    await run(store, 'test', 'validate');
    const upgraded = new RecipeStore(store.root, 'test-v2'); expect((await upgraded.plan('test')).steps[0]?.status).toBe('ready');
  });
  it('serializes concurrent runners and refuses uncertain paid re-submission', async () => {
    const { store } = await setup(); await store.save({ schema: 'game_dev.production_recipe.v1', id: 'paid', name: 'Paid', steps: [{ id: 'generate', operation: 'create_3d_asset', arguments: {}, files: [], dependsOn: [] }] });
    const fingerprint = (await store.plan('paid')).steps[0]!.fingerprint!;
    const dispatch = vi.fn(async () => { throw Error('lost response'); });
    const outcomes = await Promise.allSettled([store.run('paid', 'generate', fingerprint, dispatch), store.run('paid', 'generate', fingerprint, dispatch)]);
    expect(outcomes.filter(o => o.status === 'fulfilled')).toHaveLength(1); expect(dispatch).toHaveBeenCalledTimes(1);
    expect((await store.plan('paid')).steps[0]?.status).toBe('uncertain');
    await expect(store.run('paid', 'generate', fingerprint, dispatch)).rejects.toThrow(/not ready/);
    await store.reconcileNotSubmitted('paid', 'generate', 'Provider and local job audit confirms no request sent.');
    expect((await store.plan('paid')).steps[0]?.status).toBe('ready');
  });
  it('resumes a complete generate/download/normalize/package graph without resubmitting or hashing mutable workspaces', async () => {
    const { root, store } = await setup();
    const input = JSON.parse(await readFile(new URL('../docs/examples/production-recipes/text-to-package.json', import.meta.url), 'utf8'));
    await store.save(input.recipe);
    const model = path.join(root, 'download.glb'); const normalized = path.join(root, 'normalized.glb');
    const dispatched: string[] = []; let polls = 0;
    const dispatch = vi.fn(async (operation: string) => {
      dispatched.push(operation);
      if (operation === 'create_3d_asset') return ok({ assetJobId: 'existing_job', status: 'generating_3d', workspacePath: root });
      if (operation === 'get_asset_job') return ok({ assetJobId: 'existing_job', status: ++polls === 1 ? 'processing' : 'ready' });
      if (operation === 'download_asset') { await writeGameReadyGlb(model); return ok({ modelPath: model, workspacePath: root }); }
      if (operation === 'normalize_mesh') { await writeGameReadyGlb(normalized); return ok({ outputPath: normalized }); }
      return ok({ passed: true });
    });
    for (const step of ['generate', 'wait', 'wait', 'download', 'normalize', 'validate', 'package']) {
      const plan = await store.plan('text_prop_v1');
      await store.run('text_prop_v1', step, plan.steps.find(s => s.id === step)!.fingerprint!, dispatch);
    }
    expect(dispatched.filter(s => s === 'create_3d_asset')).toHaveLength(1);
    expect((await store.plan('text_prop_v1')).steps.every(s => s.status === 'complete')).toBe(true);
    await writeFile(path.join(root, 'unrelated-derived-output.bin'), 'new');
    expect((await store.plan('text_prop_v1')).steps.every(s => s.status === 'complete')).toBe(true);
  });
  it('invalidates external glTF buffer edits and tool identity changes', async () => {
    const { root } = await setup(); let identity = 'blender-a';
    const store = new RecipeStore(path.join(root, 'recipes'), 'test', async () => identity);
    const model = path.join(root, 'mesh.gltf'); const buffer = path.join(root, 'data.bin');
    await writeFile(model, JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'data.bin' }] })); await writeFile(buffer, 'a');
    await store.save(recipe(model)); await run(store, 'test', 'validate');
    expect((await store.plan('test')).steps[0]?.status).toBe('complete');
    await writeFile(buffer, 'b'); expect((await store.plan('test')).steps[0]?.status).toBe('ready');
    await run(store, 'test', 'validate'); identity = 'blender-b'; expect((await store.plan('test')).steps[0]?.status).toBe('ready');
  });
  it('rejects corrupt records, cycles, forbidden operations, and undeclared references', async () => {
    const { root, store } = await setup(); await writeFile(path.join(root, 'a'), 'a'); await store.save(recipe(path.join(root, 'a')));
    await writeFile(path.join(store.root, 'test.json'), '{'); await expect(store.save(recipe('x'))).rejects.toThrow();
    expect(() => validateRecipe({ ...recipe('x'), steps: [{ id: 'a', operation: 'normalize_mesh', dependsOn: ['a'], arguments: {} }] })).toThrow();
    expect(() => validateRecipe({ ...recipe('x'), steps: [{ id: 'a', operation: 'run_production_step', arguments: {} }] })).toThrow();
    expect(() => validateRecipe({ ...recipe('x'), steps: [{ id: 'a', operation: 'normalize_mesh', arguments: { modelPath: { $step: 'missing', field: 'outputPath' } } }] })).toThrow();
  });
  it('family expansion requires completed reviewed sample and invalidates changed sample bytes', async () => {
    const { root, store } = await setup(); const file = path.join(root, 'a'); await writeFile(file, 'a'); const families = new FamilyStore(path.join(root, 'families'), store);
    await families.create({ schema: 'game_dev.asset_family.v1', id: 'family', style: 'painted', palette: ['blue'], scaleMeters: 1, namingPrefix: 'prop', members: [{ id: 'sample', description: 'sample' }, { id: 'chair', description: 'chair' }], template: recipe(file) });
    await expect(families.expand('family')).rejects.toThrow();
    await run(store, 'family_sample', 'validate'); await run(store, 'family_sample', 'package');
    const approval = await families.planApproval('family'); await families.approve('family', approval.approvalDigest, 'Test reviewer');
    expect((await families.expand('family')).recipes).toHaveLength(1);
    expect((await families.expand('family')).recipes[0]?.name).toBe('prop_chair');
    await writeFile(file, 'changed'); await expect(families.expand('family')).rejects.toThrow(/Sample/);
  });
  it('refuses replacing a family sample with a different completed graph', async () => {
    const { root, store } = await setup(); const file = path.join(root, 'asset.bin'); await writeFile(file, 'a');
    const families = new FamilyStore(path.join(root, 'families'), store);
    await families.create({ schema: 'game_dev.asset_family.v1', id: 'family', style: 'painted', palette: ['blue'], scaleMeters: 1, namingPrefix: 'prop', members: [{ id: 'sample', description: 'sample' }, { id: 'chair', description: 'chair' }], template: recipe(file) });
    const sample = (await store.read('family_sample')).recipe;
    sample.steps = [sample.steps[0]!]; await store.save(sample); await run(store, 'family_sample', 'validate');
    await expect(families.planApproval('family')).rejects.toThrow(/template/);
  });
  it('does not complete a package checkpoint with nested failed validation', async () => {
    const { root, store } = await setup(); const file = path.join(root, 'a'); await writeFile(file, 'a'); await store.save(recipe(file));
    await run(store, 'test', 'validate');
    const outcome = await run(store, 'test', 'package', vi.fn(async () => ok({ validation: { passed: false } })));
    expect(outcome.state).toBe('failed'); expect((await store.plan('test')).steps[1]?.status).toBe('ready');
  });
  it('uses independently framed dependency hashes rather than concatenated resource bytes', async () => {
    const { root } = await setup(); const model = path.join(root, 'mesh.gltf');
    await writeFile(model, JSON.stringify({ asset: { version: '2.0' }, buffers: [{ uri: 'a.bin' }, { uri: 'b.bin' }] }));
    await writeFile(path.join(root, 'a.bin'), 'AB'); await writeFile(path.join(root, 'b.bin'), 'C'); const before = await fileDigest(model);
    await writeFile(path.join(root, 'a.bin'), 'A'); await writeFile(path.join(root, 'b.bin'), 'BC'); expect(await fileDigest(model)).not.toBe(before);
  });
  it('hashes external GLB resources and refuses symlink resources', async () => {
    const { root } = await setup(); const model = path.join(root, 'external.glb'); const image = path.join(root, 'texture.bin');
    const text = JSON.stringify({ asset: { version: '2.0' }, images: [{ uri: 'texture.bin' }] });
    const json = Buffer.from(text.padEnd(Math.ceil(text.length / 4) * 4));
    const header = Buffer.alloc(20); header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + json.length, 8); header.writeUInt32LE(json.length, 12); header.writeUInt32LE(0x4e4f534a, 16);
    await writeFile(model, Buffer.concat([header, json])); await writeFile(image, 'a'); const before = await fileDigest(model);
    await writeFile(image, 'b'); expect(await fileDigest(model)).not.toBe(before);
    const other = path.join(root, 'other.bin'); await writeFile(other, 'c'); await rm(image); await symlink(other, image);
    await expect(fileDigest(model)).rejects.toThrow(/symlink/);
  });
  it('plans executable standalone variants and creates measured collision geometry with no Blender', async () => {
    const { root } = await setup(); const model = await writeGameReadyGlb(path.join(root, 'source.glb'));
    const plan = planPlatform({ schema: 'game_dev.platform_recipe.v1', id: 'mobile', name: 'Prop', modelPath: model, license: 'CC0-1.0', variants: [{ id: 'low', lodTriangles: [2000, 1000], maxMaterials: 4, maxTextureSize: 2048, collision: 'box' }] });
    expect(plan.executable).toBe(true); expect(plan.recipe.steps.filter(s => s.operation === 'build_asset_package')).toHaveLength(2); validateRecipe(plan.recipe);
    const result = await prepareCollisionBox(model, path.join(root, 'collisions')); expect(result.engineVerified).toBe(false); expect((await readFile(result.outputPath, 'utf8')).match(/^v /gm)).toHaveLength(8);
    expect((await validatePlatformAsset({ modelPath: model, maxTriangles: 1000, maxMaterials: 4, maxTextureSize: 2048 })).passed).toBe(true);
    const prepared = planPlatform({ schema: 'game_dev.platform_recipe.v1', id: 'x', name: 'X', modelPath: model, license: 'MIT', variants: [{ id: 'x', lodTriangles: [1], maxMaterials: 1, maxTextureSize: 1, collision: 'convex', textureMode: 'compress' }] });
    expect(prepared.unavailable).toHaveLength(0); validateRecipe(prepared.recipe);
    const convex = prepared.recipe.steps.find(step => step.operation === 'decompose_collision_mesh')!;
    expect(convex.arguments.modelPath).toEqual({ $step: 'v0_lod0_normalize', field: 'outputPath' });
    expect(convex.dependsOn).toEqual(['v0_lod0_normalize']);
    expect(prepared.dependencyAvailabilityChecked).toBe(false);
    expect(prepared.requiredTools).toContain('Isolated pinned CoACD Python environment');
  });
  it('explains changed inputs and descendants with evidence without silently rerunning completed steps', async () => {
    const { root, store } = await setup(); const file = path.join(root, 'source.bin'); await writeFile(file, 'source'); await store.save(recipe(file));
    await run(store, 'test', 'validate'); await run(store, 'test', 'package');
    const completed = await store.plan('test');
    expect(completed.steps.map(step => step.state)).toEqual(['completed', 'completed']);
    expect(completed.nextStep.kind).toBe('complete');
    expect(completed.edges).toEqual([{ from: 'validate', to: 'package' }]);
    await writeFile(file, 'changed');
    const stale = await store.plan('test');
    expect(stale.steps.map(step => step.state)).toEqual(['invalidated', 'invalidated']);
    expect(stale.steps[0]?.reasons.join(' ')).toMatch(/changed since completion/);
    expect(stale.steps[1]?.reasons.join(' ')).toMatch(/Dependency validate is invalidated/);
    expect(stale.steps[0]?.evidence.verified).toBe(false);
    expect(stale.nextStep).toMatchObject({ kind: 'review-step', stepId: 'validate', requiresReview: true });
    await expect(store.run('test', 'validate', completed.steps[0]!.fingerprint!, vi.fn())).rejects.toThrow(/approval/);
  });
  it('preserves v1 historical checkpoints and surfaces interrupted removed steps until explicit reconciliation', async () => {
    const { root, store } = await setup(); const file = path.join(root, 'a.bin'); await writeFile(file, 'a'); await store.save(recipe(file));
    await run(store, 'test', 'validate'); await run(store, 'test', 'package');
    const old = await store.read('test'); old.recipe.steps = [old.recipe.steps[0]!];
    await writeFile(path.join(store.root, 'test.json'), JSON.stringify(old));
    expect((await store.read('test')).checkpoints.package?.state).toBe('complete');
    expect((await store.plan('test')).historicalCheckpoints[0]?.stepId).toBe('package');
    old.checkpoints.package!.state = 'running';
    await writeFile(path.join(store.root, 'test.json'), JSON.stringify(old));
    expect((await store.plan('test')).nextStep).toMatchObject({ kind: 'reconcile', stepId: 'package' });
    await expect(store.save({ ...old.recipe, name: 'Changed' })).rejects.toThrow(/uncertain/);
    await store.reconcileNotSubmitted('test', 'package', 'Local filesystem audit proves packaging never started.');
    const updated = await store.save({ ...old.recipe, name: 'Changed' });
    expect(updated.checkpoints.package).toBeUndefined();
  });
  it('keeps repeated saves idempotent and recovers a crashed local lock without resubmission', async () => {
    const { store } = await setup(); const input = { schema: 'game_dev.production_recipe.v1', id: 'interrupted', name: 'Interrupted', steps: [{ id: 'generate', operation: 'create_3d_asset', arguments: {} }] };
    const saved = await store.save(input); expect((await store.save(input)).revision).toBe(saved.revision);
    const call = vi.fn(async () => { throw Error('connection ended after dispatch'); });
    await run(store, 'interrupted', 'generate', call);
    expect((await store.save(input)).checkpoints.generate?.state).toBe('uncertain');
    const lock = path.join(store.root, 'interrupted.json.lock');
    await writeFile(lock, JSON.stringify({ pid: process.pid, host: os.hostname() }));
    await expect(store.recoverLock('interrupted')).rejects.toThrow(/still running/);
    await writeFile(lock, JSON.stringify({ pid: 2147483647, host: 'different-host' }));
    await expect(store.recoverLock('interrupted')).rejects.toThrow(/another host/);
    await writeFile(lock, JSON.stringify({ pid: 2147483647, host: os.hostname() }));
    expect(await store.recoverLock('interrupted')).toMatchObject({ recovered: true });
    const planned = await store.plan('interrupted');
    expect(planned.nextStep.kind).toBe('reconcile');
    await expect(store.run('interrupted', 'generate', planned.steps[0]!.fingerprint!, call)).rejects.toThrow(/not ready/);
    expect(call).toHaveBeenCalledTimes(1);
  });
  it('refuses malformed checkpoint evidence and retains the exact corrupt record', async () => {
    const { root, store } = await setup(); const file = path.join(root, 'a'); await writeFile(file, 'a'); await store.save(recipe(file));
    const saved = await store.read('test');
    const malformed = JSON.stringify({ ...saved, checkpoints: { validate: { state: 'complete', fingerprint: 'not-a-hash', artifacts: [] } } });
    const target = path.join(store.root, 'test.json'); await writeFile(target, malformed);
    await expect(store.plan('test')).rejects.toThrow();
    await expect(store.save(recipe(file))).rejects.toThrow();
    expect(await readFile(target, 'utf8')).toBe(malformed);
  });
});
