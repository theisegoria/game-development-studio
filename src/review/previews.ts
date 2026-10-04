import { readReviewDocument } from './document.js';
import { type Skin, type Texture, type TextureInfo } from '@gltf-transform/core';
import { readImageSize } from '../inspection/gltf.js';
import { decodeImage, encodePNG } from '../inspection/image.js';
import { reviewSettingsSchema, REVIEW_LIMITS, REVIEW_RENDERER, type ReviewSettingsInput } from './settings.js';
import { applyReviewPose, type ClipInfo } from './pose.js';
import { cross, sub, unit, measureUv, renderAppearance, type ReviewFace, type ReviewMaterial, type ReviewTexture, type UvEvidence, type V3 } from './appearance.js';
import { buildGeometryViews, type GeometryViewSampling } from './geometry-views.js';

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const DEFAULT_VERTEX_COLOR: number[] = [1, 1, 1, 1];
export interface CpuPreviews {
  turns: string[]; wireframes: string[]; uv: string; appearance: string[];
  materials: Array<{ name: string; color: string; metallic: number; roughness: number; texture?: string }>;
  framing: { policy: 'default-pose' | 'manual'; center: number[]; extent: number; referenceBounds: {minimum:number[];maximum:number[]}; posedBounds:{minimum:number[];maximum:number[]}; clippedViews:number[] };
  warnings: string[]; uvEvidence: UvEvidence; clips: ClipInfo[]; selectedTimeSeconds?: number;
  envelope: { sourceBytes: number; triangles: number; vertexInstances: number; appearanceTrianglesRendered: number; decodedTexturePixels: number; rasterSampleChecks: number; boundsTrianglesScanned: number; clippingPointChecks: number; uvMetricsTriangles: number; auxiliarySvgBytes: number; appearanceImageStringBytes: number; auxiliaryGeometry: GeometryViewSampling; durationMs: number; geometryPasses: number; limits: typeof REVIEW_LIMITS };
  renderer: typeof REVIEW_RENDERER;
}
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img"><rect width="400" height="400" fill="#152031"/>${body}</svg>`;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const multiply = (a: number[], b: number[]) => Array.from({ length: 16 }, (_, i) => { const r = i % 4, c = Math.floor(i / 4); return [0, 1, 2, 3].reduce((sum, k) => sum + a[k * 4 + r]! * b[c * 4 + k]!, 0); });
function transform(m: number[], p: number[]): V3 {
  return [
    m[0]! * p[0]! + m[4]! * p[1]! + m[8]! * p[2]! + m[12]!,
    m[1]! * p[0]! + m[5]! * p[1]! + m[9]! * p[2]! + m[13]!,
    m[2]! * p[0]! + m[6]! * p[1]! + m[10]! * p[2]! + m[14]!,
  ];
}
function normalTransform(m: number[], n: number[]): V3 {
  const a = [m[0]!, m[1]!, m[2]!], b = [m[4]!, m[5]!, m[6]!], c = [m[8]!, m[9]!, m[10]!];
  const x = cross(b, c), y = cross(c, a), z = cross(a, b), det = a.reduce((v, k, i) => v + k * x[i]!, 0);
  if (Math.abs(det) < 1e-12) throw new Error('Singular transform cannot provide appearance normals');
  return unit([0, 1, 2].map(k => (x[k]! * n[0]! + y[k]! * n[1]! + z[k]! * n[2]!) / det));
}

