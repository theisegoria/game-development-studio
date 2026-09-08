import * as fs from 'node:fs/promises';
import path from 'node:path';
import { invalidInput, invalidState } from '../util/errors.js';
import { validateCaptureManifest } from './capture.js';
import {
  GAME_DEV_PERFORMANCE_COMPARISON_SCHEMA,
  GAME_DEV_PERFORMANCE_SUMMARY_SCHEMA,
  GAME_DEV_TELEMETRY_SCHEMA,
  telemetryEventSchema,
  type MetricStatistics,
  type TelemetryEvent,
} from './contracts.js';
import { canonicalJson } from '../packages/format.js';
import { verifyRunBundle } from './run-bundle.js';

const MAX_TELEMETRY_BYTES = 64 * 1024 * 1024;
const MAX_TELEMETRY_LINES = 250_000;
const MAX_PROFILE_BYTES = 32 * 1024 * 1024;
const MAX_PROFILE_MEASUREMENTS = 100_000;

export interface Measurement {
  metric: string;
  unit: string;
  value: number;
  source: 'capture' | 'telemetry' | 'foreign-telemetry' | 'profile';
  aggregation?: 'sample' | 'mean' | 'median' | 'p95' | 'p99' | 'min' | 'max';
  frameIndex?: number;
  timestampNs?: string;
  artifact?: string;
}

export interface PerformanceSummary {
  schema: typeof GAME_DEV_PERFORMANCE_SUMMARY_SCHEMA;
  runId: string;
  runPath: string;
  adapterId: string;
  scenarioId: string;
  metrics: MetricStatistics[];
  measurements: Measurement[];
  aggregates: Measurement[];
  groups: Array<MetricStatistics & { source: Measurement['source'] }>;
  controls: RunControls;
  ambiguousMetrics: string[];
  sources: Record<Measurement['source'], number>;
  hardwarePerformanceEvidenceAdmitted: boolean;
  evidenceCeiling: string;
}

export interface PerformanceComparison {
  schema: typeof GAME_DEV_PERFORMANCE_COMPARISON_SCHEMA;
  baselineRunId: string;
  candidateRunId: string;
  statistic: keyof Pick<MetricStatistics, 'min' | 'max' | 'mean' | 'median' | 'p95' | 'p99'>;
  metrics: Array<{
    metric: string;
    unit: string;
    baseline: number;
    candidate: number;
    delta: number;
    percentDelta: number | null;
  }>;
  missingBaseline: string[];
  missingCandidate: string[];
  incompatibleGroups: string[];
  comparability: ControlComparison;
  hardwarePerformanceComparisonAdmitted: boolean;
  evidenceCeiling: string;
}

function inferUnit(name: string): string | undefined {
  const lowered = name.toLowerCase();
  if (/(?:^|_)ns$/.test(lowered)) return 'ns';
  if (/(?:^|_)us$/.test(lowered)) return 'us';
  if (/(?:^|_)ms$/.test(lowered)) return 'ms';
  if (/(?:^|_)(?:seconds|secs|sec)$/.test(lowered)) return 's';
  if (/(?:^|_)(?:bytes|byte_count)$/.test(lowered)) return 'bytes';
  if (/(?:^|_)(?:count|frames|draws|dispatches|triangles)$/.test(lowered)) return 'count';
  if (/(?:^|_)(?:percent|percentage|ratio)$/.test(lowered)) return lowered.endsWith('ratio') ? 'ratio' : 'percent';
  return undefined;
}

function finiteNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function foreignTelemetryMeasurements(value: unknown): Measurement[] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [];
  const event = value as Record<string, unknown>;
  if (typeof event.name !== 'string' || event.name.length === 0) return [];
  const measurements: Measurement[] = [];
  const directValue = finiteNumber(event.value);
  if (directValue !== undefined && typeof event.unit === 'string' && event.unit.length > 0) {
    measurements.push({ metric: event.name, unit: event.unit, value: directValue, source: 'foreign-telemetry' });
  }
  for (const [key, raw] of Object.entries(event)) {
    if (['ts', 'timestamp', 'timestamp_us', 'name', 'value', 'unit'].includes(key)) continue;
    const number = finiteNumber(raw);
    const unit = inferUnit(key);
    if (number !== undefined && unit !== undefined) {
      measurements.push({
        metric: `${event.name}.${key}`,
        unit,
        value: number,
        source: 'foreign-telemetry',
      });
    }
  }
  return measurements;
}

