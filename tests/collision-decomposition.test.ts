import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { afterEach,describe,expect,it } from 'vitest';
import { decomposeCollisionMesh } from '../src/collision/decomposition.js';
import { extractCollisionTriangles,meshBounds,validateTriangleMesh,validateConvexHull,measureApproximation,type TriangleMesh } from '../src/collision/geometry.js';
import { coacdChildEnvironment,diagnoseCoacd,runCoacdPython,type CoacdRunner } from '../src/collision/process.js';
import { invalidState } from '../src/util/errors.js';
import { boxMesh,concaveU,uParts,collisionGlb } from './helpers/collision-fixture.js';
const roots:string[]=[];
async function scratch(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'coacd-test-'));roots.push(root);return root;}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
const environment={schema:'game_dev.coacd_environment.v1',python:'3.11.12',coacd:'1.0.14',numpy:'2.0.2',platform:'Linux',architecture:'x86_64',isolatedVenv:true,coacdCodeSHA256:'a'.repeat(64),upstreamSourceCommit:'1401ce2a7ae1ed89c65ab958b48d489350c233c7'};
function mockRunner(parts:TriangleMesh[],calls:string[][]):CoacdRunner{return async request=>{
  calls.push(request.args);
  if(request.args.includes('--diagnose'))return {stdout:JSON.stringify(environment),stderr:''};
  const input=JSON.parse(await fs.readFile(request.args[request.args.indexOf('--input')+1]!,'utf8'));
  expect(input.schema).toBe('game_dev.collision_triangles.v1');expect(input.faces.length).toBeGreaterThan(4);
  await fs.writeFile(request.args[request.args.indexOf('--output')+1]!,JSON.stringify({schema:'game_dev.coacd_result.v1',environment,limits:{memory:'test mock; not native evidence',cpu:'test mock',cpuAffinity:'test mock',memoryEnforcement:'address-space-rlimit',memorySampleIntervalMs:null,memoryOvershootPossible:false},parts}));
  return {stdout:'',stderr:'mock process; no native execution'};
};}

