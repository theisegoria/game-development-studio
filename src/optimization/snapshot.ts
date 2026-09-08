import * as fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalJson } from '../packages/format.js';
import { sha256 } from '../storage/filesystem.js';
import { invalidInput, invalidState } from '../util/errors.js';
import { runCommand } from './process.js';

export interface SourceFile { path: string; sha256: string; executable: boolean }
export function safeRelative(value: string): string {
  if (!value || path.isAbsolute(value) || value.includes('\\') || value.split('/').some((p) => !p || p === '.' || p === '..') || value.includes('\0')) throw invalidInput('unsafe source path');
  return value;
}
export function allowedSource(value: string, allowlist: string[]): boolean {
  return allowlist.some((p) => value === p || value.startsWith(`${p}/`));
}
export async function regularSource(root: string, relative: string): Promise<string> {
  safeRelative(relative);
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw invalidInput('source symlinks are not admitted', { path: relative });
  }
  if (!(await fs.stat(current)).isFile()) throw invalidInput('source must be a regular file', { path: relative });
  return current;
}
export async function snapshotFiles(project: string, includeUntracked: string[]): Promise<SourceFile[]> {
  const tracked = (await runCommand('git', ['ls-files', '-z'], project)).split('\0').filter(Boolean);
  const names = [...new Set([...tracked, ...includeUntracked, '.game-dev/adapter.json'])].sort();
  const files: SourceFile[] = [];
  let total = 0;
  for (const name of names) {
    safeRelative(name);
    if (name === '.git' || name.startsWith('.git/')) throw invalidInput('repository metadata cannot be a source');
    const exists = await fs.lstat(path.join(project, name)).catch((e: NodeJS.ErrnoException) => { if (e.code === 'ENOENT') return undefined; throw e; });
    if (!exists && tracked.includes(name)) continue; // preserve tracked deletions
    const source = await regularSource(project, name);
    const stat = await fs.stat(source);
    total += stat.size;
    if (stat.size > 128 * 1024 * 1024 || total > 1024 * 1024 * 1024) throw invalidInput('source snapshot exceeds 128 MiB/file or 1 GiB total');
    files.push({ path: name, sha256: sha256(await fs.readFile(source)), executable: (stat.mode & 0o111) !== 0 });
  }
  return files;
}
export const snapshotHash = (files: SourceFile[]) => sha256(Buffer.from(canonicalJson(files)));
export async function createCheckout(project: string, checkout: string, files: SourceFile[]): Promise<string> {
  await fs.mkdir(checkout, { mode: 0o700 });
  for (const entry of files) {
    const source = await regularSource(project, entry.path);
    const bytes = await fs.readFile(source);
    if (sha256(bytes) !== entry.sha256) throw invalidState('source changed while creating snapshot');
    const destination = path.join(checkout, entry.path);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, bytes, { flag: 'wx', mode: entry.executable ? 0o700 : 0o600 });
  }
  await runCommand('git', ['init', '-q'], checkout);
  await runCommand('git', ['add', '-f', '--', '.'], checkout);
  await runCommand('git', ['-c', 'user.name=Game Development Studio', '-c', 'user.email=local@invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'Approved source snapshot'], checkout);
  return (await runCommand('git', ['rev-parse', 'HEAD'], checkout)).trim();
}
export async function candidateDiff(checkout: string, base: string, allowlist: string[]): Promise<{ patch: string; paths: string[] }> {
  // Stage candidate changes only inside the disposable checkout, including new files.
  await runCommand('git', ['add', '-A'], checkout);
  const paths = (await runCommand('git', ['diff', '--cached', '--name-only', '-z', base], checkout)).split('\0').filter(Boolean);
  if (!paths.length) throw invalidInput('candidate has no source changes');
  for (const name of paths) {
    safeRelative(name);
    if (!allowedSource(name, allowlist)) throw invalidInput('candidate changes a path outside the approved allowlist', { path: name });
    if (await fs.lstat(path.join(checkout, name)).catch(() => undefined)) await regularSource(checkout, name);
  }
  const patch = await runCommand('git', ['diff', '--cached', '--binary', '--no-ext-diff', base], checkout);
  return { patch, paths };
}
