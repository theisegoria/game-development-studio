/**
 * Which commit broke it?
 *
 * Given a commit where the scenario looked right and one where it does not,
 * binary-search the first-parent history between them. Every probe is a real
 * capture: the commit is checked out into its own temporary worktree, built
 * with the build script the repository's adapter declares, captured, and
 * sealed as an ordinary run, so each verdict can be re-examined afterwards.
 *
 * Two criteria, both judged against the GOOD commit's own capture on this
 * machine rather than a stored baseline:
 *
 *   - visual: the probe differs from the good capture beyond its noise floor
 *     (the good commit is captured twice to measure it);
 *   - metric: a named metric's statistic crosses a limit.
 *
 * A commit whose build fails or whose capture is incomparable is skipped, as
 * `git bisect skip` would, and the answer becomes a range instead of a
 * commit. Worktrees are always removed. Bisection assumes the problem appears
 * once and stays; a flaky problem gives a confident wrong answer, which is
 * why the good and bad ends are re-verified before any searching starts.
 */

import { execFile, spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { invalidInput, invalidState } from '../util/errors.js';
import { assertRegularUnsymbolic, loadAdapter, pathInside, planScenarioRun } from './adapter.js';
import { summarizeRunPerformance } from './performance.js';
import { executeScenarioRun } from './run-bundle.js';
import { measureRunStability } from './stability.js';
import { compareRunVisuals } from './visual.js';

const run = promisify(execFile);
const MAX_COMMITS = 1024;

export const GAME_DEV_BISECT_SCHEMA = 'game_dev.bisect.v1' as const;

export type BisectCriterion =
  | { kind: 'visual'; threshold?: number; antialiasTolerancePixels?: number }
  | { kind: 'metric'; metric: string; statistic?: 'min' | 'max' | 'mean' | 'median' | 'p95' | 'p99'; above?: number; below?: number };

export interface BisectPlan {
  schema: 'game_dev.bisect_plan.v1';
  repositoryRoot: string;
  projectRelative: string;
  scenarioId: string;
  parameters: Record<string, unknown>;
  criterion: BisectCriterion;
  good: { ref: string; commit: string };
  bad: { ref: string; commit: string };
  /** First-parent commits after good, oldest first, ending with bad. */
  commits: Array<{ commit: string; subject: string }>;
  /** Captures the search needs at most: both ends plus a binary search. */
  maximumCaptures: number;
  build?: { executable: string; arguments: string[]; workingDirectory: string; timeoutSeconds: number };
  requiredAuthorizations: Array<'confirm' | 'gpu' | 'performance'>;
}

export interface BisectStep {
  commit: string;
  subject: string;
  role: 'good-end' | 'bad-end' | 'probe';
  verdict: 'good' | 'bad' | 'skip';
  reason: string;
  runId?: string;
  runPath?: string;
}

export interface BisectResult {
  schema: typeof GAME_DEV_BISECT_SCHEMA;
  plan: BisectPlan;
  outcome: 'found' | 'range' | 'not-reproduced';
  firstBadCommit?: { commit: string; subject: string };
  lastGoodCommit?: { commit: string; subject: string };
  /** When skips leave more than one candidate, every commit that could be first. */
  candidates: Array<{ commit: string; subject: string }>;
  steps: BisectStep[];
  summary: string[];
  evidence: {
    everyProbeSealed: true;
    monotonicityAssumed: true;
    causalityEstablished: false;
  };
  evidenceCeiling: string;
}

function probeCount(steps: BisectStep[]): string {
  const count = steps.filter((step) => step.role === 'probe').length;
  return `${count} probe${count === 1 ? '' : 's'}`;
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', args, { cwd, maxBuffer: 16 * 1024 * 1024 });
  return stdout.trim();
}

function validateCriterion(criterion: BisectCriterion): BisectCriterion {
  if (criterion.kind === 'visual') {
    const threshold = criterion.threshold ?? 0;
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 255) throw invalidInput('criterion.threshold must be 0 to 255');
    return { kind: 'visual', threshold, antialiasTolerancePixels: criterion.antialiasTolerancePixels ?? 0 };
  }
  if (criterion.kind === 'metric') {
    if (typeof criterion.metric !== 'string' || criterion.metric.length === 0) throw invalidInput('criterion.metric is required');
    if ((criterion.above === undefined) === (criterion.below === undefined)) throw invalidInput('give exactly one of criterion.above or criterion.below');
    for (const limit of [criterion.above, criterion.below]) if (limit !== undefined && !Number.isFinite(limit)) throw invalidInput('criterion limit must be finite');
    return { ...criterion, statistic: criterion.statistic ?? 'median' };
  }
  throw invalidInput('criterion.kind must be visual or metric');
}

