import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { inspectGltf } from '../inspection/gltf.js';
import { invalidState } from '../util/errors.js';
import { digest, fileDigest, type Recipe } from './recipes.js';
export const platformSchema = z.object({
  schema: z.literal('game_dev.platform_recipe.v1'), id: z.string().regex(/^[a-zA-Z0-9_-]{1,60}$/),
  modelPath: z.string().min(1), name: z.string().min(1).max(100), license: z.string().min(1),
  variants: z.array(z.object({
    id: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/),
    lodTriangles: z.array(z.number().int().positive().max(10_000_000)).min(1).max(8),
    maxMaterials: z.number().int().positive().max(4096), maxTextureSize: z.number().int().positive().max(16384),
    textureMode: z.enum(['preserve', 'resize', 'compress']).default('preserve'),
    materialMode: z.enum(['preserve', 'opaque']).default('preserve'),
    collision: z.enum(['none', 'box', 'convex']).default('none'),
  }).strict()).min(1).max(16),
}).strict();
export function planPlatform(input: unknown) {
  const spec = platformSchema.parse(input);
  const unavailable: string[] = [];
  if (new Set(spec.variants.map(v => v.id)).size !== spec.variants.length) throw invalidState('Variant ids must be unique.');
  const steps: Recipe['steps'] = [];
  for (const [variantIndex, variant] of spec.variants.entries()) {
    if (variant.collision === 'convex') unavailable.push(`${variant.id}: convex collision decomposition is unavailable; choose a conservative box or provide authored collision.`);
    const textureStep = `v${variantIndex}_textures`;
    if (variant.textureMode !== 'preserve') steps.push({ id: textureStep, operation: 'prepare_texture_variant', dependsOn: [], files: [spec.modelPath], arguments: { modelPath: spec.modelPath, maxTextureSize: variant.maxTextureSize } });
    for (const [index, triangles] of variant.lodTriangles.entries()) {
      const prefix = `v${variantIndex}_lod${index}`;
      steps.push({ id: `${prefix}_normalize`, operation: 'normalize_mesh', dependsOn: variant.textureMode !== 'preserve' ? [textureStep] : [], files: variant.textureMode !== 'preserve' ? [] : [spec.modelPath], arguments: { modelPath: variant.textureMode !== 'preserve' ? { $step: textureStep, field: 'outputPath' } : spec.modelPath, targetTriangles: triangles, normalizeMaterials: variant.materialMode === 'opaque' } });
      const normalized = { $step: `${prefix}_normalize`, field: 'outputPath' };
      const preparedId = variant.textureMode === 'compress' ? `${prefix}_compress` : `${prefix}_normalize`;
      if (variant.textureMode === 'compress') steps.push({ id: preparedId, operation: 'compress_texture_variant', dependsOn: [`${prefix}_normalize`], files: [], arguments: { modelPath: normalized } });
      const source = { $step: preparedId, field: 'outputPath' };
      steps.push({ id: `${prefix}_validate`, operation: 'validate_game_asset', dependsOn: [preparedId], files: [], arguments: { modelPath: source, maxTriangles: triangles, maxMaterials: variant.maxMaterials } });
      steps.push({ id: `${prefix}_budget`, operation: 'validate_platform_asset', dependsOn: [preparedId, `${prefix}_validate`], files: [], arguments: { modelPath: source, maxTriangles: triangles, maxMaterials: variant.maxMaterials, maxTextureSize: variant.maxTextureSize } });
      steps.push({ id: `${prefix}_package`, operation: 'build_asset_package', dependsOn: [preparedId, `${prefix}_validate`, `${prefix}_budget`], files: [], arguments: { modelPath: source, name: `${spec.name}_${variant.id}_lod${index}`, license: spec.license } });
      if (variant.collision === 'box') steps.push({ id: `${prefix}_collision`, operation: 'prepare_collision_box', dependsOn: [preparedId, `${prefix}_validate`, `${prefix}_budget`], files: [], arguments: { modelPath: source } });
    }
  }
  const recipe: Recipe = { schema: 'game_dev.production_recipe.v1', id: spec.id, name: spec.name, steps };
  return { schema: 'game_dev.platform_plan.v1', recipe, unavailable, executable: unavailable.length === 0, capabilities: { lod: 'Blender decimation followed by measured budget validation', collision: 'standalone conservative AABB OBJ; no runtime integration', textures: 'preserve, resize, or CPU ETC1S/UASTC compression after normalization; measured KTX2 metadata and payload verification', materials: 'preserve or normalize opaque', packages: 'canonical standalone packages per variant/LOD' } };
}
export async function prepareCollisionBox(modelPath: string, outputRoot: string) {
  const inspection = await inspectGltf(modelPath);
  if (inspection.boundingBoxEmpty || inspection.triangleCount === 0) throw invalidState('Cannot generate collision without finite geometry bounds.');
  const { min, max } = inspection.boundingBox;
  const vertices = [ [min[0],min[1],min[2]], [max[0],min[1],min[2]], [max[0],max[1],min[2]], [min[0],max[1],min[2]], [min[0],min[1],max[2]], [max[0],min[1],max[2]], [max[0],max[1],max[2]], [min[0],max[1],max[2]] ];
  const obj = '# Conservative AABB collision proxy; meters; no engine binding\n' + vertices.map(v => `v ${v.join(' ')}`).join('\n') + '\nf 1 4 3 2\nf 5 6 7 8\nf 1 2 6 5\nf 4 8 7 3\nf 1 5 8 4\nf 2 3 7 6\n';
  const sourceSHA256 = await fileDigest(modelPath);
  const target = path.join(outputRoot, `${digest({ sourceSHA256, obj })}.obj`);
  await fs.mkdir(outputRoot, { recursive: true });
  try { await fs.writeFile(target, obj, { flag: 'wx' }); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (await fs.readFile(target, 'utf8') !== obj) throw invalidState('Existing collision artifact does not match content address.');
  }
  return { schema: 'game_dev.collision_proxy.v1', kind: 'aabb', modelPath, sourceSHA256, outputPath: target, outputSHA256: await fileDigest(target), bounds: inspection.boundingBox, conservative: true, engineVerified: false };
}
export async function validatePlatformAsset(args: { modelPath: string; maxTriangles: number; maxMaterials: number; maxTextureSize: number }) {
  const inspection = await inspectGltf(args.modelPath);
  const textures = inspection.textureResolutions;
  const checks = [
    { name: 'known_texture_dimensions', passed: textures.length === inspection.textureCount, measured: textures.length, limit: inspection.textureCount },
    { name: 'triangles', passed: inspection.triangleCount > 0 && inspection.triangleCount <= args.maxTriangles, measured: inspection.triangleCount, limit: args.maxTriangles },
    { name: 'materials', passed: inspection.materialCount <= args.maxMaterials, measured: inspection.materialCount, limit: args.maxMaterials },
    ...textures.map((texture, i) => ({ name: `texture_${i}`, passed: texture.width !== undefined && texture.height !== undefined && texture.width <= args.maxTextureSize && texture.height <= args.maxTextureSize, measured: [texture.width, texture.height], limit: args.maxTextureSize })),
  ];
  return { schema: 'game_dev.platform_validation.v1', passed: checks.every(c => c.passed), modelPath: args.modelPath, checks };
}
