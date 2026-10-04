import path from 'node:path';
import { createHash } from 'node:crypto';
import { readBoundedReviewFile } from './source.js';
import { readReviewDocument } from './document.js';
import { applyReviewPose } from './pose.js';
import { REVIEW_LIMITS, REVIEW_RENDERER } from './settings.js';

/** Read-only bounded metadata: no preview rendering, process, provider or writes. */
export async function inspectReviewAnimation(modelPath: string) {
  const resolved = path.resolve(modelPath);
  if (path.extname(resolved).toLowerCase() !== '.glb') throw new Error('Animation review metadata requires a self-contained GLB');
  const bytes = await readBoundedReviewFile(resolved, REVIEW_LIMITS.sourceBytes, 'Animation review GLB');
  const { doc, warnings } = await readReviewDocument(bytes);
  const { clips } = applyReviewPose(doc, undefined);
  return { schema: 'game_dev.animation_review_info.v1' as const, modelPath: resolved,
    sourceSha256: createHash('sha256').update(bytes).digest('hex'), renderer: REVIEW_RENDERER,
    clips, framing: { policy: 'default-pose' as const }, warnings };
}
