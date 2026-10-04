import { access, constants } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { GameDevRuntime } from '../runtime.js';
import { packagedScript } from '../util/blender.js';
import { inspectBlenderSelection, inspectToolSelection, toolSelectionMessages, type OptionalTool, type ToolSelectionInspection } from '../installation/tool-config.js';
import { defaultCodexSkillsRoot, listSkillBundle } from '../skills/bundle.js';
import { GAME_DEV_VERSION } from '../version.js';

export const doctorWorkflowSchema = z.enum(['generic-capture', 'asset-inspect', 'asset-package', 'blender-normalize', 'texture-compression', 'collision-decomposition', 'metal-capture', 'all']);
export type DoctorWorkflow = z.infer<typeof doctorWorkflowSchema>;
export interface DoctorOptions { workflow?: DoctorWorkflow; expectedVersion?: string; env?: NodeJS.ProcessEnv }
export const doctorCheckIdSchema = z.enum(['platform', 'node-runtime', 'workspace', 'tripo-credential', 'leonardo-credential', 'blender', 'blender-normalizer', 'blender-usd-exporter', 'basisu', 'coacd-python', 'usdzip', 'sqlite-catalog-runtime', 'codex-skills', 'helper-version', 'metal-evidence', 'generic-sample']);
export interface DoctorCheck {
  id: z.infer<typeof doctorCheckIdSchema>;
  status: 'pass' | 'warning' | 'fail' | 'unavailable';
  required: boolean;
  detail: string;
  nextStep?: string;
  evidence?: Record<string, unknown>;
}
export interface DoctorReport extends Record<string, unknown> {
  schema: 'game_dev.doctor.v1'; version: string; workflow: DoctorWorkflow; healthy: boolean;
  checks: DoctorCheck[]; processLaunched: false; evidenceCeiling: string;
}

async function exists(target: string): Promise<boolean> {
  try { await access(target); return true; } catch { return false; }
}

