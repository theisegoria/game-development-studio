import type { RasterImage } from '../inspection/image.js';
import { encodePNG } from '../inspection/image.js';
import { REVIEW_LIMITS, type ReviewSettings } from './settings.js';

export type V3 = [number, number, number];
export interface ReviewTexture { image: RasterImage; wrapS: number; wrapT: number }
export interface ReviewMaterial {
  color: number[]; metallic: number; roughness: number; alphaMode: string; alphaCutoff: number;
  doubleSided: boolean; normalScale: number; emissive: number[]; occlusionStrength: number;
  base?: ReviewTexture; packed?: ReviewTexture; normal?: ReviewTexture; emission?: ReviewTexture; occlusion?: ReviewTexture;
  densityTextureSize?: { width: number; height: number };
}
export interface ReviewFace {
  points: V3[]; normals: V3[]; uv: number[][]; colors: number[][];
  /** Optional transformed glTF tangent vec4s at each corner: world-space xyz plus handedness ±1. */
  tangents?: number[][];
  material: ReviewMaterial; materialIndex: number;
}
export const sub = (a: number[], b: number[]): V3 => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
export const cross = (a: number[], b: number[]): V3 => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
export const dot = (a: number[], b: number[]): number => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
export const unit = (v: number[]): V3 => { const length = Math.hypot(...v); return length > 1e-12 ? [v[0]! / length, v[1]! / length, v[2]! / length] : [0, 0, 1]; };
const clamp = (v: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
const linear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const srgb = (v: number) => 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
function wrap(v: number, mode: number): number {
  if (mode === 33071) return clamp(v, 0, 1 - Number.EPSILON);
  if (mode === 33648) { const t = ((v % 2) + 2) % 2; return t < 1 ? t : 2 - t; }
  return v - Math.floor(v);
}
/** Explicit nearest sampling: no browser/GPU mip or sampler-dependent state. */
function sample(texture: ReviewTexture | undefined, uv: number[]): number[] {
  if (!texture) return [1, 1, 1, 1];
  const image = texture.image;
  const x = Math.min(image.width - 1, Math.floor(wrap(uv[0]!, texture.wrapS) * image.width));
  const y = Math.min(image.height - 1, Math.floor(wrap(uv[1]!, texture.wrapT) * image.height));
  const offset = (y * image.width + x) * 4;
  return [0, 1, 2, 3].map(k => image.data[offset + k]! / 255);
}
const edge = (a: number[], b: number[], p: number[]) => (b[0]! - a[0]!) * (p[1]! - a[1]!) - (b[1]! - a[1]!) * (p[0]! - a[0]!);
function bounds(points: number[][], size: number) {
  return { x0: Math.max(0, Math.floor(Math.min(...points.map(p => p[0]!)))), x1: Math.min(size - 1, Math.ceil(Math.max(...points.map(p => p[0]!)))), y0: Math.max(0, Math.floor(Math.min(...points.map(p => p[1]!)))), y1: Math.min(size - 1, Math.ceil(Math.max(...points.map(p => p[1]!)))) };
}

export interface UvEvidence { channel: 0; gridResolution: 128; coveredFraction: number | null; overlappedFraction: number | null; sampleChecks: number; complete: boolean; outOfTileTriangles: number; missingUvTriangles: number; degenerateUvTriangles: number; density: Array<{ materialIndex: number; surfaceArea: number; uvArea: number; textureWidth: number; textureHeight: number; texelsPerWorldUnit: number }> }
/** Raster occupancy is an estimate of overlapping interiors in the primary tile, not an exact topology test. */
export function measureUv(faces: ReviewFace[]): UvEvidence {
  const size = 128, occupancy = new Uint16Array(size * size), density = new Map<number, { materialIndex: number; surfaceArea: number; uvArea: number; textureWidth: number; textureHeight: number; texelsPerWorldUnit: number }>();
  let sampleChecks = 0, complete = true, outOfTileTriangles = 0, missingUvTriangles = 0, degenerateUvTriangles = 0;
  for (const face of faces) {
    if (face.uv.length !== 3) { missingUvTriangles++; continue; }
    if (face.uv.some(p => p.some(v => v < 0 || v > 1))) outOfTileTriangles++;
    const uvArea = Math.abs(edge(face.uv[0]!, face.uv[1]!, face.uv[2]!)) / 2;
    if (uvArea < 1e-12) { degenerateUvTriangles++; continue; }
    const area = Math.hypot(...cross(sub(face.points[1]!, face.points[0]!), sub(face.points[2]!, face.points[0]!))) / 2;
    const image = face.material.base?.image ?? face.material.densityTextureSize;
    if (image && area > 1e-12) {
      const entry = density.get(face.materialIndex) ?? { materialIndex: face.materialIndex, surfaceArea: 0, uvArea: 0, textureWidth: image.width, textureHeight: image.height, texelsPerWorldUnit: 0 };
      entry.surfaceArea += area; entry.uvArea += uvArea; density.set(face.materialIndex, entry);
    }
    if (!complete) continue;
    const p = face.uv.map(uv => [uv[0]! * size, uv[1]! * size]), b = bounds(p, size), signed = edge(p[0]!, p[1]!, p[2]!);
    const checks = Math.max(0, b.x1 - b.x0 + 1) * Math.max(0, b.y1 - b.y0 + 1);
    if (sampleChecks + checks > REVIEW_LIMITS.uvSamples) { complete = false; continue; }
    sampleChecks += checks;
    for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
      const point = [x + 0.5, y + 0.5];
      // Strictly interior avoids counting shared triangle edges as overlap.
      if ([edge(p[1]!, p[2]!, point), edge(p[2]!, p[0]!, point), edge(p[0]!, p[1]!, point)].every(v => v / signed > 1e-9)) occupancy[y * size + x]!++;
    }
  }
  let covered = 0, overlapped = 0;
  for (const count of occupancy) { if (count) covered++; if (count > 1) overlapped++; }
  for (const entry of density.values()) entry.texelsPerWorldUnit = Math.sqrt(entry.uvArea * entry.textureWidth * entry.textureHeight / entry.surfaceArea);
  return { channel: 0, gridResolution: 128, coveredFraction: complete ? covered / occupancy.length : null, overlappedFraction: complete ? overlapped / occupancy.length : null, sampleChecks, complete, outOfTileTriangles, missingUvTriangles, degenerateUvTriangles, density: [...density.values()] };
}