/** Bounded CPU review. No process, network, GPU or external resource loading. */
export async function previewGlb(bytes: Uint8Array, input: ReviewSettingsInput = {}): Promise<CpuPreviews> {
  const started = performance.now(), settings = reviewSettingsSchema.parse(input);
  const { doc, warnings } = await readReviewDocument(bytes, settings.mode), root = doc.getRoot();
  warnings.push('CPU preview is review evidence, not target-engine correctness or artistic approval. Fixed orthographic lighting; nearest texture sampling; no IBL, shadows or refraction. BLEND is depth-sorted per pixel within a fixed fragment budget; exactly equal-depth intersections remain approximate.');
  let texturePixels = 0, textureBytes = 0;
  const textureCache = new Map<Texture, ReviewTexture>();
  function texture(t: Texture | null, info: TextureInfo | null): ReviewTexture | undefined {
    if (!t) return undefined;
    if (info && info.getTexCoord() !== 0) throw new Error('Appearance texture mapping supports TEXCOORD_0 only');
    let result = textureCache.get(t);
    if (!result) {
      const imageBytes = t.getImage(), size = imageBytes && readImageSize(imageBytes);
      if (!imageBytes || !size || size.width * size.height > REVIEW_LIMITS.texturePixels) throw new Error('Review texture is unsupported or exceeds the 4 million pixel limit; use embedded PNG/JPEG review textures');
      if (texturePixels + size.width * size.height > REVIEW_LIMITS.decodedTexturePixels || textureBytes + imageBytes.byteLength > REVIEW_LIMITS.textureBytes) throw new Error('Review total texture budget exceeded; use a smaller review LOD');
      const image = decodeImage(imageBytes);
      if(image.width!==size.width||image.height!==size.height)throw new Error('Decoded review texture dimensions differ from preflight');
      texturePixels += image.width * image.height; textureBytes += imageBytes.byteLength;
      result = { image, wrapS: info?.getWrapS() ?? 10497, wrapT: info?.getWrapT() ?? 10497 }; textureCache.set(t, result);
    }
    return { ...result, wrapS: info?.getWrapS() ?? 10497, wrapT: info?.getWrapT() ?? 10497 };
  }
  const unitFactor = (value: unknown, label: string): number => {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid material ${label}: expected a finite number from 0 through 1`);
    return value;
  };
  const materialMap = new Map(root.listMaterials().map((m, index) => {
    const color = m.getBaseColorFactor(); if (!Array.isArray(color) || color.length !== 4) throw new Error('Invalid material baseColorFactor');
    color.forEach(v => unitFactor(v, 'baseColorFactor'));
    const metallic = unitFactor(m.getMetallicFactor(), 'metallicFactor'), roughness = unitFactor(m.getRoughnessFactor(), 'roughnessFactor');
    const alphaMode = m.getAlphaMode(); if (!['OPAQUE', 'MASK', 'BLEND'].includes(alphaMode)) throw new Error('Invalid material alphaMode');
    const alphaCutoff = unitFactor(m.getAlphaCutoff(), 'alphaCutoff'), normalScale = m.getNormalScale();
    if (!Number.isFinite(normalScale) || normalScale < 0 || normalScale > 10) throw new Error('Invalid material normalScale (review range 0–10)');
    const emissive = m.getEmissiveFactor(); emissive.forEach(v => unitFactor(v, 'emissiveFactor'));
    const entry: ReviewMaterial = { color, metallic, roughness, alphaMode, alphaCutoff, normalScale, emissive, doubleSided: m.getDoubleSided(), occlusionStrength: unitFactor(m.getOcclusionStrength(), 'occlusionStrength') };
    const baseBytes=m.getBaseColorTexture()?.getImage();const baseSize=baseBytes&&readImageSize(baseBytes);
    if(baseSize && (m.getBaseColorTextureInfo()?.getTexCoord()??0)===0)entry.densityTextureSize=baseSize;
    if (settings.mode === 'appearance') {
      entry.base = texture(m.getBaseColorTexture(), m.getBaseColorTextureInfo()); entry.packed = texture(m.getMetallicRoughnessTexture(), m.getMetallicRoughnessTextureInfo());
      entry.normal = texture(m.getNormalTexture(), m.getNormalTextureInfo()); entry.emission = texture(m.getEmissiveTexture(), m.getEmissiveTextureInfo()); entry.occlusion = texture(m.getOcclusionTexture(), m.getOcclusionTextureInfo());
    }
    return [m, { material: entry, index }] as const;
  }));
  if (settings.mode === 'appearance' && root.listMaterials().length > REVIEW_LIMITS.materials) throw new Error('Appearance review supports at most 32 materials');
  const selectedScene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!selectedScene) throw new Error('Review requires a scene');
  const scene = selectedScene;
  function collectGeometry() {
  const faces: ReviewFace[] = [];
  let vertexInstances = 0, skinVertices = 0, morphVertices = 0, jointCount = 0, morphEvaluations = 0;
  const skinMatrices = new Map<Skin, number[][]>();
  const positionScratch: number[] = [], normalScratch: number[] = [], tangentScratch: number[] = [], uvScratch: number[] = [], colorScratch: number[] = [];
  const fallback: ReviewMaterial = { color: [0.6, 0.7, 0.8, 1], metallic: 1, roughness: 1, alphaMode: 'OPAQUE', alphaCutoff: 0.5, doubleSided: false, normalScale: 1, emissive: [0, 0, 0], occlusionStrength: 1 };
  scene.traverse(node => {
    const matrix: number[] = node.getWorldMatrix(), skin = node.getSkin();
    if (skin && skin.listJoints().length > 256) throw new Error('Review skin joint budget is 256');
    let jointMatrices = skin ? skinMatrices.get(skin) : undefined;
    if (skin && !jointMatrices) {
      jointCount += skin.listJoints().length;
      if (jointCount > REVIEW_LIMITS.jointMatrices) throw new Error('Review cumulative joint matrix budget exceeded');
      const inverse = skin.getInverseBindMatrices(); if (inverse && inverse.getCount() !== skin.listJoints().length) throw new Error('Invalid inverse bind matrix count');
      jointMatrices = skin.listJoints().map((joint, k) => multiply(joint.getWorldMatrix(), inverse?.getElement(k, [] as number[]) ?? identity)); skinMatrices.set(skin, jointMatrices);
    }
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const pos = primitive.getAttribute('POSITION');
      if (!pos || primitive.getMode() !== 4) { warnings.push('Skipped a non-triangle primitive or missing POSITION'); continue; }
      vertexInstances += pos.getCount(); if (vertexInstances > REVIEW_LIMITS.vertices) throw new Error(`CPU review vertex instance limit is ${REVIEW_LIMITS.vertices.toLocaleString('en-US')}; prepare a review LOD first`);
      const indices = primitive.getIndices(), uv = primitive.getAttribute('TEXCOORD_0'), normals = primitive.getAttribute('NORMAL'), colors = primitive.getAttribute('COLOR_0'), tangents = normals ? primitive.getAttribute('TANGENT') : null;
      if (tangents && (tangents.getElementSize() !== 4 || tangents.getCount() !== pos.getCount())) throw new Error('Invalid authored tangent accessor');
      const jointIndices = primitive.getAttribute('JOINTS_0'), jointWeights = primitive.getAttribute('WEIGHTS_0'), targets = primitive.listTargets();
      if (targets.length > 16) throw new Error('Review morph target budget is 16 per primitive');
      if (primitive.getAttribute('JOINTS_1') || primitive.getAttribute('WEIGHTS_1')) throw new Error('Review skinning supports four influences per vertex only');
      if (skin && (!jointIndices || !jointWeights || !jointMatrices?.length)) throw new Error('Malformed skinning attributes');
      const weights = node.getWeights().length ? node.getWeights() : node.getMesh()?.getWeights() ?? [];
      if (weights.length > targets.length || !weights.every(Number.isFinite)) throw new Error('Invalid morph weights');
      const count = indices?.getCount() ?? pos.getCount(), materialEntry = primitive.getMaterial() && materialMap.get(primitive.getMaterial()!);
      morphEvaluations += count * targets.length;
      if (morphEvaluations > REVIEW_LIMITS.morphEvaluations) throw new Error('Review cumulative morph evaluation budget exceeded');
      const material = materialEntry ? materialEntry.material : fallback;
      if (count % 3) throw new Error('Triangle index count is not divisible by three');
      if (settings.mode === 'appearance' && !uv && [material.base, material.packed, material.normal, material.emission, material.occlusion].some(Boolean)) throw new Error('Texture-mapped appearance requires TEXCOORD_0');
      for (let i = 0; i < count; i += 3) {
        if (faces.length >= REVIEW_LIMITS.triangles) throw new Error(`CPU review triangle limit is ${REVIEW_LIMITS.triangles.toLocaleString('en-US')}; prepare a review LOD first`);
        const points: V3[] = [], faceNormals: V3[] = [], uvs: number[][] = [], vertexColors: number[][] = [], faceTangents: number[][] = [];
        for (let k = 0; k < 3; k++) {
          const index = indices ? indices.getScalar(i + k) : i + k;
          if (!Number.isInteger(index) || index < 0 || index >= pos.getCount()) throw new Error('Invalid review vertex index');
          const p: number[] = pos.getElement(index, positionScratch), n: number[] | undefined = normals?.getElement(index, normalScratch), tangent = tangents?.getElement(index, tangentScratch);
          if (tangent && (tangent.length !== 4 || !tangent.every(Number.isFinite) || ![-1, 1].includes(tangent[3]!))) throw new Error('Malformed authored tangent');
          for (const [t, target] of targets.entries()) {
            const weight = weights[t] ?? 0, delta = target.getAttribute('POSITION')?.getElement(index, []), deltaNormal = target.getAttribute('NORMAL')?.getElement(index, []);
            if (delta) p.forEach((v, j) => { p[j] = v + weight * delta[j]!; });
            if (n && deltaNormal) n.forEach((v, j) => { n[j] = v + weight * deltaNormal[j]!; });
            const deltaTangent = normals ? target.getAttribute('TANGENT')?.getElement(index, []) : undefined;
            if (deltaTangent) {
              if (!tangent || deltaTangent.length !== 3 || !deltaTangent.every(Number.isFinite)) throw new Error('Morph tangent requires a valid authored tangent and finite vec3 delta');
              for (let j = 0; j < 3; j++) tangent[j] = tangent[j]! + weight * deltaTangent[j]!;
            }
          }
          let vertexMatrix = matrix;
          if (skin && jointIndices && jointWeights && jointMatrices) {
            const joints = jointIndices.getElement(index, []), influences = jointWeights.getElement(index, []), sum = influences.reduce((v, w) => v + w, 0);
            if (joints.length !== 4 || influences.length !== 4 || !influences.every(v => Number.isFinite(v) && v >= 0) || Math.abs(sum - 1) > 0.01) throw new Error('Invalid skin influences; weights must sum to one');
            vertexMatrix = new Array<number>(16).fill(0);
            influences.forEach((w, j) => { const joint = joints[j]!; if (!Number.isInteger(joint) || !jointMatrices[joint]) throw new Error('Skin joint index out of range'); jointMatrices[joint]!.forEach((v, m) => { vertexMatrix[m]! += v * w / sum; }); }); skinVertices++;
          }
          if(!vertexMatrix.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e12))throw new Error('Review transform exceeds finite numeric envelope (absolute coefficients ≤ 1e12)');
          const world = transform(vertexMatrix, p); if (!world.every(v=>Number.isFinite(v)&&Math.abs(v)<=1e12)) throw new Error('Non-finite or out-of-envelope geometry cannot be previewed (absolute world coordinates ≤ 1e12)'); points.push(world);
          if (n) { if (!n.every(Number.isFinite)) throw new Error('Non-finite normals'); faceNormals.push(normalTransform(vertexMatrix, n)); }
          if (tangent) {
            const a = [vertexMatrix[0]!, vertexMatrix[1]!, vertexMatrix[2]!], b = [vertexMatrix[4]!, vertexMatrix[5]!, vertexMatrix[6]!], c = [vertexMatrix[8]!, vertexMatrix[9]!, vertexMatrix[10]!], bc = cross(b, c);
            const determinant = a.reduce((sum, value, k) => sum + value * bc[k]!, 0);
            const direction = [0, 1, 2].map(k => vertexMatrix[k]! * tangent[0]! + vertexMatrix[k + 4]! * tangent[1]! + vertexMatrix[k + 8]! * tangent[2]!);
            if (!direction.every(Number.isFinite) || Math.hypot(...direction) < 1e-12 || !Number.isFinite(determinant) || Math.abs(determinant) < 1e-12) throw new Error('Singular or invalid authored tangent transform');
            faceTangents.push([...unit(direction), tangent[3]! * Math.sign(determinant)]);
          }
          if (uv) { uvScratch.length = 0; const value = uv.getElement(index, uvScratch); if (value.length !== 2 || !value.every(Number.isFinite)) throw new Error('Non-finite UV coordinates'); uvs.push([...value]); }
          let vertexColor = DEFAULT_VERTEX_COLOR;
          if (colors) { colorScratch.length = 0; vertexColor = colors.getElement(index, colorScratch); if (vertexColor.length === 3) vertexColor.push(1); }
          if (vertexColor.length !== 4 || !vertexColor.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('Invalid vertex color'); vertexColors.push(colors ? [...vertexColor] : DEFAULT_VERTEX_COLOR);
          if (targets.length) morphVertices++;
        }
        if (!faceNormals.length) { const n = unit(cross(sub(points[1]!, points[0]!), sub(points[2]!, points[0]!))); faceNormals.push(n, n, n); }
        faces.push({ points, normals: faceNormals, uv: uvs, colors: vertexColors, material, materialIndex: materialEntry ? materialEntry.index : -1, ...(faceTangents.length ? { tangents: faceTangents } : {}) });
      }
    }
  });
  if (!faces.length) throw new Error('No triangle geometry available');
  return { faces, vertexInstances, skinVertices, morphVertices };
  }
  const reference = collectGeometry(), referenceTriangleCount = reference.faces.length;
  const frameBounds = (faces: ReviewFace[]) => {
    const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
    for (const face of faces) for (const point of face.points) for (let k = 0; k < 3; k++) { minimum[k] = Math.min(minimum[k]!, point[k]!); maximum[k] = Math.max(maximum[k]!, point[k]!); }
    return { minimum, maximum };
  };
  const referenceBounds = frameBounds(reference.faces);
  const pose = applyReviewPose(doc, settings.pose);
  if (pose.clips.length && !settings.pose) warnings.push('Animation clips are inventoried; displayed geometry uses the default pose. Select clipIndex/timeSeconds for a reproducible sample.');
  if (settings.pose) reference.faces.length = 0;
  const currentGeometry = settings.pose ? collectGeometry() : reference;
  const { faces, vertexInstances, skinVertices, morphVertices } = currentGeometry;
  const geometryViews = buildGeometryViews(faces, REVIEW_LIMITS.auxiliaryTriangles);
  const geometryFaces = geometryViews.faces;
  if (geometryViews.sampling.sampled) warnings.push(`Auxiliary turntable, wireframe and UV diagrams uniformly sample ${geometryViews.sampling.auxiliaryRenderedTriangles.toLocaleString('en-US')} of ${geometryViews.sampling.sourceAppearanceTriangles.toLocaleString('en-US')} source appearance triangles; appearance rendering, geometry bounds, clipping and UV measurements use all source triangles.`);
  if (skinVertices) warnings.push(`CPU linear blend skinning evaluated ${skinVertices} triangle vertex references (four influences); normal transforms approximate deformed surface normals.`);
  if (morphVertices) warnings.push(`Morph POSITION/NORMAL/TANGENT evaluated ${morphVertices} triangle vertex references; tangent frames are re-orthogonalized per pixel.`);
  const { minimum, maximum } = referenceBounds;
  const center = settings.framing?.center ?? minimum.map((v, k) => (v + maximum[k]!) / 2), extent = settings.framing?.extent ?? Math.max(...maximum.map((v, k) => v - minimum[k]!)), scale = 280 / Math.max(0.00001, extent);
  const clippedViews: number[] = []; let clippingPointChecks = 0;
  for (let view = 0; view < 8; view++) {
    const angle = view * Math.PI / 4, limit = Math.max(extent, 0.00001) / 1.4;
    let clipped = false;
    for (const face of faces) {
      for (const point of face.points) {
        clippingPointChecks++;
        const p = sub(point, center);
        if (Math.abs(p[0] * Math.cos(angle) + p[2] * Math.sin(angle)) > limit || Math.abs(p[1]) > limit) { clipped = true; break; }
      }
      if (clipped) break;
    }
    if (clipped) clippedViews.push(view);
  }
  const framing = { policy: settings.framing ? 'manual' as const : 'default-pose' as const, center, extent, referenceBounds, posedBounds: frameBounds(faces), clippedViews };
  if (clippedViews.length) warnings.push(`Geometry extends beyond the fixed review frame in views ${clippedViews.join(', ')}; choose an explicit shared framing center/extent to inspect it. Pose motion/scale is never auto-fitted away.`);
  if(![...center,extent,scale].every(Number.isFinite))throw new Error('Non-finite derived review bounds');
  const turns: string[] = [], wireframes: string[] = [];
  for (let frame = 0; frame < 8; frame++) {
    const angle = frame * Math.PI / 4;
    const projected = geometryFaces.map(f => ({ ...f, p: f.points.map(p => { const [x, y, z] = sub(p, center); return [(x * Math.cos(angle) + z * Math.sin(angle)) * scale + 200, 200 - y * scale, z * Math.cos(angle) - x * Math.sin(angle)]; }) })).sort((a, b) => a.p.reduce((v, p) => v + p[2]!, 0) - b.p.reduce((v, p) => v + p[2]!, 0));
    for (const wire of [false, true]) {
      const body = projected.map(f => `<polygon points="${f.p.map(p => `${p[0]!.toFixed(2)},${p[1]!.toFixed(2)}`).join(' ')}" fill="${wire ? 'none' : `rgb(${f.material.color.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`}" stroke="${wire ? '#a8e2ff' : '#253247'}" stroke-width="0.5"/>`).join('');
      (wire ? wireframes : turns).push(svg(body));
    }
  }
  const uv = svg(geometryFaces.filter(f => f.uv.length === 3).map(f => `<polygon points="${f.uv.map(p => `${(p[0]! * 360 + 20).toFixed(2)},${(380 - p[1]! * 360).toFixed(2)}`).join(' ')}" fill="none" stroke="#a8e2ff" stroke-width="0.6"/>`).join(''));
  if (root.listMaterials().length > 32) warnings.push('Only the first 32 material swatches are shown');
  let swatchBytes = 0;
  const swatchCache = new Map<Texture,string>();
  const materials = root.listMaterials().slice(0, 32).map(m => {
    const t = m.getBaseColorTexture(); let swatch: string | undefined;
    if (t) {
      try {
        const cached = swatchCache.get(t);
        const value = cached ?? `data:image/png;base64,${Buffer.from(encodePNG(texture(t,null)!.image)).toString('base64')}`;
        swatchCache.set(t,value);
        if (swatchBytes + value.length <= 8_000_000) { swatch = value; swatchBytes += value.length; }
        else warnings.push('Material swatch embedding budget exceeded');
      } catch { warnings.push('A material texture could not be decoded within the review budget'); }
    }
    return { name: m.getName(), color: m.getBaseColorFactor().join(', '), metallic: m.getMetallicFactor(), roughness: m.getRoughnessFactor(), ...(swatch ? { texture: swatch } : {}) };
  });
  const appearance = settings.mode === 'appearance' ? renderAppearance(faces, center, extent, settings) : { images: [], sampleChecks: 0 };
  if (settings.mode === 'appearance') warnings.push('Authored tangent frames are used when present; missing frames use per-triangle UV-derived tangents and can differ from MikkTSpace seams.');
  const uvEvidence = measureUv(faces);
  const auxiliarySvgBytes = Buffer.byteLength([...turns, ...wireframes, uv].join(''), 'utf8');
  const appearanceImageStringBytes = appearance.images.reduce((total, image) => total + Buffer.byteLength(image, 'utf8'), 0);
  return { turns, wireframes, uv, materials, appearance: appearance.images, warnings, uvEvidence, framing, ...pose, renderer: REVIEW_RENDERER, envelope: { sourceBytes: bytes.byteLength, triangles: faces.length, vertexInstances, appearanceTrianglesRendered: appearance.images.length ? faces.length : 0, decodedTexturePixels: texturePixels, rasterSampleChecks: appearance.sampleChecks, boundsTrianglesScanned: referenceTriangleCount + faces.length, clippingPointChecks, uvMetricsTriangles: faces.length, auxiliarySvgBytes, appearanceImageStringBytes, auxiliaryGeometry: geometryViews.sampling, durationMs: Math.round(performance.now() - started), geometryPasses: settings.pose ? 2 : 1, limits: REVIEW_LIMITS } };
}
