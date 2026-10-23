import { Document, NodeIO, type Material } from '@gltf-transform/core';
import { z } from 'zod';

const dimension = z.number().finite().min(0.05).max(100);
const color = z.tuple([z.number().finite().min(0).max(1), z.number().finite().min(0).max(1), z.number().finite().min(0).max(1)]);
export const proceduralCrateRecipeSchema = z.object({
  schema: z.literal('game_dev.procedural_crate_recipe.v1').default('game_dev.procedural_crate_recipe.v1'),
  units: z.literal('metres').default('metres'),
  dimensions: z.object({ width: dimension, height: dimension, depth: dimension }).strict(),
  pivot: z.enum(['bottom-center', 'center']).default('bottom-center'),
  axes: z.literal('right-handed-y-up').default('right-handed-y-up'),
  seed: z.number().int().min(0).max(0xffff_ffff).default(0),
  panelThicknessRatio: z.number().finite().min(0.02).max(0.2).default(0.08),
  material: z.object({
    baseColor: color.default([0.32, 0.16, 0.06]),
    frameColor: color.default([0.22, 0.10, 0.035]),
    roughness: z.number().finite().min(0).max(1).default(0.8),
  }).strict().default({}),
}).strict();
export type ProceduralCrateRecipe = z.infer<typeof proceduralCrateRecipeSchema>;
export type CratePoint = [number, number, number];
export interface CrateBounds { min: CratePoint; max: CratePoint }
export interface CrateGeometry {
  bytes: Uint8Array;
  vertices: number;
  triangles: number;
  bounds: CrateBounds;
}
export interface ProceduralCrateResult {
  schema: 'game_dev.procedural_crate.v1';
  recipe: ProceduralCrateRecipe;
  source: CrateGeometry & { kind: 'editable-parts'; parts: number };
  runtime: {
    lods: (CrateGeometry & { id: string; level: number })[];
    lodChain: { schema: 'game_dev.lod_chain.v1'; selection: 'consumer-defined'; levels: { id: string; level: number; triangles: number }[] };
  };
  collision: CrateGeometry & { shape: 'box'; approximation: 'exterior-bounds'; center: CratePoint; dimensions: CratePoint };
  limitations: string[];
}
interface Part { name: string; center: CratePoint; size: CratePoint; material: 'panel' | 'frame' }
interface Geometry { positions: number[]; normals: number[]; uv: number[]; indices: number[] }

function partsFor(recipe: ProceduralCrateRecipe): Part[] {
  const { width: w, height: h, depth: d } = recipe.dimensions;
  const t = Math.min(w, h, d) * recipe.panelThicknessRatio;
  const y = recipe.pivot === 'bottom-center' ? h / 2 : 0;
  const parts: Part[] = [];
  const add = (name: string, center: CratePoint, size: CratePoint, material: Part['material']) => {
    parts.push({ name, center: [center[0], center[1] + y, center[2]], size, material });
  };
  for (const sign of [-1, 1]) {
    add(`panel_x_${sign}`, [sign * (w / 2 - 1.5 * t), 0, 0], [t, h - 2 * t, d - 2 * t], 'panel');
    add(`panel_y_${sign}`, [0, sign * (h / 2 - 1.5 * t), 0], [w - 2 * t, t, d - 2 * t], 'panel');
    add(`panel_z_${sign}`, [0, 0, sign * (d / 2 - 1.5 * t)], [w - 2 * t, h - 2 * t, t], 'panel');
  }
  for (const a of [-1, 1]) for (const b of [-1, 1]) {
    add(`frame_y_${a}_${b}`, [a * (w - t) / 2, 0, b * (d - t) / 2], [t, h, t], 'frame');
    add(`frame_x_${a}_${b}`, [0, a * (h - t) / 2, b * (d - t) / 2], [w - 2 * t, t, t], 'frame');
    add(`frame_z_${a}_${b}`, [a * (w - t) / 2, b * (h - t) / 2, 0], [t, t, d - 2 * t], 'frame');
  }
  return parts;
}

