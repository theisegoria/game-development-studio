import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe,expect,it } from 'vitest';
import { decomposeCollisionMesh } from '../src/collision/decomposition.js';
import { extractCollisionTriangles,pointInsideConvex,validateConvexHull } from '../src/collision/geometry.js';
import { diagnoseCoacd } from '../src/collision/process.js';
import { collisionGlb,concaveU } from './helpers/collision-fixture.js';

// Explicit opt-in only. The ordinary test suite never imports CoACD or launches Python.
describe.skipIf(process.env.GAME_DEV_TEST_COACD!=='1')('real pinned CoACD CPU contract',()=>{
  it('decomposes a connected concave U into independently validated parts while preserving its opening',async()=>{
    const root=await fs.mkdtemp(path.join(os.tmpdir(),'coacd-native-'));
    try {
      const diagnosis=await diagnoseCoacd({cwd:root});
      expect(diagnosis.available,JSON.stringify(diagnosis)).toBe(true);
      const modelPath=path.join(root,'concave-u.glb');await fs.writeFile(modelPath,await collisionGlb(concaveU()));
      const result=await decomposeCollisionMesh({modelPath,threshold:0.03,maxParts:12,seed:12345,maxApproximationError:0.04,cpuSeconds:180,timeoutSeconds:240},path.join(root,'out'));
      expect(result.partCount).toBeGreaterThan(1);expect(result.partCount).toBeLessThanOrEqual(12);
      const hulls=[];
      for(const part of result.parts){const file=part.files.find(file=>file.format==='glb')!;const mesh=await extractCollisionTriangles(await fs.readFile(file.path));validateConvexHull(mesh,64);hulls.push(mesh);}
      for(const point of [[0,0,0],[0,0.7,0],[0,1.3,0]] as [number,number,number][]) expect(hulls.some(hull=>pointInsideConvex(point,hull)),`opening point ${point}`).toBe(false);
      for(const point of [[-1,0.7,0],[1,0.7,0],[0,-1,0]] as [number,number,number][]) expect(hulls.some(hull=>pointInsideConvex(point,hull)),`solid point ${point}`).toBe(true);
      const manifest=JSON.parse(await fs.readFile(result.manifestPath,'utf8'));
      expect(manifest.tool.coacd).toBe('1.0.14');expect(manifest.tool.numpy).toBe('2.0.2');expect(manifest.options.seed).toBe(12345);
      expect(manifest.validation.normalizedMaxDistance).toBeLessThanOrEqual(0.04);
      expect(manifest.engineVerified).toBe(false);
    } finally {await fs.rm(root,{recursive:true,force:true});}
  },300_000);
});
