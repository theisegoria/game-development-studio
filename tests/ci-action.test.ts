/**
 * The GitHub Action's gate, driven for real against a two-commit repository.
 *
 * The baseline is not a committed file: the gate checks the base commit out
 * into a temporary worktree and captures it on the same machine as the head.
 * These tests prove the three outcomes a pull request can see -- unchanged,
 * changed, and changed-but-reporting-only -- and that the worktree is gone
 * afterwards, since a leftover worktree is exactly the debris the gate must
 * not leave in someone's checkout.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { writeHarnessProject } from './helpers/harness-fixture.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const gate = path.join(repoRoot, 'action', 'run.mjs');
const cli = path.join(repoRoot, 'dist', 'cli.js');

let root: string;
let repository: string;
let temp: string;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim();
}

beforeAll(async () => {
  // The gate drives the built CLI exactly as the Action would.
  await fs.access(cli).catch(() => { throw new Error('run `npm run build` before this test'); });
});

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'ci-action-'));
  const project = await writeHarnessProject(root);
  repository = project.projectRoot;
  temp = path.join(root, 'runner-temp');
  await fs.mkdir(temp);
  await fs.copyFile(project.baselinePng, path.join(repository, 'frame.png'));
  await fs.writeFile(path.join(repository, 'request.json'), JSON.stringify({
    source: 'frame.png', objectIds: 'objects.png', frameTime: 12,
  }));
  git(['init', '-q', '-b', 'main']);
  git(['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'add', '.']);
  git(['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', 'base']);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function commitHead(changed: boolean): Promise<void> {
  const source = changed ? 'candidate.png' : 'baseline.png';
  await fs.copyFile(path.join(repository, source), path.join(repository, 'frame.png'));
  await fs.writeFile(path.join(repository, 'NOTE.txt'), changed ? 'changed' : 'unchanged');
  git(['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'add', '.']);
  git(['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', 'commit', '-q', '-m', 'head']);
}

function runGate(failOn = 'change') {
  const summary = path.join(temp, 'summary.md');
  const output = path.join(temp, 'output.txt');
  const environment = { ...process.env };
  delete environment.CI;
  const result = spawnSync(process.execPath, [gate], {
    encoding: 'utf8',
    env: {
      ...environment,
      GITHUB_WORKSPACE: repository,
      RUNNER_TEMP: temp,
      GITHUB_STEP_SUMMARY: summary,
      GITHUB_OUTPUT: output,
      GDS_CLI_OVERRIDE: cli,
      GDS_SCENARIO: 'capture',
      GDS_PROJECT: '.',
      GDS_REQUEST: 'request.json',
      GDS_BASE_REF: 'HEAD^',
      GDS_BASELINE_RUNS: '2',
      GDS_THRESHOLD: '0',
      GDS_FAIL_ON: failOn,
    },
  });
  return { result, summary, output };
}

describe('the pull-request visual gate', () => {
  it('passes when the head renders what the base rendered', async () => {
    await commitHead(false);
    const { result, summary, output } = runGate();

    expect(result.status, result.stderr).toBe(0);
    expect(await fs.readFile(output, 'utf8')).toContain('verdict=identical');
    const markdown = await fs.readFile(summary, 'utf8');
    expect(markdown).toContain('Visual regression gate: identical');
    expect(markdown).toContain('Noise floor');
  }, 120_000);

  it('fails with a summary when the head changes pixels beyond the noise floor', async () => {
    await commitHead(true);
    const { result, summary } = runGate();

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('::error title=Visual regression gate::');
    const markdown = await fs.readFile(summary, 'utf8');
    expect(markdown).toContain('Visual regression gate: changed');
    expect(markdown).toMatch(/\| `0:main:color:` \| [1-9]/);
    const report = JSON.parse(await fs.readFile(path.join(temp, 'gds-report', 'report.json'), 'utf8'));
    expect(report.verdict).toBe('changed');
    expect((await fs.readdir(path.join(temp, 'gds-report'))).some((name) => name.endsWith('.png'))).toBe(true);
  }, 120_000);

  it('only reports when told never to fail, and leaves no worktree behind', async () => {
    await commitHead(true);
    const { result, output } = runGate('never');

    expect(result.status, result.stderr).toBe(0);
    expect(await fs.readFile(output, 'utf8')).toContain('verdict=changed');
    expect(git(['worktree', 'list']).split('\n')).toHaveLength(1);
  }, 120_000);
});
