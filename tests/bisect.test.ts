/**
 * Bisection against a real git history with planted breaks: one commit
 * changes the picture, a later one slows the frame. Each probe is built with
 * the repository's own build script in its own worktree and captured as a
 * sealed run. The tests check that the right commit is named, that a build
 * failing at one commit turns the answer into an honest range, that ends
 * which do not reproduce stop the search, and that no worktree is left.
 */

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GAME_DEV_ADAPTER_SCHEMA } from '../src/harness/contracts.js';
import { planBisect, runBisect } from '../src/harness/bisect.js';
import { verifyRunBundle } from '../src/harness/run-bundle.js';
import { canonicalJson } from '../src/packages/format.js';
import { writeHarnessProject } from './helpers/harness-fixture.js';

let root: string;
let repo: string;

function git(...args: string[]): string {
  return execFileSync('git', ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', ...args], { cwd: repo, encoding: 'utf8' }).trim();
}

async function commit(message: string, files: Record<string, string>): Promise<string> {
  for (const [name, content] of Object.entries(files)) {
    await fs.writeFile(path.join(repo, name), content);
    if (name.endsWith('.sh')) await fs.chmod(path.join(repo, name), 0o755);
  }
  git('add', '.');
  git('commit', '-q', '-m', message);
  return git('rev-parse', 'HEAD');
}

const BUILD_OK = '#!/bin/sh\necho built > built.txt\n';
const BUILD_BROKEN = '#!/bin/sh\necho "error: missing semicolon" >&2\nexit 1\n';

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'bisect-'));
  const fixture = await writeHarnessProject(root);
  repo = path.join(root, 'repo');
  await fs.mkdir(path.join(repo, '.game-dev'), { recursive: true });
  for (const name of ['baseline.png', 'candidate.png', 'objects.png']) {
    await fs.copyFile(path.join(fixture.projectRoot, name), path.join(repo, name));
  }
  // The engine refuses to run unless the build ran in THIS checkout.
  await fs.writeFile(path.join(repo, 'engine.mjs'), `#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
await fs.access('built.txt');
const config = JSON.parse(await fs.readFile('config.json', 'utf8'));
const runDir = process.env.GAME_DEV_RUN_DIR;
const runId = process.env.GAME_DEV_RUN_ID;
await fs.mkdir(path.join(runDir, 'f'));
await fs.copyFile(config.frame, path.join(runDir, 'f', 'color.png'));
await fs.copyFile('objects.png', path.join(runDir, 'f', 'ids.png'));
await fs.writeFile(path.join(runDir, 't.jsonl'), JSON.stringify({ schema: 'game_dev.telemetry_event.v1', runId, sequence: 0,
  timestampNs: '1', category: 'performance', name: 'frame_time', frameIndex: 0, value: config.frameTime, unit: 'ms', attributes: {} }) + '\\n');
await fs.writeFile(path.join(runDir, 'capture.json'), JSON.stringify({
  schema: 'game_dev.capture.v1', runId, adapterId: process.env.GAME_DEV_ADAPTER_ID, scenarioId: process.env.GAME_DEV_SCENARIO_ID,
  sourceFormat: 'game-dev-capture-v1', frames: [{ index: 0, label: 'main', attachments: [
    { kind: 'color', path: 'f/color.png', encoding: 'png' }, { kind: 'object_id', path: 'f/ids.png', encoding: 'png' } ] }],
  telemetry: ['t.jsonl'], profiles: [], measurements: [],
  adapterEvidence: { windowless: true, graphicsApi: 'fixture', gpuExecutionReported: false, gpuCompletionIdentityReported: false,
    hardwarePerformanceReported: false, pixelVisualInspectionPerformed: false, notes: ['bisect fixture'] },
}));
`);
  await fs.chmod(path.join(repo, 'engine.mjs'), 0o755);
  await fs.writeFile(path.join(repo, '.game-dev', 'adapter.json'), canonicalJson({
    schema: GAME_DEV_ADAPTER_SCHEMA,
    id: 'bisect-fixture',
    name: 'Bisect fixture',
    version: '1.0.0',
    build: { executable: 'build.sh', arguments: [], workingDirectory: '.', timeoutSeconds: 30 },
    scenarios: [{
      id: 'capture', title: 'One frame', command: { executable: 'engine.mjs', arguments: [], workingDirectory: '.' },
      timeoutSeconds: 30, capabilities: ['cpu', 'project-write'], parameters: {},
      outputs: { format: 'game-dev-capture-v1', path: 'capture.json' },
    }],
  }));
  await fs.writeFile(path.join(repo, '.gitignore'), 'built.txt\n');
  git('init', '-q', '-b', 'main');
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const ok = (frame: string, frameTime: number) => JSON.stringify({ frame, frameTime });

