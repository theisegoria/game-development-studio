#!/usr/bin/env node
/**
 * The software-raster lane's one real promise, proven end to end.
 *
 * A CPU rasterizer cannot produce hardware evidence, and the harness refuses
 * to let it claim any. What it CAN do -- and what a hardware GPU cannot -- is
 * produce byte-identical output run after run, which turns a zero-threshold
 * visual comparison into a hard regression gate for CI.
 *
 * This script proves both halves through the shipped CLI, not the in-process
 * API: compile the C probe SDK and its example under the strictest flags the
 * project claims, capture the same scenario twice, and assert
 *
 *   - `visual compare --threshold 0` reports zero changed pixels and a mean
 *     absolute error of exactly 0 on every comparable pair;
 *   - `visual stability` calls the pair bit-deterministic;
 *   - `capture verify` shows the forced downgrade fired: rendererClass is
 *     software, the lane is flagged, no GPU or timing claim was admitted.
 *
 * It does not skip. No compiler is a failure, because a gate that quietly
 * passes when it cannot run is how a broken lane ships.
 */

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { URL, fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = path.join(repoRoot, 'dist', 'cli.js');
const sdkSource = path.join(repoRoot, 'probe', 'c', 'gdprobe.c');
const exampleSource = path.join(repoRoot, 'probe', 'examples', 'minimal', 'main.c');

function fail(message, detail) {
  process.stderr.write(`software-lane: ${message}\n`);
  if (detail !== undefined) process.stderr.write(`${JSON.stringify(detail, null, 2)}\n`);
  process.exit(1);
}

function gameDev(args, env) {
  const stdout = execFileSync(process.execPath, [cli, ...args, '--json'], {
    env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 16 * 1024 * 1024,
  });
  const envelope = JSON.parse(stdout);
  if (envelope.schema !== 'game_dev.result.v1' || envelope.ok !== true) {
    fail(`game-dev ${args.join(' ')} did not succeed`, envelope);
  }
  return envelope.data;
}

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'software-lane-'));
try {
  const projectRoot = path.join(root, 'engine');
  await fs.mkdir(path.join(projectRoot, '.game-dev'), { recursive: true });
  const assets = path.join(root, 'assets');
  await fs.mkdir(assets);
  const env = { ...process.env, ASSET_OUTPUT_DIR: assets };
  // A hosted runner is not target hardware and this lane never asks for
  // timing authority, so the CI refusal is irrelevant here; the gate must
  // behave identically on a laptop and on a runner.
  delete env.GAME_DEV_CI_HARDWARE_ATTESTED;

  try {
    execFileSync('cc', [
      '-std=c99', '-Wall', '-Wextra', '-Werror',
      sdkSource, exampleSource,
      '-o', path.join(projectRoot, 'engine'),
    ], { stdio: 'pipe' });
  } catch (error) {
    fail('the C probe SDK and example must compile under -std=c99 -Wall -Wextra -Werror', {
      cause: error instanceof Error ? error.message : String(error),
      stderr: error?.stderr?.toString?.(),
    });
  }

  await fs.writeFile(path.join(projectRoot, '.game-dev', 'adapter.json'), JSON.stringify({
    schema: 'game_dev.adapter.v1',
    id: 'probe_minimal',
    name: 'Probe SDK minimal example, software lane',
    version: '1.0.0',
    scenarios: [{
      id: 'capture',
      title: 'Capture one frame on the CPU',
      command: { executable: 'engine', arguments: ['{param.brightness}'], workingDirectory: '.' },
      timeoutSeconds: 30,
      capabilities: ['software-raster', 'project-write'],
      parameters: { brightness: { type: 'integer', required: false, default: 0, minimum: 0, maximum: 50 } },
      outputs: { format: 'game-dev-capture-v1', path: 'capture.json' },
    }],
  }, null, 2));

  const request = path.join(root, 'request.json');
  await fs.writeFile(request, JSON.stringify({ brightness: 0 }));
  const runs = [];
  for (let index = 0; index < 2; index += 1) {
    runs.push(gameDev(['scenario', 'run', 'capture', '--project', projectRoot, '--request', request, '--confirm'], env).runPath);
  }

  // Half one: the forced downgrade fired on a lane that declared itself.
  for (const runPath of runs) {
    const verified = gameDev(['capture', 'verify', runPath], env);
    const evidence = verified.run.evidence;
    const expected = {
      rendererClass: 'software',
      softwareRasterizedLane: true,
      adapterReportedGpuExecution: false,
      adapterReportedGpuCompletionIdentity: false,
      hardwarePerformanceEvidenceAdmitted: false,
      hardwareGpuExecutionProvenByHarnessAlone: false,
    };
    for (const [key, value] of Object.entries(expected)) {
      if (evidence[key] !== value) fail(`run evidence ${key} should be ${value}`, { runPath, evidence });
    }
  }

  // Half two: byte-identical output, through the same comparison a CI gate would use.
  const comparison = gameDev(['visual', 'compare', runs[0], runs[1], '--threshold', '0'], env);
  const comparable = comparison.pairs.filter((pair) => pair.comparable);
  if (comparable.length === 0) fail('the two runs share no comparable attachment', comparison);
  for (const pair of comparable) {
    if (pair.meanAbsoluteError !== 0 || pair.changedPixelRatio !== 0 || pair.maximumChannelDelta !== 0) {
      fail('the software lane must be bit-deterministic and was not', pair);
    }
  }
  const stability = gameDev(['visual', 'stability', runs[0], runs[1], '--output', path.join(root, 'stability')], env);
  if (stability.verdict !== 'bit-deterministic' || stability.stabilityScore !== 1) {
    fail('stability should call two identical software runs bit-deterministic', stability);
  }

  process.stdout.write(
    `software lane: ${comparable.length} attachment pair(s) byte-identical across 2 runs; ` +
    'rendererClass software, no GPU or timing claim admitted\n',
  );
} finally {
  await fs.rm(root, { recursive: true, force: true });
}
