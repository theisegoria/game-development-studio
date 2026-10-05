/**
 * Where the frame time went.
 *
 * `frame_time regressed 3ms` is a fact without a direction. A span tree --
 * frame > shadows > cascade 2 -- turns it into "cascade 2 grew 3ms", which is
 * where the next edit belongs. Spans come from two places:
 *
 *   - game_dev.telemetry_event.v2 span lines, written by the probe SDK's
 *     gdprobe_span_record from GPU timestamp queries or the engine's clock;
 *   - Chrome / Perfetto JSON traces (`traceEvents`, complete `X` events and
 *     `B`/`E` pairs) dropped in a run's profiles, which is what most engines'
 *     existing profilers can already export. These previously yielded no
 *     measurement at all: their `ts`/`dur` keys carry no inferable unit.
 *
 * Nesting is explicit for v2 spans and recovered from time containment per
 * thread for traces. GPU and CPU spans are never nested in or summed with one
 * another: their clocks are not comparable.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { invalidInput } from '../util/errors.js';
import {
  MEASURED_BY_ATTRIBUTE,
  telemetrySpanEventSchema,
  type MeasurementProvenance,
} from './contracts.js';
import { loadCapture } from './visual.js';

export const GAME_DEV_PERFORMANCE_BREAKDOWN_SCHEMA = 'game_dev.performance_breakdown.v1' as const;

const MAX_SPANS = 200_000;
const MAX_TRACE_BYTES = 64 * 1024 * 1024;
const MAX_DEPTH = 32;

export interface Span {
  id: string;
  parentId?: string;
  name: string;
  frameIndex?: number;
  startNs: bigint;
  durationNs: number;
  clockDomain: 'gpu' | 'cpu';
  measuredBy: MeasurementProvenance;
  origin: 'telemetry' | 'trace';
}

/** Names become metric identifiers: spaces and punctuation to `_`, never dropped. */
export function spanName(raw: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9._:/-]+/g, '_').replace(/^[^A-Za-z0-9]+/, '').slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'unnamed';
}

/** Parse v2 span lines out of a telemetry JSONL text; other lines are ignored. */
export function spansFromTelemetry(text: string, expectedRunId: string): Span[] {
  const spans: Span[] = [];
  for (const line of text.split('\n')) {
    if (!line.includes('"game_dev.telemetry_event.v2"')) continue;
    let value: unknown;
    try { value = JSON.parse(line); } catch { continue; }
    const parsed = telemetrySpanEventSchema.safeParse(value);
    if (!parsed.success || parsed.data.runId !== expectedRunId) continue;
    const event = parsed.data;
    spans.push({
      id: `t${event.spanId}`,
      ...(event.parentSpanId !== undefined ? { parentId: `t${event.parentSpanId}` } : {}),
      name: event.name,
      ...(event.frameIndex !== undefined ? { frameIndex: event.frameIndex } : {}),
      startNs: BigInt(event.startNs),
      durationNs: Number(event.durationNs),
      clockDomain: event.clockDomain,
      measuredBy: (event.attributes[MEASURED_BY_ATTRIBUTE] as MeasurementProvenance | undefined) ?? 'unknown',
      origin: 'telemetry',
    });
    if (spans.length > MAX_SPANS) throw invalidInput('run exceeds the span ceiling', { maximum: MAX_SPANS });
  }
  return spans;
}

interface TraceEvent {
  name?: unknown; ph?: unknown; ts?: unknown; dur?: unknown; tid?: unknown; pid?: unknown; cat?: unknown; args?: unknown;
}

function traceFrameIndex(args: unknown): number | undefined {
  if (args === null || typeof args !== 'object') return undefined;
  const record = args as Record<string, unknown>;
  for (const key of ['frameIndex', 'frame_index', 'frame']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  }
  return undefined;
}

/** Is this JSON a Chrome/Perfetto trace? Either `{ traceEvents: [...] }` or a bare event array. */
export function traceEventsOf(value: unknown): TraceEvent[] | undefined {
  const events = Array.isArray(value)
    ? value
    : value !== null && typeof value === 'object' && Array.isArray((value as { traceEvents?: unknown }).traceEvents)
      ? (value as { traceEvents: unknown[] }).traceEvents
      : undefined;
  if (!events || events.length === 0) return undefined;
  const first = events.find((event) => event !== null && typeof event === 'object') as TraceEvent | undefined;
  return first && typeof first.ph === 'string' ? events as TraceEvent[] : undefined;
}