async function telemetryMeasurements(filePath: string, expectedRunId: string): Promise<Measurement[]> {
  const bytes = await fs.readFile(filePath);
  if (bytes.length > MAX_TELEMETRY_BYTES) throw invalidInput('telemetry artifact exceeds the byte ceiling', { filePath });
  const lines = bytes.toString('utf8').split('\n');
  if (lines.length > MAX_TELEMETRY_LINES + 1) throw invalidInput('telemetry artifact exceeds the line ceiling', { filePath });
  const measurements: Measurement[] = [];
  let lastSequence = -1;
  for (const [index, line] of lines.entries()) {
    if (line.trim().length === 0) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw invalidInput('telemetry artifact contains invalid JSONL', { filePath, line: index + 1 });
    }
    const standard = telemetryEventSchema.safeParse(value);
    if (standard.success) {
      const event: TelemetryEvent = standard.data;
      if (event.schema !== GAME_DEV_TELEMETRY_SCHEMA || event.runId !== expectedRunId) {
        throw invalidState('standard telemetry event does not join the run identity', { filePath, line: index + 1 });
      }
      if (event.sequence <= lastSequence) {
        throw invalidState('standard telemetry sequence is not strictly increasing', { filePath, line: index + 1 });
      }
      lastSequence = event.sequence;
      if (event.value !== undefined && event.unit !== undefined) {
        measurements.push({
          metric: `${event.category}.${event.name}`,
          unit: event.unit,
          value: event.value,
          source: 'telemetry',
          aggregation: 'sample',
          frameIndex: event.frameIndex,
          timestampNs: String(event.timestampNs),
          artifact: path.basename(filePath),
        });
      }
      continue;
    }
    const foreign = foreignTelemetryMeasurements(value);
    if (foreign.length === 0) {
      throw invalidInput('telemetry line is neither game_dev.telemetry_event.v1 nor a supported foreign event', {
        filePath,
        line: index + 1,
      });
    }
    measurements.push(...foreign);
  }
  return measurements;
}

function flattenProfile(
  value: unknown,
  pathParts: string[],
  output: Measurement[],
  depth = 0,
): void {
  if (output.length >= MAX_PROFILE_MEASUREMENTS || depth > 16) return;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const leaf = pathParts.at(-1) ?? '';
    const unit = inferUnit(leaf);
    if (unit !== undefined) {
      output.push({ metric: `profile.${pathParts.join('.')}`, unit, value, source: 'profile' });
    }
    return;
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      flattenProfile(value[index], [...pathParts, String(index)], output, depth + 1);
      if (output.length >= MAX_PROFILE_MEASUREMENTS) break;
    }
    return;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right));
    for (const [key, inner] of entries) {
      flattenProfile(inner, [...pathParts, key], output, depth + 1);
      if (output.length >= MAX_PROFILE_MEASUREMENTS) break;
    }
  }
}

