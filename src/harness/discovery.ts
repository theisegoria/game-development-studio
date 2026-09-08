import * as fs from 'node:fs/promises';
import path from 'node:path';
import { verifyRunBundle } from './run-bundle.js';

export interface RunLibraryEntry {
  id: string;
  path: string;
  verified: boolean;
  scenario?: string;
  completedAt?: string;
  outcome?: string;
  evidence?: 'hardware-performance' | 'gpu' | 'local';
  error?: string;
}
/** Discovery does not repair or mutate corrupt runs. */
export async function listRuns(root: string, limit = 100): Promise<{ schema: 'game_dev.run_list.v1'; runs: RunLibraryEntry[] }> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const runs: RunLibraryEntry[] = [];
  for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
    const runPath = path.join(root, entry.name);
    try {
      const { manifest } = await verifyRunBundle(runPath);
      runs.push({ id: manifest.runId, path: runPath, verified: true, scenario: `${manifest.adapterId}/${manifest.scenarioId}`,
        completedAt: manifest.completedAt, outcome: manifest.status,
        evidence: manifest.evidence.hardwarePerformanceEvidenceAdmitted ? 'hardware-performance' : manifest.evidence.adapterReportedGpuExecution ? 'gpu' : 'local' });
    } catch (error) {
      runs.push({ id: entry.name, path: runPath, verified: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { schema: 'game_dev.run_list.v1', runs: runs.sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '')).slice(0, limit) };
}
