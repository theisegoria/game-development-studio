import { expect, test } from 'vitest';
import { decodeImage } from '../src/inspection/image.js';
import { renderAppearance, REVIEW_BLEND_FRAGMENT_BUDGET, type ReviewFace, type ReviewMaterial } from '../src/review/appearance.js';
import { reviewSettingsSchema } from '../src/review/settings.js';

const settings = reviewSettingsSchema.parse({ mode: 'appearance', resolution: 128 });
const points: [number, number, number][] = [[-1, -1, 0], [1, -1, 0], [0, 1, 0]];
const normals: [number, number, number][] = [[0, 0, 1], [0, 0, 1], [0, 0, 1]];
const uvs = [[0, 0], [1, 0], [0, 1]];
const colors = [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]];

function material(overrides: Partial<ReviewMaterial> = {}): ReviewMaterial {
  return {
    color: [1, 1, 1, 1], metallic: 0, roughness: 0.6, alphaMode: 'OPAQUE', alphaCutoff: 0.5,
    doubleSided: true, normalScale: 1, emissive: [0, 0, 0], occlusionStrength: 0, ...overrides,
  };
}
function face(overrides: Partial<ReviewFace> = {}): ReviewFace {
  return { points, normals, uv: uvs, colors, material: material(), materialIndex: 0, ...overrides };
}
function pixel(preview: ReturnType<typeof renderAppearance>, x: number, y: number, frame = 0): number[] {
  const encoded = preview.images[frame]!.split(',')[1]!;
  const image = decodeImage(Buffer.from(encoded, 'base64'));
  const at = (y * image.width + x) * 4;
  return [...image.data.subarray(at, at + 4)];
}
function normalTexture(rgba: [number, number, number, number]) {
  return { image: { width: 1, height: 1, data: new Uint8Array(rgba) }, wrapS: 10497, wrapT: 10497 };
}
function decodeSrgb(byte: number): number {
  const value = byte / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}
function inverseToneMap(byte: number): number {
  const mapped = decodeSrgb(byte);
  return mapped / (1 - mapped);
}
function encodeToneMap(radiance: number): number {
  const value = radiance / (1 + radiance);
  return Math.round(255 * (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055));
}
function over(front: number[], behind: number[], alpha: number): number[] {
  return front.map((v, k) => v * alpha + behind[k]! * (1 - alpha));
}
function rgbDistance(a: number[], b: number[]): number {
  return a.slice(0, 3).reduce((distance, value, k) => distance + Math.abs(value - b[k]!), 0);
}

test('authored tangent frames interpolate per pixel and replace the UV tangent only when supplied', () => {
  const normal = normalTexture([255, 128, 128, 255]);
  const base = face({ material: material({ normal }) });
  const authoredX = face({ material: material({ normal }), tangents: [[1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1]] });
  expect(renderAppearance([authoredX], [0, 0, 0], 2, settings).images).toEqual(renderAppearance([base], [0, 0, 0], 2, settings).images);

  const interpolated = face({ material: material({ normal }), tangents: [[1, 0, 0, 1], [0, 1, 0, 1], [0, 1, 0, 1]] });
  const authored = renderAppearance([interpolated], [0, 0, 0], 2, settings);
  const uvFallback = renderAppearance([base], [0, 0, 0], 2, settings);
  const authoredNearFirstVertex = pixel(authored, 24, 103);
  const fallbackNearFirstVertex = pixel(uvFallback, 24, 103);
  const authoredNearSecondVertex = pixel(authored, 103, 103);
  const fallbackNearSecondVertex = pixel(uvFallback, 103, 103);
  expect(authoredNearSecondVertex.slice(0, 3)).not.toEqual(fallbackNearSecondVertex.slice(0, 3));
  expect(rgbDistance(authoredNearSecondVertex, fallbackNearSecondVertex)).toBeGreaterThan(rgbDistance(authoredNearFirstVertex, fallbackNearFirstVertex));
});

