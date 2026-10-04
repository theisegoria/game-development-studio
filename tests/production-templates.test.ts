import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecipeStore } from '../src/production/recipes.js';
import { listProductionTemplates, planProductionTemplate } from '../src/production/templates.js';
import { registerProductionTools } from '../src/tools/production.js';
import { registerInspectionTools } from '../src/tools/inspection.js';
import { registerValidateTools } from '../src/tools/validate.js';
import { registerLibraryTools } from '../src/tools/library.js';
import { registerReviewTools } from '../src/tools/review.js';
import type { LocalCommandRegistry } from '../src/commands/registry.js';
import { connectTools, type ToolClient } from './helpers/tool-harness.js';
import { writeGameReadyGlb } from './helpers/model-fixture.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'workflow with spaces ')); roots.push(root);
  const model = await writeGameReadyGlb(path.join(root, 'candidate a.glb'));
  const dispatch = vi.fn();
  const tools = await connectTools((registry, ctx) => {
    registerInspectionTools(registry, ctx); registerValidateTools(registry, ctx);
    registerLibraryTools(registry, ctx); registerReviewTools(registry, ctx);
    // This explicitly authorized test dispatcher invokes real local CPU handlers.
    registerProductionTools(registry, ctx, async (operation, args) => { dispatch(operation, args); return (registry as LocalCommandRegistry).call(operation, args); });
  }, root);
  return { root, model, tools, dispatch, request: { recipeId: 'guided', name: 'Reviewed prop', license: 'CC0-1.0', modelPath: model } };
}
async function plan(tools: ToolClient, recipeId = 'guided') {
  const response = await tools.call('plan_production_recipe', { recipeId });
  expect(response.isError).toBe(false);
  return response.payload as unknown as Awaited<ReturnType<RecipeStore['plan']>>;
}
async function execute(tools: ToolClient, stepId: string) {
  const planned = await plan(tools); const step = planned.steps.find(item => item.id === stepId)!;
  const response = await tools.call('run_production_step', { recipeId: 'guided', stepId, approvedFingerprint: step.fingerprint });
  expect(response.isError).toBe(false); expect(response.payload.state).toBe('complete'); return response.payload;
}

