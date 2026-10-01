/**
 * The asset library -- packaging, the catalog, and project admission -- on the
 * registry.
 *
 * A model could generate an asset, inspect it, normalize it and see it, then
 * hit a wall: packaging, finding what it had already made, and shipping it
 * into a game were all CLI-only. That is the back half of the pipeline, and
 * without it the front half produces files nobody can use.
 *
 * The authority split follows where the bytes land. Packaging and cataloguing
 * write inside the tool's own workspace, content-addressed and idempotent, so
 * they are free and need no gate -- the same reasoning that keeps
 * `package build` off --confirm on the CLI. Vendoring writes into the user's
 * project, so it takes the project-write authority and has a free plan twin.
 */

import path from 'node:path';
import { z } from 'zod';
import type { ToolRegistrar } from '../commands/registry.js';
import { ASSET_CATEGORIES } from '../domain/asset-spec.js';
import { AssetCatalog } from '../packages/catalog.js';
import { buildAssetPackage, planAssetPackage, readAssetPackage } from '../packages/format.js';
import { admitVendorPackage } from '../packages/vendor.js';
import { guard, ok, type ToolContext } from './context.js';
import { assertProjectWriteAuthority } from './project-writes.js';

async function withCatalog<T>(ctx: ToolContext, body: (catalog: AssetCatalog) => Promise<T> | T): Promise<T> {
  const catalog = await AssetCatalog.open(ctx.config.catalogPath);
  try {
    return await body(catalog);
  } finally {
    catalog.close();
  }
}

/** A `pkg_` id resolves through the catalog; anything else is a path. */
async function resolvePackage(ctx: ToolContext, reference: string): Promise<string> {
  if (reference.startsWith('pkg_')) {
    return withCatalog(ctx, (catalog) => catalog.get(reference).packagePath);
  }
  return path.resolve(reference);
}

const packageReference = z.string().min(1)
  .describe('A pkg_ id from the catalog, or a path to a package directory.');

const buildShape = {
  modelPath: z.string().min(1).describe('Path to the .glb to package.'),
  name: z.string().min(1).describe('Human-readable asset name; the asset id is derived from it.'),
  description: z.string().min(1).optional(),
  version: z.string().min(1).optional().describe('SemVer-like. Defaults to 1.0.0.'),
  license: z.string().min(1).optional().describe('SPDX identifier. Defaults to unknown, which blocks vendoring.'),
  category: z.enum(ASSET_CATEGORIES).optional(),
  previewPath: z.string().min(1).optional().describe('Optional .usdz preview for QuickLook.'),
};

