import { z } from 'zod';
import { BASIS_COMMIT, BASIS_VERSION, requireBasis } from '../production/basis.js';
import { assertBasisReviewIdentity, BASIS_REVIEW_LIMITS, type BasisReviewDecodeDeps } from './basis-textures.js';

const digest = z.string().regex(/^[0-9a-f]{64}$/);
export const basisReviewEvidenceSchema = z.object({
  schema: z.literal('gds.review.basis_decode.v1'),
  processCount: z.number().int().min(0).max(BASIS_REVIEW_LIMITS.maxTextureCount + 1),
  decoder: z.object({
    sha256: digest,
    supportedVersion: z.literal(BASIS_VERSION),
    upstreamCommit: z.literal(BASIS_COMMIT),
    output: z.literal('rgba32-dx10-dds-v1'),
  }).strict(),
  textures: z.array(z.object({
    imageIndex: z.number().int().min(0), sourceSha256: digest, decodedSha256: digest,
    width: z.number().int().min(4).max(8192), height: z.number().int().min(4).max(8192),
    levels: z.number().int().min(1).max(14), codec: z.enum(['etc1s', 'uastc']),
    transfer: z.enum(['linear', 'srgb']), decodedBytes: z.number().int().positive().max(BASIS_REVIEW_LIMITS.maxDecodedBytes),
  }).strict()).max(BASIS_REVIEW_LIMITS.maxTextureCount),
}).strict().superRefine((evidence, ctx) => {
  const indices = new Set<number>(); let pixels = 0, bytes = 0;
  for (const [index, texture] of evidence.textures.entries()) {
    let expectedBytes = 0;
    for (let level = 0; level < texture.levels; level++) expectedBytes += Math.max(1, texture.width >> level) * Math.max(1, texture.height >> level) * 4;
    if (indices.has(texture.imageIndex) || texture.width % 4 || texture.height % 4 ||
      texture.width * texture.height > BASIS_REVIEW_LIMITS.maxTexturePixels ||
      texture.levels > Math.floor(Math.log2(Math.max(texture.width, texture.height))) + 1 ||
      texture.decodedBytes !== expectedBytes) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['textures', index], message: 'Invalid bounded Basis review texture receipt' });
    indices.add(texture.imageIndex); pixels += texture.width * texture.height; bytes += texture.decodedBytes + 148;
  }
  if (pixels > BASIS_REVIEW_LIMITS.maxTotalPixels || bytes > BASIS_REVIEW_LIMITS.maxDecodedBytes ||
    evidence.processCount !== (evidence.textures.length ? 1 + evidence.textures.length : 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Basis review process or cumulative resource receipt' });
});

/** Approval checks configuration and bytes only; it never runs a decoder or changes a record. */
export async function verifyBasisReviewBindings(
  enabled: boolean,
  candidates: ReadonlyArray<{ basisDecode?: z.infer<typeof basisReviewEvidenceSchema> }>,
  deps: BasisReviewDecodeDeps = {},
): Promise<void> {
  if (!enabled) {
    if (candidates.some(candidate => candidate.basisDecode !== undefined)) throw new Error('Review contains unrequested Basis decode evidence; create a fresh review');
    return;
  }
  const identity = deps.identity ?? await requireBasis();
  await assertBasisReviewIdentity(identity);
  for (const candidate of candidates) {
    const evidence = basisReviewEvidenceSchema.parse(candidate.basisDecode);
    if (evidence.decoder.sha256 !== identity.sha256) throw new Error('Review Basis decoder changed; create a fresh review');
  }
  await assertBasisReviewIdentity(identity);
}
