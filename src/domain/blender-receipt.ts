/** The subprocess claim. Callers still measure the produced bytes independently. */
import { z } from 'zod';
export const BLENDER_RECEIPT_SCHEMA = 'org.gamedebug.blender_receipt.v1';
const count = z.number().int().nonnegative();
const fields = {
  blenderVersion: z.string().min(1).optional(), input: z.string().optional(), output: z.string().optional(),
  meshObjects: count.optional(), trianglesBefore: count.optional(), trianglesAfter: count.optional(),
  objectsMissingUVsBefore: count.optional(), objectsMissingUVsAfter: count.optional(),
  objectsUnwrapped: count.optional(), objectsCleaned: count.optional(), objectsDecimated: count.optional(),
  materialsRenamed: count.optional(), materialsForcedOpaque: count.optional(),
  objectsWithNonUnitWorldScale: count.optional(), objectsWeldSkippedThresholdUnrepresentable: count.optional(),
  objectsDissolveSkippedThresholdUnrepresentable: count.optional(), outputBytes: count.optional(), bytes: count.optional(),
  largestThresholdDivisor: z.number().finite().nonnegative().optional(),
  mergeDistanceRequestedSceneUnits: z.number().finite().nonnegative().optional(),
};
const legacy = z.object(fields).passthrough();
export const blenderReceiptSchema = z.object({
  ...fields, schema: z.literal(BLENDER_RECEIPT_SCHEMA),
  operation: z.enum(['normalize_mesh', 'export_usd_preview']),
  blenderVersion: z.string().min(1), input: z.string(), output: z.string(),
}).passthrough();
export type BlenderReceipt = z.infer<typeof blenderReceiptSchema>;
export type CompatibleBlenderReceipt = z.infer<typeof legacy> & { schema?: string; operation?: string };
/** Legacy wrappers remain readable, but unknown versions and invalid known fields fail closed. */
export function parseBlenderReceipt(value: unknown): CompatibleBlenderReceipt {
  if (value && typeof value === 'object' && 'schema' in value) return blenderReceiptSchema.parse(value);
  return legacy.parse(value);
}
