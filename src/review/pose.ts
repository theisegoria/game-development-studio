import type { Document } from '@gltf-transform/core';
import type { ReviewSettings } from './settings.js';
import { REVIEW_LIMITS } from './settings.js';

export interface ClipInfo { index: number; name: string; durationSeconds: number; channels: number; interpolation: string[]; supported: boolean }

/** Deterministic selected-time evaluation; no playback clock or external runtime. */
export function applyReviewPose(doc: Document, pose: ReviewSettings['pose']): { clips: ClipInfo[]; selectedTimeSeconds?: number } {
  if (doc.getRoot().listAnimations().length > REVIEW_LIMITS.animationClips) throw new Error('Review animation clip budget exceeded');
  let totalKeys = 0, totalChannels = 0;
  const clips = doc.getRoot().listAnimations().map((animation, index) => {
    let durationSeconds = 0;
    totalChannels += animation.listChannels().length;
    if (totalChannels > REVIEW_LIMITS.animationChannels) throw new Error('Review animation channel budget exceeded');
    const interpolation = new Set<string>();
    for (const channel of animation.listChannels()) {
      const sampler = channel.getSampler(), input = sampler?.getInput();
      const output=sampler?.getOutput(),node=channel.getTargetNode(),target=channel.getTargetPath();
      if (!sampler || !input || !output || !node || !target || input.getElementSize()!==1 || !input.getCount()) throw new Error('Malformed animation sampler');
      const width=target==='weights'?node.getMesh()?.listPrimitives()[0]?.listTargets().length??0:target==='rotation'?4:3;
      if(width<1||width>16||output.getElementSize()!==(target==='weights'?1:width)||output.getCount()!==input.getCount()*(target==='weights'?width:1)*(sampler.getInterpolation()==='CUBICSPLINE'?3:1)) throw new Error('Animation output count/type does not match target');
      interpolation.add(sampler.getInterpolation()); totalKeys += input.getCount();
      if (totalKeys > REVIEW_LIMITS.animationKeys) throw new Error('Review animation key budget exceeded');
      let previous = -Infinity;
      for (let i = 0; i < input.getCount(); i++) {
        const t = input.getScalar(i);
        if (!Number.isFinite(t) || t < 0 || t <= previous) throw new Error('Animation times must be finite, nonnegative and strictly increasing');
        previous = t; durationSeconds = Math.max(durationSeconds, t);
      }
    }
    return { index, name: animation.getName(), durationSeconds, channels: animation.listChannels().length, interpolation: [...interpolation], supported: [...interpolation].every(i => i === 'LINEAR' || i === 'STEP') };
  });
  if (!pose) return { clips };
  const animation = doc.getRoot().listAnimations()[pose.clipIndex], clip = clips[pose.clipIndex];
  if (!animation || !clip) throw new Error('Selected animation clip does not exist');
  if (!clip.supported) throw new Error('Selected clip uses unsupported CUBICSPLINE interpolation; use a LINEAR/STEP review clip');
  const time = Math.min(pose.timeSeconds, clip.durationSeconds);
  const targets = new Set<string>();
  for (const channel of animation.listChannels()) {
    const node = channel.getTargetNode(), target = channel.getTargetPath(), sampler = channel.getSampler();
    const input = sampler?.getInput(), output = sampler?.getOutput();
    if (!node || !target || !sampler || !input || !output || !input.getCount()) throw new Error('Malformed animation channel');
    const key = `${doc.getRoot().listNodes().indexOf(node)}:${target}`;
    if (targets.has(key)) throw new Error('Duplicate animation channel target'); targets.add(key);
    let lower = 0;
    while (lower + 1 < input.getCount() && input.getScalar(lower + 1) <= time) lower++;
    const upper = Math.min(lower + 1, input.getCount() - 1);
    const blend = sampler.getInterpolation() === 'STEP' || upper === lower ? 0 : Math.max(0, (time - input.getScalar(lower)) / (input.getScalar(upper) - input.getScalar(lower)));
    const width = target === 'weights' ? node.getMesh()?.listPrimitives()[0]?.listTargets().length ?? 0 : target === 'rotation' ? 4 : 3;
    if (!width || output.getCount() !== input.getCount() * (target === 'weights' ? width : 1)) throw new Error('Animation output count does not match input/target');
    const a = target === 'weights' ? Array.from({ length: width }, (_, k) => output.getScalar(lower * width + k)) : output.getElement(lower, []);
    const b = target === 'weights' ? Array.from({ length: width }, (_, k) => output.getScalar(upper * width + k)) : output.getElement(upper, []);
    if (![...a, ...b].every(Number.isFinite)) throw new Error('Non-finite animation output');
    let value = a.map((v, k) => v * (1 - blend) + b[k]! * blend);
    if (target === 'rotation') {
      const normalize = (q: number[]) => { const n = Math.hypot(...q); if (n < 1e-8) throw new Error('Invalid animation quaternion'); return q.map(v => v / n); };
      const qa = normalize(a), qb = normalize(b); let dot = qa.reduce((s, v, k) => s + v * qb[k]!, 0);
      if (dot < 0) { qb.forEach((v, k) => { qb[k] = -v; }); dot = -dot; }
      if (dot > 0.9995) value = normalize(qa.map((v, k) => v * (1 - blend) + qb[k]! * blend));
      else { const angle = Math.acos(Math.min(1, dot)); value = qa.map((v, k) => (v * Math.sin((1 - blend) * angle) + qb[k]! * Math.sin(blend * angle)) / Math.sin(angle)); }
      node.setRotation(value as [number, number, number, number]);
    } else if (target === 'translation') node.setTranslation(value as [number, number, number]);
    else if (target === 'scale') node.setScale(value as [number, number, number]);
    else if (target === 'weights') node.setWeights(value);
    else throw new Error(`Unsupported animation target ${target}`);
  }
  return { clips, selectedTimeSeconds: time };
}
