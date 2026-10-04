import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { escapeHtml as esc } from './previews.js';
import { previewReviewGlb } from './animation-previews.js';
import { inspectGltf } from '../inspection/gltf.js';
import { buildAssetPackage, canonicalJson } from '../packages/format.js';
import { AssetCatalog } from '../packages/catalog.js';
import { verifyRunBundle } from '../harness/run-bundle.js';
import { compareRunVisuals, loadCapture } from '../harness/visual.js';
import { reviewSettingsSchema, storedReviewSettingsSchema, REVIEW_RENDERER, type ReviewSettingsInput } from './settings.js';
import { writeReviewCapture } from './evidence.js';
import { readBoundedReviewFile } from './source.js';
import { requireBasis } from '../production/basis.js';
import { type BasisReviewDecodeDeps } from './basis-textures.js';
import { basisReviewEvidenceSchema, verifyBasisReviewBindings } from './basis-binding.js';
import { comparisonControlsCSS, comparisonControlsScript, renderComparisonControls } from './comparison-ui.js';

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const id = z.string().uuid();
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const candidateSchema = z.object({ id, name: z.string(), sourcePath: z.string(), sha256: digest, snapshotPath: z.string() }).strict();
const legacySessionSchema = z.object({ schema: z.literal('game_dev.asset_review.v1'), id, createdAt: z.string(), candidates: z.array(candidateSchema).min(1).max(6) }).strict();
const boundCandidateSchema = candidateSchema.extend({ previewSha256: digest, reviewBinding: digest,previewRunPath:z.string().optional(),previewRunManifestSha256:digest.optional(),basisDecode:basisReviewEvidenceSchema.optional() }).strict();
const boundSessionSchema = z.object({ schema: z.literal('game_dev.asset_review.v2'), id, createdAt: z.string(), candidates: z.array(boundCandidateSchema).min(1).max(6), settings: storedReviewSettingsSchema, renderer: z.object({id:z.string(),version:z.string(),lighting:z.string()}).strict(), dashboardPath:z.string(),dashboardSha256:digest,evidenceHash:digest }).strict().superRefine((session,ctx)=>{
  if(session.renderer.id===REVIEW_RENDERER.id && session.renderer.version===REVIEW_RENDERER.version && typeof session.settings.decodeBasisTextures!=='boolean') ctx.addIssue({code:z.ZodIssueCode.custom,path:['settings','decodeBasisTextures'],message:'Current review records must contain the explicit Basis decode setting'});
  if(session.settings.decodeBasisTextures===true && session.candidates.some(candidate=>!candidate.basisDecode)) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Opted-in reviews require decoder identity evidence for every candidate'});
  if(session.settings.decodeBasisTextures!==true && session.candidates.some(candidate=>candidate.basisDecode)) ctx.addIssue({code:z.ZodIssueCode.custom,message:'Basis evidence requires explicit appearance decode opt-in'});
});
const sessionSchema = z.union([boundSessionSchema,legacySessionSchema]);
const legacyApprovalSchema = z.object({ schema: z.literal('game_dev.asset_review_decision.v1'), id, sessionId: id, candidateId: id, sha256: digest, decision: z.enum(['approve', 'reject']), reviewer: z.string().min(1), reason: z.string().min(1), createdAt: z.string() }).strict();
const boundApprovalSchema = legacyApprovalSchema.extend({schema:z.literal('game_dev.asset_review_decision.v2'),reviewBinding:digest,evidenceHash:digest}).strict();
const approvalSchema = z.union([boundApprovalSchema,legacyApprovalSchema]);
const baselineSchema = z.object({ schema: z.literal('game_dev.visual_baseline.v1'), id, name: z.string().min(1), scenario: z.string().min(1), runPath: z.string(), runId: z.string(), manifestSha256: digest, adapterId: z.string(), scenarioId: z.string(), createdAt: z.string() }).strict();
const regressionSchema = z.object({ schema: z.literal('game_dev.regression_record.v1'), id, baselineId: id, scenario: z.string(), candidateRunPath: z.string(), candidateManifestSha256: digest, comparisonHash: digest, images: z.array(z.object({path:z.string(),sha256:digest}).strict()), createdAt: z.string() }).strict();
const matrixSchema = z.object({schema:z.literal('game_dev.visual_matrix.v1'),id,createdAt:z.string(),results:z.array(z.object({id:id.optional(),baselineId:z.string(),error:z.string().optional()}).strict())}).strict();
const regressionDecisionSchema = z.object({ schema: z.literal('game_dev.regression_decision.v1'), id, regressionId: id, comparisonHash: digest, decision: z.enum(['expected-change', 'regression', 'needs-review']), reviewer: z.string().min(1), reason: z.string().min(1), createdAt: z.string() }).strict();
const style = `body{font:16px system-ui;background:#0d1420;color:#edf3fc;margin:2rem}a{color:#91caff}h1{font-size:2rem}section,.card{background:#182436;border-radius:12px;padding:1rem;margin:1rem 0} .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:1rem}svg,img{max-width:100%;height:auto}button,select,input,textarea{padding:.6rem;background:#263951;color:#fff;border:1px solid #7f9bbd;border-radius:5px}table{width:100%;border-collapse:collapse}td,th{padding:.6rem;border-bottom:1px solid #40536c;text-align:left}code{overflow-wrap:anywhere} .muted{color:#aebed4} [hidden]{display:none!important}`;
const page = (title: string, body: string, script = '') => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${createHash('sha256').update(script).digest('base64')}'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${esc(title)}</title><style>${style}${comparisonControlsCSS}</style><h1>${esc(title)}</h1>${body}<script>${script}</script></html>`;
async function writeNew(file: string, value: unknown): Promise<void> { await fs.mkdir(path.dirname(file), {recursive:true,mode:0o700}); await fs.writeFile(file, canonicalJson(value), {flag:'wx',mode:0o600}); }
function recordPath(root: string, folder: string, value: string) { return path.join(root, folder, `${id.parse(value)}.json`); }
async function read<S extends z.ZodTypeAny>(file: string, schema: S): Promise<z.output<S>> { return schema.parse(JSON.parse(await fs.readFile(file,'utf8'))); }
async function records<S extends z.ZodTypeAny>(root: string, folder: string, schema: S): Promise<{records:z.output<S>[]; corrupt:string[]}> {
  const output: z.output<S>[] = [], corrupt: string[] = [];
  let names: string[]; try { names = await fs.readdir(path.join(root,folder)); } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {records:[],corrupt:[]}; throw err; }
  for(const name of names.filter(n=>n.endsWith('.json')).sort()) { try { output.push(await read(path.join(root,folder,name),schema)); } catch { corrupt.push(`${folder}/${name}`); } }
  return {records:output,corrupt};
}

