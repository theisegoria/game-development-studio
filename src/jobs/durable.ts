import { randomUUID } from 'node:crypto';
import { promises as fs, appendFileSync, closeSync, fsyncSync, openSync } from 'node:fs';
import path from 'node:path';
import { invalidInput, invalidState, notFound } from '../util/errors.js';
import { redact } from '../util/logging.js';
import { z } from 'zod';
import { FREE_TOOLS } from '../domain/spend.js';
import { atomicJson, withTransaction, recoverTransactionLock } from '../storage/transaction.js';

export const DURABLE_JOB_SCHEMA = 'game_dev.job.v1';

export type DurableJobStatus =
  | 'queued'
  | 'running'
  | 'approval_required'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface DurableArtifact {
  path: string;
  kind: string;
  sha256?: string;
  bytes?: number;
}

export interface DurableJob {
  schema: typeof DURABLE_JOB_SCHEMA;
  id: string;
  operation: string;
  status: DurableJobStatus;
  request: Record<string, unknown>;
  attempts: number;
  eventCount: number;
  artifacts: DurableArtifact[];
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: Record<string, unknown>;
  receiptPath?: string;
  parentJobId?: string;
  supersededByJobId?: string;
  approval?: Record<string, unknown>;
}

const JOB_ID = /^job_[0-9a-f-]{36}$/;

const timestamp = z.string().datetime();
const jobSchema = z.object({
  schema: z.literal(DURABLE_JOB_SCHEMA), id: z.string().regex(JOB_ID),
  operation: z.string().regex(/^[a-z][a-z0-9_.-]{1,127}$/),
  status: z.enum(['queued', 'running', 'approval_required', 'completed', 'failed', 'cancelled']),
  request: z.record(z.unknown()), attempts: z.number().int().nonnegative().safe(),
  eventCount: z.number().int().nonnegative().safe(),
  artifacts: z.array(z.object({ path: z.string().min(1), kind: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(), bytes: z.number().int().nonnegative().safe().optional() }).strict()),
  createdAt: timestamp, updatedAt: timestamp, startedAt: timestamp.optional(), completedAt: timestamp.optional(),
  error: z.record(z.unknown()).optional(), receiptPath: z.string().min(1).optional(),
  parentJobId: z.string().regex(JOB_ID).optional(), supersededByJobId: z.string().regex(JOB_ID).optional(),
  approval: z.record(z.unknown()).optional(),
}).strict();

function validateJob(value: unknown, id: string): DurableJob {
  const result = jobSchema.safeParse(value);
  if (!result.success || result.data.id !== id) throw invalidState(`durable job ${id} is corrupt or has an unsupported schema`, { issues: result.success ? ['id mismatch'] : result.error.issues });
  const job = result.data;
  if (Date.parse(job.updatedAt) < Date.parse(job.createdAt)) throw invalidState(`durable job ${id} has inconsistent timestamps`);
  if (job.status === 'running' && (!job.startedAt || job.attempts < 1)) throw invalidState(`durable job ${id} is running without attempt evidence`);
  if (['completed', 'failed', 'cancelled'].includes(job.status) && !job.completedAt) throw invalidState(`durable job ${id} is terminal without completion evidence`);
  return job;
}

export class DurableJobStore {
  private constructor(private readonly root: string) {}

  static async open(root: string): Promise<DurableJobStore> {
    await fs.mkdir(root, { recursive: true, mode: 0o700 });
    return new DurableJobStore(root);
  }

  private directory(id: string): string {
    if (!JOB_ID.test(id)) throw invalidInput(`malformed durable job id: ${id}`);
    return path.join(this.root, id);
  }

  private jobPath(id: string): string {
    return path.join(this.directory(id), 'job.json');
  }

  eventsPath(id: string): string {
    return path.join(this.directory(id), 'events.jsonl');
  }

  async create(
    operation: string,
    request: Record<string, unknown>,
    options: { parentJobId?: string } = {},
  ): Promise<DurableJob> {
    if (!/^[a-z][a-z0-9_.-]{1,127}$/.test(operation)) {
      throw invalidInput(`invalid durable operation: ${operation}`);
    }
    if (options.parentJobId) {
      return withTransaction(this.jobPath(options.parentJobId), async () => {
        const parent = await this.get(options.parentJobId!);
        if (parent.supersededByJobId || ['running', 'completed', 'cancelled'].includes(parent.status)) throw invalidState('This job cannot be replayed or already has a retry');
        // A failed provider request may have been billed despite the missing response.
        if ((parent.operation.startsWith('provider.') || (parent.operation.startsWith('tool.call.') && !FREE_TOOLS.has(parent.operation.slice('tool.call.'.length)))) && parent.attempts > 0 && parent.status !== 'approval_required') throw invalidState('Provider submission outcome is uncertain. Inspect/reconcile the original provider task; recovery never resubmits paid work.');
        const child = await this.create(operation, request);
        child.parentJobId = parent.id;
        // Persist the parent claim before exposing a runnable child. A partial failure blocks replay.
        parent.supersededByJobId = child.id;
        await this.save(parent);
        await this.save(child);
        return child;
      });
    }
    const id = `job_${randomUUID()}`;
    const dir = this.directory(id);
    await fs.mkdir(dir, { recursive: false, mode: 0o700 });
    const timestamp = new Date().toISOString();
    const job: DurableJob = {
      schema: DURABLE_JOB_SCHEMA,
      id,
      operation,
      status: 'queued',
      request: redact(request) as Record<string, unknown>,
      attempts: 0,
      eventCount: 0,
      artifacts: [],
      createdAt: timestamp,
      updatedAt: timestamp,
      ...(options.parentJobId ? { parentJobId: options.parentJobId } : {}),
    };
    await atomicJson(this.jobPath(id), job);
    await fs.writeFile(this.eventsPath(id), '', { flag: 'wx', mode: 0o600 });
    return job;
  }

