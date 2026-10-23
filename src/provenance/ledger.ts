/** Evidence inventory, not a legal opinion or an authorization grant. */
import { createHash } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { atomicJson, withTransaction } from '../storage/transaction.js';
import { invalidInput, invalidState } from '../util/errors.js';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 2000;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
// Public reference URLs only. Signed downloads and query credentials do not belong in provenance.
const publicUrl = z.string().max(2048).url().refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash; } catch { return false; }
}, 'Use a public HTTPS reference without credentials, query parameters or fragments');
const note = z.string().max(2000).refine(value => (value.match(/https?:\/\/[^\s<>]+/g) ?? []).every(url => publicUrl.safeParse(url).success)).refine(value => !/(?:\b(?:sk-proj-|sk_live_|AKIA)[A-Za-z0-9_-]+|\bBearer\s+\S+|\b(?:api[_-]?key|password|access[_-]?token|secret)\s*[:=]\s*\S+)/i.test(value), 'Secret-like text is not accepted');
const sourceReference = z.union([publicUrl, z.string().regex(/^urn:sha256:[a-f0-9]{64}$/)]);
const evidenceSchema = z.object({
  url: sourceReference,
  sha256: hash.optional(),
  capturedAt: z.string().datetime(),
  origin: z.enum(['user_assertion', 'official_document', 'license_file', 'account_entitlement']),
  note: note.optional(),
}).strict().superRefine((value, ctx) => {
  if (value.url.startsWith('urn:sha256:') && value.sha256 !== undefined && value.sha256 !== value.url.slice(11)) ctx.addIssue({ code: 'custom', message: 'Content reference and evidence hash differ' });
});
const rightsSchema = z.object({
  status: z.enum(['unknown', 'allowed', 'denied']),
  redistribution: z.enum(['unknown', 'allowed', 'denied']),
  evidence: z.array(evidenceSchema).max(32),
  attribution: z.array(note).max(32),
  restrictions: z.array(note).max(32),
}).strict().superRefine((value, ctx) => {
  if ((value.status !== 'unknown' || value.redistribution !== 'unknown') && value.evidence.length === 0) ctx.addIssue({ code: 'custom', message: 'Rights declarations require evidence' });
  if (value.status === 'denied' && value.redistribution === 'allowed') ctx.addIssue({ code: 'custom', message: 'Denied use cannot permit redistribution' });
});
export const sourceRecordSchema = z.object({
  schema: z.literal('game_dev.source_record.v1'),
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/),
  kind: z.enum(['executable', 'package', 'provider', 'asset', 'model', 'recipe_dependency']),
  name: note.refine(value => value.length > 0),
  officialSource: sourceReference,
  version: note.refine(value => value.length > 0 && value.length <= 200),
  model: note.refine(value => value.length > 0 && value.length <= 200).optional(),
  contentSha256: hash.optional(),
  acquiredAt: z.string().datetime(),
  rights: z.object({ code: rightsSchema, model: rightsSchema, output: rightsSchema }).strict(),
  retention: z.object({ status: z.enum(['unknown', 'documented', 'not_applicable']), description: note, evidence: z.array(evidenceSchema).max(32) }).strict(),
  entitlement: z.object({ required: z.enum(['unknown', 'yes', 'no']), description: note, evidence: z.array(evidenceSchema).max(32) }).strict(),
  verification: z.object({ status: z.enum(['unverified', 'evidence_reviewed']), reviewedAt: z.string().datetime().optional(), note: note }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.verification.status === 'evidence_reviewed') {
    const evidence = Object.values(value.rights).flatMap(right => right.evidence);
    if (!value.verification.reviewedAt || !evidence.some(item => item.origin !== 'user_assertion')) ctx.addIssue({ code: 'custom', message: 'Evidence review requires dated non-assertion evidence; it is not legal clearance' });
  }
});
export type SourceRecord = z.infer<typeof sourceRecordSchema>;
const storedSchema = z.object({ record: sourceRecordSchema, sha256: hash }).strict();
export const sourceLedgerSchema = z.object({ schema: z.literal('game_dev.source_ledger.v1'), revision: z.number().int().nonnegative().safe(), records: z.array(storedSchema).max(MAX_RECORDS) }).strict();
export type SourceInventory = z.infer<typeof sourceLedgerSchema>;
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export function sourceRecordHash(record: SourceRecord): string { return createHash('sha256').update(canonical(record)).digest('hex'); }
export function planSourceRecord(input: unknown) {
  const result = sourceRecordSchema.safeParse(input);
  if (!result.success) throw invalidInput('Invalid source record; credentials and private URLs are not accepted');
  return { schema: 'game_dev.source_record_plan.v1' as const, record: result.data, sha256: sourceRecordHash(result.data) };
}
/** Never independently verified. Even positive evidence remains a documented declaration. */
export function redistributionAssessment(record: SourceRecord, domain: 'code' | 'model' | 'output') {
  const rights = record.rights[domain];
  return {
    status: rights.status === 'denied' || rights.redistribution === 'denied' ? 'denied' as const
      : rights.status === 'allowed' && rights.redistribution === 'allowed' && record.verification.status === 'evidence_reviewed' && rights.evidence.some(item => item.origin !== 'user_assertion') ? 'documented_declaration' as const : 'unknown' as const,
    independentlyVerified: false as const,
    authorizationGranted: false as const,
  };
}
async function refuseSymlinkParents(directory: string): Promise<void> {
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { const info = await fs.lstat(current); if (info.isSymbolicLink() || !info.isDirectory()) throw invalidInput('Ledger directory must not traverse symlinks or non-directories'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}
export class SourceLedger {
  private constructor(private readonly file: string) {}
  /** Opens without creating directories or files. Read-only inspection stays read-only. */
  static async open(directory: string): Promise<SourceLedger> {
    const resolved = path.resolve(directory);
    await refuseSymlinkParents(resolved);
    return new SourceLedger(path.join(resolved, 'source-ledger.json'));
  }
  async inventory(): Promise<SourceInventory> {
    await refuseSymlinkParents(path.dirname(this.file));
    let handle;
    try {
      const info = await fs.lstat(this.file);
      if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_BYTES) throw invalidState('Ledger is not a bounded regular file');
      handle = await fs.open(this.file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const opened = await handle.stat();
      if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== info.dev || opened.ino !== info.ino || opened.size > MAX_BYTES) throw invalidState('Ledger is not a bounded regular file');
      const bytes = Buffer.alloc(MAX_BYTES + 1);
      let length = 0;
      while (length < bytes.length) { const read = await handle.read(bytes, length, bytes.length - length, null); if (!read.bytesRead) break; length += read.bytesRead; }
      if (length > MAX_BYTES) throw invalidState('Ledger exceeds byte limit');
      const result = sourceLedgerSchema.parse(JSON.parse(bytes.subarray(0, length).toString('utf8')));
      if (new Set(result.records.map(item => item.record.id)).size !== result.records.length || result.records.some(item => item.sha256 !== sourceRecordHash(item.record))) throw invalidState('Ledger integrity check failed');
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { schema: 'game_dev.source_ledger.v1', revision: 0, records: [] };
      throw invalidState('Source ledger cannot be verified; preserve it and restore known evidence');
    } finally { await handle?.close(); }
  }
  async record(input: unknown, options: { expectedRevision: number; expectedSha256: string }): Promise<SourceInventory> {
    const parsed = sourceRecordSchema.safeParse(input);
    if (!parsed.success || !Number.isSafeInteger(options.expectedRevision) || options.expectedRevision < 0) throw invalidInput('Invalid source record or expected revision');
    if (options.expectedSha256 !== sourceRecordHash(parsed.data)) throw invalidState('Source record differs from the reviewed plan');
    await refuseSymlinkParents(path.dirname(this.file));
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    return withTransaction(this.file, async () => {
      const state = await this.inventory();
      if (state.revision !== options.expectedRevision) throw invalidState('Source ledger revision conflict', { actualRevision: state.revision });
      const entry = { record: parsed.data, sha256: sourceRecordHash(parsed.data) };
      const records = state.records.filter(item => item.record.id !== entry.record.id).concat(entry).sort((a, b) => a.record.id.localeCompare(b.record.id));
      const next = sourceLedgerSchema.parse({ ...state, revision: state.revision + 1, records });
      if (Buffer.byteLength(JSON.stringify(next, null, 2)) + 1 > MAX_BYTES) throw invalidInput('Source ledger byte limit exceeded');
      await atomicJson(this.file, next);
      return next;
    });
  }
  async cycloneDx() { return sourceInventoryCycloneDx(await this.inventory()); }
}

export function sourceInventoryCycloneDx(state: SourceInventory) {
    return {
      bomFormat: 'CycloneDX' as const, specVersion: '1.6' as const, version: state.revision + 1,
      components: state.records.map(({ record, sha256 }) => ({
        type: record.kind === 'asset' || record.kind === 'model' ? 'data' as const : record.kind === 'executable' ? 'application' as const : record.kind === 'provider' ? 'platform' as const : 'library' as const,
        'bom-ref': `source:${record.id}:${sha256}`, name: record.name, version: record.version,
        ...(record.contentSha256 ? { hashes: [{ alg: 'SHA-256' as const, content: record.contentSha256 }] } : {}),
        externalReferences: [{ type: 'website' as const, url: record.officialSource }],
        properties: [
          { name: 'game-dev:record-sha256', value: sha256 },
          { name: 'game-dev:evidence-ceiling', value: 'Documented declarations only; no legal clearance or authorization granted' },
          ...(['code', 'model', 'output'] as const).map(domain => ({ name: `game-dev:rights:${domain}`, value: redistributionAssessment(record, domain).status })),
        ],
      })),
    };
  }
