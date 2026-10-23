import { z } from 'zod';
import { type LocalCommandRegistry, TOOL_NAME_PATTERN } from './registry.js';

import { notFound } from '../util/errors.js';

export type OperationCatalog = Pick<LocalCommandRegistry, 'capabilities' | 'definition' | 'inputJsonSchema'>;

export const discoverOperationsSchema = z.object({
  family: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_]*$/).optional(),
  query: z.string().trim().min(1).max(160).optional(),
  offset: z.number().int().min(0).max(1_000_000).default(0),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();
export const describeOperationSchema = z.object({ name: z.string().regex(TOOL_NAME_PATTERN) }).strict();

/** Registry operation names conventionally start with an action, followed by a family. */
export function operationFamily(name: string): string {
  return name.split('_')[1] ?? name;
}

export function discoverOperations(registry: OperationCatalog, input: unknown = {}) {
  const request = discoverOperationsSchema.parse(input);
  const query = request.query?.toLowerCase();
  const matches = registry.capabilities().map((operation) => ({ ...operation, family: registry.definition(operation.name)?.family ?? operationFamily(operation.name) })).filter((operation) =>
    (!request.family || operation.family === request.family) &&
    (!query || `${operation.name} ${operation.title} ${operation.description}`.toLowerCase().includes(query)));
  const counts = new Map<string, number>();
  for (const operation of matches) counts.set(operation.family, (counts.get(operation.family) ?? 0) + 1);
  const families = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, count]) => ({ name, count }));
  return {
    schema: 'game_dev.operation_discovery.v1' as const,
    families,
    operations: matches.slice(request.offset, request.offset + request.limit),
    total: matches.length,
    offset: request.offset,
    limit: request.limit,
    nextOffset: request.offset + request.limit < matches.length ? request.offset + request.limit : null,
  };
}

export function describeOperation(registry: OperationCatalog, input: unknown) {
  const { name } = describeOperationSchema.parse(input);
  const operation = registry.capabilities().find((entry) => entry.name === name);
  if (!operation) throw notFound('operation', name);
  return {
    schema: 'game_dev.operation_description.v1' as const,
    operation: { ...operation, family: registry.definition(name)?.family ?? operationFamily(name), inputSchema: registry.inputJsonSchema(name)! },
  };
}

export const discoverOperationsInputShape = discoverOperationsSchema.shape;
export const describeOperationInputShape = describeOperationSchema.shape;
