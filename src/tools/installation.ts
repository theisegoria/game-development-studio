import { z } from 'zod';
import type { ToolRegistrar } from '../commands/registry.js';
import { optionalToolSchema, configureTool, clearTool, listToolSelections } from '../installation/tool-config.js';
import { doctorWorkflowSchema } from '../cli/doctor.js';
import { buildSupportReport, writeSupportReport } from '../installation/support-report.js';
import { guard, ok, type ToolContext } from './context.js';

/** Explicit per-user executable selections shared by Finder, CLI, and MCP. */
export function registerInstallationTools(registry: ToolRegistrar, ctx: ToolContext): void {
  const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
  const mutation = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };
  registry.registerTool('list_optional_tools', {
    title: 'Inspect saved optional tool selections',
    description: 'FREE file and executable SHA-256 inspection only. Reports explicit environment overrides and missing, moved, changed, or invalid saved selections. Starts no process.',
    inputSchema: {}, annotations: readOnly,
  }, guard(ctx.logger, 'list_optional_tools', async () => ok(listToolSelections())));
  registry.registerTool('configure_optional_tool', {
    title: 'Save an explicitly selected optional executable',
    description: 'Save a per-user absolute Blender, Basis, or CoACD Python path and SHA-256 identity. Requires fresh mutation approval; validates bounded executable bytes without launching or installing software.',
    inputSchema: { tool: optionalToolSchema, executablePath: z.string().min(1), expectedSHA256: z.string().regex(/^[a-f0-9]{64}$/).optional() }, annotations: mutation,
  }, guard(ctx.logger, 'configure_optional_tool', async args => ok(await configureTool(args))));
  registry.registerTool('clear_optional_tool', {
    title: 'Clear one saved optional tool selection',
    description: 'Remove only the selected per-user configuration entry. Keeps executables and user assets; environment overrides remain explicit. Requires fresh mutation approval.',
    inputSchema: { tool: optionalToolSchema }, annotations: mutation,
  }, guard(ctx.logger, 'clear_optional_tool', async args => ok(await clearTool(args.tool))));
  const reportInput = { workflow: doctorWorkflowSchema.optional(), expectedVersion: z.string().min(1).optional() };
  registry.registerTool('preview_support_report', {
    title: 'Preview a redacted local support report',
    description: 'FREE allowlist projection of workflow diagnostics. Excludes private paths, URLs, secrets, assets and raw error text. Starts no process and sends nothing; the user reviews before sharing.',
    inputSchema: reportInput, annotations: readOnly,
  }, guard(ctx.logger, 'preview_support_report', async args => ok(await buildSupportReport({ config: ctx.config }, args))));
  registry.registerTool('write_support_report', {
    title: 'Write a new local redacted support report',
    description: 'Write only a new absolute report file after fresh mutation approval. Refuses overwrites; transmits nothing and requires user review before sharing.',
    inputSchema: { ...reportInput, outputPath: z.string().min(1) }, annotations: mutation,
  }, guard(ctx.logger, 'write_support_report', async args => ok(await writeSupportReport({ config: ctx.config }, args))));
}