/** Workflow-scoped file/configuration diagnosis. No external process, provider, or network call. */
export async function runDoctor(runtime: Pick<GameDevRuntime, 'config'>, options: DoctorOptions = {}): Promise<DoctorReport> {
  const env = options.env ?? process.env;
  const workflow = doctorWorkflowSchema.parse(options.workflow ?? 'generic-capture');
  if (options.expectedVersion !== undefined) z.string().regex(/^\d+\.\d+\.\d+$/).parse(options.expectedVersion);
  const needed = (...workflows: DoctorWorkflow[]) => workflow === 'all' || workflows.includes(workflow);
  const checks: DoctorCheck[] = [];
  checks.push({ id: 'platform', required: true, status: ['darwin', 'linux', 'win32'].includes(process.platform) ? 'pass' : 'fail', detail: `${process.platform} ${process.arch}` });
  const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
  checks.push({ id: 'node-runtime', required: true, status: major > 22 || (major === 22 && minor >= 5) ? 'pass' : 'fail', detail: process.version,
    nextStep: 'Use Node.js 22.5 or newer, then rerun doctor.', evidence: { executable: process.execPath, minimum: '22.5.0 (node:sqlite catalog)' } });
  let workspaceWritable = false;
  try { await access(runtime.config.outputDir, constants.W_OK); workspaceWritable = true; } catch { /* read-only diagnosis */ }
  checks.push({ id: 'workspace', required: true, status: workspaceWritable ? 'pass' : 'fail', detail: runtime.config.outputDir,
    nextStep: 'Select an absolute writable asset workspace.', evidence: { jobsDir: runtime.config.jobsDir, durableJobsDir: runtime.config.durableJobsDir, packagesDir: runtime.config.packagesDir, catalogPath: runtime.config.catalogPath, runsDir: runtime.config.runsDir } });
  checks.push({ id: 'tripo-credential', required: false, status: runtime.config.tripoApiKey ? 'pass' : 'unavailable', detail: runtime.config.tripoApiKey ? 'configured; value redacted' : 'not configured; optional for local workflows' });
  checks.push({ id: 'leonardo-credential', required: false, status: runtime.config.leonardoApiKey ? 'pass' : 'unavailable', detail: runtime.config.leonardoApiKey ? 'configured; value redacted' : 'not configured; optional for local workflows' });

  const toolCheck = (tool: OptionalTool, required: boolean, inspected: ToolSelectionInspection) => {
    checks.push({ id: tool, required, status: inspected.available ? 'pass' : required ? 'fail' : 'unavailable', detail: toolSelectionMessages[inspected.code],
      nextStep: `Review the executable, then use game-dev tool configure ${tool} --executable ABSOLUTE_PATH --confirm; see docs/tool-setup.md.`,
      evidence: { source: inspected.source, code: inspected.code, digestPinned: inspected.digestPinned ?? false, processLaunched: false, versionChecked: false,
        ...(inspected.identity ? { executable: inspected.identity.executablePath, resolvedExecutable: inspected.identity.resolvedPath, sha256: inspected.identity.sha256 } : {}) } });
  };
  toolCheck('blender', needed('blender-normalize'), inspectBlenderSelection(env));
  toolCheck('basisu', needed('texture-compression'), inspectToolSelection('basisu', env));
  toolCheck('coacd-python', needed('collision-decomposition'), inspectToolSelection('coacd-python', env));
  for (const [id, script] of [['blender-normalizer', 'blender_normalize.py'], ['blender-usd-exporter', 'blender_usd_export.py']] as const) {
    let scriptPath: string | undefined;
    try { scriptPath = packagedScript(script); } catch { /* incomplete package */ }
    checks.push({ id, required: needed('blender-normalize'), status: scriptPath && await exists(scriptPath) ? 'pass' : 'fail', detail: scriptPath ?? 'packaged script is missing', nextStep: 'Reinstall from a checksum-verified release artifact; keep the current workspace.' });
  }
  const usdzip = await exists('/usr/bin/usdzip');
  checks.push({ id: 'usdzip', required: false, status: usdzip ? 'pass' : 'unavailable', detail: usdzip ? '/usr/bin/usdzip' : 'optional USDZ archiver not present on this platform' });
  try { await import('node:sqlite'); checks.push({ id: 'sqlite-catalog-runtime', required: true, status: 'pass', detail: 'node:sqlite is available' }); }
  catch { checks.push({ id: 'sqlite-catalog-runtime', required: true, status: 'fail', detail: 'node:sqlite is unavailable', nextStep: 'Use Node.js 22.5 or newer.' }); }

  try {
    const bundle = await listSkillBundle(), skillRoot = defaultCodexSkillsRoot();
    const skillStates = await Promise.all(bundle.skills.map(async skill => ({ name: skill.id, installed: await exists(path.join(skillRoot, skill.id, 'SKILL.md')) })));
    checks.push({ id: 'codex-skills', required: false, status: skillStates.every(skill => skill.installed) ? 'pass' : 'warning', detail: skillRoot, evidence: { skills: skillStates }, nextStep: 'Optional: install the packaged skill bundle using game-dev skill install all --confirm.' });
  } catch { checks.push({ id: 'codex-skills', required: false, status: 'fail', detail: 'Packaged skill bundle is unavailable', nextStep: 'Reinstall from a checksum-verified release artifact if packaged skills are needed.' }); }
  const invoked = process.argv[1] ? path.resolve(process.argv[1]) : fileURLToPath(import.meta.url);
  const unexpectedVersion = options.expectedVersion !== undefined && options.expectedVersion !== GAME_DEV_VERSION;
  const appMismatch = Boolean(env.GAME_DEV_APP_VERSION && env.GAME_DEV_APP_VERSION !== GAME_DEV_VERSION);
  checks.push({ id: 'helper-version', required: true, status: unexpectedVersion ? 'fail' : appMismatch ? 'warning' : 'pass', detail: GAME_DEV_VERSION,
    evidence: { executable: invoked, appVersion: env.GAME_DEV_APP_VERSION ?? 'not supplied', expectedVersion: options.expectedVersion ?? 'not supplied' },
    nextStep: 'Inspect the resolved game-dev executable on PATH and use the intended checksum-verified release.' });
  checks.push({ id: 'metal-evidence', required: needed('metal-capture'), status: process.platform === 'darwin' ? 'warning' : needed('metal-capture') ? 'fail' : 'unavailable',
    detail: process.platform === 'darwin' ? 'macOS can support Metal; no GPU, adapter, or capture was tested by doctor' : 'Metal capture requires macOS', nextStep: 'Review the separate Metal capture workflow and its launch approval before running it.' });
  const samplePath = fileURLToPath(new URL('../../adapters/generic-sample/capture.mjs', import.meta.url));
  checks.push({ id: 'generic-sample', required: needed('generic-capture'), status: await exists(samplePath) ? 'pass' : 'fail', detail: samplePath,
    nextStep: 'Follow docs/quickstart.md to capture, verify, and compare the packaged generic sample without a compiler or provider credentials.' });
  return { schema: 'game_dev.doctor.v1', version: GAME_DEV_VERSION, workflow, healthy: !checks.some(check => check.required && (check.status === 'fail' || check.status === 'unavailable')), checks, processLaunched: false,
    evidenceCeiling: 'Doctor proves local configuration and bounded executable-byte discovery only. It does not prove tool versions, provider authentication, paid generation, Blender/CoACD/Basis output, GPU capture, pixels, signing, notarization, or human review.' };
}
