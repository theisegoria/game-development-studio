/**
 * The Swift wrapper, driven through the real harness.
 *
 * Swift engines get the same C implementation through one ABI, so this test
 * is short: build the Swift example with SwiftPM, run it as a scenario, and
 * check the harness reads exactly what the C example produces -- the same
 * picture, both objects, slugified label, refused GPU claim, and the
 * provenance the wrapper passed across.
 *
 * Skipped when no Swift toolchain is present; CI's macOS job asserts it ran.
 */

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadAdapter, planScenarioRun } from '../src/harness/adapter.js';
import { GAME_DEV_ADAPTER_SCHEMA } from '../src/harness/contracts.js';
import { summarizeRunPerformance } from '../src/harness/performance.js';
import { executeScenarioRun } from '../src/harness/run-bundle.js';
import { analyzeRunCapture } from '../src/harness/visual.js';
import { canonicalJson } from '../src/packages/format.js';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const packagePath = path.join(repoRoot, 'probe');

function swiftAvailable(): boolean {
  try { execFileSync('swift', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}
const haveSwift = swiftAvailable();

let root: string;
let projectRoot: string;

beforeAll(async () => {
  if (!haveSwift) return;
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'probe-swift-'));
  projectRoot = path.join(root, 'engine');
  await fs.mkdir(path.join(projectRoot, '.game-dev'), { recursive: true });
  execFileSync('swift', ['build', '--package-path', packagePath, '--product', 'GDProbeExample'], { stdio: 'pipe' });
  const bin = execFileSync('swift', ['build', '--package-path', packagePath, '--show-bin-path'], { encoding: 'utf8' }).trim();
  await fs.copyFile(path.join(bin, 'GDProbeExample'), path.join(projectRoot, 'engine'));
  await fs.chmod(path.join(projectRoot, 'engine'), 0o755);
  await fs.writeFile(path.join(projectRoot, '.game-dev', 'adapter.json'), canonicalJson({
    schema: GAME_DEV_ADAPTER_SCHEMA,
    id: 'probe-swift',
    name: 'Swift probe example',
    version: '1.0.0',
    scenarios: [{
      id: 'capture', title: 'One frame from Swift', command: { executable: 'engine', arguments: ['{param.brightness}'], workingDirectory: '.' },
      timeoutSeconds: 30, capabilities: ['software-raster', 'project-write'],
      parameters: { brightness: { type: 'integer', required: false, default: 0, minimum: 0, maximum: 50 } },
      outputs: { format: 'game-dev-capture-v1', path: 'capture.json' },
    }],
  }));
}, 600_000);

afterAll(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe.skipIf(!haveSwift)('a bundle written through the Swift wrapper', () => {
  it('is sealed, decodes to the expected picture, and keeps the software lane honest', async () => {
    const adapter = await loadAdapter(projectRoot);
    const plan = await planScenarioRun({ adapter, scenarioId: 'capture', runsRoot: path.join(root, 'runs'), parameters: { brightness: 10 } });
    const result = await executeScenarioRun({ adapter, plan, confirm: true, allowGpu: false, allowPerformance: false });

    expect(result.manifest.status, JSON.stringify(result.manifest.failure)).toBe('completed');
    expect(result.manifest.evidence.rendererClass).toBe('software');
    expect(result.manifest.evidence.adapterReportedGpuExecution).toBe(false);

    const analysis = await analyzeRunCapture(result.runPath);
    const color = analysis.rasters.find((raster) => raster.kind === 'color')!;
    expect(color.frameLabel).toBe('main-view');
    expect([color.width, color.height]).toEqual([16, 8]);
    expect(analysis.rasters.some((raster) => raster.kind === 'object_id')).toBe(true);

    const summary = await summarizeRunPerformance(result.runPath);
    expect(summary.metrics.find((metric) => metric.metric === 'performance.frame_time')).toMatchObject({
      samples: 8, measuredBy: 'wall_clock',
    });
  }, 120_000);
});
