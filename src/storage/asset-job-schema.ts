/** Validate every persisted field consumed by job/history/recovery code.
 * Additive unknown fields survive v1 round trips; unsupported versions fail closed.
 */
import { z } from 'zod';
import { gameAssetSpecSchema } from '../domain/asset-spec.js';
import { ASSET_JOB_STATUSES } from '../domain/status.js';

const id = z.string().regex(/^asset_[A-Za-z0-9-]{1,64}$/);
const text = z.string().min(1);
const timestamp = z.string().datetime({ offset: true });
const finite = z.number().finite();
const dimensions = z.number().int().positive().safe().optional();
const metadata = z.record(z.unknown()).optional();

export const assetJobSchema = z.object({
  id, schemaVersion: z.literal(1), name: text,
  slug: text.refine((value) => !/[\\/]/.test(value) && !value.includes(String.fromCharCode(0)) && !['.', '..'].includes(value), 'slug must be one safe path segment'),
  status: z.enum(ASSET_JOB_STATUSES), providerStatus: z.string().optional(),
  spec: gameAssetSpecSchema, userRequest: z.string().optional(),
  image: z.object({
    provider: text, model: z.string().optional(), modelId: z.string().optional(), prompt: z.string(), negativePrompt: z.string().optional(), seed: finite.optional(),
    width: dimensions, height: dimensions, providerGenerationId: text.optional(), requestedAt: timestamp, metadata,
  }).passthrough().optional(),
  candidates: z.array(z.object({
    id: text, url: text, localPath: text.optional(), seed: finite.optional(), width: dimensions, height: dimensions,
    providerImageId: text.optional(), parentCandidateId: text.optional(),
  }).passthrough()),
  selectedCandidateId: text.optional(),
  model3d: z.object({
    provider: text, modelVersion: z.string().optional(), providerTaskId: text.optional(), taskType: text,
    parameters: z.record(z.unknown()), requestedAt: timestamp, modelUrl: text.optional(), pbrModelUrl: text.optional(), renderedImageUrl: text.optional(), creditCost: finite.nonnegative().optional(), metadata,
  }).passthrough().optional(),
  audio: z.object({
    provider: text, model: text, prompt: z.string(), durationSeconds: finite.positive().optional(), loop: z.boolean().optional(),
    quantity: z.number().int().positive().safe().optional(), promptInfluence: finite.optional(), providerGenerationId: text.optional(), requestedAt: timestamp,
    creditCost: finite.nonnegative().optional(), metadata,
  }).passthrough().optional(),
  files: z.array(z.object({
    path: text, bytes: z.number().int().nonnegative().safe(), sha256: z.string().regex(/^[a-fA-F0-9]{64}$/), contentType: text.optional(),
    kind: z.enum(['model', 'texture', 'reference', 'preview', 'metadata', 'audio']),
  }).passthrough()),
  workspacePath: text.optional(), createdAt: timestamp, updatedAt: timestamp,
  error: z.object({ code: text, message: z.string(), details: z.record(z.unknown()).optional() }).passthrough().optional(),
  parentJobId: id.optional(),
}).passthrough().superRefine((job, ctx) => {
  if (new Set(job.candidates.map((candidate) => candidate.id)).size !== job.candidates.length) ctx.addIssue({ code: 'custom', message: 'duplicate reference candidate identities' });
  if (job.selectedCandidateId && !job.candidates.some((candidate) => candidate.id === job.selectedCandidateId)) ctx.addIssue({ code: 'custom', message: 'selected candidate is missing from the job' });
});