  async get(id: string): Promise<DurableJob> {
    let raw: string;
    try {
      raw = await fs.readFile(this.jobPath(id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw notFound('durable job', id);
      throw error;
    }
    let job: unknown;
    try {
      job = JSON.parse(raw);
    } catch (error) {
      throw invalidState(`durable job ${id} is corrupt`, { reason: String(error) });
    }
    const parsed = validateJob(job, id);
    try {
      const events = await this.readEvents(id, { limit: 100_000 });
      parsed.eventCount = events.length;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return parsed;
  }

  async save(job: DurableJob): Promise<void> {
    job.updatedAt = new Date().toISOString();
    validateJob(job, job.id);
    await atomicJson(this.jobPath(job.id), job);
  }

  /**
   * Append and fsync one event. Synchronous I/O is deliberate: a process crash
   * after stdout reported progress must not leave the durable stream behind.
   */
  appendEvent(id: string, event: Record<string, unknown>): void {
    const target = this.eventsPath(id);
    const descriptor = openSync(target, 'a', 0o600);
    try {
      appendFileSync(descriptor, `${JSON.stringify(redact(event))}\n`, 'utf8');
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  }

  async readEvents(
    id: string,
    options: { afterSequence?: number; limit?: number } = {},
  ): Promise<Record<string, unknown>[]> {
    const afterSequence = options.afterSequence ?? -1;
    const limit = options.limit ?? 10_000;
    if (!Number.isInteger(afterSequence) || afterSequence < -1) {
      throw invalidInput('afterSequence must be an integer greater than or equal to -1');
    }
    if (!Number.isInteger(limit) || limit <= 0 || limit > 100_000) {
      throw invalidInput('event limit must be an integer from 1 through 100000');
    }
    let raw: string;
    try {
      raw = await fs.readFile(this.eventsPath(id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw notFound('durable job', id);
      throw error;
    }
    const events: Record<string, unknown>[] = [];
    for (const line of raw.split('\n')) {
      if (line.length === 0) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch (error) {
        throw invalidState(`durable job ${id} has a corrupt event stream`, {
          reason: String(error),
        });
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw invalidState(`durable job ${id} has a non-object event`);
      }
      const event = parsed as Record<string, unknown>;
      const sequence = event.sequence;
      if (!Number.isSafeInteger(sequence) || (sequence as number) < 0) throw invalidState(`durable job ${id} has an invalid event sequence`);
      if ((sequence as number) > afterSequence) events.push(event);
      if (events.length >= limit) break;
    }
    return events;
  }

  async markRunning(id: string): Promise<DurableJob> {
    return withTransaction(this.jobPath(id), async () => {
    const job = await this.get(id);
    if (['running', 'completed', 'failed', 'cancelled'].includes(job.status)) {
      throw invalidState(`terminal or running durable job ${id} cannot run again`);
    }
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.completedAt = undefined;
    job.error = undefined;
    job.approval = undefined;
    job.attempts += 1;
    await this.save(job);
    return job;
    });
  }

  async markApprovalRequired(
    id: string,
    approval: Record<string, unknown>,
  ): Promise<DurableJob> {
    return withTransaction(this.jobPath(id), async () => {
    const job = await this.get(id);
    if (['completed', 'cancelled'].includes(job.status)) {
      throw invalidState(`terminal durable job ${id} cannot request approval`);
    }
    job.status = 'approval_required';
    job.approval = redact(approval) as Record<string, unknown>;
    job.error = undefined;
    await this.save(job);
    return job;
    });
  }

  async cancel(id: string, reason = 'Local orchestration was cancelled. External work may continue.'): Promise<DurableJob> {
    return withTransaction(this.jobPath(id), async () => {
    const job = await this.get(id);
    if (!['completed', 'failed', 'cancelled'].includes(job.status)) {
      job.status = 'cancelled';
      job.completedAt = new Date().toISOString();
      job.error = { error: 'LOCALLY_CANCELLED', message: reason };
      await this.save(job);
    }
    return job;
    });
  }

  private skipped: { id: string; reason: string }[] = [];
  lastListingSkipped(): readonly { id: string; reason: string }[] { return this.skipped; }

  async diagnostics(staleAfterMs = 3600000): Promise<Record<string, unknown>> {
    if (!Number.isSafeInteger(staleAfterMs) || staleAfterMs < 0) throw invalidInput('Invalid stale threshold');
    const jobs = await this.list(100000);
    return { schema: 'game_dev.job_health.v1', corrupt: this.lastListingSkipped(), stale: jobs.filter((job) => ['queued', 'running'].includes(job.status) && Date.now() - Date.parse(job.updatedAt) >= staleAfterMs).map((job) => ({ id: job.id, status: job.status, updatedAt: job.updatedAt, replayAllowed: false, recovery: 'Inspect provider state and preserve the original; a stale timestamp does not prove the worker stopped.' })) };
  }

  async recoverLock(id: string, confirm: boolean): Promise<void> { await recoverTransactionLock(this.jobPath(id), confirm); }

  /** Explicit local cancellation preserves request/evidence; it never retries or proves external cancellation. */
  async recover(id: string, confirm: boolean): Promise<DurableJob> {
    if (!confirm) throw invalidState('Recovery requires explicit confirmation; provider work may still be running');
    return this.cancel(id, 'Recovered by local cancellation. External submission/billing remains uncertain; do not resubmit automatically.');
  }

  /** Preserve corrupt bytes, then seal the local identity as cancelled; never reconstruct or replay a paid request. */
  async quarantineCorrupt(id: string, confirm: boolean): Promise<DurableJob> {
    if (!confirm) throw invalidState('Corrupt-record recovery requires explicit confirmation');
    return withTransaction(this.jobPath(id), async () => {
      let corrupt = false;
      try { await this.get(id); } catch { corrupt = true; }
      if (!corrupt) throw invalidState('Record is healthy; use ordinary cancellation');
      const jobRaw = await fs.readFile(this.jobPath(id), 'utf8');
      let eventsRaw: string | null = null;
      try { eventsRaw = await fs.readFile(this.eventsPath(id), 'utf8'); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      const evidencePath = path.join(this.directory(id), `recovery-${randomUUID()}.json`);
      await atomicJson(evidencePath, { schema: 'game_dev.corrupt_job_evidence.v1', id, jobRaw, eventsRaw, recoveredAt: new Date().toISOString() });
      const timestamp = new Date().toISOString();
      const tombstone: DurableJob = { schema: DURABLE_JOB_SCHEMA, id, operation: 'recovery.corrupt', status: 'cancelled', request: { evidencePath, replayAuthorized: false }, attempts: 0, eventCount: 0, artifacts: [], createdAt: timestamp, updatedAt: timestamp, completedAt: timestamp, error: { error: 'CORRUPT_RECORD_QUARANTINED', message: 'Original bytes preserved. Provider submission and billing remain unknown. No replay is permitted.' } };
      // Seal replay before touching the corrupt event stream. Interrupted recovery stays blocked.
      await this.save(tombstone);
      if (eventsRaw !== null) await fs.rename(this.eventsPath(id), `${evidencePath}.events.jsonl`);
      const events = await fs.open(this.eventsPath(id), 'wx', 0o600);
      try { await events.sync(); } finally { await events.close(); }
      return tombstone;
    });
  }

  async list(limit = 100): Promise<DurableJob[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100000) throw invalidInput('Invalid job limit');
    this.skipped = [];
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const jobs: DurableJob[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !JOB_ID.test(entry.name)) continue;
      try {
        jobs.push(await this.get(entry.name));
      } catch (error) {
        this.skipped.push({ id: entry.name, reason: error instanceof Error ? error.message : String(error) });
      }
    }
    jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    return jobs.slice(0, limit);
  }

  async complete(
    id: string,
    receipt: Record<string, unknown>,
    artifacts: DurableArtifact[] = [],
  ): Promise<DurableJob> {
    return withTransaction(this.jobPath(id), async () => {
    const job = await this.get(id);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) {
      throw invalidState(`terminal durable job ${id} cannot be completed again`);
    }
    const receiptPath = path.join(this.directory(id), 'receipt.json');
    await atomicJson(receiptPath, redact(receipt));
    job.status = 'completed';
    job.completedAt = new Date().toISOString();
    job.receiptPath = receiptPath;
    job.artifacts = artifacts;
    await this.save(job);
    return job;
    });
  }

  async fail(id: string, error: Record<string, unknown>): Promise<DurableJob> {
    return withTransaction(this.jobPath(id), async () => {
    const job = await this.get(id);
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return job;
    job.status = 'failed';
    job.completedAt = new Date().toISOString();
    job.error = redact(error) as Record<string, unknown>;
    await this.save(job);
    return job;
    });
  }
}
