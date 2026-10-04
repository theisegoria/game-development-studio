import { createHash } from 'node:crypto';
import { accessSync, constants, closeSync, existsSync, fstatSync, openSync, readSync, realpathSync, statSync, lstatSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { invalidInput, invalidState } from '../util/errors.js';
import { atomicJson } from '../storage/transaction.js';

export const optionalToolSchema = z.enum(['blender', 'basisu', 'coacd-python']);
export type OptionalTool = z.infer<typeof optionalToolSchema>;
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const selectionSchema = z.object({
  executablePath: z.string().min(1), resolvedPath: z.string().min(1), sha256: sha256Schema,
}).strict();
const configurationSchema = z.object({
  schema: z.literal('game_dev.tool_configuration.v1'),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1),
  tools: z.object({ blender: selectionSchema.optional(), basisu: selectionSchema.optional(), 'coacd-python': selectionSchema.optional() }).strict(),
}).strict();
export type ToolSelection = z.infer<typeof selectionSchema>;
export type ToolConfiguration = z.infer<typeof configurationSchema>;
export type ToolSelectionCode = 'verified' | 'not-configured' | 'invalid-configuration' | 'invalid-path' | 'missing' | 'not-executable' | 'too-large' | 'moved' | 'changed' | 'digest-required' | 'invalid-digest';
export interface ToolSelectionInspection {
  tool: OptionalTool;
  available: boolean;
  source: 'environment' | 'saved' | 'none' | 'discovered';
  code: ToolSelectionCode;
  processLaunched: false;
  identity?: ToolSelection;
  digestPinned?: boolean;
}
const MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024;
const MAX_CONFIGURATION_BYTES = 64 * 1024;
const environmentKeys: Record<OptionalTool, { path: string; hash: string }> = {
  blender: { path: 'BLENDER_PATH', hash: 'GAME_DEV_BLENDER_SHA256' },
  basisu: { path: 'GAME_DEV_BASISU_PATH', hash: 'GAME_DEV_BASISU_SHA256' },
  'coacd-python': { path: 'GAME_DEV_COACD_PYTHON', hash: 'GAME_DEV_COACD_PYTHON_SHA256' },
};
export const toolSelectionMessages: Record<ToolSelectionCode, string> = {
  verified: 'Executable bytes verified; version and runtime behavior have not been checked.',
  'not-configured': 'No explicit executable selection is configured.',
  'invalid-configuration': 'Saved tool configuration is invalid or unreadable; repair it explicitly before using optional tools.',
  'invalid-path': 'Tool executable and configuration paths must be absolute.',
  missing: 'Selected executable is missing or unreadable; select its current location explicitly.',
  'not-executable': 'Selected executable is not a regular executable file.',
  'too-large': 'Selected executable exceeds the 256 MiB inspection limit.',
  moved: 'Selected executable resolves to a different location; select and review it again.',
  changed: 'Selected executable bytes changed; select and review its digest again.',
  'digest-required': 'Configure an absolute GAME_DEV_BASISU_PATH and GAME_DEV_BASISU_SHA256 from the verified CPU build manifest, or save a reviewed Basis selection.',
  'invalid-digest': 'Expected SHA-256 must be 64 lowercase hexadecimal characters.',
};

/** Per-user location, independent of the app working directory and shell PATH. */
export function toolConfigurationPath(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env.GAME_DEV_TOOL_CONFIG_PATH?.trim();
  if (explicit) {
    if (!path.isAbsolute(explicit)) throw invalidInput('GAME_DEV_TOOL_CONFIG_PATH must be absolute.');
    return explicit;
  }
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const root = process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
    : process.platform === 'win32' ? (env.APPDATA || path.join(home, 'AppData', 'Roaming'))
      : (env.XDG_CONFIG_HOME || path.join(home, '.config'));
  if (!path.isAbsolute(root)) throw invalidInput('The per-user tool configuration root must be absolute.');
  return path.join(root, 'Game Development Studio', 'tools.json');
}

