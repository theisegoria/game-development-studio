/**
 * `run_scenario` starts a process the harness did not write.
 *
 * The CLI gates that on --confirm typed per invocation, plus --allow-gpu and
 * --allow-performance on top when the scenario declares them. Over MCP nobody
 * types anything and the model writes every argument, so the authority lives
 * in the launch environment a human controls.
 *
 * It is enforced in the HANDLER, not only in the MCP transport, because
 * registering the tool also exposes it through `game-dev tool call` -- and a
 * gate one entry point walks around is not a gate. These tests drive the
 * handler directly, which is that second entry point.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerHarnessTools } from '../src/tools/harness.js';
import { connectTools, type ToolClient } from './helpers/tool-harness.js';
import { writeHarnessProject } from './helpers/harness-fixture.js';

let work: string;
let tools: ToolClient;
let projectRoot: string;
let source: string;
let objectIds: string;

const AUTHORITIES = [
  'GAME_DEV_MCP_ALLOW_EXECUTION',
  'GAME_DEV_MCP_ALLOW_GPU',
  'GAME_DEV_MCP_ALLOW_PERFORMANCE',
];

function clearAuthorities(): void {
  for (const name of AUTHORITIES) delete process.env[name];
}

beforeEach(async () => {
  clearAuthorities();
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'exec-authority-'));
  const project = await writeHarnessProject(work);
  projectRoot = project.projectRoot;
  source = path.relative(projectRoot, project.baselinePng);
  objectIds = path.relative(projectRoot, project.objectIdPng);
  tools = await connectTools(registerHarnessTools, work);
});

afterEach(async () => {
  clearAuthorities();
  await tools?.close();
  await fs.rm(work, { recursive: true, force: true });
});

const parameters = () => ({ source, objectIds, frameTime: 12, mode: 'normal' });

async function runsCreated(): Promise<number> {
  const runsDir = path.join(work, '.game-dev', 'runs');
  return fs.readdir(runsDir).then((names) => names.length, () => 0);
}

describe('planning needs no authority at all', () => {
  it('resolves what would run and names the authorities it would need', async () => {
    const { isError, payload } = await tools.call('plan_scenario_run', {
      project: projectRoot,
      scenario: 'gpu-capture',
      parameters: parameters(),
    });

    expect(isError).toBe(false);
    expect(payload.authoritiesRequired).toEqual(expect.arrayContaining(['confirm', 'gpu']));
    expect(payload.authoritiesGranted).toMatchObject({ execution: false, gpu: false });
    // Planning must execute nothing -- it is the only way to see what would run.
    expect(await runsCreated()).toBe(0);
  });
});

describe('execution authority', () => {
  it('refuses without it, and starts no process', async () => {
    const { isError, payload } = await tools.call('run_scenario', {
      project: projectRoot,
      scenario: 'capture',
      parameters: parameters(),
    });

    expect(isError).toBe(true);
    expect(payload.error).toBe('INVALID_INPUT');
    expect((payload.details as { missingGrants: string[] }).missingGrants)
      .toEqual(['execution']);
    expect(await runsCreated()).toBe(0);
  });

  it('cannot be granted by an argument the caller writes', async () => {
    const { isError } = await tools.call('run_scenario', {
      project: projectRoot,
      scenario: 'capture',
      // A model that has read the docs will try exactly this.
      parameters: { ...parameters(), confirm: true, allowGpu: true },
    });

    expect(isError).toBe(true);
    // Undeclared parameters are refused outright, and even the authority names
    // are not parameters -- there is no argument spelling that authorizes.
    expect(await runsCreated()).toBe(0);
  });

  it('runs a CPU scenario once execution authority is granted', async () => {
    process.env.GAME_DEV_MCP_ALLOW_EXECUTION = '1';

    const { isError, payload } = await tools.call('run_scenario', {
      project: projectRoot,
      scenario: 'capture',
      parameters: parameters(),
    });

    expect(isError).toBe(false);
    expect(payload.runPath).toBeTruthy();
    expect(await runsCreated()).toBe(1);
  }, 30_000);
});

describe('capability authority is separate from execution authority', () => {
  it('refuses a GPU scenario when only execution was granted', async () => {
    process.env.GAME_DEV_MCP_ALLOW_EXECUTION = '1';

    const { isError, payload } = await tools.call('run_scenario', {
      project: projectRoot,
      scenario: 'gpu-capture',
      parameters: parameters(),
    });

    expect(isError).toBe(true);
    expect((payload.details as { missingGrants: string[] }).missingGrants)
      .toEqual(['gpu']);
    // The refusal must come before the process starts, not after.
    expect(await runsCreated()).toBe(0);
  });

  it('runs it once GPU authority is granted too', async () => {
    process.env.GAME_DEV_MCP_ALLOW_EXECUTION = '1';
    process.env.GAME_DEV_MCP_ALLOW_GPU = '1';

    const { isError } = await tools.call('run_scenario', {
      project: projectRoot,
      scenario: 'gpu-capture',
      parameters: parameters(),
    });

    expect(isError).toBe(false);
    expect(await runsCreated()).toBe(1);
  }, 30_000);
});

describe('live sessions start a process too', () => {
  async function sessionsCreated(): Promise<number> {
    return fs.readdir(path.join(work, '.game-dev', 'sessions')).then((names) => names.length, () => 0);
  }

  it('refuses without execution authority, and launches nothing', async () => {
    const { isError, payload } = await tools.call('start_live_session', {
      project: projectRoot,
      scenario: 'capture',
      parameters: parameters(),
    });

    expect(isError).toBe(true);
    expect((payload.details as { missingGrants: string[] }).missingGrants).toEqual(['execution']);
    expect(await sessionsCreated()).toBe(0);
  });

  it('still demands GPU authority for a GPU scenario when execution is granted', async () => {
    process.env.GAME_DEV_MCP_ALLOW_EXECUTION = '1';
    const { isError, payload } = await tools.call('start_live_session', {
      project: projectRoot,
      scenario: 'gpu-capture',
      parameters: parameters(),
    });

    expect(isError).toBe(true);
    expect((payload.details as { missingGrants: string[] }).missingGrants).toEqual(['gpu']);
    expect(await sessionsCreated()).toBe(0);
  });

  it('addresses only session ids the harness could have minted', async () => {
    const { isError } = await tools.call('live_session_query', { session: '../../etc', query: 'x' });
    expect(isError).toBe(true);
  });
});

describe('bisection builds and runs project code at every probe', () => {
  it('refuses without execution authority before touching the repository', async () => {
    const { isError, payload } = await tools.call('run_bisect', {
      project: projectRoot,
      scenario: 'capture',
      parameters: parameters(),
      good: 'HEAD~1',
      bad: 'HEAD',
      criterion: { kind: 'visual' },
    });

    expect(isError).toBe(true);
    expect((payload.details as { missingGrants: string[] }).missingGrants).toEqual(['execution']);
    expect(await runsCreated()).toBe(0);
  });
});
