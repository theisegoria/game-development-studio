import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { afterEach, expect, it, vi } from 'vitest';
import { compressTextureVariant, verifyCompressedModel } from '../src/production/compression.js';
import { BASIS_COMMIT, BASIS_VERSION, diagnoseTextureCompression, hashBasisFile, type BasisRunner } from '../src/production/basis.js';
import { inspectKtx2 } from '../src/production/ktx2.js';
import { inspectGltf } from '../src/inspection/gltf.js';
import { encodePNG } from '../src/inspection/image.js';
import { buildAssetPackage } from '../src/packages/format.js';
import { planPlatform } from '../src/production/platform.js';
import { validateRecipe } from '../src/production/recipes.js';
import { syntheticKtx } from './helpers/ktx-fixture.js';
import { writeGameReadyGlb } from './helpers/model-fixture.js';
const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(roots.splice(0).map(root => fs.rm(root,{recursive:true,force:true}))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'compression-test-')); roots.push(root);
  const model = await writeGameReadyGlb(path.join(root,'source.glb'));
  const io = new NodeIO(); const doc = await io.read(model); const data = new Uint8Array(4*4*4).fill(128);
  const texture = doc.createTexture('color').setMimeType('image/png').setImage(encodePNG({width:4,height:4,data})); doc.getRoot().listMaterials()[0]!.setBaseColorTexture(texture);
  await io.write(model,doc);
  const executable = path.join(root,'mock-encoder'); await fs.writeFile(executable,'mock; never executed');
  const identity = {path:executable,sha256:await hashBasisFile(executable),supportedVersion:BASIS_VERSION,upstreamCommit:BASIS_COMMIT};
  const calls: string[][] = [];
  const runner: BasisRunner = async (_file,args) => {
    calls.push([...args]);
    if (args.includes('-version')) return {stdout:'Basis Universal v2.50',stderr:''};
    if (args.includes('-validate')) { const bytes = await fs.readFile(args[args.indexOf('-file')+1]!); const info=inspectKtx2(bytes); return {stdout:Array.from({length:info.levels},(_,i)=>`Transcode of layer 0 level ${i} face 0 res ${Math.max(1,info.width>>i)}x${Math.max(1,info.height>>i)} format BC7_RGBA succeeded in 1 ms`).join('\n'),stderr:''}; }
    const output = args[args.indexOf('-output_file')+1]!; await fs.writeFile(output,syntheticKtx({codec:args.includes('-uastc')?'uastc':'etc1s',linear:args.includes('-linear')})); return {stdout:'encoded',stderr:''};
  };
  return {root,model,identity,runner,calls};
}
it('encodes embedded ETC1S with verified metadata, per-mip CPU evidence and unchanged source',async()=>{
  const f=await fixture(); const before=await fs.readFile(f.model);
  const result=await compressTextureVariant({modelPath:f.model,outputRoot:path.join(f.root,'out')},{identity:f.identity,runner:f.runner});
  expect(result.textures[0]).toMatchObject({codec:'etc1s',transfer:'srgb',levels:3,cpuTranscoded:true}); expect(result.gpuExecuted).toBe(false); expect(result.qualityApproved).toBe(false);
  expect(await fs.readFile(f.model)).toEqual(before); const inspection=await inspectGltf(result.outputPath); expect(inspection.textureResolutions[0]).toMatchObject({width:4,height:4,mimeType:'image/ktx2'});
  expect((await verifyCompressedModel(result.outputPath,{identity:f.identity,runner:f.runner})).cpuTranscoded).toBe(true);
  expect(f.calls.flat()).not.toContain('-opencl'); expect(f.calls.filter(args=>args.includes('-output_file'))[0]).toContain('-no_multithreading');
});
it('normal/data textures use linear UASTC with normal mip normalization',async()=>{
  const f=await fixture(); const io=new NodeIO(); const doc=await io.read(f.model); const material=doc.getRoot().listMaterials()[0]!; const texture=material.getBaseColorTexture()!;
  material.setBaseColorTexture(null).setNormalTexture(texture); await io.write(f.model,doc);
  const result=await compressTextureVariant({modelPath:f.model,outputRoot:path.join(f.root,'out')},{identity:f.identity,runner:f.runner});
  expect(result.textures[0]).toMatchObject({kind:'normal',codec:'uastc',transfer:'linear'}); expect(f.calls.flat()).toContain('-mip_renorm');
});
it('fails on malformed, wrong-color, incomplete, missing or untranscodable outputs without publishing',async()=>{
  const f=await fixture(); const out=path.join(f.root,'out');
  const runner: BasisRunner=async(file,args,cwd,timeout)=>{ if(args.includes('-validate')) return {stdout:'exit zero but no mip evidence',stderr:''}; return f.runner(file,args,cwd,timeout); };
  await expect(compressTextureVariant({modelPath:f.model,outputRoot:out},{identity:f.identity,runner})).rejects.toThrow(/did not report/);
  expect((await fs.readdir(out)).filter(name=>name.endsWith('.glb'))).toHaveLength(0);
  const wrong: BasisRunner=async(file,args,cwd,timeout)=>{ if(args.includes('-output_file')) {await fs.writeFile(args[args.indexOf('-output_file')+1]!,syntheticKtx({codec:'etc1s',linear:true}));return {stdout:'',stderr:''};}return f.runner(file,args,cwd,timeout);};
  await expect(compressTextureVariant({modelPath:f.model,outputRoot:out},{identity:f.identity,runner:wrong})).rejects.toThrow(/disagrees/);
});
it('diagnoses missing/tampered encoders without launching a process and rejects changed executable',async()=>{
  const f=await fixture(); expect((await diagnoseTextureCompression({})).available).toBe(false);
  const env={GAME_DEV_BASISU_PATH:f.identity.path,GAME_DEV_BASISU_SHA256:f.identity.sha256}; expect(await diagnoseTextureCompression(env)).toMatchObject({available:true,processLaunched:false,versionChecked:false});
  await fs.writeFile(f.identity.path,'changed'); expect((await diagnoseTextureCompression(env)).available).toBe(false);
  await expect(compressTextureVariant({modelPath:f.model,outputRoot:path.join(f.root,'out')},{identity:f.identity,runner:f.runner})).rejects.toThrow(/changed/);
});
it('rejects overlapping sections, giant dimensions, unsafe offsets and inconsistent level bytes',()=>{
  for(const mutate of [(b:Buffer)=>b.writeUInt32LE(0xffffffff,20),(b:Buffer)=>b.writeUInt32LE(80,48),(b:Buffer)=>b.writeBigUInt64LE(2n**63n,80),(b:Buffer)=>b.writeBigUInt64LE(1n,96)]){const bytes=Buffer.from(syntheticKtx());mutate(bytes);expect(()=>inspectKtx2(bytes)).toThrow(/Invalid KTX2/);}
});
it('places compression after normalization and before validation/package in platform recipes',()=>{
  const plan=planPlatform({schema:'game_dev.platform_recipe.v1',id:'compressed',name:'Prop',modelPath:'/example/source.glb',license:'MIT',variants:[{id:'mobile',lodTriangles:[1000],maxMaterials:2,maxTextureSize:512,textureMode:'compress'}]});
  expect(plan.executable).toBe(true); validateRecipe(plan.recipe); const ops=plan.recipe.steps.map(s=>s.operation); expect(ops.indexOf('compress_texture_variant')).toBeGreaterThan(ops.indexOf('normalize_mesh')); expect(ops.indexOf('build_asset_package')).toBeGreaterThan(ops.indexOf('compress_texture_variant'));
});
it('package admission requires actual payload validation, not a plausible header alone',async()=>{
  const f=await fixture(); const result=await compressTextureVariant({modelPath:f.model,outputRoot:path.join(f.root,'out')},{identity:f.identity,runner:f.runner});
  vi.stubEnv('GAME_DEV_BASISU_PATH',''); vi.stubEnv('GAME_DEV_BASISU_SHA256','');
  await expect(buildAssetPackage({sourcePath:result.outputPath,packagesRoot:path.join(f.root,'packages'),name:'Compressed',license:'MIT'})).rejects.toThrow(/Configure/);
});
