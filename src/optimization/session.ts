import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { loadAdapter, planScenarioRun } from '../harness/adapter.js';
import { executeScenarioRun, verifyRunBundle } from '../harness/run-bundle.js';
import { summarizeRunPerformance, compareRunPerformance } from '../harness/performance.js';
import { compareRunVisuals } from '../harness/visual.js';
import { canonicalJson } from '../packages/format.js';
import { sha256, writeFileAtomic } from '../storage/filesystem.js';
import { invalidInput, invalidState } from '../util/errors.js';
import { allowedSource, candidateDiff, createCheckout, safeRelative, snapshotFiles, snapshotHash, type SourceFile } from './snapshot.js';
import { runCommand } from './process.js';

const commandSchema = z.object({ executable: z.string().min(1), arguments: z.array(z.string()).max(256).default([]), timeoutSeconds: z.number().int().min(1).max(3600).default(120) }).strict();
export const optimizationRequestSchema = z.object({
  scenarioId: z.string().min(1), parameters: z.record(z.unknown()).default({}),
  metric: z.string().min(1), unit: z.string().min(1), statistic: z.enum(['min', 'max', 'mean', 'median', 'p95', 'p99']).default('median'),
  direction: z.enum(['lower', 'higher']).default('lower'), target: z.number().finite(),
  maximumIterations: z.number().int().min(1).max(50).default(3),
  allowedPaths: z.array(z.string().min(1)).min(1).max(256), includeUntracked: z.array(z.string()).max(256).default([]),
  build: commandSchema, tests: z.array(commandSchema).min(1).max(32),
  visualThreshold: z.number().int().min(0).max(255).default(0), maximumChangedPixelRatio: z.number().min(0).max(1).default(0),
}).strict();
export type OptimizationRequest = z.infer<typeof optimizationRequestSchema>;
export interface OptimizationPlan {
  schema: 'game_dev.optimization_plan.v1'; project: string; baseline: string; baselineHash: string;
  sourceHash: string; files: SourceFile[]; adapterHash: string; request: OptimizationRequest; planHash: string;
}
export interface Attempt {
  number: number; status: 'running' | 'passed' | 'failed' | 'interrupted'; startedAt: string; completedAt?: string;
  patchHash?: string; patchPath?: string; paths?: string[]; runPath?: string; value?: number; targetMet?: boolean;
  comparisonPath?: string; error?: string;
}
export interface OptimizationSession {
  schema: 'game_dev.optimization_session.v1'; id: string; directory: string; checkout: string; baseCommit: string;
  plan: OptimizationPlan; status: 'active' | 'stopped' | 'exhausted' | 'met'; attempts: Attempt[];
  bestAttempt?: number; createdAt: string;
  evidenceCeiling: string;
}
export async function planOptimization(projectInput: string, baselineInput: string, input: unknown): Promise<OptimizationPlan> {
  const request = optimizationRequestSchema.parse(input);
  const project = await fs.realpath(projectInput);
  for (const allow of request.allowedPaths) {
    safeRelative(allow);
    if (['.git', '.game-dev', 'node_modules', 'build', 'dist'].includes(allow.split('/')[0]!)) throw invalidInput('optimization allowlist includes protected paths');
    const candidate = path.join(project, allow);
    const resolved = await fs.realpath(candidate);
    if (resolved !== candidate || (await fs.lstat(candidate)).isSymbolicLink()) throw invalidInput('allowlist must identify existing non-symlinked source');
  }
  for (const file of request.includeUntracked) if (!allowedSource(safeRelative(file), request.allowedPaths)) throw invalidInput('untracked source must be explicitly inside the allowlist');
  const baseline = await verifyRunBundle(baselineInput);
  if (baseline.manifest.status !== 'completed') throw invalidInput('baseline must be a successful sealed run');
  const adapter = await loadAdapter(project);
  if (adapter.manifestSha256 !== baseline.manifest.adapterManifestSha256 || request.scenarioId !== baseline.manifest.scenarioId) throw invalidInput('baseline adapter or scenario differs from current project');
  const originalRequest = JSON.parse(await fs.readFile(path.join(baseline.runPath, 'request.json'), 'utf8')) as unknown;
  if (canonicalJson(originalRequest) !== canonicalJson(request.parameters)) throw invalidInput('baseline parameters differ from optimization request');
  const summary = await summarizeRunPerformance(baseline.runPath);
  if (!summary.metrics.some((m) => m.metric === request.metric && m.unit === request.unit)) throw invalidInput('goal requires a raw-sample baseline metric and matching unit');
  const files = await snapshotFiles(project, request.includeUntracked);
  const fields = { schema: 'game_dev.optimization_plan.v1' as const, project, baseline: baseline.runPath, baselineHash: baseline.manifestSha256,
    sourceHash: snapshotHash(files), files, adapterHash: adapter.manifestSha256, request };
  return { ...fields, planHash: sha256(Buffer.from(canonicalJson(fields))) };
}
const statePath = (directory: string) => path.join(directory, 'session.json');
async function save(session: OptimizationSession): Promise<void> { await writeFileAtomic(statePath(session.directory), Buffer.from(canonicalJson(session))); }
export async function startOptimization(plan: OptimizationPlan, root: string, expectedPlanHash: string): Promise<OptimizationSession> {
  if (plan.planHash !== expectedPlanHash) throw invalidState('optimization plan changed; review the new plan');
  const id = `optimization_${randomUUID().replaceAll('-', '')}`;
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const directory = path.join(await fs.realpath(root), id);
  if (directory.startsWith(plan.project + path.sep)) throw invalidInput('optimization storage must be outside the source project');
  await fs.mkdir(directory, { mode: 0o700 });
  const checkout = path.join(directory, 'checkout');
  const baseCommit = await createCheckout(plan.project, checkout, plan.files);
  const session: OptimizationSession = { schema: 'game_dev.optimization_session.v1', id, directory, checkout, baseCommit, plan,
    status: 'active', attempts: [], createdAt: new Date().toISOString(),
    evidenceCeiling: 'Isolated source, tests, sealed captures, and deterministic limits support this candidate. This is not an agent security sandbox, causal proof, hardware attestation, or human visual approval.' };
  await save(session);
  return session;
}
export async function readOptimization(directoryInput: string): Promise<OptimizationSession> {
  const directory = await fs.realpath(directoryInput);
  const stat = await fs.lstat(statePath(directory));
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw invalidInput('invalid optimization session file');
  const session = JSON.parse(await fs.readFile(statePath(directory), 'utf8')) as OptimizationSession;
  if (session.schema !== 'game_dev.optimization_session.v1' || session.directory !== directory || session.checkout !== path.join(directory, 'checkout') || !Array.isArray(session.attempts)) throw invalidState('invalid optimization session identity');
  optimizationRequestSchema.parse(session.plan.request);
  const { planHash, ...fields } = session.plan;
  if (sha256(Buffer.from(canonicalJson(fields))) !== planHash) throw invalidState('optimization plan integrity failed');
  return session;
}
async function locked<T>(directory: string, action: (session: OptimizationSession) => Promise<T>): Promise<T> {
  const session = await readOptimization(directory);
  const lockPath = path.join(session.directory, 'session.lock');
  const lock = await fs.open(lockPath, 'wx', 0o600).catch(() => { throw invalidState('session is locked; inspect the owner and use explicit recovery after it has stopped'); });
  try { await lock.writeFile(JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })); return await action(session); }
  finally { await lock.close(); await fs.unlink(lockPath); }
}
/** Recovery never executes a candidate. A new evaluate invocation is always required. */
export async function recoverOptimization(directory: string): Promise<OptimizationSession> {
  const session = await readOptimization(directory);
  const lockPath = path.join(session.directory, 'session.lock');
  const bytes = await fs.readFile(lockPath, 'utf8').catch(() => undefined);
  if (bytes) {
    const owner = JSON.parse(bytes) as { pid: number };
    if (!Number.isSafeInteger(owner.pid) || owner.pid < 1) throw invalidState('cannot establish lock owner');
    try { process.kill(owner.pid, 0); throw invalidState('session owner is still running'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    if (await fs.readFile(lockPath, 'utf8') !== bytes) throw invalidState('lock changed during recovery');
    await fs.unlink(lockPath);
  }
  return locked(directory, async (current) => {
    for (const attempt of current.attempts) if (attempt.status === 'running') { attempt.status = 'interrupted'; attempt.error = 'Explicitly recovered after worker stopped'; }
    await save(current); return current;
  });
}
export async function evaluateOptimization(directory: string, authority: { allowGpu: boolean; allowPerformance: boolean; signal?: AbortSignal }, progress: (phase: string) => void = () => {}): Promise<OptimizationSession> {
  return locked(directory, async (session) => {
    if (session.status !== 'active' || session.attempts.length >= session.plan.request.maximumIterations) throw invalidState('optimization session is not active or its budget is exhausted');
    if (session.attempts.some((a) => a.status === 'running')) throw invalidState('interrupted attempt requires explicit recovery');
    const spec = session.plan.request;
    const baseline = await verifyRunBundle(session.plan.baseline);
    if (baseline.manifestSha256 !== session.plan.baselineHash) throw invalidState('baseline changed');
    const adapter = await loadAdapter(session.checkout);
    if (adapter.manifestSha256 !== session.plan.adapterHash) throw invalidState('candidate changed the bound adapter');
    const plan = await planScenarioRun({ adapter, scenarioId: spec.scenarioId, runsRoot: path.join(session.directory, 'runs'), parameters: spec.parameters });
    if (plan.requiredAuthorizations.includes('gpu') && !authority.allowGpu) throw invalidInput('fresh GPU authorization required');
    if (plan.requiredAuthorizations.includes('performance') && !authority.allowPerformance) throw invalidInput('fresh performance authorization required');
    const attempt: Attempt = { number: session.attempts.length + 1, status: 'running', startedAt: new Date().toISOString() };
    session.attempts.push(attempt);
    await save(session);
    try {
      progress('validate_patch');
      const diff = await candidateDiff(session.checkout, session.baseCommit, spec.allowedPaths);
      const hash = sha256(Buffer.from(diff.patch));
      if (session.attempts.some((a) => a !== attempt && a.patchHash === hash)) throw invalidInput('candidate patch was already evaluated');
      attempt.patchHash = hash; attempt.paths = diff.paths;
      attempt.patchPath = path.join(session.directory, `candidate-${attempt.number}.patch`);
      await fs.writeFile(attempt.patchPath, diff.patch, { flag: 'wx', mode: 0o600 });
      await save(session);
      for (const [index, command] of [spec.build, ...spec.tests].entries()) {
        progress(index === 0 ? 'build' : 'test');
        const output = await runCommand(command.executable, command.arguments, session.checkout, command.timeoutSeconds, authority.signal);
        await fs.writeFile(path.join(session.directory, `attempt-${attempt.number}-command-${index}.log`), output, { flag: 'wx', mode: 0o600 });
      }
      const afterBuild = await candidateDiff(session.checkout, session.baseCommit, spec.allowedPaths);
      if (afterBuild.patch !== diff.patch) throw invalidState('build or tests changed candidate source');
      progress('capture');
      const run = await executeScenarioRun({ adapter, plan, request: spec.parameters, confirm: true, ...authority });
      attempt.runPath = run.runPath;
      if (run.manifest.status !== 'completed') throw invalidState(`capture ${run.manifest.status}`);
      if ((await candidateDiff(session.checkout, session.baseCommit, spec.allowedPaths)).patch !== diff.patch) throw invalidState('capture changed candidate source');
      progress('compare');
      const performance = await compareRunPerformance(session.plan.baseline, run.runPath, spec.statistic);
      if (baseline.manifest.evidence.hardwarePerformanceEvidenceAdmitted && (!run.manifest.evidence.hardwarePerformanceEvidenceAdmitted || performance.comparability.unknown.includes('hardware'))) throw invalidState('hardware baseline requires matching admitted hardware evidence');
      if (performance.comparability.differences.length || performance.incompatibleGroups.length) throw invalidState('candidate measurement controls differ');
      const metric = performance.metrics.find((m) => m.metric === spec.metric && m.unit === spec.unit);
      if (!metric) throw invalidState('candidate is missing the required metric');
      attempt.value = metric.candidate;
      attempt.comparisonPath = path.join(session.directory, `comparison-${attempt.number}`);
      const visual = await compareRunVisuals({ baselineRunPath: session.plan.baseline, candidateRunPath: run.runPath, threshold: spec.visualThreshold, outputPath: attempt.comparisonPath });
      if (visual.unmatchedBaseline.length || visual.unmatchedCandidate.length || visual.pairs.some((p) => !p.comparable || p.changedPixelRatio === undefined || p.changedPixelRatio > spec.maximumChangedPixelRatio)) throw invalidState('candidate failed the visual acceptance limit');
      attempt.targetMet = spec.direction === 'lower' ? metric.candidate <= spec.target : metric.candidate >= spec.target;
      attempt.status = 'passed';
      if (attempt.targetMet) {
        const previous = session.attempts.find((a) => a.number === session.bestAttempt)?.value;
        if (previous === undefined || (spec.direction === 'lower' ? metric.candidate < previous : metric.candidate > previous)) session.bestAttempt = attempt.number;
        session.status = 'met';
      }
    } catch (error) { attempt.status = authority.signal?.aborted ? 'interrupted' : 'failed'; attempt.error = error instanceof Error ? error.message : String(error); }
    attempt.completedAt = new Date().toISOString();
    if (session.status === 'active' && session.attempts.length >= spec.maximumIterations) session.status = 'exhausted';
    await save(session); return session;
  });
}
export async function stopOptimization(directory: string): Promise<OptimizationSession> {
  return locked(directory, async (session) => { session.status = 'stopped'; await save(session); return session; });
}
export async function exportOptimization(directory: string, destination: string): Promise<Record<string, unknown>> {
  return locked(directory, async (session) => {
    const best = session.attempts.find((a) => a.number === session.bestAttempt && a.status === 'passed' && a.targetMet);
    if (!best?.patchPath || !best.patchHash) throw invalidState('no candidate has passed all acceptance gates');
    if (snapshotHash(await snapshotFiles(session.plan.project, session.plan.request.includeUntracked)) !== session.plan.sourceHash) throw invalidState('original source changed since the approved snapshot; rebase and revalidate before applying');
    const patch = await fs.readFile(best.patchPath);
    if (sha256(patch) !== best.patchHash) throw invalidState('candidate patch integrity failed');
    await fs.mkdir(destination, { mode: 0o700 });
    await fs.writeFile(path.join(destination, 'candidate.patch'), patch, { flag: 'wx' });
    await fs.writeFile(path.join(destination, 'review.json'), canonicalJson({ session, selected: best, applicationRequiresExplicitReview: true }), { flag: 'wx' });
    if (best.comparisonPath) await fs.cp(best.comparisonPath, path.join(destination, 'comparison'), { recursive: true, errorOnExist: true, force: false });
    return { schema: 'game_dev.optimization_export.v1', destination, patchSha256: best.patchHash, applicationRequiresExplicitReview: true };
  });
}
