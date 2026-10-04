import { NodeIO } from '@gltf-transform/core';
import { CollectingLogger } from '../inspection/gltf.js';
import { REVIEW_LIMITS } from './settings.js';

/** Bounds source allocations before NodeIO; no file, process or network access. */
export async function readReviewDocument(bytes: Uint8Array, mode: 'geometry' | 'appearance' = 'geometry') {
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
  for(const animation of json.json.animations??[]){
    if(!Array.isArray(animation.channels)||!animation.channels.length||!Array.isArray(animation.samplers)||!animation.samplers.length)throw new Error('Review animation requires at least one channel and sampler');
    rawChannels+=animation.channels.length;rawSamplers+=animation.samplers.length;if(rawChannels>REVIEW_LIMITS.animationChannels||rawSamplers>1024)throw new Error('Review animation channel/sampler budget exceeded');
  }
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
  for (const animation of json.json.animations ?? []) {
    for (const sampler of animation.samplers) {
      if (!Number.isSafeInteger(sampler.output) || sampler.output < 0 || sampler.output >= (json.json.accessors?.length ?? 0)) throw new Error('Invalid animation sampler output accessor index');
      const input = json.json.accessors?.[sampler.input];
      if (!Number.isSafeInteger(sampler.input) || sampler.input < 0 || !input
        || input.type !== 'SCALAR' || input.componentType !== 5126 || input.normalized
        || !Array.isArray(input.min) || !Array.isArray(input.max) || input.min.length !== 1 || input.max.length !== 1
        || !Number.isFinite(Math.fround(input.min[0]!)) || !Number.isFinite(Math.fround(input.max[0]!))) {
        throw new Error('Review animation input requires a float32 SCALAR accessor with finite min/max declarations');
      }
    }
    for (const channel of animation.channels) {
      if (channel.target.node !== undefined && !validNodeIndex(channel.target.node)) throw new Error('Invalid animation target node index');
      if ((channel.extensions && Object.keys(channel.extensions).length) || (channel.target.extensions && Object.keys(channel.target.extensions).length)) throw new Error('Unsupported animation target extensions in CPU review');
      if (['translation', 'rotation', 'scale'].includes(channel.target.path) && channel.target.node !== undefined
        && rawNodes[channel.target.node]?.matrix !== undefined) throw new Error('TRS animation cannot target a node declared with matrix');
    }
  }
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
  if (mode === 'appearance' && used.length) throw new Error(`Appearance review does not support extensions: ${used.join(', ')}; prepare a core glTF review LOD explicitly`);
  const doc = await io.readJSON(json), root = doc.getRoot();
  if (root.listNodes().length > 10_000 || root.listMeshes().length > 10_000 || root.listMaterials().length > 1024) throw new Error('Review scene object budget exceeded');
  // NodeIO creates accessors in JSON index order, including unreferenced ones.
  // Require declared animation extrema to agree with decoded float32 keys.
  const accessors = root.listAccessors(), checkedInputBounds = new Set<number>();
  for (const animation of json.json.animations ?? []) for (const sampler of animation.samplers) {
    if (checkedInputBounds.has(sampler.input)) continue;
    checkedInputBounds.add(sampler.input);
    const definition = json.json.accessors![sampler.input]!, accessor = accessors[sampler.input];
    if (!accessor || !accessor.getCount()) throw new Error('Review animation input is empty or missing');
    // glTF permits arbitrary representable extrema for implicit zero-filled accessors.
    if (definition.bufferView === undefined && definition.sparse === undefined) continue;
    const actualMin = accessor.getMin([])[0], actualMax = accessor.getMax([])[0];
    if (!Number.isFinite(actualMin) || !Number.isFinite(actualMax)
      || Math.fround(definition.min![0]!) !== actualMin || Math.fround(definition.max![0]!) !== actualMax) {
      throw new Error('Review animation input min/max declarations differ from actual float32 keys');
    }
  }
  const warnings = [...log.messages];
  if (used.length) warnings.push(`Geometry-only preview ignores unsupported extensions: ${used.join(', ')}`);
  return { doc, warnings };
}
