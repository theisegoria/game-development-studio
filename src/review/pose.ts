import { Accessor, type Document } from '@gltf-transform/core';
import type { ReviewSettings } from './settings.js';
import { REVIEW_LIMITS } from './settings.js';

export interface ClipInfo {
  index: number;
  name: string;
  durationSeconds: number;
  channels: number;
  interpolation: string[];
  supported: boolean;
  ignoredChannels?: number;
  warnings?: string[];
}

type AnimationTarget = 'translation' | 'rotation' | 'scale' | 'weights';

function targetWidth(node: NonNullable<ReturnType<import('@gltf-transform/core').AnimationChannel['getTargetNode']>>, target: AnimationTarget): number {
  if (target !== 'weights') return target === 'rotation' ? 4 : 3;
  const primitives = node.getMesh()?.listPrimitives() ?? [];
  if (!primitives.length) return 0;
  const width = primitives[0]!.listTargets().length;
  if (width < 1 || width > 16 || primitives.some((primitive) => primitive.listTargets().length !== width)) return 0;
  return width;
}

function readOutput(output: Accessor, target: AnimationTarget, width: number, key: number, cubic: boolean, part = 1): number[] {
  if (target === 'weights') {
    const start = (cubic ? key * 3 + part : key) * width;
    return Array.from({ length: width }, (_, component) => output.getScalar(start + component));
  }
  return output.getElement(cubic ? key * 3 + part : key, []);
}

function outputValuesAreFinite(output: Accessor): boolean {
  for (let element = 0; element < output.getCount(); element++) {
    const values = output.getType() === Accessor.Type.SCALAR ? [output.getScalar(element)] : output.getElement(element, []);
    if (!values.every(Number.isFinite)) return false;
  }
  return true;
}

function validAnimationOutputComponentType(output: Accessor, target: AnimationTarget): boolean {
  const componentType = output.getComponentType();
  if (componentType === Accessor.ComponentType.FLOAT) return !output.getNormalized();
  if (target === 'translation' || target === 'scale') return false;
  return output.getNormalized() && [
    Accessor.ComponentType.BYTE,
    Accessor.ComponentType.UNSIGNED_BYTE,
    Accessor.ComponentType.SHORT,
    Accessor.ComponentType.UNSIGNED_SHORT,
  ].includes(componentType);
}

function normalizeQuaternion(value: number[]): number[] {
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length < 1e-8) throw new Error('Invalid animation quaternion');
  return value.map((component) => component / length);
}

function hermite(value0: number[], outTangent0: number[], value1: number[], inTangent1: number[], t: number, duration: number): number[] {
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  const value = value0.map((component, index) =>
    h00 * component + duration * h10 * outTangent0[index]! + h01 * value1[index]! + duration * h11 * inTangent1[index]!,
  );
  if (!value.every(Number.isFinite)) throw new Error('Non-finite interpolated animation output');
  return value;
}

