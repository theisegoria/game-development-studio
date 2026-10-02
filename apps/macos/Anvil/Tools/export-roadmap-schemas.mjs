// Read-only MCP tools/list: never invokes a registered operation.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROADMAP_FREE_TOOLS } from '../../../../dist/commands/mutation-policy.js';
const root = fileURLToPath(new URL('../../../..', import.meta.url));
const workspace = await fs.mkdtemp(path.join(os.tmpdir(), 'anvil-schemas-'));
const client = new Client({ name: 'anvil-schema-export', version: '1.0.0' });
try {
  await client.connect(new StdioClientTransport({ command: process.execPath,
    args: [path.join(root, 'dist/mcp/server.js')],
    env: { PATH: process.env.PATH ?? '', ASSET_OUTPUT_DIR: workspace } }));
  const { tools } = await client.listTools();
  const schemas = Object.fromEntries(tools.filter(tool => ROADMAP_FREE_TOOLS.has(tool.name)).map(tool => [tool.name, tool.inputSchema]));
  if (Object.keys(schemas).length !== ROADMAP_FREE_TOOLS.size) throw new Error('Incomplete roadmap schema export');
  const output = new URL('../Sources/AnvilKit/Resources/roadmap-tool-schemas.json', import.meta.url);
  const serialized = JSON.stringify(schemas, null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (await fs.readFile(output, 'utf8') !== serialized) throw new Error('Native request schema snapshot differs from runtime tools/list; regenerate it.');
  } else await fs.writeFile(output, serialized);
  process.stdout.write(`Exported ${Object.keys(schemas).length} runtime tool schemas\n`);
} finally { await client.close(); await fs.rm(workspace, { recursive: true, force: true }); }
