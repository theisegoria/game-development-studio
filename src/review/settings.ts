import { z } from 'zod';

/** Bump the version when rendering, sampling, or measurement semantics change. */
export const REVIEW_RENDERER = { id: 'gds-cpu-review', version: '2.1.0', lighting: 'neutral-studio-v1' } as const;
export const reviewSettingsSchema = z.object({
  mode: z.enum(['geometry', 'appearance']).default('geometry'),
  resolution: z.union([z.literal(128), z.literal(256)]).default(256),
  exposure: z.number().finite().min(0.25).max(4).default(1),
  pose: z.object({ clipIndex: z.number().int().min(0), timeSeconds: z.number().finite().min(0).max(86400) }).strict().optional(),
  framing: z.object({ center: z.tuple([z.number().finite().min(-1e12).max(1e12), z.number().finite().min(-1e12).max(1e12), z.number().finite().min(-1e12).max(1e12)]), extent: z.number().finite().min(0.00001).max(2e12) }).strict().optional(),
  reviewLod: z.string().trim().min(1).max(200).optional(),
}).strict();
/** Persisted records must contain defaults explicitly; missing fields are corruption. */
export const storedReviewSettingsSchema = reviewSettingsSchema.extend({
  mode:z.enum(['geometry','appearance']),resolution:z.union([z.literal(128),z.literal(256)]),exposure:z.number().finite().min(0.25).max(4),
}).strict();
export type ReviewSettings = z.infer<typeof reviewSettingsSchema>;
export type ReviewSettingsInput = z.input<typeof reviewSettingsSchema>;

export const REVIEW_LIMITS = {
  sourceBytes: 64_000_000, triangles: 50_000, vertices: 150_000, auxiliaryTriangles: 2_000, materials: 32,
  decodedTexturePixels: 8_000_000, texturePixels: 4_000_000, textureBytes: 8_000_000,
  rasterSamples: 24_000_000, blendFragments: 1_000_000, uvSamples: 2_000_000, animationKeys: 100_000, animationClips: 64, animationChannels: 1024,
  jointMatrices: 4096, morphEvaluations: 480_000, accessorScalars: 4_000_000,
} as const;
