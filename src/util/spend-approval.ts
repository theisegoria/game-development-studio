import { AsyncLocalStorage } from 'node:async_hooks';
import type { SpendEntry } from '../domain/spend.js';

const approvals = new AsyncLocalStorage<NonNullable<SpendEntry['approval']>>();
/** Scoped to the authorized invocation, never saved as authority or shared across MCP calls. */
export function withSpendApproval<T>(source: 'cli flags' | 'mcp elicitation', action: () => T): T {
  return approvals.run({ source, at: new Date().toISOString(), userApprovalVerified: true }, action);
}
export function currentSpendApproval(): SpendEntry['approval'] { return approvals.getStore(); }