export async function createAssetReview(root: string, candidates: Array<{name:string; modelPath:string}>, input: ReviewSettingsInput = {}, basisDeps: BasisReviewDecodeDeps = {}) {
  const settings = reviewSettingsSchema.parse(input);
  if(candidates.length < 1 || candidates.length > 6) throw new Error('Review requires 1–6 candidates');
  // Resolve one static identity for the whole session so uncompressed/compressed candidates share a comparison profile.
  const decodeDeps=settings.decodeBasisTextures?{...basisDeps,identity:basisDeps.identity??await requireBasis()}:basisDeps;
  const sessionId = randomUUID();
  const directory = path.join(root,'sessions',sessionId);
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const entries: z.infer<typeof boundCandidateSchema>[] = []; const cards: string[] = [];let cardBytes=0;const playbackTimes:number[]=[];
  for(const [index, candidate] of candidates.entries()) {
    const sourcePath = path.resolve(candidate.modelPath);
    const bytes = await readBoundedReviewFile(sourcePath,64_000_000,'Review GLB source'); const candidateId = randomUUID();
    const previews = await previewReviewGlb(bytes,settings,decodeDeps);
    if(!playbackTimes.length && previews.animationPlayback)playbackTimes.push(...previews.animationPlayback.schedule.samples.map(sample=>sample.timeSeconds));
    const snapshotPath = path.join(directory, `${candidateId}.glb`);
    await fs.writeFile(snapshotPath,bytes,{flag:'wx',mode:0o600});
    const inspection = await inspectGltf(snapshotPath);
    const { envelope, ...stablePreviews } = previews;
    const { durationMs: _duration, ...stableEnvelope } = envelope;
    const sha256=hash(bytes),previewSha256=hash(canonicalJson({...stablePreviews,envelope:stableEnvelope}));
    const reviewBinding=hash(canonicalJson({sha256,previewSha256,settings,renderer:REVIEW_RENDERER}));
    const capture=previews.appearance.length?await writeReviewCapture(directory,previews,settings,sha256,previewSha256):{};
    const entry = {id:candidateId,name:candidate.name,sourcePath,sha256,snapshotPath,previewSha256,reviewBinding,...capture,...(previews.basisDecode?{basisDecode:previews.basisDecode}:{})}; entries.push(entry);
    const appearanceMarkup=previews.appearance.length?`<div class="appearance" hidden>${previews.animationPlayback?previews.animationPlayback.samples.map((sample,sampleIndex)=>`<div data-sample-frame="${sampleIndex}" ${sampleIndex?'hidden':''}>${sample.images.map((src,angle)=>`<div data-frame="${angle}" ${angle?'hidden':''}><img alt="Animation sample at ${sample.timeSeconds} seconds, appearance angle ${angle}" src="${src}"></div>`).join('')}</div>`).join(''):previews.appearance.map((src,i)=>`<div data-frame="${i}" ${i?'hidden':''}><img alt="Controlled lighting appearance angle ${i}" src="${src}"></div>`).join('')}</div>`:'';
    const evidenceMarkup=`<details><summary>UV measurements, animation and resource envelope</summary><p>UV coverage and overlap estimate uses a 128×128 grid in the primary [0,1] tile; shared edges excluded. Texel density is RMS texels per glTF world unit from textured triangle UV/world surface area; exporter physical scale is unverified.</p><pre>${esc(JSON.stringify({uv:previews.uvEvidence,clips:previews.clips,selectedTimeSeconds:previews.selectedTimeSeconds,framing:previews.framing,envelope:previews.envelope,basisDecode:previews.basisDecode,...(previews.animationPlayback?{animationPlayback:{schedule:previews.animationPlayback.schedule,framing:previews.animationPlayback.framing,resources:previews.animationPlayback.resources,clippedViews:previews.animationPlayback.samples.map(sample=>sample.clippedViews)}}:{})},null,2))}</pre></details>`;
    const card=`<section class="candidate" data-candidate="${candidateId}"><h2>${esc(candidate.name)}</h2><label><input type="radio" name="chosen" value="${candidateId}" ${index === 0?'checked':''}> Select candidate</label><div class="turns">${previews.turns.map((s,i)=>`<div data-frame="${i}" ${i?'hidden':''}>${s}</div>`).join('')}</div>${appearanceMarkup}<div class="wires" hidden>${previews.wireframes.map((s,i)=>`<div data-frame="${i}" ${i?'hidden':''}>${s}</div>`).join('')}</div><div class="uv" hidden>${previews.uv}<p>${inspection.hasUVs?'UV channel 0 layout; overlap estimates below':'UV channel 0 missing on some or all primitives'}</p></div><div class="materials" hidden>${previews.materials.map(m=>`<p>${esc(m.name || 'Unnamed material')} · base RGBA ${esc(m.color)} · metallic ${esc(String(m.metallic))} · roughness ${esc(String(m.roughness))}</p>${m.texture?`<img alt="Base color texture swatch" src="${esc(m.texture)}">`:''}`).join('')}</div><p>${inspection.triangleCount} triangles · ${inspection.materialCount} materials</p><details><summary>Inspection and limitations</summary><pre>${esc(JSON.stringify(inspection,null,2))}</pre>${previews.warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</details>${evidenceMarkup}<p>Source SHA-256 <code>${entry.sha256}</code></p><p>Review binding <code>${entry.reviewBinding}</code></p></section>`;cardBytes+=Buffer.byteLength(card);if(cardBytes>47_000_000)throw new Error('Review dashboard exceeds 48 MB; use fewer candidates or smaller review LODs');cards.push(card);
  }
  const createdAt = new Date().toISOString();
  const playbackControls=playbackTimes.length?`<p><label>Animation sample <input id="sample" type="range" min="0" max="${playbackTimes.length-1}" value="0" step="1"></label> <output id="sample-label">${playbackTimes[0]} seconds</output> <button id="sample-play" aria-pressed="false">Play samples</button></p><p>Animation controls show only precomputed appearance samples at recorded times. Geometry, wireframe and UV views show the first sample. Playback advances two samples per second; it does not run an engine or render new evidence.</p>`:'';
  const body = `<p>Side-by-side asset selection. CPU geometry and optional appearance previews support review; target-engine correctness and artistic approval require separate evidence. Settings and renderer are sealed with the previews.</p><label>View <select id="mode"><option value="turns">Turntable base color</option>${settings.mode==='appearance'?'<option value="appearance">Controlled lighting appearance</option>':''}<option value="wires">Wireframe</option><option value="uv">UV layout</option><option value="materials">Material swatches</option></select></label> <label>Angle <input id="angle" type="range" min="0" max="7" value="0"></label> <button id="play">Play / pause angles</button>${playbackControls}<details><summary>Sealed review settings</summary><pre>${esc(JSON.stringify({settings,renderer:REVIEW_RENDERER},null,2))}</pre></details><div class="grid">${cards.join('')}</div><section><h2>Record review</h2><p>Selection does not grant paid authority. Submit the generated arguments to <code>decide_asset_review</code>; then <code>package_reviewed_asset</code> verifies the same bytes and catalogs the standalone package.</p><label>Reviewer <input id="reviewer"></label> <label>Decision <select id="decision"><option>approve</option><option>reject</option></select></label><p><label>Reason <textarea id="reason"></textarea></label></p><button id="arguments">Prepare decision arguments</button><pre id="result" aria-live="polite"></pre></section>`;
  const script = `const mode=document.getElementById('mode'),angle=document.getElementById('angle'),sample=document.getElementById('sample'),samplePlay=document.getElementById('sample-play'),times=${JSON.stringify(playbackTimes)};
let timer,sampleTimer;function stopSamples(){clearInterval(sampleTimer);sampleTimer=null;if(samplePlay){samplePlay.textContent='Play samples';samplePlay.setAttribute('aria-pressed','false')}}
function update(){document.querySelectorAll('.candidate').forEach(c=>{['turns','appearance','wires','uv','materials'].forEach(m=>{const view=c.querySelector('.'+m);if(view)view.hidden=m!==mode.value});c.querySelectorAll('[data-frame]').forEach(f=>f.hidden=f.dataset.frame!==angle.value);if(sample)c.querySelectorAll('[data-sample-frame]').forEach(f=>f.hidden=f.dataset.sampleFrame!==sample.value)});if(sample){const active=mode.value==='appearance';sample.disabled=!active;samplePlay.disabled=!active;if(!active)stopSamples();const label='Sample '+(+sample.value+1)+' of '+times.length+' at '+times[+sample.value]+' seconds';document.getElementById('sample-label').textContent=label;sample.setAttribute('aria-valuetext',label)}}
mode.onchange=update;angle.oninput=update;document.getElementById('play').onclick=()=>{if(timer){clearInterval(timer);timer=null}else timer=setInterval(()=>{angle.value=(+angle.value+1)%8;update()},500)};
if(sample){mode.value='appearance';sample.oninput=()=>{stopSamples();update()};samplePlay.onclick=()=>{if(sampleTimer)stopSamples();else{samplePlay.textContent='Pause samples';samplePlay.setAttribute('aria-pressed','true');sampleTimer=setInterval(()=>{sample.value=(+sample.value+1)%times.length;update()},500)}}}
function stopAll(){clearInterval(timer);timer=null;stopSamples()}document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAll()});window.addEventListener('pagehide',stopAll);update();
document.getElementById('arguments').onclick=()=>{document.getElementById('result').textContent=JSON.stringify({sessionId:'${sessionId}',candidateId:document.querySelector('[name=chosen]:checked').value,decision:document.getElementById('decision').value,reviewer:document.getElementById('reviewer').value,reason:document.getElementById('reason').value},null,2)};`;
  const dashboardPath = path.join(directory,'index.html'); if(Buffer.byteLength(body)>48_000_000) throw new Error('Review dashboard exceeds 48 MB; use fewer candidates or smaller review LODs'); await fs.writeFile(dashboardPath,page('Asset candidate review',body,script),{flag:'wx',mode:0o600});
  const unsealed={schema:'game_dev.asset_review.v2' as const,id:sessionId,createdAt,candidates:entries,settings,renderer:REVIEW_RENDERER,dashboardPath,dashboardSha256:hash(await fs.readFile(dashboardPath))};
  const session=boundSessionSchema.parse({...unsealed,evidenceHash:hash(canonicalJson(unsealed))});
  await writeNew(recordPath(root,'reviews',sessionId),session);
  return session;
}

