import { discoverOperations, describeOperation, discoverOperationsInputShape, describeOperationInputShape, type OperationCatalog } from '../commands/discovery.js';
import type { ToolRegistrar } from '../commands/registry.js';
import { configuredProviders } from '../config.js';
import { FREE_TOOLS, estimateCost, isSpendingTool } from '../domain/spend.js';
import { EXECUTION_TOOLS, PROJECT_WRITE_TOOLS } from '../mcp/execution-gate.js';
import { ROADMAP_MUTATION_TOOLS } from '../commands/mutation-policy.js';
import { GAME_DEV_VERSION } from '../version.js';
import { guard, ok, type ToolContext } from './context.js';

function authority(name: string) {
  return {
    perCallHumanConfirmation: EXECUTION_TOOLS.has(name) || PROJECT_WRITE_TOOLS.has(name) || ROADMAP_MUTATION_TOOLS.has(name) || isSpendingTool(name),
    executionCeiling: EXECUTION_TOOLS.has(name),
    projectWriteCeiling: PROJECT_WRITE_TOOLS.has(name),
    spendCeiling: isSpendingTool(name),
    note: 'Metadata grants no authority. Inspect the operation plan for input-specific requirements and separately authorized child operations.',
  };
}

export function registerDiscoveryTools(registry: ToolRegistrar, ctx: ToolContext, catalog: OperationCatalog): void {
  const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  registry.registerTool('discover_operations', {
    family: 'discovery', title: 'Discover operation families',
    description: 'FREE bounded operation search and pagination. Reports registered capabilities without running operations or checking live provider access. Describe one operation for its schema and approval requirements.',
    inputPolicy: 'strict', inputSchema: discoverOperationsInputShape, annotations,
  }, guard(ctx.logger, 'discover_operations', async input => ok({
    ...discoverOperations(catalog, input),
    runtimeVersion: GAME_DEV_VERSION,
    configuredProviders: configuredProviders(ctx.config),
    configurationEvidence: 'Credential presence only; account entitlement, API access and backend behavior are unverified.',
    processLaunched: false,
  })));
  registry.registerTool('describe_operation', {
    family: 'discovery', title: 'Describe one operation',
    description: 'FREE input JSON Schema, direct cost estimate and authority requirements from the current registry. Performs no invocation, installation, upload or approval.',
    inputPolicy: 'strict', inputSchema: describeOperationInputShape, annotations,
  }, guard(ctx.logger, 'describe_operation', async input => {
    const description = describeOperation(catalog, input);
    return ok({ ...description, authority: authority(input.name), cost: FREE_TOOLS.has(input.name)
      ? { cents: 0, confidence: 'documented', basis: 'No direct provider charge. Separately authorized child operations may cost money.' }
      : estimateCost(input.name), processLaunched: false });
  }));
}
