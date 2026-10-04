import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { expect, test } from 'vitest';
import type { ReviewFace, ReviewMaterial } from '../src/review/appearance.js';
import { buildGeometryViews, REVIEW_AUXILIARY_TRIANGLE_LIMIT } from '../src/review/geometry-views.js';
import { previewGlb } from '../src/review/previews.js';
import { REVIEW_LIMITS } from '../src/review/settings.js';

const material: ReviewMaterial = {
  color: [0.7, 0.7, 0.7, 1], metallic: 0, roughness: 1, alphaMode: 'OPAQUE', alphaCutoff: 0.5,
  doubleSided: true, normalScale: 1, emissive: [0, 0, 0], occlusionStrength: 1,
};
const points: ReviewFace['points'] = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
const normals: ReviewFace['normals'] = [[0, 0, 1], [0, 0, 1], [0, 0, 1]];
const uv: ReviewFace['uv'] = [[0, 0], [1, 0], [0, 1]];
const colors: ReviewFace['colors'] = [[1, 1, 1, 1], [1, 1, 1, 1], [1, 1, 1, 1]];

function face(index: number): ReviewFace {
  return { points, normals, uv, colors, material, materialIndex: index };
}

function syntheticFaces(count: number): ReviewFace[] {
  return Array.from({ length: count }, (_, index) => face(index));
}

function largeAppearanceDocument(triangleCount: number, animate = false): Document {
  const doc = new Document(), buffer = doc.createBuffer();
  const positions = new Float32Array(triangleCount * 9), normals = new Float32Array(triangleCount * 9), uvs = new Float32Array(triangleCount * 6);
  const grid = Math.ceil(Math.sqrt(triangleCount)), worldStep = 1.8 / grid, uvStep = 1 / grid, size = worldStep * 0.2;
  for (let triangle = 0; triangle < triangleCount; triangle++) {
    const column = triangle % grid, row = Math.floor(triangle / grid);
    const x = triangle === 1 ? 7.5 : column * worldStep - 0.9, y = row * worldStep - 0.9, u = column * uvStep, v = row * uvStep;
    const vertex = triangle * 9, uvOffset = triangle * 6;
    positions.set([x, y, 0, x + size, y, 0, x, y + size, 0], vertex);
    normals.set([0, 0, 1, 0, 0, 1, 0, 0, 1], vertex);
    uvs.set([u, v, u + uvStep * 0.2, v, u, v + uvStep * 0.2], uvOffset);
    // This face is intentionally outside the primary UV tile and is not in the auxiliary sample.
    if (triangle === 1) uvs[uvOffset] = 1.2;
  }
  const primitive = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor('large positions').setBuffer(buffer).setType('VEC3').setArray(positions))
    .setAttribute('NORMAL', doc.createAccessor('large normals').setBuffer(buffer).setType('VEC3').setArray(normals))
    .setAttribute('TEXCOORD_0', doc.createAccessor('large UVs').setBuffer(buffer).setType('VEC2').setArray(uvs))
    .setMaterial(doc.createMaterial('large fixture').setBaseColorFactor([0.7, 0.4, 0.2, 1]).setMetallicFactor(0).setDoubleSided(true));
  const node = doc.createNode('large mesh').setMesh(doc.createMesh('large mesh').addPrimitive(primitive));
  const scene = doc.createScene('large review fixture').addChild(node);
  doc.getRoot().setDefaultScene(scene);
  if (animate) {
    const input = doc.createAccessor('movement times').setBuffer(buffer).setType('SCALAR').setArray(new Float32Array([0, 1]));
    const output = doc.createAccessor('movement translations').setBuffer(buffer).setType('VEC3').setArray(new Float32Array([0, 0, 0, 0.01, 0, 0]));
    const sampler = doc.createAnimationSampler().setInput(input).setOutput(output).setInterpolation('LINEAR');
    doc.createAnimation('small movement').addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler));
  }
  return doc;
}