async function verifyAssetReview(session:z.infer<typeof sessionSchema>,basisDeps:BasisReviewDecodeDeps={}):Promise<z.infer<typeof boundSessionSchema>> {
  if(session.schema !== 'game_dev.asset_review.v2') throw new Error('Legacy byte-only asset review requires a fresh review with settings binding');
  if(canonicalJson(session.renderer)!==canonicalJson(REVIEW_RENDERER)) throw new Error('Review renderer changed; create a fresh review');
  const {evidenceHash,...unsealed}=session;
  if(hash(canonicalJson(unsealed))!==evidenceHash) throw new Error('Review settings or evidence changed; create a fresh review');
  await verifyBasisReviewBindings(session.settings.decodeBasisTextures===true,session.candidates,basisDeps);
  if(hash(await readBoundedReviewFile(session.dashboardPath,48_100_000,'Review dashboard'))!==session.dashboardSha256) throw new Error('Review dashboard changed; create a fresh review');
  for(const candidate of session.candidates) {
    if(hash(canonicalJson({sha256:candidate.sha256,previewSha256:candidate.previewSha256,settings:session.settings,renderer:session.renderer}))!==candidate.reviewBinding) throw new Error('Review preview binding changed; create a fresh review');
    if(candidate.previewRunPath){const verified=await verifyRunBundle(candidate.previewRunPath);if(verified.manifestSha256!==candidate.previewRunManifestSha256)throw new Error('Review capture changed; create a fresh review');}
  }
  return session;
}

