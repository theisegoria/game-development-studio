import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { runDoctor } from '../src/cli/doctor.js';
import { buildSupportReport, redactDoctorReport, supportReportSchema, writeSupportReport } from '../src/installation/support-report.js';
import { GAME_DEV_VERSION } from '../src/version.js';

const launch = vi.hoisted(() => vi.fn(() => { throw new Error('No external process is allowed in doctor tests'); }));
vi.mock('node:child_process', async importOriginal => ({ ...await importOriginal<typeof import('node:child_process')>(), spawn: launch }));
const roots: string[] = [];
afterEach(async () => { launch.mockClear(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'game-dev-doctor-workflow-')); roots.push(root);
  const env = { ASSET_OUTPUT_DIR: root, GAME_DEV_TOOL_CONFIG_PATH: path.join(root, 'tools.json'), BLENDER_PATH: path.join(root, 'not-installed'), PATH: '', TRIPO_API_KEY: 'private-provider-key', LEONARDO_API_KEY: 'private-provider-key' };
  return { root, env, runtime: { config: loadConfig(env) } };
}

it('requires only the selected workflow, keeps generic capture healthy without optional tools, and never launches', async () => {
  const f = await fixture();
  const generic = await runDoctor(f.runtime, { env: f.env });
  expect(generic).toMatchObject({ workflow: 'generic-capture', healthy: true, processLaunched: false });
  expect(generic.checks.find(check => check.id === 'blender')).toMatchObject({ required: false, status: 'unavailable' });
  for (const workflow of ['asset-inspect', 'asset-package'] as const) expect((await runDoctor(f.runtime, { env: f.env, workflow })).healthy).toBe(true);
  for (const [workflow, id] of [['blender-normalize', 'blender'], ['texture-compression', 'basisu'], ['collision-decomposition', 'coacd-python']] as const) {
    const result = await runDoctor(f.runtime, { env: f.env, workflow });
    expect(result.healthy).toBe(false);
    expect(result.checks.find(check => check.id === id)).toMatchObject({ required: true, status: 'fail' });
  }
  const configured = await runDoctor(f.runtime, { env: { ...f.env, GAME_DEV_COACD_PYTHON: process.execPath }, workflow: 'collision-decomposition' });
  expect(configured.checks.find(check => check.id === 'coacd-python')).toMatchObject({ status: 'pass', evidence: { versionChecked: false } });
  expect(launch).not.toHaveBeenCalled();
});

it('detects expected helper version mismatch without inventing capture or tool-version evidence', async () => {
  const f = await fixture();
  expect((await runDoctor(f.runtime, { env: f.env, expectedVersion: GAME_DEV_VERSION })).healthy).toBe(true);
  const mismatch = await runDoctor(f.runtime, { env: f.env, expectedVersion: '0.0.1' });
  expect(mismatch).toMatchObject({ healthy: false });
  expect(mismatch.checks.find(check => check.id === 'helper-version')).toMatchObject({ required: true, status: 'fail' });
  expect(mismatch.evidenceCeiling).toContain('does not prove tool versions');
  expect(launch).not.toHaveBeenCalled();
});

it('projects only allowlisted fields and drops private paths, URLs, credentials, arbitrary evidence and error text', async () => {
  const f = await fixture();
  const doctor = await runDoctor(f.runtime, { env: f.env });
  for (const check of doctor.checks) {
    check.detail = 'https://private.invalid/asset?credential=secret /Users/private-name/work secret-provider-key';
    check.nextStep = 'private advice';
    check.evidence = { ...(check.evidence ?? {}), privateError: check.detail, environment: f.env, url: 'https://private.invalid/' };
  }
  const report = redactDoctorReport(doctor), serialized = JSON.stringify(report);
  for (const forbidden of ['private-name', 'private.invalid', 'secret-provider-key', 'private-provider-key', 'ASSET_OUTPUT_DIR', f.root, 'nextStep', 'privateError', 'environment:']) expect(serialized).not.toContain(forbidden);
  expect(report).toMatchObject({ redaction: { policy: 'allowlist-v1', pathsIncluded: false, environmentValuesIncluded: false, errorTextIncluded: false, URLsIncluded: false }, sharing: { transmitted: false, userReviewRequired: true } });
  expect(supportReportSchema.parse(report)).toEqual(await buildSupportReport(f.runtime, { env: f.env }));
  expect(launch).not.toHaveBeenCalled();
});

it('writes a private local report only to a new file, refuses overwrite/symlinks, and never shares', async () => {
  const f = await fixture(), outputPath = path.join(f.root, 'review support report.json');
  const written = await writeSupportReport(f.runtime, { env: f.env, outputPath });
  expect(written).toMatchObject({ transmitted: false, userReviewRequired: true });
  expect(supportReportSchema.parse(JSON.parse(await fs.readFile(outputPath, 'utf8')))).toEqual(written.report);
  if (process.platform !== 'win32') expect((await fs.stat(outputPath)).mode & 0o777).toBe(0o600);
  await expect(writeSupportReport(f.runtime, { env: f.env, outputPath })).rejects.toMatchObject({ code: 'EEXIST' });
  await expect(writeSupportReport(f.runtime, { env: f.env, outputPath: 'relative.json' })).rejects.toThrow(/absolute/);
  if (process.platform !== 'win32') {
    const symlink = path.join(f.root, 'report-link.json'); await fs.symlink(outputPath, symlink);
    await expect(writeSupportReport(f.runtime, { env: f.env, outputPath: symlink })).rejects.toMatchObject({ code: 'EEXIST' });
  }
  expect(launch).not.toHaveBeenCalled();
});
