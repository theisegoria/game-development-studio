import { Accessor, Document } from '@gltf-transform/core';
import { expect, test } from 'vitest';
import { applyReviewPose } from '../src/review/pose.js';

function fixture() {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene('review');
  doc.getRoot().setDefaultScene(scene);
  const node = doc.createNode('animated');
  scene.addChild(node);
  const input = doc.createAccessor('times').setBuffer(buffer).setType(Accessor.Type.SCALAR!).setArray(new Float32Array([0, 2]));
  const animation = doc.createAnimation('clip');
  return { doc, buffer, node, input, animation };
}

function channel(f: ReturnType<typeof fixture>, target: 'translation' | 'scale' | 'rotation' | 'weights', outputType: 'SCALAR' | 'VEC3' | 'VEC4', values: number[], interpolation: 'LINEAR' | 'STEP' | 'CUBICSPLINE' = 'CUBICSPLINE', width = 1) {
  if (target === 'weights') {
    const position = f.doc.createAccessor('base').setBuffer(f.buffer).setType(Accessor.Type.VEC3!).setArray(new Float32Array([0, 0, 0]));
    const primitive = f.doc.createPrimitive().setAttribute('POSITION', position);
    for (let i = 0; i < width; i++) {
      const delta = f.doc.createAccessor(`delta ${i}`).setBuffer(f.buffer).setType(Accessor.Type.VEC3!).setArray(new Float32Array([0, 0, 0]));
      primitive.addTarget(f.doc.createPrimitiveTarget(`target ${i}`).setAttribute('POSITION', delta));
    }
    f.node.setMesh(f.doc.createMesh('morph').addPrimitive(primitive));
  }
  const output = f.doc.createAccessor('values').setBuffer(f.buffer).setType(Accessor.Type[outputType]!).setArray(new Float32Array(values));
  const sampler = f.doc.createAnimationSampler().setInput(f.input).setOutput(output).setInterpolation(interpolation);
  f.animation.addSampler(sampler).addChannel(f.doc.createAnimationChannel().setTargetNode(f.node).setTargetPath(target).setSampler(sampler));
  return output;
}

function noNodeChannel(f: ReturnType<typeof fixture>, target: 'translation' | 'scale' | 'rotation' | 'weights' = 'translation') {
  const outputType = target === 'rotation' ? Accessor.Type.VEC4! : target === 'weights' ? Accessor.Type.SCALAR! : Accessor.Type.VEC3!;
  const outputWidth = target === 'rotation' ? 4 : target === 'weights' ? 1 : 3;
  const output = f.doc.createAccessor('ignored values').setBuffer(f.buffer).setType(outputType).setArray(new Float32Array(2 * outputWidth));
  const sampler = f.doc.createAnimationSampler().setInput(f.input).setOutput(output).setInterpolation('LINEAR');
  f.animation.addSampler(sampler).addChannel(f.doc.createAnimationChannel().setTargetPath(target).setSampler(sampler));
  return output;
}

test('CUBICSPLINE applies Hermite tangents scaled by key interval duration to TRS and morph weights', () => {
  const f = fixture();
  channel(f, 'translation', 'VEC3', [
    0, 0, 0,  0, 0, 0,  2, 0, 0,
    0, 0, 0,  0, 0, 0,  0, 0, 0,
  ]);
  channel(f, 'scale', 'VEC3', [
    0, 0, 0,  1, 1, 1,  0, 2, 0,
    0, 0, 0,  1, 1, 1,  0, 0, 0,
  ]);
  channel(f, 'weights', 'SCALAR', [
    0, 0,  0, 0,  2, 4,
    0, 0,  0, 0,  0, 0,
  ], 'CUBICSPLINE', 2);

  const result = applyReviewPose(f.doc, { clipIndex: 0, timeSeconds: 1 });
  expect(result.clips[0]?.supported).toBe(true);
  expect(f.node.getTranslation()[0]).toBeCloseTo(0.5);
  expect(f.node.getScale()[1]).toBeCloseTo(1.5);
  expect(f.node.getWeights()).toEqual([0.5, 1]);
});

