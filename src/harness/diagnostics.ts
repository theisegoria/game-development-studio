/**
 * Validation errors as findings, not log lines.
 *
 * A validation layer, a GL debug callback or an engine assertion often says
 * exactly what is wrong -- and says it in a stream of thousands of lines, with
 * a different handle in every one, so the single new error a change
 * introduced is invisible. For an AI writing an engine, that one line is
 * frequently worth more than the pixels.
 *
 * This groups a run's diagnostic events by source, severity and message
 * identity, with handles, addresses and numbers normalised away; places each
 * group in the frames it occurred in; and, given a baseline run, says which
 * groups are new and which went away.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { invalidInput } from '../util/errors.js';
import { telemetryEventSchema, type DiagnosticSeverity } from './contracts.js';
import { loadCapture } from './visual.js';

export const GAME_DEV_RUN_DIAGNOSTICS_SCHEMA = 'game_dev.run_diagnostics.v1' as const;

const MAX_TELEMETRY_BYTES = 64 * 1024 * 1024;
const MAX_GROUPS = 256;
const MAX_FRAMES_PER_GROUP = 32;
const SEVERITY_RANK: Record<DiagnosticSeverity, number> = { error: 0, warning: 1, info: 2 };

export interface DiagnosticGroup {
  /** Stable across runs: source, severity and the message's identity. */
  key: string;
  source: string;
  severity: DiagnosticSeverity;
  messageId?: string;
  /** The message with handles and numbers replaced, so identical errors group. */
  pattern: string;
  /** One verbatim occurrence, so the caller sees a real message. */
  example: string;
  count: number;
  frames: number[];
  framesTruncated: boolean;
  /** Occurrences that named no frame, typically setup or teardown. */
  outsideFrames: number;
}

export interface RunDiagnostics {
  schema: typeof GAME_DEV_RUN_DIAGNOSTICS_SCHEMA;
  runId: string;
  adapterId: string;
  scenarioId: string;
  totals: Record<DiagnosticSeverity, number>;
  groups: DiagnosticGroup[];
  groupsTruncated: boolean;
  baseline?: {
    runId: string;
    /** Groups present here and absent from the baseline, worst first. */
    introduced: DiagnosticGroup[];
    /** Groups the baseline had that this run does not. */
    resolved: DiagnosticGroup[];
  };
  verdict: 'clean' | 'warnings' | 'errors';
  summary: string[];
  evidence: {
    sealedRunVerified: true;
    reporterCompletenessKnown: false;
    humanReviewPerformed: false;
  };
  evidenceCeiling: string;
}

/**
 * Replace what varies between occurrences of the same problem: object handles,
 * addresses, quoted names that look generated, and numbers. Conservative on
 * purpose -- two genuinely different messages must not collapse into one.
 */
