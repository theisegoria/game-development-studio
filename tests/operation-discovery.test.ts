import { describe, expect, it } from 'vitest';
import { LocalCommandRegistry } from '../src/commands/registry.js';
import { discoverOperations, describeOperation } from '../src/commands/discovery.js';
import { z } from 'zod';

describe('progressive operation discovery', () => {
  it('paginates metadata and obtains schemas without invoking handlers', () => {
    const registry = new LocalCommandRegistry();
    let calls = 0;
    for (const name of ['inspect_mesh', 'repair_mesh', 'inspect_audio']) {
      registry.registerTool(name, { inputSchema: { path: z.string() } }, async () => { calls++; return { content: [] }; });
    }
    const page = discoverOperations(registry, { family: 'mesh', limit: 1 });
    expect(page.total).toBe(2);
    expect(page.nextOffset).toBe(1);
    expect(discoverOperations(registry, { family: 'mesh', offset: 1 }).operations).toHaveLength(1);
    expect(describeOperation(registry, { name: 'inspect_mesh' }).operation?.inputSchema).toMatchObject({ type: 'object', required: ['path'] });
    expect(calls).toBe(0);
  });
  it('rejects unknown inputs and invalid pagination and supports explicit classification', () => {
    const registry = new LocalCommandRegistry();
    registry.registerTool('inspect_mesh', { family: 'geometry', inputSchema: {} }, async () => ({ content: [] }));
    expect(discoverOperations(registry).families).toEqual([{ name: 'geometry', count: 1 }]);
    for (const input of [{ limit: 101 }, { offset: -1 }, { extra: true }]) {
      expect(() => discoverOperations(registry, input)).toThrow();
    }
    expect(() => describeOperation(registry, { name: 'inspect_mesh', extra: true })).toThrow();
    expect(() => describeOperation(registry, { name: 'missing_operation' })).toThrow(/not found/i);
  });
  it('enforces opt-in strictness before dispatch', async () => {
    const registry = new LocalCommandRegistry();
    let calls = 0;
    registry.registerTool('discover_operations', { inputPolicy: 'strict', inputSchema: {} }, async () => { calls++; return { content: [] }; });
    const response = await registry.call('discover_operations', { unexpected: true });
    expect(response.isError).toBe(true);
    expect(calls).toBe(0);
  });
  it('retains legacy stripping of unknown handler parameters', async () => {
    const registry = new LocalCommandRegistry();
    let received: unknown;
    registry.registerTool('inspect_mesh', { inputSchema: { path: z.string() } }, async (args) => { received = args; return { content: [] }; });
    await registry.call('inspect_mesh', { path: 'mesh.glb', legacy: true });
    expect(received).toEqual({ path: 'mesh.glb' });
  });
});