test('UV-derived fallback preserves tangent handedness under a reflected world-space frame', () => {
  const reflectedPoints = points.map(([x, y, z]) => [-x, y, z]) as [number, number, number][];
  const normal = normalTexture([128, 255, 128, 255]);
  const fallback = face({ points: reflectedPoints, material: material({ normal }) });
  const authored = face({
    points: reflectedPoints, material: material({ normal }),
    tangents: [[-1, 0, 0, -1], [-1, 0, 0, -1], [-1, 0, 0, -1]],
  });
  expect(renderAppearance([fallback], [0, 0, 0], 2, settings).images).toEqual(renderAppearance([authored], [0, 0, 0], 2, settings).images);
});

test('malformed authored tangent frames and missing fallback UVs are refused explicitly', () => {
  const normal = normalTexture([255, 128, 128, 255]);
  for (const tangents of [
    [[1, 0, 0, 1]],
    [[1, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 0]],
    [[0, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1]],
    [[Number.NaN, 0, 0, 1], [1, 0, 0, 1], [1, 0, 0, 1]],
  ]) {
    expect(() => renderAppearance([face({ material: material({ normal }), tangents })], [0, 0, 0], 2, settings)).toThrow('Authored tangent frame');
  }
  expect(() => renderAppearance([face({ uv: [], material: material({ normal }) })], [0, 0, 0], 2, settings)).toThrow('requires three finite TEXCOORD_0');
});

test('intersecting BLEND triangles composite by per-pixel depth over opaque depth without centroid ordering', () => {
  const pointsA: [number, number, number][] = [[-1, -1, -0.4], [1, -1, 0], [0, 1, 0.4]];
  const pointsB: [number, number, number][] = [[-1, -1, 0.5], [1, -1, 0.5], [0, 1, -0.3]];
  const opaqueMaterialA = material({ color: [0, 0, 0, 1], emissive: [1, 0, 0] });
  const opaqueMaterialB = material({ color: [0, 0, 0, 1], emissive: [0, 0, 1] });
  const blendMaterialA = material({ color: [0, 0, 0, 0.5], alphaMode: 'BLEND', emissive: [1, 0, 0] });
  const blendMaterialB = material({ color: [0, 0, 0, 0.5], alphaMode: 'BLEND', emissive: [0, 0, 1] });
  const opaque = face({ points: points.map(([x, y]) => [x, y, -0.6]), material: material({ color: [0, 0, 0, 1], emissive: [0, 1, 0] }) });
  const a = face({ points: pointsA, material: blendMaterialA, materialIndex: 1 });
  const b = face({ points: pointsB, material: blendMaterialB, materialIndex: 2 });
  const opaqueA = pixel(renderAppearance([face({ points: pointsA, material: opaqueMaterialA })], [0, 0, 0], 2, settings), 64, 22).slice(0, 3).map(inverseToneMap);
  const opaqueB = pixel(renderAppearance([face({ points: pointsB, material: opaqueMaterialB })], [0, 0, 0], 2, settings), 64, 22).slice(0, 3).map(inverseToneMap);
  const opaqueBase = pixel(renderAppearance([opaque], [0, 0, 0], 2, settings), 64, 22).slice(0, 3).map(inverseToneMap);
  const blended = renderAppearance([opaque, a, b], [0, 0, 0], 2, settings);
  const reversed = renderAppearance([b, opaque, a], [0, 0, 0], 2, settings);

  // Near vertex 2, A is closer; near vertex 0, B is closer. Their centroid depths put B in front globally.
  for (const [x, y, front, behind] of [[64, 22, opaqueA, opaqueB], [24, 103, opaqueB, opaqueA]] as const) {
    const behindOverBase = over(behind, opaqueBase, 0.5);
    const expected = over(front, behindOverBase, 0.5).map(encodeToneMap);
    const actual = pixel(blended, x, y).slice(0, 3);
    for (let k = 0; k < 3; k++) expect(Math.abs(actual[k]! - expected[k]!)).toBeLessThanOrEqual(2);
    expect(pixel(reversed, x, y)).toEqual(pixel(blended, x, y));
  }
});

test('BLEND fragment storage refuses work beyond the fixed explicit upper bound', () => {
  expect(REVIEW_BLEND_FRAGMENT_BUDGET).toBe(1_000_000);
  const transparent = face({ material: material({ alphaMode: 'BLEND', color: [1, 1, 1, 0.5] }) });
  expect(() => renderAppearance(Array.from({ length: 64 }, () => transparent), [0, 0, 0], 2, settings)).toThrow('BLEND fragment budget exceeded');
});
