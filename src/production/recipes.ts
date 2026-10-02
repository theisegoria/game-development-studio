import { hostname } from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs, createReadStream } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { invalidInput, invalidState } from '../util/errors.js';
import type { ToolResult } from '../tools/context.js';
import { resultText } from '../tools/context.js';

export const operations = ['generate_asset_reference', 'create_3d_asset', 'texture_existing_asset', 'download_asset', 'get_asset_job', 'select_reference', 'normalize_mesh', 'validate_game_asset', 'build_asset_package', 'prepare_collision_box', 'validate_platform_asset'] as const;
export const paidOperations = new Set<string>(['generate_asset_reference', 'create_3d_asset', 'texture_existing_asset']);
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const stepSchema = z.object({ id, operation: z.enum(operations), dependsOn: z.array(id).max(64).default([]), arguments: z.record(z.unknown()), files: z.array(z.string().min(1)).max(128).default([]) }).strict();
export const recipeSchema = z.object({ schema: z.literal('game_dev.production_recipe.v1'), id, name: z.string().min(1).max(200), steps: z.array(stepSchema).min(1).max(128), family: z.object({ id, member: id, sample: z.boolean(), approvalDigest: z.string().optional() }).optional() }).strict();
export type Recipe = z.infer<typeof recipeSchema>;
const artifactSchema = z.object({ path: z.string(), digest: z.string() });
const checkpointSchema = z.object({ fingerprint: z.string(), state: z.enum(['running', 'complete', 'failed', 'uncertain']), result: z.record(z.unknown()).optional(), artifacts: z.array(artifactSchema).default([]), message: z.string().optional() });
const recordSchema = z.object({ schema: z.literal('game_dev.recipe_record.v1'), recipe: recipeSchema, revision: z.number().int().nonnegative(), checkpoints: z.record(checkpointSchema) });
type RecordState = z.infer<typeof recordSchema>;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
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
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  if (path.extname(file).toLowerCase() === '.gltf') {
    const json = JSON.parse(await fs.readFile(file, 'utf8')) as { buffers?: { uri?: string }[]; images?: { uri?: string }[] };
    for (const item of [...(json.buffers ?? []), ...(json.images ?? [])]) if (item.uri && !item.uri.startsWith('data:')) {
      if (/^[a-z]+:/i.test(item.uri)) throw invalidState('Remote glTF dependencies cannot be verified for checkpoint reuse.');
      const resource = path.resolve(path.dirname(file), decodeURIComponent(item.uri));
      if (resource === path.resolve(file)) throw invalidState('Recursive glTF dependency');
      for await (const chunk of createReadStream(resource)) hash.update(chunk);
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
  constructor(readonly root: string, readonly toolVersion: string, readonly operationIdentity?: (operation: string) => Promise<unknown>) {}
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
      if (old && Object.values(old.checkpoints).some(cp => cp.state === 'running' || cp.state === 'uncertain')) throw invalidState('Reconcile uncertain operations before editing this recipe.');
      const record: RecordState = { schema: 'game_dev.recipe_record.v1', recipe, revision: (old?.revision ?? 0) + 1, checkpoints: old?.checkpoints ?? {} };
      await this.write(record); return record;
    });
  }
  private async inspect(record: RecordState) {
    const steps: Array<{ id: string; operation: string; status: string; fingerprint?: string; arguments?: Record<string, unknown>; issue?: string; paid: boolean; previousState?: string }> = [];
    for (const step of record.recipe.steps) {
      const dependenciesReady = step.dependsOn.every(dep => steps.find(s => s.id === dep)?.status === 'complete');
      let args: Record<string, unknown> | undefined;
      let fingerprint: string | undefined;
      let issue: string | undefined;
      if (dependenciesReady) {
        try {
          args = resolve(step.arguments, record) as Record<string, unknown>;
          const files = await Promise.all(step.files.map(async file => ({ file, digest: await fileDigest(file) })));
          // Direct file arguments are fingerprinted too: no stale checkpoint when callers omit files.
          for (const [key, value] of Object.entries(args)) if (/Path$/.test(key) && key !== 'outputPath' && typeof value === 'string') files.push({ file: value, digest: await fileDigest(value) });
          fingerprint = digest({ step, args, files, toolVersion: this.toolVersion, operationIdentity: await this.operationIdentity?.(step.operation), dependencies: step.dependsOn.map(dep => record.checkpoints[dep]?.fingerprint) });
        } catch (error) { issue = String(error); }
      }
      const cp = record.checkpoints[step.id];
      let verified = cp?.state === 'complete' && fingerprint === cp.fingerprint;
      if (verified && cp) for (const artifact of cp.artifacts) { try { if (await fileDigest(artifact.path) !== artifact.digest) verified = false; } catch { verified = false; } }
      const uncertain = cp?.state === 'running' || cp?.state === 'uncertain';
      const status = uncertain ? 'uncertain' : !dependenciesReady ? 'blocked' : issue ? 'invalid' : verified ? 'complete' : 'ready';
      steps.push({ id: step.id, operation: step.operation, status, fingerprint, arguments: args, issue, paid: paidOperations.has(step.operation), previousState: cp?.state });
    }
    return { schema: 'game_dev.recipe_plan.v1', id: record.recipe.id, revision: record.revision, steps };
  }
  async plan(recipeId: string) { return this.inspect(await this.read(recipeId)); }
  async run(recipeId: string, stepId: string, approvedFingerprint: string, dispatch: RecipeDispatch) {
    return this.locked(recipeId, async () => {
      const record = await this.read(recipeId);
      const step = (await this.inspect(record)).steps.find(s => s.id === stepId);
      if (!step || step.status !== 'ready' || step.fingerprint !== approvedFingerprint || !step.arguments) throw invalidState('Step is not ready, input changed, or approval does not match current fingerprint; plan again.');
      record.checkpoints[stepId] = { fingerprint: approvedFingerprint, state: 'running', artifacts: [] };
      await this.write(record); // crash after here is uncertain, never an automatic retry
      try {
        const response = await dispatch(step.operation, step.arguments);
        const result = JSON.parse(resultText(response)) as Record<string, unknown>;
        const rejected = response.isError || result.passed === false || (step.operation === 'get_asset_job' && !['ready', 'reference_ready'].includes(String(result.status ?? (result.job as Record<string, unknown> | undefined)?.status)));
        const artifacts: z.infer<typeof artifactSchema>[] = [];
        if (!rejected) {
          const paths = new Set<string>();
          const collect = (value: unknown): void => {
            if (!value || typeof value !== 'object') return;
            for (const [key, child] of Object.entries(value)) {
              if (['path', 'outputPath', 'modelPath', 'manifestPath', 'receiptPath', 'packagePath'].includes(key) && typeof child === 'string' && path.isAbsolute(child)) paths.add(child);
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
