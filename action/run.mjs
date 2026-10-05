#!/usr/bin/env node
/**
 * The visual regression gate behind action.yml.
 *
 * Baselines are not committed files. The base commit is checked out into a
 * temporary worktree and captured on the SAME runner as the head, so the two
 * differ only by the code under review. Capturing the base twice or more
 * measures a per-pixel noise floor, and the comparison counts a pixel as
 * changed only when it moved by more than the threshold AND more than it
 * moved between identical base runs. On the software-raster lane that floor
 * is usually zero and the gate is exact.
 *
 * Everything the job reports comes from the CLI's own JSON: verdict, the
 * narrator's sentences, per-attachment numbers, heatmaps. Nothing here
 * re-derives a metric.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const env = process.env;
const cli = env.GDS_CLI_OVERRIDE || env.GDS_CLI;
const workspace = path.resolve(env.GITHUB_WORKSPACE || process.cwd());
const temp = path.resolve(env.RUNNER_TEMP || path.join(workspace, '..'));
const scenario = env.GDS_SCENARIO;
const projectRelative = env.GDS_PROJECT || '.';
const request = env.GDS_REQUEST || '';
const build = env.GDS_BUILD || '';
const baselineRuns = Number(env.GDS_BASELINE_RUNS || '2');
const threshold = env.GDS_THRESHOLD || '0';
const failOn = env.GDS_FAIL_ON || 'change';
const allowGpu = env.GDS_ALLOW_GPU === 'true';

function fail(message) {
  process.stderr.write(`::error title=Visual regression gate::${message}\n`);
  process.exit(1);
}

if (!cli || !existsSync(cli)) fail('no game-dev CLI found; the install step did not run or cli was wrong');
if (!scenario) fail('the scenario input is required');
if (!Number.isInteger(baselineRuns) || baselineRuns < 1 || baselineRuns > 8) fail('baseline-runs must be 1 to 8');
if (!['change', 'never'].includes(failOn)) fail('fail-on must be change or never');
if (!/^\d{1,3}$/.test(threshold) || Number(threshold) > 255) fail('threshold must be 0 to 255');

const reportDir = path.join(temp, 'gds-report');
const assets = path.join(temp, 'gds-assets');
const baseTree = path.join(temp, 'gds-base');
mkdirSync(reportDir, { recursive: true });
mkdirSync(assets, { recursive: true });
const cliEnv = { ...env, ASSET_OUTPUT_DIR: assets };
// The gate never asks for timing authority, so the CI refusal of it is moot;
// it is cleared anyway so a runner that sets it differently behaves the same.
delete cliEnv.GAME_DEV_CI_HARDWARE_ATTESTED;

function git(args, cwd = workspace) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gameDev(args) {
  const result = spawnSync(process.execPath, [cli, ...args, '--json'], {
    env: cliEnv, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  let envelope;
  try {
    envelope = JSON.parse(result.stdout);
  } catch {
    fail(`game-dev ${args.slice(0, 2).join(' ')} produced no JSON result: ${result.stderr.slice(0, 2000)}`);
  }
  if (envelope.ok !== true) {
    const message = envelope.error?.message ?? envelope.error?.run?.failure?.message ?? 'unknown failure';
    fail(`game-dev ${args.slice(0, 2).join(' ')} failed: ${message}`);
  }
  return envelope.data;
}

function runBuild(projectRoot) {
  if (!build) return;
  process.stdout.write(`::group::build in ${projectRoot}\n`);
  const result = spawnSync('bash', ['-euo', 'pipefail', '-c', build], { cwd: projectRoot, stdio: 'inherit', env });
  process.stdout.write('::endgroup::\n');
  if (result.status !== 0) fail(`build command failed in ${projectRoot}`);
}

function capture(projectRoot) {
  const args = ['scenario', 'run', scenario, '--project', projectRoot, '--confirm'];
  if (request) args.push('--request', path.resolve(projectRoot, request));
  if (allowGpu) args.push('--allow-gpu');
  return gameDev(args).runPath;
}

// ------------------------------------------------------------- base commit
let baseRef = env.GDS_BASE_REF || '';
if (!baseRef) {
  try { baseRef = git(['rev-parse', 'HEAD^']); } catch { fail('no base-ref given and HEAD has no parent'); }
}
// A shallow checkout may not hold the base commit yet.
spawnSync('git', ['fetch', '--no-tags', '--depth=1', 'origin', baseRef], { cwd: workspace, stdio: 'ignore' });
const baseSha = git(['rev-parse', `${baseRef}^{commit}`]);
const headSha = git(['rev-parse', 'HEAD']);

let comparison;
let stability;
let performance;
let baseRunsPaths = [];
let headRun;
try {
  git(['worktree', 'add', '--detach', '--force', baseTree, baseSha]);
  const baseProject = path.join(baseTree, projectRelative);
  const headProject = path.join(workspace, projectRelative);
  if (!existsSync(path.join(baseProject, '.game-dev', 'adapter.json'))) {
    fail(`the base commit ${baseSha.slice(0, 12)} has no .game-dev/adapter.json under ${projectRelative}; add the adapter in an earlier commit before gating on it`);
  }

  runBuild(baseProject);
  for (let index = 0; index < baselineRuns; index += 1) baseRunsPaths.push(capture(baseProject));
  runBuild(headProject);
  headRun = capture(headProject);

  const compareArgs = ['visual', 'compare', baseRunsPaths[0], headRun, '--threshold', threshold, '--output', path.join(reportDir, 'comparison')];
  if (baseRunsPaths.length >= 2) {
    stability = gameDev(['visual', 'stability', ...baseRunsPaths, '--output', path.join(reportDir, 'stability')]);
    compareArgs.push('--noise-floor', stability.recordPath);
  }
  comparison = gameDev(compareArgs);
  try {
    performance = gameDev(['performance', 'compare', baseRunsPaths[0], headRun]);
  } catch {
    performance = undefined;
  }
} finally {
  spawnSync('git', ['worktree', 'remove', '--force', baseTree], { cwd: workspace, stdio: 'ignore' });
  spawnSync('git', ['worktree', 'prune'], { cwd: workspace, stdio: 'ignore' });
}

// ------------------------------------------------------------------ report
const percent = (ratio) => (ratio === undefined ? 'n/a' : `${(ratio * 100).toFixed(2)}%`);
const lines = [];
const icon = { identical: '✅', 'within-tolerance': '✅', changed: '❌', incomparable: '⚠️' }[comparison.verdict] ?? '⚠️';
lines.push(`## ${icon} Visual regression gate: ${comparison.verdict}`);
lines.push('');
lines.push(`Scenario \`${scenario}\` · base \`${baseSha.slice(0, 12)}\` (${baseRunsPaths.length} run${baseRunsPaths.length === 1 ? '' : 's'}) · head \`${headSha.slice(0, 12)}\` · threshold ${threshold}`);
lines.push('');
for (const sentence of comparison.summary ?? []) lines.push(`- ${sentence}`);
if (stability) {
  lines.push('');
  lines.push(`**Noise floor** (${stability.verdict}): ${(stability.summary ?? [])[0] ?? ''}`);
} else {
  lines.push('');
  lines.push('_One base capture: no noise floor was measured, so any renderer jitter counts as change. Set `baseline-runs: 2` or more._');
}
lines.push('');
lines.push('| attachment | changed pixels | mean abs. error | SSIM |');
lines.push('| --- | ---: | ---: | ---: |');
for (const pair of comparison.pairs ?? []) {
  lines.push(`| \`${pair.identity}\` | ${percent(pair.changedPixelRatio)} | ${pair.meanAbsoluteError?.toFixed(3) ?? 'n/a'} | ${pair.meanSSIM?.toFixed(4) ?? 'n/a'} |`);
}
for (const name of comparison.unmatchedBaseline ?? []) lines.push(`| \`${name}\` | only in base | | |`);
for (const name of comparison.unmatchedCandidate ?? []) lines.push(`| \`${name}\` | only in head | | |`);
if (performance?.summary?.length) {
  lines.push('');
  lines.push('<details><summary>Performance (informational: hosted runners are not target hardware)</summary>');
  lines.push('');
  for (const sentence of performance.summary) lines.push(`- ${sentence}`);
  lines.push('');
  lines.push('</details>');
}
lines.push('');
lines.push(`Heatmaps and the full JSON are in \`${reportDir}\`; upload it with \`actions/upload-artifact\` to keep them.`);

// Heatmaps are already in reportDir/comparison; keep the top level tidy.
const heatmaps = existsSync(path.join(reportDir, 'comparison'))
  ? readdirSync(path.join(reportDir, 'comparison')).filter((name) => name.endsWith('.png'))
  : [];
for (const name of heatmaps) copyFileSync(path.join(reportDir, 'comparison', name), path.join(reportDir, name));

const markdown = `${lines.join('\n')}\n`;
writeFileSync(path.join(reportDir, 'report.md'), markdown);
writeFileSync(path.join(reportDir, 'report.json'), `${JSON.stringify({
  schema: 'game_dev.ci_gate_report.v1', scenario, baseSha, headSha, verdict: comparison.verdict,
  comparison, stability, performance, baseRuns: baseRunsPaths, headRun,
}, null, 2)}\n`);
if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, markdown);
if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `verdict=${comparison.verdict}\nreport-dir=${reportDir}\n`);
process.stdout.write(markdown);

const blocking = comparison.verdict === 'changed' || comparison.verdict === 'incomparable';
if (failOn === 'change' && blocking) {
  fail(`head differs from base beyond the measured noise (${comparison.verdict}); see the job summary`);
}
