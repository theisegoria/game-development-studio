import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { writeGameReadyGlb } from './helpers/model-fixture.js';
import { previewGlb } from '../src/review/previews.js';
import { createAssetReview, decideAssetReview, packageReviewedAsset, nameVisualBaseline, compareVisualMatrix, decideVisualRegression, writeRegressionDashboard } from '../src/review/workspace.js';
import { writeHarnessProject } from './helpers/harness-fixture.js';
import { loadAdapter, planScenarioRun } from '../src/harness/adapter.js';
import { executeScenarioRun } from '../src/harness/run-bundle.js';
const roots:string[]=[];
async function temp() {const root=await fs.mkdtemp(path.join(os.tmpdir(),'asset-review-'));roots.push(root);return root;}
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});

test('CPU review provides synchronized geometric and material views and packages approved snapshot',async()=>{
  const root=await temp();const source=await writeGameReadyGlb(path.join(root,'fixture.glb'));
  const preview=await previewGlb(await fs.readFile(source));
  expect(preview.turns).toHaveLength(8);expect(new Set(preview.turns).size).toBeGreaterThan(1);expect(preview.wireframes[0]).toContain('fill="none"');expect(preview.uv).toContain('polygon');expect(preview.materials[0]?.name).toBe('brass');
  const session=await createAssetReview(root,[{name:'<script>alert(1)</script>',modelPath:source},{name:'Candidate B',modelPath:source}]);
  const html=await fs.readFile(session.dashboardPath,'utf8');expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>alert(1)');expect(html).toContain('Prepare decision arguments');
  const decision=await decideAssetReview(root,{sessionId:session.id,candidateId:session.candidates[0]!.id,decision:'approve',reviewer:'Test artist',reason:'Shape approved'});
  await fs.writeFile(source,'changed original does not alter snapshot');
  const built=await packageReviewedAsset(root,{decisionId:decision.id,packagesRoot:path.join(root,'packages'),catalogPath:path.join(root,'catalog.sqlite'),name:'Reviewed asset',license:'CC0-1.0'});
  expect(built.catalog.modelSha256).toBe(decision.sha256);expect(built.review.reason).toBe('Shape approved');
  await fs.writeFile(session.candidates[0]!.snapshotPath,'tampered');
  await expect(packageReviewedAsset(root,{decisionId:decision.id,packagesRoot:path.join(root,'packages'),catalogPath:path.join(root,'catalog.sqlite'),name:'No',license:'CC0-1.0'})).rejects.toThrow('Reviewed bytes changed');
});

test('rejection cannot package; corrupt decision history fails closed',async()=>{
  const root=await temp(),source=await writeGameReadyGlb(path.join(root,'f.glb'));
  const session=await createAssetReview(root,[{name:'Asset',modelPath:source}]);
  const args={sessionId:session.id,candidateId:session.candidates[0]!.id,reviewer:'Artist',reason:'Not ready'};
  const rejected=await decideAssetReview(root,{...args,decision:'reject'});
  const options={packagesRoot:path.join(root,'packages'),catalogPath:path.join(root,'catalog.sqlite'),name:'Asset',license:'CC0-1.0'};
  await expect(packageReviewedAsset(root,{...options,decisionId:rejected.id})).rejects.toThrow('approved');
  const approved=await decideAssetReview(root,{...args,decision:'approve'});
  await fs.writeFile(path.join(root,'decisions','broken.json'),'{');
  await expect(packageReviewedAsset(root,{...options,decisionId:approved.id})).rejects.toThrow('Corrupt');
});

