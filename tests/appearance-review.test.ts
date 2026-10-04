import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Document, NodeIO } from '@gltf-transform/core';
import { afterEach, expect, test } from 'vitest';
import { decodeImage, encodePNG } from '../src/inspection/image.js';
import { previewGlb } from '../src/review/previews.js';
import { createAssetReview, decideAssetReview, packageReviewedAsset,nameVisualBaseline,compareVisualMatrix,decideVisualRegression } from '../src/review/workspace.js';
import { verifyRunBundle } from '../src/harness/run-bundle.js';
import { REVIEW_LIMITS } from '../src/review/settings.js';
import { applyReviewPose } from '../src/review/pose.js';
import { readBoundedReviewFile } from '../src/review/source.js';

const roots:string[]=[];
async function temporary(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'appearance-review-'));roots.push(root);return root;}
afterEach(async()=>Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true}))));

function plane(columns=1,rows=1){
  const doc=new Document(),buffer=doc.createBuffer();
  const p:number[]=[],n:number[]=[],uv:number[]=[],indices:number[]=[];
  for(let y=0;y<=rows;y++)for(let x=0;x<=columns;x++){p.push(x/columns*2-1,y/rows*2-1,0);n.push(0,0,1);uv.push(x/columns,y/rows);}
  for(let y=0;y<rows;y++)for(let x=0;x<columns;x++){const i=y*(columns+1)+x;indices.push(i,i+1,i+columns+2,i,i+columns+2,i+columns+1);}
  const accessor=(name:string,type:'VEC3'|'VEC2'|'SCALAR',array:Float32Array|Uint16Array)=>doc.createAccessor(name).setBuffer(buffer).setType(type).setArray(array);
  const material=doc.createMaterial('review checker').setBaseColorFactor([1,1,1,1]).setMetallicFactor(0).setRoughnessFactor(0.6);
  const primitive=doc.createPrimitive().setAttribute('POSITION',accessor('positions','VEC3',new Float32Array(p))).setAttribute('NORMAL',accessor('normals','VEC3',new Float32Array(n))).setAttribute('TEXCOORD_0',accessor('uvs','VEC2',new Float32Array(uv))).setIndices(accessor('indices','SCALAR',new Uint16Array(indices))).setMaterial(material);
  const node=doc.createNode('plane').setMesh(doc.createMesh('plane').addPrimitive(primitive));
  const scene=doc.createScene('review scene').addChild(node);doc.getRoot().setDefaultScene(scene);
  const texture=(name:string,rgba:number[])=>doc.createTexture(name).setImage(encodePNG({width:2,height:2,data:new Uint8Array(Array.from({length:4},()=>rgba).flat())})).setMimeType('image/png');
  return {doc,buffer,material,primitive,node,scene,texture};
}
async function bytes(doc:Document){return new NodeIO().writeBinary(doc);}
function firstPixel(preview:Awaited<ReturnType<typeof previewGlb>>){const image=decodeImage(Buffer.from(preview.appearance[0]!.split(',')[1]!,'base64'));const at=(Math.floor(image.height/2)*image.width+Math.floor(image.width/2))*4;return [...image.data.subarray(at,at+4)];}
async function appearance(doc:Document){return previewGlb(await bytes(doc),{mode:'appearance',resolution:128});}

test('appearance pixels respond to texture mapping, normal, metallic, roughness and alpha under fixed lighting',async()=>{
  const f=plane();f.material.setBaseColorTexture(f.texture('red',[220,30,20,255]));
  const baseline=await appearance(f.doc),red=firstPixel(baseline);
  expect(red[0]).toBeGreaterThan(red[1]! * 2);expect(baseline.appearance).toHaveLength(8);
  expect((await appearance(f.doc)).appearance).toEqual(baseline.appearance);
  f.material.setBaseColorTexture(f.texture('green',[20,220,30,255]));const green=firstPixel(await appearance(f.doc));expect(green[1]).toBeGreaterThan(green[0]! * 2);
  f.material.setBaseColorTexture(f.texture('white',[255,255,255,255]));const neutral=firstPixel(await appearance(f.doc));
  f.material.setNormalTexture(f.texture('sideways normal',[255,128,128,255]));const normal=firstPixel(await appearance(f.doc));expect(normal).not.toEqual(neutral);
  f.material.setNormalTexture(null).setMetallicFactor(1);const metallic=firstPixel(await appearance(f.doc));expect(metallic).not.toEqual(neutral);
  f.material.setMetallicFactor(0).setRoughnessFactor(0.05);const smooth=firstPixel(await appearance(f.doc));expect(smooth).not.toEqual(neutral);
  f.material.setMetallicFactor(1).setRoughnessFactor(1).setMetallicRoughnessTexture(f.texture('rough low metal',[255,240,0,255]));const packedLow=firstPixel(await appearance(f.doc));
  f.material.setMetallicRoughnessTexture(f.texture('rough high metal',[255,240,255,255]));const roughHigh=firstPixel(await appearance(f.doc));expect(roughHigh).not.toEqual(packedLow);
  f.material.setMetallicRoughnessTexture(f.texture('smooth high metal',[255,20,255,255]));expect(firstPixel(await appearance(f.doc))).not.toEqual(roughHigh);
});

