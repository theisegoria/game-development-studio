import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { previewGlb, escapeHtml as esc } from './previews.js';
import { inspectGltf } from '../inspection/gltf.js';
import { buildAssetPackage, canonicalJson } from '../packages/format.js';
import { AssetCatalog } from '../packages/catalog.js';
import { verifyRunBundle } from '../harness/run-bundle.js';
import { compareRunVisuals, loadCapture } from '../harness/visual.js';

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const id = z.string().uuid();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const candidateSchema = z.object({ id, name: z.string(), sourcePath: z.string(), sha256: digest, snapshotPath: z.string() }).strict();
const sessionSchema = z.object({ schema: z.literal('game_dev.asset_review.v1'), id, createdAt: z.string(), candidates: z.array(candidateSchema).min(1).max(6) }).strict();
const approvalSchema = z.object({ schema: z.literal('game_dev.asset_review_decision.v1'), id, sessionId: id, candidateId: id, sha256: digest, decision: z.enum(['approve', 'reject']), reviewer: z.string().min(1), reason: z.string().min(1), createdAt: z.string() }).strict();
const baselineSchema = z.object({ schema: z.literal('game_dev.visual_baseline.v1'), id, name: z.string().min(1), scenario: z.string().min(1), runPath: z.string(), runId: z.string(), manifestSha256: digest, adapterId: z.string(), scenarioId: z.string(), createdAt: z.string() }).strict();
const regressionSchema = z.object({ schema: z.literal('game_dev.regression_record.v1'), id, baselineId: id, scenario: z.string(), candidateRunPath: z.string(), candidateManifestSha256: digest, comparisonHash: digest, createdAt: z.string() }).strict();
const matrixSchema = z.object({schema:z.literal('game_dev.visual_matrix.v1'),id,createdAt:z.string(),results:z.array(z.object({id:id.optional(),baselineId:z.string(),error:z.string().optional()}).strict())}).strict();
const regressionDecisionSchema = z.object({ schema: z.literal('game_dev.regression_decision.v1'), id, regressionId: id, comparisonHash: digest, decision: z.enum(['expected-change', 'regression', 'needs-review']), reviewer: z.string().min(1), reason: z.string().min(1), createdAt: z.string() }).strict();
const style = `body{font:16px system-ui;background:#0d1420;color:#edf3fc;margin:2rem}a{color:#91caff}h1{font-size:2rem}section,.card{background:#182436;border-radius:12px;padding:1rem;margin:1rem 0} .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}svg,img{max-width:100%;height:auto}button,select,input,textarea{padding:.6rem;background:#263951;color:#fff;border:1px solid #7f9bbd;border-radius:5px}table{width:100%;border-collapse:collapse}td,th{padding:.6rem;border-bottom:1px solid #40536c;text-align:left}code{overflow-wrap:anywhere} .muted{color:#aebed4} [hidden]{display:none!important}`;
const page = (title: string, body: string, script = '') => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${esc(title)}</title><style>${style}</style><h1>${esc(title)}</h1>${body}<script>${script}</script></html>`;
async function writeNew(file: string, value: unknown): Promise<void> { await fs.mkdir(path.dirname(file), {recursive:true,mode:0o700}); await fs.writeFile(file, canonicalJson(value), {flag:'wx',mode:0o600}); }
function recordPath(root: string, folder: string, value: string) { return path.join(root, folder, `${id.parse(value)}.json`); }
async function read<T>(file: string, schema: z.ZodType<T>): Promise<T> { return schema.parse(JSON.parse(await fs.readFile(file,'utf8'))); }
async function records<T>(root: string, folder: string, schema: z.ZodType<T>): Promise<{records:T[]; corrupt:string[]}> {
  const output: T[] = [], corrupt: string[] = [];
  let names: string[]; try { names = await fs.readdir(path.join(root,folder)); } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {records:[],corrupt:[]}; throw err; }
  for(const name of names.filter(n=>n.endsWith('.json')).sort()) { try { output.push(await read(path.join(root,folder,name),schema)); } catch { corrupt.push(`${folder}/${name}`); } }
  return {records:output,corrupt};
}

export async function createAssetReview(root: string, candidates: Array<{name:string; modelPath:string}>) {
  if(candidates.length < 1 || candidates.length > 6) throw new Error('Review requires 1–6 candidates');
  const sessionId = randomUUID();
  const directory = path.join(root,'sessions',sessionId);
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const entries: z.infer<typeof candidateSchema>[] = []; const cards: string[] = [];
  for(const [index, candidate] of candidates.entries()) {
    const sourcePath = path.resolve(candidate.modelPath);
    if ((await fs.stat(sourcePath)).size > 64_000_000) throw new Error('Review GLB size limit is 64 MB');
    const bytes = await fs.readFile(sourcePath); const candidateId = randomUUID();
    const previews = await previewGlb(bytes);
    const snapshotPath = path.join(directory, `${candidateId}.glb`);
    await fs.writeFile(snapshotPath,bytes,{flag:'wx',mode:0o600});
    const inspection = await inspectGltf(snapshotPath);
    const entry = {id:candidateId,name:candidate.name,sourcePath,sha256:hash(bytes),snapshotPath}; entries.push(entry);
    cards.push(`<section class="candidate" data-candidate="${candidateId}"><h2>${esc(candidate.name)}</h2><label><input type="radio" name="chosen" value="${candidateId}" ${index === 0?'checked':''}> Select candidate</label><div class="turns">${previews.turns.map((s,i)=>`<div data-frame="${i}" ${i?'hidden':''}>${s}</div>`).join('')}</div><div class="wires" hidden>${previews.wireframes.map((s,i)=>`<div data-frame="${i}" ${i?'hidden':''}>${s}</div>`).join('')}</div><div class="uv" hidden>${previews.uv}<p>${inspection.hasUVs?'UV channel 0, overlaps shown':'UV channel 0 missing on some or all primitives'}</p></div><div class="materials" hidden>${previews.materials.map(m=>`<p>${esc(m.name || 'Unnamed material')} · base RGBA ${esc(m.color)} · metallic ${m.metallic} · roughness ${m.roughness}</p>${m.texture?`<img alt="Base color texture swatch" src="${m.texture}">`:''}`).join('')}</div><p>${inspection.triangleCount} triangles · ${inspection.materialCount} materials</p><details><summary>Inspection and limitations</summary><pre>${esc(JSON.stringify(inspection,null,2))}</pre>${previews.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</details><code>${entry.sha256}</code></section>`);
  }
  const session = {schema:'game_dev.asset_review.v1' as const,id:sessionId,createdAt:new Date().toISOString(),candidates:entries};
  await writeNew(recordPath(root,'reviews',sessionId),session);
  const body = `<p>Side-by-side asset selection. CPU static previews are evidence for geometry inspection, not final material rendering or artistic quality.</p><label>View <select id="mode"><option value="turns">Turntable base color</option><option value="wires">Wireframe</option><option value="uv">UV layout</option><option value="materials">Material swatches</option></select></label> <label>Angle <input id="angle" type="range" min="0" max="7" value="0"></label> <button id="play">Play / pause</button><div class="grid">${cards.join('')}</div><section><h2>Record review</h2><p>Selection does not grant paid authority. Submit the generated arguments to <code>decide_asset_review</code>; then <code>package_reviewed_asset</code> verifies the same bytes and catalogs the standalone package.</p><label>Reviewer <input id="reviewer"></label> <label>Decision <select id="decision"><option>approve</option><option>reject</option></select></label><p><label>Reason <textarea id="reason"></textarea></label></p><button id="arguments">Prepare decision arguments</button><pre id="result" aria-live="polite"></pre></section>`;
  const script = `const mode=document.getElementById('mode'),angle=document.getElementById('angle');function update(){document.querySelectorAll('.candidate').forEach(c=>{['turns','wires','uv','materials'].forEach(m=>c.querySelector('.'+m).hidden=m!==mode.value);c.querySelectorAll('[data-frame]').forEach(f=>f.hidden=f.dataset.frame!==angle.value)})}mode.onchange=update;angle.oninput=update;let timer;document.getElementById('play').onclick=()=>{if(timer){clearInterval(timer);timer=null}else timer=setInterval(()=>{angle.value=(+angle.value+1)%8;update()},500)};document.getElementById('arguments').onclick=()=>{document.getElementById('result').textContent=JSON.stringify({sessionId:'${sessionId}',candidateId:document.querySelector('[name=chosen]:checked').value,decision:document.getElementById('decision').value,reviewer:document.getElementById('reviewer').value,reason:document.getElementById('reason').value},null,2)};`;
  const dashboardPath = path.join(directory,'index.html'); if(Buffer.byteLength(body)>48_000_000) throw new Error('Review dashboard exceeds 48 MB; use fewer candidates or smaller review LODs'); await fs.writeFile(dashboardPath,page('Asset candidate review',body,script),{flag:'wx',mode:0o600});
  return {...session,dashboardPath};
}

export async function decideAssetReview(root:string, args: {sessionId:string;candidateId:string;decision:'approve'|'reject';reviewer:string;reason:string}) {
  const session = await read(recordPath(root,'reviews',args.sessionId),sessionSchema);
  const candidate = session.candidates.find(c=>c.id===args.candidateId); if(!candidate) throw new Error('Candidate is not in review');
  if(hash(await fs.readFile(candidate.snapshotPath)) !== candidate.sha256) throw new Error('Review snapshot changed; create a new review');
  const decision = approvalSchema.parse({schema:'game_dev.asset_review_decision.v1',id:randomUUID(),...args,sha256:candidate.sha256,createdAt:new Date().toISOString()});
  await writeNew(recordPath(root,'decisions',decision.id),decision); return decision;
}

export async function packageReviewedAsset(root:string, options:{decisionId:string;packagesRoot:string;catalogPath:string;name:string;license:string}) {
  const decision = await read(recordPath(root,'decisions',options.decisionId),approvalSchema);
  if(decision.decision !== 'approve') throw new Error('Packaging requires an approved candidate');
  const history = await records(root,'decisions',approvalSchema);
  if(history.corrupt.length) throw new Error('Corrupt review decision records must be recovered before packaging');
  const newer = history.records.some(d=>d.sessionId===decision.sessionId && d.candidateId===decision.candidateId && d.createdAt >= decision.createdAt && d.id !== decision.id);
  if(newer) throw new Error('Decision superseded; use the latest review decision');
  const session = await read(recordPath(root,'reviews',decision.sessionId),sessionSchema);
  const candidate = session.candidates.find(c=>c.id===decision.candidateId); if(!candidate) throw new Error('Missing reviewed candidate');
  if(hash(await fs.readFile(candidate.snapshotPath))!==decision.sha256 || decision.sha256!==candidate.sha256) throw new Error('Reviewed bytes changed');
  const built = await buildAssetPackage({packagesRoot:options.packagesRoot,sourcePath:candidate.snapshotPath,name:options.name,license:options.license,provenance:{notes:`Asset review ${decision.id}; reviewed SHA-256 ${decision.sha256}; reviewer attribution ${decision.reviewer}; reason ${decision.reason}`},maximumBytes:64_000_000});
  if(hash(await fs.readFile(path.join(built.packagePath,'model.glb')))!==decision.sha256) throw new Error('Packaged bytes differ from reviewed bytes');
  const catalog = await AssetCatalog.open(options.catalogPath);
  try { return {schema:'game_dev.reviewed_package.v1',review:decision,package:built,catalog:await catalog.admit(built.packagePath)}; } finally {catalog.close();}
}

export async function nameVisualBaseline(root:string,args:{name:string;scenario:string;runPath:string}) {
  const capture = await loadCapture(args.runPath);
  const verified = await verifyRunBundle(capture.runPath);
  const entry = baselineSchema.parse({schema:'game_dev.visual_baseline.v1',id:randomUUID(),name:args.name,scenario:args.scenario,runPath:capture.runPath,runId:capture.runId,manifestSha256:verified.manifestSha256,adapterId:capture.adapterId,scenarioId:capture.scenarioId,createdAt:new Date().toISOString()});
  await writeNew(recordPath(root,'baselines',entry.id),entry); return entry;
}
export async function compareVisualMatrix(root:string,args:{entries:Array<{baselineId:string;candidateRunPath:string}>;threshold?:number}) {
  if(args.entries.length < 1 || args.entries.length > 32) throw new Error('Matrix requires 1–32 scenarios');
  const results: Array<{id?:string;baselineId:string;error?:string}> = [];
  for(const pair of args.entries) {
    try {
      const baseline = await read(recordPath(root,'baselines',pair.baselineId),baselineSchema);
      const capture = await loadCapture(baseline.runPath);
      if((await verifyRunBundle(baseline.runPath)).manifestSha256!==baseline.manifestSha256 || capture.runId!==baseline.runId || capture.adapterId!==baseline.adapterId || capture.scenarioId!==baseline.scenarioId) throw new Error('Named baseline identity changed');
      const comparisonId = randomUUID(); const outputPath=path.join(root,'comparisons',comparisonId);
      await compareRunVisuals({baselineRunPath:baseline.runPath,candidateRunPath:pair.candidateRunPath,outputPath,threshold:args.threshold});
      const entry=regressionSchema.parse({schema:'game_dev.regression_record.v1',id:comparisonId,baselineId:baseline.id,scenario:baseline.scenario,candidateRunPath:path.resolve(pair.candidateRunPath),candidateManifestSha256:(await verifyRunBundle(pair.candidateRunPath)).manifestSha256,comparisonHash:hash(await fs.readFile(path.join(outputPath,'comparison.json'))),createdAt:new Date().toISOString()});
      await writeNew(recordPath(root,'regressions',entry.id),entry);results.push({id:entry.id,baselineId:baseline.id});
    }catch(error){results.push({baselineId:pair.baselineId,error:error instanceof Error?error.message:String(error)});}
  }
  const matrix=matrixSchema.parse({schema:'game_dev.visual_matrix.v1',id:randomUUID(),createdAt:new Date().toISOString(),results});
  await writeNew(recordPath(root,'matrices',matrix.id),matrix);
  return {...matrix,dashboard:await writeRegressionDashboard(root)};
}
export async function decideVisualRegression(root:string,args:{regressionId:string;decision:'expected-change'|'regression'|'needs-review';reviewer:string;reason:string}) {
  const entry=await read(recordPath(root,'regressions',args.regressionId),regressionSchema);
  if(hash(await fs.readFile(path.join(root,'comparisons',entry.id,'comparison.json')))!==entry.comparisonHash)throw new Error('Comparison changed; review cannot be recorded');
  const decision=regressionDecisionSchema.parse({schema:'game_dev.regression_decision.v1',id:randomUUID(),...args,comparisonHash:entry.comparisonHash,createdAt:new Date().toISOString()});
  await writeNew(recordPath(root,'regression-decisions',decision.id),decision);return decision;
}
export async function writeRegressionDashboard(root:string) {
  const baselines=await records(root,'baselines',baselineSchema), regressions=await records(root,'regressions',regressionSchema), decisions=await records(root,'regression-decisions',regressionDecisionSchema);
  const matrices=await records(root,'matrices',matrixSchema);
  const corrupt=[...matrices.corrupt,...baselines.corrupt,...regressions.corrupt,...decisions.corrupt]; const rows:string[]=[]; let previewBudget=24_000_000;
  for(const entry of regressions.records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))) {
    const file=path.join(root,'comparisons',entry.id,'comparison.json');
    let comparison: {verdict:string;summary:string[];pairs:Array<{baselinePath:string;candidatePath:string;heatmapPath?:string;changedPixelRatio?:number}>};
    try {const bytes=await fs.readFile(file);if(hash(bytes)!==entry.comparisonHash)throw new Error('tampered');comparison=JSON.parse(bytes.toString());}catch{corrupt.push(`comparison/${entry.id}`);continue;}
    const history=decisions.records.filter(d=>d.regressionId===entry.id&&d.comparisonHash===entry.comparisonHash).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const baseline=baselines.records.find(b=>b.id===entry.baselineId);
    const name=baseline?.name ?? entry.baselineId;
    let previewsVerified=false;
    try { previewsVerified=!!baseline && (await verifyRunBundle(baseline.runPath)).manifestSha256===baseline.manifestSha256 && (await verifyRunBundle(entry.candidateRunPath)).manifestSha256===entry.candidateManifestSha256; } catch { /* historical metrics remain, current image bytes are not trusted */ }
    const thumbnails: string[]=[];
    for(const pair of (previewsVerified?comparison.pairs:[]).slice(0,6)) {
      const images:string[]=[];
      for(const [label,file] of [['Baseline',pair.baselinePath],['Candidate',pair.candidatePath],['Pixel heatmap',pair.heatmapPath]] as const) {
        if(!file)continue; try {const size=(await fs.stat(file)).size;if(size>Math.min(4_000_000,previewBudget))continue;previewBudget-=size;const bytes=await fs.readFile(file);if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))images.push(`<figure><img alt="${label}" src="data:image/png;base64,${bytes.toString('base64')}"><figcaption>${label}</figcaption></figure>`);}catch { /* missing preview is visible below */ }
      }
      thumbnails.push(`<div class="grid">${images.join('')}</div><p>Changed pixel ratio: ${pair.changedPixelRatio ?? 'not comparable'}</p>`);
    }
    rows.push(`<section data-scenario="${esc(entry.scenario)}"><h2>${esc(entry.scenario)} · ${esc(name)}</h2><p>${esc(entry.createdAt)} · Pixel verdict: <strong>${esc(comparison.verdict)}</strong> · Human decision: <strong>${esc(history[0]?.decision ?? 'needs-review')}</strong></p><code>${entry.id}</code>${comparison.summary.map(s=>`<p>${esc(s)}</p>`).join('')}${previewsVerified?thumbnails.join(''):'<p>Original sealed runs are missing or changed; current previews withheld. Historical metrics remain recorded.</p>'}<details><summary>Decision history</summary>${history.map(d=>`<p>${esc(d.createdAt)} · ${esc(d.reviewer)} · ${esc(d.decision)}: ${esc(d.reason)}</p>`).join('')||'No decision recorded'}</details></section>`);
  }
  const scenarios=[...new Set(regressions.records.map(r=>r.scenario))];
  const body=`<p>Pixel difference is not artistic quality. Expected-change approval records human intent; it never changes numerical comparison results or silently promotes a baseline. Baselines are immutable versions; name a new version explicitly.</p><label>Scenario <select id="filter"><option value="">All scenarios</option>${scenarios.map(s=>`<option>${esc(s)}</option>`).join('')}</select></label><p>${baselines.records.length} named baseline versions · ${regressions.records.length} comparisons</p>${corrupt.length?`<p>Corrupt or changed records (not trusted): ${corrupt.map(esc).join(', ')}</p>`:''}<section><h2>Named baselines</h2><table><tr><th>Name</th><th>Scenario</th><th>Version ID</th></tr>${baselines.records.map(b=>`<tr><td>${esc(b.name)}</td><td>${esc(b.scenario)}</td><td>${esc(b.id)}</td></tr>`).join('')}</table></section><section><h2>Scenario matrix history</h2>${matrices.records.map(m=>`<p>${esc(m.createdAt)}</p><ul>${m.results.map(r=>`<li>${esc(r.baselineId)}: ${esc(r.error ?? r.id ?? 'no result')}</li>`).join('')}</ul>`).join('')}</section>${rows.join('')}<section><h2>Expected-change review</h2><p>Submit these arguments to <code>decide_visual_regression</code>, then refresh this dashboard.</p><label>Comparison <select id=regression>${regressions.records.map(r=>`<option value="${r.id}">${esc(r.scenario)} · ${r.id}</option>`).join('')}</select></label> <label>Decision <select id=decision><option>expected-change</option><option>regression</option><option>needs-review</option></select></label><p><label>Reviewer <input id=reviewer></label> <label>Reason <textarea id=reason></textarea></label></p><button id=arguments>Prepare decision arguments</button><pre id=result aria-live=polite></pre></section>`;
  const dashboardPath=path.join(root,'regression-dashboard.html');await fs.mkdir(root,{recursive:true});await fs.writeFile(dashboardPath,page('Visual regression dashboard',body,`document.getElementById('filter').onchange=e=>document.querySelectorAll('[data-scenario]').forEach(s=>s.hidden=!!e.target.value&&s.dataset.scenario!==e.target.value);document.getElementById('arguments').onclick=()=>{document.getElementById('result').textContent=JSON.stringify({regressionId:document.getElementById('regression').value,decision:document.getElementById('decision').value,reviewer:document.getElementById('reviewer').value,reason:document.getElementById('reason').value},null,2)}`),{mode:0o600});
  return {dashboardPath,baselineCount:baselines.records.length,comparisonCount:regressions.records.length,corrupt};
}
