/**
 * Spend visibility.
 *
 * An agent that cannot see what it has spent will keep spending. This reports
 * the running total, the remaining headroom, and — importantly — whether the
 * figures rest on published prices or on pessimistic placeholders, so nobody
 * mistakes an estimate for a bill.
 */

import { z } from 'zod';
import { DurableJobStore } from '../jobs/durable.js';
import type { ToolRegistrar } from '../commands/registry.js';
import { spendingToolNames } from '../domain/spend.js';
import { formatCents } from '../storage/spend.js';
import { guard, ok, type ToolContext } from './context.js';

export function registerSpendTools(server: ToolRegistrar, ctx: ToolContext): void {
  server.registerTool(
    'get_spend_report',
    {
      title: 'Report what this session has spent',
      description:
        'FREE and fully local: no network call, no credits. Reports the estimated provider spend ' +
        'for this workspace, broken down by tool, plus the remaining headroom under ' +
        'ASSET_SPEND_LIMIT_CENTS if one is set. Figures are normalised to US cents because ' +
        'providers bill in different units. Costs marked "estimated" are pessimistic placeholders ' +
        'for providers that do not publish a per-call rate — treat them as a guard, not an invoice.',
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guard(ctx.logger, 'get_spend_report', async () => {
      const health = ctx.spend.diagnostics();
      if (!health.healthy) return ok({ schema: 'org.gamedebug.spend_report.v1', health, paidOperationsBlocked: true, spent: null, remaining: null, note: 'The balance is unknown; damaged accounting is never treated as zero.' });
      const summary = ctx.spend.summary();
      return ok({
        schema: 'org.gamedebug.spend_report.v1',
        health,
        limit: summary.limitCents === undefined ? 'none' : formatCents(summary.limitCents),
        spent: formatCents(summary.spentCents),
        remaining:
          summary.remainingCents === undefined ? 'unlimited' : formatCents(summary.remainingCents),
        callCount: summary.callCount,
        byTool: summary.byTool.map((row) => ({
          tool: row.tool,
          calls: row.calls,
          estimated: formatCents(row.estimatedCents),
          ...(row.reportedCents !== undefined
            ? { providerReported: formatCents(row.reportedCents) }
            : {}),
        })),
        containsEstimates: summary.containsEstimates,
        spendingTools: spendingToolNames(),
        note: summary.containsEstimates
          ? 'Some entries use pessimistic placeholders because the provider does not publish a ' +
            'per-call rate. Provider invoice costs remain unknown unless actually reported; estimates are not a guarantee.'
          : 'Every entry used a published provider price.',
        ...(summary.limitCents === undefined
          ? {
              warning:
                'No ceiling is set. Set ASSET_SPEND_LIMIT_CENTS to make this harness refuse rather ' +
                'than overspend — a batch loop is where that matters most.',
            }
          : {}),
      });
    }),
  );
  server.registerTool('get_provider_history', {
    title: 'Provider cost and quality history',
    description: 'FREE local reservation history, invocation approval provenance, outcomes, user ratings and provider-reported charges. Missing charges and outcomes remain unknown.',
    inputSchema: {}, annotations: { readOnlyHint: true, openWorldHint: false },
  }, guard(ctx.logger, 'get_provider_history', async () => {
    const health = ctx.spend.diagnostics();
    if (!health.healthy) return ok({ health, history: null });
    const history = ctx.spend.history();
    const jobs = await ctx.store.list();
    // Read-only observations supplement explicit outcome records without inventing invoice data.
    const jobOutcomes = jobs.map((job) => ({ assetJobId: job.id, status: job.status, providerReportedCredits: job.model3d?.creditCost ?? job.audio?.creditCost ?? null, reportedUSDCents: null, outcome: job.status === 'failed' ? 'failed' : ['ready', 'reference_ready'].includes(job.status) ? 'succeeded' : 'unknown' }));
    return ok({ ...history, jobOutcomes, corruptAssetJobs: ctx.store.lastListingSkipped(), note: 'Failure rates use explicitly recorded outcomes; job outcomes are observations and may represent a later pipeline stage. Ratings are user judgments, not objective quality.' });
  }));
  server.registerTool('rate_provider_result', {
    title: 'Record a provider result quality rating', description: 'Record a local user rating from zero to five, with a review note. Does not call a provider or authorize new spend.',
    inputSchema: { entryId: z.string().min(1), rating: z.number().min(0).max(5), note: z.string().max(2000) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, guard(ctx.logger, 'rate_provider_result', async ({ entryId, rating, note }) => { await ctx.spend.rate(entryId, rating, note); return ok({ entryId, rating, note }); }));
  server.registerTool('record_provider_outcome', {
    title: 'Record a reviewed provider outcome', description: 'Record succeeded, failed, or unknown for a reservation after reviewing its provider task. A failure never releases its charge and does not authorize resubmission.',
    inputSchema: { entryId: z.string().min(1), outcome: z.enum(['succeeded', 'failed', 'unknown']) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, guard(ctx.logger, 'record_provider_outcome', async ({ entryId, outcome }) => { await ctx.spend.recordOutcome(entryId, outcome); return ok({ entryId, outcome }); }));
  server.registerTool('diagnose_durable_jobs', {
    title: 'Inspect corrupt and stale durable jobs', description: 'FREE diagnostic listing including corrupt records and stale workers. Staleness never grants replay authority.',
    inputSchema: { staleAfterMs: z.number().int().nonnegative().optional() }, annotations: { readOnlyHint: true, openWorldHint: false },
  }, guard(ctx.logger, 'diagnose_durable_jobs', async ({ staleAfterMs }) => ok(await (await DurableJobStore.open(ctx.config.durableJobsDir)).diagnostics(staleAfterMs))));
  server.registerTool('recover_durable_job', {
    title: 'Cancel local orchestration during recovery', description: 'Explicitly cancel a stale local job while preserving evidence. Never submits provider work and cannot prove external cancellation. Corrupt records remain blocked for investigation.',
    inputSchema: { jobId: z.string(), confirm: z.boolean() }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, guard(ctx.logger, 'recover_durable_job', async ({ jobId, confirm }) => ok(await (await DurableJobStore.open(ctx.config.durableJobsDir)).recover(jobId, confirm))));
  server.registerTool('quarantine_corrupt_job', {
    title: 'Preserve and seal a corrupt durable job', description: 'With explicit confirmation, preserve the original corrupt job/event bytes and seal its local identity as cancelled. Never reconstructs or replays a paid request; external billing remains unknown.',
    inputSchema: { jobId: z.string(), confirm: z.boolean() }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, guard(ctx.logger, 'quarantine_corrupt_job', async ({ jobId, confirm }) => ok(await (await DurableJobStore.open(ctx.config.durableJobsDir)).quarantineCorrupt(jobId, confirm))));
  server.registerTool('recover_storage_lock', {
    title: 'Recover a dead local worker storage lock', description: 'Explicitly recover a lock only after proving its owner process on this machine no longer exists. Never expires live locks, modifies damaged records, or authorizes provider replay.',
    inputSchema: { kind: z.enum(['spend', 'job']), jobId: z.string().optional(), confirm: z.boolean() }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, guard(ctx.logger, 'recover_storage_lock', async ({ kind, jobId, confirm }) => {
    if (kind === 'spend') await ctx.spend.recoverLock(confirm);
    else await (await DurableJobStore.open(ctx.config.durableJobsDir)).recoverLock(jobId ?? '', confirm);
    return ok({ recovered: true, replayAuthorized: false });
  }));

}