/**
 * Turn trace events into spans, recovering nesting from time containment per
 * (pid, tid). Timestamps are microseconds by the format's definition. A trace
 * says nothing about how it was timed, so provenance is `unknown` unless an
 * event's args declare `measured_by` from the vocabulary.
 */
export function spansFromTrace(events: TraceEvent[], prefix: string): Span[] {
  interface Open { name: string; startUs: number; cat: string; args: unknown }
  const raw: Array<{ name: string; startUs: number; durUs: number; track: string; cat: string; args: unknown }> = [];
  const openByTrack = new Map<string, Open[]>();
  for (const event of events) {
    if (event === null || typeof event !== 'object') continue;
    const ts = typeof event.ts === 'number' ? event.ts : Number.NaN;
    if (!Number.isFinite(ts) || typeof event.name !== 'string') continue;
    const track = `${String(event.pid ?? 0)}:${String(event.tid ?? 0)}`;
    const cat = typeof event.cat === 'string' ? event.cat : '';
    if (event.ph === 'X' && typeof event.dur === 'number' && Number.isFinite(event.dur) && event.dur >= 0) {
      raw.push({ name: event.name, startUs: ts, durUs: event.dur, track, cat, args: event.args });
    } else if (event.ph === 'B') {
      const stack = openByTrack.get(track) ?? [];
      stack.push({ name: event.name, startUs: ts, cat, args: event.args });
      openByTrack.set(track, stack);
    } else if (event.ph === 'E') {
      const open = openByTrack.get(track)?.pop();
      if (open && ts >= open.startUs) raw.push({ name: open.name, startUs: open.startUs, durUs: ts - open.startUs, track, cat: open.cat, args: open.args });
    }
    if (raw.length > MAX_SPANS) throw invalidInput('trace exceeds the span ceiling', { maximum: MAX_SPANS });
  }

  // Containment per track: sort by start, longer first on ties, keep a stack.
  raw.sort((left, right) => left.track.localeCompare(right.track) || left.startUs - right.startUs || right.durUs - left.durUs);
  const spans: Span[] = [];
  let stack: Array<{ id: string; endUs: number; frameIndex?: number }> = [];
  let track = '';
  for (const [index, event] of raw.entries()) {
    if (event.track !== track) { stack = []; track = event.track; }
    while (stack.length > 0 && event.startUs >= stack.at(-1)!.endUs) stack.pop();
    const parent = stack.at(-1);
    const id = `${prefix}${index}`;
    const declared = event.args !== null && typeof event.args === 'object'
      ? (event.args as Record<string, unknown>)[MEASURED_BY_ATTRIBUTE]
      : undefined;
    const frameIndex = traceFrameIndex(event.args) ?? parent?.frameIndex;
    spans.push({
      id,
      ...(parent ? { parentId: parent.id } : {}),
      name: spanName(event.name),
      ...(frameIndex !== undefined ? { frameIndex } : {}),
      startNs: BigInt(Math.round(event.startUs * 1000)),
      durationNs: Math.round(event.durUs * 1000),
      clockDomain: /gpu/i.test(event.cat) ? 'gpu' : 'cpu',
      measuredBy: typeof declared === 'string' && ['gpu_timestamp_query', 'pipeline_statistics_query', 'driver_report', 'engine_counter', 'wall_clock'].includes(declared)
        ? declared as MeasurementProvenance
        : 'unknown',
      origin: 'trace',
    });
    stack.push({ id, endUs: event.startUs + event.durUs, ...(frameIndex !== undefined ? { frameIndex } : {}) });
  }
  return spans;
}

