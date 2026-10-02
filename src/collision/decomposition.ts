import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { z } from 'zod';
import { invalidInput, invalidState } from '../util/errors.js';
import { atomicJson, withTransaction } from '../storage/transaction.js';
import { extractCollisionTriangles, validateConvexHull, measureApproximation, meshBounds, type TriangleMesh } from './geometry.js';
import { coacdEnvironmentSchema, coacdScript, diagnoseCoacd, runCoacdPython, type CoacdRunner } from './process.js';

export const decompositionSchema = z.object({
  modelPath:z.string().min(1), threshold:z.number().min(0.01).max(0.2).default(0.05),
  maxParts:z.number().int().min(1).max(32).default(16), maxVerticesPerPart:z.number().int().min(8).max(256).default(64),
  seed:z.number().int().min(0).max(2147483647).default(0),
  memoryMB:z.number().int().min(512).max(4096).default(2048), cpuSeconds:z.number().int().min(10).max(600).default(120),
  timeoutSeconds:z.number().int().min(10).max(600).default(180), sampleCount:z.number().int().min(64).max(512).default(256),
  maxApproximationError:z.number().min(0.001).max(0.2).default(0.05),
}).strict();
export type DecompositionOptions = z.input<typeof decompositionSchema>;
const point=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
const triangle=z.tuple([z.number().int().nonnegative(),z.number().int().nonnegative(),z.number().int().nonnegative()]);
const resultSchema=z.object({schema:z.literal('game_dev.coacd_result.v1'),environment:coacdEnvironmentSchema,limits:z.object({memory:z.string().min(1),cpu:z.string().min(1),cpuAffinity:z.string().min(1),memoryEnforcement:z.enum(['address-space-rlimit','windows-job-object','sampled-rss-watchdog']),memorySampleIntervalMs:z.number().int().positive().nullable(),memoryOvershootPossible:z.boolean()}).strict(),parts:z.array(z.object({vertices:z.array(point).min(4).max(256),faces:z.array(triangle).min(4).max(508)}).strict()).min(1).max(32)}).strict();
const sha256=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
async function regularBytes(file:string,limit:number):Promise<Buffer> {const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>limit) throw invalidInput('Collision file must be a regular file within its byte budget');const bytes=await fs.readFile(file);if(bytes.length>limit) throw invalidInput('Collision file grew beyond its byte budget');return bytes;}
async function durablePart(file:string,bytes:string|Uint8Array):Promise<void> {const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}}
async function hullGlb(mesh:TriangleMesh):Promise<Uint8Array> {
  const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene('convex_collision_part');doc.getRoot().setDefaultScene(scene);
  const positions=doc.createAccessor().setType('VEC3').setArray(new Float32Array(mesh.vertices.flat())).setBuffer(buffer);
  const indices=doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(mesh.faces.flat())).setBuffer(buffer);
  const primitive=doc.createPrimitive().setAttribute('POSITION',positions).setIndices(indices).setMode(4);
  scene.addChild(doc.createNode('convex_part').setMesh(doc.createMesh().addPrimitive(primitive)));
  return new NodeIO().writeBinary(doc);
}
const hullObj=(mesh:TriangleMesh)=>'# Standalone convex collision part. Coordinates match the source GLB scene; no engine verification.\n'+mesh.vertices.map(p=>`v ${p.join(' ')}`).join('\n')+'\n'+mesh.faces.map(face=>`f ${face.map(i=>i+1).join(' ')}`).join('\n')+'\n';

