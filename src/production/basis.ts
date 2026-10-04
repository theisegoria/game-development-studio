import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { invalidState } from '../util/errors.js';
import { registerOwnedProcessTerminator } from '../util/process-lifecycle.js';
import { inspectToolSelection, toolSelectionMessages } from '../installation/tool-config.js';
export const BASIS_VERSION = '2.50';
export const BASIS_COMMIT = '9bebe16726b3a61c8c213eeee3b7cffb462ef34e';
export interface BasisIdentity { path: string; sha256: string; supportedVersion: string; upstreamCommit: string }
export type BasisRunner = (executable: string, args: readonly string[], cwd: string, timeoutMs: number) => Promise<{ stdout: string; stderr: string }>;
export async function hashBasisFile(file: string): Promise<string> { const hash = createHash('sha256'); for await (const chunk of createReadStream(file)) hash.update(chunk); return hash.digest('hex'); }
/** No process launch: dependency diagnosis remains free, local, and available without an encoder. */
export async function diagnoseTextureCompression(env: NodeJS.ProcessEnv = process.env) {
  const base = { schema: 'game_dev.basis_dependency.v1', supportedVersion: BASIS_VERSION, upstreamCommit: BASIS_COMMIT, processLaunched: false, versionChecked: false };
  const inspected = inspectToolSelection('basisu', env);
  if (!inspected.available || !inspected.identity) return { ...base, available: false as const, reason: toolSelectionMessages[inspected.code === 'not-configured' ? 'digest-required' : inspected.code], code: inspected.code };
  return { ...base, available: true as const, source: inspected.source, identity: { path: inspected.identity.resolvedPath, sha256: inspected.identity.sha256, supportedVersion: BASIS_VERSION, upstreamCommit: BASIS_COMMIT } satisfies BasisIdentity };
}
export async function requireBasis(env: NodeJS.ProcessEnv = process.env): Promise<BasisIdentity> { const diagnosis = await diagnoseTextureCompression(env); if (!diagnosis.available || !('identity' in diagnosis)) throw invalidState('reason' in diagnosis ? diagnosis.reason : 'Basis Universal unavailable'); return diagnosis.identity; }
/** Keep provider credentials, shell injections and user profiles out of the CPU encoder. */
export function basisChildEnvironment(executable: string, cwd: string, host: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { PATH: path.dirname(executable), HOME: cwd, USERPROFILE: cwd, TMP: cwd, TEMP: cwd, TMPDIR: cwd, OMP_NUM_THREADS: '1', OMP_THREAD_LIMIT: '1', OMP_DYNAMIC: 'FALSE' };
  for (const key of ['SystemRoot', 'WINDIR', 'LANG', 'LC_ALL']) if (host[key]) environment[key] = host[key];
  return environment;
}
export const runBasis: BasisRunner = async (executable, args, cwd, timeoutMs) => new Promise((resolve, reject) => {
  const selected = inspectToolSelection('basisu');
  if (selected.source !== 'none' && (!selected.available || selected.identity?.resolvedPath !== executable)) {
    reject(invalidState(toolSelectionMessages[selected.code === 'verified' ? 'moved' : selected.code])); return;
  }
  const child = spawn(executable, [...args], { cwd, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: basisChildEnvironment(executable, cwd) });
  let stdout = '', stderr = '', bytes = 0, failure: Error | undefined;
  const terminate = () => { child.kill('SIGKILL'); };
  const unregister = registerOwnedProcessTerminator(signal => { child.kill(signal); });
  const timer = setTimeout(() => { failure = invalidState('Basis CPU operation timed out.'); terminate(); }, timeoutMs);
  const collect = (chunk: Buffer, stream: 'stdout' | 'stderr') => {
    bytes += chunk.length;
    if (bytes > 2 * 1024 * 1024) { failure = invalidState('Basis process output exceeded 2 MiB.'); terminate(); return; }
    if (stream === 'stdout') stdout += chunk.toString('utf8'); else stderr += chunk.toString('utf8');
  };
  child.stdout.on('data', (chunk: Buffer) => collect(chunk, 'stdout')); child.stderr.on('data', (chunk: Buffer) => collect(chunk, 'stderr'));
  child.on('error', error => { clearTimeout(timer); unregister(); reject(error); });
  child.on('close', code => { clearTimeout(timer); unregister(); if (failure) reject(failure); else if (code !== 0) reject(invalidState(`Basis CPU operation exited ${code}: ${stderr.slice(-4000)}`)); else resolve({ stdout, stderr }); });
});
export async function verifyBasisVersion(identity: BasisIdentity, cwd: string, runner: BasisRunner = runBasis): Promise<void> {
  if (await hashBasisFile(identity.path) !== identity.sha256) throw invalidState('Encoder changed after dependency diagnosis.');
  const { stdout } = await runner(identity.path, ['-version'], cwd, 10_000);
  if (!/\bv?2\.50\b/.test(stdout)) throw invalidState(`Unsupported Basis Universal version; expected ${BASIS_VERSION}.`);
}