export function registerLibraryTools(server: ToolRegistrar, ctx: ToolContext): void {
  const buildOptions = (args: z.infer<z.ZodObject<typeof buildShape>>) => ({
    packagesRoot: ctx.config.packagesDir,
    sourcePath: path.resolve(args.modelPath),
    name: args.name,
    ...(args.description !== undefined ? { description: args.description } : {}),
    ...(args.version !== undefined ? { version: args.version } : {}),
    ...(args.license !== undefined ? { license: args.license } : {}),
    ...(args.category !== undefined ? { category: args.category } : {}),
    ...(args.previewPath !== undefined ? { previewPath: path.resolve(args.previewPath) } : {}),
    maximumBytes: ctx.config.maxDownloadBytes,
  });

  server.registerTool(
    'plan_asset_package',
    {
      title: 'Plan packaging a model without writing anything',
      description:
        'FREE, local, writes nothing. Reports the validation verdict, the resolved asset id and ' +
        'version, and where the package would land. It cannot report the packageId: that hashes ' +
        'the staged file set, so producing it means doing the write this plan exists to avoid.',
      inputSchema: buildShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(ctx.logger, 'plan_asset_package', async (args) => ok(await planAssetPackage(buildOptions(args)))),
  );

  server.registerTool(
    'build_asset_package',
    {
      title: 'Build a canonical asset package and index it',
      description:
        'FREE, local, no provider call. Copies the model into a content-addressed package with a ' +
        'manifest, receipt, provenance and validation report, hashes every file, and admits it to ' +
        'the catalog. Writes only inside the tool workspace and is idempotent: an identical build ' +
        'reuses the existing package rather than duplicating it. This is what turns a downloaded ' +
        'file into something vendorable.',
      inputSchema: buildShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(ctx.logger, 'build_asset_package', async (args) => {
      const built = await buildAssetPackage(buildOptions(args));
      const catalogAsset = await withCatalog(ctx, (catalog) => catalog.admit(built.packagePath));
      return ok({
        schema: 'game_dev.package_build_result.v1',
        packageId: built.manifest.packageId,
        // The catalog's resolved path, not the builder's. The builder returns
        // the path as composed and the catalog stores it realpath'd, so on a
        // machine where the workspace sits behind a symlink -- /var on macOS --
        // the two differ as strings for one directory, and a caller comparing
        // them would read that as two packages.
        packagePath: catalogAsset.packagePath,
        manifestPath: built.manifestPath,
        receiptPath: built.receiptPath,
        manifestSha256: built.manifestSha256,
        reused: built.reused,
        validation: built.manifest.validation,
        catalog: catalogAsset,
        evidence: {
          portableGlbCopiedAndHashed: true,
          staticInspectionCompleted: true,
          policyValidationCompleted: true,
          blenderNormalizationPerformed: false,
          gpuImportTestPerformed: false,
          humanVisualReviewPerformed: false,
        },
      });
    }),
  );

  server.registerTool(
    'verify_asset_package',
    {
      title: 'Re-verify a built package against its manifest',
      description:
        'FREE, local. Re-reads a package and checks every file against the hashes its manifest ' +
        'records. Use it before vendoring something built earlier or elsewhere.',
      inputSchema: { package: packageReference },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(ctx.logger, 'verify_asset_package', async (args) => {
      const packagePath = await resolvePackage(ctx, args.package);
      return ok({
        schema: 'game_dev.package_verification.v1',
        packagePath,
        manifest: await readAssetPackage(packagePath),
        hashesVerified: true,
        evidence: {
          packageBytesVerified: true,
          gpuImportTestPerformed: false,
          humanVisualReviewPerformed: false,
        },
      });
    }),
  );

  server.registerTool(
    'list_catalog_assets',
    {
      title: 'Search the local asset catalog',
      description:
        'FREE, local. Finds packages already built on this machine, by text, category or ' +
        'validation state. Ask this before generating something: the asset may already exist, and ' +
        'regenerating it costs credits.',
      inputSchema: {
        query: z.string().min(1).optional().describe('Matches name, description, license and provider.'),
        category: z.enum(ASSET_CATEGORIES).optional(),
        validationPassed: z.boolean().optional()
          .describe('Restrict to packages that passed, or failed, their shipping policy.'),
        limit: z.number().int().min(1).max(1000).default(100),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(ctx.logger, 'list_catalog_assets', async (args) => {
      const assets = await withCatalog(ctx, (catalog) => catalog.list({
        ...(args.query !== undefined ? { query: args.query } : {}),
        ...(args.category !== undefined ? { category: args.category } : {}),
        ...(args.validationPassed !== undefined ? { validationPassed: args.validationPassed } : {}),
        limit: args.limit,
      }));
      return ok({ schema: 'game_dev.catalog_list.v1', total: assets.length, assets });
    }),
  );

  server.registerTool(
    'show_catalog_asset',
    {
      title: 'Read one catalog entry',
      description: 'FREE, local. The full catalog row for a package id, including where it lives on disk.',
      inputSchema: { packageId: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(ctx.logger, 'show_catalog_asset', async (args) =>
      ok(await withCatalog(ctx, (catalog) => catalog.get(args.packageId)))),
  );

  const vendorShape = {
    package: packageReference,
    project: z.string().min(1).describe('Path to the game project to admit the package into.'),
    destination: z.string().min(1).optional()
      .describe('Project-relative directory. Defaults to Assets/Vendored/<assetId>/<version>.'),
    allowUnknownLicense: z.boolean().default(false)
      .describe('Admit a package whose license is unknown. Blocked by default: shipping an asset '
        + 'you cannot license is a legal problem, not a technical one.'),
    allowInvalid: z.boolean().default(false)
      .describe('Admit a package that failed its shipping policy.'),
  };

  server.registerTool(
    'plan_vendor_admission',
    {
      title: 'Plan admitting a package into a game project',
      description:
        'FREE, local, writes nothing. Reports where the files would land and lists every blocker: ' +
        'an unknown license, a failed validation, a name collision, a symlink escape. Call this ' +
        'first -- the blockers are the point.',
      inputSchema: vendorShape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(ctx.logger, 'plan_vendor_admission', async (args) => {
      const result = await admitVendorPackage({
        packagePath: await resolvePackage(ctx, args.package),
        projectRoot: path.resolve(args.project),
        ...(args.destination !== undefined ? { destinationRelative: args.destination } : {}),
        confirm: false,
        allowUnknownLicense: args.allowUnknownLicense,
        allowInvalid: args.allowInvalid,
      });
      return ok(result as unknown as Record<string, unknown>);
    }),
  );

  server.registerTool(
    'vendor_package_into_project',
    {
      title: 'Admit a built package into a game project',
      description:
        'Copies a verified package into the project and records it in a vendor lock. Refuses on ' +
        'any blocker unless it is explicitly overridden. Writes into the project, so it requires ' +
        'GAME_DEV_MCP_ALLOW_PROJECT_WRITE=1 plus a confirmation; call plan_vendor_admission first.',
      inputSchema: vendorShape,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(ctx.logger, 'vendor_package_into_project', async (args) => {
      assertProjectWriteAuthority();
      const result = await admitVendorPackage({
        packagePath: await resolvePackage(ctx, args.package),
        projectRoot: path.resolve(args.project),
        ...(args.destination !== undefined ? { destinationRelative: args.destination } : {}),
        confirm: true,
        allowUnknownLicense: args.allowUnknownLicense,
        allowInvalid: args.allowInvalid,
      });
      const body = ok(result as unknown as Record<string, unknown>);
      // A blocked admission is a failure the caller must act on, not a result
      // it can skim past.
      return result.blockers.length > 0 ? { ...body, isError: true } : body;
    }),
  );

  server.registerTool(
    'credentials_status',
    {
      title: 'Report which provider credentials are configured',
      description:
        'FREE, local. Says whether each provider is configured, never what the value is. Ask ' +
        'before a paid call: a missing credential is why a generation would fail, and it is ' +
        'cheaper to know now.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(ctx.logger, 'credentials_status', async () => ok({
      schema: 'game_dev.credentials_status.v1',
      tripo: ctx.config.tripoApiKey ? 'configured' : 'missing',
      leonardo: ctx.config.leonardoApiKey ? 'configured' : 'missing',
      values: 'redacted',
      note: 'Credentials are never returned. The native app stores them in Keychain; the CLI reads environment variables.',
    })),
  );
}
