#!/usr/bin/env node
/** Remote CPU opt-in; refuses missing configuration and fails if real tests skip. */
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const manifest = process.argv[2];
if (!manifest) throw new Error('Usage: node scripts/verify-texture-compression.mjs /path/to/basis-cpu.json');
const identity = JSON.parse(await fs.readFile(manifest, 'utf8'));
if (identity.sourceCommit !== '9bebe16726b3a61c8c213eeee3b7cffb462ef34e' || identity.opencl !== false || !identity.path || !identity.sha256) throw new Error('Not the pinned CPU build manifest.');
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'basis-cpu-check-')); const report = path.join(root, 'tests.json');
try {
  const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/texture-compression-cpu.test.ts', '--no-file-parallelism', '--reporter=json', `--outputFile=${report}`], { stdio: 'inherit', timeout: 10 * 60_000, env: { ...process.env, GAME_DEV_TEST_BASIS_CPU: '1', GAME_DEV_BASISU_PATH: identity.path, GAME_DEV_BASISU_SHA256: identity.sha256 } });
  if (result.error || result.status !== 0) throw result.error ?? new Error(`CPU tests exited ${result.status}`);
  const tests = JSON.parse(await fs.readFile(report, 'utf8'));
  if (tests.numPassedTests < 2 || tests.numPendingTests !== 0 || tests.numFailedTests !== 0) throw new Error('Real encoder tests did not all execute.');
} finally { await fs.rm(root, { recursive: true, force: true }); }