function vertexLimitDocument(vertexCount: number): Document {
  const doc = new Document(), buffer = doc.createBuffer();
  const positions = new Float32Array(vertexCount * 3);
  doc.createScene().addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setBuffer(buffer).setType('VEC3').setArray(positions)))));
  return doc;
}

test('small auxiliary summaries preserve every source face and explicitly report no sampling', () => {
  const source = syntheticFaces(4), result = buildGeometryViews(source, 8);
  expect(result.faces).toEqual(source);
  expect(result.faces).not.toBe(source);
  expect(result.faces[0]).toBe(source[0]);
  expect(result.sampling).toEqual({
    strategy: 'uniform-interval-including-endpoints', sourceAppearanceTriangles: 4,
    auxiliarySourceTriangles: 4, auxiliaryRenderedTriangles: 4, omittedAuxiliaryTriangles: 0,
    maximumAuxiliaryTriangles: 8, sampled: false,
  });
  expect(source.map(item => item.materialIndex)).toEqual([0, 1, 2, 3]);
});

test('large auxiliary summaries select a uniform bounded interval and retain both endpoints', () => {
  const source = syntheticFaces(100_001), result = buildGeometryViews(source);
  const selected = result.faces.map(item => item.materialIndex);
  const gaps = selected.slice(1).map((index, at) => index - selected[at]!);
  expect(result.faces).toHaveLength(REVIEW_AUXILIARY_TRIANGLE_LIMIT);
  expect(selected[0]).toBe(0);
  expect(selected.at(-1)).toBe(source.length - 1);
  expect(new Set(selected).size).toBe(REVIEW_AUXILIARY_TRIANGLE_LIMIT);
  expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThanOrEqual(1);
  expect(result.sampling.sourceAppearanceTriangles).toBe(100_001);
  expect(result.sampling.auxiliarySourceTriangles).toBe(100_001);
  expect(result.sampling.auxiliaryRenderedTriangles).toBe(10_000);
  expect(result.sampling.omittedAuxiliaryTriangles).toBe(90_001);
  expect(result.sampling.sampled).toBe(true);
  expect(source[0]?.materialIndex).toBe(0);
  expect(source.at(-1)?.materialIndex).toBe(100_000);
});

test('invalid source geometry and caps fail closed', () => {
  expect(() => buildGeometryViews([])).toThrow('at least one triangle');
  expect(() => buildGeometryViews(null as unknown as ReviewFace[])).toThrow('face array');
  expect(() => buildGeometryViews([face(0), undefined as unknown as ReviewFace])).toThrow('invalid face');
  for (const cap of [0, -1, 1.5, REVIEW_AUXILIARY_TRIANGLE_LIMIT + 1]) {
    expect(() => buildGeometryViews([face(0)], cap)).toThrow('triangle cap');
  }
});

