import { z } from 'zod';
import { reviewTimelineSchema } from './timeline.js';

/** Bump the version when rendering, sampling, or measurement semantics change. */
export const REVIEW_RENDERER = { id: 'gds-cpu-review', version: '2.2.0', lighting: 'neutral-studio-v1' } as const;
const reviewSettingsShape = z.object({
  mode: z.enum(['geometry', 'appearance']).default('geometry'),
  decodeBasisTextures: z.boolean().default(false),
  resolution: z.union([z.literal(128), z.literal(256)]).default(256),
  exposure: z.number().finite().min(0.25).max(4).default(1),
  pose: z.object({ clipIndex: z.number().int().min(0), timeSeconds: z.number().finite().min(0).max(86400) }).strict().optional(),
  timeline: reviewTimelineSchema.optional(),
  framing: z.object({ center: z.tuple([z.number().finite().min(-1e12).max(1e12), z.number().finite().min(-1e12).max(1e12), z.number().finite().min(-1e12).max(1e12)]), extent: z.number().finite().min(0.00001).max(2e12) }).strict().optional(),
  reviewLod: z.string().trim().min(1).max(200).optional(),
}).strict();
function validateDecodeMode(settings: { mode: 'geometry' | 'appearance'; decodeBasisTextures?: boolean; resolution: number; pose?: unknown; timeline?: unknown }, context: z.RefinementCtx): void {
  if (settings.decodeBasisTextures && settings.mode !== 'appearance') {
    context.addIssue({ code: 'custom', path: ['decodeBasisTextures'], message: 'Basis texture decoding is available only in appearance review mode.' });
  }
  if(settings.timeline && (settings.mode!=='appearance' || settings.resolution!==128 || settings.decodeBasisTextures || settings.pose)) {
    context.addIssue({code:'custom',path:['timeline'],message:'Sampled playback requires appearance at 128 pixels, no separate pose and PNG/JPEG textures without Basis decoding.'});
  }
}
export const reviewSettingsSchema = reviewSettingsShape.superRefine(validateDecodeMode);
/** Persisted records must contain defaults explicitly; missing fields are corruption. */
export const storedReviewSettingsSchema = reviewSettingsShape.extend({
  mode:z.enum(['geometry','appearance']),decodeBasisTextures:z.boolean().optional(),resolution:z.union([z.literal(128),z.literal(256)]),exposure:z.number().finite().min(0.25).max(4),
}).strict().superRefine(validateDecodeMode);
export type ReviewSettings = z.infer<typeof reviewSettingsSchema>;
export type ReviewSettingsInput = z.input<typeof reviewSettingsSchema>;

export const REVIEW_LIMITS = {
  sourceBytes: 64_000_000, triangles: 50_000, vertices: 150_000, auxiliaryTriangles: 2_000, materials: 32,
  decodedTexturePixels: 8_000_000, texturePixels: 4_000_000, textureBytes: 8_000_000,
  rasterSamples: 24_000_000, blendFragments: 1_000_000, uvSamples: 2_000_000, animationKeys: 100_000, animationClips: 64, animationChannels: 1024,
  jointMatrices: 4096, morphEvaluations: 480_000, accessorScalars: 4_000_000,
} as const;
