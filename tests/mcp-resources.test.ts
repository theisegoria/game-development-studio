/**
 * Resources let a model browse sealed evidence by URI; prompts give every MCP
 * client the workflow guidance the shipped skills already carry. Together
 * they are what "first-class" means beyond a tool list.
 *
 * A URI is model-controlled input that becomes a filesystem path, so the
 * tests that matter are the refusals: a file that EXISTS in the run directory
 * but is not in the sealed roster, and an artifact whose bytes were changed
 * after sealing. The roster is the allowlist, and every read is a
 * verification.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/mcp/server.js';
import { createGameDevRuntime } from '../src/runtime.js';
import { loadAdapter, planScenarioRun } from '../src/harness/adapter.js';
import { executeScenarioRun } from '../src/harness/run-bundle.js';
import { listSkillBundle } from '../src/skills/bundle.js';
import { decodeImage } from '../src/inspection/image.js';
import { writeHarnessProject } from './helpers/harness-fixture.js';
import { writeGameReadyGlb } from './helpers/model-fixture.js';

let work: string;
let client: Client;
let runId: string;
let runPath: string;

beforeEach(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-resources-'));
  const project = await writeHarnessProject(work);
  const adapter = await loadAdapter(project.projectRoot);
  const plan = await planScenarioRun({
    adapter,
    scenarioId: 'capture',
    // The runtime's runsDir when outputDir is `work`.
    runsRoot: path.join(work, '.game-dev', 'runs'),
    parameters: {
      source: path.basename(project.baselinePng),
      objectIds: path.basename(project.objectIdPng),
      frameTime: 12,
      mode: 'normal',
    },
  });
  const run = await executeScenarioRun({ adapter, plan, confirm: true, allowGpu: false, allowPerformance: false });
  runPath = run.runPath;
  runId = path.basename(runPath);

  const runtime = await createGameDevRuntime({ outputDir: work, env: { ASSET_LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv });
  const server = await createMcpServer(runtime);
  client = new Client({ name: 'resources-test', version: '0' }, { capabilities: {} });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(a), server.connect(b)]);
});

afterEach(async () => {
  await client.close();
  await fs.rm(work, { recursive: true, force: true });
});

function textOf(result: { contents: Array<{ text?: string; blob?: string; mimeType?: string }> }) {
  return result.contents[0]!;
}

describe('prompts generated from the shipped skills', () => {
  it('serves one prompt per packaged skill, from the same files the installer copies', async () => {
    const bundle = await listSkillBundle();
    const { prompts } = await client.listPrompts();

    expect(prompts.map((prompt) => prompt.name).sort())
      .toEqual(bundle.skills.map((skill) => skill.id.replaceAll('-', '_')).sort());
  });

  it('returns the SKILL.md and its references as one user message', async () => {
    const { messages } = await client.getPrompt({ name: 'game_visual_debugging' });
    const text = (messages[0]!.content as { text: string }).text;

    expect(messages[0]!.role).toBe('user');
    expect(text).toContain('# Game Visual Debugging');
    // The references are appended, not left as dangling links.
    expect(text).toContain('<!-- references/capture-workflow.md -->');
    expect(text).toContain('game-dev visual compare');
  });
});

describe('browsing sealed runs by URI', () => {
  it('lists runs and serves a manifest that names every artifact URI', async () => {
    const index = JSON.parse(textOf(await client.readResource({ uri: 'game-dev://runs' })).text!);
    expect(index.runs.map((run: { runId: string }) => run.runId)).toContain(runId);

    const manifest = JSON.parse(textOf(await client.readResource({ uri: `game-dev://runs/${runId}` })).text!);
    expect(manifest.runId).toBe(runId);
    const uris = manifest.artifactUris.map((entry: { uri: string }) => entry.uri);
    expect(uris).toContain(`game-dev://runs/${runId}/artifacts/captures/color.png`);
  });

  it('serves a roster artifact as a blob the model can look at', async () => {
    const content = textOf(await client.readResource({
      uri: `game-dev://runs/${runId}/artifacts/captures/color.png`,
    }));

    expect(content.mimeType).toBe('image/png');
    const image = decodeImage(Buffer.from(content.blob!, 'base64'));
    expect(image.width).toBe(4);
    expect(image.height).toBe(4);
  });

  it('serves telemetry as text', async () => {
    const content = textOf(await client.readResource({
      uri: `game-dev://runs/${runId}/artifacts/telemetry.jsonl`,
    }));

    expect(content.mimeType).toBe('application/x-ndjson');
    expect(content.text).toContain('game_dev.telemetry_event.v1');
  });

  it('advertises the templates so a client can discover the shapes', async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    const patterns = resourceTemplates.map((template) => template.uriTemplate);

    expect(patterns).toContain('game-dev://runs/{runId}');
    expect(patterns).toContain('game-dev://runs/{runId}/artifacts/{+path}');
    expect(patterns).toContain('game-dev://packages/{packageId}');
  });
});

describe('the roster is the allowlist', () => {
  it('refuses a run id that is not one the harness could have minted', async () => {
    for (const bad of ['..', '%2e%2e', 'etc', 'run_..', `${runId}%2F..`]) {
      await expect(client.readResource({ uri: `game-dev://runs/${bad}` })).rejects.toThrow();
    }
  });

  it('refuses a file that exists in the run directory but is not in the roster', async () => {
    // Planted after sealing. It is really there, and it is still not evidence.
    await fs.writeFile(path.join(runPath, 'intruder.txt'), 'not sealed');

    await expect(client.readResource({
      uri: `game-dev://runs/${runId}/artifacts/intruder.txt`,
    })).rejects.toThrow();
  });

  it('refuses traversal out of the run even when the target exists', async () => {
    await expect(client.readResource({
      uri: `game-dev://runs/${runId}/artifacts/../../../../etc/passwd`,
    })).rejects.toThrow();
    await expect(client.readResource({
      uri: `game-dev://runs/${runId}/artifacts/%2e%2e%2f%2e%2e%2fetc%2fpasswd`,
    })).rejects.toThrow();
  });

  it('refuses an artifact whose bytes changed after sealing', async () => {
    // A resource read is also a verification. Silently serving altered bytes
    // under a sealed run's URI would be the harness vouching for a lie.
    const target = path.join(runPath, 'telemetry.jsonl');
    await fs.appendFile(target, '{"tampered":true}\n');

    await expect(client.readResource({
      uri: `game-dev://runs/${runId}/artifacts/telemetry.jsonl`,
    })).rejects.toThrow();
  });
});

describe('packages and the catalog by URI', () => {
  it('serves a built package manifest and lists it in the catalog', async () => {
    const model = await writeGameReadyGlb(path.join(work, 'crate.glb'));
    const built = await client.callTool({
      name: 'build_asset_package',
      arguments: { modelPath: model, name: 'Crate', license: 'CC0-1.0' },
    });
    const { packageId } = JSON.parse((built.content as Array<{ text: string }>)[0]!.text);

    const catalog = JSON.parse(textOf(await client.readResource({ uri: 'game-dev://catalog' })).text!);
    expect(catalog.assets.map((asset: { packageId: string }) => asset.packageId)).toContain(packageId);

    const pkg = JSON.parse(textOf(await client.readResource({ uri: `game-dev://packages/${packageId}` })).text!);
    expect(pkg.manifest.packageId).toBe(packageId);
  });

  it('refuses a package id that is not one the builder could have minted', async () => {
    await expect(client.readResource({ uri: 'game-dev://packages/../../etc' })).rejects.toThrow();
    await expect(client.readResource({ uri: 'game-dev://packages/pkg_notreal' })).rejects.toThrow();
  });
});
