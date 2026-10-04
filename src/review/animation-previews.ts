import { previewGlb, type CpuPreviews } from './previews.js';
import { REVIEW_LIMITS, reviewSettingsSchema, type ReviewSettingsInput } from './settings.js';
import { readReviewDocument } from './document.js';
import { applyReviewPose } from './pose.js';
import { type BasisReviewDecodeDeps } from './basis-textures.js';
import { assertTimelineRenderSettings, assertTimelineResources, createReviewTimelineSchedule, REVIEW_TIMELINE_LIMITS, type ReviewTimelineResources, type ReviewTimelineSchedule, type ReviewTimelineSampleResources } from './timeline.js';

export interface ReviewAnimationPlayback {
  schedule: ReviewTimelineSchedule;
  framing: { center: [number, number, number]; extent: number };
  samples: Array<{ timeSeconds: number; images: string[]; clippedViews: number[] }>;
  resources: ReviewTimelineResources;
}
export type ReviewPreviews = CpuPreviews & { animationPlayback?: ReviewAnimationPlayback };

/** Explicit execution prepares bounded still samples once; offline playback never executes a tool. */
export async function previewReviewGlb(bytes: Uint8Array, input: ReviewSettingsInput = {}, basisDeps: BasisReviewDecodeDeps = {}): Promise<ReviewPreviews> {
  const settings = reviewSettingsSchema.parse(input), {timeline,...singleSettings} = settings;
  if(!timeline) return previewGlb(bytes,settings,basisDeps);
  const started=performance.now(), deadline=started+60_000;
  // Validate every selected range before rasterization. This path never invokes a decoder.
  const {doc}=await readReviewDocument(bytes,'appearance');
  const schedule=createReviewTimelineSchedule(applyReviewPose(doc,undefined).clips,timeline);
  const initial=await previewGlb(bytes,{...singleSettings,pose:schedule.samples[0]!.pose});
  const frame=assertTimelineRenderSettings({resolution:settings.resolution,framing:initial.framing});
  // Geometry and decoded texture work cannot grow with the selected pose; bound repeated work before the loop.
  for(const key of ['triangles','vertexInstances','decodedTexturePixels','uvMetricsTriangles'] as const) {
    if(initial.envelope[key]*schedule.frameCount>REVIEW_TIMELINE_LIMITS[key]) throw new Error(`Timeline ${key} budget exceeded; use fewer frames or a smaller review LOD`);
  }
  const samples:ReviewAnimationPlayback['samples']=[], costs:ReviewTimelineSampleResources[]=[];
  let cumulativeImages=0,cumulativeRaster=0;
  for(const sample of schedule.samples) {
    if(performance.now()>deadline) throw new Error('Sampled animation review exceeded its 60 second CPU deadline');
    const remainingRaster=REVIEW_TIMELINE_LIMITS.rasterSampleChecks-cumulativeRaster;
    const preview=sample.frameIndex===0?initial:await previewGlb(bytes,{...singleSettings,...frame,pose:sample.pose},{},{rasterSamples:Math.min(REVIEW_LIMITS.rasterSamples,remainingRaster)});
    const imageBytes=preview.appearance.reduce((sum,image)=>sum+Buffer.byteLength(image),0);
    cumulativeImages+=imageBytes; cumulativeRaster+=preview.envelope.rasterSampleChecks;
    if(cumulativeImages>REVIEW_TIMELINE_LIMITS.imageBytes || cumulativeRaster>REVIEW_TIMELINE_LIMITS.rasterSampleChecks) throw new Error('Sampled animation review exceeds cumulative image/raster budget; use fewer frames or a smaller review LOD');
    samples.push({timeSeconds:sample.timeSeconds,images:preview.appearance,clippedViews:preview.framing.clippedViews});
    costs.push({...preview.envelope,imageBytes});
  }
  if(performance.now()>deadline) throw new Error('Sampled animation review exceeded its 60 second CPU deadline');
  const resources=assertTimelineResources(costs);
  return {...initial,envelope:{...initial.envelope,durationMs:Math.round(performance.now()-started)},animationPlayback:{schedule,framing:frame.framing,samples,resources},warnings:[...initial.warnings,'Offline animation playback uses precomputed still samples at the exact recorded timestamps; it is not real-time target-engine animation. Scrubbing selects sealed evidence and starts no process.']};
}