/** Test injection replaces only the child process; all extraction/output validation still runs. */
export async function decomposeCollisionMesh(input:DecompositionOptions,outputRoot:string,settings:{env?:NodeJS.ProcessEnv;runner?:CoacdRunner}={}) {
  const args=decompositionSchema.parse(input);
  if(path.extname(args.modelPath).toLowerCase()!=='.glb') throw invalidInput('Collision decomposition currently accepts embedded static GLB only');
  const source=await regularBytes(args.modelPath,64*1024*1024),sourceSHA256=sha256(source);
  const geometry=await extractCollisionTriangles(source);
  const options={threshold:args.threshold,maxParts:args.maxParts,maxVerticesPerPart:args.maxVerticesPerPart,seed:args.seed,memoryMB:args.memoryMB,cpuSeconds:args.cpuSeconds,timeoutSeconds:args.timeoutSeconds};
  // Bound the independent O(samples * triangles) validator as well as the native operation.
  if(args.sampleCount*(geometry.faces.length+args.maxParts*args.maxVerticesPerPart*2)*4>50_000_000) throw invalidInput('Requested collision validation exceeds 50 million triangle probes; reduce input triangles, samples or hull budgets');
  await fs.mkdir(outputRoot,{recursive:true});
  const canonicalRoot=await fs.realpath(outputRoot);
  return withTransaction(path.join(canonicalRoot,'.coacd-worker'),async()=>{
    const stage=await fs.mkdtemp(path.join(canonicalRoot,'.coacd-'));
    try {
      const diagnostic=await diagnoseCoacd({env:settings.env,runner:settings.runner,cwd:stage});
      if(!diagnostic.available) throw invalidState(`CPU convex decomposition unavailable: ${diagnostic.reason}`,{setup:'docs/coacd.md'});
      const wrapperSHA256=sha256(await regularBytes(coacdScript,1024*1024));
      const sourceMesh={schema:'game_dev.collision_triangles.v1',...geometry};
      const interchangePath=path.join(stage,'source.mesh.json');await atomicJson(interchangePath,sourceMesh);
      const interchangeSHA256=sha256(await fs.readFile(interchangePath));
      const nativePath=path.join(stage,'native-result.json');
      const log=await (settings.runner??runCoacdPython)({python:diagnostic.python,script:coacdScript,args:['--input',interchangePath,'--output',nativePath,'--options',JSON.stringify(options)],cwd:stage,timeoutMs:args.timeoutSeconds*1000});
      const result=resultSchema.parse(JSON.parse((await regularBytes(nativePath,16*1024*1024)).toString('utf8')));
      if(JSON.stringify(result.environment)!==JSON.stringify(diagnostic.environment)) throw invalidState('CoACD tool environment changed between diagnosis and decomposition');
      if(result.parts.length>args.maxParts) throw invalidState('CoACD exceeded the requested part count');
      const hulls=result.parts;
      const validations=hulls.map(hull=>validateConvexHull(hull,args.maxVerticesPerPart));
      const parts=[]; const publishedHulls:TriangleMesh[]=[];
      for(const [index,hull] of hulls.entries()) {
        const name=`part-${String(index).padStart(3,'0')}`,objFile=`${name}.obj`,glbFile=`${name}.glb`;
        const obj=hullObj(hull),glb=await hullGlb(hull);
        // GLB uses float32. Independently validate exactly the quantized geometry we publish.
        const quantized=await extractCollisionTriangles(glb);validateConvexHull(quantized,args.maxVerticesPerPart);publishedHulls.push(quantized);
        const files=[{path:objFile,sha256:sha256(obj),bytes:Buffer.byteLength(obj),format:'obj'},{path:glbFile,sha256:sha256(glb),bytes:glb.length,format:'glb'}];
        await durablePart(path.join(stage,objFile),obj);await durablePart(path.join(stage,glbFile),glb);
        parts.push({index,vertices:hull.vertices.length,triangles:hull.faces.length,validation:validations[index],files});
      }
      const approximation=measureApproximation(geometry,publishedHulls,args.sampleCount);
      if(approximation.normalizedMaxDistance>args.maxApproximationError) throw invalidState('Convex collision parts exceed the sampled approximation-error budget',{approximation,limit:args.maxApproximationError});
      const validation={...approximation,maxAllowedNormalizedDistance:args.maxApproximationError,passed:true};
      const manifest={schema:'game_dev.collision_decomposition.v1',kind:'separate_convex_parts',source:{sha256:sourceSHA256,interchangeSHA256,vertices:geometry.vertices.length,triangles:geometry.faces.length,bounds:meshBounds(geometry),sceneTransformsApplied:true,units:'source GLB scene units; glTF convention meters'},options:{...options,timeoutSeconds:args.timeoutSeconds,sampleCount:args.sampleCount,maxApproximationError:args.maxApproximationError},tool:{...result.environment,wrapperSHA256},limits:result.limits,parts,validation,engineVerified:false,limitations:['Sampled solid-union error is not an exact geometric bound or engine acceptance proof.','No animations, skins, morphs, non-triangle modes, glTF extensions or external resources.','Keep convex parts separate; joining them and convexifying the aggregate fills openings.','Fixed seed is recorded; cross-platform byte identity is not guaranteed.']};
      await atomicJson(path.join(stage,'manifest.json'),manifest);
      const manifestSHA256=sha256(await fs.readFile(path.join(stage,'manifest.json')));
      const receipt={schema:'game_dev.collision_receipt.v1',operation:'decompose_collision_mesh',status:'completed',sourceSHA256,manifestSHA256,processIntent:'isolated CPU-only CoACD; no Blender/GPU/provider',cpuOnly:true,engineVerified:false,tool:manifest.tool,limits:result.limits,outputs:parts.flatMap(part=>part.files),validation,stderrTail:log.stderr.slice(-8192)};
      await atomicJson(path.join(stage,'receipt.json'),receipt);
      // Native interchange is retained as bounded evidence, not silently treated as a usable collision asset.
      const directory=path.join(canonicalRoot,`${sourceSHA256.slice(0,16)}-${randomUUID()}`);
      await fs.rename(stage,directory);
      const manifestPath=path.join(directory,'manifest.json'),receiptPath=path.join(directory,'receipt.json');
      return {schema:'game_dev.collision_decomposition_result.v1',outputPath:manifestPath,manifestPath,receiptPath,collisionDirectory:directory,sourceSHA256,manifestSHA256,partCount:parts.length,parts:parts.map(part=>({...part,files:part.files.map(file=>({...file,path:path.join(directory,file.path)}))})),validation,engineVerified:false};
    } catch(error) {await fs.rm(stage,{recursive:true,force:true});throw error;}
  });
}
