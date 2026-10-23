import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import { createGameDevRuntime } from '../src/runtime.js';
import { createMcpServer } from '../src/mcp/server.js';

const roots: string[] = [];
const close: (() => Promise<void>)[] = [];
afterEach(async () => { while (close.length) await close.pop()!(); await Promise.all(roots.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true }))); });
async function workspace() { const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'source-transports-'))); roots.push(root); return root; }
function record() {
  const rights = { status: 'unknown', redistribution: 'unknown', evidence: [], attribution: [], restrictions: [] };
  return { schema: 'game_dev.source_record.v1', id: 'local.recipe', kind: 'recipe_dependency', name: 'Authored recipe', officialSource: `urn:sha256:${'a'.repeat(64)}`, version: '1.0', acquiredAt: '2026-10-23T00:00:00.000Z', rights: { code: rights, model: rights, output: rights }, retention: { status: 'unknown', description: 'Not established', evidence: [] }, entitlement: { required: 'unknown', description: 'Not established', evidence: [] }, verification: { status: 'unverified', note: 'Not reviewed' } };
}
function body(result: Record<string, unknown>): Record<string, any> { // transport JSON is dynamically typed
  const content = result.content as { type: string; text?: string }[];
  return JSON.parse(content.find(item => item.type === 'text')?.text ?? '{}');
}
async function connect(root: string, elicitation?: () => ElicitResult, profile: 'all' | 'readonly' = 'all') {
  const runtime = await createGameDevRuntime({ outputDir: root, env: { ASSET_LOG_LEVEL: 'silent', TRIPO_API_KEY: '', LEONARDO_API_KEY: '' } });
  const server = await createMcpServer(runtime, { profile });
  const client = new Client({ name: 'source-transport-fixture', version: '1' }, { capabilities: elicitation ? { elicitation: {} } : {} });
  if (elicitation) client.setRequestHandler(ElicitRequestSchema, elicitation);
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(a), server.connect(b)]);
  close.push(async () => { await client.close(); await server.close(); });
  return { client, runtime };
}
async function cli(root: string, name: string, input: Record<string, unknown>, confirm = false) {
  const filename = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
  return new Promise<Record<string, any>>((resolve, reject) => {
    execFile(process.execPath, [filename, 'tool', 'call', name, '--input', JSON.stringify(input), '--output-dir', root, '--json', ...(confirm ? ['--confirm'] : [])], { env: { ...process.env, TRIPO_API_KEY: '', LEONARDO_API_KEY: '', ASSET_LOG_LEVEL: 'silent' }, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout) => {
      try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
    });
  });
}