test('CUBICSPLINE rotation uses component Hermite then normalization without slerp or sign flipping', () => {
  const f = fixture();
  const end = Math.sqrt(3) / 2;
  channel(f, 'rotation', 'VEC4', [
    0, 0, 0, 0,  0, 0, 0, 1,  0, 0, 0, 0,
    0, 0, 0, 0,  0, end, 0, 0.5,  0, 0, 0, 0,
  ]);
  applyReviewPose(f.doc, { clipIndex: 0, timeSeconds: 0.5 });
  const rotation = f.node.getRotation();
  expect(Math.hypot(...rotation)).toBeCloseTo(1);
  // At u=.25, normalized component interpolation gives y≈.145; slerp gives sin(15°)≈.259.
  expect(rotation[1]).toBeCloseTo(0.145, 2);

  const opposite = fixture();
  channel(opposite, 'rotation', 'VEC4', [
    0, 0, 0, 0,  0, 0, 0, 1,  0, 0, 0, 0,
    0, 0, 0, 0,  0, 0, 0, -1,  0, 0, 0, 0,
  ]);
  expect(() => applyReviewPose(opposite.doc, { clipIndex: 0, timeSeconds: 1 })).toThrow('Invalid animation quaternion');
});

test('animation validation rejects malformed CUBICSPLINE shapes, key counts, non-finite tangents, and singular key quaternions', () => {
  const wrongShape = fixture();
  channel(wrongShape, 'translation', 'VEC4', new Array(24).fill(0));
  expect(() => applyReviewPose(wrongShape.doc, undefined)).toThrow('count/type');

  const oneKey = fixture();
  oneKey.input.setArray(new Float32Array([0]));
  channel(oneKey, 'translation', 'VEC3', new Array(9).fill(0));
  expect(() => applyReviewPose(oneKey.doc, undefined)).toThrow('at least two keyframes');

  const nonFiniteTangent = fixture();
  const output = channel(nonFiniteTangent, 'translation', 'VEC3', [
    Number.NaN, 0, 0,  0, 0, 0,  0, 0, 0,
    0, 0, 0,  0, 0, 0,  0, 0, 0,
  ]);
  expect(() => applyReviewPose(nonFiniteTangent.doc, undefined)).toThrow('Non-finite animation output or tangent');
  output.getArray()![0] = 0;

  const singularQuaternion = fixture();
  channel(singularQuaternion, 'rotation', 'VEC4', [
    0, 0, 0, 0,  0, 0, 0, 0,  0, 0, 0, 0,
    0, 0, 0, 0,  0, 0, 0, 1,  0, 0, 0, 0,
  ]);
  expect(() => applyReviewPose(singularQuaternion.doc, undefined)).toThrow('Invalid animation quaternion');
});

test('CUBICSPLINE output tangents and values use full scalar/vector output layouts', () => {
  const weights = fixture();
  channel(weights, 'weights', 'SCALAR', [
    0, 0,  0, 0,  2, 4,
    0, 0,  0, 0,  0, 0,
  ], 'CUBICSPLINE', 2);
  applyReviewPose(weights.doc, { clipIndex: 0, timeSeconds: 1 });
  expect(weights.node.getWeights()).toEqual([0.5, 1]);

  const shortWeights = fixture();
  channel(shortWeights, 'weights', 'SCALAR', new Array(6).fill(0), 'CUBICSPLINE', 2);
  expect(() => applyReviewPose(shortWeights.doc, undefined)).toThrow('count/type');
});

test('animation output component types follow the target accessor table', () => {
  for (const target of ['translation', 'scale'] as const) {
    const f = fixture();
    const output = channel(f, target, 'VEC3', new Array(18).fill(0));
    output.setArray(new Uint8Array(18)).setNormalized(true);
    expect(() => applyReviewPose(f.doc, undefined)).toThrow('count/type');
  }

  const rotation = fixture();
  const rotationOutput = channel(rotation, 'rotation', 'VEC4', new Array(24).fill(0));
  rotationOutput.setArray(new Int8Array([
    0, 0, 0, 0,  0, 0, 0, 127,  0, 0, 0, 0,
    0, 0, 0, 0,  0, 0, 0, 127,  0, 0, 0, 0,
  ])).setNormalized(true);
  expect(applyReviewPose(rotation.doc, undefined).clips[0]?.supported).toBe(true);

  const weights = fixture();
  const weightOutput = channel(weights, 'weights', 'SCALAR', new Array(6).fill(0));
  weightOutput.setArray(new Uint8Array(6)).setNormalized(true);
  expect(applyReviewPose(weights.doc, undefined).clips[0]?.supported).toBe(true);
});

test('clip inventory rejects duplicate and foreign node targets even without a selected pose', () => {
  const duplicate = fixture();
  channel(duplicate, 'translation', 'VEC3', new Array(18).fill(0));
  channel(duplicate, 'translation', 'VEC3', new Array(18).fill(0));
  expect(() => applyReviewPose(duplicate.doc, undefined)).toThrow('Duplicate animation channel target');

  const foreign = fixture();
  const output = foreign.doc.createAccessor('output').setBuffer(foreign.buffer).setType(Accessor.Type.VEC3!).setArray(new Float32Array(18));
  const sampler = foreign.doc.createAnimationSampler().setInput(foreign.input).setOutput(output).setInterpolation('CUBICSPLINE');
  foreign.animation.addSampler(sampler).addChannel(foreign.doc.createAnimationChannel().setTargetNode(foreign.node).setTargetPath('translation').setSampler(sampler));
  const missingNodeView = {
    getRoot: () => ({ listAnimations: () => foreign.doc.getRoot().listAnimations(), listNodes: () => [] }),
  } as unknown as Document;
  expect(() => applyReviewPose(missingNodeView, undefined)).toThrow('does not belong to the document');
});