/** Every span a sealed run recorded, from telemetry v2 lines and trace profiles. */
export async function collectRunSpans(runPath: string): Promise<{
  runId: string; adapterId: string; scenarioId: string; spans: Span[];
}> {
  const capture = await loadCapture(runPath);
  const spans: Span[] = [];
  for (const relative of capture.manifest.telemetry) {
    const filePath = path.resolve(capture.runPath, relative);
    const bytes = await fs.readFile(filePath);
    if (bytes.length > MAX_TRACE_BYTES) throw invalidInput('telemetry artifact exceeds the byte ceiling', { filePath });
    for (const span of spansFromTelemetry(bytes.toString('utf8'), capture.runId)) spans.push(span);
  }
  for (const [index, relative] of capture.manifest.profiles.entries()) {
    const filePath = path.resolve(capture.runPath, relative);
    const stats = await fs.stat(filePath);
    if (stats.size > MAX_TRACE_BYTES) continue;
    let value: unknown;
    try { value = JSON.parse(await fs.readFile(filePath, 'utf8')); } catch { continue; }
    const events = traceEventsOf(value);
    if (events) for (const span of spansFromTrace(events, `p${index}:`)) spans.push(span);
  }
  if (spans.length > MAX_SPANS) throw invalidInput('run exceeds the span ceiling', { maximum: MAX_SPANS });
  return { runId: capture.runId, adapterId: capture.adapterId, scenarioId: capture.scenarioId, spans };
}

// --------------------------------------------------------------- breakdown

export interface BreakdownNode {
  /** `gpu:frame > shadows > cascade_2`: the clock domain, then names from the root. */
  path: string;
  name: string;
  depth: number;
  clockDomain: 'gpu' | 'cpu';
  measuredBy: MeasurementProvenance;
  /** Frames this node occurred in (repeats within a frame are summed). */
  frames: number;
  medianDurationNs: number;
  /** Duration minus its children's: time spent in this node itself. */
  medianSelfNs: number;
  /** medianSelfNs over the median total of this node's root, so siblings compare. */
  shareOfRoot: number;
}

export interface BreakdownChange {
  path: string;
  baselineSelfNs: number;
  candidateSelfNs: number;
  deltaNs: number;
  percentDelta?: number;
}