test('MASK discards zero alpha and BLEND composites coverage without opaque depth writes',async()=>{
  const f=plane();f.material.setBaseColorTexture(f.texture('alpha0',[255,255,255,0])).setAlphaMode('MASK');
  expect(firstPixel(await appearance(f.doc))).toEqual([21,32,49,255]);
  f.material.setAlphaMode('BLEND');expect(firstPixel(await appearance(f.doc))).toEqual([21,32,49,255]);
  f.material.setBaseColorTexture(f.texture('alpha half',[255,255,255,128]));const translucent=firstPixel(await appearance(f.doc));
  f.material.setAlphaMode('OPAQUE');const opaque=firstPixel(await appearance(f.doc));
  expect(translucent[0]).toBeGreaterThan(21);expect(translucent[0]).toBeLessThan(opaque[0]!);
});

test('representative textured material spheres preserve CPU visual QA evidence',async()=>{
  const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene('material sphere review');doc.getRoot().setDefaultScene(scene);
  const checkerData=new Uint8Array(32*32*4),normalData=new Uint8Array(32*32*4),alphaData=new Uint8Array(32*32*4);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++){const at=(y*32+x)*4,checker=(Math.floor(x/4)+Math.floor(y/4))%2===0;checkerData.set(checker?[230,230,230,255]:[50,65,90,255],at);const nx=0.5*Math.sin(x/32*Math.PI*8),ny=0.5*Math.cos(y/32*Math.PI*8),nz=Math.sqrt(1-nx*nx-ny*ny);normalData.set([Math.round((nx+1)*127.5),Math.round((ny+1)*127.5),Math.round((nz+1)*127.5),255],at);alphaData.set([255,210,80,checker?230:40],at);}
  const tex=(name:string,data:Uint8Array)=>doc.createTexture(name).setMimeType('image/png').setImage(encodePNG({width:32,height:32,data}));
  const checker=tex('checker albedo',checkerData),normal=tex('wavy normal',normalData),alpha=tex('coverage stripes',alphaData);
  const descriptors=[{name:'rough dielectric checker',metallic:0,roughness:0.85,color:[1,0.35,0.2,1]},{name:'smooth dielectric checker',metallic:0,roughness:0.1,color:[0.2,0.6,1,1]},{name:'rough metal checker',metallic:1,roughness:0.6,color:[1,0.7,0.15,1]},{name:'smooth metal checker',metallic:1,roughness:0.1,color:[0.25,1,0.5,1]},{name:'mapped normal checker',metallic:0,roughness:0.55,color:[0.6,0.35,1,1]},{name:'blended coverage checker',metallic:0,roughness:0.4,color:[1,1,1,1]}];
  const positions:number[]=[],normals:number[]=[],uvs:number[]=[],indices:number[]=[];const latitudes=12,longitudes=24;
  for(let lat=0;lat<=latitudes;lat++)for(let lon=0;lon<=longitudes;lon++){const theta=lat/latitudes*Math.PI,phi=lon/longitudes*Math.PI*2,n=[Math.sin(theta)*Math.cos(phi),Math.cos(theta),Math.sin(theta)*Math.sin(phi)];positions.push(...n.map(v=>v*0.9));normals.push(...n);uvs.push(lon/longitudes,lat/latitudes);}
  for(let lat=0;lat<latitudes;lat++)for(let lon=0;lon<longitudes;lon++){const a=lat*(longitudes+1)+lon,b=a+longitudes+1;indices.push(a,a+1,b,a+1,b+1,b);}
  const pos=doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(positions)),n=doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(normals)),uv=doc.createAccessor().setBuffer(buffer).setType('VEC2').setArray(new Float32Array(uvs)),ind=doc.createAccessor().setBuffer(buffer).setType('SCALAR').setArray(new Uint16Array(indices));
  for(const [i,d] of descriptors.entries()){const material=doc.createMaterial(d.name).setBaseColorFactor(d.color as [number,number,number,number]).setBaseColorTexture(i===5?alpha:checker).setMetallicFactor(d.metallic).setRoughnessFactor(d.roughness);if(i===4)material.setNormalTexture(normal);if(i===5)material.setAlphaMode('BLEND').setDoubleSided(true);const primitive=doc.createPrimitive().setAttribute('POSITION',pos).setAttribute('NORMAL',n).setAttribute('TEXCOORD_0',uv).setIndices(ind).setMaterial(material);scene.addChild(doc.createNode(d.name).setMesh(doc.createMesh(d.name).addPrimitive(primitive)).setTranslation([(i%3-1)*2.2,i<3?1.15:-1.15,0]));}
  const source=await bytes(doc),started=performance.now(),preview=await previewGlb(source,{mode:'appearance',resolution:256,reviewLod:'Six authored material spheres'});expect(preview.appearance).toHaveLength(8);expect(preview.envelope.triangles).toBe(3456);expect(new Set(preview.appearance).size).toBeGreaterThan(4);
  if(process.env.GDS_REVIEW_EVIDENCE){const directory=process.env.GDS_REVIEW_EVIDENCE;await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'material-spheres.glb'),source);const images=preview.appearance.map(image=>decodeImage(Buffer.from(image.split(',')[1]!,'base64'))),width=1024,height=512,data=new Uint8Array(width*height*4);for(const [i,image] of images.entries())for(let y=0;y<256;y++)data.set(image.data.subarray(y*256*4,(y+1)*256*4),((Math.floor(i/4)*256+y)*width+(i%4)*256)*4);await fs.writeFile(path.join(directory,'material-spheres-contact.png'),encodePNG({width,height,data}));await fs.writeFile(path.join(directory,'material-spheres-angle0.png'),Buffer.from(preview.appearance[0]!.split(',')[1]!,'base64'));await fs.writeFile(path.join(directory,'material-spheres-result.json'),JSON.stringify({renderer:preview.renderer,settings:{mode:'appearance',resolution:256},sourceBytes:source.byteLength,durationMs:performance.now()-started,materials:descriptors,limitations:preview.warnings,envelope:preview.envelope,uv:preview.uvEvidence},null,2));}
});

