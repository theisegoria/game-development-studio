import path from 'node:path';
import { z } from 'zod';
import { invalidInput } from '../util/errors.js';
import { planPlatform, platformSchema } from './platform.js';
import { validateRecipe, type Recipe } from './recipes.js';
import { reviewSettingsSchema } from '../review/settings.js';

export const productionTemplateIdSchema = z.enum(['inspect-validate-package', 'review-select-package', 'platform-variants']);
export type ProductionTemplateId = z.infer<typeof productionTemplateIdSchema>;
const common = {
  recipeId: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
  name: z.string().trim().min(1).max(100),
  license: z.string().trim().min(1).max(200),
};
const modelPath = z.string().min(1).refine(value => ['.glb', '.gltf'].includes(path.extname(value).toLowerCase()), 'A local GLB or glTF model is required.');
const portableModelPath = modelPath.refine(value => path.extname(value).toLowerCase() === '.glb', 'This workflow packages a self-contained GLB; convert external glTF resources explicitly first.');
export const productionPolicySchema = z.object({
  requireUVs: z.boolean().optional(), requireNormals: z.boolean().optional(),
  requireTangentsWithNormalMap: z.boolean().optional(), requireBaseColorTexture: z.boolean().optional(),
  maxTriangles: z.number().int().positive().max(50_000_000).optional(),
  maxMaterials: z.number().int().positive().max(4096).optional(),
  minTextureSize: z.number().int().positive().max(16384).optional(),
  requirePowerOfTwoTextures: z.boolean().optional(),
  maxDimensionMeters: z.number().positive().optional(), minDimensionMeters: z.number().positive().optional(),
}).strict();
export const inspectPackageRequestSchema = z.object({ ...common, modelPath: portableModelPath, policy: productionPolicySchema.optional() }).strict();
export const reviewPackageRequestSchema = z.object({
  ...common, modelPath: portableModelPath.optional(),
  candidates: z.array(z.object({ name: z.string().trim().min(1).max(200), modelPath: portableModelPath }).strict()).min(1).max(6).optional(),
  policy: productionPolicySchema.optional(),
  reviewSettings: reviewSettingsSchema.optional(),
}).strict().refine(value => Boolean(value.modelPath) !== Boolean(value.candidates), 'Provide modelPath or candidates, never both.');
export const platformVariantsRequestSchema = z.object({ ...common, modelPath, variants: platformSchema.shape.variants }).strict();
export const productionTemplateRequestSchema = z.union([inspectPackageRequestSchema, reviewPackageRequestSchema, platformVariantsRequestSchema]);
export type ProductionTemplateRequest = z.infer<typeof productionTemplateRequestSchema>;

const templates = [
  { id: 'inspect-validate-package' as const, title: 'Inspect, validate and package', description: 'Inspect a local model, apply your policy, then build a standalone package from the actual validated path.', requiredTools: [] as string[], requiresHumanSelection: false },
  { id: 'review-select-package' as const, title: 'Review, select and package', description: 'Create a bounded local review, explicitly select a candidate after inspection, validate its snapshot and package the approved bytes.', requiredTools: [] as string[], requiresHumanSelection: true },
  { id: 'platform-variants' as const, title: 'Prepare platform variants', description: 'Build standalone variants and LOD packages using the existing platform planner. Normalization requires separately approved Blender execution.', requiredTools: ['Blender'], requiresHumanSelection: false },
];
export function listProductionTemplates() {
  return { schema: 'game_dev.production_templates.v1', templates: templates.map(template => ({ ...template, paid: false, executes: false })) };
}

/** Typed form compilation is read-only. Every operation still uses RecipeStore.run. */
export function planProductionTemplate(templateId: unknown, request: unknown) {
  const selectedId = productionTemplateIdSchema.parse(templateId);
  const template = templates.find(item => item.id === selectedId)!;
  let recipe: Recipe;
  let requiredTools: string[] = template.requiredTools;
  if (selectedId === 'platform-variants') {
    const spec = platformVariantsRequestSchema.parse(request);
    const planned = planPlatform({ schema: 'game_dev.platform_recipe.v1', id: spec.recipeId, name: spec.name, license: spec.license, modelPath: path.resolve(spec.modelPath), variants: spec.variants });
    if (!planned.executable) throw invalidInput(planned.unavailable.join(' '));
    recipe = validateRecipe(planned.recipe); requiredTools = planned.requiredTools;
  } else if (selectedId === 'inspect-validate-package') {
    const spec = inspectPackageRequestSchema.parse(request);
    const source = path.resolve(spec.modelPath);
    recipe = validateRecipe({ schema: 'game_dev.production_recipe.v1', id: spec.recipeId, name: spec.name, steps: [
      { id: 'inspect', operation: 'inspect_asset', arguments: { modelPath: source } },
      { id: 'validate', operation: 'validate_game_asset', dependsOn: ['inspect'], arguments: { modelPath: { $step: 'inspect', field: 'filePath' }, ...spec.policy } },
      { id: 'package', operation: 'build_asset_package', dependsOn: ['validate'], arguments: { modelPath: { $step: 'validate', field: 'modelPath' }, name: spec.name, license: spec.license } },
    ] });
  } else {
    const spec = reviewPackageRequestSchema.parse(request);
    if(spec.reviewSettings?.decodeBasisTextures) requiredTools=['Basis Universal 2.50 CPU'];
    const candidates = spec.candidates ?? [{ name: spec.name, modelPath: spec.modelPath! }];
    if (candidates.some(candidate => path.extname(candidate.modelPath).toLowerCase() !== '.glb')) throw invalidInput('Review snapshots require a self-contained GLB.');
    recipe = validateRecipe({ schema: 'game_dev.production_recipe.v1', id: spec.recipeId, name: spec.name, steps: [
      { id: 'review', operation: 'create_asset_review', arguments: { candidates: candidates.map(candidate => ({ ...candidate, modelPath: path.resolve(candidate.modelPath) })), ...(spec.reviewSettings ? { settings: spec.reviewSettings } : {}) } },
      // Intentionally lacks candidateId/reviewer/reason until explicit human selection of actual results.
      { id: 'select', operation: 'decide_asset_review', dependsOn: ['review'], arguments: { sessionId: { $step: 'review', field: 'id' }, decision: 'approve' } },
      { id: 'validate', operation: 'validate_game_asset', dependsOn: ['review', 'select'], arguments: { modelPath: { $step: 'select', field: 'modelPath' }, ...spec.policy } },
      { id: 'package', operation: 'package_reviewed_asset', dependsOn: ['select', 'validate'], arguments: { decisionId: { $step: 'select', field: 'id' }, name: spec.name, license: spec.license } },
    ] });
  }
  return { schema: 'game_dev.production_template_plan.v1', template, recipe, requiredTools, dependencyAvailabilityChecked: false, executes: false, requiresHumanSelection: template.requiresHumanSelection, note: 'Saving only persists the recipe. Inspect a fresh plan and authorize each operation separately; no provider or process runs during planning.' };
}
