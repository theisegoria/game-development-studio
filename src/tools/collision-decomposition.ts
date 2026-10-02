import path from 'node:path';
import type { ToolRegistrar } from '../commands/registry.js';
import { decompositionSchema,decomposeCollisionMesh } from '../collision/decomposition.js';
import { diagnoseCoacd } from '../collision/process.js';
import { guard,ok,type ToolContext } from './context.js';

export function registerCollisionDecompositionTools(server:ToolRegistrar,ctx:ToolContext):void {
  server.registerTool('diagnose_collision_decomposition',{title:'Diagnose isolated CPU convex decomposition',description:'Read the explicitly configured CoACD Python environment and report exact supported versions. Starts a bounded metadata-only Python child; no native decomposition, Blender, GPU, provider or installation.',inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false}},guard(ctx.logger,'diagnose_collision_decomposition',async()=>ok(await diagnoseCoacd())));
  server.registerTool('decompose_collision_mesh',{title:'Decompose static collision into separate convex parts',description:'Run explicitly configured isolated CPU CoACD with fixed seed, bounded memory/CPU time and independent geometry validation. Writes separate convex OBJ and GLB files, a manifest and receipt in the workspace. Requires GAME_DEV_COACD_PYTHON; preserves input. No engine verification, Blender/GPU, provider or automatic setup.',inputSchema:decompositionSchema.shape,annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}},guard(ctx.logger,'decompose_collision_mesh',async args=>ok(await decomposeCollisionMesh(args,path.join(ctx.config.outputDir,'.production','collision')))));
}