function readConfiguration(env: NodeJS.ProcessEnv): ToolConfiguration {
  const file = toolConfigurationPath(env);
  try {
    const info = lstatSync(file);
    if (!info.isFile() || info.size > MAX_CONFIGURATION_BYTES) throw new Error('invalid configuration file');
    const fd = openSync(file, 'r');
    let raw: string;
    try {
      const bytes = Buffer.alloc(MAX_CONFIGURATION_BYTES + 1);
      let size = 0;
      while (size < bytes.length) {
        const count = readSync(fd, bytes, size, bytes.length - size, size);
        if (count === 0) break;
        size += count;
      }
      if (size > MAX_CONFIGURATION_BYTES) throw new Error('configuration too large');
      raw = bytes.subarray(0, size).toString('utf8');
    } finally { closeSync(fd); }
    const parsed = configurationSchema.parse(JSON.parse(raw));
    for (const selection of Object.values(parsed.tools)) {
      if (selection && (!path.isAbsolute(selection.executablePath) || !path.isAbsolute(selection.resolvedPath))) throw new Error('invalid configuration path');
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 'game_dev.tool_configuration.v1', revision: 0, tools: {} };
    // File contents and OS errors can contain private paths. Keep this error fixed.
    throw invalidState(toolSelectionMessages['invalid-configuration']);
  }
}

/** Stream bounded files synchronously so existing synchronous Blender discovery can use the same verifier. */
function inspectExecutable(executablePath: string, pinned?: ToolSelection, expectedSHA256?: string): { code: ToolSelectionCode; identity?: ToolSelection } {
  if (!path.isAbsolute(executablePath)) return { code: 'invalid-path' };
  let fd: number | undefined;
  try {
    const resolvedPath = realpathSync(executablePath);
    if (pinned && resolvedPath !== pinned.resolvedPath) return { code: 'moved' };
    fd = openSync(resolvedPath, 'r');
    const before = fstatSync(fd);
    if (!before.isFile()) return { code: 'not-executable' };
    if (before.size > MAX_EXECUTABLE_BYTES) return { code: 'too-large' };
    accessSync(resolvedPath, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    const hash = createHash('sha256');
    const buffer = Buffer.alloc(64 * 1024);
    let offset = 0;
    while (offset <= MAX_EXECUTABLE_BYTES) {
      const bytes = readSync(fd, buffer, 0, Math.min(buffer.length, MAX_EXECUTABLE_BYTES + 1 - offset), offset);
      if (bytes === 0) break;
      offset += bytes;
      if (offset > MAX_EXECUTABLE_BYTES) return { code: 'too-large' };
      hash.update(buffer.subarray(0, bytes));
    }
    const after = fstatSync(fd), current = statSync(resolvedPath);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || before.dev !== current.dev || before.ino !== current.ino || realpathSync(executablePath) !== resolvedPath) return { code: 'changed' };
    const sha256 = hash.digest('hex');
    if ((pinned && sha256 !== pinned.sha256) || (expectedSHA256 && sha256 !== expectedSHA256)) return { code: 'changed' };
    return { code: 'verified', identity: { executablePath, resolvedPath, sha256 } };
  } catch (error) {
    return { code: (error as NodeJS.ErrnoException).code === 'EACCES' ? 'not-executable' : 'missing' };
  } finally { if (fd !== undefined) closeSync(fd); }
}

export function verifyExecutableSelection(selection: ToolSelection): void {
  const inspected = inspectExecutable(selection.executablePath, selection);
  if (!inspected.identity) throw invalidState(toolSelectionMessages[inspected.code], { reason: inspected.code });
}

/** Never launches a process. An invalid explicit selection never falls back to discovery. */
export function inspectToolSelection(tool: OptionalTool, env: NodeJS.ProcessEnv = process.env): ToolSelectionInspection {
  const base = { tool, processLaunched: false as const };
  const keys = environmentKeys[tool];
  const configured = env[keys.path]?.trim();
  if (configured) {
    const expected = env[keys.hash]?.trim();
    if (expected && !sha256Schema.safeParse(expected).success) return { ...base, available: false, source: 'environment', code: 'invalid-digest' };
    if (tool === 'basisu' && !expected) return { ...base, available: false, source: 'environment', code: 'digest-required' };
    const inspected = inspectExecutable(configured, undefined, expected);
    return { ...base, ...inspected, available: inspected.code === 'verified', source: 'environment', digestPinned: Boolean(expected) };
  }
  try {
    const selected = readConfiguration(env).tools[tool];
    if (!selected) return { ...base, available: false, source: 'none', code: 'not-configured' };
    const inspected = inspectExecutable(selected.executablePath, selected);
    return { ...base, ...inspected, available: inspected.code === 'verified', source: 'saved', digestPinned: true };
  } catch { return { ...base, available: false, source: 'saved', code: 'invalid-configuration' }; }
}

export function resolveToolExecutable(tool: OptionalTool, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const inspection = inspectToolSelection(tool, env);
  return inspection.available ? inspection.identity?.resolvedPath : undefined;
}

