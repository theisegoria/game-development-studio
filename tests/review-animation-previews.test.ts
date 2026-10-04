import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Document, NodeIO } from '@gltf-transform/core';
import { afterEach, expect, test, vi } from 'vitest';
import { previewReviewGlb } from '../src/review/animation-previews.js';
import { createAssetReview, decideAssetReview, nameVisualBaseline, compareVisualMatrix } from '../src/review/workspace.js';
import { verifyRunBundle } from '../src/harness/run-bundle.js';
import { reviewSettingsSchema } from '../src/review/settings.js';
import * as previewModule from '../src/review/previews.js';

const roots:string[]=[];
afterEach(async()=>{vi.restoreAllMocks();await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
async function animatedTriangle(triangles=1) {
  const doc=new Document(),buffer=doc.createBuffer();
  const positions=new Float32Array(triangles*9);
  for(let i=0;i<triangles;i++)positions.set([-0.5,-0.5,0,0.5,-0.5,0,0,0.5,0],i*9);
  const position=doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(positions);
  const material=doc.createMaterial().setDoubleSided(true).setBaseColorFactor([0.8,0.2,0.1,1]);
  const node=doc.createNode('moving triangle').setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION',position).setMaterial(material)));
  doc.getRoot().setDefaultScene(doc.createScene().addChild(node));
  const input=doc.createAccessor().setType('SCALAR').setBuffer(buffer).setArray(new Float32Array([0,1]));
  const output=doc.createAccessor().setType('VEC3').setBuffer(buffer).setArray(new Float32Array([0,0,0,0.4,0,0]));
  const sampler=doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  doc.createAnimation('move').addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler));
  return new NodeIO().writeBinary(doc);
}
const settings={mode:'appearance' as const,resolution:128 as const,timeline:{clipIndex:0,startSeconds:0,endSeconds:1,frameCount:3},framing:{center:[0,0,0] as [number,number,number],extent:2}};

test('sampled animation renders actual distinct poses under one fixed frame and bounded cumulative evidence',async()=>{
  const source=await animatedTriangle(),preview=await previewReviewGlb(source,settings);
  const playback=preview.animationPlayback!;
  expect(playback.schedule.samples.map(sample=>sample.timeSeconds)).toEqual([0,0.5,1]);
  expect(playback.samples.map(sample=>sample.timeSeconds)).toEqual([0,0.5,1]);
  expect(playback.framing).toEqual(settings.framing);
  expect(playback.samples.every(sample=>sample.images.length===8)).toBe(true);
  expect(new Set(playback.samples.map(sample=>sample.images[0])).size).toBe(3);
  expect(playback.resources).toMatchObject({sampleCount:3,triangles:3,vertexInstances:9});
  expect(playback.resources.rasterSampleChecks).toBeLessThanOrEqual(48_000_000);
  expect(preview.warnings.join(' ')).toContain('precomputed still samples');
  const independentlyFitted=await previewReviewGlb(source,{...settings,framing:undefined});
  expect(independentlyFitted.animationPlayback?.framing).toEqual({center:[0,0,0],extent:1});
  expect(independentlyFitted.animationPlayback?.samples[2]?.clippedViews.length).toBeGreaterThan(0);
});

test('timeline setting refuses ambiguous or unsupported execution before optional runner use',async()=>{
  const runner=vi.fn(async()=>{throw new Error('Must not run optional tools');});
  for(const value of [{...settings,decodeBasisTextures:true},{...settings,pose:{clipIndex:0,timeSeconds:0}},{...settings,resolution:256},{...settings,mode:'geometry'}]) {
    expect(()=>reviewSettingsSchema.parse(value)).toThrow('Sampled playback');
    await expect(previewReviewGlb(await animatedTriangle(),value as typeof settings,{runner})).rejects.toThrow('Sampled playback');
  }
  await expect(previewReviewGlb(await animatedTriangle(),{...settings,timeline:{...settings.timeline,endSeconds:1.01}})).rejects.toThrow('duration');
  expect(runner).not.toHaveBeenCalled();
});