test('node-less channels are reported as ignored and all-no-op clips cannot claim native sampling', () => {
  const f = fixture();
  noNodeChannel(f);
  const clip = applyReviewPose(f.doc, undefined).clips[0]!;
  expect(clip).toMatchObject({ channels: 0, interpolation: [], supported: false, ignoredChannels: 1 });
  expect(clip.warnings?.join(' ')).toContain('No active core node-target channels');
  expect(() => applyReviewPose(f.doc, { clipIndex: 0, timeSeconds: 1 })).toThrow('no active core node-target channels');

  const active = fixture();
  channel(active, 'translation', 'VEC3', [
    0, 0, 0,  0, 0, 0,  2, 0, 0,
    0, 0, 0,  0, 0, 0,  0, 0, 0,
  ]);
  noNodeChannel(active, 'scale');
  const mixed = applyReviewPose(active.doc, { clipIndex: 0, timeSeconds: 1 });
  expect(mixed.clips[0]).toMatchObject({ channels: 1, interpolation: ['CUBICSPLINE'], supported: true, ignoredChannels: 1 });
  expect(mixed.clips[0]?.warnings?.join(' ')).toContain('Ignored 1 animation channel');
  expect(active.node.getTranslation()[0]).toBeCloseTo(0.5);
});

test('node-less channels with unknown paths are ignored without inferring a target output shape', () => {
  const f = fixture();
  const output = f.doc.createAccessor('ignored extension-like values').setBuffer(f.buffer).setType(Accessor.Type.MAT4!).setArray(new Float32Array(32));
  const sampler = f.doc.createAnimationSampler().setInput(f.input).setOutput(output).setInterpolation('LINEAR');
  f.animation.addSampler(sampler).addChannel(f.doc.createAnimationChannel().setTargetPath('custom-property' as never).setSampler(sampler));

  const clip = applyReviewPose(f.doc, undefined).clips[0]!;
  expect(clip).toMatchObject({ channels: 0, interpolation: [], supported: false, ignoredChannels: 1 });
  expect(clip.warnings?.join(' ')).toContain('No active core node-target channels');
  expect(() => applyReviewPose(f.doc, { clipIndex: 0, timeSeconds: 1 })).toThrow('no active core node-target channels');
});

test('node-less channels retain input validation and cumulative key budgets', () => {
  const invalidTime = fixture();
  noNodeChannel(invalidTime);
  invalidTime.input.setArray(new Float32Array([0, Number.NaN]));
  expect(() => applyReviewPose(invalidTime.doc, undefined)).toThrow('Animation times must be finite');

  const overBudget = fixture();
  overBudget.input.setArray(new Float32Array(Array.from({ length: 60_000 }, (_, index) => index)));
  const output = overBudget.doc.createAccessor('ignored large values').setBuffer(overBudget.buffer).setType(Accessor.Type.VEC3!).setArray(new Float32Array(180_000));
  const sampler = overBudget.doc.createAnimationSampler().setInput(overBudget.input).setOutput(output).setInterpolation('LINEAR');
  for (let index = 0; index < 2; index++) {
    overBudget.animation.addSampler(sampler).addChannel(overBudget.doc.createAnimationChannel().setTargetPath('translation').setSampler(sampler));
  }
  expect(() => applyReviewPose(overBudget.doc, undefined)).toThrow('key budget');

  const wrongShape = fixture();
  noNodeChannel(wrongShape).setType(Accessor.Type.VEC4!);
  expect(() => applyReviewPose(wrongShape.doc, undefined)).toThrow('count/type');

  const tooManyWeights = fixture();
  noNodeChannel(tooManyWeights, 'weights').setArray(new Float32Array(34));
  expect(() => applyReviewPose(tooManyWeights.doc, undefined)).toThrow('count/type');

  const nonFiniteOutput = fixture();
  noNodeChannel(nonFiniteOutput).setArray(new Float32Array([Number.NaN, 0, 0, 0, 0, 0]));
  expect(() => applyReviewPose(nonFiniteOutput.doc, undefined)).toThrow('Non-finite animation output or tangent');
});
