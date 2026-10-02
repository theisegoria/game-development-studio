import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { safeJoin, writeJsonAtomic } from '../storage/filesystem.js';

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
  if (/\.(json|jsonl|sqlite3?|db)(-wal|-shm)?$/.test(p)) return 'metadata';
  if (segments.some(s => ['captures', 'capture', 'frames', 'runs'].includes(s))) return 'capture';
  if (segments.some(s => ['derived', 'previews', 'cache', 'normalized', 'variants'].includes(s))) return 'derived';
  return 'unknown';
}

/** Conservatively protects all records, package/job/baseline trees, and every referenced path. */
export async function inspectWorkspace(rootInput: string, metadataRootsInput: string[] = []) {
  const root = await fs.realpath(rootInput);
  const metadataRoots: string[] = [];
  for (const input of metadataRootsInput) {
    try { metadataRoots.push(await fs.realpath(input)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  metadataRoots.sort();
  const scan = await filesUnder(root), references = new Map<string, Set<string>>();
  const blockers = [...scan.blockers];
  const metadataFiles = new Set(scan.files.filter(p => /\.jsonl?$/.test(p)));
  for (const external of metadataRoots.filter(p => !isInside(root, p))) {
    const extra = await filesUnder(external); blockers.push(...extra.blockers);
    extra.files.filter(p => /\.jsonl?$/.test(p)).forEach(p => metadataFiles.add(p));
  }
  function strings(value: unknown, record: string): void {
    if (typeof value === 'string') {
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
      if (record.endsWith('.jsonl')) raw.split('\n').filter(Boolean).forEach(line => strings(JSON.parse(line), record));
      else strings(JSON.parse(raw), record);
    } catch (error) { blockers.push(`Unreadable metadata ${record}: ${String(error)}`); }
  }
  // Canonicalize reference aliases (e.g. /var -> /private/var on macOS).
  const normalizedReferences = new Map<string, Set<string>>();
  for (const [candidate, records] of references) {
    let canonical: string;
    try { canonical = await fs.realpath(candidate); } catch { continue; }
    if (!isInside(root, canonical)) continue;
    const merged = normalizedReferences.get(canonical) ?? new Set<string>();
    records.forEach(record => merged.add(record)); normalizedReferences.set(canonical, merged);
  }
  const entries: Entry[] = [];
  for (const file of scan.files) {
    const p = path.relative(root, file), classification = classify(p), protectedBy: string[] = [];
    if (['original', 'metadata', 'unknown'].includes(classification)) protectedBy.push(`preserve-${classification}`);
    if (p.split(path.sep).some(s => ['baselines', 'baseline', 'packages', 'jobs', '.jobs'].includes(s))) protectedBy.push('protected-record-tree');
    for (const [reference, records] of normalizedReferences) if (isInside(reference, file)) protectedBy.push(...records);
    entries.push({ path: p, bytes: (await fs.stat(file)).size, sha256: await hashFile(file), classification, protectedBy: [...new Set(protectedBy)].sort() });
  }
  const totals = Object.fromEntries(['original','derived','capture','metadata','unknown'].map(c => [c, entries.filter(e => e.classification === c).reduce((n,e) => n + e.bytes, 0)]));
  return { schema: 'game_dev.workspace_inventory.v1', root, metadataRoots, entries, totals, blockers, evidenceCeiling };
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
    try { receipts.push(parseReceipt(JSON.parse(await fs.readFile(path.join(store, entry.name, 'receipt.json'), 'utf8')))); }
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