test('UV estimates exclude shared edges, detect overlapping interiors, and state density basis',async()=>{
  const f=plane();f.material.setBaseColorTexture(f.texture('density texture',[255,255,255,255]));
  const good=await appearance(f.doc);expect(good.uvEvidence.coveredFraction).toBeGreaterThan(0.98);expect(good.uvEvidence.overlappedFraction).toBe(0);
  expect(good.uvEvidence.density[0]?.texelsPerWorldUnit).toBeCloseTo(1); // 2px wide texture / 2 world units.
  const index=f.primitive.getIndices()!;index.setArray(new Uint16Array([0,1,3,0,1,3]));
  const bad=await appearance(f.doc);expect(bad.uvEvidence.overlappedFraction).toBeGreaterThan(0.48);
  f.primitive.getAttribute('TEXCOORD_0')!.setArray(new Float32Array([0,0,2,0,0,2,2,2]));
  expect((await appearance(f.doc)).uvEvidence.outOfTileTriangles).toBe(2);
});

test('geometry swatches share the cumulative decode budget and report only successful pixel work',async()=>{
  const f=plane(),image=encodePNG({width:2000,height:2000,data:new Uint8Array(2000*2000*4).fill(180)});
  for(let i=0;i<3;i++)f.doc.createMaterial(`large swatch ${i}`).setBaseColorTexture(f.doc.createTexture(`large texture ${i}`).setMimeType('image/png').setImage(image));
  const preview=await previewGlb(await bytes(f.doc));expect(preview.envelope.decodedTexturePixels).toBe(8_000_000);expect(preview.materials.filter(m=>m.texture)).toHaveLength(2);expect(preview.warnings.join(' ')).toContain('within the review budget');
});

