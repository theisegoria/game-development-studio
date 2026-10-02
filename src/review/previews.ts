import { NodeIO } from '@gltf-transform/core';
import { CollectingLogger, readImageSize } from '../inspection/gltf.js';
import { decodeImage, encodePNG } from '../inspection/image.js';

export const escapeHtml = (s: string): string => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
type Face = { points: number[][]; uv: number[][]; color: string };
export interface CpuPreviews { turns: string[]; wireframes: string[]; uv: string; materials: Array<{ name: string; color: string; metallic: number; roughness: number; texture?: string }>; warnings: string[] }
const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" role="img"><rect width="400" height="400" fill="#152031"/>${body}</svg>`;
/** Bounded CPU geometry preview. No process, network, GPU or external resource loading. */
export async function previewGlb(bytes: Uint8Array): Promise<CpuPreviews> {
  const log = new CollectingLogger();
  const io = new NodeIO().setLogger(log);
  const json = await io.binaryToJSON(bytes);
  const source = json.json as { buffers?: Array<{ uri?: string }>; images?: Array<{ uri?: string }> };
  if ([...(source.buffers ?? []), ...(source.images ?? [])].some(r => r.uri && !r.uri.startsWith('data:'))) throw new Error('Review accepts self-contained GLB only; external resources are not loaded');
  const doc = await io.readJSON(json);
  const root = doc.getRoot();
  const faces: Face[] = [];
  const warnings = [...log.messages, 'CPU static geometry preview: base colors and texture swatches only; no lighting, texture mapping, skinning, morphs or GPU quality certification.'];
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  if (!scene) throw new Error('Review requires a scene');
  scene.traverse(node => {
    const matrix = node.getWorldMatrix();
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const pos = primitive.getAttribute('POSITION');
      if (!pos || primitive.getMode() !== 4) { warnings.push('Skipped a non-triangle primitive or missing POSITION'); continue; }
      const indices = primitive.getIndices(); const uv = primitive.getAttribute('TEXCOORD_0');
      const count = indices?.getCount() ?? pos.getCount();
      const color = primitive.getMaterial()?.getBaseColorFactor() ?? [0.6, 0.7, 0.8, 1];
      for (let i = 0; i + 2 < count; i += 3) {
        if (faces.length >= 10000) throw new Error('CPU review limit is 10,000 triangles; prepare a review LOD first');
        const points: number[][] = []; const uvs: number[][] = [];
        for (let k = 0; k < 3; k++) {
          const index = indices ? indices.getScalar(i + k) : i + k;
          const p = pos.getElement(index, []);
          const world = [0, 1, 2].map(row => matrix[row]! * p[0]! + matrix[row + 4]! * p[1]! + matrix[row + 8]! * p[2]! + matrix[row + 12]!);
          if (!world.every(Number.isFinite)) throw new Error('Non-finite geometry cannot be previewed');
          points.push(world); if (uv) uvs.push(uv.getElement(index, []));
        }
        faces.push({ points, uv: uvs, color: `rgb(${color.slice(0, 3).map(v => Math.round(Math.max(0, Math.min(1, v)) * 255)).join(',')})` });
      }
    }
  });
  if (!faces.length) throw new Error('No triangle geometry available');
  const minimum = [Infinity, Infinity, Infinity], maximum = [-Infinity, -Infinity, -Infinity];
  for (const face of faces) for (const p of face.points) for (let k = 0; k < 3; k++) { minimum[k] = Math.min(minimum[k]!, p[k]!); maximum[k] = Math.max(maximum[k]!, p[k]!); }
  const center = minimum.map((v, k) => (v + maximum[k]!) / 2);
  const scale = 280 / Math.max(0.00001, ...maximum.map((v, k) => v - minimum[k]!));
  const turns: string[] = [], wireframes: string[] = [];
  for (let frame = 0; frame < 8; frame++) {
    const angle = frame * Math.PI / 4;
    const projected = faces.map(f => ({ ...f, p: f.points.map(p => {
      const x = p[0]! - center[0]!, y = p[1]! - center[1]!, z = p[2]! - center[2]!;
      return [(x * Math.cos(angle) + z * Math.sin(angle)) * scale + 200, 200 - y * scale, z * Math.cos(angle) - x * Math.sin(angle)];
    }) })).sort((a,b) => a.p.reduce((v,p)=>v+p[2]!,0) - b.p.reduce((v,p)=>v+p[2]!,0));
    for (const wire of [false, true]) {
      const body = projected.map(f => `<polygon points="${f.p.map(p=>`${p[0]!.toFixed(2)},${p[1]!.toFixed(2)}`).join(' ')}" fill="${wire ? 'none' : f.color}" stroke="${wire ? '#a8e2ff' : '#253247'}" stroke-width="0.5"/>`).join('');
      (wire ? wireframes : turns).push(svg(body));
    }
  }
  const uv = svg(faces.filter(f=>f.uv.length === 3).map(f=>`<polygon points="${f.uv.map(p=>`${(p[0]! * 360 + 20).toFixed(2)},${(380-p[1]!*360).toFixed(2)}`).join(' ')}" fill="none" stroke="#a8e2ff" stroke-width="0.6"/>`).join(''));
  let textureBudget = 8_000_000;
  if(root.listMaterials().length>32) warnings.push('Only the first 32 material swatches are shown');
  const materials = root.listMaterials().slice(0,32).map(m => {
    const bytes = m.getBaseColorTexture()?.getImage(); let texture: string | undefined;
    const dimensions=bytes ? readImageSize(bytes) : undefined;
    if (bytes && dimensions && dimensions.width * dimensions.height <= 4_000_000 && bytes.byteLength <= Math.min(4_000_000,textureBudget)) { textureBudget-=bytes.byteLength; try { const decoded = decodeImage(bytes); if (decoded.width * decoded.height <= 4_000_000) texture = `data:image/png;base64,${Buffer.from(encodePNG(decoded)).toString('base64')}`; } catch { warnings.push('A material texture could not be decoded'); } }
    return { name: m.getName(), color: m.getBaseColorFactor().join(', '), metallic: m.getMetallicFactor(), roughness: m.getRoughnessFactor(), ...(texture ? { texture } : {}) };
  });
  return { turns, wireframes, uv, materials, warnings };
}