export interface PerformanceBreakdown {
  schema: typeof GAME_DEV_PERFORMANCE_BREAKDOWN_SCHEMA;
  runId: string;
  adapterId: string;
  scenarioId: string;
  spans: number;
  frames: number;
  /** Spans whose declared parent was never recorded; attached to nothing. */
  orphanSpans: number;
  nodes: BreakdownNode[];
  /** The most common chain of longest children from a root, per clock domain. */
  criticalPaths: Array<{ clockDomain: 'gpu' | 'cpu'; path: string; frames: number }>;
  baseline?: {
    runId: string;
    changes: BreakdownChange[];
    appeared: string[];
    disappeared: string[];
  };
  summary: string[];
  evidence: {
    sealedRunVerified: true;
    hardwarePerformanceMeasuredByHarnessAlone: false;
    causalityEstablished: false;
  };
  evidenceCeiling: string;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function formatDuration(ns: number): string {
  const magnitude = Math.abs(ns);
  if (magnitude >= 100_000) return `${(ns / 1e6).toFixed(2)}ms`;
  if (magnitude >= 1_000) return `${(ns / 1e3).toFixed(1)}us`;
  return `${Math.round(ns)}ns`;
}

interface Tree {
  nodes: Map<string, BreakdownNode>;
  criticalPaths: PerformanceBreakdown['criticalPaths'];
  frames: number;
  orphans: number;
}

function buildTree(spans: Span[]): Tree {
  const byId = new Map(spans.map((span) => [span.id, span]));
  const children = new Map<string, Span[]>();
  let orphans = 0;
  const roots: Span[] = [];
  for (const span of spans) {
    const parent = span.parentId !== undefined ? byId.get(span.parentId) : undefined;
    if (span.parentId !== undefined && (!parent || parent.clockDomain !== span.clockDomain)) {
      // A missing or cross-clock parent cannot be nested under; count it and
      // treat the span as a root of its own rather than inventing structure.
      orphans += 1;
      roots.push(span);
      continue;
    }
    if (parent) {
      const list = children.get(parent.id) ?? [];
      list.push(span);
      children.set(parent.id, list);
    } else {
      roots.push(span);
    }
  }

  // Per frame, per path: summed duration and summed self time.
  const perFrame = new Map<string, Map<number, { duration: number; self: number }>>();
  const meta = new Map<string, { name: string; depth: number; clockDomain: 'gpu' | 'cpu'; measuredBy: MeasurementProvenance; root: string }>();
  const criticalCounts = new Map<string, { clockDomain: 'gpu' | 'cpu'; frames: Set<number> }>();
  const frameSet = new Set<number>();

  const walk = (span: Span, prefix: string, depth: number, root: string, frame: number): void => {
    if (depth > MAX_DEPTH) return;
    const nodePath = prefix ? `${prefix} > ${span.name}` : `${span.clockDomain}:${span.name}`;
    const kids = children.get(span.id) ?? [];
    const self = Math.max(0, span.durationNs - kids.reduce((sum, kid) => sum + kid.durationNs, 0));
    const frames = perFrame.get(nodePath) ?? new Map<number, { duration: number; self: number }>();
    const entry = frames.get(frame) ?? { duration: 0, self: 0 };
    entry.duration += span.durationNs;
    entry.self += self;
    frames.set(frame, entry);
    perFrame.set(nodePath, frames);
    if (!meta.has(nodePath)) {
      meta.set(nodePath, { name: span.name, depth, clockDomain: span.clockDomain, measuredBy: span.measuredBy, root: depth === 0 ? nodePath : root });
    }
    for (const kid of kids) walk(kid, nodePath, depth + 1, depth === 0 ? nodePath : root, frame);
  };

  for (const root of roots) {
    const frame = root.frameIndex ?? -1;
    frameSet.add(frame);
    walk(root, '', 0, '', frame);
    // Critical path: follow the longest child down.
    let cursor: Span | undefined = root;
    const names: string[] = [];
    while (cursor && names.length <= MAX_DEPTH) {
      names.push(cursor.name);
      const kids: Span[] = children.get(cursor.id) ?? [];
      cursor = kids.reduce<Span | undefined>((best, kid) => (!best || kid.durationNs > best.durationNs ? kid : best), undefined);
    }
    const key = `${root.clockDomain}:${names.join(' > ')}`;
    const counted = criticalCounts.get(key) ?? { clockDomain: root.clockDomain, frames: new Set<number>() };
    counted.frames.add(frame);
    criticalCounts.set(key, counted);
  }

  const rootTotals = new Map<string, number>();
  for (const [nodePath, info] of meta) {
    if (info.depth === 0) rootTotals.set(nodePath, median([...perFrame.get(nodePath)!.values()].map((entry) => entry.duration)));
  }
  const nodes = new Map<string, BreakdownNode>();
  for (const [nodePath, info] of meta) {
    const frames = [...perFrame.get(nodePath)!.values()];
    const medianSelfNs = median(frames.map((entry) => entry.self));
    const rootTotal = rootTotals.get(info.root) ?? 0;
    nodes.set(nodePath, {
      path: nodePath,
      name: info.name,
      depth: info.depth,
      clockDomain: info.clockDomain,
      measuredBy: info.measuredBy,
      frames: frames.length,
      medianDurationNs: median(frames.map((entry) => entry.duration)),
      medianSelfNs,
      shareOfRoot: rootTotal > 0 ? medianSelfNs / rootTotal : 0,
    });
  }

  // Most common critical path per clock domain.
  const criticalPaths: PerformanceBreakdown['criticalPaths'] = [];
  for (const domain of ['gpu', 'cpu'] as const) {
    const best = [...criticalCounts.entries()]
      .filter(([, value]) => value.clockDomain === domain)
      .sort(([leftKey, left], [rightKey, right]) => right.frames.size - left.frames.size || leftKey.localeCompare(rightKey))[0];
    if (best) criticalPaths.push({ clockDomain: domain, path: best[0], frames: best[1].frames.size });
  }
  return { nodes, criticalPaths, frames: frameSet.size, orphans };
}

export async function breakdownRunPerformance(options: {
  runPath: string;
  baselineRunPath?: string;
}): Promise<PerformanceBreakdown> {
  const current = await collectRunSpans(options.runPath);
  const tree = buildTree(current.spans);
  const nodes = [...tree.nodes.values()].sort((left, right) => (
    left.clockDomain.localeCompare(right.clockDomain) || right.medianSelfNs - left.medianSelfNs || left.path.localeCompare(right.path)
  ));

  let baseline: PerformanceBreakdown['baseline'];
  if (options.baselineRunPath) {
    const previous = await collectRunSpans(options.baselineRunPath);
    if (previous.adapterId !== current.adapterId || previous.scenarioId !== current.scenarioId) {
      throw invalidInput('a breakdown can only be compared between runs of the same adapter scenario', {
        baseline: `${previous.adapterId}/${previous.scenarioId}`,
        run: `${current.adapterId}/${current.scenarioId}`,
      });
    }
    const before = buildTree(previous.spans).nodes;
    const changes: BreakdownChange[] = [];
    for (const node of tree.nodes.values()) {
      const old = before.get(node.path);
      if (!old) continue;
      const deltaNs = node.medianSelfNs - old.medianSelfNs;
      changes.push({
        path: node.path,
        baselineSelfNs: old.medianSelfNs,
        candidateSelfNs: node.medianSelfNs,
        deltaNs,
        ...(old.medianSelfNs > 0 ? { percentDelta: (deltaNs / old.medianSelfNs) * 100 } : {}),
      });
    }
    changes.sort((left, right) => Math.abs(right.deltaNs) - Math.abs(left.deltaNs) || left.path.localeCompare(right.path));
    baseline = {
      runId: previous.runId,
      changes,
      appeared: [...tree.nodes.keys()].filter((key) => !before.has(key)).sort(),
      disappeared: [...before.keys()].filter((key) => !tree.nodes.has(key)).sort(),
    };
  }

  const summary: string[] = [];
  if (current.spans.length === 0) {
    summary.push(
      'This run recorded no spans. Emit them with gdprobe_span_record, or add a Chrome/Perfetto JSON trace ' +
      '(traceEvents) to the capture\'s profiles, to see where frame time goes.',
    );
  } else {
    summary.push(`${current.spans.length} spans over ${tree.frames} frame${tree.frames === 1 ? '' : 's'}.`);
    for (const critical of tree.criticalPaths) {
      summary.push(`Longest chain on the ${critical.clockDomain.toUpperCase()} in ${critical.frames} frame${critical.frames === 1 ? '' : 's'}: ${critical.path.slice(4)}.`);
    }
    for (const domain of ['gpu', 'cpu'] as const) {
      const top = nodes.filter((node) => node.clockDomain === domain && node.depth > 0).slice(0, 3);
      if (top.length === 0) continue;
      summary.push(`Most ${domain.toUpperCase()} self-time: ${top.map((node) => `${node.name} ${formatDuration(node.medianSelfNs)} (${(node.shareOfRoot * 100).toFixed(0)}%)`).join(', ')}.`);
    }
    if (tree.orphans > 0) {
      summary.push(`${tree.orphans} span${tree.orphans === 1 ? '' : 's'} named a parent that was not recorded or ran on the other clock; they are shown as roots.`);
    }
  }
  if (baseline) {
    const moved = baseline.changes.filter((change) => Math.abs(change.deltaNs) >= 1_000).slice(0, 3);
    if (moved.length === 0) {
      summary.push(`No span's median self-time moved by 1us or more against baseline ${baseline.runId}.`);
    }
    for (const change of moved) {
      const verb = change.deltaNs > 0 ? 'grew' : 'shrank';
      const percent = change.percentDelta !== undefined ? ` (${change.percentDelta > 0 ? '+' : ''}${change.percentDelta.toFixed(0)}%)` : '';
      summary.push(`${change.path.slice(4)} ${verb} by ${formatDuration(Math.abs(change.deltaNs))}${percent} of its own time.`);
    }
    if (baseline.appeared.length > 0) summary.push(`New spans: ${baseline.appeared.slice(0, 5).map((value) => value.slice(4)).join(', ')}.`);
    if (baseline.disappeared.length > 0) summary.push(`Spans no longer recorded: ${baseline.disappeared.slice(0, 5).map((value) => value.slice(4)).join(', ')}.`);
  }

  return {
    schema: GAME_DEV_PERFORMANCE_BREAKDOWN_SCHEMA,
    runId: current.runId,
    adapterId: current.adapterId,
    scenarioId: current.scenarioId,
    spans: current.spans.length,
    frames: tree.frames,
    orphanSpans: tree.orphans,
    nodes,
    criticalPaths: tree.criticalPaths,
    ...(baseline ? { baseline } : {}),
    summary,
    evidence: {
      sealedRunVerified: true,
      hardwarePerformanceMeasuredByHarnessAlone: false,
      causalityEstablished: false,
    },
    evidenceCeiling:
      'Span durations are what the engine or its profiler recorded, with the provenance each declared. ' +
      'Self-time and shares are arithmetic over those claims. A span growing between runs is located, not ' +
      'explained, and medians over few frames move with run-to-run noise.',
  };
}