test('reproducible clip evaluation applies rotation, morph weights and linear blend skinning',async()=>{
  const f=plane(),input=f.doc.createAccessor('time').setBuffer(f.buffer).setType('SCALAR').setArray(new Float32Array([0,1]));
  const output=f.doc.createAccessor('rotation').setBuffer(f.buffer).setType('VEC4').setArray(new Float32Array([0,0,0,1,0,Math.SQRT1_2,0,Math.SQRT1_2]));
  const sampler=f.doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
  f.doc.createAnimation('turn').addSampler(sampler).addChannel(f.doc.createAnimationChannel().setTargetNode(f.node).setTargetPath('rotation').setSampler(sampler));
  const glb=await bytes(f.doc),start=await previewGlb(glb,{pose:{clipIndex:0,timeSeconds:0}}),middle=await previewGlb(glb,{pose:{clipIndex:0,timeSeconds:0.5}});
  expect(middle.turns[0]).not.toBe(start.turns[0]);expect(middle.selectedTimeSeconds).toBe(0.5);expect(middle.clips[0]?.name).toBe('turn');
  const morph=plane();const delta=morph.doc.createAccessor('morph position').setBuffer(morph.buffer).setType('VEC3').setArray(new Float32Array([0,0,0,0,0,0,0,0,0,0,0,1]));
  morph.primitive.addTarget(morph.doc.createPrimitiveTarget('lift corner').setAttribute('POSITION',delta));
  const morphInput=morph.doc.createAccessor().setBuffer(morph.buffer).setType('SCALAR').setArray(new Float32Array([0,1]));const morphOutput=morph.doc.createAccessor().setBuffer(morph.buffer).setType('SCALAR').setArray(new Float32Array([0,1]));
  const morphSampler=morph.doc.createAnimationSampler().setInput(morphInput).setOutput(morphOutput);morph.doc.createAnimation('lift').addSampler(morphSampler).addChannel(morph.doc.createAnimationChannel().setTargetNode(morph.node).setTargetPath('weights').setSampler(morphSampler));
  const morphBytes=await bytes(morph.doc);expect((await previewGlb(morphBytes,{pose:{clipIndex:0,timeSeconds:1}})).turns[1]).not.toBe((await previewGlb(morphBytes,{pose:{clipIndex:0,timeSeconds:0}})).turns[1]);
  const skinned=plane(),joint=skinned.doc.createNode('joint');skinned.scene.addChild(joint);
  skinned.node.setSkin(skinned.doc.createSkin('one joint').addJoint(joint));
  skinned.primitive.setAttribute('JOINTS_0',skinned.doc.createAccessor().setBuffer(skinned.buffer).setType('VEC4').setArray(new Uint16Array(16)));
  skinned.primitive.setAttribute('WEIGHTS_0',skinned.doc.createAccessor().setBuffer(skinned.buffer).setType('VEC4').setArray(new Float32Array(Array.from({length:4},()=>[1,0,0,0]).flat())));
  const skinSampler=skinned.doc.createAnimationSampler().setInput(skinned.doc.createAccessor().setBuffer(skinned.buffer).setType('SCALAR').setArray(new Float32Array([0,1]))).setOutput(skinned.doc.createAccessor().setBuffer(skinned.buffer).setType('VEC4').setArray(new Float32Array([0,0,0,1,0,Math.SQRT1_2,0,Math.SQRT1_2])));skinned.doc.createAnimation('skin turn').addSampler(skinSampler).addChannel(skinned.doc.createAnimationChannel().setTargetNode(joint).setTargetPath('rotation').setSampler(skinSampler));
  const skinBytes=await bytes(skinned.doc),skinStart=await previewGlb(skinBytes,{pose:{clipIndex:0,timeSeconds:0}}),skinHalf=await previewGlb(skinBytes,{pose:{clipIndex:0,timeSeconds:0.5}});
  expect(skinHalf.turns[0]).not.toBe(skinStart.turns[0]);expect(skinHalf.warnings.join(' ')).toContain('linear blend skinning');
});

