/**
 * The skill references are served to every MCP client as prompts now. A
 * client reading "game-dev visual compare" from one of them has no shell to
 * run it in, so each reference must also name the MCP tool -- and name a tool
 * that actually exists, so the mapping cannot go stale as tools are renamed.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { describe, expect, it } from 'vitest';
import { LocalCommandRegistry } from '../src/commands/registry.js';
import { registerAssetCommands } from '../src/commands/register.js';
import { createGameDevRuntime } from '../src/runtime.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const references = [
  'skills/game-visual-debugging/references/capture-workflow.md',
  'skills/game-performance-optimization/references/optimization-loop.md',
  'skills/game-asset-production/references/commands.md',
  'skills/game-asset-vendoring/references/commands.md',
];

describe('skill references name their MCP tools', () => {
  it('every workflow reference has an Over MCP section', async () => {
    for (const relative of references) {
      const text = await readFile(path.join(root, relative), 'utf8');
      expect(text, relative).toContain('## Over MCP');
    }
  });

  it('every tool name a reference cites is a registered tool', async () => {
    const work = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-refs-'));
    try {
      const runtime = await createGameDevRuntime({ outputDir: work });
      const registry = new LocalCommandRegistry();
      registerAssetCommands(registry, runtime.context);
      const registered = new Set(registry.names());

      for (const relative of references) {
        const text = await readFile(path.join(root, relative), 'utf8');
        const section = text.slice(text.indexOf('## Over MCP'));
        // Backticked snake_case identifiers in the MCP section are tool names.
        const cited = [...section.matchAll(/`([a-z][a-z0-9_]{2,63})`/g)]
          .map((match) => match[1] as string)
          .filter((name) => name.includes('_'));
        expect(cited.length, `${relative} cites no tools`).toBeGreaterThan(0);
        for (const name of cited) {
          expect(registered.has(name), `${relative} cites ${name}, which is not registered`).toBe(true);
        }
      }
    } finally {
      await fs.rm(work, { recursive: true, force: true });
    }
  });
});
