/** Serialized reservations reload under a process-shared lock before checking the ceiling.
 * Corrupt accounting never becomes a zero balance. Free diagnostics remain callable.
 */
import { randomUUID } from 'node:crypto';
import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { AssetPipelineError, invalidInput, invalidState } from '../util/errors.js';
import { estimateCost, summarize, type SpendEntry, type SpendSummary } from '../domain/spend.js';
import { atomicJson, withTransaction, recoverTransactionLock } from './transaction.js';

const entrySchema = z.object({
  id: z.string().min(1), tool: z.string().min(1), estimatedCents: z.number().int().nonnegative().safe(),
  confidence: z.enum(['documented', 'estimated']), basis: z.string(), at: z.string().datetime(),
  reportedCents: z.number().int().nonnegative().safe().optional(), assetJobId: z.string().optional(),
  releasedAt: z.string().datetime().optional(), outcome: z.enum(['pending', 'succeeded', 'failed', 'unknown']).optional(),
  approval: z.object({ source: z.string().min(1), at: z.string().datetime(), reference: z.string().optional(), userApprovalVerified: z.boolean().optional() }).optional(),
  quality: z.object({ rating: z.number().min(0).max(5), note: z.string().max(2000), at: z.string().datetime() }).optional(),
}).strict();
const ledgerSchema = z.object({ schemaVersion: z.literal(1), entries: z.array(entrySchema) }).strict();

export class SpendLedger {
  private entries: SpendEntry[] = [];
  private failure: string | undefined;
  private seen = false;
  private constructor(private readonly file: string, private readonly limitCents: number | undefined) {}

  static async open(dir: string, limitCents?: number): Promise<SpendLedger> {
    if (limitCents !== undefined && (!Number.isSafeInteger(limitCents) || limitCents < 0)) throw invalidInput('Spend ceiling must be a nonnegative integer');
    await fs.mkdir(dir, { recursive: true });
    const ledger = new SpendLedger(path.join(dir, 'spend-ledger.json'), limitCents);
    ledger.refresh();
    // Backfill presence evidence for valid legacy ledgers before returning an instance.
    if (ledger.seen && !ledger.failure) {
      try { await ledger.ensureMarker(); } catch (error) { ledger.failure = `Accounting marker unavailable: ${String(error)}`; }
    }
    return ledger;
  }

