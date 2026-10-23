import { NodeIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { generateProceduralCrate, proceduralCrateRecipeSchema } from '../src/production/procedural-crate.js';
import { readReviewDocument } from '../src/review/document.js';

const recipe = { dimensions: { width: 2, height: 3, depth: 4 }, seed: 42 };

describe('deterministic bounded procedural crate', () => {
  it('produces inspectable deterministic source, genuinely distinct runtime LODs and collision', async () => {
    const first = await generateProceduralCrate(recipe);
    const second = await generateProceduralCrate(recipe);
    expect(first.recipe.units).toBe('metres');
    expect(first.source.bytes).toEqual(second.source.bytes);
    expect(first.runtime.lods.map((lod) => lod.bytes)).toEqual(second.runtime.lods.map((lod) => lod.bytes));
    expect(first.collision.bytes).toEqual(second.collision.bytes);
    expect(first.source.parts).toBe(18);
    expect(first.runtime.lods.map((lod) => [lod.vertices, lod.triangles])).toEqual([[432, 216], [24, 12]]);
    expect(first.runtime.lodChain.levels.map((lod) => lod.triangles)).toEqual([216, 12]);
    expect(first.collision.triangles).toBe(12);
    for (const geometry of [first.source, ...first.runtime.lods, first.collision]) {
      const doc = await new NodeIO().readBinary(geometry.bytes);
      let vertices = 0, triangles = 0;
      const positions: number[][] = [];
      for (const mesh of doc.getRoot().listMeshes()) for (const primitive of mesh.listPrimitives()) {
        const position = primitive.getAttribute('POSITION')!;
        const normals = primitive.getAttribute('NORMAL')!;
        const indices = primitive.getIndices()!;
        vertices += position.getCount(); triangles += indices.getCount() / 3;
        for (let i = 0; i < position.getCount(); i++) positions.push(position.getElement(i, []));
        for (let i = 0; i < indices.getCount(); i += 3) {
          const a = position.getElement(indices.getScalar(i), []);
          const b = position.getElement(indices.getScalar(i + 1), []);
          const c = position.getElement(indices.getScalar(i + 2), []);
          const ab = b.map((value, axis) => value - a[axis]!);
          const ac = c.map((value, axis) => value - a[axis]!);
          const cross = [ab[1]! * ac[2]! - ab[2]! * ac[1]!, ab[2]! * ac[0]! - ab[0]! * ac[2]!, ab[0]! * ac[1]! - ab[1]! * ac[0]!];
          const normal = normals.getElement(indices.getScalar(i), []);
          expect(cross.reduce((sum, value, axis) => sum + value * normal[axis]!, 0)).toBeGreaterThan(0);
        }
      }
      expect(vertices).toBe(geometry.vertices); expect(triangles).toBe(geometry.triangles);
      expect([0, 1, 2].map((axis) => Math.min(...positions.map((position) => position[axis]!)))).toEqual([-1, 0, -2]);
      expect([0, 1, 2].map((axis) => Math.max(...positions.map((position) => position[axis]!)))).toEqual([1, 3, 2]);
      expect(geometry.bytes.byteLength).toBeLessThan(128 * 1024);
      await expect(readReviewDocument(geometry.bytes)).resolves.toBeDefined();
    }
    const sourceDoc = await new NodeIO().readBinary(first.source.bytes);
    const runtimeDoc = await new NodeIO().readBinary(first.runtime.lods[0]!.bytes);
    expect(sourceDoc.getRoot().listNodes()).toHaveLength(18);
    expect(runtimeDoc.getRoot().listNodes()).toHaveLength(1);
  });
  it('honours centered pivot, editable recipe round-trip and seeded material identity', async () => {
    const result = await generateProceduralCrate({ ...recipe, pivot: 'center' });
    expect(result.source.bounds).toEqual({ min: [-1, -1.5, -2], max: [1, 1.5, 2] });
    expect(result.collision.center).toEqual([0, 0, 0]);
    const recreated = await generateProceduralCrate(JSON.parse(JSON.stringify(result.recipe)));
    expect(recreated.source.bytes).toEqual(result.source.bytes);
    const other = await generateProceduralCrate({ ...recipe, pivot: 'center', seed: 43 });
    expect(other.source.bytes).not.toEqual(result.source.bytes);
    expect(other.runtime.lods[0]!.triangles).toBe(result.runtime.lods[0]!.triangles);
    const document = await new NodeIO().readBinary(result.source.bytes);
    const positions = document.getRoot().listAccessors().filter((a) => a.getName() === 'position');
    const y = positions.flatMap((a) => Array.from({ length: a.getCount() }, (_, i) => a.getElement(i, [])[1]!));
    expect(Math.min(...y)).toBe(-1.5); expect(Math.max(...y)).toBe(1.5);
  });
  it('rejects malformed and excessive requests before construction', async () => {
    for (const width of [0, -1, NaN, Infinity, 0.049, 100.001]) {
      await expect(generateProceduralCrate({ dimensions: { width, height: 1, depth: 1 } })).rejects.toThrow();
    }
    for (const invalid of [
      { ...recipe, extra: true }, { ...recipe, units: 'centimetres' },
      { ...recipe, dimensions: { ...recipe.dimensions, extra: true } },
      { ...recipe, material: { roughness: NaN } }, { ...recipe, seed: 0x1_0000_0000 },
      { ...recipe, seed: 1.5 }, { ...recipe, panelThicknessRatio: 0.3 },
      { ...recipe, material: { baseColor: [1, 2, 3] } },
    ]) expect(proceduralCrateRecipeSchema.safeParse(invalid).success).toBe(false);
    const smallest = await generateProceduralCrate({ dimensions: { width: 0.05, height: 0.05, depth: 0.05 } });
    const largest = await generateProceduralCrate({ dimensions: { width: 100, height: 100, depth: 100 } });
    expect(smallest.source.triangles).toBe(largest.source.triangles);
  });
});
