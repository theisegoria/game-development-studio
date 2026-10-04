import { Document, NodeIO } from '@gltf-transform/core';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { previewGlb } from '../src/review/previews.js';
import { inspectReviewAnimation } from '../src/review/animation-info.js';
import { createAssetReview, nameVisualBaseline, compareVisualMatrix } from '../src/review/workspace.js';
import { encodePNG } from '../src/inspection/image.js';

const roots: string[] = [];
async function temporary() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'review-framing-')); roots.push(root); return root; }
afterEach(async () => Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))));
function fixture() {
  const doc = new Document(), buffer = doc.createBuffer();
  const positions = doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array([-1,-1,0, 1,-1,0, 0,1,0]));
  const material = doc.createMaterial().setBaseColorFactor([0.8,0.2,0.1,1]).setMetallicFactor(0).setDoubleSided(true);
  const node = doc.createNode().setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', positions).setMaterial(material)));
  doc.createScene().addChild(node);
  const input = doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Float32Array([0,1]));
  const output = doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array([0,0,0, 3,0,0]));
  const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  doc.createAnimation('travel').addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler));
  return { doc, node };
}

interface RawReviewJSON { animations: Array<{samplers: Array<{input:number}>; channels:Array<unknown>}>; accessors: Array<Record<string,unknown>>; nodes: Array<Record<string,unknown>> }
function editRawGLB(bytes: Uint8Array, edit: (json: RawReviewJSON) => void) {
  const original = Buffer.from(bytes), length = original.readUInt32LE(12);
  const json = JSON.parse(original.subarray(20,20 + length).toString('utf8')) as RawReviewJSON;
  edit(json);
  const encoded = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 32); encoded.copy(padded);
  const header = Buffer.from(original.subarray(0,12)), chunk = Buffer.alloc(8), tail = original.subarray(20 + length);
  chunk.writeUInt32LE(padded.length,0); chunk.writeUInt32LE(0x4e4f534a,4); header.writeUInt32LE(20 + padded.length + tail.length,8);
  return Buffer.concat([header,chunk,padded,tail]);
}

test('raw animation preflight refuses absent min/max and matrix-origin TRS targets before metadata claims support', async () => {
  const { doc } = fixture(), bytes = await new NodeIO().writeBinary(doc);
  for (const field of ['min','max']) {
    const malformed = editRawGLB(bytes, json => { delete json.accessors[json.animations[0]!.samplers[0]!.input]![field]; });
    await expect(previewGlb(malformed)).rejects.toThrow('min/max declarations');
  }
  for (const field of ['min','max']) {
    const malformed = editRawGLB(bytes, json => { json.accessors[json.animations[0]!.samplers[0]!.input]![field] = [0.5]; });
    await expect(previewGlb(malformed)).rejects.toThrow('differ from actual float32 keys');
  }
  const empty = editRawGLB(bytes, json => { json.animations[0]!.channels = []; });
  await expect(previewGlb(empty)).rejects.toThrow('at least one channel');
  const extensionTarget = editRawGLB(bytes, json => {
    const channel = json.animations[0]!.channels[0] as {target:{extensions?:Record<string,unknown>}};
    channel.target.extensions = { EXT_animation_pointer: {pointer:'/materials/0'} };
  });
  await expect(previewGlb(extensionTarget)).rejects.toThrow('Unsupported animation target extensions');
  const implicitTime = editRawGLB(bytes, json => {
    const sampler = json.animations[0]!.samplers[0]! as {input:number;output:number};
    const input = json.accessors[sampler.input]!; delete input.bufferView; delete input.byteOffset;
    input.count = 1; input.min = [-1]; input.max = [2]; json.accessors[sampler.output]!.count = 1;
  });
  const implicit = await previewGlb(implicitTime, {pose:{clipIndex:0,timeSeconds:0}});
  expect(implicit.clips[0]?.durationSeconds).toBe(0);
  expect(implicit.selectedTimeSeconds).toBe(0);
  for (const node of [999, -1, 0.5, null]) {
    const invalidNode = editRawGLB(bytes, json => {
      const channel = json.animations[0]!.channels[0] as {target:{node:unknown}}; channel.target.node = node;
    });
    await expect(previewGlb(invalidNode)).rejects.toThrow('Invalid animation target node index');
  }
  const unusedSampler = editRawGLB(bytes, json => {
    json.animations[0]!.samplers.push({...json.animations[0]!.samplers[0]!, output:999} as {input:number});
  });
  await expect(previewGlb(unusedSampler)).rejects.toThrow('Invalid animation sampler output accessor index');
  const matrixTarget = editRawGLB(bytes, json => { json.nodes[0]!.matrix = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]; });
  await expect(previewGlb(matrixTarget)).rejects.toThrow('TRS animation');
  const root = await temporary(), file = path.join(root,'matrix-target.glb'); await fs.writeFile(file,matrixTarget);
  await expect(inspectReviewAnimation(file)).rejects.toThrow('TRS animation');
});