describe('CPU collision contracts without native execution',()=>{
  it('preserves Windows Python architecture metadata while excluding ambient secrets and profiles',()=>{
    const cwd=path.resolve('isolated-job'),python=path.resolve('venv','python.exe');
    const child=coacdChildEnvironment({cwd,python},{SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',PROCESSOR_ARCHITECTURE:'AMD64',PROCESSOR_ARCHITEW6432:'AMD64',HOME:'private-profile',USERPROFILE:'private-profile',PATH:'ambient-tools',PYTHONPATH:'injected-code',PROVIDER_API_KEY:'secret'});
    expect(child).toMatchObject({SystemRoot:'C:\\Windows',WINDIR:'C:\\Windows',PROCESSOR_ARCHITECTURE:'AMD64',PROCESSOR_ARCHITEW6432:'AMD64',HOME:cwd,USERPROFILE:cwd,PATH:path.dirname(python)});
    expect(child).not.toHaveProperty('PROVIDER_API_KEY');expect(child).not.toHaveProperty('PYTHONPATH');
    expect(coacdChildEnvironment({cwd,python},{})).not.toHaveProperty('PROCESSOR_ARCHITECTURE');
  });
  it('retains actionable bounded worker stderr and termination evidence in free diagnostics',async()=>{
    const details={code:1,signal:null,timedOut:false,logOverflow:false,stderrTail:'Unsupported CoACD wheel platform/architecture: Windows/<unknown>'};
    const result=await diagnoseCoacd({env:{GAME_DEV_COACD_PYTHON:process.execPath},runner:async()=>{throw invalidState('CoACD CPU worker failed; no collision result was accepted',details);}});
    expect(result).toMatchObject({available:false,automaticInstallation:false,failure:{error:'INVALID_STATE',retryable:false,details}});
  });
  it('extracts transformed and mirrored scene triangles with closed topology',async()=>{
    const geometry=await extractCollisionTriangles(await collisionGlb(boxMesh([0,0,0],[1,2,3]),[10,20,30],[-2,1,1]));
    expect(meshBounds(geometry)).toMatchObject({min:[8,20,30],max:[10,22,33]});
    expect(()=>validateTriangleMesh(geometry,100,100)).not.toThrow();
  });
  it('rejects nonfinite, out-of-range, open and nonconvex output geometry',()=>{
    const cube=boxMesh([0,0,0],[1,1,1]);
    expect(()=>validateConvexHull({...cube,vertices:[[NaN,0,0],...cube.vertices.slice(1)]},64)).toThrow(/finite/);
    expect(()=>validateConvexHull({...cube,faces:[[0,1,100],...cube.faces.slice(1)]},64)).toThrow(/indices/);
    expect(()=>validateConvexHull({...cube,faces:cube.faces.slice(1)},64)).toThrow(/closed/);
    expect(()=>validateConvexHull(concaveU(),64)).toThrow(/not convex/);
  });
  it('measures the missing U opening instead of accepting its single convex envelope',()=>{
    const source=concaveU();validateTriangleMesh(source,100,200);
    expect(measureApproximation(source,uParts(),256).normalizedMaxDistance).toBeLessThan(1e-6);
    expect(measureApproximation(source,[boxMesh([-1.5,-1.5,-0.5],[1.5,1.5,0.5])],256).normalizedMaxDistance).toBeGreaterThan(0.05);
  });
  it('refuses unconfigured Python without executing a child or installing anything',async()=>{
    let called=false;const result=await diagnoseCoacd({env:{},runner:async()=>{called=true;throw new Error('unexpected');}});
    expect(result.available).toBe(false);expect(called).toBe(false);
  });
  it('writes separate validated convex GLB/OBJ parts with hashed manifest and receipt',async()=>{
    const root=await scratch(),modelPath=path.join(root,'u.glb');await fs.writeFile(modelPath,await collisionGlb(concaveU()));
    const before=await fs.readFile(modelPath),calls:string[][]=[];
    const result=await decomposeCollisionMesh({modelPath},path.join(root,'out'),{env:{GAME_DEV_COACD_PYTHON:process.execPath},runner:mockRunner(uParts(),calls)});
    expect(result.partCount).toBe(3);expect(result.validation.passed).toBe(true);expect(result.engineVerified).toBe(false);expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[1]![calls[1]!.indexOf('--options')+1]!)).toMatchObject({seed:0,maxParts:16,memoryMB:2048,cpuSeconds:120});
    for(const part of result.parts)for(const file of part.files){const bytes=await fs.readFile(file.path);expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);if(file.format==='glb')validateConvexHull(await extractCollisionTriangles(bytes),64);}
    const manifest=JSON.parse(await fs.readFile(result.manifestPath,'utf8'));expect(manifest.schema).toBe('game_dev.collision_decomposition.v1');expect(manifest.validation.exactBound).toBe(false);
    expect(JSON.parse(await fs.readFile(result.receiptPath,'utf8')).cpuOnly).toBe(true);expect(await fs.readFile(modelPath)).toEqual(before);
  });
  it('rejects a hole-filling result and leaves no accepted or temporary collision artifacts',async()=>{
    const root=await scratch(),modelPath=path.join(root,'u.glb'),out=path.join(root,'out');await fs.writeFile(modelPath,await collisionGlb(concaveU()));
    await expect(decomposeCollisionMesh({modelPath},out,{env:{GAME_DEV_COACD_PYTHON:process.execPath},runner:mockRunner([boxMesh([-1.5,-1.5,-0.5],[1.5,1.5,0.5])],[])})).rejects.toThrow(/approximation-error/);
    expect(await fs.readdir(out)).toEqual([]);
  });
  it('enforces requested part budgets and refuses a successful process with no result',async()=>{
    const root=await scratch(),modelPath=path.join(root,'u.glb'),out=path.join(root,'out');await fs.writeFile(modelPath,await collisionGlb(concaveU()));
    await expect(decomposeCollisionMesh({modelPath,maxParts:2},out,{env:{GAME_DEV_COACD_PYTHON:process.execPath},runner:mockRunner(uParts(),[])})).rejects.toThrow(/part count/);
    await expect(decomposeCollisionMesh({modelPath},out,{env:{GAME_DEV_COACD_PYTHON:process.execPath},runner:async request=>({stdout:request.args.includes('--diagnose')?JSON.stringify(environment):'',stderr:''})})).rejects.toMatchObject({code:'ENOENT'});
    expect(await fs.readdir(out)).toEqual([]);
  });
  it('refuses version drift before requesting native decomposition',async()=>{
    const root=await scratch(),modelPath=path.join(root,'u.glb');await fs.writeFile(modelPath,await collisionGlb(concaveU()));let count=0;
    await expect(decomposeCollisionMesh({modelPath},path.join(root,'out'),{env:{GAME_DEV_COACD_PYTHON:process.execPath},runner:async()=>{count++;return {stdout:JSON.stringify({...environment,coacd:'9.0.0'}),stderr:''};}})).rejects.toThrow(/unavailable/);expect(count).toBe(1);
  });
  it.skipIf(process.platform==='win32')('terminates an unresponsive child at its wall-time budget',async()=>{
    const root=await scratch(),script=path.join(root,'child.cjs');await fs.writeFile(script,"setInterval(()=>{},1000)");
    // The real child runner speaks Python argv, so a tiny node shim ignores those flags.
    const shim=path.join(root,process.platform==='win32'?'unused':'python-shim');
    await fs.writeFile(shim,`#!/bin/sh\nexec '${process.execPath.replace(/'/g,"'\\''")}' '${script}'\n`,{mode:0o700});
    await expect(runCoacdPython({python:shim,script,args:[],cwd:root,timeoutMs:80})).rejects.toMatchObject({details:{timedOut:true}});
  });
});
