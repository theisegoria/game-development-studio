import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { hashFile, listRetentionReceipts, planRetention, planWorkspacePurge, purgeWorkspaceRetention, quarantineWorkspace, restoreWorkspace } from '../src/workspace/retention.js';
import { registerWorkspaceTools } from '../src/tools/workspace.js';
import { connectTools } from './helpers/tool-harness.js';
import { ExecutionGate } from '../src/mcp/execution-gate.js';
import { ROADMAP_FREE_TOOLS, ROADMAP_MUTATION_TOOLS } from '../src/commands/mutation-policy.js';

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function temp() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'purge-fixture-')); roots.push(root); return root; }
async function put(root: string, file: string, contents: string) { const target = path.join(root, file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, contents); return target; }
async function quarantined() {
  const root = await temp();
  await put(root, 'derived/a.bin', 'abc'); await put(root, 'derived/b.bin', 'defg');
  const receipt = await quarantineWorkspace(root, await planRetention(root));
  return { root, receipt, directory: path.join(root, '.retention', receipt.id) };
}
it('plans without mutation and purges only the reviewed quarantine roster, retaining audit records', async () => {
  const { root, receipt, directory } = await quarantined();
  const before = await fs.readdir(directory); const plan = await planWorkspacePurge(root, receipt.id);
  expect(await fs.readdir(directory)).toEqual(before); expect(plan.totalBytes).toBe(7); expect(plan.irreversibleWarning).toContain('IRREVERSIBLE');
  const result = await purgeWorkspaceRetention(root, plan);
  expect(result.state).toBe('completed'); expect(result.unlinkedFileBytes).toBe(7); expect(result.actualFilesystemBytesFreed).toBeNull();
  expect(result.reconciledAbsentFileBytes).toBe(0);
  await expect(fs.stat(path.join(directory, 'files/derived/a.bin'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(JSON.stringify(await listRetentionReceipts(root))).toContain('retention_purge_receipt.v1');
  expect(await fs.readFile(path.join(directory, 'receipt.json'), 'utf8')).toContain(receipt.id);
  await expect(restoreWorkspace(root, receipt.id)).rejects.toThrow('Irreversible purge');
  expect((await purgeWorkspaceRetention(root, await planWorkspacePurge(root, receipt.id))).unlinkedFileBytes).toBe(7);
});
it('blocks new references to absent original paths, including external roots and directory references', async () => {
  const root = await temp(), metadata = await temp(); await put(root, 'derived/a.bin', 'abc');
  const receipt = await quarantineWorkspace(root, await planRetention(root, { metadataRoots: [metadata] }), [metadata]);
  await put(metadata, 'job.json', JSON.stringify({ artifacts: [{ path: path.join(root, 'derived/a.bin') }] }));
  // Historical metadata roots cannot be bypassed by omitting them in the new caller.
  const plan = await planWorkspacePurge(root, receipt.id);
  expect(plan.blockers.join(' ')).toContain('Protected derived/a.bin');
  await expect(purgeWorkspaceRetention(root, plan)).rejects.toThrow('blocked');
  await put(metadata, 'job.json', JSON.stringify({ directory: path.join(root, 'derived') }));
  expect((await planWorkspacePurge(root, receipt.id)).blockers.join(' ')).toContain('Protected');
  await fs.rm(metadata, { recursive: true });
  await expect(planWorkspacePurge(root, receipt.id)).rejects.toThrow('metadata root is unavailable');
});
it('blocks current quarantine paths, digest-only references, corrupt metadata and late references after planning', async () => {
  const { root, receipt, directory } = await quarantined(); const stale = await planWorkspacePurge(root, receipt.id);
  await put(root, 'baseline.json', JSON.stringify({ source: path.join(directory, 'files/derived/a.bin') }));
  await expect(purgeWorkspaceRetention(root, stale)).rejects.toThrow('stale');
  expect((await planWorkspacePurge(root, receipt.id)).blockers.join(' ')).toContain('Protected');
  const sha256 = await hashFile(path.join(directory, 'files/derived/a.bin'));
  await put(root, 'baseline.json', JSON.stringify({ modelSha256: sha256 }));
  expect((await planWorkspacePurge(root, receipt.id)).blockers.join(' ')).toContain('Protected derived/a.bin');
  await put(root, 'baseline.json', '{');
  await expect(purgeWorkspaceRetention(root, await planWorkspacePurge(root, receipt.id))).rejects.toThrow('blocked');
});
it('rejects edited plans, changed bytes, missing files, unrostered additions and symlinks', async () => {
  const { root, receipt, directory } = await quarantined(); const plan = await planWorkspacePurge(root, receipt.id);
  await expect(purgeWorkspaceRetention(root, { ...plan, totalBytes: 0 })).rejects.toThrow('modified');
  const target = path.join(directory, 'files/derived/a.bin');
  await fs.writeFile(target, 'different'); expect((await planWorkspacePurge(root, receipt.id)).blockers.join(' ')).toContain('bytes changed');
  await fs.rm(target); expect((await planWorkspacePurge(root, receipt.id)).blockers.join(' ')).toContain('missing without');
  const external = await temp(); await put(external, 'important.bin', 'abc'); await fs.symlink(path.join(external, 'important.bin'), target);
  expect((await planWorkspacePurge(root, receipt.id)).blockers.join(' ')).toMatch(/Symlink/);
  expect(await fs.readFile(path.join(external, 'important.bin'), 'utf8')).toBe('abc');
  await fs.rm(target); await fs.writeFile(target, 'abc'); await put(directory, 'unexpected.txt', 'keep');
  expect((await planWorkspacePurge(root, receipt.id)).blockers.join(' ')).toContain('Unrostered');
});
it('does not permit active or restored retention receipts to enter purge', async () => {
  const { root, receipt, directory } = await quarantined();
  const file = path.join(directory, 'receipt.json'), record = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify({ ...record, state: 'moving' }));
  await expect(planWorkspacePurge(root, receipt.id)).rejects.toThrow('completed quarantine');
  await fs.writeFile(file, JSON.stringify(record)); await restoreWorkspace(root, receipt.id);
  await expect(planWorkspacePurge(root, receipt.id)).rejects.toThrow('completed quarantine');
});
it('journals a partial failure and requires a fresh confirmed plan to resume', async () => {
  const { root, receipt, directory } = await quarantined(); const plan = await planWorkspacePurge(root, receipt.id);
  const unlink = fs.unlink.bind(fs); let once = true;
  vi.spyOn(fs, 'unlink').mockImplementation(async file => {
    if (String(file).endsWith(`${path.sep}b.bin`) && once) { once = false; throw new Error('simulated locked file'); }
    await unlink(file);
  });
  await expect(purgeWorkspaceRetention(root, plan)).rejects.toThrow('Purge interrupted');
  const journal = JSON.parse(await fs.readFile(path.join(directory, 'purge.json'), 'utf8'));
  expect(journal.state).toBe('partial'); expect(journal.outcomes).toEqual([{ path: 'derived/a.bin', outcome: 'unlinked' }]);
  await expect(purgeWorkspaceRetention(root, plan)).rejects.toThrow('stale');
  const next = await planWorkspacePurge(root, receipt.id); expect(next.files.map(file => file.path)).toEqual(['derived/b.bin']);
  const result = await purgeWorkspaceRetention(root, next); expect(result.state).toBe('completed'); expect(result.unlinkedFileBytes).toBe(7);
});
it('reconciles unlink-before-journal interruption without falsely attributing missing bytes', async () => {
  const { root, receipt } = await quarantined(); const unlink = fs.unlink.bind(fs); let once = true;
  vi.spyOn(fs, 'unlink').mockImplementation(async file => { await unlink(file); if (String(file).endsWith(`${path.sep}a.bin`) && once) { once = false; throw new Error('simulated interruption after unlink'); } });
  await expect(purgeWorkspaceRetention(root, await planWorkspacePurge(root, receipt.id))).rejects.toThrow('interrupted');
  const next = await planWorkspacePurge(root, receipt.id); expect(next.interruptedMissing.map(file => file.path)).toEqual(['derived/a.bin']);
  const result = await purgeWorkspaceRetention(root, next); expect(result.unlinkedFileBytes).toBe(4); expect(result.reconciledAbsentFileBytes).toBe(3); expect(result.actualFilesystemBytesFreed).toBeNull();
});
it('rechecks references before every deletion and preserves a newly referenced remaining file', async () => {
  const { root, receipt, directory } = await quarantined(); const unlink = fs.unlink.bind(fs);
  vi.spyOn(fs, 'unlink').mockImplementation(async file => {
    await unlink(file);
    if (String(file).endsWith(`${path.sep}a.bin`)) await put(root, 'job.json', JSON.stringify({ artifact: path.join(root, 'derived/b.bin') }));
  });
  await expect(purgeWorkspaceRetention(root, await planWorkspacePurge(root, receipt.id))).rejects.toThrow('References or metadata changed');
  expect(await fs.readFile(path.join(directory, 'files/derived/b.bin'), 'utf8')).toBe('defg');
  expect((await planWorkspacePurge(root, receipt.id)).blockers.join(' ')).toContain('Protected derived/b.bin');
});
it('fails closed on corrupt purge journals and reappearing previously deleted paths', async () => {
  const { root, receipt, directory } = await quarantined(); await purgeWorkspaceRetention(root, await planWorkspacePurge(root, receipt.id));
  await put(directory, 'files/derived/a.bin', 'abc'); expect((await planWorkspacePurge(root, receipt.id)).blockers.join(' ')).toContain('reappeared');
  await fs.writeFile(path.join(directory, 'purge.json'), '{}');
  await expect(planWorkspacePurge(root, receipt.id)).rejects.toThrow();
  expect(JSON.stringify(await listRetentionReceipts(root))).toContain('Corrupt receipt');
});
it('binds irreversible purge to launch authority and per-call MCP consent with explicit warning', async () => {
  const { root, receipt, directory } = await quarantined(); vi.stubEnv('GAME_DEV_MCP_ALLOW_PROJECT_WRITE', '');
  const tools = await connectTools(registerWorkspaceTools, root); const plan = await tools.call('plan_workspace_purge', { receiptId: receipt.id });
  expect(plan.isError).toBe(false); expect((await tools.call('purge_workspace_retention', { plan: plan.payload })).text).toContain('requires authority');
  expect(ROADMAP_FREE_TOOLS.has('plan_workspace_purge')).toBe(true); expect(ROADMAP_MUTATION_TOOLS.has('purge_workspace_retention')).toBe(true);
  const handler = vi.fn(async () => ({ content: [] })); const elicit = vi.fn(async (message: string) => { expect(message).toContain('IRREVERSIBLE'); expect(message).toContain('cannot be undone'); expect(message).toContain('ALL other workspace and quarantine writers must be stopped'); return false; });
  const gate = new ExecutionGate({ canElicit: () => true, elicit }); await gate.wrap('purge_workspace_retention', handler)({ plan: plan.payload });
  expect(elicit).toHaveBeenCalledOnce(); expect(handler).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(directory, 'files/derived/a.bin'), 'utf8')).toBe('abc'); await tools.close();
});