/** Explicit cap for retained BLEND pixel fragments across all eight views. */
export const REVIEW_BLEND_FRAGMENT_BUDGET = REVIEW_LIMITS.blendFragments;

function validateTangents(face: ReviewFace): void {
  if (face.tangents === undefined) return;
  if (!Array.isArray(face.tangents) || face.tangents.length !== 3 || face.tangents.some(t => !Array.isArray(t) || t.length !== 4 || t.some(v => !Number.isFinite(v)) || Math.hypot(t[0]!, t[1]!, t[2]!) < 1e-12 || (t[3] !== 1 && t[3] !== -1))) {
    throw new Error('Authored tangent frame is unsupported or malformed; expected three finite world-space vec4 tangents with handedness +1 or -1');
  }
}

/** Eight orthographic CPU GGX views with a fixed key, fill, and ambient term. */
export function renderAppearance(faces: ReviewFace[], center: number[], extent: number, settings: ReviewSettings, rasterSampleBudget: number = REVIEW_LIMITS.rasterSamples): { images: string[]; sampleChecks: number } {
  if(!Number.isSafeInteger(rasterSampleBudget) || rasterSampleBudget<0 || rasterSampleBudget>REVIEW_LIMITS.rasterSamples) throw new Error('Invalid bounded appearance raster budget');
  for (const face of faces) validateTangents(face);
  const size = settings.resolution, scale = size * 0.7 / Math.max(extent, 0.00001);
  const images: string[] = []; let sampleChecks = 0, blendFragmentsUsed = 0;
  for (let frame = 0; frame < 8; frame++) {
    const angle = frame * Math.PI / 4, c = Math.cos(angle), s = Math.sin(angle);
    const rotate = (v: number[]): V3 => [c * v[0]! + s * v[2]!, v[1]!, c * v[2]! - s * v[0]!];
    const data = new Uint8Array(size * size * 4), radiances = new Float32Array(size * size * 3), depth = new Float64Array(size * size).fill(-Infinity);
    // Compact linked records avoid retaining a JS object for every translucent sample.
    const blendHeads = new Int32Array(size * size).fill(-1);
    let blendRecords = new Float64Array(0), blendNext = new Int32Array(0), blendCount = 0;
    const background = [21,32,49].map(v => {const l=linear(v/255);return l/(1-l);});
    for (let i = 0; i < radiances.length; i += 3) radiances.set(background,i);
    const projected = faces.map(face => ({ face, points: face.points.map(p => { const v = rotate(sub(p, center)); return [size / 2 + v[0] * scale, size / 2 - v[1] * scale, v[2]]; }), normals: face.normals.map(rotate), tangents: face.tangents?.map(t => [...rotate(t), t[3]!] ) }));
    for (const item of projected) {
      const { face, points: p, normals, tangents: authoredTangents } = item, material = face.material;
      const signed = edge(p[0]!, p[1]!, p[2]!); if (Math.abs(signed) < 1e-8 || (!material.doubleSided && signed > 0)) continue;
      const b = bounds(p, size), checks = Math.max(0, b.x1 - b.x0 + 1) * Math.max(0, b.y1 - b.y0 + 1);
      sampleChecks += checks; if (sampleChecks > rasterSampleBudget) throw new Error('Appearance raster budget exceeded; use a smaller review LOD, fewer animation samples or 128px resolution');
      let uvTangent: V3 | undefined, uvBitangent: V3 | undefined;
      if (material.normal && !authoredTangents) {
        if (face.uv.length !== 3 || face.uv.some(uv => uv.length < 2 || !Number.isFinite(uv[0]) || !Number.isFinite(uv[1]))) throw new Error('Normal mapping without authored tangents requires three finite TEXCOORD_0 coordinates');
        const d1 = sub(face.points[1]!, face.points[0]!), d2 = sub(face.points[2]!, face.points[0]!);
        const u1 = face.uv[1]![0]! - face.uv[0]![0]!, v1 = face.uv[1]![1]! - face.uv[0]![1]!, u2 = face.uv[2]![0]! - face.uv[0]![0]!, v2 = face.uv[2]![1]! - face.uv[0]![1]!;
        const determinant = u1 * v2 - u2 * v1;
        if (Math.abs(determinant) < 1e-10) throw new Error('Normal mapping requires nondegenerate UV triangles');
        // Use the transformed geometry for both UV derivatives. A reflected node reverses T but not necessarily N or B;
        // deriving handedness from the fixed UV determinant alone loses that world-transform parity.
        uvTangent = rotate(d1.map((v, k) => (v * v2 - d2[k]! * v1) / determinant));
        uvBitangent = rotate(d2.map((v, k) => (v * u1 - d1[k]! * u2) / determinant));
        if (Math.hypot(...uvTangent) < 1e-12 || Math.hypot(...uvBitangent) < 1e-12) throw new Error('Normal mapping requires a nondegenerate UV tangent frame');
      }
      for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) {
        const pixel = [x + 0.5, y + 0.5], weights = [edge(p[1]!, p[2]!, pixel) / signed, edge(p[2]!, p[0]!, pixel) / signed, edge(p[0]!, p[1]!, pixel) / signed];
        if (weights.some(w => w < -1e-9)) continue;
        const z = weights.reduce((v, w, k) => v + w * p[k]![2]!, 0), at = y * size + x; if (z <= depth[at]!) continue;
        const mix = (values: number[][], width: number) => Array.from({ length: width }, (_, k) => weights.reduce((v, w, i) => v + w * values[i]![k]!, 0));
        const uv = face.uv.length === 3 ? mix(face.uv, 2) : [0, 0], base = sample(material.base, uv), vertex = mix(face.colors, 4);
        const alpha = material.alphaMode === 'OPAQUE' ? 1 : base[3]! * material.color[3]! * vertex[3]!;
        if (material.alphaMode === 'MASK' && alpha < material.alphaCutoff) continue;
        const unflippedNormal = unit(mix(normals, 3));
        let normal = signed > 0 ? unflippedNormal.map(v => -v) as V3 : unflippedNormal;
        if (material.normal) {
          let tangent: V3, handed: number;
          if (authoredTangents) {
            tangent = mix(authoredTangents.map(t => t.slice(0, 3)), 3) as V3;
            const handedness = mix(authoredTangents.map(t => [t[3]!]), 1)[0]!;
            if (Math.abs(handedness) < 1e-12) throw new Error('Authored tangent handedness is ambiguous at a covered pixel');
            handed = handedness < 0 ? -1 : 1;
          } else {
            tangent = uvTangent!;
            handed = 1;
          }
          const projection = dot(tangent, unflippedNormal), orthogonal = tangent.map((v, k) => v - unflippedNormal[k]! * projection), tangentLength = Math.hypot(...orthogonal);
          if (tangentLength < 1e-12) throw new Error('Normal mapping tangent frame is degenerate at a covered pixel');
          const t = orthogonal.map(v => v / tangentLength) as V3;
          if (!authoredTangents) {
            const orientation = dot(cross(unflippedNormal, t), uvBitangent!);
            if (!Number.isFinite(orientation) || Math.abs(orientation) < 1e-12) throw new Error('UV-derived tangent handedness is degenerate at a covered pixel');
            handed = orientation < 0 ? -1 : 1;
          }
          const bt = cross(normal, t).map(v => v * handed), nm = sample(material.normal, uv);
          const mapped = unit([(nm[0]! * 2 - 1) * material.normalScale, (nm[1]! * 2 - 1) * material.normalScale, nm[2]! * 2 - 1]);
          normal = unit(normal.map((v, k) => t[k]! * mapped[0] + bt[k]! * mapped[1] + v * mapped[2]));
        }
        const albedo = base.slice(0, 3).map((v, k) => (material.base ? linear(v) : 1) * material.color[k]! * vertex[k]!);
        const packed = sample(material.packed, uv), metallic = clamp(material.metallic * packed[2]!), roughness = clamp(material.roughness * packed[1]!, 0.04, 1);
        const color = albedo.map(v => v * (1 - metallic) * 0.08 * (1 - material.occlusionStrength + material.occlusionStrength * sample(material.occlusion, uv)[0]!));
        for (const [direction, intensity] of [[unit([0.5, 0.8, 1]), 2.2], [unit([-0.8, 0.3, 0.5]), 0.65]] as const) {
          const nDotL = Math.max(0, dot(normal, direction)), nDotV = Math.max(0.001, normal[2]); if (!nDotL) continue;
          const half = unit([direction[0], direction[1], direction[2] + 1]), nDotH = Math.max(0, dot(normal, half)), vDotH = Math.max(0, half[2]);
          const a2 = roughness ** 4, denominator = nDotH * nDotH * (a2 - 1) + 1, distribution = a2 / (Math.PI * denominator * denominator);
          const visibility = (2 * nDotL / (nDotL + Math.sqrt(a2 + (1 - a2) * nDotL * nDotL))) * (2 * nDotV / (nDotV + Math.sqrt(a2 + (1 - a2) * nDotV * nDotV)));
          for (let k = 0; k < 3; k++) {
            const f0 = 0.04 * (1 - metallic) + albedo[k]! * metallic, fresnel = f0 + (1 - f0) * (1 - vDotH) ** 5;
            color[k]! += intensity * nDotL * ((1 - fresnel) * (1 - metallic) * albedo[k]! / Math.PI + distribution * visibility * fresnel / (4 * nDotL * nDotV));
          }
        }
        const emission = sample(material.emission, uv);
        const outputColor = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const radiance = (color[k]! + material.emissive[k]! * (material.emission ? linear(emission[k]!) : 1)) * settings.exposure;
          outputColor[k] = radiance;
        }
        if (material.alphaMode === 'BLEND') {
          if (blendFragmentsUsed >= REVIEW_BLEND_FRAGMENT_BUDGET) throw new Error(`Appearance BLEND fragment budget exceeded (${REVIEW_BLEND_FRAGMENT_BUDGET}); reduce transparent coverage or use a smaller review LOD`);
          if (blendCount === blendNext.length) {
            const capacity = Math.min(REVIEW_BLEND_FRAGMENT_BUDGET, Math.max(1024, blendNext.length * 2));
            const records = new Float64Array(capacity * 5); records.set(blendRecords); blendRecords = records;
            const next = new Int32Array(capacity); next.set(blendNext); blendNext = next;
          }
          const index = blendCount++, offset = index * 5;
          blendRecords[offset] = z; blendRecords[offset + 1] = outputColor[0]!; blendRecords[offset + 2] = outputColor[1]!; blendRecords[offset + 3] = outputColor[2]!; blendRecords[offset + 4] = alpha;
          blendNext[index] = blendHeads[at]!; blendHeads[at] = index; blendFragmentsUsed++;
        } else {
          for (let k = 0; k < 3; k++) radiances[at * 3 + k] = outputColor[k]!;
          depth[at] = z;
        }
      }
    }
    const fragmentOrder: number[] = [];
    for (let at = 0; at < blendHeads.length; at++) {
      fragmentOrder.length = 0;
      for (let fragment = blendHeads[at]!; fragment !== -1; fragment = blendNext[fragment]!) {
        const record = fragment * 5;
        if (blendRecords[record]! > depth[at]!) fragmentOrder.push(fragment);
      }
      if (!fragmentOrder.length) continue;
      fragmentOrder.sort((a, b) => blendRecords[a * 5]! - blendRecords[b * 5]! || a - b);
      for (const fragment of fragmentOrder) {
        const offset = fragment * 5, alpha = blendRecords[offset + 4]!;
        for (let k = 0; k < 3; k++) {
          const radianceOffset = at * 3 + k;
          radiances[radianceOffset] = blendRecords[offset + 1 + k]! * alpha + radiances[radianceOffset]! * (1 - alpha);
        }
      }
    }
    for(let at=0;at<size*size;at++) {for(let k=0;k<3;k++){const value=radiances[at*3+k]!;data[at*4+k]=Math.round(srgb(clamp(value/(1+value))));}data[at*4+3]=255;}
    images.push(`data:image/png;base64,${Buffer.from(encodePNG({ width: size, height: size, data })).toString('base64')}`);
  }
  return { images, sampleChecks };
}
