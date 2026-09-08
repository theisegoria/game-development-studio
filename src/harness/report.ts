import * as fs from 'node:fs/promises';
import path from 'node:path';
import type { VisualComparison } from './visual.js';
const escape = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
/** Called only with freshly verified comparison paths, never arbitrary imported JSON. */
export async function writeComparisonReport(comparison: VisualComparison, destination: string): Promise<void> {
  const rows: string[] = [];
  for (const [index, pair] of comparison.pairs.entries()) {
    const images: string[] = [];
    for (const [label, source] of [['baseline', pair.baselinePath], ['candidate', pair.candidatePath], ['heatmap', pair.heatmapPath]] as const) {
      if (!source) continue;
      const bytes = await fs.readFile(source);
      if (label !== 'heatmap') await fs.writeFile(path.join(destination, `${index}-${label}.png`), bytes, { flag: 'wx' });
      images.push(`<figure><img alt="${label}" src="data:image/png;base64,${bytes.toString('base64')}"><figcaption>${label}</figcaption></figure>`);
    }
    rows.push(`<section><h2>${escape(pair.identity)}</h2><p>${escape(pair.reason ?? `Changed pixels: ${pair.changedPixelRatio ?? 0}; MAE: ${pair.meanAbsoluteError ?? 0}`)}</p><div>${images.join('')}</div></section>`);
  }
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Capture comparison</title><style>body{font:16px system-ui;margin:2rem;max-width:1400px}div{display:flex;flex-wrap:wrap}figure{margin:1rem;flex:1;min-width:200px}img{max-width:100%;image-rendering:pixelated}section{border-top:1px solid #999;padding:1rem 0}</style><h1>Capture comparison</h1><p>${escape(comparison.baselineRunId)} → ${escape(comparison.candidateRunId)}</p><p>${escape(comparison.evidenceCeiling)}</p><p>Unmatched baseline: ${escape(comparison.unmatchedBaseline.join(', '))}; unmatched candidate: ${escape(comparison.unmatchedCandidate.join(', '))}</p>${rows.join('')}</html>`;
  await fs.writeFile(path.join(destination, 'report.html'), html, { flag: 'wx', mode: 0o600 });
}