export function listToolSelections(env: NodeJS.ProcessEnv = process.env) {
  return { schema: 'game_dev.tool_selections.v1' as const, configurationPath: toolConfigurationPath(env), processLaunched: false as const,
    tools: optionalToolSchema.options.map(tool => { const inspected = inspectToolSelection(tool, env); return { ...inspected, detail: toolSelectionMessages[inspected.code] }; }) };
}

async function updateConfiguration(env: NodeJS.ProcessEnv, update: (config: ToolConfiguration) => void): Promise<void> {
  const file = toolConfigurationPath(env), directory = path.dirname(file), lock = `${file}.lock`;
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  // An interrupted lock is deliberately not silently stolen. A concurrent writer receives an actionable refusal.
  try { await fs.mkdir(lock, { mode: 0o700 }); } catch { throw invalidState('Tool configuration is locked by another or interrupted writer; retry after it finishes, or review and remove the tools.json.lock directory.'); }
  try {
    const config = readConfiguration(env);
    update(config); config.revision++;
    await atomicJson(file, config);
  } finally {
    await fs.rmdir(lock);
  }
}

export async function configureTool(args: { tool: OptionalTool; executablePath: string; expectedSHA256?: string }, env: NodeJS.ProcessEnv = process.env) {
  const tool = optionalToolSchema.parse(args.tool);
  if (args.expectedSHA256 && !sha256Schema.safeParse(args.expectedSHA256).success) throw invalidInput(toolSelectionMessages['invalid-digest']);
  const inspected = inspectExecutable(args.executablePath, undefined, args.expectedSHA256);
  if (!inspected.identity) throw invalidInput(toolSelectionMessages[inspected.code], { tool, reason: inspected.code });
  // Revalidate while holding the write lock, so the saved bytes match the review result.
  await updateConfiguration(env, config => {
    const current = inspectExecutable(args.executablePath, inspected.identity);
    if (!current.identity) throw invalidState(toolSelectionMessages[current.code], { tool, reason: current.code });
    config.tools[tool] = current.identity;
  });
  return { schema: 'game_dev.tool_configuration_result.v1' as const, tool, saved: true, processLaunched: false as const,
    selection: inspected.identity, configurationPath: toolConfigurationPath(env), evidenceCeiling: 'Saved executable bytes only; version and runtime environment have not been checked.' };
}

export async function clearTool(tool: OptionalTool, env: NodeJS.ProcessEnv = process.env) {
  optionalToolSchema.parse(tool);
  await updateConfiguration(env, config => { delete config.tools[tool]; });
  return { schema: 'game_dev.tool_configuration_result.v1' as const, tool, cleared: true, processLaunched: false as const, environmentOverrideStillPresent: Boolean(env[environmentKeys[tool].path]?.trim()) };
}

/** Recipe fingerprints must use this same verifier and resolver as execution. */
export function toolOperationIdentity(operation: string, env: NodeJS.ProcessEnv = process.env): ToolSelectionInspection | null {
  const tool: OptionalTool | undefined = ['normalize_mesh', 'export_usd_preview'].includes(operation) ? 'blender'
    : operation === 'compress_texture_variant' ? 'basisu'
      : operation === 'decompose_collision_mesh' ? 'coacd-python' : undefined;
  return tool === 'blender' ? inspectBlenderSelection(env) : tool ? inspectToolSelection(tool, env) : null;
}

/** Discovery is retained for Blender only, after both explicit sources are absent. */
export function discoverBlenderExecutable(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const selected = inspectToolSelection('blender', env);
  if (selected.source !== 'none') return selected.available ? selected.identity?.resolvedPath : undefined;
  const names = process.platform === 'win32' ? ['blender.exe'] : ['blender'];
  const candidates = (env.PATH?.split(path.delimiter) ?? []).filter(dir => dir && path.isAbsolute(dir)).flatMap(dir => names.map(name => path.join(dir, name)));
  candidates.push('/Applications/Blender.app/Contents/MacOS/Blender', '/usr/local/bin/blender', '/usr/bin/blender', '/snap/bin/blender', 'C:\\Program Files\\Blender Foundation\\Blender\\blender.exe');
  return candidates.find(candidate => existsSync(candidate) && inspectExecutable(candidate).code === 'verified');
}

export function inspectBlenderSelection(env: NodeJS.ProcessEnv = process.env): ToolSelectionInspection {
  const selected = inspectToolSelection('blender', env);
  if (selected.source !== 'none') return selected;
  const discovered = discoverBlenderExecutable(env);
  if (!discovered) return selected;
  const inspected = inspectExecutable(discovered);
  return { tool: 'blender', ...inspected, available: inspected.code === 'verified', source: 'discovered', digestPinned: false, processLaunched: false };
}