test('100k-face CPU envelope keeps selection allocation and timing bounded', async () => {
  const sourceCount = 100_000;
  const source = syntheticFaces(sourceCount);
  const rssBefore = process.memoryUsage().rss;
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const result = buildGeometryViews(source);
  const durationMs = performance.now() - started;
  const rssAfter = process.memoryUsage().rss;
  const heapAfter = process.memoryUsage().heapUsed;

  expect(result.sampling.sourceAppearanceTriangles).toBe(sourceCount);
  expect(result.sampling.auxiliaryRenderedTriangles).toBeLessThanOrEqual(REVIEW_AUXILIARY_TRIANGLE_LIMIT);
  expect(result.faces).toHaveLength(REVIEW_AUXILIARY_TRIANGLE_LIMIT);
  expect(durationMs).toBeLessThan(20_000);

  const report = {
    case: 'synthetic CPU geometry view selection',
    sourceFaceCount: sourceCount,
    auxiliaryTriangleLimit: REVIEW_AUXILIARY_TRIANGLE_LIMIT,
    auxiliaryRenderedTriangles: result.faces.length,
    omittedTriangles: result.sampling.omittedAuxiliaryTriangles,
    durationMs,
    rssBeforeBytes: rssBefore,
    rssAfterBytes: rssAfter,
    rssDeltaBytes: rssAfter - rssBefore,
    heapUsedBeforeBytes: heapBefore,
    heapUsedAfterBytes: heapAfter,
    heapUsedDeltaBytes: heapAfter - heapBefore,
    method: 'direct TypeScript helper; face records share immutable coordinate/material fixtures',
  };
  const evidenceDirectory = process.env.GDS_REVIEW_ENVELOPE;
  if (evidenceDirectory) {
    await fs.mkdir(evidenceDirectory, { recursive: true });
    await fs.writeFile(path.join(evidenceDirectory, 'geometry-views-100k.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
});

test('50k-triangle integrated appearance run records a practical CPU resource point', async () => {
  const doc = largeAppearanceDocument(50_000), source = await new NodeIO().writeBinary(doc);
  const rssBefore = process.memoryUsage().rss, heapBefore = process.memoryUsage().heapUsed, started = performance.now();
  const preview = await previewGlb(source, { mode: 'appearance', resolution: 128 });
  const durationMs = performance.now() - started, rssAfter = process.memoryUsage().rss, heapAfter = process.memoryUsage().heapUsed;
  expect(preview.envelope.triangles).toBe(50_000);
  expect(preview.envelope.appearanceTrianglesRendered).toBe(50_000);
  expect(preview.envelope.vertexInstances).toBe(150_000);
  expect(preview.envelope.auxiliaryGeometry.auxiliaryRenderedTriangles).toBe(REVIEW_LIMITS.auxiliaryTriangles);
  expect(preview.uvEvidence.outOfTileTriangles).toBe(1);
  expect(preview.envelope.boundsTrianglesScanned).toBe(100_000);
  expect(preview.framing.referenceBounds.maximum[0]).toBeGreaterThan(7.5);
  expect(preview.envelope.clippingPointChecks).toBeGreaterThan(0);
  expect(preview.envelope.rasterSampleChecks).toBeLessThanOrEqual(REVIEW_LIMITS.rasterSamples);
  expect(preview.warnings.join(' ')).toContain(`${REVIEW_LIMITS.auxiliaryTriangles.toLocaleString('en-US')} of 50,000`);
  expect(preview.warnings.join(' ')).toContain('BLEND is depth-sorted per pixel');
  expect(durationMs).toBeLessThan(60_000);
  const report = {
    case: 'integrated generated GLB CPU appearance preview',
    sourceTriangles: preview.envelope.triangles,
    sourceVertexInstances: preview.envelope.vertexInstances,
    previewDurationMs: durationMs,
    rssBeforeBytes: rssBefore,
    rssAfterBytes: rssAfter,
    rssDeltaBytes: rssAfter - rssBefore,
    heapUsedBeforeBytes: heapBefore,
    heapUsedAfterBytes: heapAfter,
    heapUsedDeltaBytes: heapAfter - heapBefore,
    envelope: preview.envelope,
    uvEvidence: preview.uvEvidence,
    outputBytes: {
      sourceGlb: source.byteLength,
      auxiliarySvg: preview.envelope.auxiliarySvgBytes,
      appearanceImageStrings: preview.envelope.appearanceImageStringBytes,
    },
  };
  const evidenceDirectory = process.env.GDS_REVIEW_ENVELOPE;
  if (evidenceDirectory) {
    await fs.mkdir(evidenceDirectory, { recursive: true });
    await fs.writeFile(path.join(evidenceDirectory, 'appearance-50k.glb'), source);
    await fs.writeFile(path.join(evidenceDirectory, 'appearance-50k.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
}, 60_000);

test('50k selected-pose appearance clears reference faces before its second geometry pass', async () => {
  const doc = largeAppearanceDocument(50_000, true), source = await new NodeIO().writeBinary(doc);
  const rssBefore = process.memoryUsage().rss, heapBefore = process.memoryUsage().heapUsed, started = performance.now();
  const preview = await previewGlb(source, { mode: 'appearance', resolution: 128, pose: { clipIndex: 0, timeSeconds: 1 } });
  const durationMs = performance.now() - started, rssAfter = process.memoryUsage().rss, heapAfter = process.memoryUsage().heapUsed;
  expect(preview.envelope.geometryPasses).toBe(2);
  expect(preview.selectedTimeSeconds).toBe(1);
  expect(preview.envelope.triangles).toBe(50_000);
  expect(preview.envelope.appearanceTrianglesRendered).toBe(50_000);
  expect(preview.envelope.boundsTrianglesScanned).toBe(100_000);
  expect(preview.envelope.auxiliaryGeometry.auxiliaryRenderedTriangles).toBe(REVIEW_LIMITS.auxiliaryTriangles);
  expect(preview.envelope.rasterSampleChecks).toBeLessThanOrEqual(REVIEW_LIMITS.rasterSamples);
  expect(durationMs).toBeLessThan(60_000);
  const report = {
    case: 'integrated generated GLB selected-pose appearance preview',
    sourceTriangles: preview.envelope.triangles,
    sourceVertexInstances: preview.envelope.vertexInstances,
    previewDurationMs: durationMs,
    rssBeforeBytes: rssBefore,
    rssAfterBytes: rssAfter,
    rssDeltaBytes: rssAfter - rssBefore,
    heapUsedBeforeBytes: heapBefore,
    heapUsedAfterBytes: heapAfter,
    heapUsedDeltaBytes: heapAfter - heapBefore,
    envelope: preview.envelope,
  };
  const evidenceDirectory = process.env.GDS_REVIEW_ENVELOPE;
  if (evidenceDirectory) {
    await fs.mkdir(evidenceDirectory, { recursive: true });
    await fs.writeFile(path.join(evidenceDirectory, 'appearance-pose-50k.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
}, 60_000);

test('100k-triangle GLB is refused at the practical vertex cap with measured CPU work', async () => {
  const buildStarted = performance.now();
  const doc = largeAppearanceDocument(100_000);
  const source = await new NodeIO().writeBinary(doc);
  const fixtureBuildMs = performance.now() - buildStarted;
  expect(source.byteLength).toBeLessThanOrEqual(REVIEW_LIMITS.sourceBytes);

  const rssBefore = process.memoryUsage().rss, heapBefore = process.memoryUsage().heapUsed, started = performance.now();
  let refusal = '';
  try { await previewGlb(source, { mode: 'appearance', resolution: 128 }); }
  catch (error) { refusal = error instanceof Error ? error.message : String(error); }
  const durationMs = performance.now() - started, rssAfter = process.memoryUsage().rss, heapAfter = process.memoryUsage().heapUsed;
  expect(refusal).toContain(`vertex instance limit is ${REVIEW_LIMITS.vertices.toLocaleString('en-US')}`);
  expect(durationMs).toBeLessThan(60_000);

  const report = {
    case: 'integrated generated 100k-triangle GLB refusal',
    sourceTriangles: 100_000,
    sourceVertexInstances: 300_000,
    refusal,
    fixtureBuildMs,
    refusalDurationMs: durationMs,
    rssBeforeBytes: rssBefore,
    rssAfterBytes: rssAfter,
    rssDeltaBytes: rssAfter - rssBefore,
    heapUsedBeforeBytes: heapBefore,
    heapUsedAfterBytes: heapAfter,
    heapUsedDeltaBytes: heapAfter - heapBefore,
    limits: REVIEW_LIMITS,
    sourceBytes: source.byteLength,
    outputBytes: 0,
  };
  const evidenceDirectory = process.env.GDS_REVIEW_ENVELOPE;
  if (evidenceDirectory) {
    await fs.mkdir(evidenceDirectory, { recursive: true });
    await fs.writeFile(path.join(evidenceDirectory, 'appearance-100k-refused.glb'), source);
    await fs.writeFile(path.join(evidenceDirectory, 'appearance-100k-refusal.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
}, 60_000);

test('geometry review refuses vertex instances above its declared cap', async () => {
  const source = await new NodeIO().writeBinary(vertexLimitDocument(REVIEW_LIMITS.vertices + 3));
  await expect(previewGlb(source)).rejects.toThrow(`vertex instance limit is ${REVIEW_LIMITS.vertices.toLocaleString('en-US')}`);
});