test('sealed scenario history separates numerical change from human expected-change and catches tampering',async()=>{
  const root=await temp();const fixture=await writeHarnessProject(root);const adapter=await loadAdapter(fixture.projectRoot);
  async function run(source:string) {
    const plan=await planScenarioRun({adapter,scenarioId:'capture',runsRoot:path.join(root,'runs'),parameters:{source,objectIds:'objects.png',frameTime:20,mode:'normal'}});
    return (await executeScenarioRun({adapter,plan,confirm:true,allowGpu:false,allowPerformance:false})).runPath;
  }
  const runPath=await run('baseline.png');const candidateRunPath=await run('baseline.png');
  const baseline=await nameVisualBaseline(root,{name:'Approved neutral',scenario:'Lighting A',runPath});
  const matrix=await compareVisualMatrix(root,{entries:[{baselineId:baseline.id,candidateRunPath},{baselineId:baseline.id,candidateRunPath:path.join(root,'missing')}]});
  expect(matrix.results[0]?.id).toBeTruthy();expect(matrix.results[1]?.error).toBeTruthy();
  const regressionId=matrix.results[0]!.id!;
  const file=path.join(root,'comparisons',regressionId,'comparison.json');const before=await fs.readFile(file,'utf8');
  await decideVisualRegression(root,{regressionId,decision:'expected-change',reviewer:'Artist',reason:'Intentional palette adjustment'});
  const dashboard=await writeRegressionDashboard(root);const html=await fs.readFile(dashboard.dashboardPath,'utf8');
  expect(html).toContain('Scenario matrix history');expect(html).toContain('missing');expect(html).toContain('expected-change');expect(html).toContain('Intentional palette adjustment');expect(html).toContain('not artistic quality');expect(await fs.readFile(file,'utf8')).toBe(before);
  const persisted=JSON.parse(before) as {pairs:Array<{candidatePath:string;heatmapPath:string}>};
  const decisionArgs={regressionId,decision:'expected-change' as const,reviewer:'Artist',reason:'Re-review'};
  const heatmapPath=persisted.pairs[0]!.heatmapPath;
  const originalHeatmap=await fs.readFile(heatmapPath);
  await fs.writeFile(heatmapPath,await fs.readFile(persisted.pairs[0]!.candidatePath));
  await expect(decideVisualRegression(root,decisionArgs)).rejects.toThrow('Comparison image changed');
  const changedHeatmapHtml=await fs.readFile((await writeRegressionDashboard(root)).dashboardPath,'utf8');
  expect(changedHeatmapHtml).toContain('current previews withheld');expect(changedHeatmapHtml).not.toContain('alt="Pixel heatmap"');
  await fs.writeFile(heatmapPath,originalHeatmap);
  await fs.rename(runPath,`${runPath}.missing`);
  await expect(decideVisualRegression(root,decisionArgs)).rejects.toThrow();
  await fs.rename(`${runPath}.missing`,runPath);
  await decideVisualRegression(root,decisionArgs);
  await fs.writeFile(persisted.pairs[0]!.candidatePath,'changed sealed bytes');
  await expect(decideVisualRegression(root,decisionArgs)).rejects.toThrow();
  expect(await fs.readFile((await writeRegressionDashboard(root)).dashboardPath,'utf8')).toContain('current previews withheld');
  const stale=await compareVisualMatrix(root,{entries:[{baselineId:baseline.id,candidateRunPath}]});expect(stale.results[0]?.error).toBeTruthy();
  await fs.writeFile(file,'{}');await expect(decideVisualRegression(root,{regressionId,decision:'regression',reviewer:'Artist',reason:'Bad'})).rejects.toThrow('Comparison changed');
  expect((await writeRegressionDashboard(root)).corrupt).toContain(`comparison/${regressionId}`);
});

 test('CPU preview rejects external resources before resolving them',async()=>{
  const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},images:[{uri:'https://example.com/private.png'}]}).padEnd(128,' '));
  const glb=Buffer.alloc(20+json.length);glb.writeUInt32LE(0x46546c67,0);glb.writeUInt32LE(2,4);glb.writeUInt32LE(glb.length,8);glb.writeUInt32LE(json.length,12);glb.writeUInt32LE(0x4e4f534a,16);json.copy(glb,20);
  await expect(previewGlb(glb)).rejects.toThrow(/external (resources|images)/);
});

function mutateGlbJson(bytes:Buffer, mutate:(json:Record<string,unknown>)=>void):Buffer {
  const length=bytes.readUInt32LE(12);
  const json=JSON.parse(bytes.subarray(20,20+length).toString()) as Record<string,unknown>;
  mutate(json);const text=JSON.stringify(json);const chunk=Buffer.from(text.padEnd(Math.ceil(Buffer.byteLength(text)/4)*4,' '));
  const header=Buffer.from(bytes.subarray(0,20));header.writeUInt32LE(chunk.length,12);header.writeUInt32LE(20+chunk.length+bytes.length-20-length,8);
  return Buffer.concat([header,chunk,bytes.subarray(20+length)]);
}
test('material scalars reject markup, strings and non-finite/out-of-range values before HTML generation',async()=>{
  const root=await temp();const source=await writeGameReadyGlb(path.join(root,'material.glb'));const bytes=await fs.readFile(source);
  for(const [field,value] of [['metallicFactor','<script>document.body.dataset.injection="yes"</script>'],['roughnessFactor','0.5'],['metallicFactor',null],['roughnessFactor',2],['baseColorFactor',[1,1,'<img src=x onerror=alert(1)>',1]]] as const) {
    const attack=mutateGlbJson(bytes,json=>{const material=(json.materials as Array<{pbrMetallicRoughness:Record<string,unknown>}>)[0]!;material.pbrMetallicRoughness[field]=value;});
    await fs.writeFile(source,attack);
    await expect(createAssetReview(root,[{name:'Adversarial material',modelPath:source}])).rejects.toThrow(/material/);
  }
  const named=mutateGlbJson(bytes,json=>{(json.materials as Array<{name:string}>)[0]!.name='<script>document.body.dataset.injection="yes"</script>';});
  await fs.writeFile(source,named);const session=await createAssetReview(root,[{name:'Escaped name',modelPath:source}]);
  const html=await fs.readFile(session.dashboardPath,'utf8');expect(html).not.toContain('<script>document.body.dataset.injection');expect(html).toContain('&lt;script&gt;');expect(html).toContain("script-src 'sha256-");expect(html).not.toContain("script-src 'unsafe-inline'");
});
