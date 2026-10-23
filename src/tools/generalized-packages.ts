import { z } from 'zod';
import type { ToolRegistrar } from '../commands/registry.js';
import { AssetCatalog } from '../packages/catalog.js';
import { buildGeneralizedPackage, generalizedPackageRequestSchema, planGeneralizedPackage } from '../packages/format-v2.js';
import { invalidState } from '../util/errors.js';
import { guard, ok, type ToolContext } from './context.js';

const fingerprint = z.string().regex(/^[a-f0-9]{64}$/);
const annotations = (readOnly: boolean) => ({ readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: false });

export function registerGeneralizedPackageTools(registry: ToolRegistrar, ctx: ToolContext): void {
  registry.registerTool('plan_generalized_package', {
    title: 'Plan a multi-kind asset package',
    description: 'FREE read-only v2 package plan: explicit primary, typed artifacts, source hashes, destination, validation limits and catalog compatibility. Material/audio/flipbook declarations do not establish format or quality validation. No files, provider or process.',
    inputPolicy: 'strict', inputSchema: { request: generalizedPackageRequestSchema }, annotations: annotations(true),
  }, guard(ctx.logger, 'plan_generalized_package', async args => {
    const [plan, migration] = await Promise.all([
      planGeneralizedPackage(args.request, ctx.config.packagesDir), AssetCatalog.planMigration(ctx.config.catalogPath),
    ]);
    return ok({ ...plan, catalog: { needsMigration: migration.needsMigration, currentVersion: migration.currentVersion,
      targetVersion: migration.targetVersion, migrationFingerprint: migration.fingerprint } });
  }));
  registry.registerTool('build_generalized_package', {
    title: 'Build and index a reviewed multi-kind package',
    description: 'Requires fresh confirmation and the current exact plan fingerprint. Retains sources, LODs, collision, recipes and previews in an immutable verified v2 package, then indexes it. Refuses an incompatible catalog before publication. No project admission or shipping rights granted.',
    inputPolicy: 'strict', inputSchema: { request: generalizedPackageRequestSchema, approvedFingerprint: fingerprint }, annotations: annotations(false),
  }, guard(ctx.logger, 'build_generalized_package', async args => {
    const plan = await planGeneralizedPackage(args.request, ctx.config.packagesDir);
    if (plan.fingerprint !== args.approvedFingerprint) throw invalidState('Package inputs or destination differ from the reviewed plan');
    const catalog = await AssetCatalog.open(ctx.config.catalogPath);
    try {
      catalog.assertSupportsPackageSchema('game_dev.asset_package.v2');
      const built = await buildGeneralizedPackage(args.request, ctx.config.packagesDir, args.approvedFingerprint);
      let asset;
      try { asset = await catalog.admit(built.packagePath); }
      catch {
        throw invalidState('Package was published but catalog indexing failed; preserve its receipt and retry after inspecting the catalog', {
          packageId: built.manifest.packageId, packagePath: built.packagePath, receiptPath: built.receiptPath,
        });
      }
      return ok({ schema: 'game_dev.package_build_result.v2', packageId: built.manifest.packageId, kind: built.manifest.kind,
        primary: built.manifest.primary, packagePath: asset.packagePath, manifestPath: built.manifestPath,
        receiptPath: built.receiptPath, manifestSha256: built.manifestSha256, reused: built.reused,
        uri: `game-dev://packages/${built.manifest.packageId}`, validation: built.manifest.validation, catalog: asset,
        limitations: plan.limitations });
    } finally { catalog.close(); }
  }));
  registry.registerTool('plan_catalog_migration', {
    title: 'Inspect a catalog migration', description: 'FREE read-only catalog version, source snapshot, active ownership and exact migration fingerprint. Does not rewrite the index or sealed packages.',
    inputPolicy: 'strict', inputSchema: {}, annotations: annotations(true),
  }, guard(ctx.logger, 'plan_catalog_migration', async () => ok({ ...await AssetCatalog.planMigration(ctx.config.catalogPath) })));
  registry.registerTool('migrate_asset_catalog', {
    title: 'Migrate a reviewed catalog snapshot', description: 'Requires fresh confirmation and the reviewed migration fingerprint. Preserves a verified backup before replacing the mutable index. Refuses active/unknown owners, drift and unknown database versions. Sealed packages are unchanged.',
    inputPolicy: 'strict', inputSchema: { expectedFingerprint: fingerprint }, annotations: annotations(false),
  }, guard(ctx.logger, 'migrate_asset_catalog', async args => ok({ ...await AssetCatalog.migrate(ctx.config.catalogPath, { ...args, confirm: true }) })));
  registry.registerTool('plan_catalog_rollback', {
    title: 'Inspect a catalog rollback', description: 'FREE read-only rollback plan for a backup created by this catalog migration. Verifies backup provenance and current index identity; arbitrary database replacements are refused.',
    inputPolicy: 'strict', inputSchema: { backupPath: z.string().min(1).max(4096) }, annotations: annotations(true),
  }, guard(ctx.logger, 'plan_catalog_rollback', async args => ok({ ...await AssetCatalog.planRollback(ctx.config.catalogPath, args.backupPath) })));
  registry.registerTool('recover_catalog_leases', {
    title: 'Recover stopped catalog ownership', description: 'Requires fresh confirmation and the current catalog migration fingerprint. Recovers only leases whose process is provably stopped on this host, preserving recovery evidence. Live or unknown owners are refused; elapsed time grants no authority.',
    inputPolicy: 'strict', inputSchema: { expectedFingerprint: fingerprint }, annotations: annotations(false),
  }, guard(ctx.logger, 'recover_catalog_leases', async args => {
    const plan = await AssetCatalog.planMigration(ctx.config.catalogPath);
    if (plan.fingerprint !== args.expectedFingerprint) throw invalidState('Catalog ownership changed after the reviewed recovery plan');
    return ok({ ...await AssetCatalog.recoverLeases(ctx.config.catalogPath, { confirm: true, expectedFingerprint: args.expectedFingerprint }) });
  }));
  registry.registerTool('rollback_asset_catalog', {
    title: 'Restore a reviewed catalog backup', description: 'Requires fresh confirmation and the exact rollback fingerprint. Restores only this catalog migration\'s verified backup, preserving the displaced index. Refuses drift and active/unknown owners.',
    inputPolicy: 'strict', inputSchema: { backupPath: z.string().min(1).max(4096), expectedFingerprint: fingerprint }, annotations: annotations(false),
  }, guard(ctx.logger, 'rollback_asset_catalog', async args => ok({ ...await AssetCatalog.rollback(ctx.config.catalogPath, args.backupPath, { expectedFingerprint: args.expectedFingerprint, confirm: true }) })));
}
