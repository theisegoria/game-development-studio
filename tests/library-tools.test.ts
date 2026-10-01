/**
 * A model could generate an asset, inspect it, normalize it and see it, then
 * hit a wall: packaging, finding what it had already made, and shipping it
 * into a game were all CLI-only. That is the back half of the pipeline, and
 * without it the front half produces files nobody can use.
 *
 * The authority split follows where the bytes land, and these tests pin it:
 * packaging and cataloguing write inside the tool's workspace and are free;
 * vendoring writes into the user's project and is not.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerLibraryTools } from '../src/tools/library.js';
import { connectTools, type ToolClient } from './helpers/tool-harness.js';
import { writeGameReadyGlb } from './helpers/model-fixture.js';

const ENV = 'GAME_DEV_MCP_ALLOW_PROJECT_WRITE';
let work: string;
let project: string;
let model: string;
let tools: ToolClient;
let savedEnv: string | undefined;

beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'library-tools-'));
  project = path.join(work, 'game');
  await fs.mkdir(project);
  model = await writeGameReadyGlb(path.join(work, 'crate.glb'));
  tools = await connectTools(registerLibraryTools, work);
  savedEnv = process.env[ENV];
  delete process.env[ENV];
});

afterEach(async () => {
  if (savedEnv === undefined) delete process.env[ENV]; else process.env[ENV] = savedEnv;
  await tools.close();
  await fs.rm(work, { recursive: true, force: true });
});

const build = (extra: Record<string, unknown> = {}) =>
  tools.call('build_asset_package', { modelPath: model, name: 'Crate', license: 'CC0-1.0', ...extra });

describe('packaging, which writes only inside the workspace', () => {
  it('plans without writing, and says why it cannot name the packageId', async () => {
    const { isError, payload } = await tools.call('plan_asset_package', { modelPath: model, name: 'Crate' });

    expect(isError).toBe(false);
    expect(payload).toMatchObject({ assetId: 'crate', version: '1.0.0', destinationExists: false });
    // The id hashes the staged file set, so producing it means doing the write.
    expect(payload).not.toHaveProperty('packageId');
    await expect(fs.access(path.join(work, '.game-dev', 'packages'))).rejects.toThrow();
  });

  it('builds and indexes without any authority, because it stays in the workspace', async () => {
    const { isError, payload } = await tools.call('build_asset_package', {
      modelPath: model, name: 'Crate', license: 'CC0-1.0',
    });

    expect(isError).toBe(false);
    expect(String(payload.packageId)).toMatch(/^pkg_[0-9a-f]{24}$/);
    expect(payload.reused).toBe(false);
    await expect(fs.access(payload.packagePath as string)).resolves.toBeUndefined();
  });

  it('is idempotent: an identical build reuses rather than duplicating', async () => {
    const first = await build();
    const second = await build();

    expect(second.payload.packageId).toBe(first.payload.packageId);
    expect(second.payload.reused).toBe(true);
  });

  it('verifies a built package against the hashes its manifest records', async () => {
    const built = await build();
    const { isError, payload } = await tools.call('verify_asset_package', {
      package: built.payload.packageId as string,
    });

    expect(isError).toBe(false);
    expect(payload.hashesVerified).toBe(true);
    // Resolved through the catalog by id, and the build reported the same
    // resolved string -- one directory, one path, however it was reached.
    expect(payload.packagePath).toBe(built.payload.packagePath);
  });
});

describe('the catalog, so a model can find what it already made', () => {
  it('finds a built package by text and reports it as valid', async () => {
    await build();
    const { isError, payload } = await tools.call('list_catalog_assets', { query: 'crate' });

    expect(isError).toBe(false);
    expect(payload.total).toBe(1);
    expect((payload.assets as Array<{ displayName: string }>)[0]?.displayName).toBe('Crate');
  });

  it('filters by validation state rather than making the caller read every row', async () => {
    await build();
    const passed = await tools.call('list_catalog_assets', { validationPassed: true });
    const failed = await tools.call('list_catalog_assets', { validationPassed: false });

    expect((passed.payload.total as number) + (failed.payload.total as number)).toBe(1);
  });

  it('reads one entry by id', async () => {
    const built = await build();
    const { isError, payload } = await tools.call('show_catalog_asset', {
      packageId: built.payload.packageId as string,
    });

    expect(isError).toBe(false);
    expect(payload.packageId).toBe(built.payload.packageId);
  });
});

describe('vendoring, which writes into the project', () => {
  it('plans with no authority and writes nothing', async () => {
    const built = await build();
    const { isError, payload } = await tools.call('plan_vendor_admission', {
      package: built.payload.packageId as string, project,
    });

    expect(isError).toBe(false);
    expect(payload.dryRun).toBe(true);
    await expect(fs.access(path.join(project, 'Assets'))).rejects.toThrow();
  });

  it('is refused without project-write authority', async () => {
    const built = await build();
    const { isError, payload } = await tools.call('vendor_package_into_project', {
      package: built.payload.packageId as string, project,
    });

    expect(isError).toBe(true);
    expect((payload.details as { grantBySetting: string[] }).grantBySetting).toEqual([`${ENV}=1`]);
    await expect(fs.access(path.join(project, 'Assets'))).rejects.toThrow();
  });

  it('admits the package once authority is granted', async () => {
    process.env[ENV] = '1';
    const built = await build();
    const { isError, payload } = await tools.call('vendor_package_into_project', {
      package: built.payload.packageId as string, project,
    });

    expect(isError).toBe(false);
    expect(payload.blockers).toEqual([]);
    await expect(fs.access(path.join(project, '.game-dev', 'vendor-lock.json'))).resolves.toBeUndefined();
  });

  it('blocks an unknown license, and reports it as an error rather than a result to skim', async () => {
    process.env[ENV] = '1';
    // No license: shipping an asset you cannot license is a legal problem.
    const built = await tools.call('build_asset_package', { modelPath: model, name: 'Unlicensed' });
    const { isError, payload } = await tools.call('vendor_package_into_project', {
      package: built.payload.packageId as string, project,
    });

    expect(isError).toBe(true);
    expect((payload.blockers as string[]).join(' ')).toContain('license is unknown');
    await expect(fs.access(path.join(project, 'Assets'))).rejects.toThrow();
  });
});

describe('credentials_status', () => {
  it('says configured or missing, never the value', async () => {
    const { isError, payload } = await tools.call('credentials_status', {});

    expect(isError).toBe(false);
    expect(['configured', 'missing']).toContain(payload.tripo);
    expect(payload.values).toBe('redacted');
    expect(JSON.stringify(payload)).not.toMatch(/[A-Za-z0-9_-]{24,}/);
  });
});
