import { createHash } from 'node:crypto';
import { promises as fs, constants } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { ToolRegistrar } from '../commands/registry.js';
import { SourceLedger, planSourceRecord, sourceRecordSchema, sourceInventoryCycloneDx, redistributionAssessment, type SourceInventory } from '../provenance/ledger.js';
import { MAX_SOURCE_EXPORT_BYTES, sourceExportUri } from '../provenance/exports.js';
import { withTransaction } from '../storage/transaction.js';
import { invalidState, notFound } from '../util/errors.js';
import { guard, ok, type ToolContext } from './context.js';

const formatSchema = z.enum(['inventory', 'cyclonedx']);
const revisionSchema = z.number().int().nonnegative().safe();
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
function snapshot(state: SourceInventory, format: z.infer<typeof formatSchema>) {
  const bytes = Buffer.from(`${JSON.stringify(format === 'inventory' ? state : sourceInventoryCycloneDx(state), null, 2)}\n`);
  if (bytes.length > MAX_SOURCE_EXPORT_BYTES) throw invalidState('Source export exceeds byte limit');
  const expectedSha256 = createHash('sha256').update(bytes).digest('hex');
  return { bytes, plan: { format, expectedRevision: state.revision, expectedSha256, bytes: bytes.length } };
}
function uri(id: string, hash: string) { return `game-dev://sources/records/${id}/${hash}`; }
async function location(ctx: ToolContext) {
  // Configured root may use the platform /var alias; all private subpaths remain symlink-refusing.
  const root = await fs.realpath(ctx.config.outputDir);
  const directory = path.join(root, '.provenance');
  return { directory, ledger: await SourceLedger.open(directory) };
}
async function exportSnapshot(directory: string, bytes: Buffer, name: string) {
  const exports = path.join(directory, 'exports');
  await SourceLedger.open(exports); // reject symlink/non-directory ancestors, including existing exports
  await fs.mkdir(exports, { recursive: true });
  await SourceLedger.open(exports);
  const file = path.join(exports, name);
  let handle;
  try { handle = await fs.open(file, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const info = await fs.lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size !== bytes.length) throw invalidState('Existing export does not match the approved bytes');
    const existing = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await existing.stat();
      if (opened.dev !== info.dev || opened.ino !== info.ino || opened.nlink !== 1 || opened.size !== bytes.length) throw invalidState('Existing export changed during verification');
      const read = Buffer.alloc(bytes.length + 1);
      let total = 0;
      while (total < read.length) { const result = await existing.read(read, total, read.length - total, null); if (!result.bytesRead) break; total += result.bytesRead; }
      if (!read.subarray(0, total).equals(bytes)) throw invalidState('Existing export does not match the approved bytes');
    } finally { await existing.close(); }
    return { file, reused: true };
  }
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  try { const dir = await fs.open(exports, 'r'); try { await dir.sync(); } finally { await dir.close(); } }
  catch (error) { if (!['EINVAL', 'ENOTSUP', 'EISDIR', 'EPERM', 'EACCES'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error; }
  return { file, reused: false };
}
export function registerProvenanceTools(registry: ToolRegistrar, ctx: ToolContext): void {
  const annotations = (readOnly: boolean) => ({ readOnlyHint: readOnly, destructiveHint: false, idempotentHint: readOnly, openWorldHint: false });
  registry.registerTool('plan_source_record', {
    family: 'provenance', description: 'FREE read-only source/license evidence plan. Records declarations, never legal clearance. Resolves canonical record hash and current ledger revision; does not write.',
    inputPolicy: 'strict', inputSchema: { record: sourceRecordSchema }, annotations: annotations(true),
  }, guard(ctx.logger, 'plan_source_record', async args => {
    const { ledger } = await location(ctx); const state = await ledger.inventory();
    return ok({ ...planSourceRecord(args.record), expectedRevision: state.revision });
  }));
  registry.registerTool('record_source_evidence', {
    family: 'provenance', description: 'Persist source/license declarations matching the reviewed record hash and ledger revision. Requires fresh transport confirmation. No independent rights verification or distribution authority is granted.',
    inputPolicy: 'strict', inputSchema: { record: sourceRecordSchema, expectedRevision: revisionSchema, expectedSha256: hashSchema }, annotations: annotations(false),
  }, guard(ctx.logger, 'record_source_evidence', async args => {
    const { ledger } = await location(ctx); const state = await ledger.record(args.record, args); const hash = planSourceRecord(args.record).sha256;
    return ok({ schema: 'game_dev.source_record_result.v1', revision: state.revision, id: args.record.id, sha256: hash, uri: uri(args.record.id, hash), independentlyVerified: false, authorizationGranted: false });
  }));
  registry.registerTool('inspect_source_ledger', {
    family: 'provenance', description: 'FREE bounded source evidence summaries or explicit single-record detail. Returns snapshot export plans, not the full inventory by default. Performs no writes.',
    inputPolicy: 'strict', inputSchema: { id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/).optional(), offset: z.number().int().min(0).max(2000).default(0), limit: z.number().int().min(1).max(100).default(20) }, annotations: annotations(true),
  }, guard(ctx.logger, 'inspect_source_ledger', async args => {
    const { ledger } = await location(ctx); const state = await ledger.inventory();
    const exportPlans = [snapshot(state, 'inventory').plan, snapshot(state, 'cyclonedx').plan];
    if (args.id) {
      const entry = state.records.find(item => item.record.id === args.id); if (!entry) throw notFound('Source evidence', args.id);
      return ok({ schema: 'game_dev.source_detail.v1', revision: state.revision, ...entry, uri: uri(entry.record.id, entry.sha256), exportPlans });
    }
    return ok({ schema: 'game_dev.source_inventory_summary.v1', revision: state.revision, total: state.records.length, offset: args.offset,
      records: state.records.slice(args.offset, args.offset + args.limit).map(({ record, sha256 }) => ({ id: record.id, kind: record.kind, name: record.name, version: record.version, sha256, uri: uri(record.id, sha256), verification: record.verification.status, rights: Object.fromEntries((['code', 'model', 'output'] as const).map(domain => [domain, redistributionAssessment(record, domain)])) })),
      nextOffset: args.offset + args.limit < state.records.length ? args.offset + args.limit : null, exportPlans });
  }));
  registry.registerTool('export_source_ledger', {
    family: 'provenance', description: 'Export a reviewed inventory or CycloneDX 1.6 snapshot to a fixed hash-named local file. Requires fresh transport confirmation. No public publishing or arbitrary destination. Unchanged existing bytes may be reused.',
    inputPolicy: 'strict', inputSchema: { format: formatSchema, expectedRevision: revisionSchema, expectedSha256: hashSchema }, annotations: annotations(false),
  }, guard(ctx.logger, 'export_source_ledger', async args => {
    const { ledger, directory } = await location(ctx);
    await fs.mkdir(directory, { recursive: true }); await SourceLedger.open(directory);
    return withTransaction(path.join(directory, 'source-ledger.json'), async () => {
      const state = await ledger.inventory(); const prepared = snapshot(state, args.format);
      if (state.revision !== args.expectedRevision || prepared.plan.expectedSha256 !== args.expectedSha256) throw invalidState('Source export differs from the reviewed snapshot');
      const saved = await exportSnapshot(directory, prepared.bytes, `${args.format}-${args.expectedSha256}.json`);
      return ok({ schema: 'game_dev.source_export.v1', ...prepared.plan, ...saved, path: saved.file,
        uri: sourceExportUri(args.format, args.expectedSha256), independentlyVerified: false, certification: 'not certified; evidence inventory only' });
    });
  }));
}