export function normalizeDiagnosticMessage(message: string): string {
  return message
    .replace(/0x[0-9a-fA-F]+/g, '0x#')
    .replace(/\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\b/g, '<uuid>')
    .replace(/(?<![A-Za-z_])\d+(\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 512);
}

async function readGroups(runPath: string): Promise<{
  runId: string; adapterId: string; scenarioId: string; groups: Map<string, DiagnosticGroup>; truncated: boolean;
}> {
  const capture = await loadCapture(runPath);
  const groups = new Map<string, DiagnosticGroup>();
  let truncated = false;
  for (const relative of capture.manifest.telemetry) {
    const filePath = path.resolve(capture.runPath, relative);
    const bytes = await fs.readFile(filePath);
    if (bytes.length > MAX_TELEMETRY_BYTES) throw invalidInput('telemetry artifact exceeds the byte ceiling', { filePath });
    for (const line of bytes.toString('utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      let value: unknown;
      try { value = JSON.parse(line); } catch { continue; }
      // Foreign lines are the performance reader's business; this reads only
      // the standard diagnostic shape, already validated by the schema.
      const parsed = telemetryEventSchema.safeParse(value);
      if (!parsed.success || parsed.data.category !== 'diagnostic') continue;
      const attributes = parsed.data.attributes;
      if (typeof attributes.message !== 'string' || typeof attributes.severity !== 'string') continue;
      const source = typeof attributes.source === 'string' && attributes.source.length > 0 ? attributes.source : 'unspecified';
      const severity = attributes.severity as DiagnosticSeverity;
      const messageId = typeof attributes.message_id === 'string' && attributes.message_id.length > 0 ? attributes.message_id : undefined;
      const pattern = normalizeDiagnosticMessage(attributes.message);
      // A reporter's own id is the better identity when it has one; the
      // pattern still disambiguates ids that cover several situations.
      const key = `${source}\u0000${severity}\u0000${messageId ?? ''}\u0000${pattern}`;
      let group = groups.get(key);
      if (!group) {
        if (groups.size >= MAX_GROUPS) { truncated = true; continue; }
        group = {
          key, source, severity, ...(messageId ? { messageId } : {}), pattern,
          example: attributes.message, count: 0, frames: [], framesTruncated: false, outsideFrames: 0,
        };
        groups.set(key, group);
      }
      group.count += 1;
      const frame = parsed.data.frameIndex;
      if (frame === undefined) group.outsideFrames += 1;
      else if (!group.frames.includes(frame)) {
        if (group.frames.length >= MAX_FRAMES_PER_GROUP) group.framesTruncated = true;
        else group.frames.push(frame);
      }
    }
  }
  for (const group of groups.values()) group.frames.sort((left, right) => left - right);
  return { runId: capture.runId, adapterId: capture.adapterId, scenarioId: capture.scenarioId, groups, truncated };
}

function worstFirst(left: DiagnosticGroup, right: DiagnosticGroup): number {
  return SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || right.count - left.count || left.key.localeCompare(right.key);
}

function describeGroup(group: DiagnosticGroup): string {
  const where = group.frames.length > 0
    ? `frame${group.frames.length === 1 ? '' : 's'} ${group.frames.slice(0, 5).join(', ')}${group.frames.length > 5 || group.framesTruncated ? ', ...' : ''}`
    : 'outside any frame';
  const id = group.messageId ? ` [${group.messageId}]` : '';
  const text = group.example.length > 240 ? `${group.example.slice(0, 237)}...` : group.example;
  return `${group.severity} from ${group.source}${id}, ${group.count}x in ${where}: ${text}`;
}

export async function listRunDiagnostics(options: {
  runPath: string;
  baselineRunPath?: string;
}): Promise<RunDiagnostics> {
  const current = await readGroups(options.runPath);
  const groups = [...current.groups.values()].sort(worstFirst);
  const totals: Record<DiagnosticSeverity, number> = { error: 0, warning: 0, info: 0 };
  for (const group of groups) totals[group.severity] += group.count;

  let baseline: RunDiagnostics['baseline'];
  if (options.baselineRunPath) {
    const previous = await readGroups(options.baselineRunPath);
    if (previous.adapterId !== current.adapterId || previous.scenarioId !== current.scenarioId) {
      throw invalidInput('diagnostics can only be diffed between runs of the same adapter scenario', {
        baseline: `${previous.adapterId}/${previous.scenarioId}`,
        run: `${current.adapterId}/${current.scenarioId}`,
      });
    }
    baseline = {
      runId: previous.runId,
      introduced: groups.filter((group) => !previous.groups.has(group.key)),
      resolved: [...previous.groups.values()].filter((group) => !current.groups.has(group.key)).sort(worstFirst),
    };
  }

  const verdict: RunDiagnostics['verdict'] = totals.error > 0 ? 'errors' : totals.warning > 0 ? 'warnings' : 'clean';
  const summary: string[] = [];
  if (groups.length === 0) {
    summary.push(
      'No diagnostic messages were recorded. That is only meaningful if the engine routes its validation ' +
      'layer or debug callback into the probe (gdprobe_diagnostic); a run that never listens reports nothing.',
    );
  } else {
    summary.push(
      `${totals.error} error${totals.error === 1 ? '' : 's'}, ${totals.warning} warning${totals.warning === 1 ? '' : 's'} ` +
      `and ${totals.info} info message${totals.info === 1 ? '' : 's'} in ${groups.length} distinct group${groups.length === 1 ? '' : 's'}.`,
    );
  }
  if (baseline) {
    if (baseline.introduced.length > 0) {
      summary.push(`New since baseline ${baseline.runId}:`);
      for (const group of baseline.introduced.slice(0, 5)) summary.push(`  ${describeGroup(group)}`);
    } else {
      summary.push(`Nothing new since baseline ${baseline.runId}.`);
    }
    if (baseline.resolved.length > 0) {
      summary.push(`${baseline.resolved.length} group${baseline.resolved.length === 1 ? '' : 's'} from the baseline no longer occur${baseline.resolved.length === 1 ? 's' : ''}.`);
    }
  } else {
    for (const group of groups.slice(0, 5)) summary.push(`  ${describeGroup(group)}`);
  }

  return {
    schema: GAME_DEV_RUN_DIAGNOSTICS_SCHEMA,
    runId: current.runId,
    adapterId: current.adapterId,
    scenarioId: current.scenarioId,
    totals,
    groups,
    groupsTruncated: current.truncated,
    ...(baseline ? { baseline } : {}),
    verdict,
    summary,
    evidence: {
      sealedRunVerified: true,
      reporterCompletenessKnown: false,
      humanReviewPerformed: false,
    },
    evidenceCeiling:
      'These are the diagnostic messages the engine chose to record in this sealed run. The harness cannot ' +
      'know whether a validation layer was enabled or every callback was routed, so an empty list is not ' +
      'evidence of correctness; grouping normalises numbers and handles and may merge messages that differ only there.',
  };
}
