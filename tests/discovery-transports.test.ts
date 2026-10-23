import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createGameDevRuntime } from '../src/runtime.js';
import { createMcpServer } from '../src/mcp/server.js';
import { callCLICommand } from './helpers/cli-harness.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function workspace() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'discovery spaces ')); roots.push(root); return root; }
function data(result: Record<string, unknown>) {
  const content = result.content as Array<{ type: string; text?: string }>;
  expect(result.isError).not.toBe(true);
  return JSON.parse(content.find(item => item.type === 'text')?.text ?? '{}');
}

it('discovers and describes through the actual CLI without credentials or approval', async () => {
  const outputDir = await workspace();
  const run = (name: string, args: Record<string, unknown>) => callCLICommand({ name, args, outputDir,
    env: { TRIPO_API_KEY: '', LEONARDO_API_KEY: '' } });
  const found = await run('discover_operations', { family: 'audio', limit: 1 });
  expect(found.isError).toBeUndefined();
  expect(found.payload).toMatchObject({ schema: 'game_dev.operation_discovery.v1', total: 1, nextOffset: null,
    configuredProviders: { image: [], model3d: [] }, processLaunched: false });
  const details = await run('describe_operation', { name: 'generate_sound_effect' });
  expect(details.payload).toMatchObject({ schema: 'game_dev.operation_description.v1',
    operation: { name: 'generate_sound_effect', family: 'audio', inputSchema: { type: 'object' } },
    authority: { spendCeiling: true, perCallHumanConfirmation: true } });
  expect((await run('describe_operation', { name: 'missing_operation' })).payload.error).toBe('NOT_FOUND');
  expect((await run('discover_operations', { approved: true })).payload.error).toBe('INVALID_INPUT');
});

it('MCP descriptions equal tools/list schemas and discovery grants no provider authority', async () => {
  const outputDir = await workspace();
  let providerCalls = 0;
  const runtime = await createGameDevRuntime({ outputDir, env: { LEONARDO_API_KEY: 'fixture-secret-never-return', TRIPO_API_KEY: '', ASSET_LOG_LEVEL: 'silent' },
    contextOverrides: { imageProvider: () => { providerCalls++; throw new Error('No provider may be invoked'); } } });
  const server = await createMcpServer(runtime);
  const client = new Client({ name: 'discovery-contract', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const { tools } = await client.listTools();
    for (const name of ['describe_operation', 'discover_operations', 'generate_asset_reference', 'plan_scenario_run']) {
      const described = data(await client.callTool({ name: 'describe_operation', arguments: { name } }));
      expect(described.operation.inputSchema).toEqual(tools.find(tool => tool.name === name)?.inputSchema);
      expect(JSON.stringify(described)).not.toContain('fixture-secret-never-return');
    }
    const found = data(await client.callTool({ name: 'discover_operations', arguments: { family: 'references' } }));
    expect(found.operations.length).toBeGreaterThan(0);
    expect(providerCalls).toBe(0);
    const invalid = await client.callTool({ name: 'discover_operations', arguments: { unexpected: true } });
    expect(invalid.isError).toBe(true);
    const refused = await client.callTool({ name: 'generate_asset_reference', arguments: { spec: { name: 'crate', description: 'wooden crate' } } });
    expect(refused.isError).toBe(true);
    expect(providerCalls).toBe(0);
  } finally { await client.close(); await server.close(); }
});

it('readonly MCP discovery exposes exactly its permitted tools, including strict input policies', async () => {
  const runtime = await createGameDevRuntime({ outputDir: await workspace(), env: { ASSET_LOG_LEVEL: 'silent' } });
  const server = await createMcpServer(runtime, { profile: 'readonly' });
  const client = new Client({ name: 'readonly-discovery', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  try {
    const { tools } = await client.listTools();
    const found = data(await client.callTool({ name: 'discover_operations', arguments: { limit: 100 } }));
    expect(found.operations.map((operation: { name: string }) => operation.name).sort()).toEqual(tools.map(tool => tool.name).sort());
    expect(found.operations.every((operation: { readOnly: boolean }) => operation.readOnly)).toBe(true);
    const described = await client.callTool({ name: 'describe_operation', arguments: { name: 'create_3d_asset' } });
    expect(described.isError).toBe(true);
    expect(JSON.stringify(described.content)).toContain('NOT_FOUND');
  } finally { await client.close(); await server.close(); }
});

it('preserves registration for custom transports that provide only registerTool', async () => {
  const { registerAssetCommands } = await import('../src/commands/register.js');
  const runtime = await createGameDevRuntime({ outputDir: await workspace(), env: { ASSET_LOG_LEVEL: 'silent' } });
  const names: string[] = [];
  registerAssetCommands({ registerTool(name) { names.push(name); } }, runtime.context);
  expect(names.sort()).toEqual(runtime.registry.names());
});
