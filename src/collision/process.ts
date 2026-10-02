import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { invalidInput, invalidState } from '../util/errors.js';
import { registerOwnedProcessTerminator } from '../util/process-lifecycle.js';

export const coacdEnvironmentSchema = z.object({ schema:z.literal('game_dev.coacd_environment.v1'), python:z.string().regex(/^3\.(9|10|11|12)\./), coacd:z.literal('1.0.14'), numpy:z.literal('2.0.2'), platform:z.enum(['Linux','Darwin','Windows']), architecture:z.enum(['x86_64','aarch64','arm64','AMD64']), isolatedVenv:z.literal(true), coacdCodeSHA256:z.string().regex(/^[a-f0-9]{64}$/), upstreamSourceCommit:z.literal('1401ce2a7ae1ed89c65ab958b48d489350c233c7') }).strict();
export type CoacdEnvironment = z.infer<typeof coacdEnvironmentSchema>;
export interface CoacdProcessRequest { python: string; script: string; args: string[]; cwd: string; timeoutMs: number }
export type CoacdRunner = (request: CoacdProcessRequest) => Promise<{ stdout: string; stderr: string }>;
export const coacdScript = fileURLToPath(new URL('../../scripts/coacd_decompose.py', import.meta.url));
let active = false;

export const runCoacdPython: CoacdRunner = async request => {
  if(active) throw invalidState('A CoACD child is already active in this process; wait for it to finish');
  active=true;
  try {
    const environment: NodeJS.ProcessEnv={ HOME:request.cwd, USERPROFILE:request.cwd, TMP:request.cwd, TEMP:request.cwd, TMPDIR:request.cwd, PATH:path.dirname(request.python), OMP_NUM_THREADS:'1', OMP_THREAD_LIMIT:'1', OMP_DYNAMIC:'FALSE', OPENBLAS_NUM_THREADS:'1', MKL_NUM_THREADS:'1', VECLIB_MAXIMUM_THREADS:'1', NUMEXPR_NUM_THREADS:'1' };
    if(process.env.SystemRoot) environment.SystemRoot=process.env.SystemRoot;
    if(process.env.WINDIR) environment.WINDIR=process.env.WINDIR;
    return await new Promise((resolve,reject)=>{
      const child=spawn(request.python,['-I','-B',request.script,...request.args],{cwd:request.cwd,env:environment,shell:false,windowsHide:true,stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='',timedOut=false,overflow=false;
      const unregister=registerOwnedProcessTerminator(signal=>{child.kill(signal);});
      const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},request.timeoutMs);
      const collect=(kind:'stdout'|'stderr',bytes:Buffer)=>{if(kind==='stdout') stdout+=bytes.toString('utf8'); else stderr+=bytes.toString('utf8'); if(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)>256*1024){overflow=true;stdout=stdout.slice(-8192);stderr=stderr.slice(-8192);child.kill('SIGKILL');}};
      child.stdout.on('data',(bytes:Buffer)=>collect('stdout',bytes)); child.stderr.on('data',(bytes:Buffer)=>collect('stderr',bytes));
      child.once('error',error=>{clearTimeout(timer);unregister();reject(invalidState(`Cannot start configured CoACD Python: ${error.message}`));});
      child.once('close',(code,signal)=>{clearTimeout(timer);unregister();if(timedOut||overflow||code!==0) reject(invalidState('CoACD CPU worker failed; no collision result was accepted',{code,signal,timedOut,logOverflow:overflow,stderrTail:stderr.slice(-8192),intent:'isolated Python + CoACD CPU only'}));else resolve({stdout,stderr});});
    });
  } finally { active=false; }
};
export async function configuredCoacdPython(env:NodeJS.ProcessEnv=process.env):Promise<string> {
  const executable=env.GAME_DEV_COACD_PYTHON?.trim();
  if(!executable||!path.isAbsolute(executable)) throw invalidInput('Set GAME_DEV_COACD_PYTHON to an absolute isolated-venv Python executable; see docs/coacd.md. No automatic installation or PATH discovery is performed.');
  const info=await fs.stat(executable).catch(()=>undefined);if(!info?.isFile()) throw invalidInput('Configured CoACD Python does not exist as a file');
  return executable;
}
export async function diagnoseCoacd(options:{env?:NodeJS.ProcessEnv;runner?:CoacdRunner;cwd?:string}={}) {
  try {
    const python=await configuredCoacdPython(options.env); const cwd=options.cwd??path.dirname(python);
    const result=await (options.runner??runCoacdPython)({python,script:coacdScript,args:['--diagnose'],cwd,timeoutMs:15000});
    const environment=coacdEnvironmentSchema.parse(JSON.parse(result.stdout));
    return {schema:'game_dev.coacd_diagnostics.v1' as const,available:true as const,python,environment,processIntent:'isolated CPU-only Python; no Blender, GPU, provider, or automatic setup'};
  }catch(error){return {schema:'game_dev.coacd_diagnostics.v1' as const,available:false as const,reason:error instanceof Error?error.message:String(error),setup:'docs/coacd.md',automaticInstallation:false};}
}
