import { NodeIO, type Skin, type Texture, type TextureInfo } from '@gltf-transform/core';
import { CollectingLogger, readImageSize } from '../inspection/gltf.js';
import { decodeImage, encodePNG } from '../inspection/image.js';
import { reviewSettingsSchema, REVIEW_LIMITS, REVIEW_RENDERER, type ReviewSettingsInput } from './settings.js';
import { applyReviewPose, type ClipInfo } from './pose.js';
import { cross, sub, unit, measureUv, renderAppearance, type ReviewFace, type ReviewMaterial, type ReviewTexture, type UvEvidence, type V3 } from './appearance.js';

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export interface CpuPreviews {
  turns: string[]; wireframes: string[]; uv: string; appearance: string[];
  materials: Array<{ name: string; color: string; metallic: number; roughness: number; texture?: string }>;
  warnings: string[]; uvEvidence: UvEvidence; clips: ClipInfo[]; selectedTimeSeconds?: number;
  envelope: { sourceBytes: number; triangles: number; vertexInstances: number; decodedTexturePixels: number; rasterSampleChecks: number; durationMs: number; limits: typeof REVIEW_LIMITS };
  renderer: typeof REVIEW_RENDERER;
}
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img"><rect width="400" height="400" fill="#152031"/>${body}</svg>`;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const multiply = (a: number[], b: number[]) => Array.from({ length: 16 }, (_, i) => { const r = i % 4, c = Math.floor(i / 4); return [0, 1, 2, 3].reduce((sum, k) => sum + a[k * 4 + r]! * b[c * 4 + k]!, 0); });
function transform(m: number[], p: number[]): V3 { return [0, 1, 2].map(r => m[r]! * p[0]! + m[r + 4]! * p[1]! + m[r + 8]! * p[2]! + m[r + 12]!) as V3; }
function normalTransform(m: number[], n: number[]): V3 {
  const a = [m[0]!, m[1]!, m[2]!], b = [m[4]!, m[5]!, m[6]!], c = [m[8]!, m[9]!, m[10]!];
  const x = cross(b, c), y = cross(c, a), z = cross(a, b), det = a.reduce((v, k, i) => v + k * x[i]!, 0);
  if (Math.abs(det) < 1e-12) throw new Error('Singular transform cannot provide appearance normals');
  return unit([0, 1, 2].map(k => (x[k]! * n[0]! + y[k]! * n[1]! + z[k]! * n[2]!) / det));
}

