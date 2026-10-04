import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { invalidState } from '../util/errors.js';
import { boundedFileSHA256 } from '../util/file-identity.js';

const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_TREE_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 100_000;
const MAX_DEPTH = 32;
const supportedPythonDirs = new Set(['python3.9', 'python3.10', 'python3.11', 'python3.12']);
const supportedPosixExecutables = new Set(['python', 'python3', 'python3.9', 'python3.10', 'python3.11', 'python3.12']);
const distutilsPrecedenceHook = "import os; var = 'SETUPTOOLS_USE_DISTUTILS'; enabled = os.environ.get(var, 'local') == 'local'; enabled and __import__('_distutils_hack').add_shim()";

interface IdentitySelection {
  executablePath: string;
}

interface TreeEntry {
  kind: 'file' | 'directory';
  path: string;
  mode: number;
  size: number;
  sha256: string;
}

function fail(message: string): never {
  throw invalidState(message);
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

function samePath(a: string, b: string): boolean {
  const left = path.resolve(a), right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

function sameStat(a: Awaited<ReturnType<typeof fs.lstat>>, b: Awaited<ReturnType<typeof fs.lstat>>): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.mode === b.mode && a.size === b.size
    && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

function relativePath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/');
}

async function readNamesBounded(directory: string, maximumNames = MAX_ENTRIES): Promise<string[]> {
  const handle = await fs.opendir(directory);
  const names: string[] = [];
  try {
    while (true) {
      const entry = await handle.read();
      if (!entry) break;
      names.push(entry.name);
      if (names.length > maximumNames) fail('CoACD package tree exceeds the 100,000 entry identity limit.');
    }
  } finally {
    await handle.close().catch(() => undefined);
  }
  names.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return names;
}

async function readSmallStableFile(file: string, maximumBytes: number, device: number): Promise<Buffer> {
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximumBytes || before.nlink > 1 || before.dev !== device) {
    fail('CoACD venv metadata must be a bounded, unlinked regular file inside its selected environment.');
  }
  const handle = await fs.open(file, 'r');
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      fail('CoACD venv metadata changed while its identity was measured.');
    }
    const bytes = Buffer.alloc(before.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const after = await handle.stat();
    const pathAfter = await fs.lstat(file);
    if (offset !== before.size || !sameStat(before, after) || !sameStat(before, pathAfter)) {
      fail('CoACD venv metadata changed while its identity was measured.');
    }
    return bytes.subarray(0, offset);
  } finally {
    await handle.close();
  }
}

function parseVenvConfiguration(bytes: Buffer): void {
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('CoACD pyvenv.cfg is not valid UTF-8.');
  }
  if (source.includes('\r') && /(^|[^\r])\r(?!\n)/.test(source)) fail('CoACD pyvenv.cfg has malformed line endings.');
  const values = new Map<string, string>();
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = /^([A-Za-z][A-Za-z0-9_-]*)\s*=\s*(\S(?:.*\S)?)\s*$/.exec(trimmed);
    if (!match) fail('CoACD pyvenv.cfg contains a malformed setting.');
    const key = match[1]!.toLowerCase();
    if (values.has(key)) fail('CoACD pyvenv.cfg contains duplicate settings.');
    values.set(key, match[2]!);
  }
  if (values.get('include-system-site-packages')?.toLowerCase() !== 'false') {
    fail('CoACD pyvenv.cfg must contain exactly one include-system-site-packages = false setting.');
  }
}