export async function planBisect(options: {
  projectRoot: string;
  good: string;
  bad: string;
  scenarioId: string;
  parameters?: Record<string, unknown>;
  criterion: BisectCriterion;
  runsRoot: string;
}): Promise<BisectPlan> {
  const criterion = validateCriterion(options.criterion);
  const projectRoot = await fs.realpath(path.resolve(options.projectRoot));
  const repositoryRoot = await fs.realpath(await git(projectRoot, ['rev-parse', '--show-toplevel']).catch(() => {
    throw invalidInput('the project is not inside a git repository', { projectRoot });
  }));
  const projectRelative = path.relative(repositoryRoot, projectRoot) || '.';
  // Refs are resolved to commits once, so a branch moving mid-bisect changes nothing.
  const resolve = async (ref: string) => {
    if (!/^[A-Za-z0-9._/@^~-]{1,200}$/.test(ref) || ref.startsWith('-')) throw invalidInput('not a plausible git ref', { ref });
    return git(repositoryRoot, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]).catch(() => {
      throw invalidInput('git ref does not name a commit', { ref });
    });
  };
  const good = await resolve(options.good);
  const bad = await resolve(options.bad);
  if (good === bad) throw invalidInput('good and bad name the same commit');
  await git(repositoryRoot, ['merge-base', '--is-ancestor', good, bad]).catch(() => {
    throw invalidInput('the good commit must be an ancestor of the bad commit');
  });
  const listed = await git(repositoryRoot, ['log', '--first-parent', '--reverse', '--format=%H%x09%s', `${good}..${bad}`]);
  const commits = listed.split('\n').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    return { commit: line.slice(0, tab), subject: line.slice(tab + 1).slice(0, 200) };
  });
  if (commits.length === 0 || commits.at(-1)?.commit !== bad) throw invalidState('bad is not on the first-parent line from good');
  if (commits.length > MAX_COMMITS) throw invalidInput('too many commits between good and bad; narrow the range', { commits: commits.length, maximum: MAX_COMMITS });

  // The scenario as the BAD commit's working tree declares it, for planning
  // and authority; each probe re-reads its own commit's adapter.
  const adapter = await loadAdapter(projectRoot);
  const plan = await planScenarioRun({
    adapter, scenarioId: options.scenarioId, runsRoot: options.runsRoot, parameters: options.parameters ?? {},
  });
  const visualRuns = criterion.kind === 'visual' ? 2 : 1;
  return {
    schema: 'game_dev.bisect_plan.v1',
    repositoryRoot,
    projectRelative,
    scenarioId: options.scenarioId,
    parameters: options.parameters ?? {},
    criterion,
    good: { ref: options.good, commit: good },
    bad: { ref: options.bad, commit: bad },
    commits,
    maximumCaptures: visualRuns + 1 + Math.ceil(Math.log2(Math.max(1, commits.length))),
    ...(adapter.manifest.build ? { build: adapter.manifest.build } : {}),
    requiredAuthorizations: plan.requiredAuthorizations,
  };
}

function buildEnvironment(): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'DEVELOPER_DIR', 'SDKROOT', 'TERM']) {
    if (process.env[name] !== undefined) environment[name] = process.env[name];
  }
  return environment;
}