it('CLI requires fresh confirmation and exact record/export plans with no implicit writes', async () => {
  const root = await workspace(); const input = record();
  const planned = await cli(root, 'plan_source_record', { record: input }); expect(planned.ok).toBe(true);
  const args = { record: input, expectedRevision: planned.data.expectedRevision, expectedSha256: planned.data.sha256 };
  expect((await cli(root, 'record_source_evidence', args)).ok).toBe(false);
  await expect(fs.stat(path.join(root, '.provenance'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await cli(root, 'record_source_evidence', { ...args, record: { ...input, version: 'changed' } }, true)).ok).toBe(false);
  expect((await cli(root, 'record_source_evidence', args, true)).ok).toBe(true);
  expect((await cli(root, 'record_source_evidence', args, true)).ok).toBe(false); // revision stale
  const inspected = await cli(root, 'inspect_source_ledger', {}); const { bytes: _bytes, ...exportPlan } = inspected.data.exportPlans[0];
  expect((await cli(root, 'export_source_ledger', exportPlan)).ok).toBe(false);
  await expect(fs.stat(path.join(root, '.provenance', 'exports'))).rejects.toMatchObject({ code: 'ENOENT' });
  const exported = await cli(root, 'export_source_ledger', exportPlan, true); expect(exported.ok).toBe(true);
  expect((await fs.readFile(exported.data.file, 'utf8'))).toContain('game_dev.source_ledger.v1');
  const unknown = await cli(root, 'record_source_evidence', { ...args, approved: true }, true); expect(unknown.ok).toBe(false);
  expect((await cli(root, 'inspect_source_ledger', {})).data.revision).toBe(1);
});

it('MCP missing, declined, cancelled and malformed human approval never creates source evidence', async () => {
  const root = await workspace();
  for (const answer of [undefined, { action: 'decline' }, { action: 'cancel' }, { action: 'accept', content: { confirm: false } }, { action: 'accept' }] as (ElicitResult | undefined)[]) {
    const { client } = await connect(root, answer ? () => answer : undefined);
    const plan = body(await client.callTool({ name: 'plan_source_record', arguments: { record: record() } }));
    const result = await client.callTool({ name: 'record_source_evidence', arguments: { record: record(), expectedRevision: plan.expectedRevision, expectedSha256: plan.sha256 } });
    expect(result.isError).toBe(true); expect(body(result).error).toBe('APPROVAL_REQUIRED');
    await expect(fs.stat(path.join(root, '.provenance'))).rejects.toMatchObject({ code: 'ENOENT' });
  }
});

it('MCP approves each mutation separately, preserves resource hash binding and refuses tampered evidence', async () => {
  const root = await workspace(); let approvals = 0; let accept = true;
  const { client } = await connect(root, () => { approvals++; return accept ? { action: 'accept', content: { confirm: true } } : { action: 'decline' }; });
  const listed = await client.listTools();
  for (const name of ['plan_source_record', 'record_source_evidence', 'inspect_source_ledger', 'export_source_ledger']) {
    const described = body(await client.callTool({ name: 'describe_operation', arguments: { name } }));
    expect(described.operation.inputSchema).toEqual(listed.tools.find(tool => tool.name === name)!.inputSchema);
    expect(described.authority.perCallHumanConfirmation).toBe(name === 'record_source_evidence' || name === 'export_source_ledger');
  }
  const input = record(); const planned = body(await client.callTool({ name: 'plan_source_record', arguments: { record: input } }));
  const savedResult = await client.callTool({ name: 'record_source_evidence', arguments: { record: input, expectedRevision: planned.expectedRevision, expectedSha256: planned.sha256 } });
  expect(savedResult.isError).not.toBe(true); const saved = body(savedResult); expect(approvals).toBe(1);
  const resource = await client.readResource({ uri: saved.uri }); expect(JSON.parse((resource.contents[0] as { text: string }).text).record.id).toBe(input.id);
  const index = await client.readResource({ uri: 'game-dev://sources' }); expect(JSON.parse((index.contents[0] as { text: string }).text).records[0].uri).toBe(saved.uri);
  const inspected = body(await client.callTool({ name: 'inspect_source_ledger', arguments: {} })); const { bytes: _bytes, ...exportPlan } = inspected.exportPlans[0];
  accept = false; expect((await client.callTool({ name: 'export_source_ledger', arguments: exportPlan })).isError).toBe(true); expect(approvals).toBe(2);
  await expect(fs.stat(path.join(root, '.provenance', 'exports'))).rejects.toMatchObject({ code: 'ENOENT' });
  accept = true; const exportedResult = await client.callTool({ name: 'export_source_ledger', arguments: exportPlan }); expect(exportedResult.isError).not.toBe(true); expect(approvals).toBe(3);
  const exported = body(exportedResult); expect(exported.uri).toMatch(/^game-dev:\/\/sources\/exports\/inventory\/[a-f0-9]{64}$/);
  const exportedResource = await client.readResource({ uri: exported.uri }); expect(JSON.parse((exportedResource.contents[0] as { text: string }).text).revision).toBe(1);
  const changed = { ...input, version: '2.0' }; const nextPlan = body(await client.callTool({ name: 'plan_source_record', arguments: { record: changed } }));
  expect((await client.callTool({ name: 'record_source_evidence', arguments: { record: changed, expectedRevision: nextPlan.expectedRevision, expectedSha256: nextPlan.sha256 } })).isError).not.toBe(true);
  await expect(client.readResource({ uri: saved.uri })).rejects.toThrow();
  const priorSnapshot = await client.readResource({ uri: exported.uri }); expect(JSON.parse((priorSnapshot.contents[0] as { text: string }).text).revision).toBe(1);
  await fs.writeFile(exported.file, 'tampered export'); await expect(client.readResource({ uri: exported.uri })).rejects.toThrow();
  const file = path.join(root, '.provenance', 'source-ledger.json'); const raw = await fs.readFile(file, 'utf8'); await fs.writeFile(file, raw.replace('Authored recipe', 'Tampered recipe'));
  await expect(client.readResource({ uri: 'game-dev://sources' })).rejects.toThrow();
});

it('readonly registry/MCP discovery exposes only source readers and keeps exact schemas', async () => {
  const root = await workspace(); const { client, runtime } = await connect(root, undefined, 'readonly'); const { tools } = await client.listTools();
  const names = tools.map(tool => tool.name); expect(names).toContain('plan_source_record'); expect(names).toContain('inspect_source_ledger'); expect(names).not.toContain('record_source_evidence'); expect(names).not.toContain('export_source_ledger');
  for (const name of ['plan_source_record', 'inspect_source_ledger']) {
    const described = body(await client.callTool({ name: 'describe_operation', arguments: { name } }));
    expect(described.operation.inputSchema).toEqual(tools.find(tool => tool.name === name)!.inputSchema);
    const registry = runtime.registry.inputJsonSchema(name); expect(registry).toEqual(described.operation.inputSchema);
  }
  const denied = await client.callTool({ name: 'record_source_evidence', arguments: { record: record(), expectedRevision: 0, expectedSha256: 'a'.repeat(64) } }); expect(denied.isError).toBe(true);
  const unknown = await client.callTool({ name: 'plan_source_record', arguments: { record: record(), approved: true } }); expect(unknown.isError).toBe(true);
  await expect(fs.stat(path.join(root, '.provenance'))).rejects.toMatchObject({ code: 'ENOENT' });
});
