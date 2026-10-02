import { NodeIO } from '@gltf-transform/core';
import { invalidInput, invalidState } from '../util/errors.js';

export type Vec3 = [number, number, number];
export type Triangle = [number, number, number];
export interface TriangleMesh { vertices: Vec3[]; faces: Triangle[] }
export const MAX_SOURCE_TRIANGLES = 20_000;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const length = (a: Vec3): number => Math.hypot(...a);
export function meshBounds(mesh: TriangleMesh) {
  const min: Vec3 = [Infinity, Infinity, Infinity], max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of mesh.vertices) for (let axis = 0; axis < 3; axis++) { min[axis] = Math.min(min[axis]!, p[axis]!); max[axis] = Math.max(max[axis]!, p[axis]!); }
  return { min, max, diagonal: length(sub(max, min)) };
}
export function meshVolume(mesh: TriangleMesh): number {
  const center = mesh.vertices[0]!;
  return mesh.faces.reduce((sum, [a,b,c]) => sum + dot(sub(mesh.vertices[a]!, center), cross(sub(mesh.vertices[b]!, center), sub(mesh.vertices[c]!, center))) / 6, 0);
}
/** Closed edge-manifold validation. Does not claim a proof of absence of self-intersection. */
export function validateTriangleMesh(mesh: TriangleMesh, maxVertices: number, maxFaces: number): void {
  if (!Array.isArray(mesh.vertices) || !Array.isArray(mesh.faces) || mesh.vertices.length < 4 || mesh.vertices.length > maxVertices || mesh.faces.length < 4 || mesh.faces.length > maxFaces) throw invalidInput('Collision mesh exceeds vertex/triangle limits or has no volume');
  for (const p of mesh.vertices) if (!Array.isArray(p) || p.length !== 3 || !p.every(v => Number.isFinite(v) && Math.abs(v) <= 1e6)) throw invalidInput('Collision coordinates must be finite and within one million source units');
  const bounds = meshBounds(mesh);
  if (!Number.isFinite(bounds.diagonal) || bounds.diagonal < 1e-8) throw invalidInput('Collision bounds are degenerate');
  const edges = new Map<string, { count: number; direction: number }>();
  for (const face of mesh.faces) {
    if (!Array.isArray(face) || face.length !== 3 || face.some(i => !Number.isSafeInteger(i) || i < 0 || i >= mesh.vertices.length) || new Set(face).size !== 3) throw invalidInput('Collision triangle has invalid indices');
    const [a,b,c] = face.map(i => mesh.vertices[i]!) as [Vec3,Vec3,Vec3];
    if (length(cross(sub(b,a), sub(c,a))) <= bounds.diagonal ** 2 * 1e-12) throw invalidInput('Collision mesh contains degenerate triangles');
    for (let k = 0; k < 3; k++) {
      const from = face[k]!, to = face[(k+1)%3]!; const key = `${Math.min(from,to)}:${Math.max(from,to)}`;
      const edge = edges.get(key) ?? { count: 0, direction: 0 }; edge.count++; edge.direction += from < to ? 1 : -1; edges.set(key,edge);
    }
  }
  if ([...edges.values()].some(edge => edge.count !== 2 || edge.direction !== 0)) throw invalidInput('Collision input must be a closed consistently oriented edge-manifold triangle surface');
  if (Math.abs(meshVolume(mesh)) <= bounds.diagonal ** 3 * 1e-10) throw invalidInput('Collision mesh has zero or cancelling signed volume');
}