it('CLI requires a fresh --confirm even with the configured write grant', async () => {
  const root = await temp(); await put(root, 'derived/a.bin', 'abc'); await put(root, 'derived/b.bin', 'defg');
  const exec = promisify(execFile);
  async function cli(name: string, input: unknown, confirm = false) {
    const args = ['dist/cli.js', 'tool', 'call', name, '--input', JSON.stringify(input), '--output-dir', root, '--json', ...(confirm ? ['--confirm'] : [])];
    const options = { env: { ...process.env, GAME_DEV_MCP_ALLOW_PROJECT_WRITE: '1' } };
    try { return JSON.parse((await exec(process.execPath, args, options)).stdout); }
    catch (error) { return JSON.parse((error as { stdout: string }).stdout); }
  }
  const retention = (await cli('plan_workspace_retention', {})).data;
  const quarantinedResult = await cli('execute_workspace_retention', { plan: retention }, true);
  expect(quarantinedResult.ok, JSON.stringify(quarantinedResult)).toBe(true);
  const receipt = quarantinedResult.data, directory = path.join(root, '.retention', receipt.id);
  const plan = (await cli('plan_workspace_purge', { receiptId: receipt.id })).data;
  const denied = await cli('purge_workspace_retention', { plan });
  expect(denied.error.error).toBe('APPROVAL_REQUIRED');
  expect(await fs.readFile(path.join(directory, 'files/derived/a.bin'), 'utf8')).toBe('abc');
  const result = await cli('purge_workspace_retention', { plan }, true);
  expect(result.ok, JSON.stringify(result)).toBe(true); expect(result.data.unlinkedFileBytes).toBe(7);
});
it('normalizes metadata extensions, absent path case/Unicode aliases and hex digest case', async () => {
  const root = await temp(), metadata = await temp();
  await put(root, 'derived/café.bin', 'cafe');
  await put(root, 'derived/notes.JSON', '{}');
  const original = await planRetention(root, { metadataRoots: [metadata] });
  expect(original.files.map(file => file.path)).not.toContain('derived/notes.JSON');
  const receipt = await quarantineWorkspace(root, original, [metadata]);
  const alias = path.join(root, 'DERIVED', 'CAFÉ.BIN'.normalize('NFD'));
  await put(root, 'BASELINE.JSON', JSON.stringify({ source: alias }));
  expect((await planWorkspacePurge(root, receipt.id)).blockers.join(' ')).toContain('Protected');
  await fs.rm(path.join(root, 'BASELINE.JSON'));
  await put(metadata, 'EVENTS.JSONL', `${JSON.stringify({ sha256: receipt.plan.files[0]!.sha256.toUpperCase() })}\n`);
  expect((await planWorkspacePurge(root, receipt.id)).blockers.join(' ')).toContain('Protected');
});
it('retention audit inputs do not self-protect, but explicit job artifacts and unknown records do', async () => {
  const { root, receipt } = await quarantined();
  const { DurableJobStore } = await import('../src/jobs/durable.js');
  const jobs = await DurableJobStore.open(path.join(root, '.game-dev/jobs'));
  const plan = await planWorkspacePurge(root, receipt.id, [path.join(root, '.game-dev')]);
  const job = await jobs.create('tool.call.purge_workspace_retention', { positionals: ['tool', 'call', 'purge_workspace_retention'], flags: { 'output-dir': root }, input: { plan } });
  expect((await planWorkspacePurge(root, receipt.id, [path.join(root, '.game-dev')])).blockers).toEqual([]);
  const file = path.join(root, '.game-dev/jobs', job.id, 'job.json');
  const value = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify({ ...value, artifacts: [{ path: path.join(root, 'derived/a.bin'), kind: 'mesh' }] }));
  expect((await planWorkspacePurge(root, receipt.id, [path.join(root, '.game-dev')])).blockers.join(' ')).toContain('Protected derived/a.bin');
  await fs.writeFile(file, JSON.stringify({ ...value, schema: 'unknown.job.v99' }));
  expect((await planWorkspacePurge(root, receipt.id, [path.join(root, '.game-dev')])).blockers.join(' ')).toContain('Protected');
});
it('does not attribute success when a hostile concurrent parent replacement is observed after unlink', async () => {
  const { root, receipt, directory } = await quarantined(), external = await temp();
  await put(external, 'a.bin', 'external');
  const unlink = fs.unlink.bind(fs); let once = true;
  vi.spyOn(fs, 'unlink').mockImplementation(async file => {
    if (String(file).endsWith(`${path.sep}a.bin`) && once) {
      once = false;
      await fs.rename(path.join(directory, 'files/derived'), path.join(directory, 'files/retained-derived'));
      await fs.symlink(external, path.join(directory, 'files/derived'), 'dir');
    }
    await unlink(file);
  });
  await expect(purgeWorkspaceRetention(root, await planWorkspacePurge(root, receipt.id))).rejects.toThrow('Purge interrupted');
  const journal = JSON.parse(await fs.readFile(path.join(directory, 'purge.json'), 'utf8'));
  expect(journal.state).toBe('partial'); expect(journal.outcomes).toEqual([]); expect(journal.pending).toBe('derived/a.bin');
  expect(await fs.readFile(path.join(directory, 'files/retained-derived/a.bin'), 'utf8')).toBe('abc');
});

it.each([['straße.bin', 'STRASSE.BIN'], ['σ.bin', 'ς.bin']])('conservatively protects Unicode case-fold aliases %s / %s', async (original, alias) => {
  const root = await temp(); await put(root, `derived/${original}`, 'unicode');
  const receipt = await quarantineWorkspace(root, await planRetention(root));
  await put(root, 'baseline.json', JSON.stringify({ source: path.join(root, 'derived', alias) }));
  expect((await planWorkspacePurge(root, receipt.id)).blockers.join(' ')).toContain('Protected');
});