test('pipeline authored tangents and UV-derived tangents agree under a reflected transform', async () => {
  const { doc, node } = fixture(), primitive = node.getMesh()!.listPrimitives()[0]!, buffer = doc.getRoot().listBuffers()[0]!;
  node.setScale([-1,1,1]);
  primitive.setAttribute('NORMAL',doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array([0,0,1, 0,0,1, 0,0,1])));
  primitive.setAttribute('TEXCOORD_0',doc.createAccessor().setBuffer(buffer).setType('VEC2').setArray(new Float32Array([0,0, 1,0, 0.5,1])));
  primitive.getMaterial()!.setNormalTexture(doc.createTexture().setMimeType('image/png').setImage(encodePNG({width:1,height:1,data:new Uint8Array([128,220,180,255])})));
  const derived = await previewGlb(await new NodeIO().writeBinary(doc), {mode:'appearance',resolution:128});
  primitive.setAttribute('TANGENT',doc.createAccessor().setBuffer(buffer).setType('VEC4').setArray(new Float32Array([1,0,0,1, 1,0,0,1, 1,0,0,1])));
  const authored = await previewGlb(await new NodeIO().writeBinary(doc), {mode:'appearance',resolution:128});
  expect(authored.appearance).toEqual(derived.appearance);
  primitive.setAttribute('NORMAL', null).setAttribute('TANGENT', null);
  const flat = await previewGlb(await new NodeIO().writeBinary(doc), {mode:'appearance',resolution:128});
  primitive.setAttribute('TANGENT',doc.createAccessor().setBuffer(buffer).setType('VEC4').setArray(new Float32Array([0,1,0,1, 0,1,0,1, 0,1,0,1])));
  const ignored = await previewGlb(await new NodeIO().writeBinary(doc), {mode:'appearance',resolution:128});
  expect(ignored.appearance).toEqual(flat.appearance);
  primitive.addTarget(doc.createPrimitiveTarget().setAttribute('TANGENT',doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array([2,0,0, 2,0,0, 2,0,0]))));
  node.setWeights([1]);
  expect((await previewGlb(await new NodeIO().writeBinary(doc), {mode:'appearance',resolution:128})).appearance).toEqual(flat.appearance);
});

test('fixed default-pose framing exposes rigid motion and reports clipping; explicit shared framing preserves it', async () => {
  const { doc } = fixture(), bytes = await new NodeIO().writeBinary(doc);
  const start = await previewGlb(bytes, { pose: { clipIndex: 0, timeSeconds: 0 } });
  const end = await previewGlb(bytes, { pose: { clipIndex: 0, timeSeconds: 1 } });
  expect(end.turns[0]).not.toBe(start.turns[0]);
  expect(end.framing.center).toEqual(start.framing.center);
  expect(end.framing.extent).toBe(start.framing.extent);
  expect(end.framing.posedBounds.minimum[0]).toBe(2);
  expect(end.framing.clippedViews.length).toBeGreaterThan(0);
  const shared = { center: [1.5,0,0] as [number,number,number], extent: 8 };
  const framed = await previewGlb(bytes, { pose: { clipIndex: 0, timeSeconds: 1 }, framing: shared });
  expect(framed.framing.policy).toBe('manual');
  expect(framed.framing.clippedViews).toEqual([]);
  await expect(previewGlb(bytes, { framing: { center: [0,0,0], extent: 0 } })).rejects.toThrow();
});

test('read-only animation metadata binds changing source bytes and reports actual duration without creating records', async () => {
  const root = await temporary(), file = path.join(root, 'clip with spaces.glb'), { doc, node } = fixture();
  await fs.writeFile(file, await new NodeIO().writeBinary(doc));
  const first = await inspectReviewAnimation(file);
  expect(first.clips).toEqual([{ index:0, name:'travel', durationSeconds:1, channels:1, interpolation:['LINEAR'], supported:true }]);
  expect(first.framing.policy).toBe('default-pose');
  expect(await fs.readdir(root)).toEqual(['clip with spaces.glb']);
  node.setScale([2,2,2]); await fs.writeFile(file, await new NodeIO().writeBinary(doc));
  expect((await inspectReviewAnimation(file)).sourceSha256).not.toBe(first.sourceSha256);
  await expect(inspectReviewAnimation(path.join(root, 'not-a-model.txt'))).rejects.toThrow('self-contained GLB');
});

test('capture comparison requires matching actual frames or an explicit common frame across resized source assets', async () => {
  const root = await temporary(), { doc, node } = fixture(), before = path.join(root,'before.glb'), after = path.join(root,'after.glb');
  await fs.writeFile(before, await new NodeIO().writeBinary(doc));
  node.setScale([2,2,2]); await fs.writeFile(after, await new NodeIO().writeBinary(doc));
  const candidates = [{ name:'before', modelPath:before }, { name:'after', modelPath:after }];
  const automatic = await createAssetReview(root, candidates, {mode:'appearance', resolution:128});
  const baseline = await nameVisualBaseline(root, {name:'auto', scenario:'size review', runPath:automatic.candidates[0]!.previewRunPath!});
  expect((await compareVisualMatrix(root, {entries:[{baselineId:baseline.id, candidateRunPath:automatic.candidates[1]!.previewRunPath!}]})).results[0]?.error).toContain('same adapter scenario');
  const fixed = await createAssetReview(root, candidates, {mode:'appearance', resolution:128, framing:{center:[0,0,0],extent:6}});
  const sharedBaseline = await nameVisualBaseline(root, {name:'shared', scenario:'size review', runPath:fixed.candidates[0]!.previewRunPath!});
  const compared = await compareVisualMatrix(root, {entries:[{baselineId:sharedBaseline.id, candidateRunPath:fixed.candidates[1]!.previewRunPath!}]});
  expect(compared.results[0]?.error).toBeUndefined();
  const data = JSON.parse(await fs.readFile(path.join(root,'comparisons',compared.results[0]!.id!,'comparison.json'),'utf8'));
  expect(data.pairs.some((pair: {changedPixelRatio:number}) => pair.changedPixelRatio > 0)).toBe(true);
});
