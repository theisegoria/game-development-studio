import { Document,NodeIO } from '@gltf-transform/core';
import type { TriangleMesh,Vec3,Triangle } from '../../src/collision/geometry.js';
export function boxMesh(min:Vec3,max:Vec3):TriangleMesh {
  const [a,b,c]=min,[x,y,z]=max;
  return {vertices:[[a,b,c],[x,b,c],[x,y,c],[a,y,c],[a,b,z],[x,b,z],[x,y,z],[a,y,z]],faces:[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[3,7,6],[3,6,2],[0,4,7],[0,7,3],[1,2,6],[1,6,5]]};
}
/** Connected, closed voxel-boundary U: cavity open in +Y, one source mesh. */
export function concaveU():TriangleMesh {
  const mesh:TriangleMesh={vertices:[],faces:[]},indices=new Map<string,number>();
  const filled=(x:number,y:number)=>x>=0&&x<3&&y>=0&&y<3&&(y===0||x!==1);
  const quads=[{neighbor:[0,0,-1],corners:[0,3,2,1]},{neighbor:[0,0,1],corners:[4,5,6,7]},{neighbor:[0,-1,0],corners:[0,1,5,4]},{neighbor:[0,1,0],corners:[3,7,6,2]},{neighbor:[-1,0,0],corners:[0,4,7,3]},{neighbor:[1,0,0],corners:[1,2,6,5]}];
  for(let x=0;x<3;x++)for(let y=0;y<3;y++)if(filled(x,y)){
    const vertices=boxMesh([x-1.5,y-1.5,-0.5],[x-0.5,y-0.5,0.5]).vertices;
    for(const quad of quads){const [dx,dy,dz]=quad.neighbor;if(dz===0&&filled(x+dx!,y+dy!))continue;const face=quad.corners.map(index=>{const p=vertices[index]!,key=p.join(',');let value=indices.get(key);if(value===undefined){value=mesh.vertices.length;indices.set(key,value);mesh.vertices.push(p);}return value;});mesh.faces.push([face[0]!,face[1]!,face[2]!] as Triangle,[face[0]!,face[2]!,face[3]!] as Triangle);}
  }
  return mesh;
}
export const uParts=()=>[boxMesh([-1.5,-1.5,-0.5],[1.5,-0.5,0.5]),boxMesh([-1.5,-0.5,-0.5],[-0.5,1.5,0.5]),boxMesh([0.5,-0.5,-0.5],[1.5,1.5,0.5])];
export async function collisionGlb(mesh:TriangleMesh,translation:Vec3=[0,0,0],scale:Vec3=[1,1,1]):Promise<Uint8Array>{
  const doc=new Document(),buffer=doc.createBuffer(),scene=doc.createScene();doc.getRoot().setDefaultScene(scene);
  const primitive=doc.createPrimitive().setAttribute('POSITION',doc.createAccessor().setType('VEC3').setArray(new Float32Array(mesh.vertices.flat())).setBuffer(buffer)).setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(mesh.faces.flat())).setBuffer(buffer));
  scene.addChild(doc.createNode().setTranslation(translation).setScale(scale).setMesh(doc.createMesh().addPrimitive(primitive)));
  return new NodeIO().writeBinary(doc);
}
