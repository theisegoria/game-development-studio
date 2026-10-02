import type { LocalCommandRegistry } from './registry.js';
import type { ToolResult } from '../tools/context.js';

export function operationRefusal(name: string, message: string): ToolResult {
  return { isError: true, content: [{ type: 'text', text: JSON.stringify({
    error: 'APPROVAL_REQUIRED', tool: name, message, retryable: false,
  }) }] };
}

/** A recipe cannot convert its saved arguments into transport authority. */
export function authorizedDispatcher(
  registry: LocalCommandRegistry,
  authorize: (name: string, args: Record<string, unknown>, readOnly: boolean) => Promise<ToolResult | undefined>,
): (name: string, args: Record<string, unknown>) => Promise<ToolResult> {
  return async (name, args) => {
    const capability = registry.capabilities().find((item) => item.name === name);
    if (!capability) return operationRefusal(name, 'The requested operation is unavailable.');
    const refusal = await authorize(name, args, capability.readOnly);
    if (refusal) return refusal;
    return registry.call(name, args);
  };
}
