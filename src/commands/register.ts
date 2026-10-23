import type { ToolContext } from '../tools/context.js';
import { registerWorkflowTools } from '../tools/workflows.js';
import { registerReferenceTools } from '../tools/references.js';
import { registerAsset3DTools } from '../tools/assets3d.js';
import { registerTextureTools } from '../tools/textures.js';
import { registerJobTools } from '../tools/jobs.js';
import { registerDownloadTools } from '../tools/downloads.js';
import { registerInspectionTools } from '../tools/inspection.js';
import { registerPbrTools } from '../tools/pbr.js';
import { registerAudioTools } from '../tools/audio.js';
import { registerNormalizeTools } from '../tools/normalize.js';
import { registerSpendTools } from '../tools/spend.js';
import { registerValidateTools } from '../tools/validate.js';
import { registerAnimationTools } from '../tools/animation.js';
import { registerBatchTools } from '../tools/batch.js';
import { registerHarnessTools } from '../tools/harness.js';
import { registerContactSheetTools } from '../tools/contact-sheet.js';
import { registerProjectWriteTools } from '../tools/project-writes.js';
import { registerOptimizationTools } from '../tools/optimization.js';
import { registerLibraryTools } from '../tools/library.js';
import { LocalCommandRegistry, type ToolRegistrar } from './registry.js';
import type { OperationCatalog } from './discovery.js';
import { registerDiscoveryTools } from '../tools/discovery.js';
import { registerProvenanceTools } from '../tools/provenance.js';
import { registerGeneralizedPackageTools } from '../tools/generalized-packages.js';
import { registerProceduralCrateTools } from '../tools/procedural-crate.js';
import { registerReviewTools } from '../tools/review.js';
import { registerWorkspaceTools } from '../tools/workspace.js';
import { registerProductionTools } from '../tools/production.js';
import { registerCollisionDecompositionTools } from '../tools/collision-decomposition.js';
import { registerInstallationTools } from '../tools/installation.js';

export function registerAssetCommands(registry: ToolRegistrar, ctx: ToolContext): void {
  // Existing third-party registrars need only registerTool. Mirror metadata
  // lazily for those consumers; native CLI/MCP registries use their own views.
  const inspected = registry as ToolRegistrar & Partial<OperationCatalog>;
  const shadow = typeof inspected.capabilities === 'function' && typeof inspected.definition === 'function' && typeof inspected.inputJsonSchema === 'function'
    ? undefined : new LocalCommandRegistry();
  const catalog = shadow ?? inspected as OperationCatalog;
  const forward: ToolRegistrar = {
    registerTool(name, definition, handler) {
      registry.registerTool(name, definition, handler);
      shadow?.registerTool(name, definition, handler);
    },
  };
  const family = (name: string): ToolRegistrar => ({
    registerTool(operation, definition, handler) {
      forward.registerTool(operation, { ...definition, family: definition.family ?? name }, handler);
    },
  });
  registerWorkflowTools(family('production'), ctx);
  registerReferenceTools(family('references'), ctx);
  registerAsset3DTools(family('models'), ctx);
  registerTextureTools(family('textures'), ctx);
  registerJobTools(family('jobs'), ctx);
  registerDownloadTools(family('downloads'), ctx);
  registerInspectionTools(family('inspection'), ctx);
  registerPbrTools(family('materials'), ctx);
  registerAudioTools(family('audio'), ctx);
  registerNormalizeTools(family('geometry'), ctx);
  registerSpendTools(family('spend'), ctx);
  registerValidateTools(family('validation'), ctx);
  registerAnimationTools(family('animation'), ctx);
  registerBatchTools(family('production'), ctx);
  registerHarnessTools(family('captures'), ctx);
  registerContactSheetTools(family('review'), ctx);
  registerProjectWriteTools(family('project'), ctx);
  registerOptimizationTools(family('optimization'), ctx);
  registerLibraryTools(family('library'), ctx);
  registerGeneralizedPackageTools(family('library'), ctx);
  registerProceduralCrateTools(family('geometry'), ctx);
  registerReviewTools(family('review'), ctx);
  registerWorkspaceTools(family('workspace'), ctx);
  registerProductionTools(family('production'), ctx);
  registerCollisionDecompositionTools(family('geometry'), ctx);
  registerInstallationTools(family('installation'), ctx);
  registerProvenanceTools(family('provenance'), ctx);
  registerDiscoveryTools(forward, ctx, catalog);
}
