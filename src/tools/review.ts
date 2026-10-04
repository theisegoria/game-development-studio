import path from 'node:path';
import { z } from 'zod';
import type { ToolRegistrar } from '../commands/registry.js';
import { guard, ok, type ToolContext } from './context.js';
import { createAssetReview, decideAssetReview, packageReviewedAsset, nameVisualBaseline, compareVisualMatrix, decideVisualRegression, writeRegressionDashboard } from '../review/workspace.js';
import { AssetCatalog } from '../packages/catalog.js';
import { reviewSettingsSchema } from '../review/settings.js';

/** Local CPU-only library review and sealed-comparison history; no provider authority. */
export function registerReviewTools(server:ToolRegistrar,ctx:ToolContext):void {
  const root=path.join(path.dirname(ctx.config.packagesDir),'review');
  const annotations={readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false};
  server.registerTool('create_asset_review',{title:'Inspect and compare asset candidates',description:'FREE bounded CPU-only portable HTML review. Optional appearance settings enable texture-mapped metallic/roughness lighting, normal maps and alpha. Includes UV estimates, clip inventory and reproducible LINEAR/STEP animation samples with morph/skin evaluation. Settings, renderer and previews bind to exact GLB bytes; unsupported extensions fail explicitly. No GPU/Blender launch or engine quality certification.',inputSchema:{candidates:z.array(z.object({name:z.string().min(1).max(200),modelPath:z.string().min(1)})).min(1).max(6),settings:reviewSettingsSchema.optional()},annotations},guard(ctx.logger,'create_asset_review',async args=>{
    const candidates=[];
    for(const candidate of args.candidates) {
      if(candidate.modelPath.startsWith('pkg_')) { const catalog=await AssetCatalog.open(ctx.config.catalogPath); try {candidates.push({...candidate,modelPath:catalog.get(candidate.modelPath).modelPath});} finally {catalog.close();} }
      else candidates.push(candidate);
    }
    return ok(await createAssetReview(root,candidates,args.settings));
  }));
  server.registerTool('decide_asset_review',{title:'Record explicit human asset review',description:'Record a transport-authorized approve/reject decision bound to exact reviewed GLB bytes, settings, renderer version and unchanged preview/dashboard evidence. Legacy byte-only reviews require a fresh review. Reviewer/reason are attribution, not identity proof; model inspection alone is not human review. Does not spend or package.',inputSchema:{sessionId:z.string().uuid(),candidateId:z.string().uuid(),decision:z.enum(['approve','reject']),reviewer:z.string().min(1).max(200),reason:z.string().min(1).max(4000)},annotations},guard(ctx.logger,'decide_asset_review',async args=>ok(await decideAssetReview(root,args))));
  server.registerTool('package_reviewed_asset',{title:'Package an approved candidate into the library',description:'FREE local standalone packaging and catalog admission. Requires a current approved review decision and unchanged snapshot bytes; no game project integration.',inputSchema:{decisionId:z.string().uuid(),name:z.string().min(1),license:z.string().min(1)},annotations},guard(ctx.logger,'package_reviewed_asset',async args=>ok(await packageReviewedAsset(root,{...args,packagesRoot:ctx.config.packagesDir,catalogPath:ctx.config.catalogPath}))));
  server.registerTool('name_visual_baseline',{title:'Name a verified baseline version',description:'Verify a sealed capture and persist a named immutable baseline version for a scenario. Does not replace or promote prior versions.',inputSchema:{name:z.string().min(1).max(200),scenario:z.string().min(1).max(200),runPath:z.string().min(1)},annotations},guard(ctx.logger,'name_visual_baseline',async args=>ok(await nameVisualBaseline(root,args))));
  server.registerTool('compare_visual_matrix',{title:'Compare a scenario matrix and build dashboard',description:'Verify sealed runs and compare each named baseline/candidate pair. Persist numerical results and a portable dashboard with history. Failed scenarios remain visible; pixel difference is not artistic quality.',inputSchema:{entries:z.array(z.object({baselineId:z.string().uuid(),candidateRunPath:z.string().min(1)})).min(1).max(32),threshold:z.number().int().min(0).max(255).optional()},annotations},guard(ctx.logger,'compare_visual_matrix',async args=>ok(await compareVisualMatrix(root,args))));
  server.registerTool('decide_visual_regression',{title:'Record expected-change review',description:'Append a transport-authorized expected-change/regression/needs-review decision with reviewer attribution (not identity proof) tied to the unchanged comparison digest. Never modifies numerical verdicts or baselines.',inputSchema:{regressionId:z.string().uuid(),decision:z.enum(['expected-change','regression','needs-review']),reviewer:z.string().min(1).max(200),reason:z.string().min(1).max(4000)},annotations},guard(ctx.logger,'decide_visual_regression',async args=>ok(await decideVisualRegression(root,args))));
  server.registerTool('visual_regression_dashboard',{title:'Refresh visual regression dashboard',description:'FREE local HTML dashboard of named baseline versions, scenario filtering, comparisons and explicit review history. Reports corrupt records rather than trusting them.',inputSchema:{},annotations:{...annotations,idempotentHint:true}},guard(ctx.logger,'visual_regression_dashboard',async()=>ok(await writeRegressionDashboard(root))));
}