test('unsupported interpolation/extensions and resource amplification fail explicitly',async()=>{
  const f=plane(),input=f.doc.createAccessor().setBuffer(f.buffer).setType('SCALAR').setArray(new Float32Array([0,1]));
  const output=f.doc.createAccessor().setBuffer(f.buffer).setType('VEC3').setArray(new Float32Array(18));
  const cubicSampler=f.doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('CUBICSPLINE');f.doc.createAnimation('cubic').addSampler(cubicSampler).addChannel(f.doc.createAnimationChannel().setTargetNode(f.node).setTargetPath('translation').setSampler(cubicSampler));
  const glb=await bytes(f.doc);expect((await previewGlb(glb)).clips[0]?.supported).toBe(false);
  await expect(previewGlb(glb,{pose:{clipIndex:0,timeSeconds:0.5}})).rejects.toThrow('CUBICSPLINE');
  const amplified=plane(),sharedInput=amplified.doc.createAccessor().setBuffer(amplified.buffer).setType('SCALAR').setArray(new Float32Array(Array.from({length:60_000},(_,i)=>i)));
  const sharedOutput=amplified.doc.createAccessor().setBuffer(amplified.buffer).setType('VEC3').setArray(new Float32Array(180_000));
  const sharedSampler=amplified.doc.createAnimationSampler().setInput(sharedInput).setOutput(sharedOutput);
  for(let i=0;i<2;i++)amplified.doc.createAnimation(`shared ${i}`).addSampler(sharedSampler).addChannel(amplified.doc.createAnimationChannel().setTargetNode(amplified.node).setTargetPath('translation').setSampler(sharedSampler));
  expect(()=>applyReviewPose(amplified.doc,undefined)).toThrow('key budget');
  for(let i=0;i<17;i++)amplified.primitive.addTarget(amplified.doc.createPrimitiveTarget().setAttribute('POSITION',amplified.primitive.getAttribute('POSITION')!));
  amplified.doc.getRoot().listAnimations().forEach(a=>a.dispose());
  await expect(previewGlb(await bytes(amplified.doc))).rejects.toThrow('morph target budget');
  const source=Buffer.from(await bytes(plane().doc)),jsonLength=source.readUInt32LE(12),json=JSON.parse(source.subarray(20,20+jsonLength).toString());
  const mutate=(fn:(j:any)=>void)=>{const data=structuredClone(json);fn(data);const txt=JSON.stringify(data),chunk=Buffer.from(txt.padEnd(Math.ceil(Buffer.byteLength(txt)/4)*4,' ')),header=Buffer.from(source.subarray(0,20));header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(20+chunk.length+source.length-20-jsonLength,8);return Buffer.concat([header,chunk,source.subarray(20+jsonLength)]);};
  await expect(previewGlb(mutate(j=>{j.extensionsUsed=['KHR_materials_transmission'];}),{mode:'appearance'})).rejects.toThrow('does not support extensions');
  await expect(previewGlb(mutate(j=>{j.accessors[0].count=100_000_000;}))).rejects.toThrow('allocation budget');
  await expect(previewGlb(mutate(j=>{j.accessors[0].type='constructor';j.accessors[0].count=0;delete j.accessors[0].bufferView;j.accessors[1].count=100_000_000;}))).rejects.toThrow('Invalid review accessor');
  await expect(previewGlb(mutate(j=>{j.accessors[0].sparse={count:1e308,indices:{bufferView:0,componentType:5123},values:{bufferView:0}};}))).rejects.toThrow('Invalid review sparse accessor');
  await expect(previewGlb(mutate(j=>{j.skins=[{joints:Array(257).fill(0)}];}))).rejects.toThrow('joint reference budget');
  await expect(previewGlb(mutate(j=>{j.skins=[{joints:[0,0]}];}))).rejects.toThrow('Invalid review skin joints');
  await expect(previewGlb(mutate(j=>{j.nodes.push(...Array.from({length:256},()=>({})));j.skins=Array.from({length:17},()=>({joints:Array.from({length:256},(_,i)=>i+1)}));}))).rejects.toThrow('joint reference budget');
  await expect(previewGlb(mutate(j=>{j.scenes[0].nodes=Array(100_001).fill(0);}))).rejects.toThrow('scene root reference budget');
  await expect(previewGlb(mutate(j=>{j.scenes[0].nodes=[9999];}))).rejects.toThrow('Invalid review scene roots');
  await expect(previewGlb(mutate(j=>{j.nodes[0].children=[0];}))).rejects.toThrow('Cyclic');
  await expect(previewGlb(mutate(j=>{j.nodes[0].translation=[1e308,0,0];}))).rejects.toThrow('numeric envelope');
  await expect(previewGlb(mutate(j=>{j.images=Array.from({length:1024},()=>({bufferView:0,mimeType:'image/png'}));j.bufferViews[0].byteLength=8192;}))).rejects.toThrow('image copy budget');
  await expect(previewGlb(mutate(j=>{j.images=[{uri:`data:image/png;base64,${Buffer.alloc(8_000_001).toString('base64')}`,mimeType:'image/png'}];}))).rejects.toThrow('image copy budget');
});