async function profileMeasurements(filePath: string): Promise<Measurement[]> {
  const stats = await fs.stat(filePath);
  if (stats.size > MAX_PROFILE_BYTES) return [];
  let value: unknown;
  try {
    value = JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch {
    return [];
  }
  const measurements: Measurement[] = [];
  flattenProfile(value, [], measurements);
  return measurements;
}

function percentile(sorted: number[], fraction: number): number {
  if (sorted.length === 1) return sorted[0] ?? 0;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[upper] ?? low;
  return low + (high - low) * (position - lower);
}

export function statistics(metric: string, unit: string, values: number[]): MetricStatistics {
  if (values.length === 0) throw invalidInput('cannot summarize an empty metric');
  const sorted = [...values].sort((left, right) => left - right);
  const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  const variance = sorted.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / sorted.length;
  return {
    metric,
    unit,
    samples: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    mean,
    median: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    standardDeviation: Math.sqrt(variance),
  };
}

export async function summarizeRunPerformance(runPathInput: string): Promise<PerformanceSummary> {
  const verified = await verifyRunBundle(runPathInput);
  const measurements: Measurement[] = [];
  if (verified.manifest.captureManifest) {
    const capture = await validateCaptureManifest(verified.runPath, verified.manifest.captureManifest, {
      runId: verified.manifest.runId,
      adapterId: verified.manifest.adapterId,
      scenarioId: verified.manifest.scenarioId,
    });
    for (const measurement of capture.manifest.measurements) {
      measurements.push({
        metric: measurement.metric,
        unit: measurement.unit,
        value: measurement.value,
        source: 'capture',
        aggregation: measurement.aggregation,
        frameIndex: measurement.frameIndex,
      });
    }
    for (const relative of capture.manifest.telemetry) {
      for (const measurement of await telemetryMeasurements(path.resolve(verified.runPath, relative), verified.manifest.runId)) {
        if (measurements.length >= MAX_TELEMETRY_LINES) throw invalidInput('run exceeds the combined measurement ceiling');
        measurements.push(measurement);
      }
    }
    for (const relative of capture.manifest.profiles) {
      for (const measurement of await profileMeasurements(path.resolve(verified.runPath, relative))) {
        if (measurements.length >= MAX_TELEMETRY_LINES) throw invalidInput('run exceeds the combined measurement ceiling');
        measurements.push(measurement);
      }
    }
  }

  if (measurements.length > MAX_TELEMETRY_LINES) throw invalidInput('run exceeds the combined measurement ceiling');
  const grouped = new Map<string, { metric: string; unit: string; values: number[]; sources: Set<Measurement['source']> }>();
  const sourceGroups = new Map<string, { metric: string; unit: string; source: Measurement['source']; values: number[] }>();
  const sources: PerformanceSummary['sources'] = {
    capture: 0,
    telemetry: 0,
    'foreign-telemetry': 0,
    profile: 0,
  };
  for (const measurement of measurements) {
    measurement.aggregation ??= 'sample';
    sources[measurement.source] += 1;
    if (measurement.aggregation !== 'sample') continue;
    const key = `${measurement.metric}\u0000${measurement.unit}`;
    const group = grouped.get(key) ?? { metric: measurement.metric, unit: measurement.unit, values: [], sources: new Set<Measurement['source']>() };
    group.values.push(measurement.value);
    group.sources.add(measurement.source);
    grouped.set(key, group);
    const sourceKey = `${key}\0${measurement.source}`;
    const sourceGroup = sourceGroups.get(sourceKey) ?? { metric: measurement.metric, unit: measurement.unit, source: measurement.source, values: [] };
    sourceGroup.values.push(measurement.value);
    sourceGroups.set(sourceKey, sourceGroup);
  }
  const ambiguousMetrics = [...grouped.values()].filter((g) => g.sources.size > 1).map((g) => `${g.metric} [${g.unit}]`);
  const metrics = [...grouped.values()].filter((g) => !ambiguousMetrics.includes(`${g.metric} [${g.unit}]`))
    .map((group) => statistics(group.metric, group.unit, group.values))
    .sort((left, right) => left.metric.localeCompare(right.metric) || left.unit.localeCompare(right.unit));

  return {
    schema: GAME_DEV_PERFORMANCE_SUMMARY_SCHEMA,
    runId: verified.manifest.runId,
    runPath: verified.runPath,
    adapterId: verified.manifest.adapterId,
    scenarioId: verified.manifest.scenarioId,
    metrics,
    measurements,
    ambiguousMetrics,
    aggregates: measurements.filter((m) => m.aggregation !== 'sample'),
    groups: [...sourceGroups.values()].map((group) => ({ ...statistics(group.metric, group.unit, group.values), source: group.source })),
    controls: await readRunControls(verified.runPath),
    sources,
    hardwarePerformanceEvidenceAdmitted: verified.manifest.evidence.hardwarePerformanceEvidenceAdmitted,
    evidenceCeiling:
      'Statistics are deterministic reductions over sealed capture measurements, JSONL telemetry, and timing-shaped numeric profile fields. They prove neither hardware timing authority nor causal attribution unless the run separately admits native performance evidence.',
  };
}

export async function compareRunPerformance(
  baselineRunPath: string,
  candidateRunPath: string,
  statistic: PerformanceComparison['statistic'] = 'median',
): Promise<PerformanceComparison> {
  const [baseline, candidate] = await Promise.all([
    summarizeRunPerformance(baselineRunPath),
    summarizeRunPerformance(candidateRunPath),
  ]);
  if (baseline.adapterId !== candidate.adapterId || baseline.scenarioId !== candidate.scenarioId) {
    throw invalidInput('performance comparison requires runs from the same adapter scenario', {
      baseline: `${baseline.adapterId}/${baseline.scenarioId}`,
      candidate: `${candidate.adapterId}/${candidate.scenarioId}`,
    });
  }
  const candidateByKey = new Map(candidate.metrics.map((metric) => [`${metric.metric}\u0000${metric.unit}`, metric]));
  const metrics: PerformanceComparison['metrics'] = [];
  for (const baselineMetric of baseline.metrics) {
    const candidateMetric = candidateByKey.get(`${baselineMetric.metric}\u0000${baselineMetric.unit}`);
    if (!candidateMetric) continue;
    const baselineValue = baselineMetric[statistic];
    const candidateValue = candidateMetric[statistic];
    const delta = candidateValue - baselineValue;
    metrics.push({
      metric: baselineMetric.metric,
      unit: baselineMetric.unit,
      baseline: baselineValue,
      candidate: candidateValue,
      delta,
      percentDelta: baselineValue === 0 ? null : (delta / Math.abs(baselineValue)) * 100,
    });
  }
  return {
    schema: GAME_DEV_PERFORMANCE_COMPARISON_SCHEMA,
    baselineRunId: baseline.runId,
    candidateRunId: candidate.runId,
    statistic,
    metrics,
    missingBaseline: candidate.metrics.filter((m) => !baseline.metrics.some((b) => b.metric === m.metric && b.unit === m.unit)).map((m) => `${m.metric} [${m.unit}]`),
    missingCandidate: baseline.metrics.filter((m) => !candidate.metrics.some((b) => b.metric === m.metric && b.unit === m.unit)).map((m) => `${m.metric} [${m.unit}]`),
    incompatibleGroups: metrics.filter((m) => {
      const sources = (summary: PerformanceSummary) => summary.groups.filter((g) => g.metric === m.metric && g.unit === m.unit).map((g) => g.source).sort().join(',');
      return sources(baseline) !== sources(candidate);
    }).map((m) => `${m.metric} [${m.unit}]`),
    comparability: compareControls(baseline.controls, candidate.controls),
    hardwarePerformanceComparisonAdmitted:
      baseline.hardwarePerformanceEvidenceAdmitted && candidate.hardwarePerformanceEvidenceAdmitted && compareControls(baseline.controls, candidate.controls).status === 'compatible',
    evidenceCeiling:
      'The comparison reports arithmetic deltas only. Direction, target, regression status, causal explanation, and optimization success require an explicit bounded goal; hardware claims require both runs to admit hardware-performance evidence.',
  };
}

/** Controls are read only after the closed run roster has been verified. */
export interface RunControls {
  adapterHash: string;
  parameters: Record<string, unknown>;
  hardware: unknown;
  build: unknown;
}
export interface ControlComparison {
  status: 'compatible' | 'incompatible' | 'unknown';
  differences: string[];
  unknown: string[];
}
export async function readRunControls(runPath: string): Promise<RunControls> {
  const verified = await verifyRunBundle(runPath);
  let metadata: { hardware?: unknown; build?: unknown } = {};
  if (verified.manifest.captureManifest) {
    const capture = await validateCaptureManifest(verified.runPath, verified.manifest.captureManifest, { runId: verified.manifest.runId, adapterId: verified.manifest.adapterId, scenarioId: verified.manifest.scenarioId });
    metadata = capture.manifest.adapterEvidence;
  }
  return {
    adapterHash: verified.manifest.adapterManifestSha256,
    parameters: JSON.parse(await fs.readFile(path.join(verified.runPath, 'request.json'), 'utf8')) as Record<string, unknown>,
    hardware: metadata.hardware ?? null,
    build: metadata.build ?? null,
  };
}
export function compareControls(baseline: RunControls, candidate: RunControls): ControlComparison {
  const differences: string[] = [];
  const unknown: string[] = [];
  for (const key of ['adapterHash', 'parameters', 'hardware', 'build'] as const) {
    if (baseline[key] === null || candidate[key] === null) unknown.push(key);
    else {
      const comparable = (value: unknown) => key === 'build' && value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'revision')) : value;
      if (canonicalJson(comparable(baseline[key])) !== canonicalJson(comparable(candidate[key]))) differences.push(key);
    }
  }
  return { status: differences.length ? 'incompatible' : unknown.length ? 'unknown' : 'compatible', differences, unknown };
}
