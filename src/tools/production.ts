import path from 'node:path';
import { packagedScript } from '../util/blender.js';
import { GAME_DEV_VERSION } from '../version.js';
import { z } from 'zod';
import type { ToolRegistrar } from '../commands/registry.js';
import { invalidState } from '../util/errors.js';
import { RecipeStore, recipeSchema, fileDigest, type RecipeDispatch } from '../production/recipes.js';
import { compressTextureVariant } from '../production/compression.js';
import { diagnoseTextureCompression } from '../production/basis.js';
import { prepareTextureVariant } from '../production/textures.js';
import { FamilyStore, familySchema } from '../production/families.js';
import { planPlatform, platformSchema, prepareCollisionBox, validatePlatformAsset } from '../production/platform.js';
import { guard, ok, type ToolContext } from './context.js';
import { coacdScript } from '../collision/process.js';
import { coacdEnvironmentIdentitySHA256 } from '../collision/identity.js';
import { listProductionTemplates, planProductionTemplate, productionTemplateIdSchema, productionTemplateRequestSchema } from '../production/templates.js';
import { toolOperationIdentity } from '../installation/tool-config.js';
import { REVIEW_RENDERER, reviewSettingsSchema } from '../review/settings.js';

/** Caller supplies dispatch through its current authorization boundary; never raw registry.call. */
export function registerProductionTools(server: ToolRegistrar, ctx: ToolContext, dispatch?: RecipeDispatch): void {
  const recipes = new RecipeStore(path.join(ctx.config.outputDir, '.production', 'recipes'), `${GAME_DEV_VERSION}:production-v1`, async (operation,args) => {
    if (operation === 'create_asset_review') {
      const settings=reviewSettingsSchema.parse(args.settings??{});
      if(!settings.decodeBasisTextures) return { renderer: REVIEW_RENDERER, defaultSettings: reviewSettingsSchema.parse({}) };
      // Read-only diagnosis hashes configured bytes; planning never invokes the decoder.
      const diagnostic=await diagnoseTextureCompression();
      if(!diagnostic.available) throw invalidState('Opted-in compressed appearance review requires verified Basis configuration; run diagnose_texture_compression.');
      return {renderer:REVIEW_RENDERER,defaultSettings:reviewSettingsSchema.parse({}),diagnostic};
    }
    const configured = toolOperationIdentity(operation);
    if (configured && !configured.available) throw invalidState(`Required ${configured.tool} is unavailable (${configured.code}); inspect optional-tool configuration before authorizing this step.`);
    if (operation === 'compress_texture_variant') {
      const diagnostic = await diagnoseTextureCompression();
      if (!diagnostic.available) throw invalidState('Pinned CPU texture compression is unavailable; run diagnose_texture_compression.');
      return { configured, diagnostic };
    }
    if (operation === 'decompose_collision_mesh') {
      // Fingerprinting must not start even the diagnostic Python process.
      return {
        configured,
        wrapperSHA256: await fileDigest(coacdScript),
        venvSHA256: await coacdEnvironmentIdentitySHA256(configured?.identity),
      };
    }
    if (operation !== 'normalize_mesh') return null;
    return { configured, script: await fileDigest(packagedScript('blender_normalize.py')) };
  });
  const families = new FamilyStore(path.join(ctx.config.outputDir, '.production', 'families'), recipes);
  const annotation = (readOnly: boolean) => ({ readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: false });
  server.registerTool('list_production_templates', { description: 'List typed guided workflows for local inspection, explicit candidate review and platform variants. Does not save or execute anything.', inputSchema: {}, annotations: annotation(true) }, guard(ctx.logger, 'list_production_templates', async () => ok(listProductionTemplates())));
  const templateInput = { templateId: productionTemplateIdSchema, request: productionTemplateRequestSchema };
  server.registerTool('plan_production_template', { description: 'Compile a typed workflow form into an advanced recipe graph without saving or executing it. Human candidate selection remains blocked until actual review evidence exists.', inputSchema: templateInput, annotations: annotation(true) }, guard(ctx.logger, 'plan_production_template', async args => ok(planProductionTemplate(args.templateId, args.request))));
  server.registerTool('save_production_template', { description: 'Save a typed guided workflow. Does not execute steps, launch tools or approve a candidate. Each current step still requires separate fingerprint and transport approval.', inputSchema: templateInput, annotations: annotation(false) }, guard(ctx.logger, 'save_production_template', async args => {
    const compiled = planProductionTemplate(args.templateId, args.request);
    const record = await recipes.save(compiled.recipe);
    return ok({ ...compiled, record, plan: await recipes.plan(record.recipe.id) });
  }));
  server.registerTool('set_production_review', { description: 'Bind an explicit human approval selection to a candidate ID from unchanged completed review evidence. Persists reviewer and reason but does not execute the decision or package. Plan and authorize the selection step separately.', inputSchema: { recipeId: z.string(), stepId: z.string(), reviewedFingerprint: z.string().regex(/^[0-9a-f]{64}$/), candidateId: z.string().uuid(), reviewer: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(4000) }, annotations: annotation(false) }, guard(ctx.logger, 'set_production_review', async args => {
    const record = await recipes.bindReview(args.recipeId, args.stepId, args.reviewedFingerprint, args.candidateId, args.reviewer, args.reason);
    return ok({ record, plan: await recipes.plan(record.recipe.id) });
  }));
  server.registerTool('save_production_recipe', { description: 'Persist a versioned workflow graph. Does not execute any step. Invalidates changed inputs on the next plan.', inputSchema: { recipe: recipeSchema }, annotations: annotation(false) }, guard(ctx.logger, 'save_production_recipe', async args => ok(await recipes.save(args.recipe))));
  server.registerTool('plan_production_recipe', { description: 'Inspect checkpoints, input hashes, exact next operation arguments, and current approval fingerprint. Writes nothing.', inputSchema: { recipeId: z.string() }, annotations: annotation(true) }, guard(ctx.logger, 'plan_production_recipe', async args => ok(await recipes.plan(args.recipeId))));
  server.registerTool('run_production_step', { description: 'Execute ONE ready step with matching current fingerprint. Transport separately requires fresh spend/mutation approval. Never resumes an uncertain submission automatically.', inputSchema: { recipeId: z.string(), stepId: z.string(), approvedFingerprint: z.string().length(64) }, annotations: annotation(false) }, guard(ctx.logger, 'run_production_step', async args => {
    const record = await recipes.read(args.recipeId);
    if (record.recipe.family && !record.recipe.family.sample) await families.assertApproved(record.recipe.family.id, record.recipe.family.approvalDigest);
    const invoke = dispatch ?? (ctx as ToolContext & { dispatchOperation?: RecipeDispatch }).dispatchOperation;
    if (!invoke) throw invalidState('APPROVAL_REQUIRED: this caller must provide a per-operation authorization dispatcher.');
    return ok(await recipes.run(args.recipeId, args.stepId, args.approvedFingerprint, invoke));
  }));
  server.registerTool('recover_production_lock', { description: 'Explicitly recover a lock only when its recorded local owner process no longer exists. Interrupted operations remain uncertain.', inputSchema: { recipeId: z.string() }, annotations: annotation(false) }, guard(ctx.logger, 'recover_production_lock', async args => ok(await recipes.recoverLock(args.recipeId))));
  server.registerTool('reconcile_production_step', { description: 'Record operator evidence that an uncertain operation was NOT submitted. Never fabricates completion. If submitted, inspect its durable job; do not authorize resubmission.', inputSchema: { recipeId: z.string(), stepId: z.string(), nonSubmissionEvidence: z.string().min(12) }, annotations: annotation(false) }, guard(ctx.logger, 'reconcile_production_step', async args => ok(await recipes.reconcileNotSubmitted(args.recipeId, args.stepId, args.nonSubmissionEvidence))));
  server.registerTool('create_asset_family', { description: 'Persist shared style/palette/scale/naming and a template. Creates only the first sample recipe; requires validation and packaging before sample approval.', inputSchema: { family: familySchema }, annotations: annotation(false) }, guard(ctx.logger, 'create_asset_family', async args => ok(await families.create(args.family))));
  server.registerTool('plan_family_approval', { description: 'Return completed sample evidence and digest for visual review. No automatic artistic quality judgment.', inputSchema: { familyId: z.string() }, annotations: annotation(true) }, guard(ctx.logger, 'plan_family_approval', async args => ok(await families.planApproval(args.familyId))));
  server.registerTool('approve_family_sample', { description: 'Record a human sample review bound to its current bytes and family recipe. Does not grant spend authorization.', inputSchema: { familyId: z.string(), approvedDigest: z.string().length(64), reviewer: z.string().min(1).max(200) }, annotations: annotation(false) }, guard(ctx.logger, 'approve_family_sample', async args => ok(await families.approve(args.familyId, args.approvedDigest, args.reviewer))));
  server.registerTool('expand_asset_family', { description: 'Create remaining member recipes only after current sample approval. No provider calls; each member operation needs fresh authorization.', inputSchema: { familyId: z.string() }, annotations: annotation(false) }, guard(ctx.logger, 'expand_asset_family', async args => ok(await families.expand(args.familyId))));
  server.registerTool('plan_platform_preparation', { description: 'Plan standalone variant/LOD, collision, material and texture budget preparation. Explicitly reports unavailable conversions; never claims runtime/engine verification.', inputSchema: { recipe: platformSchema }, annotations: annotation(true) }, guard(ctx.logger, 'plan_platform_preparation', async args => ok(planPlatform(args.recipe))));
  server.registerTool('save_platform_preparation', { description: 'Save supported platform preparation as a resumable recipe. Refuses unavailable capabilities; each step remains individually authorized.', inputSchema: { recipe: platformSchema }, annotations: annotation(false) }, guard(ctx.logger, 'save_platform_preparation', async args => { const plan = planPlatform(args.recipe); if (!plan.executable) throw invalidState(plan.unavailable.join(' ')); return ok(await recipes.save(plan.recipe)); }));
  server.registerTool('diagnose_texture_compression', { description: 'FREE dependency diagnosis; verifies configured Basis CPU encoder SHA-256 without starting any process. Reports pinned version and missing setup.', inputSchema: {}, annotations: annotation(true) }, guard(ctx.logger, 'diagnose_texture_compression', async () => ok(await diagnoseTextureCompression())));
  server.registerTool('compress_texture_variant', { description: 'Create an embedded ETC1S/UASTC KTX2 GLB with a pinned, explicitly configured Basis Universal CPU process. Verifies every mip by CPU transcoding; no GPU or Blender. Fresh mutation approval required; no provider costs. Color uses selected codec; normal/data use UASTC linear.', inputSchema: { modelPath: z.string().min(1), colorCodec: z.enum(['etc1s', 'uastc']).default('etc1s'), quality: z.number().int().min(1).max(255).default(128), timeoutSeconds: z.number().int().min(1).max(300).default(120) }, annotations: annotation(false) }, guard(ctx.logger, 'compress_texture_variant', async args => ok(await compressTextureVariant({ ...args, outputRoot: path.join(ctx.config.outputDir, '.production', 'compressed') }))));
  server.registerTool('prepare_texture_variant', { description: 'Locally resize embedded GLB PNG/JPEG textures with color/data-aware filtering and normal renormalization. Preserves source; refuses unknown extensions, mixed texture semantics, 16-bit loss, and resource-budget excess.', inputSchema: { modelPath: z.string().min(1), maxTextureSize: z.number().int().min(1).max(8192) }, annotations: annotation(false) }, guard(ctx.logger, 'prepare_texture_variant', async args => ok(await prepareTextureVariant(args.modelPath, args.maxTextureSize, path.join(ctx.config.outputDir, '.production', 'textures')))));
  server.registerTool('prepare_collision_box', { description: 'Create a standalone conservative AABB OBJ collision proxy from measured glTF bounds. No Blender launch or engine integration.', inputSchema: { modelPath: z.string().min(1) }, annotations: annotation(false) }, guard(ctx.logger, 'prepare_collision_box', async args => ok(await prepareCollisionBox(args.modelPath, path.join(ctx.config.outputDir, '.production', 'collision')))));
  server.registerTool('validate_platform_asset', { description: 'Measure triangle/material/texture maximum budgets; unknown texture dimensions fail closed.', inputSchema: { modelPath: z.string(), maxTriangles: z.number().int().positive(), maxMaterials: z.number().int().positive(), maxTextureSize: z.number().int().positive() }, annotations: annotation(true) }, guard(ctx.logger, 'validate_platform_asset', async args => ok(await validatePlatformAsset(args))));
}
