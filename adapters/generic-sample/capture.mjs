#!/usr/bin/env node
import * as fs from 'node:fs/promises';
import path from 'node:path';
const [mode = 'normal'] = process.argv.slice(2);
if (mode === 'failure') process.exit(2);
if (mode === 'timeout') await new Promise((resolve) => setTimeout(resolve, 60000));
const configuration = JSON.parse(await fs.readFile(new URL('src/renderer.json', import.meta.url), 'utf8'));
if (!Number.isFinite(configuration.frameTime) || configuration.frameTime <= 0) throw new Error('invalid frame time');
const runDir = process.env.GAME_DEV_RUN_DIR;
const runId = process.env.GAME_DEV_RUN_ID;
const adapterId = process.env.GAME_DEV_ADAPTER_ID;
const scenarioId = process.env.GAME_DEV_SCENARIO_ID;
if (!runDir || !runId || !adapterId || !scenarioId) throw new Error('run context is required');
const color = configuration.visualRegression || mode === 'visual-regression' ? 'regression.png' : 'baseline.png';
await fs.copyFile(new URL(color, import.meta.url), path.join(runDir, 'color.png'));
await fs.writeFile(path.join(runDir, 'capture.json'), JSON.stringify({
  schema: 'game_dev.capture.v1', runId, adapterId, scenarioId, sourceFormat: 'game-dev-capture-v1',
  frames: [{ index: 0, label: 'sample', attachments: [{ kind: 'color', path: 'color.png', encoding: 'png' }] }],
  measurements: [0, 1, 2, 3, 4].map((frameIndex) => ({ metric: 'render.frame_time', unit: 'ms', aggregation: 'sample', frameIndex, value: configuration.frameTime + (frameIndex - 2) * 0.1 })),
  adapterEvidence: { windowless: true, graphicsApi: 'synthetic', notes: ['Deterministic workflow fixture; these values are not hardware timings.'] },
}));
