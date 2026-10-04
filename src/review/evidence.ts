import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { canonicalJson } from '../packages/format.js';
import { captureManifestSchema,runManifestSchema,type RunArtifact } from '../harness/contracts.js';
import { validateCaptureManifest } from '../harness/capture.js';
import { verifyRunBundle } from '../harness/run-bundle.js';
import { REVIEW_RENDERER,type ReviewSettings } from './settings.js';
import type { ReviewPreviews } from './animation-previews.js';

const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
/** Admit CPU-generated pixels to the existing sealed capture comparator, with truthful process evidence. */
export async function writeReviewCapture(directory:string,previews:ReviewPreviews,settings:ReviewSettings,sourceSha256:string,previewSha256:string){
  if(!previews.appearance.length)throw new Error('Sealed review captures require appearance previews');
  const runId=`review-${randomUUID()}`,runPath=path.join(directory,runId),adapterId='gds-cpu-review';
  const decoderProcesses=previews.basisDecode?.processCount??0;
  const decodeExecution=decoderProcesses?`${decoderProcesses} pinned Basis CPU decoder subprocesses ran; their executable, KTX2 and decoded pixel hashes are recorded in source-binding.json.`:'No Basis decoder subprocess ran.';
  // Profile identity belongs to the scenario; per-source texture hashes belong to the receipt so before/after assets remain comparable.
  const scenarioId=`appearance-${hash(canonicalJson({settings,renderer:REVIEW_RENDERER,framing:{policy:previews.framing.policy,center:previews.framing.center,extent:previews.framing.extent},...(previews.basisDecode?{decoder:previews.basisDecode.decoder}:{})})).slice(0,32)}`;
  await fs.mkdir(runPath,{recursive:true,mode:0o700});
  const artifacts:RunArtifact[]=[];
  async function write(file:string,bytes:Uint8Array|string,kind:RunArtifact['kind']){await fs.writeFile(path.join(runPath,file),bytes,{flag:'wx',mode:0o600});artifacts.push({path:file,kind,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)});}
  const adapter=canonicalJson({schema:'game_dev.cpu_review_renderer.v1',renderer:REVIEW_RENDERER,execution:'in-process CPU rasterizer; no engine capture executable',textureDecode:previews.basisDecode?.decoder??null});
  await write('renderer.json',adapter,'adapter');
  const playback=previews.animationPlayback;
  await write('source-binding.json',canonicalJson({schema:'game_dev.cpu_review_source.v1',sourceSha256,previewSha256,settings,renderer:REVIEW_RENDERER,framing:previews.framing,...(previews.basisDecode?{basisDecode:previews.basisDecode}:{}),...(playback?{animationPlayback:{schedule:playback.schedule,framing:playback.framing,resources:playback.resources,clippedViews:playback.samples.map(sample=>sample.clippedViews)}}:{})}),'receipt');
  const frames=[];
  const images=playback?playback.samples.flatMap((sample,sampleIndex)=>sample.images.map((image,angle)=>({image,label:`sample-${sampleIndex}-angle-${angle}`}))):previews.appearance.map((image,angle)=>({image,label:`angle-${angle}`}));
  for(const [index,{image,label}] of images.entries()){
    const file=`${label}.png`;await write(file,Buffer.from(image.split(',')[1]!,'base64'),'capture_color');
    frames.push({index,label,attachments:[{kind:'color' as const,path:file,encoding:'png' as const,description:'CPU orthographic metallic/roughness appearance under fixed neutral studio lighting; no GPU or target engine'}]});
  }
  const capture=captureManifestSchema.parse({schema:'game_dev.capture.v1',runId,adapterId,scenarioId,sourceFormat:'game-dev-capture-v1',frames,adapterEvidence:{rendererClass:'software',windowless:true,gpuExecutionReported:false,gpuCompletionIdentityReported:false,hardwarePerformanceReported:false,pixelVisualInspectionPerformed:false,notes:['Pixels rasterized in-process by the bounded CPU asset review renderer. No engine capture executable, GPU or Blender was launched.',decodeExecution,'Run process fields describe the in-process rasterizer; auxiliary texture decoder execution is separately recorded in the sealed source receipt.','Pixel comparisons are review evidence, not target-engine correctness or artistic approval.']}});
  await write('capture.json',canonicalJson(capture),'capture_manifest');
  const validation=await validateCaptureManifest(runPath,'capture.json',{runId,adapterId,scenarioId}),completedAt=new Date().toISOString();
  const manifest=runManifestSchema.parse({schema:'game_dev.run.v1',runId,adapterId,adapterVersion:REVIEW_RENDERER.version,adapterManifestSha256:hash(adapter),scenarioId,projectRoot:directory,startedAt:new Date(Date.now()-previews.envelope.durationMs).toISOString(),completedAt,durationMs:previews.envelope.durationMs,status:'completed',process:{executable:'in-process:gds-cpu-review',arguments:[],workingDirectory:runPath,exitCode:null,signal:null,stdoutTruncated:false,stderrTruncated:false},captureManifest:'capture.json',artifacts,evidence:{commandExecuted:false,processExitedSuccessfully:false,artifactRosterClosedAndHashed:true,captureContractValidated:true,rasterBytesDecoded:validation.rasterBytesDecoded,rendererClass:'software',softwareRasterizedLane:true,refusedAdapterClaims:[],adapterReportedGpuExecution:false,adapterReportedGpuCompletionIdentity:false,adapterReportedHardwarePerformance:false,hardwareGpuExecutionProvenByHarnessAlone:false,hardwarePerformanceEvidenceAdmitted:false,hardwarePerformanceMeasuredByHarnessAlone:false,humanVisualReviewPerformed:false,evidenceCeiling:`Sealed in-process CPU appearance pixels and source/settings binding. ${decodeExecution} No engine capture command, GPU, artistic approval or hardware performance evidence.`}});
  await fs.writeFile(path.join(runPath,'run.json'),canonicalJson(manifest),{flag:'wx',mode:0o600});
  const verified=await verifyRunBundle(runPath);
  return {previewRunPath:verified.runPath,previewRunManifestSha256:verified.manifestSha256};
}
