import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { safeJoin, writeJsonAtomic } from '../storage/filesystem.js';
import { durableJobSchema } from '../jobs/durable.js';

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function hashFile(file: string): Promise<string> {
  const hash = createHash('sha256');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!(await handle.stat()).isFile()) throw new Error('Hash input must be a regular file');
    const buffer = Buffer.alloc(64 * 1024);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    return hash.digest('hex');
  } finally { await handle.close(); }
}
const relativePath = z.string().min(1).refine(p => !path.isAbsolute(p) && !p.split(/[\\/]/).some(s => s === '..' || s === '') && !p.startsWith('.retention'), 'Unsafe workspace path');
const entrySchema = z.object({ path: relativePath, bytes: z.number().int().nonnegative(), sha256: z.string().regex(/^[a-f0-9]{64}$/), classification: z.enum(['original', 'derived', 'capture', 'metadata', 'unknown']), protectedBy: z.array(z.string()) }).strict();
export const retentionPlanSchema = z.object({ schema: z.literal('game_dev.retention_plan.v1'), root: z.string(), metadataRoots: z.array(z.string()), action: z.enum(['quarantine', 'export']), files: z.array(entrySchema), blockers: z.array(z.string()), totalBytes: z.number(), id: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type RetentionPlan = z.infer<typeof retentionPlanSchema>;
type Entry = z.infer<typeof entrySchema>;
const isInside = (root: string, target: string) => { const rel = path.relative(root, target); return rel === '' || (!rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel)); };
// Comparison only: compatibility normalization and upper/lower folding deliberately overprotect aliases.
const referenceKey = (value: string) => value.normalize('NFKC').toUpperCase().toLowerCase().normalize('NFC');
const isReferenced = (reference: string, file: string) => isInside(referenceKey(reference), referenceKey(file));
const evidenceCeiling = 'Measured logical file bytes and local hashes only; no physical space reclamation, provider regeneration, engine compatibility or human review is proven. Quarantine preserves bytes on the same volume.';


async function assertNoLinks(root: string, target: string): Promise<void> {
  if (!isInside(root, target)) throw new Error('Path escapes workspace');
  let current = root;
  for (const segment of path.relative(root, target).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    try { if ((await fs.lstat(current)).isSymbolicLink()) throw new Error(`Symlink is refused: ${current}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error; }
  }
}

async function syncDirectory(directory: string): Promise<void> {
  try {
    const handle = await fs.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EINVAL' && code !== 'ENOTSUP' && !(process.platform === 'win32' && (code === 'EPERM' || code === 'EISDIR'))) throw error;
  }
}

async function syncParents(directory: string, root: string): Promise<void> {
  if (!isInside(root, directory)) throw new Error('Directory flush escapes workspace');
  for (let current = directory; ; current = path.dirname(current)) {
    await syncDirectory(current);
    if (current === root) break;
  }
}
async function writeReceipt(directory: string, receipt: unknown): Promise<void> {
  await writeJsonAtomic(path.join(directory, 'receipt.json'), receipt);
  await syncDirectory(directory);
}

async function filesUnder(root: string, omitRetention = true): Promise<{ files: string[]; blockers: string[] }> {
  const files: string[] = [], blockers: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const child of (await fs.readdir(dir, { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (omitRetention && child.name === '.retention') continue;
      const full = path.join(dir, child.name);
      if (child.isSymbolicLink()) { blockers.push(`Symlink is not traversed: ${full}`); continue; }
      if (child.isDirectory()) await walk(full);
      else if (child.isFile()) files.push(full);
      else blockers.push(`Unsupported file type: ${full}`);
    }
  }
  await walk(root); return { files, blockers };
}
function classify(p: string): Entry['classification'] {
  const segments = p.toLowerCase().split(path.sep);
  if (segments.some(s => ['source', 'sources', 'originals'].includes(s))) return 'original';
  if (/\.(json|jsonl|sqlite3?|db)(-wal|-shm)?$/i.test(p)) return 'metadata';
  if (segments.some(s => ['captures', 'capture', 'frames', 'runs'].includes(s))) return 'capture';
  if (segments.some(s => ['derived', 'previews', 'cache', 'normalized', 'variants'].includes(s))) return 'derived';
  return 'unknown';
}

/** Preserve lexical references to quarantined originals even while their leaf is absent. */
async function canonicalReference(input: string): Promise<string> {
  let current = path.resolve(input);
  const suffix: string[] = [];
  for (;;) {
    try { return path.join(await fs.realpath(current), ...suffix); }
    catch (error) {
      if (!['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error;
      const parent = path.dirname(current);
      if (parent === current) throw error;
      suffix.unshift(path.basename(current)); current = parent;
    }
  }
}

const retentionControlNames = new Set(['execute_workspace_retention', 'restore_workspace_retention', 'purge_workspace_retention']);
function controlName(operation: string): string | undefined {
  const name = operation.replace(/^tool\.(?:call\.)?/, '');
  return (operation === `tool.${name}` || operation === `tool.call.${name}`) && retentionControlNames.has(name) ? name : undefined;
}
function controlResult(value: unknown): unknown {
  // Exact result schemas only. Unknown fields/results remain conservative references.
  const retained = receiptSchema.extend({ evidenceCeiling: z.string(), bytesReclaimed: z.number().optional() }).safeParse(value);
  if (retained.success) { const { plan: _plan, moved: _moved, ...identity } = retained.data; return identity; }
  const purged = purgeJournalSchema.extend({ unlinkedFileBytes: z.number(), reconciledAbsentFileBytes: z.number(), actualFilesystemBytesFreed: z.null(), evidenceCeiling: z.string() }).safeParse(value);
  if (purged.success) { const { outcomes: _outcomes, pending: _pending, ...identity } = purged.data; return identity; }
  return value;
}
/** Configuration and deletion audit intent are not artifact-retention claims. */
function referencePayload(value: unknown): unknown {
  const job = durableJobSchema.safeParse(value);
  if (job.success) {
    const data = job.data;
    const request = { ...data.request };
    const cli = z.object({ positionals: z.array(z.string()).min(2), flags: z.record(z.unknown()), input: z.unknown().optional() }).strict().safeParse(request);
    if (cli.success && cli.data.positionals.slice(0, ['tool', 'provider'].includes(cli.data.positionals[0]!) ? 3 : 2).join('.') === data.operation) {
      const flags = { ...cli.data.flags }; delete flags['output-dir']; request.flags = flags;
    }
    const name = controlName(data.operation);
    if (name && data.operation === `tool.call.${name}` && JSON.stringify(request.positionals) === JSON.stringify(['tool', 'call', name])) {
      const input = z.object({ plan: z.unknown() }).strict().safeParse(request.input);
      if (input.success && (retentionPlanSchema.safeParse(input.data.plan).success || purgePlanSchema.safeParse(input.data.plan).success)) request.input = {};
    }
    return { ...data, request }; // Explicit artifacts, receipt paths, errors and all other inputs are retained.
  }
  const receipt = z.object({ schema: z.literal('game_dev.receipt.v1'), operation: z.string(), result: z.unknown(), completedAt: z.string().datetime() }).strict().safeParse(value);
  if (receipt.success && controlName(receipt.data.operation)) return { ...receipt.data, result: controlResult(receipt.data.result) };
  const event = z.object({ schema: z.literal('game_dev.event.v1'), event_id: z.string(), job_id: z.string(), sequence: z.number().int(), timestamp: z.string().datetime(), type: z.string(), operation: z.string(), data: z.unknown() }).strict().safeParse(value);
  if (event.success && controlName(event.data.operation) && event.data.type === 'completed') return { ...event.data, data: controlResult(event.data.data) };
  return value;
}

/** Conservatively protects all records, package/job/baseline trees, and every referenced path. */
async function inspectWorkspaceState(rootInput: string, metadataRootsInput: string[], measureFiles: boolean) {
  const root = await fs.realpath(rootInput);
  const metadataRoots: string[] = [];
  for (const input of metadataRootsInput) {
    try { metadataRoots.push(await fs.realpath(input)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  metadataRoots.sort();
  const scan = await filesUnder(root), references = new Map<string, Set<string>>();
  const referencedDigests = new Map<string, Set<string>>();
  const blockers = [...scan.blockers];
  const metadataFiles = new Set(scan.files.filter(p => /\.jsonl?$/i.test(p)));
  for (const external of metadataRoots.filter(p => !isInside(root, p))) {
    const extra = await filesUnder(external); blockers.push(...extra.blockers);
    extra.files.filter(p => /\.jsonl?$/i.test(p)).forEach(p => metadataFiles.add(p));
  }
  function strings(value: unknown, record: string): void {
    if (typeof value === 'string') {
      if (/^[a-f0-9]{64}$/i.test(value)) { const key = value.toLowerCase(); const sources = referencedDigests.get(key) ?? new Set<string>(); sources.add(record); referencedDigests.set(key, sources); }
      for (const candidate of [path.resolve(root, value), path.resolve(path.dirname(record), value)]) {
        const sources = references.get(candidate) ?? new Set<string>(); sources.add(record); references.set(candidate, sources);
      }
    } else if (Array.isArray(value)) value.forEach(v => strings(v, record));
    else if (value && typeof value === 'object') Object.values(value).forEach(v => strings(v, record));
  }
  for (const record of [...metadataFiles].sort()) {
    try {
      if ((await fs.stat(record)).size > 16 * 1024 * 1024) throw new Error('metadata exceeds 16 MiB safety bound');
      const raw = await fs.readFile(record, 'utf8');
      if (/\.jsonl$/i.test(record)) raw.split('\n').filter(Boolean).forEach(line => strings(referencePayload(JSON.parse(line)), record));
      else strings(referencePayload(JSON.parse(raw)), record);
    } catch (error) { blockers.push(`Unreadable metadata ${record}: ${String(error)}`); }
  }
  // Canonicalize reference aliases (e.g. /var -> /private/var on macOS).
  const normalizedReferences = new Map<string, Set<string>>();
  for (const [candidate, records] of references) {
    let canonical: string;
    try { canonical = await canonicalReference(candidate); } catch { continue; }
    if (!isReferenced(root, canonical)) continue;
    const merged = normalizedReferences.get(canonical) ?? new Set<string>();
    records.forEach(record => merged.add(record)); normalizedReferences.set(canonical, merged);
  }
  const entries: Entry[] = [];
  for (const file of measureFiles ? scan.files : []) {
    const p = path.relative(root, file), classification = classify(p), protectedBy: string[] = [];
    if (['original', 'metadata', 'unknown'].includes(classification)) protectedBy.push(`preserve-${classification}`);
    if (p.split(path.sep).some(s => ['baselines', 'baseline', 'packages', 'jobs', '.jobs'].includes(s))) protectedBy.push('protected-record-tree');
    for (const [reference, records] of normalizedReferences) if (isReferenced(reference, file)) protectedBy.push(...records);
    const sha256 = await hashFile(file);
    protectedBy.push(...(referencedDigests.get(sha256) ?? []));
    entries.push({ path: p, bytes: (await fs.stat(file)).size, sha256, classification, protectedBy: [...new Set(protectedBy)].sort() });
  }
  const totals = Object.fromEntries(['original','derived','capture','metadata','unknown'].map(c => [c, entries.filter(e => e.classification === c).reduce((n,e) => n + e.bytes, 0)]));
  return { schema: 'game_dev.workspace_inventory.v1', root, metadataRoots, entries, totals, blockers, references: [...normalizedReferences].map(([path, records]) => ({ path, records: [...records].sort() })), referencedDigests: [...referencedDigests].map(([sha256, records]) => ({ sha256, records: [...records].sort() })), evidenceCeiling };
}

export async function inspectWorkspace(rootInput: string, metadataRootsInput: string[] = []) {
  return inspectWorkspaceState(rootInput, metadataRootsInput, true);
}

export async function planRetention(root: string, options: { action?: 'quarantine' | 'export'; paths?: string[]; metadataRoots?: string[] } = {}): Promise<RetentionPlan> {
  const inventory = await inspectWorkspace(root, options.metadataRoots);
  const action = options.action ?? 'quarantine';
  const selected = options.paths ? new Set(options.paths.map(p => relativePath.parse(p))) : undefined;
  if (selected && [...selected].some(p => !inventory.entries.some(e => e.path === p))) throw new Error('Requested path is not a regular workspace file');
  const files = inventory.entries.filter(e => (!selected || selected.has(e.path)) && (action === 'export' || e.protectedBy.length === 0));
  if (selected && action === 'quarantine' && files.length !== selected.size) throw new Error('Selected files include protected originals, records, or referenced artifacts');
  const body = { schema: 'game_dev.retention_plan.v1' as const, root: inventory.root, metadataRoots: inventory.metadataRoots, action, files, blockers: inventory.blockers, totalBytes: files.reduce((n,e) => n + e.bytes, 0) };
  return { ...body, id: digest(body) };
}
async function validatePlan(input: unknown, root: string, metadataRoots: string[]): Promise<RetentionPlan> {
  const plan = retentionPlanSchema.parse(input);
  if (plan.root !== await fs.realpath(root)) throw new Error('Plan root does not match configured workspace');
  const fresh = await planRetention(root, { action: plan.action, paths: plan.files.map(e => e.path), metadataRoots });
  if (fresh.id !== plan.id) {
    throw new Error('Plan is stale or modified; review a new plan');
  }
  if (JSON.stringify(plan) !== JSON.stringify(fresh)) throw new Error('Plan payload was modified');
  if (plan.blockers.length) throw new Error('Workspace metadata or filesystem is uncertain; resolve inventory blockers first');
  return plan;
}
async function withLock<T>(root: string, body: (store: string) => Promise<T>): Promise<T> {
  const store = path.join(await fs.realpath(root), '.retention');
  await fs.mkdir(store, { recursive: true });
  if ((await fs.lstat(store)).isSymbolicLink()) throw new Error('Retention storage cannot be a symlink');
  const lock = path.join(store, 'operation.lock');
  await fs.mkdir(lock); // Fail closed on concurrent or interrupted operations; never steal a lock.
  try { return await body(store); } finally { await fs.rmdir(lock); }
}
const receiptSchema = z.object({ schema: z.literal('game_dev.retention_receipt.v1'), id: z.string().uuid(), plan: retentionPlanSchema, state: z.enum(['moving', 'quarantined', 'restoring', 'restored']), moved: z.array(relativePath) }).strict();
function parseReceipt(value: unknown) {
  const receipt = receiptSchema.parse(value);
  const { id: planId, ...body } = receipt.plan;
  if (digest(body) !== planId || body.action !== 'quarantine' || receipt.moved.some(p => !body.files.some(f => f.path === p))) throw new Error('Receipt plan integrity mismatch');
  return receipt;
}


export async function quarantineWorkspace(root: string, input: unknown, metadataRoots: string[] = []) {
  return withLock(root, async store => {
    const plan = await validatePlan(input, root, metadataRoots);
    if (plan.action !== 'quarantine') throw new Error('Expected quarantine plan');
    const id = randomUUID(), directory = path.join(store, id);
    await fs.mkdir(directory);
    await syncParents(directory, plan.root);
    const receipt = receiptSchema.parse({ schema: 'game_dev.retention_receipt.v1', id, plan, state: 'moving', moved: [] });
    await writeReceipt(directory, receipt);
    for (const file of plan.files) {
      const source = safeJoin(plan.root, file.path), destination = safeJoin(directory, 'files', file.path);
      await fs.mkdir(path.dirname(destination), { recursive: true });
      if (!isInside(plan.root, await fs.realpath(source)) || (await fs.lstat(source)).isSymbolicLink() || await hashFile(source) !== file.sha256) throw new Error('Source changed during quarantine');
      await assertNoLinks(plan.root, source);
      await assertNoLinks(store, destination);
      await fs.rename(source, destination);
      if (await hashFile(destination) !== file.sha256) throw new Error('Quarantine bytes changed during move; receipt retained for recovery');
      await syncParents(path.dirname(destination), plan.root);
      await syncDirectory(path.dirname(source));
      receipt.moved.push(file.path);
      await writeReceipt(directory, receipt);
    }
    receipt.state = 'quarantined';
    await writeReceipt(directory, receipt);
    return { ...receipt, evidenceCeiling, bytesReclaimed: 0 };
  });
}
export async function listRetentionReceipts(root: string) {
  const store = path.join(await fs.realpath(root), '.retention');
  await assertNoLinks(await fs.realpath(root), store);
  const receipts: unknown[] = [];
  let entries; try { entries = await fs.readdir(store, { withFileTypes: true }); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return receipts; throw error; }
  for (const entry of entries) {
    if (entry.name === 'operation.lock') { receipts.push({ blocker: 'An active or interrupted retention operation holds operation.lock. Inspect receipts before manually clearing a stale lock.' }); continue; }
    if (!entry.isDirectory() || !z.string().uuid().safeParse(entry.name).success) continue;
    try {
      const directory = path.join(store, entry.name);
      await assertNoLinks(store, path.join(directory, 'receipt.json'));
      const receipt = parseReceipt(JSON.parse(await fs.readFile(path.join(directory, 'receipt.json'), 'utf8')));
      const purge = await readPurgeJournal(directory, receipt);
      receipts.push({ ...receipt, ...(purge ? { purge } : {}) });
    }
    catch (error) { receipts.push({ id: entry.name, blocker: `Corrupt receipt: ${String(error)}` }); }
  }
  return receipts;
}
export async function restoreWorkspace(root: string, receiptId: string) {
  z.string().uuid().parse(receiptId);
  return withLock(root, async store => {
    const directory = path.join(store, receiptId);
    await assertNoLinks(store, directory);
    if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error('Receipt directory cannot be a symlink');
    await assertNoLinks(store, path.join(directory, 'receipt.json'));
    const receipt = parseReceipt(JSON.parse(await fs.readFile(path.join(directory, 'receipt.json'), 'utf8')));
    if (receipt.id !== receiptId || receipt.plan.root !== await fs.realpath(root)) throw new Error('Receipt identity mismatch');
    if (await readPurgeJournal(directory, receipt)) throw new Error('Irreversible purge has started; this receipt can no longer be restored as a whole');
    receipt.state = 'restoring';
    await writeReceipt(directory, receipt);
    // Examine all planned files, including a rename completed before a crash could journal it.
    for (const file of receipt.plan.files) {
      const source = safeJoin(directory, 'files', file.path), destination = safeJoin(receipt.plan.root, file.path);
      await assertNoLinks(directory, source);
      await assertNoLinks(await fs.realpath(root), path.resolve(destination));
      let present = true; try { await fs.lstat(source); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') present = false; else throw error; }
      if (!present) { if (await hashFile(destination) !== file.sha256) throw new Error(`Cannot verify already restored file: ${file.path}`); continue; }
      if ((await fs.lstat(source)).isSymbolicLink() || await hashFile(source) !== file.sha256) throw new Error('Quarantine content changed');
      await fs.mkdir(path.dirname(destination), { recursive: true });
      const realParent = await fs.realpath(path.dirname(destination));
      if (!isInside(await fs.realpath(root), realParent)) throw new Error('Restore destination escapes workspace');
      // Exclusive copy prevents replacement. Interrupted copies can be inspected/recovered, never overwritten.
      try { await fs.copyFile(source, destination, constants.COPYFILE_EXCL); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || (await fs.lstat(destination)).isSymbolicLink() || await hashFile(destination) !== file.sha256) throw error;
        // An identical destination is safe after a crash between copy and unlink.
      }
      // Never discard the recoverable source until the restored bytes are verified and flushed.
      await assertNoLinks(receipt.plan.root, destination);
      if (await hashFile(destination) !== file.sha256) throw new Error('Restored bytes changed; quarantine source retained');
      const restored = await fs.open(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { await restored.sync(); } finally { await restored.close(); }
      await syncParents(path.dirname(destination), receipt.plan.root);
      await assertNoLinks(directory, source);
      await fs.unlink(source);
      await syncDirectory(path.dirname(source));
    }
    receipt.state = 'restored';
    await writeReceipt(directory, receipt);
    return { ...receipt, evidenceCeiling };
  });
}
export async function exportWorkspace(root: string, input: unknown, destinationInput: string, metadataRoots: string[] = []) {
  const plan = await validatePlan(input, root, metadataRoots);
  if (plan.action !== 'export') throw new Error('Expected export plan');
  const destination = await fs.realpath(destinationInput);
  if (!(await fs.stat(destination)).isDirectory() || isInside(plan.root, destination) || isInside(destination, plan.root)) throw new Error('Export destination must be an existing folder outside the workspace and its ancestors');
  const bundle = path.join(destination, `workspace-export-${plan.id.slice(0,16)}-${randomUUID()}`);
  await fs.mkdir(bundle);
  await writeJsonAtomic(path.join(bundle, 'export.json'), { schema: 'game_dev.workspace_export.v1', state: 'copying', plan });
  for (const file of plan.files) {
    const source = safeJoin(root, file.path), target = safeJoin(bundle, 'files', file.path);
    if (!isInside(plan.root, await fs.realpath(source)) || (await fs.lstat(source)).isSymbolicLink()) throw new Error('Source escaped workspace');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(source, target, constants.COPYFILE_EXCL);
    if (await hashFile(target) !== file.sha256) throw new Error('Export source changed; incomplete bundle retained for inspection');
  }
  await writeJsonAtomic(path.join(bundle, 'export.json'), { schema: 'game_dev.workspace_export.v1', state: 'verified', plan });
  return { schema: 'game_dev.workspace_export.v1', bundle, planId: plan.id, files: plan.files.length, bytes: plan.totalBytes, evidenceCeiling };
}

const irreversibleWarning = 'IRREVERSIBLE: permanently deletes the listed quarantine files. They cannot be restored from this receipt after purge. Review/export any needed bytes before confirming. ALL other workspace and quarantine writers must be stopped; portable path checks do not isolate hostile concurrent writers.';
const purgeEntrySchema = entrySchema.pick({ path: true, bytes: true, sha256: true });
export const purgePlanSchema = z.object({
  schema: z.literal('game_dev.retention_purge_plan.v1'),
  root: z.string(), receiptId: z.string().uuid(), receiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  journalSha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  metadataRoots: z.array(z.string()), files: z.array(purgeEntrySchema), interruptedMissing: z.array(purgeEntrySchema),
  blockers: z.array(z.string()), totalBytes: z.number().int().nonnegative(),
  irreversibleWarning: z.literal(irreversibleWarning), id: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type PurgePlan = z.infer<typeof purgePlanSchema>;
const purgeJournalSchema = z.object({
  schema: z.literal('game_dev.retention_purge_receipt.v1'), receiptId: z.string().uuid(),
  receiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
  approvedPlanIds: z.array(z.string().regex(/^[a-f0-9]{64}$/)).min(1),
  state: z.enum(['purging', 'partial', 'completed']),
  pending: relativePath.nullable(),
  outcomes: z.array(z.object({ path: relativePath, outcome: z.enum(['unlinked', 'absent-after-interruption']) }).strict()),
  error: z.string().optional(), updatedAt: z.string(),
}).strict();
type PurgeJournal = z.infer<typeof purgeJournalSchema>;
type Receipt = ReturnType<typeof parseReceipt>;

async function readPurgeJournal(directory: string, receipt: Receipt): Promise<PurgeJournal | undefined> {
  const file = path.join(directory, 'purge.json');
  await assertNoLinks(directory, file);
  let bytes: Buffer;
  try { bytes = await fs.readFile(file); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw error; }
  const journal = purgeJournalSchema.parse(JSON.parse(bytes.toString('utf8')));
  const paths = receipt.plan.files.map(file => file.path);
  if (journal.receiptId !== receipt.id || journal.receiptSha256 !== await hashFile(path.join(directory, 'receipt.json'))
    || new Set(journal.outcomes.map(item => item.path)).size !== journal.outcomes.length
    || journal.outcomes.some(item => !paths.includes(item.path))
    || (journal.pending !== null && (!paths.includes(journal.pending) || journal.outcomes.some(item => item.path === journal.pending)))
    || (journal.state === 'completed' && (journal.pending !== null || journal.outcomes.length !== paths.length))) {
    throw new Error('Purge journal integrity mismatch');
  }
  return journal;
}
async function writePurgeJournal(directory: string, journal: PurgeJournal): Promise<void> {
  journal.updatedAt = new Date().toISOString();
  await writeJsonAtomic(path.join(directory, 'purge.json'), journal);
  await syncDirectory(directory);
}
async function purgeContext(rootInput: string, receiptId: string) {
  z.string().uuid().parse(receiptId);
  const root = await fs.realpath(rootInput);
  const directory = path.join(root, '.retention', receiptId);
  await assertNoLinks(root, path.join(directory, 'receipt.json'));
  const receipt = parseReceipt(JSON.parse(await fs.readFile(path.join(directory, 'receipt.json'), 'utf8')));
  if (receipt.id !== receiptId || receipt.plan.root !== root || receipt.state !== 'quarantined') throw new Error('Purge requires a matching completed quarantine receipt');
  if (receipt.moved.length !== receipt.plan.files.length || new Set(receipt.moved).size !== receipt.moved.length) throw new Error('Quarantine receipt has an incomplete move roster');
  return { root, directory, receipt, journal: await readPurgeJournal(directory, receipt) };
}
function purgeProtections(inventory: Awaited<ReturnType<typeof inspectWorkspace>>, directory: string, file: Entry): string[] {
  const reasons = [...file.protectedBy];
  if (!['derived', 'capture'].includes(classify(file.path))) reasons.push('protected file classification');
  if (file.path.toLowerCase().split(path.sep).some(s => ['baselines', 'baseline', 'packages', 'jobs', '.jobs'].includes(s))) reasons.push('protected record tree');
  const original = safeJoin(inventory.root, file.path), quarantined = safeJoin(directory, 'files', file.path);
  for (const ref of inventory.references) if (isReferenced(ref.path, original) || isReferenced(ref.path, quarantined)) reasons.push(...ref.records);
  for (const ref of inventory.referencedDigests) if (ref.sha256 === file.sha256) reasons.push(...ref.records);
  return [...new Set(reasons)];
}

/** Dry-run only. Missing originals still participate in protection checks. */
export async function planWorkspacePurge(rootInput: string, receiptId: string, metadataRoots: string[] = []): Promise<PurgePlan> {
  const { root, directory, receipt, journal } = await purgeContext(rootInput, receiptId);
  for (const historical of receipt.plan.metadataRoots) {
    try { await fs.realpath(historical); } catch { throw new Error(`Previously protected metadata root is unavailable: ${historical}`); }
  }
  const protectionRoots = [...new Set([...metadataRoots, ...receipt.plan.metadataRoots])];
  const inventory = await inspectWorkspaceState(root, protectionRoots, false);
  const scan = await filesUnder(directory, false);
  const blockers = [...inventory.blockers, ...scan.blockers];
  const expected = new Set([path.join(directory, 'receipt.json'), ...(journal ? [path.join(directory, 'purge.json')] : []), ...receipt.plan.files.map(file => safeJoin(directory, 'files', file.path))]);
  for (const file of scan.files) if (!expected.has(file)) blockers.push(`Unrostered quarantine file: ${file}`);
  const files: PurgePlan['files'] = [], interruptedMissing: PurgePlan['interruptedMissing'] = [];
  for (const file of receipt.plan.files) {
    const target = safeJoin(directory, 'files', file.path), outcome = journal?.outcomes.find(item => item.path === file.path);
    let stat;
    try { await assertNoLinks(directory, target); stat = await fs.lstat(target); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { blockers.push(`${file.path}: ${String(error)}`); continue; } }
    if (!stat) {
      if (outcome) continue;
      if (journal?.pending === file.path) { interruptedMissing.push({ path: file.path, bytes: file.bytes, sha256: file.sha256 }); continue; }
      blockers.push(`Quarantine file missing without a recorded purge attempt: ${file.path}`); continue;
    }
    if (outcome) { blockers.push(`Previously purged path has reappeared: ${file.path}`); continue; }
    if (!stat.isFile() || stat.isSymbolicLink()) { blockers.push(`Not a regular quarantine file: ${file.path}`); continue; }
    if (stat.size !== file.bytes || await hashFile(target) !== file.sha256) { blockers.push(`Quarantine bytes changed: ${file.path}`); continue; }
    const reasons = purgeProtections(inventory, directory, file);
    if (reasons.length) blockers.push(`Protected ${file.path}: ${reasons.join(', ')}`);
    files.push({ path: file.path, bytes: file.bytes, sha256: file.sha256 });
  }
  const body = {
    schema: 'game_dev.retention_purge_plan.v1' as const, root, receiptId,
    receiptSha256: await hashFile(path.join(directory, 'receipt.json')),
    journalSha256: journal ? await hashFile(path.join(directory, 'purge.json')) : null,
    metadataRoots: inventory.metadataRoots, files, interruptedMissing, blockers: [...new Set(blockers)].sort(),
    totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), irreversibleWarning: irreversibleWarning as typeof irreversibleWarning,
  };
  return { ...body, id: digest(body) };
}
function purgeResult(journal: PurgeJournal, receipt: Receipt) {
  const bytes = (outcome: 'unlinked' | 'absent-after-interruption') => journal.outcomes.filter(item => item.outcome === outcome).reduce((sum, item) => sum + receipt.plan.files.find(file => file.path === item.path)!.bytes, 0);
  return {
    ...journal, unlinkedFileBytes: bytes('unlinked'), reconciledAbsentFileBytes: bytes('absent-after-interruption'),
    actualFilesystemBytesFreed: null,
    evidenceCeiling: 'Unlinked file bytes are verified logical sizes whose directory entries were removed. Filesystem space reclaimed is unknown: hard links, snapshots, sparse/compressed storage and open handles can retain blocks. Missing files reconciled after interruption are reported separately; their removal cannot be attributed with certainty. Purge cannot restore deleted content.',
  };
}

/** Caller must obtain a fresh human confirmation for this exact plan, including on resume. */
export async function purgeWorkspaceRetention(rootInput: string, input: unknown, metadataRoots: string[] = []) {
  const plan = purgePlanSchema.parse(input);
  return withLock(rootInput, async () => {
    const fresh = await planWorkspacePurge(rootInput, plan.receiptId, metadataRoots);
    if (JSON.stringify(fresh) !== JSON.stringify(plan)) throw new Error('Purge plan is stale or modified; review a fresh plan');
    if (plan.blockers.length) throw new Error('Purge is blocked by protected references or uncertain quarantine state');
    const { directory, receipt, journal: previous } = await purgeContext(rootInput, plan.receiptId);
    if (previous?.state === 'completed') return purgeResult(previous, receipt);
    const journal: PurgeJournal = previous ?? {
      schema: 'game_dev.retention_purge_receipt.v1', receiptId: receipt.id, receiptSha256: plan.receiptSha256,
      approvedPlanIds: [], state: 'purging', pending: null, outcomes: [], updatedAt: new Date().toISOString(),
    };
    journal.approvedPlanIds.push(plan.id); journal.state = 'purging'; delete journal.error;
    for (const missing of plan.interruptedMissing) journal.outcomes.push({ path: missing.path, outcome: 'absent-after-interruption' });
    if (plan.interruptedMissing.length) journal.pending = null;
    await writePurgeJournal(directory, journal);
    try {
      for (const selected of plan.files) {
        // Refresh the complete reference graph before each irreversible deletion.
        for (const historical of receipt.plan.metadataRoots) await fs.realpath(historical);
        if (await hashFile(path.join(directory, 'receipt.json')) !== plan.receiptSha256) throw new Error('Quarantine receipt changed during purge');
        const inventory = await inspectWorkspaceState(plan.root, [...new Set([...metadataRoots, ...receipt.plan.metadataRoots])], false);
        const file = receipt.plan.files.find(item => item.path === selected.path)!;
        if (inventory.blockers.length || purgeProtections(inventory, directory, file).length) throw new Error(`References or metadata changed before deleting ${file.path}`);
        const target = safeJoin(directory, 'files', file.path);
        await assertNoLinks(plan.root, target);
        if (await hashFile(target) !== file.sha256 || (await fs.lstat(target)).size !== file.bytes) throw new Error(`Quarantine bytes changed before deleting ${file.path}`);
        journal.pending = file.path;
        await writePurgeJournal(directory, journal); // Intent is durable before unlink, for interrupted recovery.
        await assertNoLinks(plan.root, target);
        const last = await fs.lstat(target);
        if (!last.isFile() || last.isSymbolicLink() || await hashFile(target) !== file.sha256) throw new Error(`Quarantine target changed before unlink: ${file.path}`);
        const parentBefore = await fs.lstat(path.dirname(target));
        await fs.unlink(target);
        // Detect observed path replacement before claiming a confirmed unlink. Node has no portable unlinkat(dirfd).
        await assertNoLinks(plan.root, target);
        const parentAfter = await fs.lstat(path.dirname(target));
        if (!parentAfter.isDirectory() || parentAfter.dev !== parentBefore.dev || parentAfter.ino !== parentBefore.ino) throw new Error('Quarantine parent changed during unlink; outcome is uncertain');
        try { await fs.lstat(target); throw new Error('Quarantine target is still present after unlink; outcome is uncertain'); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
        await syncDirectory(path.dirname(target));
        journal.outcomes.push({ path: file.path, outcome: 'unlinked' }); journal.pending = null;
        await writePurgeJournal(directory, journal);
      }
      journal.state = 'completed';
      await writePurgeJournal(directory, journal);
      return purgeResult(journal, receipt);
    } catch (error) {
      journal.state = 'partial'; journal.error = error instanceof Error ? error.message : String(error);
      // If journaling itself fails, the last durable pending intent still permits conservative recovery.
      await writePurgeJournal(directory, journal).catch(() => undefined);
      throw new Error(`Purge interrupted; inspect retention receipt ${receipt.id} and review a new plan before resuming: ${journal.error}`);
    }
  });
}