export async function decideAssetReview(root:string, args: {sessionId:string;candidateId:string;decision:'approve'|'reject';reviewer:string;reason:string},basisDeps:BasisReviewDecodeDeps={}) {
  const session = await verifyAssetReview(await read(recordPath(root,'reviews',args.sessionId),sessionSchema),basisDeps);
  const candidate = session.candidates.find(c=>c.id===args.candidateId); if(!candidate) throw new Error('Candidate is not in review');
  if(hash(await readBoundedReviewFile(candidate.snapshotPath,64_000_000,'Review snapshot')) !== candidate.sha256) throw new Error('Review snapshot changed; create a new review');
  const decision = boundApprovalSchema.parse({schema:'game_dev.asset_review_decision.v2',id:randomUUID(),...args,sha256:candidate.sha256,reviewBinding:candidate.reviewBinding,evidenceHash:session.evidenceHash,createdAt:new Date().toISOString()});
  await writeNew(recordPath(root,'decisions',decision.id),decision); return decision;
}

export async function packageReviewedAsset(root:string, options:{decisionId:string;packagesRoot:string;catalogPath:string;name:string;license:string}) {
  const decision = await read(recordPath(root,'decisions',options.decisionId),approvalSchema);
  if(decision.schema !== 'game_dev.asset_review_decision.v2') throw new Error('Legacy byte-only approval requires a fresh asset review');
  if(decision.decision !== 'approve') throw new Error('Packaging requires an approved candidate');
  const history = await records(root,'decisions',approvalSchema);
  if(history.corrupt.length) throw new Error('Corrupt review decision records must be recovered before packaging');
  const newer = history.records.some(d=>d.sessionId===decision.sessionId && d.candidateId===decision.candidateId && d.createdAt >= decision.createdAt && d.id !== decision.id);
  if(newer) throw new Error('Decision superseded; use the latest review decision');
  const session = await verifyAssetReview(await read(recordPath(root,'reviews',decision.sessionId),sessionSchema));
  const candidate = session.candidates.find(c=>c.id===decision.candidateId); if(!candidate) throw new Error('Missing reviewed candidate');
  if(hash(await readBoundedReviewFile(candidate.snapshotPath,64_000_000,'Review snapshot'))!==decision.sha256 || decision.sha256!==candidate.sha256) throw new Error('Reviewed bytes changed');
  if(decision.reviewBinding!==candidate.reviewBinding || decision.evidenceHash!==session.evidenceHash) throw new Error('Approved review settings or evidence changed; create a fresh review');
  const built = await buildAssetPackage({packagesRoot:options.packagesRoot,sourcePath:candidate.snapshotPath,name:options.name,license:options.license,provenance:{notes:`Asset review ${decision.id}; reviewed SHA-256 ${decision.sha256}; review binding ${decision.reviewBinding}; renderer ${session.renderer.id}@${session.renderer.version}; reviewer attribution ${decision.reviewer}; reason ${decision.reason}`},maximumBytes:64_000_000});
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
      const candidateSeal=await verifyRunBundle(pair.candidateRunPath);
      const comparison=await compareRunVisuals({baselineRunPath:baseline.runPath,candidateRunPath:pair.candidateRunPath,outputPath,threshold:args.threshold});
      if((await verifyRunBundle(baseline.runPath)).manifestSha256!==baseline.manifestSha256 || (await verifyRunBundle(pair.candidateRunPath)).manifestSha256!==candidateSeal.manifestSha256) throw new Error('Sealed inputs changed during comparison');
      const imagePaths=[...new Set(comparison.pairs.flatMap(p=>[p.baselinePath,p.candidatePath,...(p.heatmapPath?[p.heatmapPath]:[])]))];
      const images=await Promise.all(imagePaths.map(async imagePath=>({path:imagePath,sha256:hash(await fs.readFile(imagePath))})));
      const entry=regressionSchema.parse({schema:'game_dev.regression_record.v1',id:comparisonId,baselineId:baseline.id,scenario:baseline.scenario,candidateRunPath:path.resolve(pair.candidateRunPath),candidateManifestSha256:candidateSeal.manifestSha256,images,comparisonHash:hash(await fs.readFile(path.join(outputPath,'comparison.json'))),createdAt:new Date().toISOString()});
      await writeNew(recordPath(root,'regressions',entry.id),entry);results.push({id:entry.id,baselineId:baseline.id});
    }catch(error){results.push({baselineId:pair.baselineId,error:error instanceof Error?error.message:String(error)});}
  }
  const matrix=matrixSchema.parse({schema:'game_dev.visual_matrix.v1',id:randomUUID(),createdAt:new Date().toISOString(),results});
  await writeNew(recordPath(root,'matrices',matrix.id),matrix);
  return {...matrix,dashboard:await writeRegressionDashboard(root)};
}
async function verifyRegressionEvidence(root:string,entry:z.infer<typeof regressionSchema>):Promise<void> {
  const baseline=await read(recordPath(root,'baselines',entry.baselineId),baselineSchema);
  if((await verifyRunBundle(baseline.runPath)).manifestSha256!==baseline.manifestSha256 || (await verifyRunBundle(entry.candidateRunPath)).manifestSha256!==entry.candidateManifestSha256) throw new Error('Sealed comparison inputs changed');
  for(const image of entry.images) {
    const stat=await fs.lstat(image.path);
    if(!stat.isFile() || stat.isSymbolicLink() || hash(await fs.readFile(image.path))!==image.sha256) throw new Error('Comparison image changed; review evidence is stale');
  }
}
export async function decideVisualRegression(root:string,args:{regressionId:string;decision:'expected-change'|'regression'|'needs-review';reviewer:string;reason:string}) {
  const entry=await read(recordPath(root,'regressions',args.regressionId),regressionSchema);
  if(hash(await fs.readFile(path.join(root,'comparisons',entry.id,'comparison.json')))!==entry.comparisonHash)throw new Error('Comparison changed; review cannot be recorded');
  await verifyRegressionEvidence(root,entry);
  const decision=regressionDecisionSchema.parse({schema:'game_dev.regression_decision.v1',id:randomUUID(),...args,comparisonHash:entry.comparisonHash,createdAt:new Date().toISOString()});
  await writeNew(recordPath(root,'regression-decisions',decision.id),decision);return decision;
}
export async function writeRegressionDashboard(root:string) {
  const baselines=await records(root,'baselines',baselineSchema), regressions=await records(root,'regressions',regressionSchema), decisions=await records(root,'regression-decisions',regressionDecisionSchema);
  const matrices=await records(root,'matrices',matrixSchema);
  const corrupt=[...matrices.corrupt,...baselines.corrupt,...regressions.corrupt,...decisions.corrupt]; const rows:string[]=[]; let previewBudget=9_000_000;
  for(const entry of regressions.records.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))) {
    const file=path.join(root,'comparisons',entry.id,'comparison.json');
    let comparison: {verdict:string;summary:string[];pairs:Array<{baselinePath:string;candidatePath:string;heatmapPath?:string;changedPixelRatio?:number;comparable?:boolean}>};
    try {const bytes=await fs.readFile(file);if(hash(bytes)!==entry.comparisonHash)throw new Error('tampered');comparison=JSON.parse(bytes.toString());}catch{corrupt.push(`comparison/${entry.id}`);continue;}
    const history=decisions.records.filter(d=>d.regressionId===entry.id&&d.comparisonHash===entry.comparisonHash).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
    const baseline=baselines.records.find(b=>b.id===entry.baselineId);
    const name=baseline?.name ?? entry.baselineId;
    let previewsVerified=false;
    try { await verifyRegressionEvidence(root,entry); previewsVerified=true; } catch { /* historical metrics remain, current image bytes are not trusted */ }
    const thumbnails: string[]=[];
    for(const [pairIndex,pair] of (previewsVerified?comparison.pairs:[]).slice(0,6).entries()) {
      const images:string[]=[];const dataUrls=new Map<string,string>();
      for(const [label,file] of [['Baseline',pair.baselinePath],['Candidate',pair.candidatePath],['Pixel heatmap',pair.heatmapPath]] as const) {
        if(!file)continue; try {const size=(await fs.stat(file)).size;if(size>Math.min(4_000_000,previewBudget))continue;previewBudget-=size;const bytes=await fs.readFile(file);if(hash(bytes)!==entry.images.find(image=>image.path===file)?.sha256){corrupt.push(`image/${entry.id}`);continue;}if(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){const url=`data:image/png;base64,${bytes.toString('base64')}`;dataUrls.set(label,url);images.push(`<figure><img alt="${label}" src="${url}"><figcaption>${label}</figcaption></figure>`);}}catch { /* missing preview is visible below */ }
      }
      const controls=pair.comparable && dataUrls.has('Baseline') && dataUrls.has('Candidate')?renderComparisonControls({id:`cmp-${entry.id}-${pairIndex}`,baselinePNG:dataUrls.get('Baseline')!,candidatePNG:dataUrls.get('Candidate')!,heatmapPNG:dataUrls.get('Pixel heatmap'),heatmapLabel:'Pixel heatmap'}):`<div class="grid">${images.join('')}</div>`;
      thumbnails.push(`${controls}<p>Changed pixel ratio: ${pair.changedPixelRatio ?? 'not comparable'}</p>`);
    }
    rows.push(`<section data-scenario="${esc(entry.scenario)}"><h2>${esc(entry.scenario)} · ${esc(name)}</h2><p>${esc(entry.createdAt)} · Pixel verdict: <strong>${esc(comparison.verdict)}</strong> · Human decision: <strong>${esc(history[0]?.decision ?? 'needs-review')}</strong></p><code>${entry.id}</code>${comparison.summary.map(s=>`<p>${esc(s)}</p>`).join('')}${previewsVerified?thumbnails.join(''):'<p>Sealed runs or comparison images are missing or changed; current previews withheld. Historical metrics remain recorded.</p>'}<details><summary>Decision history</summary>${history.map(d=>`<p>${esc(d.createdAt)} · ${esc(d.reviewer)} · ${esc(d.decision)}: ${esc(d.reason)}</p>`).join('')||'No decision recorded'}</details></section>`);
  }
  const scenarios=[...new Set(regressions.records.map(r=>r.scenario))];
  const body=`<p>Pixel difference is not artistic quality. Expected-change approval records human intent; it never changes numerical comparison results or silently promotes a baseline. Baselines are immutable versions; name a new version explicitly.</p><label>Scenario <select id="filter"><option value="">All scenarios</option>${scenarios.map(s=>`<option>${esc(s)}</option>`).join('')}</select></label><p>${baselines.records.length} named baseline versions · ${regressions.records.length} comparisons</p>${corrupt.length?`<p>Corrupt or changed records (not trusted): ${corrupt.map(esc).join(', ')}</p>`:''}<section><h2>Named baselines</h2><table><tr><th>Name</th><th>Scenario</th><th>Version ID</th></tr>${baselines.records.map(b=>`<tr><td>${esc(b.name)}</td><td>${esc(b.scenario)}</td><td>${esc(b.id)}</td></tr>`).join('')}</table></section><section><h2>Scenario matrix history</h2>${matrices.records.map(m=>`<p>${esc(m.createdAt)}</p><ul>${m.results.map(r=>`<li>${esc(r.baselineId)}: ${esc(r.error ?? r.id ?? 'no result')}</li>`).join('')}</ul>`).join('')}</section>${rows.join('')}<section><h2>Expected-change review</h2><p>Submit these arguments to <code>decide_visual_regression</code>, then refresh this dashboard.</p><label>Comparison <select id=regression>${regressions.records.map(r=>`<option value="${r.id}">${esc(r.scenario)} · ${r.id}</option>`).join('')}</select></label> <label>Decision <select id=decision><option>expected-change</option><option>regression</option><option>needs-review</option></select></label><p><label>Reviewer <input id=reviewer></label> <label>Reason <textarea id=reason></textarea></label></p><button id=arguments>Prepare decision arguments</button><pre id=result aria-live=polite></pre></section>`;
  const dashboardPath=path.join(root,'regression-dashboard.html');await fs.mkdir(root,{recursive:true});await fs.writeFile(dashboardPath,page('Visual regression dashboard',body,comparisonControlsScript+`document.getElementById('filter').onchange=e=>document.querySelectorAll('[data-scenario]').forEach(s=>s.hidden=!!e.target.value&&s.dataset.scenario!==e.target.value);document.getElementById('arguments').onclick=()=>{document.getElementById('result').textContent=JSON.stringify({regressionId:document.getElementById('regression').value,decision:document.getElementById('decision').value,reviewer:document.getElementById('reviewer').value,reason:document.getElementById('reason').value},null,2)}`),{mode:0o600});
  return {dashboardPath,baselineCount:baselines.records.length,comparisonCount:regressions.records.length,corrupt};
}