function boxGeometry(parts: Part[]): Geometry {
  const geometry: Geometry = { positions: [], normals: [], uv: [], indices: [] };
  const faces: { normal: CratePoint; corners: CratePoint[] }[] = [
    { normal: [1, 0, 0], corners: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
    { normal: [-1, 0, 0], corners: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
    { normal: [0, 1, 0], corners: [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]] },
    { normal: [0, -1, 0], corners: [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]] },
    { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
    { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
  ];
  for (const part of parts) for (const face of faces) {
    const offset = geometry.positions.length / 3;
    for (const corner of face.corners) {
      geometry.positions.push(...corner.map((value, i) => part.center[i]! + value * part.size[i]! / 2));
      geometry.normals.push(...face.normal);
    }
    geometry.uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    geometry.indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  return geometry;
}

function seededTint(seed: number): number {
  let value = seed | 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return 0.94 + (((value ^ (value >>> 15)) >>> 0) / 0x1_0000_0000) * 0.06;
}

async function encode(recipe: ProceduralCrateRecipe, parts: Part[], kind: string, hierarchical: boolean): Promise<CrateGeometry> {
  const document = new Document();
  const buffer = document.createBuffer();
  const scene = document.createScene(kind);
  document.getRoot().setDefaultScene(scene);
  document.getRoot().setExtras({ schema: 'game_dev.crate_geometry.v1', units: recipe.units, axes: recipe.axes, pivot: recipe.pivot, kind });
  const tint = seededTint(recipe.seed);
  const material = (name: string, rgb: CratePoint) => document.createMaterial(name)
    .setBaseColorFactor([rgb[0] * tint, rgb[1] * tint, rgb[2] * tint, 1])
    .setMetallicFactor(0).setRoughnessFactor(recipe.material.roughness);
  const materials = { panel: material('panel', recipe.material.baseColor), frame: material('frame', recipe.material.frameColor) };
  const accessor = (name: string, type: 'VEC3' | 'VEC2' | 'SCALAR', array: Float32Array | Uint16Array) =>
    document.createAccessor(name).setBuffer(buffer).setType(type).setArray(array);
  let vertices = 0, triangles = 0;
  const primitive = (selected: Part[], selectedMaterial: Material) => {
    const geometry = boxGeometry(selected);
    vertices += geometry.positions.length / 3;
    triangles += geometry.indices.length / 3;
    return document.createPrimitive().setMode(4).setMaterial(selectedMaterial)
      .setAttribute('POSITION', accessor('position', 'VEC3', new Float32Array(geometry.positions)))
      .setAttribute('NORMAL', accessor('normal', 'VEC3', new Float32Array(geometry.normals)))
      .setAttribute('TEXCOORD_0', accessor('uv', 'VEC2', new Float32Array(geometry.uv)))
      .setIndices(accessor('indices', 'SCALAR', new Uint16Array(geometry.indices)));
  };
  if (hierarchical) {
    for (const part of parts) scene.addChild(document.createNode(part.name).setExtras({ editablePart: true })
      .setMesh(document.createMesh(part.name).addPrimitive(primitive([part], materials[part.material]))));
  } else {
    const mesh = document.createMesh(kind);
    for (const group of ['panel', 'frame'] as const) {
      const selected = parts.filter((part) => part.material === group);
      if (selected.length) mesh.addPrimitive(primitive(selected, materials[group]));
    }
    scene.addChild(document.createNode(kind).setMesh(mesh));
  }
  const { width: w, height: h, depth: d } = recipe.dimensions;
  const bounds: CrateBounds = { min: [-w / 2, recipe.pivot === 'bottom-center' ? 0 : -h / 2, -d / 2], max: [w / 2, recipe.pivot === 'bottom-center' ? h : h / 2, d / 2] };
  return { bytes: await new NodeIO().writeBinary(document), vertices, triangles, bounds };
}

/** Pure bounded CPU construction: no paths, filesystem, child processes, providers or GPU. */
export async function generateProceduralCrate(input: unknown): Promise<ProceduralCrateResult> {
  const recipe = proceduralCrateRecipeSchema.parse(input);
  const parts = partsFor(recipe);
  const { width, height, depth } = recipe.dimensions;
  const center: CratePoint = [0, recipe.pivot === 'bottom-center' ? height / 2 : 0, 0];
  const exterior: Part = { name: 'exterior_box', center, size: [width, height, depth], material: 'panel' };
  const source = await encode(recipe, parts, 'source', true);
  const detailed = await encode(recipe, parts, 'runtime_lod0', false);
  const reduced = await encode(recipe, [exterior], 'runtime_lod1', false);
  const collision = await encode(recipe, [exterior], 'collision_box', false);
  const lods = [{ ...detailed, id: 'lod0', level: 0 }, { ...reduced, id: 'lod1', level: 1 }];
  return {
    schema: 'game_dev.procedural_crate.v1', recipe,
    source: { ...source, kind: 'editable-parts', parts: parts.length },
    runtime: { lods, lodChain: { schema: 'game_dev.lod_chain.v1', selection: 'consumer-defined', levels: lods.map(({ id, level, triangles }) => ({ id, level, triangles })) } },
    collision: { ...collision, shape: 'box', approximation: 'exterior-bounds', center, dimensions: [width, height, depth] },
    limitations: [
      'Source parts are closed overlapping boxes; interior and contact faces are retained.',
      'LOD1 fills panel recesses with a solid exterior box; silhouette and appearance equivalence are not guaranteed.',
      'Collision is an exterior box approximation that fills panel recesses and the hollow interior.',
      'UVs repeat per face without packing, texel-density guarantees or texture baking; material colours are linear RGB.',
      'Seed controls deterministic material tint only; runtime LOD selection is consumer-defined.',
      'No engine integration, hardware performance measurement or human visual approval is established.',
    ],
  };
}
