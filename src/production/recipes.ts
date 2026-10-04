import { hostname } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { invalidInput, invalidState } from '../util/errors.js';
import type { ToolResult } from '../tools/context.js';
import { resultText } from '../tools/context.js';

export const operations = ['generate_asset_reference', 'create_3d_asset', 'texture_existing_asset', 'download_asset', 'get_asset_job', 'select_reference', 'inspect_asset', 'create_asset_review', 'decide_asset_review', 'package_reviewed_asset', 'normalize_mesh', 'validate_game_asset', 'build_asset_package', 'prepare_collision_box', 'decompose_collision_mesh', 'validate_platform_asset', 'prepare_texture_variant', 'compress_texture_variant'] as const;
export const paidOperations = new Set<string>(['generate_asset_reference', 'create_3d_asset', 'texture_existing_asset']);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
export const stepSchema = z.object({ id, operation: z.enum(operations), dependsOn: z.array(id).max(64).default([]), arguments: z.record(z.unknown()), files: z.array(z.string().min(1)).max(128).default([]), reviewBinding: z.object({ stepId: id, fingerprint: sha256 }).strict().optional() }).strict();
export const recipeSchema = z.object({ schema: z.literal('game_dev.production_recipe.v1'), id, name: z.string().min(1).max(200), steps: z.array(stepSchema).min(1).max(128), family: z.object({ id, member: id, sample: z.boolean(), approvalDigest: z.string().optional() }).optional() }).strict();
export type Recipe = z.infer<typeof recipeSchema>;
const artifactSchema = z.object({ path: z.string().min(1), digest: sha256 }).strict();
const checkpointSchema = z.object({ fingerprint: sha256, state: z.enum(['running', 'complete', 'failed', 'uncertain']), result: z.record(z.unknown()).optional(), artifacts: z.array(artifactSchema).default([]), message: z.string().optional() }).strict();
const recordSchema = z.object({ schema: z.literal('game_dev.recipe_record.v1'), recipe: recipeSchema, revision: z.number().int().nonnegative(), checkpoints: z.record(checkpointSchema) }).strict();
type RecordState = z.infer<typeof recordSchema>;
export type RecipeStepState = 'completed' | 'ready' | 'blocked' | 'invalidated' | 'uncertain';
export interface RecipePlanStep {
  id: string;
  operation: string;
  dependsOn: string[];
  /** Retained v1 transport status. Use state for guided presentation. */
  status: 'complete' | 'ready' | 'blocked' | 'invalid' | 'uncertain';
  state: RecipeStepState;
  fingerprint?: string;
  /** Exact completed review result and artifacts, separate from execution input approval. */
  reviewedFingerprint?: string;
  arguments?: Record<string, unknown>;
  issue?: string;
  reasons: string[];
  paid: boolean;
  previousState?: string;
  evidence: {
    verified: boolean;
    checkpointFingerprint?: string;
    artifacts: Array<z.infer<typeof artifactSchema> & { verified: boolean }>;
    result?: Record<string, unknown>;
    message?: string;
  };
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function digest(value: unknown): string { return createHash('sha256').update(canonical(value)).digest('hex'); }
export async function fileDigest(file: string): Promise<string> {
  const info = await fs.lstat(file);
  if (info.isSymbolicLink()) throw invalidState(`Symbolic links are not accepted as recipe evidence: ${file}`);
  if (info.isDirectory()) {
    const entries = (await fs.readdir(file)).sort();
    return digest(await Promise.all(entries.map(async name => ({ name, digest: await fileDigest(path.join(file, name)) }))));
  }
  if (!info.isFile()) throw invalidState(`Recipe evidence must be a regular file or directory: ${file}`);
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  const ext = path.extname(file).toLowerCase();
  let json: { buffers?: { uri?: string }[]; images?: { uri?: string }[] } | undefined;
  if (ext === '.gltf') json = JSON.parse(await fs.readFile(file, 'utf8'));
  if (ext === '.glb') {
    const handle = await fs.open(file, 'r');
    try {
      const header = Buffer.alloc(20);
      if ((await handle.read(header, 0, 20, 0)).bytesRead !== 20 || header.readUInt32LE(0) !== 0x46546c67 || header.readUInt32LE(4) !== 2 || header.readUInt32LE(16) !== 0x4e4f534a) throw invalidState('Invalid GLB header while fingerprinting recipe evidence.');
      const length = header.readUInt32LE(12);
      if (length > 64 * 1024 * 1024 || length + 20 > info.size) throw invalidState('Invalid or oversized GLB JSON chunk.');
      const bytes = Buffer.alloc(length);
      if ((await handle.read(bytes, 0, length, 20)).bytesRead !== length) throw invalidState('Incomplete GLB JSON chunk.');
      json = JSON.parse(bytes.toString('utf8').trimEnd());
    } finally { await handle.close(); }
  }
  if (json) {
    for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) if (item.uri && !item.uri.startsWith('data:')) {
      if (/^[a-z]+:/i.test(item.uri)) throw invalidState('Remote glTF dependencies cannot be verified for checkpoint reuse.');
      const resource = path.resolve(path.dirname(file), decodeURIComponent(item.uri));
      if (resource === path.resolve(file)) throw invalidState('Recursive glTF dependency');
      // Resources are opaque bytes, not recursively interpreted glTF documents.
      const resourceInfo = await fs.lstat(resource);
      if (!resourceInfo.isFile() || resourceInfo.isSymbolicLink()) throw invalidState('External glTF resources must be regular files, never symlinks.');
      if (await fs.realpath(resource) !== path.join(await fs.realpath(path.dirname(file)), path.relative(path.dirname(file), resource))) throw invalidState('External glTF resource traverses a symlink.');
      const resourceHash = createHash('sha256');
      for await (const chunk of createReadStream(resource)) resourceHash.update(chunk);
      hash.update(digest({ uri: item.uri, sha256: resourceHash.digest('hex') }));
    }
  }
  return hash.digest('hex');
}
export function validateRecipe(input: unknown): Recipe {
  const recipe = recipeSchema.parse(input);
  const seen = new Set<string>();
  for (const step of recipe.steps) {
    if (seen.has(step.id) || step.dependsOn.some(dep => !seen.has(dep))) throw invalidInput('Steps must have unique ids and topologically ordered dependencies.');
    seen.add(step.id);
    if (new Set(step.dependsOn).size !== step.dependsOn.length) throw invalidInput('Step dependencies must be unique.');
    if (step.reviewBinding && (step.operation !== 'decide_asset_review' || !step.dependsOn.includes(step.reviewBinding.stepId) || recipe.steps.find(s => s.id === step.reviewBinding?.stepId)?.operation !== 'create_asset_review')) throw invalidInput('Review bindings must reference a declared asset review dependency.');
    // References must point to declared dependencies; they cannot smuggle in results from another graph.
    const check = (value: unknown): void => {
      if (value && typeof value === 'object') {
        if ('$step' in value) {
          const ref = z.object({ $step: id, field: z.string().min(1) }).strict().parse(value);
          if (!step.dependsOn.includes(ref.$step)) throw invalidInput(`Undeclared dependency ${ref.$step}`);
        } else Object.values(value).forEach(check);
      }
    };
    check(step.arguments);
  }
  return recipe;
}
function resolve(value: unknown, record: RecordState): unknown {
  if (Array.isArray(value)) return value.map(v => resolve(v, record));
  if (value && typeof value === 'object') {
    if ('$step' in value) {
      const ref = value as { $step: string; field: string };
      const checkpoint = record.checkpoints[ref.$step];
      if (checkpoint?.state !== 'complete') throw invalidState(`Dependency ${ref.$step} is not complete`);
      let selected: unknown = checkpoint.result;
      for (const field of ref.field.split('.')) {
        if (!selected || typeof selected !== 'object' || !Object.hasOwn(selected, field)) throw invalidState(`Missing result field ${ref.field}`);
        selected = (selected as Record<string, unknown>)[field];
      }
      return selected;
    }
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v, record)]));
  }
  return value;
}
/** Paid dispatch must cross the transport's current per-operation authorization boundary. */
export type RecipeDispatch = (operation: string, args: Record<string, unknown>) => Promise<ToolResult>;
export class RecipeStore {
  constructor(readonly root: string, readonly toolVersion: string, readonly operationIdentity?: (operation: string, args: Record<string,unknown>) => Promise<unknown>) {}
  private target(recipeId: string): string { return path.join(this.root, `${id.parse(recipeId)}.json`); }
  private async locked<T>(recipeId: string, body: () => Promise<T>): Promise<T> {
    await fs.mkdir(this.root, { recursive: true });
    const lock = `${this.target(recipeId)}.lock`;
    let handle;
    try { handle = await fs.open(lock, 'wx'); } catch { throw invalidState('Recipe is locked. If a process crashed, inspect the record before explicitly recovering its lock.'); }
    await handle.writeFile(JSON.stringify({ pid: process.pid, host: hostname() }));
    try { return await body(); } finally { await handle.close(); await fs.unlink(lock); }
  }
  private async write(record: RecordState): Promise<void> {
    const temp = `${this.target(record.recipe.id)}.${randomUUID()}.tmp`;
    const handle = await fs.open(temp, 'wx');
    try { await handle.writeFile(JSON.stringify(record, null, 2)); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, this.target(record.recipe.id));
  }
  async read(recipeId: string): Promise<RecordState> {
    const record = recordSchema.parse(JSON.parse(await fs.readFile(this.target(recipeId), 'utf8')));
    validateRecipe(record.recipe);
    if (record.recipe.id !== recipeId) throw invalidState('Recipe record identity mismatch');
    return record;
  }
  async save(input: unknown): Promise<RecordState> {
    const recipe = validateRecipe(input);
    return this.locked(recipe.id, async () => {
      let old: RecordState | undefined;
      try { old = await this.read(recipe.id); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      // Repeated saves of the same reviewed form do not edit an interrupted graph.
      if (old && digest(old.recipe) === digest(recipe)) return old;
      if (old && Object.values(old.checkpoints).some(cp => cp.state === 'running' || cp.state === 'uncertain')) throw invalidState('Reconcile uncertain operations before editing this recipe.');
      const checkpoints = Object.fromEntries(Object.entries(old?.checkpoints ?? {}).filter(([stepId]) => recipe.steps.some(step => step.id === stepId)));
      const record: RecordState = { schema: 'game_dev.recipe_record.v1', recipe, revision: (old?.revision ?? 0) + 1, checkpoints };
      await this.write(record); return record;
    });
  }
  private async inspect(record: RecordState) {
    const steps: RecipePlanStep[] = [];
    for (const step of record.recipe.steps) {
      const dependenciesReady = step.dependsOn.every(dep => steps.find(s => s.id === dep)?.status === 'complete');
      let args: Record<string, unknown> | undefined;
      let fingerprint: string | undefined;
      let issue: string | undefined;
      let reviewRequired = false;
      const reasons: string[] = [];
      if (!dependenciesReady) reasons.push(...step.dependsOn.filter(dep => steps.find(s => s.id === dep)?.status !== 'complete').map(dep => `Dependency ${dep} is ${steps.find(s => s.id === dep)?.state ?? 'missing'}.`));
      if (dependenciesReady) {
        try {
          args = resolve(step.arguments, record) as Record<string, unknown>;
          const files = await Promise.all(step.files.map(async file => ({ file, digest: await fileDigest(file) })));
          // Includes nested review candidates, not only direct modelPath arguments.
          const argumentFiles = new Set<string>();
          const collectInputs = (value: unknown): void => {
            if (!value || typeof value !== 'object') return;
            for (const [key, child] of Object.entries(value)) {
              if (/Path$/.test(key) && key !== 'outputPath' && typeof child === 'string') argumentFiles.add(child);
              else if (child && typeof child === 'object') collectInputs(child);
            }
          };
          collectInputs(args);
          for (const file of argumentFiles) if (!files.some(entry => entry.file === file)) files.push({ file, digest: await fileDigest(file) });
          fingerprint = digest({ step, args, files, toolVersion: this.toolVersion, operationIdentity: await this.operationIdentity?.(step.operation,args), dependencies: step.dependsOn.map(dep => record.checkpoints[dep]?.fingerprint) });
          if (step.operation === 'decide_asset_review') {
            const reviewInput = z.object({ sessionId: z.string().uuid(), candidateId: z.string().uuid(), decision: z.enum(['approve', 'reject']), reviewer: z.string().trim().min(1).max(200), reason: z.string().trim().min(1).max(4000) }).safeParse(args);
            const bindingCurrent = !step.reviewBinding || steps.find(s => s.id === step.reviewBinding?.stepId)?.reviewedFingerprint === step.reviewBinding.fingerprint;
            reviewRequired = !reviewInput.success || !bindingCurrent;
            if (reviewRequired) reasons.push(bindingCurrent ? 'Human candidate selection, reviewer and reason are required after inspecting the current review.' : 'Review evidence changed; select and review a candidate again.');
          }
        } catch (error) { issue = String(error); }
      }
      const cp = record.checkpoints[step.id];
      let verified = cp?.state === 'complete' && fingerprint === cp.fingerprint;
      const artifacts = [];
      if (cp) for (const artifact of cp.artifacts) {
        let artifactVerified = false;
        try { artifactVerified = await fileDigest(artifact.path) === artifact.digest; } catch { /* Missing evidence invalidates reuse. */ }
        artifacts.push({ ...artifact, verified: artifactVerified });
        if (!artifactVerified) { verified = false; reasons.push(`Saved output is missing or changed: ${artifact.path}`); }
      }
      if (reviewRequired) verified = false;
      const uncertain = cp?.state === 'running' || cp?.state === 'uncertain';
      const status = uncertain ? 'uncertain' : !dependenciesReady || reviewRequired ? 'blocked' : issue ? 'invalid' : verified ? 'complete' : 'ready';
      const state = uncertain ? 'uncertain' : verified ? 'completed' : cp?.state === 'complete' ? 'invalidated' : status === 'ready' ? 'ready' : 'blocked';
      if (uncertain) reasons.unshift('Operation started but completion is unproven. Inspect durable jobs or outputs; never retry automatically.');
      else if (verified) reasons.push('Current inputs, dependency fingerprints and saved output bytes match the completed checkpoint.');
      else if (issue) reasons.push(`Inputs or tool evidence cannot be verified: ${issue}`);
      else if (cp?.state === 'complete' && dependenciesReady && fingerprint !== cp.fingerprint) reasons.push('Inputs, settings, tool identity or dependency fingerprints changed since completion.');
      else if (status === 'ready') reasons.push(cp?.state === 'failed' ? 'The previous attempt did not pass; review its result before authorizing another attempt.' : 'Dependencies and input evidence are current. Review the arguments and authorize this single step.');
      const reviewedFingerprint = verified && step.operation === 'create_asset_review' && cp ? digest({ checkpointFingerprint: cp.fingerprint, result: cp.result, artifacts: cp.artifacts }) : undefined;
      steps.push({ id: step.id, operation: step.operation, dependsOn: step.dependsOn, status, state, fingerprint, reviewedFingerprint, arguments: args, issue, reasons, paid: paidOperations.has(step.operation), previousState: cp?.state, evidence: { verified, checkpointFingerprint: cp?.fingerprint, artifacts, result: cp?.result, message: cp?.message } });
    }
    // Older v1 saves retained checkpoints after removing a completed step. Keep
    // those records readable and surface interrupted history instead of erasing it.
    const historicalCheckpoints = Object.entries(record.checkpoints).filter(([stepId]) => !record.recipe.steps.some(step => step.id === stepId)).map(([stepId, checkpoint]) => ({ stepId, ...checkpoint }));
    const interruptedHistory = historicalCheckpoints.find(checkpoint => checkpoint.state === 'running' || checkpoint.state === 'uncertain');
    const uncertain = steps.find(step => step.state === 'uncertain');
    const ready = steps.find(step => step.status === 'ready');
    const selection = steps.find(step => step.operation === 'decide_asset_review' && step.status === 'blocked' && step.arguments);
    const review = selection && steps.find(step => record.recipe.steps.find(s => s.id === selection.id)?.dependsOn.includes(step.id) && step.operation === 'create_asset_review' && step.state === 'completed');
    const nextStep = uncertain || interruptedHistory ? { kind: 'reconcile', stepId: uncertain?.id ?? interruptedHistory!.stepId, requiresReview: true, instruction: uncertain?.reasons[0] ?? 'A historical removed step is interrupted. Inspect its durable jobs or outputs and reconcile explicitly before editing the recipe.' }
      : ready ? { kind: 'review-step', stepId: ready.id, operation: ready.operation, fingerprint: ready.fingerprint, arguments: ready.arguments, requiresReview: true, instruction: 'Review these current arguments and fingerprint, then execute one step with fresh transport approval.' }
      : selection && review ? { kind: 'select-candidate', stepId: selection.id, reviewedFingerprint: review.reviewedFingerprint, candidates: review.evidence.result?.candidates, dashboardPath: review.evidence.result?.dashboardPath, requiresReview: true, instruction: 'Inspect the saved review, select an actual candidate ID and provide reviewer attribution and reason through set_production_review.' }
      : steps.every(step => step.state === 'completed') ? { kind: 'complete', requiresReview: false, instruction: 'All current checkpoints verify. This is technical evidence, not target-engine or artistic acceptance.' }
      : { kind: 'fix-inputs', requiresReview: true, instruction: 'Resolve the blocked input or dependency reasons, then plan again.' };
    return { schema: 'game_dev.recipe_plan.v1', id: record.recipe.id, name: record.recipe.name, revision: record.revision, steps, historicalCheckpoints, edges: record.recipe.steps.flatMap(step => step.dependsOn.map(from => ({ from, to: step.id }))), nextStep };
  }
  async plan(recipeId: string) { return this.inspect(await this.read(recipeId)); }
  /** Bind an explicit human selection to actual current review evidence; does not execute a decision. */
  async bindReview(recipeId: string, stepId: string, reviewedFingerprint: string, candidateId: string, reviewer: string, reason: string) {
    sha256.parse(reviewedFingerprint);
    z.string().uuid().parse(candidateId);
    reviewer = z.string().trim().min(1).max(200).parse(reviewer);
    reason = z.string().trim().min(1).max(4000).parse(reason);
    return this.locked(recipeId, async () => {
      const record = await this.read(recipeId);
      if (Object.values(record.checkpoints).some(cp => cp.state === 'running' || cp.state === 'uncertain')) throw invalidState('Reconcile uncertain operations before changing a review selection.');
      const step = record.recipe.steps.find(s => s.id === stepId);
      const reviews = record.recipe.steps.filter(s => step?.dependsOn.includes(s.id) && s.operation === 'create_asset_review');
      if (!step || step.operation !== 'decide_asset_review' || reviews.length !== 1) throw invalidState('Selection must depend on exactly one asset review step.');
      const review = (await this.inspect(record)).steps.find(s => s.id === reviews[0]!.id);
      if (review?.state !== 'completed' || review.reviewedFingerprint !== reviewedFingerprint) throw invalidState('Review evidence changed or is incomplete; plan and inspect the current review again.');
      const candidates = z.array(z.object({ id: z.string().uuid(), snapshotPath: z.string().min(1) })).parse(review.evidence.result?.candidates);
      const candidateIndex = candidates.findIndex(candidate => candidate.id === candidateId);
      if (candidateIndex === -1) throw invalidInput('Select a candidate ID from the current review result.');
      const arguments_ = { sessionId: { $step: review.id, field: 'id' }, candidateId, decision: 'approve', reviewer, reason };
      const reviewBinding = { stepId: review.id, fingerprint: reviewedFingerprint };
      if (digest(step.arguments) === digest(arguments_) && digest(step.reviewBinding) === digest(reviewBinding)) return record;
      step.arguments = arguments_; step.reviewBinding = reviewBinding;
      // The validation input follows the actual selected snapshot, not a guessed
      // filename or the order of the original candidates.
      for (const downstream of record.recipe.steps) if (downstream.operation === 'validate_game_asset' && downstream.dependsOn.includes(step.id) && downstream.dependsOn.includes(review.id)) downstream.arguments.modelPath = { $step: review.id, field: `candidates.${candidateIndex}.snapshotPath` };
      record.revision += 1;
      await this.write(record);
      return record;
    });
  }
  async run(recipeId: string, stepId: string, approvedFingerprint: string, dispatch: RecipeDispatch) {
    return this.locked(recipeId, async () => {
      const record = await this.read(recipeId);
      const step = (await this.inspect(record)).steps.find(s => s.id === stepId);
      if (!step || step.status !== 'ready' || step.fingerprint !== approvedFingerprint || !step.arguments) throw invalidState('Step is not ready, input changed, or approval does not match current fingerprint; plan again.');
      record.checkpoints[stepId] = { fingerprint: approvedFingerprint, state: 'running', artifacts: [] };
      await this.write(record); // crash after here is uncertain, never an automatic retry
      try {
        const response = await dispatch(step.operation, step.arguments);
        const result = z.record(z.unknown()).parse(JSON.parse(resultText(response)));
        const rejected = response.isError || result.passed === false || (result.validation as Record<string, unknown> | undefined)?.passed === false || (step.operation === 'decide_asset_review' && result.decision !== 'approve') || (step.operation === 'get_asset_job' && !['ready', 'reference_ready'].includes(String(result.status ?? (result.job as Record<string, unknown> | undefined)?.status)));
        const artifacts: z.infer<typeof artifactSchema>[] = [];
        if (!rejected) {
          const paths = new Set<string>();
          const collect = (value: unknown): void => {
            if (!value || typeof value !== 'object') return;
            for (const [key, child] of Object.entries(value)) {
              if (['path', 'outputPath', 'modelPath', 'manifestPath', 'receiptPath', 'packagePath', 'snapshotPath', 'dashboardPath', 'previewRunPath'].includes(key) && typeof child === 'string' && path.isAbsolute(child)) paths.add(child);
              else if (typeof child === 'object') collect(child);
            }
          };
          collect(result);
          for (const file of paths) { await fs.stat(file); artifacts.push({ path: file, digest: await fileDigest(file) }); }
        }
        record.checkpoints[stepId] = { fingerprint: approvedFingerprint, state: rejected ? (step.paid ? 'uncertain' : 'failed') : 'complete', artifacts, result };
      } catch (error) {
        record.checkpoints[stepId] = { fingerprint: approvedFingerprint, state: 'uncertain', artifacts: [], message: String(error) };
      }
      await this.write(record); return record.checkpoints[stepId];
    });
  }
  async recoverLock(recipeId: string) {
    const lock = `${this.target(recipeId)}.lock`;
    const owner = z.object({ pid: z.number().int().positive(), host: z.string() }).parse(JSON.parse(await fs.readFile(lock, 'utf8')));
    if (owner.host !== hostname()) throw invalidState('Lock belongs to another host; cannot prove its owner stopped.');
    try { process.kill(owner.pid, 0); throw invalidState('Recipe lock owner is still running.'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    await this.read(recipeId); // corrupt records never silently reset
    await fs.unlink(lock);
    return { recovered: true, note: 'Interrupted operations remain uncertain; inspect jobs before reconciliation.' };
  }
  /** Recovery cannot invent success or repeat a paid operation. It only records operator-confirmed non-submission. */
  async reconcileNotSubmitted(recipeId: string, stepId: string, evidence: string) {
    if (evidence.trim().length < 12) throw invalidInput('Provide evidence that no submission occurred, not a retry instruction.');
    return this.locked(recipeId, async () => {
      const record = await this.read(recipeId); const cp = record.checkpoints[stepId];
      if (!cp || !['running', 'uncertain'].includes(cp.state)) throw invalidState('Step is not uncertain');
      cp.state = 'failed'; cp.message = evidence; await this.write(record); return cp;
    });
  }
}
