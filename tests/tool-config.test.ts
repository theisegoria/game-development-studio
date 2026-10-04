import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { clearTool, configureTool, inspectToolSelection, listToolSelections, toolConfigurationPath, toolOperationIdentity } from '../src/installation/tool-config.js';
import { findBlender } from '../src/util/blender.js';
import { diagnoseTextureCompression, basisChildEnvironment } from '../src/production/basis.js';
import { configuredCoacdPython, runCoacdPython } from '../src/collision/process.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'game-dev tool-config ')); roots.push(root);
  const env = { GAME_DEV_TOOL_CONFIG_PATH: path.join(root, 'User Settings', 'tools.json'), PATH: '' };
  const executable = path.join(root, 'Tools with spaces', process.platform === 'win32' ? 'fixture.exe' : 'fixture');
  await fs.mkdir(path.dirname(executable)); await fs.writeFile(executable, 'fixture bytes; never launch', { mode: 0o700 });
  return { root, env, executable };
}

it('saves absolute paths and byte identity without a launch, works without shell PATH, and preserves separate selections', async () => {
  const f = await fixture();
  const saved = await configureTool({ tool: 'blender', executablePath: f.executable }, f.env);
  expect(saved).toMatchObject({ saved: true, processLaunched: false });
  expect(saved.selection.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(findBlender(f.env)).toBe(saved.selection.resolvedPath);
  await configureTool({ tool: 'basisu', executablePath: f.executable, expectedSHA256: saved.selection.sha256 }, f.env);
  await configureTool({ tool: 'coacd-python', executablePath: f.executable }, f.env);
  expect(listToolSelections(f.env).tools.every(tool => tool.available && tool.digestPinned)).toBe(true);
  expect(await diagnoseTextureCompression(f.env)).toMatchObject({ available: true, versionChecked: false, processLaunched: false });
  expect(await configuredCoacdPython(f.env)).toBe(f.executable);
  expect(toolOperationIdentity('normalize_mesh', f.env)).toMatchObject({ source: 'saved', identity: saved.selection });
  expect(toolOperationIdentity('validate_mesh', f.env)).toBeNull();
  if (process.platform !== 'win32') expect((await fs.stat(f.env.GAME_DEV_TOOL_CONFIG_PATH)).mode & 0o777).toBe(0o600);
  await clearTool('basisu', f.env);
  expect(inspectToolSelection('basisu', f.env).code).toBe('not-configured');
  expect(inspectToolSelection('blender', f.env).available).toBe(true);
});

it('fails closed for changed/missing selected bytes instead of falling back to a valid PATH install', async () => {
  const f = await fixture();
  await configureTool({ tool: 'blender', executablePath: f.executable }, f.env);
  const pathInstall = path.join(f.root, process.platform === 'win32' ? 'blender.exe' : 'blender');
  await fs.writeFile(pathInstall, 'fallback fixture; do not launch', { mode: 0o700 });
  const env = { ...f.env, PATH: f.root };
  const before = toolOperationIdentity('normalize_mesh', env);
  await fs.writeFile(f.executable, 'updated fixture bytes');
  expect(inspectToolSelection('blender', env)).toMatchObject({ available: false, code: 'changed' });
  expect(findBlender(env)).toBeUndefined();
  expect(toolOperationIdentity('normalize_mesh', env)).not.toEqual(before);
  await fs.unlink(f.executable);
  expect(inspectToolSelection('blender', env).code).toBe('missing');
  expect(findBlender(env)).toBeUndefined();
});

it('rejects moved symlink targets and preserves the CoACD venv executable path', async () => {
  if (process.platform === 'win32') return; // Windows symlink creation requires an additional OS privilege.
  const f = await fixture(), link = path.join(f.root, 'venv-python');
  await fs.symlink(f.executable, link);
  await configureTool({ tool: 'coacd-python', executablePath: link }, f.env);
  expect(await configuredCoacdPython(f.env)).toBe(link);
  const replacement = path.join(f.root, 'replacement');
  await fs.copyFile(f.executable, replacement); await fs.chmod(replacement, 0o700);
  await fs.unlink(link); await fs.symlink(replacement, link);
  expect(inspectToolSelection('coacd-python', f.env)).toMatchObject({ available: false, code: 'moved' });
  await expect(configuredCoacdPython(f.env)).rejects.toThrow(/different location/);
});

it('keeps legacy explicit environment overrides, pins optional digests, and reads only the supplied PATH', async () => {
  const f = await fixture();
  const saved = await configureTool({ tool: 'blender', executablePath: f.executable }, f.env);
  expect(findBlender({ ...f.env, BLENDER_PATH: '/missing/override' })).toBeUndefined();
  expect(await configuredCoacdPython({ ...f.env, GAME_DEV_COACD_PYTHON: f.executable })).toBe(f.executable);
  expect(inspectToolSelection('basisu', { ...f.env, GAME_DEV_BASISU_PATH: f.executable }).code).toBe('digest-required');
  expect(inspectToolSelection('basisu', { ...f.env, GAME_DEV_BASISU_PATH: f.executable, GAME_DEV_BASISU_SHA256: saved.selection.sha256 }).available).toBe(true);
  expect(inspectToolSelection('basisu', { ...f.env, GAME_DEV_BASISU_PATH: f.executable, GAME_DEV_BASISU_SHA256: 'a'.repeat(64) }).code).toBe('changed');
  await clearTool('blender', f.env);
  const discovered = path.join(f.root, process.platform === 'win32' ? 'blender.exe' : 'blender');
  await fs.copyFile(f.executable, discovered); await fs.chmod(discovered, 0o700);
  expect(findBlender({ ...f.env, PATH: f.root })).toBe(discovered);
  expect(toolOperationIdentity('normalize_mesh', { ...f.env, PATH: f.root })).toMatchObject({ source: 'discovered', available: true, digestPinned: false });
});

it('rejects relative paths, mismatched digests, malformed records and interrupted or concurrent writers', async () => {
  const f = await fixture();
  await expect(configureTool({ tool: 'basisu', executablePath: 'relative/executable' }, f.env)).rejects.toThrow(/absolute/);
  await expect(configureTool({ tool: 'basisu', executablePath: f.executable, expectedSHA256: 'a'.repeat(64) }, f.env)).rejects.toThrow(/changed/);
  expect(() => toolConfigurationPath({ GAME_DEV_TOOL_CONFIG_PATH: 'relative/tools.json' })).toThrow(/absolute/);
  const writes = await Promise.allSettled([
    configureTool({ tool: 'blender', executablePath: f.executable }, f.env),
    configureTool({ tool: 'basisu', executablePath: f.executable }, f.env),
  ]);
  expect(writes.filter(write => write.status === 'fulfilled')).toHaveLength(1);
  expect(writes.filter(write => write.status === 'rejected')).toHaveLength(1);
  const config = JSON.parse(await fs.readFile(f.env.GAME_DEV_TOOL_CONFIG_PATH, 'utf8'));
  expect(config.revision).toBe(1);
  expect(Object.keys(config.tools)).toHaveLength(1);
  await fs.mkdir(`${f.env.GAME_DEV_TOOL_CONFIG_PATH}.lock`);
  await expect(clearTool('blender', f.env)).rejects.toThrow(/locked/);
  await fs.rmdir(`${f.env.GAME_DEV_TOOL_CONFIG_PATH}.lock`);
  await fs.writeFile(f.env.GAME_DEV_TOOL_CONFIG_PATH, JSON.stringify({ ...config, unknownPrivateData: 'https://private.invalid/' }));
  expect(inspectToolSelection('blender', f.env)).toMatchObject({ available: false, code: 'invalid-configuration' });
  expect(findBlender(f.env)).toBeUndefined();
  await expect(clearTool('basisu', f.env)).rejects.toThrow(/invalid or unreadable/);
  expect(await fs.readdir(path.dirname(f.env.GAME_DEV_TOOL_CONFIG_PATH))).toEqual(['tools.json']);
});

it('keeps Basis process environment narrow and bounds CPU workers', () => {
  const executable = path.resolve('tool', 'basisu'), cwd = path.resolve('temporary-job');
  const env = basisChildEnvironment(executable, cwd, { PATH: 'private', HOME: 'private', NODE_OPTIONS: '--require injected', PYTHONPATH: 'private', TRIPO_API_KEY: 'secret', SystemRoot: 'C:\\Windows', LANG: 'en_US.UTF-8' });
  expect(env).toMatchObject({ PATH: path.dirname(executable), HOME: cwd, OMP_NUM_THREADS: '1', SystemRoot: 'C:\\Windows' });
  expect(env).not.toHaveProperty('NODE_OPTIONS'); expect(env).not.toHaveProperty('PYTHONPATH'); expect(env).not.toHaveProperty('TRIPO_API_KEY');
});

it('bounds executable and configuration reads and refuses directories or nonexecutable files', async () => {
  const f = await fixture();
  const large = path.join(f.root, 'large-executable');
  const handle = await fs.open(large, 'wx', 0o700);
  try { await handle.truncate(256 * 1024 * 1024 + 1); } finally { await handle.close(); }
  expect(inspectToolSelection('blender', { ...f.env, BLENDER_PATH: large }).code).toBe('too-large');
  await expect(configureTool({ tool: 'blender', executablePath: f.root }, f.env)).rejects.toThrow(/regular executable/);
  if (process.platform !== 'win32') {
    await fs.chmod(f.executable, 0o600);
    await expect(configureTool({ tool: 'blender', executablePath: f.executable }, f.env)).rejects.toThrow(/regular executable/);
  }
  await fs.mkdir(path.dirname(f.env.GAME_DEV_TOOL_CONFIG_PATH), { recursive: true });
  await fs.writeFile(f.env.GAME_DEV_TOOL_CONFIG_PATH, 'x'.repeat(64 * 1024 + 1));
  expect(inspectToolSelection('blender', f.env).code).toBe('invalid-configuration');
});

it('refuses changed CoACD interpreter bytes before invoking a child with a reviewed selection', async () => {
  const f = await fixture();
  const saved = await configureTool({ tool: 'coacd-python', executablePath: f.executable }, f.env);
  await fs.writeFile(f.executable, 'changed fixture bytes');
  await expect(runCoacdPython({ python: f.executable, script: path.join(f.root, 'not-launched.py'), args: [], cwd: f.root, timeoutMs: 100, selection: saved.selection })).rejects.toThrow(/bytes changed/);
});