test('v2 approvals bind settings, renderer, preview and dashboard; legacy records require fresh review',async()=>{
  const root=await temporary(),source=path.join(root,'fixture.glb');await fs.writeFile(source,await bytes(plane().doc));
  const session=await createAssetReview(root,[{name:'Candidate',modelPath:source}],{mode:'appearance',resolution:128});expect(session.schema).toBe('game_dev.asset_review.v2');
  const args={sessionId:session.id,candidateId:session.candidates[0]!.id,decision:'approve' as const,reviewer:'Artist',reason:'Reviewed fixed lighting'};
  const decision=await decideAssetReview(root,args);expect(decision.reviewBinding).toBe(session.candidates[0]!.reviewBinding);
  const options={decisionId:decision.id,packagesRoot:path.join(root,'packages'),catalogPath:path.join(root,'catalog.sqlite'),name:'Reviewed',license:'CC0-1.0'};
  const sessionFile=path.join(root,'reviews',`${session.id}.json`),record=await fs.readFile(sessionFile,'utf8');
  await fs.writeFile(sessionFile,JSON.stringify({...session,settings:{...session.settings,exposure:2}}));
  await expect(decideAssetReview(root,args)).rejects.toThrow('settings or evidence changed');await expect(packageReviewedAsset(root,options)).rejects.toThrow('settings or evidence changed');
  await fs.writeFile(sessionFile,record);const dashboard=await fs.readFile(session.dashboardPath);
  const missingSettings=JSON.parse(record);delete missingSettings.settings.mode;await fs.writeFile(sessionFile,JSON.stringify(missingSettings));await expect(decideAssetReview(root,args)).rejects.toThrow();await fs.writeFile(sessionFile,record);
  await fs.appendFile(session.dashboardPath,'tampered');await expect(decideAssetReview(root,args)).rejects.toThrow('dashboard changed');await expect(packageReviewedAsset(root,options)).rejects.toThrow('dashboard changed');
  await fs.writeFile(session.dashboardPath,dashboard);
  const legacyId=randomUUID();await fs.writeFile(path.join(root,'reviews',`${legacyId}.json`),JSON.stringify({schema:'game_dev.asset_review.v1',id:legacyId,createdAt:session.createdAt,candidates:session.candidates.map(({previewSha256:_p,reviewBinding:_b,previewRunPath:_r,previewRunManifestSha256:_s,...c})=>c)}));
  await expect(decideAssetReview(root,{...args,sessionId:legacyId})).rejects.toThrow('Legacy byte-only');
  const legacyDecisionId=randomUUID();await fs.writeFile(path.join(root,'decisions',`${legacyDecisionId}.json`),JSON.stringify({schema:'game_dev.asset_review_decision.v1',id:legacyDecisionId,...args,sessionId:legacyId,sha256:session.candidates[0]!.sha256,createdAt:session.createdAt}));
  await expect(packageReviewedAsset(root,{...options,decisionId:legacyDecisionId})).rejects.toThrow('Legacy byte-only approval');
});

test('review source reads reject oversized and special inputs before allocation and preserve exact bytes',async()=>{
  const root=await temporary(),file=path.join(root,'source.bin'),expected=Buffer.alloc(131_073,17);await fs.writeFile(file,expected);
  expect(await readBoundedReviewFile(file,expected.length)).toEqual(expected);
  await expect(readBoundedReviewFile(file,expected.length-1)).rejects.toThrow('regular file within');
  await expect(readBoundedReviewFile(root,64_000_000)).rejects.toThrow('regular file within');
});