/** Deterministic selected-time evaluation; no playback clock or external runtime. */
export function applyReviewPose(doc: Document, pose: ReviewSettings['pose']): { clips: ClipInfo[]; selectedTimeSeconds?: number } {
  const animations = doc.getRoot().listAnimations();
  if (animations.length > REVIEW_LIMITS.animationClips) throw new Error('Review animation clip budget exceeded');
  const nodeIndices = new Map(doc.getRoot().listNodes().map((node, index) => [node, index] as const));

  let totalKeys = 0, totalChannels = 0;
  for (const animation of animations) {
    const channels = animation.listChannels();
    totalChannels += channels.length;
    if (totalChannels > REVIEW_LIMITS.animationChannels) throw new Error('Review animation channel budget exceeded');
    for (const channel of channels) {
      const input = channel.getSampler()?.getInput();
      if (input) {
        totalKeys += input.getCount();
        if (totalKeys > REVIEW_LIMITS.animationKeys) throw new Error('Review animation key budget exceeded');
      }
    }
  }

  const clips = animations.map((animation, index) => {
    let durationSeconds = 0;
    const channels = animation.listChannels();
    const interpolation = new Set<string>();
    const targets = new Set<string>();
    let activeChannels = 0, ignoredChannels = 0;

    for (const channel of channels) {
      const sampler = channel.getSampler(), input = sampler?.getInput(), output = sampler?.getOutput();
      const node = channel.getTargetNode(), target = channel.getTargetPath();
      if (!sampler || !input || !output || !target || input.getType() !== Accessor.Type.SCALAR || !input.getCount()) {
        throw new Error('Malformed animation sampler');
      }
      if (input.getComponentType() !== Accessor.ComponentType.FLOAT || input.getNormalized()) throw new Error('Animation input must be a float32 SCALAR accessor');
      const mode = sampler.getInterpolation();
      if (mode !== 'LINEAR' && mode !== 'STEP' && mode !== 'CUBICSPLINE') throw new Error(`Unsupported animation interpolation ${mode}`);
      const cubic = mode === 'CUBICSPLINE';
      if (cubic && input.getCount() < 2) throw new Error('CUBICSPLINE animation requires at least two keyframes');

      let previous = -Infinity;
      for (let key = 0; key < input.getCount(); key++) {
        const time = input.getScalar(key);
        if (!Number.isFinite(time) || time < 0 || time <= previous) throw new Error('Animation times must be finite, nonnegative and strictly increasing');
        previous = time;
        if (node) durationSeconds = Math.max(durationSeconds, time);
      }

      if (target !== 'translation' && target !== 'rotation' && target !== 'scale' && target !== 'weights') {
        if (node) throw new Error(`Unsupported animation target ${target}`);
        if (!outputValuesAreFinite(output)) throw new Error('Non-finite animation output or tangent');
        ignoredChannels++;
        continue;
      }

      const expectedType = target === 'weights' ? Accessor.Type.SCALAR : target === 'rotation' ? Accessor.Type.VEC4 : Accessor.Type.VEC3;
      let width = node ? targetWidth(node, target) : target === 'rotation' ? 4 : target === 'weights' ? 0 : 3;
      if (!node && target === 'weights' && output.getType() === Accessor.Type.SCALAR) {
        const valuesPerKey = input.getCount() * (cubic ? 3 : 1);
        width = output.getCount() / valuesPerKey;
      }
      if (!Number.isSafeInteger(width) || width < 1 || width > 16) throw new Error('Animation output count/type does not match target');
      const expectedCount = input.getCount() * (cubic ? 3 : 1) * (target === 'weights' ? width : 1);
      if (output.getType() !== expectedType || output.getCount() !== expectedCount || !validAnimationOutputComponentType(output, target)) {
        throw new Error('Animation output count/type does not match target');
      }
      if (!outputValuesAreFinite(output)) throw new Error('Non-finite animation output or tangent');

      if (!node) {
        ignoredChannels++;
        continue;
      }

      const nodeIndex = nodeIndices.get(node);
      if (nodeIndex === undefined) throw new Error('Animation target node does not belong to the document');
      const targetKey = `${nodeIndex}:${target}`;
      if (targets.has(targetKey)) throw new Error('Duplicate animation channel target');
      targets.add(targetKey);
      activeChannels++;

      interpolation.add(mode);
      for (let key = 0; key < input.getCount(); key++) {
        if (target === 'rotation') {
          const value = readOutput(output, target, width, key, cubic);
          const length = Math.hypot(...value);
          if (!Number.isFinite(length) || length < 1e-8) throw new Error('Invalid animation quaternion');
        }
      }
    }

    const warnings = ignoredChannels > 0
      ? [activeChannels === 0
        ? `No active core node-target channels are available for native sampling; ignored ${ignoredChannels} channel${ignoredChannels === 1 ? '' : 's'} without a target node.`
        : `Ignored ${ignoredChannels} animation channel${ignoredChannels === 1 ? '' : 's'} without a target node.`]
      : activeChannels === 0 ? ['No active core node-target channels are available for native sampling.'] : undefined;
    return {
      index,
      name: animation.getName(),
      durationSeconds,
      channels: activeChannels,
      interpolation: [...interpolation],
      supported: activeChannels > 0,
      ...(ignoredChannels > 0 ? { ignoredChannels } : {}),
      ...(warnings ? { warnings } : {}),
    };
  });

  if (!pose) return { clips };
  if (!Number.isInteger(pose.clipIndex) || pose.clipIndex < 0 || !Number.isFinite(pose.timeSeconds) || pose.timeSeconds < 0 || pose.timeSeconds > 86400) {
    throw new Error('Invalid selected animation pose');
  }
  const animation = animations[pose.clipIndex], clip = clips[pose.clipIndex];
  if (!animation || !clip) throw new Error('Selected animation clip does not exist');
  if (!clip.channels) throw new Error('Selected animation clip has no active core node-target channels');
  const time = Math.min(pose.timeSeconds, clip.durationSeconds);

  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode(), target = channel.getTargetPath(), sampler = channel.getSampler();
    const input = sampler?.getInput(), output = sampler?.getOutput();
    if (!node) continue;
    if (!target || !sampler || !input || !output || !input.getCount()) throw new Error('Malformed animation channel');
    if (target !== 'translation' && target !== 'rotation' && target !== 'scale' && target !== 'weights') throw new Error(`Unsupported animation target ${target}`);

    const mode = sampler.getInterpolation(), cubic = mode === 'CUBICSPLINE';
    const width = targetWidth(node, target);
    if (!width) throw new Error('Animation output count/type does not match target');
    let lower = 0;
    while (lower + 1 < input.getCount() && input.getScalar(lower + 1) <= time) lower++;
    const upper = Math.min(lower + 1, input.getCount() - 1);
    const lowerTime = input.getScalar(lower), upperTime = input.getScalar(upper);
    const atOrBeforeFirst = time <= input.getScalar(0);
    const atOrAfterLast = time >= input.getScalar(input.getCount() - 1);

    let value: number[];
    if (atOrBeforeFirst || atOrAfterLast || lower === upper) {
      value = readOutput(output, target, width, atOrAfterLast ? input.getCount() - 1 : 0, cubic);
    } else if (mode === 'STEP') {
      value = readOutput(output, target, width, lower, false);
    } else {
      const blend = Math.max(0, Math.min(1, (time - lowerTime) / (upperTime - lowerTime)));
      if (cubic) {
        const value0 = readOutput(output, target, width, lower, true);
        const outTangent0 = readOutput(output, target, width, lower, true, 2);
        const value1 = readOutput(output, target, width, upper, true);
        const inTangent1 = readOutput(output, target, width, upper, true, 0);
        value = hermite(value0, outTangent0, value1, inTangent1, blend, upperTime - lowerTime);
        if (target === 'rotation') value = normalizeQuaternion(value);
      } else {
        const a = readOutput(output, target, width, lower, false);
        const b = readOutput(output, target, width, upper, false);
        value = a.map((component, componentIndex) => component * (1 - blend) + b[componentIndex]! * blend);
        if (target === 'rotation') {
          const qa = normalizeQuaternion(a), qb = normalizeQuaternion(b);
          let dot = qa.reduce((sum, component, componentIndex) => sum + component * qb[componentIndex]!, 0);
          if (dot < 0) { qb.forEach((component, componentIndex) => { qb[componentIndex] = -component; }); dot = -dot; }
          if (dot > 0.9995) value = normalizeQuaternion(qa.map((component, componentIndex) => component * (1 - blend) + qb[componentIndex]! * blend));
          else {
            const angle = Math.acos(Math.min(1, dot));
            value = qa.map((component, componentIndex) => (component * Math.sin((1 - blend) * angle) + qb[componentIndex]! * Math.sin(blend * angle)) / Math.sin(angle));
          }
        }
      }
    }

    if (!value.every(Number.isFinite)) throw new Error('Non-finite interpolated animation output');
    if (target === 'rotation') value = normalizeQuaternion(value);
    if (target === 'rotation') node.setRotation(value as [number, number, number, number]);
    else if (target === 'translation') node.setTranslation(value as [number, number, number]);
    else if (target === 'scale') node.setScale(value as [number, number, number]);
    else node.setWeights(value);
  }

  return { clips, selectedTimeSeconds: time };
}