async function runBuild(projectDir: string, build: NonNullable<BisectPlan['build']>): Promise<string | undefined> {
  const executable = path.resolve(projectDir, build.executable);
  if (!pathInside(projectDir, executable)) return 'build script escapes the project';
  try { await assertRegularUnsymbolic(executable, 'build script'); } catch { return 'build script is missing at this commit'; }
  const cwd = path.resolve(projectDir, build.workingDirectory);
  if (!pathInside(projectDir, cwd)) return 'build working directory escapes the project';
  return new Promise((resolve) => {
    const child = spawn(executable, build.arguments, { cwd, env: buildEnvironment(), shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => { if (stderr.length < 4000) stderr += chunk.toString('utf8'); });
    const timer = setTimeout(() => child.kill('SIGKILL'), build.timeoutSeconds * 1000);
    child.once('error', (error) => { clearTimeout(timer); resolve(`build could not start: ${error.message}`); });
    child.once('exit', (code, signal) => {
      clearTimeout(timer);
      resolve(code === 0 ? undefined : `build failed (${signal ?? `exit ${code}`}): ${stderr.trim().slice(-500)}`);
    });
  });
}

export async function runBisect(options: {
  plan: BisectPlan;
  runsRoot: string;
  workRoot: string;
  allowGpu: boolean;
}): Promise<BisectResult> {
  const { plan } = options;
  const steps: BisectStep[] = [];
  await fs.mkdir(options.workRoot, { recursive: true, mode: 0o700 });
  const worktreeRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'gds-bisect-'));
  const comparisonsRoot = await fs.mkdtemp(path.join(options.workRoot, 'bisect-'));
  let reference: string | undefined;
  let noiseFloorPath: string | undefined;

  const capture = async (commit: string, index: number): Promise<{ runPath?: string; skip?: string; runId?: string }> => {
    const worktree = path.join(worktreeRoot, `${index}-${commit.slice(0, 12)}`);
    await git(plan.repositoryRoot, ['worktree', 'add', '--detach', '--force', worktree, commit]);
    try {
      const projectDir = path.join(worktree, plan.projectRelative);
      const adapter = await loadAdapter(projectDir).catch(() => undefined);
      if (!adapter) return { skip: 'no adapter manifest at this commit' };
      // Each commit builds the way IT declares: a build script that changed
      // within the range is exactly the case a fixed command would get wrong.
      if (adapter.manifest.build) {
        const failure = await runBuild(adapter.projectRoot, adapter.manifest.build);
        if (failure) return { skip: failure };
      }
      const scenarioPlan = await planScenarioRun({
        adapter, scenarioId: plan.scenarioId, runsRoot: options.runsRoot, parameters: plan.parameters,
      }).catch((error: unknown) => error as Error);
      if (scenarioPlan instanceof Error) return { skip: `scenario cannot be planned at this commit: ${scenarioPlan.message}` };
      const result = await executeScenarioRun({
        adapter, plan: scenarioPlan, request: plan.parameters, confirm: true, allowGpu: options.allowGpu, allowPerformance: false,
      });
      if (result.manifest.status !== 'completed') return { skip: `capture ${result.manifest.status}`, runId: result.manifest.runId };
      return { runPath: result.runPath, runId: result.manifest.runId };
    } finally {
      await git(plan.repositoryRoot, ['worktree', 'remove', '--force', worktree]).catch(() => undefined);
    }
  };

  const judge = async (runPath: string): Promise<{ verdict: 'good' | 'bad' | 'skip'; reason: string }> => {
    const criterion = plan.criterion;
    if (criterion.kind === 'visual') {
      const comparison = await compareRunVisuals({
        baselineRunPath: reference!,
        candidateRunPath: runPath,
        threshold: criterion.threshold ?? 0,
        antialiasTolerancePixels: criterion.antialiasTolerancePixels ?? 0,
        ...(noiseFloorPath ? { noiseFloorPath } : {}),
        outputPath: path.join(comparisonsRoot, path.basename(runPath)),
      });
      if (comparison.verdict === 'incomparable') return { verdict: 'skip', reason: 'capture is not comparable with the good commit' };
      return comparison.verdict === 'changed'
        ? { verdict: 'bad', reason: (comparison.summary ?? [])[0] ?? 'pixels changed beyond the noise floor' }
        : { verdict: 'good', reason: `matches the good commit (${comparison.verdict})` };
    }
    const summary = await summarizeRunPerformance(runPath);
    const metric = summary.metrics.find((candidate) => candidate.metric === criterion.metric);
    if (!metric) return { verdict: 'skip', reason: `${criterion.metric} was not reported` };
    const value = metric[criterion.statistic ?? 'median'];
    const bad = criterion.above !== undefined ? value > criterion.above : value < (criterion.below as number);
    const limit = criterion.above !== undefined ? `> ${criterion.above}` : `< ${criterion.below}`;
    return { verdict: bad ? 'bad' : 'good', reason: `${criterion.metric} ${criterion.statistic ?? 'median'} ${value.toFixed(3)}${metric.unit} (bad when ${limit})` };
  };

  const finish = (partial: Omit<BisectResult, 'schema' | 'plan' | 'steps' | 'evidence' | 'evidenceCeiling'>): BisectResult => ({
    schema: GAME_DEV_BISECT_SCHEMA,
    plan,
    steps,
    ...partial,
    evidence: { everyProbeSealed: true, monotonicityAssumed: true, causalityEstablished: false },
    evidenceCeiling:
      'Bisection names the first commit at which this scenario, on this machine, met the criterion, assuming ' +
      'the problem appeared once and stayed. Every probe is a sealed run that can be re-examined. It locates a ' +
      'change; it does not prove that change is the cause, and a flaky scenario can mislead it.',
  });

  try {
    // Both ends first. A good end that already fails, or a bad end that does
    // not, means the search would return a confident answer to the wrong question.
    const goodCommit = { commit: plan.good.commit, subject: '(good end)' };
    const first = await capture(plan.good.commit, 0);
    if (!first.runPath) throw invalidState('the good commit could not be captured', { reason: first.skip });
    reference = first.runPath;
    if (plan.criterion.kind === 'visual') {
      const second = await capture(plan.good.commit, 1);
      if (!second.runPath) throw invalidState('the good commit could not be captured twice', { reason: second.skip });
      const stability = await measureRunStability({ runPaths: [first.runPath, second.runPath], outputPath: path.join(comparisonsRoot, 'noise-floor') });
      noiseFloorPath = stability.recordPath;
      steps.push({ ...goodCommit, role: 'good-end', verdict: 'good', reason: `reference capture; noise floor ${stability.verdict}`, runId: first.runId!, runPath: first.runPath });
    } else {
      const verdict = await judge(first.runPath);
      steps.push({ ...goodCommit, role: 'good-end', ...verdict, runId: first.runId!, runPath: first.runPath });
      if (verdict.verdict !== 'good') {
        return finish({ outcome: 'not-reproduced', candidates: [], summary: [`The good commit already meets the criterion: ${verdict.reason}. Pick an earlier good commit.`] });
      }
    }

    const commits = plan.commits;
    const lastIndex = commits.length - 1;
    const badEnd = await capture(plan.bad.commit, 2);
    const badVerdict = badEnd.runPath ? await judge(badEnd.runPath) : { verdict: 'skip' as const, reason: badEnd.skip ?? 'no capture' };
    steps.push({ ...commits[lastIndex]!, role: 'bad-end', ...badVerdict, ...(badEnd.runId ? { runId: badEnd.runId } : {}), ...(badEnd.runPath ? { runPath: badEnd.runPath } : {}) });
    if (badVerdict.verdict !== 'bad') {
      return finish({
        outcome: 'not-reproduced', candidates: [],
        summary: [`The bad commit does not reproduce the problem here (${badVerdict.reason}). Nothing to search.`],
      });
    }

    // Binary search over indices; lo is known good (-1 = the good end), hi known bad.
    let lo = -1;
    let hi = lastIndex;
    const skipped = new Set<number>();
    let probe = 3;
    while (hi - lo > 1) {
      const open = [];
      for (let index = lo + 1; index < hi; index += 1) if (!skipped.has(index)) open.push(index);
      if (open.length === 0) break;
      const mid = open[Math.floor((open.length - 1) / 2)]!;
      const entry = commits[mid]!;
      const result = await capture(entry.commit, probe);
      probe += 1;
      const verdict = result.runPath ? await judge(result.runPath) : { verdict: 'skip' as const, reason: result.skip ?? 'no capture' };
      steps.push({ ...entry, role: 'probe', ...verdict, ...(result.runId ? { runId: result.runId } : {}), ...(result.runPath ? { runPath: result.runPath } : {}) });
      if (verdict.verdict === 'good') lo = mid;
      else if (verdict.verdict === 'bad') hi = mid;
      else skipped.add(mid);
    }

    const candidates = commits.slice(lo + 1, hi + 1);
    const lastGood = lo >= 0 ? commits[lo]! : { commit: plan.good.commit, subject: '(good end)' };
    const firstBad = commits[hi]!;
    const exact = candidates.length === 1;
    const summary = exact
      ? [
        `First bad commit: ${firstBad.commit.slice(0, 12)} "${firstBad.subject}", found with ${probeCount(steps)} over ${commits.length} commit${commits.length === 1 ? '' : 's'}.`,
        `It is the first commit at which: ${steps.find((step) => step.commit === firstBad.commit)?.reason ?? 'the criterion was met'}.`,
      ]
      : [
        `The first bad commit is one of ${candidates.length}: skipped commits (failed builds or incomparable captures) hide the exact one.`,
        ...candidates.slice(0, 5).map((candidate) => `  ${candidate.commit.slice(0, 12)} ${candidate.subject}`),
      ];
    return finish({
      outcome: exact ? 'found' : 'range',
      ...(exact ? { firstBadCommit: firstBad } : {}),
      lastGoodCommit: lastGood,
      candidates,
      summary,
    });
  } finally {
    await git(plan.repositoryRoot, ['worktree', 'prune']).catch(() => undefined);
    await fs.rm(worktreeRoot, { recursive: true, force: true });
  }
}