test('CPU appearance captures reuse sealed scenario regression comparisons and suppress tampered evidence',async()=>{
  const root=await temporary(),f=plane();f.material.setBaseColorTexture(f.texture('red',[220,30,20,255]));
  const before=path.join(root,'before.glb'),after=path.join(root,'after.glb');await fs.writeFile(before,await bytes(f.doc));f.material.setBaseColorTexture(f.texture('blue',[20,30,220,255]));await fs.writeFile(after,await bytes(f.doc));
  const session=await createAssetReview(root,[{name:'Before normalization',modelPath:before},{name:'After normalization',modelPath:after}],{mode:'appearance',resolution:128});
  const baselineRunPath=session.candidates[0]!.previewRunPath!,candidateRunPath=session.candidates[1]!.previewRunPath!;
  const sealed=await verifyRunBundle(baselineRunPath);expect(sealed.manifest.evidence.commandExecuted).toBe(false);expect(sealed.manifest.evidence.rendererClass).toBe('software');expect(sealed.manifest.evidence.hardwarePerformanceEvidenceAdmitted).toBe(false);
  const baseline=await nameVisualBaseline(root,{name:'Before normalization',scenario:'CPU asset appearance',runPath:baselineRunPath});
  const matrix=await compareVisualMatrix(root,{entries:[{baselineId:baseline.id,candidateRunPath}]});expect(matrix.results[0]?.id).toBeTruthy();
  const comparison=JSON.parse(await fs.readFile(path.join(root,'comparisons',matrix.results[0]!.id!,'comparison.json'),'utf8'));expect(comparison.pairs).toHaveLength(8);expect(comparison.pairs.some((p:any)=>p.changedPixelRatio>0)).toBe(true);
  await decideVisualRegression(root,{regressionId:matrix.results[0]!.id!,decision:'expected-change',reviewer:'Artist',reason:'Reviewed palette update'});
  await fs.appendFile(path.join(candidateRunPath,'angle-0.png'),'tampered');
  await expect(decideAssetReview(root,{sessionId:session.id,candidateId:session.candidates[0]!.id,decision:'approve',reviewer:'Artist',reason:'Select before'})).rejects.toThrow('seal');
  await expect(decideVisualRegression(root,{regressionId:matrix.results[0]!.id!,decision:'expected-change',reviewer:'Artist',reason:'Re-review'})).rejects.toThrow('seal');
  const different=await createAssetReview(root,[{name:'Changed exposure',modelPath:before}],{mode:'appearance',resolution:128,exposure:2});
  expect((await compareVisualMatrix(root,{entries:[{baselineId:baseline.id,candidateRunPath:different.candidates[0]!.previewRunPath!}]})).results[0]?.error).toContain('same adapter scenario');
});

test('measured envelope renders a 10,000 triangle review LOD and stops raster amplification',async()=>{
  const f=plane(100,50);f.material.setBaseColorTexture(f.texture('blue fixture',[40,150,240,255]));
  const source=await bytes(f.doc),rssBefore=process.memoryUsage().rss,started=performance.now(),preview=await previewGlb(source,{mode:'appearance',resolution:128,reviewLod:'CPU envelope fixture: 10k triangles'}),durationMs=performance.now()-started;
  expect(preview.envelope.triangles).toBe(10_000);expect(preview.envelope.rasterSampleChecks).toBeLessThanOrEqual(REVIEW_LIMITS.rasterSamples);expect(durationMs).toBeLessThan(20_000);
  if(process.env.GDS_REVIEW_EVIDENCE){const directory=process.env.GDS_REVIEW_EVIDENCE;await fs.mkdir(directory,{recursive:true});await fs.writeFile(path.join(directory,'review-envelope.glb'),source);await fs.writeFile(path.join(directory,'appearance.png'),Buffer.from(preview.appearance[0]!.split(',')[1]!,'base64'));await fs.writeFile(path.join(directory,'benchmark.json'),JSON.stringify({renderer:preview.renderer,settings:{mode:'appearance',resolution:128},sourceBytes:source.byteLength,durationMs,rssBefore,rssAfter:process.memoryUsage().rss,envelope:preview.envelope,uv:preview.uvEvidence},null,2));}
  const overdraw=plane();overdraw.primitive.getIndices()!.setArray(new Uint16Array(Array.from({length:10_000},()=>[0,1,3]).flat()));
  await expect(appearance(overdraw.doc)).rejects.toThrow('raster budget');
  const tooMany=plane(101,50);await expect(previewGlb(await bytes(tooMany.doc))).rejects.toThrow('10,000 triangles');
},30_000);
