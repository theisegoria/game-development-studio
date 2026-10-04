import type { ReviewFace } from './appearance.js';

/** Maximum number of source triangles retained in any auxiliary geometry view. */
export const REVIEW_AUXILIARY_TRIANGLE_LIMIT = 10_000;

export interface GeometryViewSampling {
  strategy: 'uniform-interval-including-endpoints';
  sourceAppearanceTriangles: number;
  auxiliarySourceTriangles: number;
  auxiliaryRenderedTriangles: number;
  omittedAuxiliaryTriangles: number;
  maximumAuxiliaryTriangles: number;
  sampled: boolean;
}

export interface GeometryViews {
  /** Face references for the existing turntable, wireframe, and UV renderers. */
  faces: ReviewFace[];
  sampling: GeometryViewSampling;
}

/**
 * Select a bounded, evenly spaced face list for auxiliary geometry views.
 * The input remains the complete appearance geometry and is never modified;
 * callers must keep using it for appearance rendering and full-geometry bounds.
 */
export function buildGeometryViews(
  fullAppearanceFaces: readonly ReviewFace[],
  maximumAuxiliaryTriangles = REVIEW_AUXILIARY_TRIANGLE_LIMIT,
): GeometryViews {
  if (!Array.isArray(fullAppearanceFaces)) throw new Error('Geometry view source must be a face array');
  if (!Number.isInteger(maximumAuxiliaryTriangles) || maximumAuxiliaryTriangles < 1 || maximumAuxiliaryTriangles > REVIEW_AUXILIARY_TRIANGLE_LIMIT) {
    throw new Error(`Geometry view triangle cap must be an integer from 1 through ${REVIEW_AUXILIARY_TRIANGLE_LIMIT}`);
  }

  const sourceCount = fullAppearanceFaces.length;
  if (sourceCount < 1) throw new Error('Geometry view source must contain at least one triangle');
  const renderedCount = Math.min(sourceCount, maximumAuxiliaryTriangles);
  const faces = new Array<ReviewFace>(renderedCount);

  if (renderedCount === sourceCount) {
    for (let index = 0; index < sourceCount; index++) {
      const face = fullAppearanceFaces[index];
      if (!isReviewFace(face)) throw new Error(`Geometry view source contains an invalid face at index ${index}`);
      faces[index] = face;
    }
  } else {
    for (let sample = 0; sample < renderedCount; sample++) {
      const sourceIndex = renderedCount === 1
        ? 0
        : Math.round(sample * (sourceCount - 1) / (renderedCount - 1));
      const face = fullAppearanceFaces[sourceIndex];
      if (!isReviewFace(face)) throw new Error(`Geometry view source contains an invalid face at index ${sourceIndex}`);
      faces[sample] = face;
    }
  }

  return {
    faces,
    sampling: {
      strategy: 'uniform-interval-including-endpoints',
      sourceAppearanceTriangles: sourceCount,
      auxiliarySourceTriangles: sourceCount,
      auxiliaryRenderedTriangles: renderedCount,
      omittedAuxiliaryTriangles: sourceCount - renderedCount,
      maximumAuxiliaryTriangles,
      sampled: renderedCount < sourceCount,
    },
  };
}

function isReviewFace(value: ReviewFace | undefined): value is ReviewFace {
  return value !== undefined
    && typeof value === 'object'
    && Array.isArray(value.points)
    && value.points.length === 3
    && Array.isArray(value.uv)
    && Array.isArray(value.normals)
    && Array.isArray(value.colors)
    && typeof value.material === 'object'
    && value.material !== null
    && Number.isInteger(value.materialIndex);
}