async function bisect(good: string, bad: string, criterion: Parameters<typeof planBisect>[0]['criterion']) {
  const plan = await planBisect({ projectRoot: repo, good, bad, scenarioId: 'capture', criterion, runsRoot: path.join(root, 'runs') });
  return runBisect({ plan, runsRoot: path.join(root, 'runs'), workRoot: path.join(root, 'work'), allowGpu: false });
}

describe('bisecting a planted regression', () => {
  let commits: string[];

  beforeEach(async () => {
    commits = [
      await commit('initial engine', { 'build.sh': BUILD_OK, 'config.json': ok('baseline.png', 12) }),
      await commit('tidy logging', { 'NOTES.md': 'a' }),
      await commit('refactor input', { 'NOTES.md': 'b' }),
      await commit('switch tonemapper', { 'config.json': ok('candidate.png', 12) }),
      await commit('add particle pass', { 'config.json': ok('candidate.png', 30) }),
      await commit('docs', { 'NOTES.md': 'c' }),
    ];
  });

  it('names the commit that changed the picture, and every probe is a sealed run', async () => {
    const result = await bisect(commits[0]!, commits[5]!, { kind: 'visual', threshold: 0 });

    expect(result.outcome).toBe('found');
    expect(result.firstBadCommit).toEqual({ commit: commits[3], subject: 'switch tonemapper' });
    expect(result.lastGoodCommit?.commit).toBe(commits[2]);
    expect(result.summary[0]).toContain('switch tonemapper');
    for (const step of result.steps.filter((candidate) => candidate.runPath)) {
      await expect(verifyRunBundle(step.runPath!)).resolves.toBeDefined();
    }
    expect(result.steps.length).toBeLessThanOrEqual(result.plan.maximumCaptures);
    expect(git('worktree', 'list').split('\n')).toHaveLength(1);
  }, 180_000);

  it('names the commit that slowed the frame', async () => {
    const result = await bisect(commits[0]!, commits[5]!, { kind: 'metric', metric: 'performance.frame_time', above: 20 });

    expect(result.outcome).toBe('found');
    expect(result.firstBadCommit?.subject).toBe('add particle pass');
    expect(result.steps.find((step) => step.commit === commits[4])?.reason).toContain('30.000ms');
  }, 180_000);

  it('stops when the bad end does not reproduce', async () => {
    const result = await bisect(commits[0]!, commits[2]!, { kind: 'visual', threshold: 0 });
    expect(result.outcome).toBe('not-reproduced');
    expect(result.firstBadCommit).toBeUndefined();
  }, 180_000);

  it('refuses refs that could be read as options or are out of order', async () => {
    await expect(bisect('--output=x', commits[5]!, { kind: 'visual' })).rejects.toThrow(/plausible git ref/);
    await expect(bisect(commits[5]!, commits[0]!, { kind: 'visual' })).rejects.toThrow(/ancestor/);
  });
});

describe('a build that fails part-way through the range', () => {
  it('skips that commit and reports an honest range instead of guessing', async () => {
    const good = await commit('initial engine', { 'build.sh': BUILD_OK, 'config.json': ok('baseline.png', 12) });
    await commit('tidy logging', { 'NOTES.md': 'a' });
    await commit('half-finished refactor', { 'build.sh': BUILD_BROKEN });
    await commit('finish refactor, switch tonemapper', { 'build.sh': BUILD_OK, 'config.json': ok('candidate.png', 12) });
    const bad = await commit('docs', { 'NOTES.md': 'b' });

    const result = await bisect(good, bad, { kind: 'visual', threshold: 0 });

    expect(result.outcome).toBe('range');
    expect(result.candidates.map((candidate) => candidate.subject)).toEqual(['half-finished refactor', 'finish refactor, switch tonemapper']);
    expect(result.steps.find((step) => step.subject === 'half-finished refactor')).toMatchObject({ verdict: 'skip' });
    expect(result.steps.find((step) => step.subject === 'half-finished refactor')?.reason).toContain('missing semicolon');
  }, 180_000);
});