async function existingDirectory(root: string, absolute: string, device: number): Promise<boolean> {
  let stat;
  try {
    stat = await fs.lstat(absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== device) {
    fail('CoACD venv package layout contains a link or non-directory entry.');
  }
  const resolved = await fs.realpath(absolute);
  if (!isInside(root, resolved)) fail('CoACD venv package layout escapes its selected environment.');
  return true;
}

async function packageRoots(venvRoot: string, layout: 'posix' | 'windows', device: number): Promise<string[]> {
  if (layout === 'windows') {
    const root = path.join(venvRoot, 'Lib', 'site-packages');
    if (!await existingDirectory(venvRoot, root, device)) fail('Selected CoACD Windows venv is missing Lib/site-packages.');
    return [root];
  }

  const roots: string[] = [];
  for (const libraryName of ['lib', 'lib64']) {
    let libraryRoot = path.join(venvRoot, libraryName);
    let libraryInfo;
    try {
      libraryInfo = await fs.lstat(libraryRoot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (libraryInfo.isSymbolicLink()) {
      // Some POSIX venvs use lib64 as a conventional alias to their own lib tree.
      if (libraryName !== 'lib64') fail('CoACD venv package layout contains an unsupported library symlink.');
      const resolved = await fs.realpath(libraryRoot);
      const resolvedLib = await fs.realpath(path.join(venvRoot, 'lib')).catch(() => fail('CoACD lib64 alias has no matching lib directory.'));
      const targetInfo = await fs.stat(resolved);
      if (!samePath(resolved, resolvedLib) || !targetInfo.isDirectory() || targetInfo.dev !== device || !isInside(venvRoot, resolved)) {
        fail('CoACD lib64 alias must resolve to the selected venv lib directory.');
      }
      libraryRoot = resolved;
    } else if (!await existingDirectory(venvRoot, libraryRoot, device)) continue;
    for (const name of await readNamesBounded(libraryRoot)) {
      if (!name.startsWith('python3')) continue;
      if (!supportedPythonDirs.has(name)) fail('Selected CoACD venv uses an unsupported or malformed Python package layout.');
      const versionRoot = path.join(libraryRoot, name);
      if (!await existingDirectory(venvRoot, versionRoot, device)) fail('Selected CoACD venv Python package directory is invalid.');
      const sitePackages = path.join(versionRoot, 'site-packages');
      if (!await existingDirectory(venvRoot, sitePackages, device)) fail('Selected CoACD venv is missing a Python site-packages directory.');
      roots.push(await fs.realpath(sitePackages));
    }
  }
  if (roots.length === 0) fail('Selected CoACD POSIX venv has no supported lib/python3.x/site-packages tree.');
  roots.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
  return [...new Set(roots)];
}

async function verifyPth(file: string, packageRoot: string, venvRoot: string, device: number, digest: string): Promise<boolean> {
  const stat = await fs.lstat(file);
  if (stat.size > 64 * 1024) fail('CoACD .pth metadata exceeds the 64 KiB inspection limit.');
  const bytes = await readSmallStableFile(file, 64 * 1024, device);
  if (createHash('sha256').update(bytes).digest('hex') !== digest) fail('CoACD .pth metadata changed while its identity was measured.');
  let source: string;
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    fail('CoACD .pth metadata is not valid UTF-8.');
  }
  if (path.basename(file) === 'distutils-precedence.pth' && source.replace(/\r\n/g, '\n').trim() === distutilsPrecedenceHook) return true;
  for (const line of source.split(/\r?\n/)) {
    const entry = line.trim();
    if (!entry || entry.startsWith('#')) continue;
    if (/^import(?:\s|$)/.test(entry)) {
      fail('CoACD venv identity supports only the exact setuptools distutils-precedence .pth hook.');
    }
    if (path.isAbsolute(entry) || /^[A-Za-z]:[\\/]/.test(entry) || entry.startsWith('\\\\')) {
      fail('CoACD .pth files may not add absolute or external import paths.');
    }
    const target = path.resolve(packageRoot, entry);
    if (!isInside(packageRoot, target)) fail('CoACD .pth files may not add paths outside site-packages.');
    let resolved: string;
    try {
      resolved = await fs.realpath(target);
    } catch {
      fail('CoACD .pth file references a missing package path.');
    }
    if (!isInside(venvRoot, resolved)) fail('CoACD .pth file references a path outside its selected environment.');
  }
  return false;
}

/**
 * Fingerprint the selected venv's configuration and importable package trees without starting Python.
 * The executablePath is intentionally used as selected, even when the interpreter itself is a symlink.
 */
export async function coacdEnvironmentIdentitySHA256(selection: IdentitySelection | undefined): Promise<string> {
  if (!selection || !path.isAbsolute(selection.executablePath)) fail('CoACD environment identity requires an absolute selected Python executable.');
  const executable = path.resolve(selection.executablePath);
  const executableDirectory = path.dirname(executable);
  const parentName = path.basename(executableDirectory);
  const executableName = path.basename(executable);
  let layout: 'posix' | 'windows';
  if (parentName === 'bin' && supportedPosixExecutables.has(executableName)) layout = 'posix';
  else if (parentName.toLowerCase() === 'scripts' && executableName.toLowerCase() === 'python.exe') layout = 'windows';
  else fail('Selected CoACD Python must use a supported venv bin/python or Scripts/python.exe layout.');

  const lexicalVenvRoot = path.dirname(executableDirectory);
  const venvRoot = await fs.realpath(lexicalVenvRoot).catch(() => fail('Selected CoACD venv directory is missing.'));
  const rootStat = await fs.stat(venvRoot);
  if (!rootStat.isDirectory()) fail('Selected CoACD venv root is not a directory.');
  const canonicalExecutableDirectory = path.join(venvRoot, parentName);
  const executableDirectoryStat = await fs.lstat(canonicalExecutableDirectory).catch(() => fail('Selected CoACD venv executable directory is missing.'));
  const originalExecutableDirectory = await fs.realpath(executableDirectory).catch(() => fail('Selected CoACD venv executable directory is missing.'));
  if (!executableDirectoryStat.isDirectory() || executableDirectoryStat.isSymbolicLink()
    || !samePath(await fs.realpath(canonicalExecutableDirectory), canonicalExecutableDirectory)
    || !samePath(originalExecutableDirectory, canonicalExecutableDirectory)) {
    fail('Selected CoACD venv bin or Scripts directory must be canonical and contained in its environment.');
  }
  const configPath = path.join(venvRoot, 'pyvenv.cfg');
  const configBefore = await fs.lstat(configPath).catch(() => fail('Selected CoACD venv is missing pyvenv.cfg.'));
  if (!configBefore.isFile() || configBefore.isSymbolicLink() || configBefore.size > MAX_CONFIG_BYTES || configBefore.nlink > 1 || configBefore.dev !== rootStat.dev) {
    fail('Selected CoACD pyvenv.cfg must be a bounded regular file inside its venv.');
  }
  const configBytes = await readSmallStableFile(configPath, MAX_CONFIG_BYTES, rootStat.dev);
  parseVenvConfiguration(configBytes);
  const configDigest = await boundedFileSHA256(configPath, MAX_CONFIG_BYTES);
  if (createHash('sha256').update(configBytes).digest('hex') !== configDigest) fail('CoACD pyvenv.cfg changed while its identity was measured.');

  const roots = await packageRoots(venvRoot, layout, rootStat.dev);
  const entries: TreeEntry[] = [{ kind: 'file', path: 'pyvenv.cfg', mode: configBefore.mode & 0o7777, size: configBefore.size, sha256: configDigest }];
  let entryCount = 1;
  let totalBytes = configBefore.size;
  let listedNames = 0;
  const requiredDistutilsModules: string[] = [];

  const recordDirectory = async (absolute: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH) fail('CoACD package tree exceeds the 32-level depth limit.');
    const before = await fs.lstat(absolute);
    if (!before.isDirectory() || before.isSymbolicLink() || before.dev !== rootStat.dev) {
      fail('CoACD package tree contains a link, special entry, or external filesystem.');
    }
    const resolved = await fs.realpath(absolute);
    if (!isInside(venvRoot, resolved)) fail('CoACD package tree escapes its selected environment.');
    entryCount++;
    if (entryCount > MAX_ENTRIES) fail('CoACD package tree exceeds the 100,000 entry identity limit.');
    const relative = relativePath(venvRoot, absolute);
    entries.push({ kind: 'directory', path: relative, mode: before.mode & 0o7777, size: 0, sha256: '' });
    const names = await readNamesBounded(absolute, MAX_ENTRIES - listedNames);
    listedNames += names.length;
    for (const name of names) {
      const child = path.join(absolute, name);
      const stat = await fs.lstat(child);
      if (stat.isSymbolicLink() || stat.dev !== rootStat.dev) fail('CoACD package tree contains a symlink or external filesystem entry.');
      if (stat.isDirectory()) {
        await recordDirectory(child, depth + 1);
        continue;
      }
      if (!stat.isFile() || stat.nlink > 1) fail('CoACD package tree contains a special or externally linked file.');
      if (stat.size > MAX_FILE_BYTES) fail('A CoACD package file exceeds the 64 MiB identity limit.');
      if (name.toLowerCase().endsWith('.pth') && stat.size > 64 * 1024) fail('CoACD .pth metadata exceeds the 64 KiB inspection limit.');
      totalBytes += stat.size;
      if (totalBytes > MAX_TREE_BYTES) fail('CoACD venv exceeds the 512 MiB cumulative identity limit.');
      entryCount++;
      if (entryCount > MAX_ENTRIES) fail('CoACD package tree exceeds the 100,000 entry identity limit.');
      const digest = await boundedFileSHA256(child, MAX_FILE_BYTES);
      const after = await fs.lstat(child);
      if (!sameStat(stat, after)) fail('A CoACD package file changed while its identity was measured.');
      const relativeChild = relativePath(venvRoot, child);
      entries.push({ kind: 'file', path: relativeChild, mode: stat.mode & 0o7777, size: stat.size, sha256: digest });
      if (name.toLowerCase().endsWith('.pth') && await verifyPth(child, absolute, venvRoot, rootStat.dev, digest)) {
        requiredDistutilsModules.push(`${relativePath(venvRoot, absolute)}/_distutils_hack/__init__.py`);
      }
    }
    const namesAfter = await readNamesBounded(absolute, names.length);
    const after = await fs.lstat(absolute);
    if (names.length !== namesAfter.length || names.some((name, index) => name !== namesAfter[index]) || !sameStat(before, after)) {
      fail('CoACD package directory changed while its identity was measured.');
    }
  };

  for (const root of roots) await recordDirectory(root, 0);
  for (const modulePath of requiredDistutilsModules) {
    if (!entries.some(entry => entry.kind === 'file' && entry.path === modulePath)) {
      fail('The recognized setuptools .pth hook requires a contained _distutils_hack package.');
    }
  }
  if (totalBytes > MAX_TREE_BYTES) fail('CoACD venv exceeds the 512 MiB cumulative identity limit.');

  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const hash = createHash('sha256');
  hash.update('game_dev.coacd_venv_identity.v1\n');
  for (const entry of entries) {
    hash.update(JSON.stringify([entry.kind, entry.path, entry.mode, entry.size, entry.sha256]));
    hash.update('\n');
  }
  return hash.digest('hex');
}