describe('guided production templates', () => {
  it('lists bounded free templates and rejects mismatched fields or hidden paid operations', () => {
    expect(listProductionTemplates().templates.map(template => template.id)).toEqual(['inspect-validate-package', 'review-select-package', 'platform-variants']);
    const request = { recipeId: 'asset', name: 'Asset', license: 'MIT', modelPath: '/tmp/a.glb' };
    expect(() => planProductionTemplate('inspect-validate-package', { ...request, provider: 'tripo' })).toThrow();
    expect(() => planProductionTemplate('inspect-validate-package', { ...request, policy: { maxTriangles: 0 } })).toThrow();
    expect(() => planProductionTemplate('inspect-validate-package', { ...request, modelPath: '/tmp/external.gltf' })).toThrow(/self-contained GLB/);
    expect(() => planProductionTemplate('review-select-package', { ...request, reviewer: 'invented approval' })).toThrow();
    expect(() => planProductionTemplate('platform-variants', request)).toThrow();
    expect(() => planProductionTemplate('unknown-template', request)).toThrow();
  });
  it('compiles without writes and executes real inspect/validate/package handlers using their returned paths', async () => {
    const { root, tools, request, dispatch } = await setup();
    const preview = await tools.call('plan_production_template', { templateId: 'inspect-validate-package', request });
    expect(preview.isError).toBe(false); expect(preview.payload.executes).toBe(false);
    await expect(fs.access(path.join(root, '.production'))).rejects.toThrow(); expect(dispatch).not.toHaveBeenCalled();
    const first = await tools.call('save_production_template', { templateId: 'inspect-validate-package', request });
    const again = await tools.call('save_production_template', { templateId: 'inspect-validate-package', request });
    expect(first.isError).toBe(false); expect(again.isError).toBe(false);
    expect((first.payload.record as { revision: number }).revision).toBe((again.payload.record as { revision: number }).revision);
    expect((await plan(tools)).steps.map(step => step.state)).toEqual(['ready', 'blocked', 'blocked']);
    await execute(tools, 'inspect'); await execute(tools, 'validate'); const packaged = await execute(tools, 'package');
    expect(dispatch.mock.calls.map(call => call[0])).toEqual(['inspect_asset', 'validate_game_asset', 'build_asset_package']);
    const result = packaged.result as { packageId: string; packagePath: string };
    expect((await tools.call('verify_asset_package', { package: result.packagePath })).isError).toBe(false);
    const current = await plan(tools); expect(current.nextStep.kind).toBe('complete');
    expect(current.steps[2]?.evidence.result).toMatchObject({ packageId: result.packageId });
    expect(current.steps[2]?.evidence.artifacts.every(artifact => artifact.verified)).toBe(true);
    const repeated = await tools.call('run_production_step', { recipeId: 'guided', stepId: 'package', approvedFingerprint: current.steps[2]!.fingerprint });
    expect(repeated.isError).toBe(true); expect(dispatch).toHaveBeenCalledTimes(3);
  });
  it('keeps human selection blocked, binds a real second candidate, and packages that exact snapshot', async () => {
    const { root, model, tools, dispatch } = await setup();
    const second = await writeGameReadyGlb(path.join(root, 'candidate b.glb'), 2);
    const request = { recipeId: 'guided', name: 'Selected prop', license: 'CC0-1.0', candidates: [{ name: 'A', modelPath: model }, { name: 'B', modelPath: second }] };
    expect((await tools.call('save_production_template', { templateId: 'review-select-package', request })).isError).toBe(false);
    await execute(tools, 'review');
    const before = await plan(tools);
    expect(before.steps.find(step => step.id === 'select')?.state).toBe('blocked');
    expect(before.nextStep).toMatchObject({ kind: 'select-candidate', stepId: 'select', requiresReview: true });
    const review = before.steps[0]!;
    const candidates = review.evidence.result!.candidates as Array<{ id: string; snapshotPath: string; sha256: string }>;
    const bind = { recipeId: 'guided', stepId: 'select', reviewedFingerprint: review.reviewedFingerprint, candidateId: candidates[1]!.id, reviewer: 'Test artist', reason: 'I inspected both saved snapshots and approve candidate B.' };
    const missing = await tools.call('run_production_step', { recipeId: 'guided', stepId: 'select', approvedFingerprint: before.steps[1]!.fingerprint });
    expect(missing.isError).toBe(true); expect(dispatch).toHaveBeenCalledTimes(1);
    expect((await tools.call('set_production_review', { ...bind, candidateId: '00000000-0000-4000-8000-000000000001' })).isError).toBe(true);
    const bound = await tools.call('set_production_review', bind); const repeatedBind = await tools.call('set_production_review', bind);
    expect(bound.isError).toBe(false); expect(repeatedBind.isError).toBe(false);
    expect((bound.payload.record as { revision: number }).revision).toBe((repeatedBind.payload.record as { revision: number }).revision);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await execute(tools, 'select');
    const validate = (await plan(tools)).steps.find(step => step.id === 'validate')!;
    expect(validate.arguments?.modelPath).toBe(candidates[1]!.snapshotPath);
    await execute(tools, 'validate'); const packaged = await execute(tools, 'package');
    expect((packaged.result as { catalog: { modelSha256: string } }).catalog.modelSha256).toBe(candidates[1]!.sha256);
    expect((await plan(tools)).steps.every(step => step.state === 'completed')).toBe(true);
    await fs.writeFile(candidates[1]!.snapshotPath, 'tampered');
    const changed = await plan(tools); expect(changed.steps.map(step => step.state)).toEqual(['invalidated', 'invalidated', 'invalidated', 'invalidated']);
    expect((await tools.call('set_production_review', bind)).isError).toBe(true);
  });
  it('invalidates nested candidate source bytes and rejects stale review selection before any decision', async () => {
    const { model, tools, request, dispatch } = await setup();
    await tools.call('save_production_template', { templateId: 'review-select-package', request });
    await execute(tools, 'review'); const reviewed = (await plan(tools)).steps[0]!;
    const candidate = (reviewed.evidence.result!.candidates as Array<{ id: string }>)[0]!;
    await writeGameReadyGlb(model, 3);
    const next = await plan(tools); expect(next.steps[0]?.state).toBe('invalidated');
    expect((await tools.call('set_production_review', { recipeId: 'guided', stepId: 'select', reviewedFingerprint: reviewed.reviewedFingerprint, candidateId: candidate.id, reviewer: 'Artist', reason: 'Old selection' })).isError).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('binds shared review settings and invalidates their completed checkpoint when the form changes', async () => {
    const { root, tools, request, dispatch } = await setup();
    const compiled = planProductionTemplate('review-select-package', { ...request, reviewSettings: { mode: 'geometry', resolution: 128, exposure: 1 } });
    expect(compiled.recipe.steps[0]?.arguments.settings).toMatchObject({ mode: 'geometry', resolution: 128, exposure: 1 });
    await tools.call('save_production_recipe', { recipe: compiled.recipe }); await execute(tools, 'review');
    const before = await plan(tools);
    const sourceStore = new RecipeStore(path.join(root, '.production', 'recipes'), 'irrelevant-read-version');
    const record = await sourceStore.read('guided');
    record.recipe.steps[0]!.arguments.settings = { mode: 'geometry', resolution: 128, exposure: 2 };
    await tools.call('save_production_recipe', { recipe: record.recipe });
    const changed = await plan(tools); expect(changed.steps[0]?.state).toBe('invalidated');
    const response = await tools.call('run_production_step', { recipeId: 'guided', stepId: 'review', approvedFingerprint: before.steps[0]!.fingerprint });
    expect(response.isError).toBe(true); expect(dispatch).toHaveBeenCalledTimes(1);
  });
  it('requires fresh human selection when the same inputs produce a new saved review', async () => {
    const { tools, request, dispatch } = await setup();
    await tools.call('save_production_template', { templateId: 'review-select-package', request }); await execute(tools, 'review');
    const original = (await plan(tools)).steps[0]!;
    const originalCandidate = (original.evidence.result!.candidates as Array<{ id: string }>)[0]!;
    const binding = { recipeId: 'guided', stepId: 'select', reviewedFingerprint: original.reviewedFingerprint, candidateId: originalCandidate.id, reviewer: 'Artist', reason: 'I approve the current saved snapshot.' };
    expect((await tools.call('set_production_review', binding)).isError).toBe(false);
    await fs.writeFile(original.evidence.result!.dashboardPath as string, 'modified dashboard');
    await execute(tools, 'review');
    const regenerated = await plan(tools); const current = regenerated.steps[0]!;
    expect(current.fingerprint).toBe(original.fingerprint);
    expect(current.reviewedFingerprint).not.toBe(original.reviewedFingerprint);
    expect(regenerated.steps[1]?.state).toBe('blocked');
    expect(regenerated.nextStep).toMatchObject({ kind: 'select-candidate', reviewedFingerprint: current.reviewedFingerprint });
    const newCandidate = (current.evidence.result!.candidates as Array<{ id: string }>)[0]!;
    expect((await tools.call('set_production_review', { ...binding, candidateId: newCandidate.id })).isError).toBe(true);
    expect((await tools.call('set_production_review', { ...binding, candidateId: newCandidate.id, reviewedFingerprint: current.reviewedFingerprint })).isError).toBe(false);
    expect(dispatch.mock.calls.map(call => call[0])).toEqual(['create_asset_review', 'create_asset_review']);
  });
  it('invalidates changed sealed appearance pixels before candidate selection and allows a fresh render', async () => {
    const { tools, request, dispatch } = await setup();
    await tools.call('save_production_template', { templateId: 'review-select-package', request: { ...request, reviewSettings: { mode: 'appearance', resolution: 128 } } });
    await execute(tools, 'review');
    const reviewed = (await plan(tools)).steps[0]!;
    const candidate = (reviewed.evidence.result!.candidates as Array<{ id: string; previewRunPath: string }>)[0]!;
    expect(reviewed.evidence.artifacts.some(artifact => artifact.path === candidate.previewRunPath)).toBe(true);
    await fs.appendFile(path.join(candidate.previewRunPath, 'angle-0.png'), 'changed sealed pixels');
    const changed = await plan(tools);
    expect(changed.steps[0]?.state).toBe('invalidated');
    expect((await tools.call('set_production_review', { recipeId: 'guided', stepId: 'select', reviewedFingerprint: reviewed.reviewedFingerprint, candidateId: candidate.id, reviewer: 'Test artist', reason: 'Old appearance selection' })).isError).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    await execute(tools, 'review');
    const current = (await plan(tools)).steps[0]!;
    expect(current.evidence.verified).toBe(true);
    expect(current.reviewedFingerprint).not.toBe(reviewed.reviewedFingerprint);
    expect(dispatch).toHaveBeenCalledTimes(2);
  });
  it('compiles platform budgets through the shipped planner and declares required tooling', () => {
    const compiled = planProductionTemplate('platform-variants', { recipeId: 'mobile', name: 'Prop', license: 'MIT', modelPath: '/tmp/prop.glb', variants: [{ id: 'mobile', lodTriangles: [2000, 1000], maxMaterials: 4, maxTextureSize: 1024, textureMode: 'compress', collision: 'convex' }] });
    expect(compiled.recipe.steps.filter(step => step.operation === 'build_asset_package')).toHaveLength(2);
    expect(compiled.requiredTools).toContain('Blender'); expect(compiled.requiredTools).toContain('Pinned CPU Basis Universal');
    expect(compiled.dependencyAvailabilityChecked).toBe(false); expect(compiled.executes).toBe(false);
    expect(compiled.recipe.steps.find(step => step.operation === 'compress_texture_variant')?.arguments.modelPath).toEqual({ $step: 'v0_lod0_normalize', field: 'outputPath' });
  });
});