/** Strict embedded GLB, default scene, world-space static triangles; no file or network sidecars. */
export async function extractCollisionTriangles(bytes: Uint8Array): Promise<TriangleMesh> {
  if (bytes.length > 64 * 1024 * 1024) throw invalidInput('Collision input exceeds 64 MiB');
  const io = new NodeIO().setLogger({ debug() {}, info() {}, warn(message: string) { throw invalidInput(`Collision extraction refuses unsupported glTF: ${message}`); }, error(message: string) { throw invalidInput(message); } });
  const json = await io.binaryToJSON(bytes);
  if ((json.json.extensionsUsed?.length ?? 0) > 0 || (json.json.extensionsRequired?.length ?? 0) > 0) throw invalidInput('Collision extraction requires extension-free embedded GLB geometry');
  for(const node of json.json.nodes??[]) if(node.matrix && (node.matrix.length!==16 || !node.matrix.every(Number.isFinite) || node.matrix[3]!==0 || node.matrix[7]!==0 || node.matrix[11]!==0 || node.matrix[15]!==1)) throw invalidInput('Collision node matrix must be a finite affine transform');
  const document = await io.readJSON(json); const root = document.getRoot();
  if (root.listAnimations().length || root.listSkins().length) throw invalidInput('Collision decomposition requires a static asset: bake animations and skins first');
  const scene = root.getDefaultScene() ?? (root.listScenes().length === 1 ? root.listScenes()[0] : undefined);
  if (!scene) throw invalidInput('Collision extraction requires an unambiguous default scene');
  const mesh: TriangleMesh = { vertices: [], faces: [] }; const welded = new Map<string,number>();
  scene.traverse(node => {
    const m = node.getWorldMatrix();
    if (!m.every(Number.isFinite)) throw invalidInput('Non-finite node transform');
    const determinant = m[0]!*(m[5]!*m[10]!-m[9]!*m[6]!) - m[4]!*(m[1]!*m[10]!-m[9]!*m[2]!) + m[8]!*(m[1]!*m[6]!-m[5]!*m[2]!);
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      if (primitive.getMode() !== 4 || primitive.listTargets().length) throw invalidInput('Only static TRIANGLES primitives are supported for collision');
      const positions = primitive.getAttribute('POSITION'); const indices = primitive.getIndices();
      if(indices&&indices.getType()!=='SCALAR')throw invalidInput('Collision indices must use a SCALAR accessor');
      if (!positions || positions.getType() !== 'VEC3') throw invalidInput('Collision primitive has no VEC3 positions');
      const count = indices?.getCount() ?? positions.getCount();
      if (count % 3 || count / 3 + mesh.faces.length > MAX_SOURCE_TRIANGLES || positions.getCount() > MAX_SOURCE_TRIANGLES * 3) throw invalidInput('Collision extraction exceeds 20000 triangles or has incomplete triangles');
      for (let offset = 0; offset < count; offset += 3) {
        const face: number[] = [];
        for (let corner = 0; corner < 3; corner++) {
          const index = indices ? indices.getScalar(offset + corner) : offset + corner;
          if (!Number.isSafeInteger(index) || index < 0 || index >= positions.getCount()) throw invalidInput('Collision source index is outside its position accessor');
          const p = positions.getElement(index, []);
          const world = [0,1,2].map(row => m[row]! * p[0]! + m[row+4]! * p[1]! + m[row+8]! * p[2]! + m[row+12]!) as Vec3;
          if (!world.every(Number.isFinite)) throw invalidInput('Collision source contains non-finite transformed geometry');
          const key = world.join(','); let weldedIndex = welded.get(key);
          if (weldedIndex === undefined) { weldedIndex = mesh.vertices.length; welded.set(key,weldedIndex); mesh.vertices.push(world); }
          face.push(weldedIndex);
        }
        if (determinant < 0) [face[1],face[2]] = [face[2]!,face[1]!];
        mesh.faces.push(face as Triangle);
      }
    }
  });
  validateTriangleMesh(mesh, MAX_SOURCE_TRIANGLES * 3, MAX_SOURCE_TRIANGLES);
  if (meshVolume(mesh) < 0) for (const face of mesh.faces) [face[1],face[2]] = [face[2],face[1]];
  return mesh;
}

