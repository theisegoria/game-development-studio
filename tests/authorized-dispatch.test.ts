import { describe, expect, it } from 'vitest';
import { LocalCommandRegistry } from '../src/commands/registry.js';
import { authorizedDispatcher, operationRefusal } from '../src/commands/authorized-dispatch.js';

describe('recipe transport authority', () => {
  it('does not execute on refused authority, even with model-written approval fields', async () => {
    const registry = new LocalCommandRegistry();
    let calls = 0;
    registry.registerTool('mutate_asset', { inputSchema: {}, annotations: { readOnlyHint: false } }, async () => {
      calls += 1;
      return { content: [] };
    });
    const dispatch = authorizedDispatcher(registry, async (name, _args, readOnly) => {
      expect(readOnly).toBe(false);
      return operationRefusal(name, 'fresh approval missing');
    });
    expect((await dispatch('mutate_asset', { approved: true, approveSpend: true })).isError).toBe(true);
    expect(calls).toBe(0);
  });

  it('authorizes every invocation and invokes an approved operation exactly once', async () => {
    const registry = new LocalCommandRegistry();
    let calls = 0;
    let approvals = 0;
    registry.registerTool('inspect_asset', { inputSchema: {}, annotations: { readOnlyHint: true } }, async () => {
      calls += 1;
      return { content: [] };
    });
    const dispatch = authorizedDispatcher(registry, async () => { approvals += 1; return undefined; });
    await dispatch('inspect_asset', {});
    await dispatch('inspect_asset', {});
    expect(calls).toBe(2);
    expect(approvals).toBe(2);
    expect((await dispatch('unknown_operation', {})).isError).toBe(true);
    expect(approvals).toBe(2);
  });

  it('never interprets an authorization exception as consent', async () => {
    const registry = new LocalCommandRegistry();
    let calls = 0;
    registry.registerTool('mutate_asset', { inputSchema: {} }, async () => { calls += 1; return { content: [] }; });
    const dispatch = authorizedDispatcher(registry, async () => { throw new Error('transport disconnected'); });
    await expect(dispatch('mutate_asset', {})).rejects.toThrow('disconnected');
    expect(calls).toBe(0);
  });
});
