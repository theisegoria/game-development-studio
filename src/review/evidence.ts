import { promises as fs } from 'node:fs';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { canonicalJson } from '../packages/format.js';
import { captureManifestSchema,runManifestSchema,type RunArtifact } from '../harness/contracts.js';
import { validateCaptureManifest } from '../harness/capture.js';
import { verifyRunBundle } from '../harness/run-bundle.js';
import { REVIEW_RENDERER,type ReviewSettings } from './settings.js';
import type { CpuPreviews } from './previews.js';

const hash=(value:Uint8Array|string)=>createHash('sha256').update(value).digest('hex');
/** Admit CPU-generated pixels to the existing sealed capture comparator, with truthful process evidence. */
export async function writeReviewCapture(directory:string,previews:CpuPreviews,settings:ReviewSettings,sourceSha256:string,previewSha256:string){
  if(!previews.appearance.length)throw new Error('Sealed review captures require appearance previews');
  const runId=`review-${randomUUID()}`,runPath=path.join(directory,runId),adapterId='gds-cpu-review';
  const scenarioId=`appearance-${hash(canonicalJson({settings,renderer:REVIEW_RENDERER,framing:{policy:previews.framing.policy,center:previews.framing.center,extent:previews.framing.extent}})).slice(0,32)}`;
  await fs.mkdir(runPath,{recursive:true,mode:0o700});
  const artifacts:RunArtifact[]=[];
  async function write(file:string,bytes:Uint8Array|string,kind:RunArtifact['kind']){await fs.writeFile(path.join(runPath,file),bytes,{flag:'wx',mode:0o600});artifacts.push({path:file,kind,bytes:Buffer.byteLength(bytes),sha256:hash(bytes)});}
  const adapter=canonicalJson({schema:'game_dev.cpu_review_renderer.v1',renderer:REVIEW_RENDERER,execution:'in-process CPU; no capture executable or subprocess'});
  await write('renderer.json',adapter,'adapter');
  await write('source-binding.json',canonicalJson({schema:'game_dev.cpu_review_source.v1',sourceSha256,previewSha256,settings,renderer:REVIEW_RENDERER,framing:previews.framing}),'receipt');
  const frames=[];
  for(const [index,image] of previews.appearance.entries()){
    const file=`angle-${index}.png`;await write(file,Buffer.from(image.split(',')[1]!,'base64'),'capture_color');
    frames.push({index,label:`angle-${index}`,attachments:[{kind:'color' as const,path:file,encoding:'png' as const,description:'CPU orthographic metallic/roughness appearance under fixed neutral studio lighting; no GPU or target engine'}]});
  }
  const capture=captureManifestSchema.parse({schema:'game_dev.capture.v1',runId,adapterId,scenarioId,sourceFormat:'game-dev-capture-v1',frames,adapterEvidence:{rendererClass:'software',windowless:true,gpuExecutionReported:false,gpuCompletionIdentityReported:false,hardwarePerformanceReported:false,pixelVisualInspectionPerformed:false,notes:['Generated in-process by the bounded CPU asset review renderer. No capture executable, GPU, Blender or engine was launched.','Pixel comparisons are review evidence, not target-engine correctness or artistic approval.']}});
  await write('capture.json',canonicalJson(capture),'capture_manifest');
  const validation=await validateCaptureManifest(runPath,'capture.json',{runId,adapterId,scenarioId}),completedAt=new Date().toISOString();
  const manifest=runManifestSchema.parse({schema:'game_dev.run.v1',runId,adapterId,adapterVersion:REVIEW_RENDERER.version,adapterManifestSha256:hash(adapter),scenarioId,projectRoot:directory,startedAt:new Date(Date.now()-previews.envelope.durationMs).toISOString(),completedAt,durationMs:previews.envelope.durationMs,status:'completed',process:{executable:'in-process:gds-cpu-review',arguments:[],workingDirectory:runPath,exitCode:null,signal:null,stdoutTruncated:false,stderrTruncated:false},captureManifest:'capture.json',artifacts,evidence:{commandExecuted:false,processExitedSuccessfully:false,artifactRosterClosedAndHashed:true,captureContractValidated:true,rasterBytesDecoded:validation.rasterBytesDecoded,rendererClass:'software',softwareRasterizedLane:true,refusedAdapterClaims:[],adapterReportedGpuExecution:false,adapterReportedGpuCompletionIdentity:false,adapterReportedHardwarePerformance:false,hardwareGpuExecutionProvenByHarnessAlone:false,hardwarePerformanceEvidenceAdmitted:false,hardwarePerformanceMeasuredByHarnessAlone:false,humanVisualReviewPerformed:false,evidenceCeiling:'Sealed in-process CPU appearance pixels and source/settings binding. No command or subprocess ran; no GPU, engine, artistic approval or hardware performance evidence.'}});
  await fs.writeFile(path.join(runPath,'run.json'),canonicalJson(manifest),{flag:'wx',mode:0o600});
  const verified=await verifyRunBundle(runPath);
  return {previewRunPath:verified.runPath,previewRunManifestSha256:verified.manifestSha256};
}
