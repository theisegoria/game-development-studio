import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { describe, expect, it } from 'vitest';
import { compressTextureVariant, verifyCompressedModel } from '../src/production/compression.js';
import { encodePNG } from '../src/inspection/image.js';
import { inspectGltf } from '../src/inspection/gltf.js';
import { buildAssetPackage, readAssetPackage } from '../src/packages/format.js';
import { writeGameReadyGlb } from './helpers/model-fixture.js';
// This is a CPU codec integration test, never part of the default local fast suite.
describe.skipIf(process.env.GAME_DEV_TEST_BASIS_CPU !== '1')('pinned real Basis CPU encoder', () => {
  for (const colorCodec of ['etc1s', 'uastc'] as const) it(`encodes ${colorCodec} color plus UASTC normal/ORM and packages verified payloads`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'basis-real-'));
    try {
      const source = await writeGameReadyGlb(path.join(root,'source.glb')); const io = new NodeIO(); const doc = await io.read(source); const material = doc.getRoot().listMaterials()[0]!;
      const data = new Uint8Array(64*64*4), normals = new Uint8Array(data.length), orm = new Uint8Array(data.length);
      for(let y=0;y<64;y++)for(let x=0;x<64;x++){const at=(y*64+x)*4;data.set([x*4,y*4,160,(x+y)%5?255:128],at);normals.set([128,128,255,255],at);orm.set([255,x*4,64,255],at);}
      const add=(name:string,pixels:Uint8Array)=>doc.createTexture(name).setImage(encodePNG({width:64,height:64,data:pixels})).setMimeType('image/png');
      material.setBaseColorTexture(add('color',data)).setNormalTexture(add('normal',normals)).setMetallicRoughnessTexture(add('orm',orm));
      // Tangents are required by the existing policy once a normal texture is bound.
      const primitive=doc.getRoot().listMeshes()[0]!.listPrimitives()[0]!; primitive.setAttribute('TANGENT',doc.createAccessor().setBuffer(doc.getRoot().listBuffers()[0]!).setType('VEC4').setArray(new Float32Array([1,0,0,1,1,0,0,1,1,0,0,1,1,0,0,1])));
      await io.write(source,doc); const before=await fs.readFile(source);
      const result=await compressTextureVariant({modelPath:source,outputRoot:path.join(root,'out'),colorCodec,timeoutSeconds:180});
      expect(result.textures).toHaveLength(3); expect(result.textures.every(t=>t.cpuTranscoded&&t.levels===7)).toBe(true); expect(await fs.readFile(source)).toEqual(before);
      expect((await inspectGltf(result.outputPath)).textureResolutions.every(t=>t.mimeType==='image/ktx2'&&t.width===64)).toBe(true);
      expect((await verifyCompressedModel(result.outputPath)).count).toBe(3);
      const built=await buildAssetPackage({sourcePath:result.outputPath,packagesRoot:path.join(root,'packages'),name:`CPU ${colorCodec}`,license:'CC0-1.0'});
      expect((await readAssetPackage(built.packagePath)).validation.passed).toBe(true);
      const report=JSON.parse(await fs.readFile(path.join(built.packagePath,'validation.json'),'utf8')); expect(report.compressedTextures.cpuTranscoded).toBe(true);
    } finally { await fs.rm(root,{recursive:true,force:true}); }
  },240_000);
});