  private markerExists(): boolean {
    try {
      const marker = JSON.parse(readFileSync(`${this.file}.present`, 'utf8')) as Record<string, unknown>;
      if (marker.schema !== 'game_dev.spend_presence.v1' || typeof marker.createdAt !== 'string' || !Number.isFinite(Date.parse(marker.createdAt))) throw new Error('invalid spend presence marker');
      return true;
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  }

  private async ensureMarker(): Promise<void> {
    if (this.markerExists()) return;
    let handle;
    try { handle = await fs.open(`${this.file}.present`, 'wx', 0o600); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') { if (!this.markerExists()) throw error; return; } throw error; }
    try { await handle.writeFile(JSON.stringify({ schema: 'game_dev.spend_presence.v1', createdAt: new Date().toISOString() })); await handle.sync(); }
    finally { await handle.close(); }
    try {
      const directory = await fs.open(path.dirname(this.file), 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  }

  private refresh(): void {
    let markerPresent = false;
    try {
      markerPresent = this.markerExists();
      const parsed = ledgerSchema.parse(JSON.parse(readFileSync(this.file, 'utf8')));
      if (new Set(parsed.entries.map((entry) => entry.id)).size !== parsed.entries.length) throw new Error('duplicate entry ids');
      if (!Number.isSafeInteger(parsed.entries.reduce((sum, entry) => sum + Math.max(entry.estimatedCents, entry.reportedCents ?? 0), 0))) throw new Error('ledger total overflow');
      this.entries = parsed.entries;
      this.seen = true;
      this.failure = undefined;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !markerPresent && !this.seen && this.failure === undefined) { this.entries = []; return; }
      this.failure = `Accounting unavailable: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  private healthy(): void {
    if (this.failure) throw invalidState('Paid operations are blocked because the spend ledger cannot be verified. Preserve the ledger and restore a verified backup; free diagnostics remain available.', { file: this.file, reason: this.failure });
  }

  diagnostics(): { schema: string; healthy: boolean; file: string; reason?: string } {
    this.refresh();
    return { schema: 'game_dev.spend_health.v1', healthy: !this.failure, file: this.file, ...(this.failure ? { reason: this.failure } : {}) };
  }

  async recoverLock(confirm: boolean): Promise<void> { await recoverTransactionLock(this.file, confirm); }
  get limit(): number | undefined { return this.limitCents; }
  spentCents(): number { this.refresh(); this.healthy(); return this.entries.filter((entry) => !entry.releasedAt).reduce((total, entry) => total + Math.max(entry.estimatedCents, entry.reportedCents ?? 0), 0); }
  summary(): SpendSummary { this.refresh(); this.healthy(); return summarize(this.entries.filter((entry) => !entry.releasedAt), this.limitCents); }

  history(): { schema: string; entries: SpendEntry[]; providers: Record<string, unknown>[] } {
    this.refresh(); this.healthy();
    const providers = new Map<string, SpendEntry[]>();
    for (const entry of this.entries) {
      const provider = ['generate_asset_reference', 'generate_reference_variations', 'create_game_prop', 'generate_sound_effect'].includes(entry.tool) ? 'leonardo' : ['create_3d_asset', 'texture_existing_asset', 'retopologize_asset', 'rig_asset', 'animate_asset'].includes(entry.tool) ? 'tripo' : 'unknown';
      providers.set(provider, [...(providers.get(provider) ?? []), entry]);
    }
    return { schema: 'game_dev.provider_history.v1', entries: structuredClone(this.entries), providers: [...providers].map(([provider, entries]) => {
      const active = entries.filter((entry) => !entry.releasedAt);
      const reported = active.filter((entry) => entry.reportedCents !== undefined);
      const observed = active.filter((entry) => ['succeeded', 'failed'].includes(entry.outcome ?? ''));
      const ratings = active.flatMap((entry) => entry.quality ? [entry.quality.rating] : []);
      return { provider, reservations: active.length, estimatedCents: active.reduce((sum, entry) => sum + entry.estimatedCents, 0), reportedCents: reported.length ? reported.reduce((sum, entry) => sum + entry.reportedCents!, 0) : null, unknownChargeCount: active.length - reported.length, failureRate: observed.length ? observed.filter((entry) => entry.outcome === 'failed').length / observed.length : null, observedOutcomeCount: observed.length, unknownOutcomeCount: active.length - observed.length, meanUserRating: ratings.length ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : null };
    }) };
  }

  assertHeadroom(tool: string, units?: number): void {
    this.refresh(); this.healthy();
    const estimate = estimateCost(tool, units ?? 1);
    if (!Number.isSafeInteger(estimate.cents)) throw invalidInput('Estimated cost exceeds safe accounting range');
    const spent = this.entries.filter((entry) => !entry.releasedAt).reduce((total, entry) => total + Math.max(entry.estimatedCents, entry.reportedCents ?? 0), 0);
    if (this.limitCents !== undefined && spent + estimate.cents > this.limitCents) throw new AssetPipelineError('SPEND_LIMIT_EXCEEDED', `refusing ${tool} before contacting the provider: it would cost about ${formatCents(estimate.cents)} and only ${formatCents(Math.max(0, this.limitCents - spent))} of the ${formatCents(this.limitCents)} session limit remains. Raise ASSET_SPEND_LIMIT_CENTS or start a new workspace.`, { details: { tool, estimatedCents: estimate.cents, spentCents: spent, limitCents: this.limitCents } });
  }

  private async change<T>(action: () => T): Promise<T> {
    return withTransaction(this.file, async () => {
      this.refresh(); this.healthy();
      const before = structuredClone(this.entries);
      try {
        const result = action();
        // Snapshot before yielding: synchronous diagnostics on this same object may refresh its cache.
        const committed = ledgerSchema.parse({ schemaVersion: 1, entries: this.entries });
        if (!Number.isSafeInteger(committed.entries.reduce((sum, entry) => sum + Math.max(entry.estimatedCents, entry.reportedCents ?? 0), 0))) throw invalidInput('Ledger total exceeds safe accounting range');
        await this.ensureMarker();
        await atomicJson(this.file, committed);
        this.seen = true;
        return result;
      } catch (error) { this.entries = before; throw error; }
    });
  }

  async reserve(params: { tool: string; units?: number; assetJobId?: string; approval?: SpendEntry['approval'] }): Promise<{ entryId: string; estimatedCents: number }> {
    return this.change(() => {
      this.assertHeadroom(params.tool, params.units);
      if (params.assetJobId && this.entries.some((entry) => entry.assetJobId === params.assetJobId && entry.tool === params.tool && !entry.releasedAt)) throw invalidState('A reservation already exists for this job and operation; inspect the provider task instead of submitting again', { assetJobId: params.assetJobId, tool: params.tool });
      const estimate = estimateCost(params.tool, params.units ?? 1);
      const entry: SpendEntry = { id: randomUUID(), tool: params.tool, estimatedCents: estimate.cents, confidence: estimate.confidence, basis: estimate.basis, at: new Date().toISOString(), outcome: 'pending', ...(params.assetJobId ? { assetJobId: params.assetJobId } : {}), ...(params.approval ? { approval: params.approval } : {}) };
      this.entries.push(entry);
      return { entryId: entry.id, estimatedCents: estimate.cents };
    });
  }

  async reconcile(entryId: string, reportedCents: number): Promise<void> {
    if (!Number.isSafeInteger(reportedCents) || reportedCents < 0) throw invalidInput('Reported charge must be a nonnegative integer number of US cents');
    await this.change(() => { const entry = this.entries.find((candidate) => candidate.id === entryId); if (!entry || entry.releasedAt) throw invalidState('Unknown or released reservation'); entry.reportedCents = reportedCents; });
  }
  async recordOutcome(entryId: string, outcome: 'succeeded' | 'failed' | 'unknown'): Promise<void> {
    await this.change(() => { const entry = this.entries.find((candidate) => candidate.id === entryId); if (!entry) throw invalidState('Unknown reservation'); entry.outcome = outcome; });
  }
  async rate(entryId: string, rating: number, note: string): Promise<void> {
    await this.change(() => { const entry = this.entries.find((candidate) => candidate.id === entryId); if (!entry) throw invalidState('Unknown reservation'); entry.quality = { rating, note, at: new Date().toISOString() }; });
  }
  /** Only release when no provider request was sent. Retain audit evidence. */
  async release(entryId: string): Promise<void> {
    await this.change(() => { const entry = this.entries.find((candidate) => candidate.id === entryId); if (entry) { if (entry.reportedCents !== undefined) throw invalidState('Cannot release a provider-reported charge'); entry.releasedAt = new Date().toISOString(); } });
  }
}
export function formatCents(cents: number): string { return `$${(cents / 100).toFixed(2)}`; }
