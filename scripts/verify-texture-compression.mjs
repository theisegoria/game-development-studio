#!/usr/bin/env node
/** Remote CPU opt-in; refuses missing configuration and fails if real tests skip. */
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_BASIS_REVIEW_CASES = [
  'encodes etc1s color plus UASTC normal/ORM and verifies Basis-decoded appearance review',
  'encodes uastc color plus UASTC normal/ORM and verifies Basis-decoded appearance review',
];

/** Reject a green Vitest process if a gated real codec case was skipped or vanished. */
export function assertRealBasisReport(tests) {
  if (!tests || tests.numTotalTests !== tests.numPassedTests || tests.numPendingTests !== 0 || tests.numFailedTests !== 0) {
    throw new Error('Real encoder/review tests did not all execute without skips.');
  }
  const assertions = (tests.testResults ?? []).flatMap(result => result.assertionResults ?? []);
  for (const title of REQUIRED_BASIS_REVIEW_CASES) {
    const matching = assertions.filter(assertion => assertion.title === title);
    if (matching.length !== 1 || matching[0].status !== 'passed') {
      throw new Error(`Required real Basis review case did not pass exactly once: ${title}`);
    }
  }
}

async function main() {
  const manifest = process.argv[2];
  if (!manifest) throw new Error('Usage: node scripts/verify-texture-compression.mjs /path/to/basis-cpu.json');
  const identity = JSON.parse(await fs.readFile(manifest, 'utf8'));
  if (identity.sourceCommit !== '9bebe16726b3a61c8c213eeee3b7cffb462ef34e' || identity.opencl !== false || !identity.path || !identity.sha256) throw new Error('Not the pinned CPU build manifest.');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'basis-cpu-check-')); const report = path.join(root, 'tests.json');
  try {
    const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', 'tests/texture-compression-cpu.test.ts', '--no-file-parallelism', '--reporter=default', '--reporter=json', `--outputFile.json=${report}`], { stdio: 'inherit', timeout: 10 * 60_000, env: { ...process.env, GAME_DEV_TEST_BASIS_CPU: '1', GAME_DEV_BASISU_PATH: identity.path, GAME_DEV_BASISU_SHA256: identity.sha256 } });
    // Keep the real assertions even when decoding fails before image artifacts exist.
    // Without the default reporter and saved JSON, cleanup concealed the only diagnosis.
    if (process.env.GDS_BASIS_REVIEW_EVIDENCE) {
      const stats = await fs.lstat(report).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
      if (stats) {
        if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 8 * 1024 * 1024) throw new Error('CPU test report is not a bounded regular JSON file.');
        await fs.mkdir(process.env.GDS_BASIS_REVIEW_EVIDENCE, { recursive: true });
        await fs.copyFile(report, path.join(process.env.GDS_BASIS_REVIEW_EVIDENCE, 'tests.json'));
      }
    }
    if (result.error || result.status !== 0) throw result.error ?? new Error(`CPU tests exited ${result.status}`);
    const tests = JSON.parse(await fs.readFile(report, 'utf8'));
    assertRealBasisReport(tests);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