export interface HullValidation { volume: number; maxPlaneViolation: number; convex: true }
export function validateConvexHull(mesh: TriangleMesh, maxVertices: number): HullValidation {
  validateTriangleMesh(mesh, maxVertices, maxVertices * 2 - 4);
  const bounds = meshBounds(mesh), tolerance = bounds.diagonal * 2e-6;
  const center = mesh.vertices.reduce((sum,p) => [sum[0]+p[0]/mesh.vertices.length,sum[1]+p[1]/mesh.vertices.length,sum[2]+p[2]/mesh.vertices.length] as Vec3, [0,0,0] as Vec3);
  let maxPlaneViolation = 0;
  for (const [a,b,c] of mesh.faces) {
    const point = mesh.vertices[a]!, normal = cross(sub(mesh.vertices[b]!,point),sub(mesh.vertices[c]!,point));
    const scale = length(normal); const sign = dot(normal,sub(center,point)) > 0 ? -1 : 1;
    for (const vertex of mesh.vertices) maxPlaneViolation = Math.max(maxPlaneViolation, sign * dot(normal,sub(vertex,point)) / scale);
  }
  if (maxPlaneViolation > tolerance) throw invalidState('CoACD output is not convex within the declared tolerance');
  return { convex: true, volume: Math.abs(meshVolume(mesh)), maxPlaneViolation };
}
export function pointInsideConvex(point: Vec3, mesh: TriangleMesh): boolean {
  const center = mesh.vertices.reduce((sum,p) => [sum[0]+p[0]/mesh.vertices.length,sum[1]+p[1]/mesh.vertices.length,sum[2]+p[2]/mesh.vertices.length] as Vec3, [0,0,0] as Vec3);
  const tolerance = meshBounds(mesh).diagonal * 2e-6;
  return mesh.faces.every(([a,b,c]) => { const p = mesh.vertices[a]!, normal = cross(sub(mesh.vertices[b]!,p),sub(mesh.vertices[c]!,p)); return (dot(normal,sub(center,p)) > 0 ? -1 : 1)*dot(normal,sub(point,p)) <= tolerance*length(normal); });
}
function segmentDistance(p: Vec3,a: Vec3,b: Vec3): number { const d=sub(b,a); const t=Math.max(0,Math.min(1,dot(sub(p,a),d)/dot(d,d))); return length(sub(p,[a[0]+t*d[0],a[1]+t*d[1],a[2]+t*d[2]])); }
function triangleDistance(p: Vec3,a: Vec3,b: Vec3,c: Vec3): number {
  const ab=sub(b,a), ac=sub(c,a), normal=cross(ab,ac), norm2=dot(normal,normal), signed=dot(sub(p,a),normal)/norm2;
  const q: Vec3=[p[0]-signed*normal[0],p[1]-signed*normal[1],p[2]-signed*normal[2]];
  if ([dot(cross(ab,sub(q,a)),normal), dot(cross(sub(c,b),sub(q,b)),normal),dot(cross(sub(a,c),sub(q,c)),normal)].every(v=>v>=-norm2*1e-10)) return Math.abs(signed)*Math.sqrt(norm2);
  return Math.min(segmentDistance(p,a,b),segmentDistance(p,b,c),segmentDistance(p,c,a));
}
function surfaceDistance(point: Vec3,mesh: TriangleMesh): number { let distance=Infinity; for (const [a,b,c] of mesh.faces) distance=Math.min(distance,triangleDistance(point,mesh.vertices[a]!,mesh.vertices[b]!,mesh.vertices[c]!)); return distance; }
function insideSource(point: Vec3, mesh: TriangleMesh): boolean {
  // An irrational-direction parity ray avoids aligned grid faces. Deduplicate coplanar triangle hits.
  const direction: Vec3=[1,0.3713906763541037,0.5291502622129182], hits: number[]=[];
  for (const [ia,ib,ic] of mesh.faces) {
    const a=mesh.vertices[ia]!, ab=sub(mesh.vertices[ib]!,a), ac=sub(mesh.vertices[ic]!,a), h=cross(direction,ac), determinant=dot(ab,h);
    if (Math.abs(determinant)<1e-14) continue;
    const inverse=1/determinant,s=sub(point,a),u=inverse*dot(s,h); if(u<0||u>1) continue;
    const q=cross(s,ab),v=inverse*dot(direction,q); if(v<0||u+v>1) continue;
    const t=inverse*dot(ac,q); if(t>1e-9) hits.push(t);
  }
  hits.sort((a,b)=>a-b); return hits.filter((hit,index)=>index===0||Math.abs(hit-hits[index-1]!)>1e-8).length%2===1;
}
function halton(index: number, base: number): number { let f=1,result=0; while(index>0) { f/=base; result+=f*(index%base); index=Math.floor(index/base); } return result; }
function surfaceSamples(mesh: TriangleMesh,count: number): Vec3[] {
  const cumulative: number[]=[]; let area=0;
  for(const [a,b,c] of mesh.faces){area+=length(cross(sub(mesh.vertices[b]!,mesh.vertices[a]!),sub(mesh.vertices[c]!,mesh.vertices[a]!)));cumulative.push(area);}
  return Array.from({length:count},(_,i)=>{
    const target=halton(i+1,2)*area; const face=mesh.faces[cumulative.findIndex(value=>value>=target)]!;
    const [a,b,c]=face.map(index=>mesh.vertices[index]!) as [Vec3,Vec3,Vec3]; const u=Math.sqrt(halton(i+1,3)),v=halton(i+1,5);
    return [0,1,2].map(axis=>(1-u)*a[axis]!+u*(1-v)*b[axis]!+u*v*c[axis]!) as Vec3;
  });
}
/** Sampled solid-union error, not an exact Hausdorff bound or a physics-engine acceptance proof. */
export function measureApproximation(source: TriangleMesh, hulls: TriangleMesh[], sampleCount: number) {
  const bounds=meshBounds(source); let sourceToHulls=0,hullsToSource=0;
  for(const point of surfaceSamples(source,sampleCount)) if(!hulls.some(hull=>pointInsideConvex(point,hull))) sourceToHulls=Math.max(sourceToHulls,Math.min(...hulls.map(hull=>surfaceDistance(point,hull))));
  const perHull=Math.max(4,Math.floor(sampleCount/hulls.length));
  const probes=hulls.flatMap(hull=>surfaceSamples(hull,perHull));
  for(let i=1;i<=sampleCount;i++) probes.push([0,1,2].map(axis=>bounds.min[axis]!+(bounds.max[axis]!-bounds.min[axis]!)*halton(i,[2,3,5][axis]!)) as Vec3);
  let occupiedProbes=0;
  for(const point of probes) if(hulls.some(hull=>pointInsideConvex(point,hull))) { occupiedProbes++; const distance=surfaceDistance(point,source); if(distance>bounds.diagonal*1e-7&&!insideSource(point,source)) hullsToSource=Math.max(hullsToSource,distance); }
  const maxDistance=Math.max(sourceToHulls,hullsToSource);
  return { method:'deterministic-area-weighted-surface-and-volume-solid-union-samples.v1', sourceSamples:sampleCount, hullAndVolumeSamples:probes.length, occupiedProbes, sourceToHulls, hullsToSource, maxDistance, normalizedMaxDistance:maxDistance/bounds.diagonal, exactBound:false };
}
