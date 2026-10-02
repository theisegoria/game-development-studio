#!/usr/bin/env node
/** Explicit opt-in CPU builder for remote CI. Never invoked by npm install/test. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import path from 'node:path';
const COMMIT = '9bebe16726b3a61c8c213eeee3b7cffb462ef34e';
const output = process.argv[2];
if (!output || !path.isAbsolute(output)) throw new Error('Usage: node scripts/build-basis-cpu.mjs ABSOLUTE_NEW_DIRECTORY');
await fs.mkdir(output, { recursive: false });
const source = path.join(output, 'source'); const build = path.join(output, 'build');
await fs.mkdir(source);
function run(command, args, cwd = source) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false, timeout: 15 * 60_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', CMAKE_BUILD_PARALLEL_LEVEL: '2' } });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`${command} exited ${result.status}`);
}
run('git', ['init']); run('git', ['remote', 'add', 'origin', 'https://github.com/BinomialLLC/basis_universal.git']);
run('git', ['sparse-checkout', 'init', '--cone']);
run('git', ['sparse-checkout', 'set', 'encoder', 'transcoder', 'zstd', '.reuse', 'LICENSES']);
run('git', ['fetch', '--depth=1', '--filter=blob:none', 'origin', COMMIT]); run('git', ['checkout', '--detach', 'FETCH_HEAD']);
run('cmake', ['-S', source, '-B', build, '-DCMAKE_BUILD_TYPE=Release', '-DBASISU_OPENCL=OFF', '-DBASISU_EXAMPLES=OFF', '-DBASISU_SSE=OFF', '-DBASISU_BUILD_PYTHON=OFF']);
run('cmake', ['--build', build, '--config', 'Release', '--target', 'basisu', '--parallel', '2']);
const candidates = process.platform === 'win32' ? [path.join(source, 'bin', 'Release', 'basisu.exe'), path.join(source, 'bin', 'basisu.exe')] : [path.join(source, 'bin', 'basisu')];
let binary;
for (const candidate of candidates) { try { if ((await fs.stat(candidate)).isFile()) { binary = candidate; break; } } catch { /* Try the next platform output location. */ } }
if (!binary) throw new Error('CPU build completed without the expected basisu binary.');
const digest = createHash('sha256'); for await (const chunk of createReadStream(binary)) digest.update(chunk);
const sha256 = digest.digest('hex');
const version = spawnSync(binary, ['-version'], { encoding: 'utf8', timeout: 10_000, shell: false });
if (version.status !== 0 || !/\bv?2\.50\b/.test(version.stdout)) throw new Error('Built encoder has an unexpected version.');
const notices = path.join(output, 'notices'); await fs.mkdir(notices);
for (const name of ['LICENSE', 'NOTICE', 'LICENSES', '.reuse']) await fs.cp(path.join(source, name), path.join(notices, name), { recursive: true });
await fs.writeFile(path.join(output, 'basis-cpu.json'), `${JSON.stringify({ schema: 'game_dev.basis_build.v1', sourceCommit: COMMIT, version: '2.50', path: binary, sha256, cpuOnly: true, opencl: false, platform: process.platform, arch: process.arch, notices }, null, 2)}\n`);
console.log(JSON.stringify({ GAME_DEV_BASISU_PATH: binary, GAME_DEV_BASISU_SHA256: sha256 }));