/** Bounded CPU review. No process, network, GPU or external resource loading. */
export async function previewGlb(bytes: Uint8Array, input: ReviewSettingsInput = {}): Promise<CpuPreviews> {
  const started = performance.now(), settings = reviewSettingsSchema.parse(input);
  if (bytes.byteLength > REVIEW_LIMITS.sourceBytes) throw new Error('Review GLB size limit is 64 MB');
  const log = new CollectingLogger(), io = new NodeIO().setLogger(log), json = await io.binaryToJSON(bytes);
  // Bound allocations and graph traversal before NodeIO expands sparse accessors.
  const rawNodes = json.json.nodes ?? [];
  if (rawNodes.length > 10_000 || (json.json.meshes?.length??0)>10_000 || (json.json.materials?.length??0)>1024 || (json.json.skins?.length??0)>256 || (json.json.textures?.length??0)>1024 || (json.json.images?.length??0)>1024 || (json.json.samplers?.length??0)>1024 || (json.json.cameras?.length??0)>256 || (json.json.bufferViews?.length??0)>8192 || (json.json.buffers?.length??0)>256 || (json.json.accessors?.length??0)>4096 || (json.json.scenes?.length??0)>128) throw new Error('Review scene object budget exceeded');
  if((json.json.animations?.length??0)>REVIEW_LIMITS.animationClips)throw new Error('Review animation clip budget exceeded');
  let rawPrimitives=0,rawChannels=0,rawSamplers=0,rawTargets=0;
  for(const mesh of json.json.meshes??[])for(const primitive of mesh.primitives){
    rawPrimitives++;const count=primitive.targets?.length??0;rawTargets+=count;
    if(count>16 || rawTargets>4096)throw new Error('Review morph target budget exceeded');
    if(rawPrimitives>10_000)throw new Error('Review primitive budget exceeded');
  }
  for(const animation of json.json.animations??[]){rawChannels+=animation.channels.length;rawSamplers+=animation.samplers.length;if(rawChannels>REVIEW_LIMITS.animationChannels||rawSamplers>1024)throw new Error('Review animation channel/sampler budget exceeded');}
  let encodedImageCopies=0;
  for(const image of json.json.images??[]){
    const encodedBytes=image.bufferView!==undefined?json.json.bufferViews?.[image.bufferView]?.byteLength:typeof image.uri==='string'?(json.resources[image.uri]?.byteLength??Buffer.byteLength(image.uri)):0;
    if(encodedBytes===undefined||!Number.isInteger(encodedBytes)||encodedBytes<0)throw new Error('Invalid embedded review image');
    encodedImageCopies+=encodedBytes;
    if(encodedImageCopies>REVIEW_LIMITS.textureBytes)throw new Error('Review encoded image copy budget exceeded; prepare smaller review textures');
  }
  const parents = new Uint16Array(rawNodes.length);
  for (const node of rawNodes) for (const child of node.children ?? []) {
    if (!Number.isInteger(child) || child < 0 || child >= rawNodes.length || ++parents[child]! > 1) throw new Error('Invalid review node hierarchy');
  }
  const pending = rawNodes.flatMap((_, i) => parents[i] === 0 ? [{ index: i, depth: 0 }] : []); let visited = 0;
  while (pending.length) {
    const item = pending.pop()!; if (item.depth > 128) throw new Error('Review node hierarchy depth exceeds 128'); visited++;
    for (const child of rawNodes[item.index]!.children ?? []) pending.push({ index: child, depth: item.depth + 1 });
  }
  if (visited !== rawNodes.length) throw new Error('Cyclic review node hierarchy');
  const validNodeIndex = (index: unknown): index is number => typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < rawNodes.length;
  let rawJointReferences = 0;
  for (const skin of json.json.skins ?? []) {
    if (!Array.isArray(skin.joints) || !skin.joints.length || skin.joints.length > 256 || (rawJointReferences += skin.joints.length) > REVIEW_LIMITS.jointMatrices) throw new Error('Review skin joint reference budget exceeded');
    if (!skin.joints.every(validNodeIndex) || new Set(skin.joints).size !== skin.joints.length) throw new Error('Invalid review skin joints');
    if (skin.skeleton !== undefined && !validNodeIndex(skin.skeleton)) throw new Error('Invalid review skin skeleton');
    if (skin.inverseBindMatrices !== undefined && (!Number.isSafeInteger(skin.inverseBindMatrices) || skin.inverseBindMatrices < 0 || skin.inverseBindMatrices >= (json.json.accessors?.length ?? 0))) throw new Error('Invalid review inverse bind accessor');
  }
  let rawSceneReferences = 0;
  for (const scene of json.json.scenes ?? []) {
    const nodes = scene.nodes ?? [];
    if (!Array.isArray(nodes) || nodes.length > rawNodes.length || (rawSceneReferences += nodes.length) > 10_000) throw new Error('Review scene root reference budget exceeded');
    if (!nodes.every(index => validNodeIndex(index) && parents[index] === 0) || new Set(nodes).size !== nodes.length) throw new Error('Invalid review scene roots');
  }
  if (json.json.scene !== undefined && (!Number.isSafeInteger(json.json.scene) || json.json.scene < 0 || json.json.scene >= (json.json.scenes?.length ?? 0))) throw new Error('Invalid default review scene');
  let accessorScalars = 0;
  for (const accessor of json.json.accessors ?? []) {
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }[accessor.type];
    if (typeof width !== 'number' || !Number.isSafeInteger(accessor.count) || accessor.count < 0) throw new Error('Invalid review accessor');
    accessorScalars += width * accessor.count;
    if (accessorScalars > REVIEW_LIMITS.accessorScalars) throw new Error('Review accessor allocation budget exceeded');
    if (accessor.sparse !== undefined) {
      const sparse = accessor.sparse;
      const validView = (index: unknown): index is number => typeof index === 'number' && Number.isSafeInteger(index) && index >= 0 && index < (json.json.bufferViews?.length ?? 0);
      if (!sparse || !Number.isSafeInteger(sparse.count) || sparse.count <= 0 || sparse.count > accessor.count
        || !validView(sparse.indices?.bufferView) || !validView(sparse.values?.bufferView)
        || ![5121, 5123, 5125].includes(sparse.indices?.componentType)
        || ![sparse.indices?.byteOffset ?? 0, sparse.values?.byteOffset ?? 0].every(offset => Number.isSafeInteger(offset) && offset >= 0)) throw new Error('Invalid review sparse accessor');
    }
  }
  const used = json.json.extensionsUsed ?? [], required = json.json.extensionsRequired ?? [];
  if (required.length) throw new Error(`Unsupported required review extensions: ${required.join(', ')}`);
  if (settings.mode === 'appearance' && used.length) throw new Error(`Appearance review does not support extensions: ${used.join(', ')}; prepare a core glTF review LOD explicitly`);
  const doc = await io.readJSON(json), root = doc.getRoot();
  if (root.listNodes().length > 10_000 || root.listMeshes().length > 10_000 || root.listMaterials().length > 1024) throw new Error('Review scene object budget exceeded');
  const warnings = [...log.messages];
  if (used.length) warnings.push(`Geometry-only preview ignores unsupported extensions: ${used.join(', ')}`);
  warnings.push('CPU preview is review evidence, not target-engine correctness or artistic approval. Fixed orthographic lighting; nearest texture sampling; no IBL, shadows, refraction, mipmaps or exact intersecting transparency.');
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
  const pose = applyReviewPose(doc, settings.pose);
  if (pose.clips.length && !settings.pose) warnings.push('Animation clips are inventoried; displayed geometry uses the default pose. Select clipIndex/timeSeconds for a reproducible sample.');
  const faces: ReviewFace[] = [], scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('Review requires a scene');
  let vertexInstances = 0, skinVertices = 0, morphVertices = 0, jointCount = 0, morphEvaluations = 0;
  const skinMatrices = new Map<Skin, number[][]>();
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
      vertexInstances += pos.getCount(); if (vertexInstances > REVIEW_LIMITS.vertices) throw new Error('CPU review vertex instance limit is 30,000; prepare a review LOD first');
      const indices = primitive.getIndices(), uv = primitive.getAttribute('TEXCOORD_0'), normals = primitive.getAttribute('NORMAL'), colors = primitive.getAttribute('COLOR_0');
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
        if (faces.length >= REVIEW_LIMITS.triangles) throw new Error('CPU review limit is 10,000 triangles; prepare a review LOD first');
        const points: V3[] = [], faceNormals: V3[] = [], uvs: number[][] = [], vertexColors: number[][] = [];
        for (let k = 0; k < 3; k++) {
          const index = indices ? indices.getScalar(i + k) : i + k;
          if (!Number.isInteger(index) || index < 0 || index >= pos.getCount()) throw new Error('Invalid review vertex index');
          const p: number[] = pos.getElement(index, [] as number[]), n: number[] | undefined = normals?.getElement(index, [] as number[]);
          for (const [t, target] of targets.entries()) {
            const weight = weights[t] ?? 0, delta = target.getAttribute('POSITION')?.getElement(index, []), deltaNormal = target.getAttribute('NORMAL')?.getElement(index, []);
            if (delta) p.forEach((v, j) => { p[j] = v + weight * delta[j]!; });
            if (n && deltaNormal) n.forEach((v, j) => { n[j] = v + weight * deltaNormal[j]!; });
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
          if (uv) { const value = uv.getElement(index, []); if (value.length !== 2 || !value.every(Number.isFinite)) throw new Error('Non-finite UV coordinates'); uvs.push(value); }
          const vertexColor = colors?.getElement(index, []) ?? [1, 1, 1, 1]; if (vertexColor.length === 3) vertexColor.push(1);
          if (vertexColor.length !== 4 || !vertexColor.every(v => Number.isFinite(v) && v >= 0 && v <= 1)) throw new Error('Invalid vertex color'); vertexColors.push(vertexColor);
          if (targets.length) morphVertices++;
        }
        if (!faceNormals.length) { const n = unit(cross(sub(points[1]!, points[0]!), sub(points[2]!, points[0]!))); faceNormals.push(n, n, n); }
        faces.push({ points, normals: faceNormals, uv: uvs, colors: vertexColors, material, materialIndex: materialEntry ? materialEntry.index : -1 });
      }
    }
  });
  if (!faces.length) throw new Error('No triangle geometry available');
  if (skinVertices) warnings.push(`CPU linear blend skinning evaluated ${skinVertices} triangle vertex references (four influences); normal transforms approximate deformed surface normals.`);
  if (morphVertices) warnings.push(`Morph POSITION/NORMAL evaluated ${morphVertices} triangle vertex references; morph TANGENT is unsupported (normal maps use per-triangle UV tangents).`);
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (const face of faces) for (const p of face.points) for (let k = 0; k < 3; k++) { minimum[k] = Math.min(minimum[k]!, p[k]!); maximum[k] = Math.max(maximum[k]!, p[k]!); }
  const center = minimum.map((v, k) => (v + maximum[k]!) / 2), extent = Math.max(...maximum.map((v, k) => v - minimum[k]!)), scale = 280 / Math.max(0.00001, extent);
  if(![...center,extent,scale].every(Number.isFinite))throw new Error('Non-finite derived review bounds');
  const turns: string[] = [], wireframes: string[] = [];
  for (let frame = 0; frame < 8; frame++) {
    const angle = frame * Math.PI / 4;
    const projected = faces.map(f => ({ ...f, p: f.points.map(p => { const [x, y, z] = sub(p, center); return [(x * Math.cos(angle) + z * Math.sin(angle)) * scale + 200, 200 - y * scale, z * Math.cos(angle) - x * Math.sin(angle)]; }) })).sort((a, b) => a.p.reduce((v, p) => v + p[2]!, 0) - b.p.reduce((v, p) => v + p[2]!, 0));
    for (const wire of [false, true]) {
      const body = projected.map(f => `<polygon points="${f.p.map(p => `${p[0]!.toFixed(2)},${p[1]!.toFixed(2)}`).join(' ')}" fill="${wire ? 'none' : `rgb(${f.material.color.slice(0, 3).map(v => Math.round(v * 255)).join(',')})`}" stroke="${wire ? '#a8e2ff' : '#253247'}" stroke-width="0.5"/>`).join('');
      (wire ? wireframes : turns).push(svg(body));
    }
  }
  const uv = svg(faces.filter(f => f.uv.length === 3).map(f => `<polygon points="${f.uv.map(p => `${(p[0]! * 360 + 20).toFixed(2)},${(380 - p[1]! * 360).toFixed(2)}`).join(' ')}" fill="none" stroke="#a8e2ff" stroke-width="0.6"/>`).join(''));
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
  if (settings.mode === 'appearance') warnings.push('Normal mapping uses per-triangle UV tangent frames, not authored MikkTSpace tangents; seams can differ from a target renderer. BLEND is sorted by triangle centroid; intersecting transparency is approximate.');
  const uvEvidence = measureUv(faces);
  return { turns, wireframes, uv, materials, appearance: appearance.images, warnings, uvEvidence, ...pose, renderer: REVIEW_RENDERER, envelope: { sourceBytes: bytes.byteLength, triangles: faces.length, vertexInstances, decodedTexturePixels: texturePixels, rasterSampleChecks: appearance.sampleChecks, durationMs: Math.round(performance.now() - started), limits: REVIEW_LIMITS } };
}