test('an exhausted sequence budget reaches the rasterizer before it performs a third sample',async()=>{
  const source=await animatedTriangle(),realPreview=previewModule.previewGlb;
  const initial=await realPreview(source,{mode:'appearance',resolution:128,framing:settings.framing});
  const maximumCost={...initial,envelope:{...initial.envelope,rasterSampleChecks:24_000_000}};
  const render=vi.spyOn(previewModule,'previewGlb').mockResolvedValueOnce(maximumCost).mockResolvedValueOnce(maximumCost).mockImplementation(realPreview);
  await expect(previewReviewGlb(source,settings)).rejects.toThrow('Appearance raster budget exceeded');
  expect(render).toHaveBeenCalledTimes(3);
  expect(render.mock.calls[1]?.[3]).toEqual({rasterSamples:24_000_000});
  expect(render.mock.calls[2]?.[3]).toEqual({rasterSamples:0});
  // The real rasterizer refuses the next triangle before entering its pixel loop.
  await expect(realPreview(source,{mode:'appearance',resolution:128},{},{rasterSamples:-1})).rejects.toThrow('Invalid bounded');
  await expect(realPreview(source,{mode:'appearance',resolution:128},{},{rasterSamples:24_000_001})).rejects.toThrow('Invalid bounded');
});

test('sampled captures preserve all time/angle pixels for existing regressions and stale evidence rejection',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'timeline-sealed-'));roots.push(root);
  const modelPath=path.join(root,'moving.glb');await fs.writeFile(modelPath,await animatedTriangle());
  const session=await createAssetReview(root,[{name:'Before',modelPath},{name:'After',modelPath}],settings);
  const candidate=session.candidates[0]!,run=await verifyRunBundle(candidate.previewRunPath!);
  const capture=JSON.parse(await fs.readFile(path.join(run.runPath,'capture.json'),'utf8'));
  expect(capture.frames).toHaveLength(24);expect(capture.frames[8].label).toBe('sample-1-angle-0');
  const binding=JSON.parse(await fs.readFile(path.join(run.runPath,'source-binding.json'),'utf8'));
  expect(binding.animationPlayback.schedule.samples.map((sample:{timeSeconds:number})=>sample.timeSeconds)).toEqual([0,0.5,1]);
  expect(binding.animationPlayback.resources.sampleCount).toBe(3);
  const html=await fs.readFile(session.dashboardPath,'utf8');expect(html).toContain('Play samples');expect(html).toContain('data-sample-frame="2"');expect(html).toContain('at recorded times');
  const baseline=await nameVisualBaseline(root,{name:'Before',scenario:'Animation samples',runPath:run.runPath});
  const matrix=await compareVisualMatrix(root,{entries:[{baselineId:baseline.id,candidateRunPath:session.candidates[1]!.previewRunPath!}]});
  expect(matrix.results[0]?.id).toBeTruthy();
  const comparison=JSON.parse(await fs.readFile(path.join(root,'comparisons',matrix.results[0]!.id!,'comparison.json'),'utf8'));
  expect(comparison.pairs).toHaveLength(24);expect(comparison.pairs.every((pair:{changedPixelRatio:number})=>pair.changedPixelRatio===0)).toBe(true);
  const dashboard=await fs.readFile(matrix.dashboard.dashboardPath,'utf8');expect(dashboard).toContain('Candidate overlay opacity');expect(dashboard).toContain('data-gds-comparison');
  await fs.appendFile(path.join(run.runPath,'sample-2-angle-0.png'),'changed');
  await expect(decideAssetReview(root,{sessionId:session.id,candidateId:candidate.id,decision:'approve',reviewer:'Artist',reason:'Inspected sequence'})).rejects.toThrow('seal');
});
