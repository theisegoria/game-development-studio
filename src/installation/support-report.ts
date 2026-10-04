import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { GameDevRuntime } from '../runtime.js';
import { doctorCheckIdSchema, doctorWorkflowSchema, runDoctor, type DoctorOptions, type DoctorReport } from '../cli/doctor.js';
import { invalidInput } from '../util/errors.js';

const outcomeSchema = z.enum(['pass', 'warning', 'fail', 'unavailable']);
const toolCodeSchema = z.enum(['verified', 'not-configured', 'invalid-configuration', 'invalid-path', 'missing', 'not-executable', 'too-large', 'moved', 'changed', 'digest-required', 'invalid-digest']);
export const supportReportSchema = z.object({
  schema: z.literal('game_dev.support_report.v1'),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  workflow: doctorWorkflowSchema,
  healthy: z.boolean(),
  platform: z.enum(['darwin', 'linux', 'win32', 'aix', 'freebsd', 'openbsd', 'sunos', 'android']),
  architecture: z.enum(['arm', 'arm64', 'ia32', 'mips', 'mipsel', 'ppc', 'ppc64', 'riscv64', 's390', 's390x', 'x64', 'loong64']),
  nodeVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  checks: z.array(z.object({ id: doctorCheckIdSchema, status: outcomeSchema, required: z.boolean(), toolCode: toolCodeSchema.optional(), digestPinned: z.boolean().optional() }).strict()).max(32),
  redaction: z.object({ policy: z.literal('allowlist-v1'), pathsIncluded: z.literal(false), environmentValuesIncluded: z.literal(false), errorTextIncluded: z.literal(false), assetDataIncluded: z.literal(false), URLsIncluded: z.literal(false) }).strict(),
  sharing: z.object({ transmitted: z.literal(false), userReviewRequired: z.literal(true) }).strict(),
  processLaunched: z.literal(false),
}).strict();
export type SupportReport = z.infer<typeof supportReportSchema>;

/** Construct a fresh allowlist projection. Never sanitize or forward arbitrary detail/evidence strings. */
export function redactDoctorReport(report: DoctorReport): SupportReport {
  return supportReportSchema.parse({
    schema: 'game_dev.support_report.v1', version: report.version, workflow: report.workflow, healthy: report.healthy,
    platform: process.platform, architecture: process.arch, nodeVersion: process.versions.node,
    checks: report.checks.map(check => ({
      id: check.id, status: check.status, required: check.required,
      ...(toolCodeSchema.safeParse(check.evidence?.code).success ? { toolCode: check.evidence?.code } : {}),
      ...(typeof check.evidence?.digestPinned === 'boolean' ? { digestPinned: check.evidence.digestPinned } : {}),
    })),
    redaction: { policy: 'allowlist-v1', pathsIncluded: false, environmentValuesIncluded: false, errorTextIncluded: false, assetDataIncluded: false, URLsIncluded: false },
    sharing: { transmitted: false, userReviewRequired: true }, processLaunched: false,
  });
}

export async function buildSupportReport(runtime: Pick<GameDevRuntime, 'config'>, options: DoctorOptions = {}): Promise<SupportReport> {
  return redactDoctorReport(await runDoctor(runtime, options));
}

/** Explicit local new-file write only; refuses overwrite, including symlinks. No sharing occurs. */
export async function writeSupportReport(runtime: Pick<GameDevRuntime, 'config'>, options: DoctorOptions & { outputPath: string }) {
  if (!path.isAbsolute(options.outputPath)) throw invalidInput('Support report output must be an absolute path to a new file.');
  const report = await buildSupportReport(runtime, options);
  const handle = await fs.open(options.outputPath, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(report, null, 2) + '\n', 'utf8'); await handle.sync(); } finally { await handle.close(); }
  return { schema: 'game_dev.support_report_write.v1' as const, outputPath: options.outputPath, report, transmitted: false as const, userReviewRequired: true as const };
}
