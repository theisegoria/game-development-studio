/**
 * Sealed runs, packages and the catalog, as MCP resources.
 *
 * A tool call per file is the wrong shape for browsing evidence: a model that
 * wants to look at a run's colour buffer, then its object-id buffer, then its
 * telemetry, should be able to read them by URI and let the client cache them.
 * Everything here is content-addressed already, so the URIs are stable.
 *
 * THE HAZARD. A URI is model-controlled input that becomes a filesystem path.
 * Two rules keep that safe, and both are tested with traversal attempts:
 *
 *  - Run ids are validated against the same pattern the harness mints, before
 *    anything touches the filesystem. resolveRunPath treats a non-matching
 *    reference as a PATH, which is correct for the CLI and exactly wrong here.
 *  - Inside a run, THE SEALED ROSTER IS THE ALLOWLIST. An artifact is served
 *    only if run.json names that exact relative path, and its bytes are
 *    re-hashed against the roster before they are returned. A resource read
 *    can therefore never reach a file the seal does not vouch for -- and every
 *    read is also a verification.
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { AssetCatalog } from '../packages/catalog.js';
import { readAssetPackage } from '../packages/format.js';
import { resolveRunPath, verifyRunBundle } from '../harness/run-bundle.js';
import { sha256 } from '../storage/filesystem.js';
import { invalidInput, notFound } from '../util/errors.js';
import type { ToolContext } from '../tools/context.js';

const RUN_ID = /^run_[a-z0-9_]{1,96}$/;
const PACKAGE_ID = /^pkg_[0-9a-f]{24}$/;

function json(uri: string, value: unknown): ReadResourceResult {
  return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) }] };
}

function mimeFor(relative: string): { mimeType: string; binary: boolean } {
  const extension = path.extname(relative).toLowerCase();
  if (extension === '.png') return { mimeType: 'image/png', binary: true };
  if (extension === '.jpg' || extension === '.jpeg') return { mimeType: 'image/jpeg', binary: true };
  if (extension === '.json') return { mimeType: 'application/json', binary: false };
  if (extension === '.jsonl') return { mimeType: 'application/x-ndjson', binary: false };
  if (extension === '.txt' || extension === '.log' || extension === '.md') return { mimeType: 'text/plain', binary: false };
  return { mimeType: 'application/octet-stream', binary: true };
}

async function listRunIds(runsDir: string): Promise<string[]> {
  const entries = await fs.readdir(runsDir, { withFileTypes: true }).catch(() => []);
  // Directories only, matching the minted pattern; a symlink named like a run
  // is not a run.
  return entries
    .filter((entry) => entry.isDirectory() && RUN_ID.test(entry.name))
    .map((entry) => entry.name)
    .sort()
    .reverse();
}

function requireRunId(value: string): string {
  const decoded = decodeURIComponent(value);
  if (!RUN_ID.test(decoded)) {
    throw invalidInput('run id must match the harness pattern run_<timestamp>_<uuid>', { runId: decoded });
  }
  return decoded;
}

/**
 * A fixed resource answers only its exact URI.
 *
 * `game-dev://runs/..` normalises differently across URL parsers, and one of
 * them hands it to the list handler with the traversal folded away. Nothing
 * was exposed by that, but a handler that answers a URI it was not
 * registered for is a matcher bug being papered over, so it refuses.
 */
function requireExact(uri: URL, expected: string): void {
  if (uri.href !== expected) throw invalidInput('resource does not exist', { uri: uri.href });
}

export function registerEvidenceResources(server: McpServer, ctx: ToolContext): void {
  const runsDir = ctx.config.runsDir;

  server.registerResource(
    'runs',
    'game-dev://runs',
    {
      title: 'Sealed capture runs',
      description: 'Every sealed run on this machine, newest first. Read game-dev://runs/{runId} for one.',
      mimeType: 'application/json',
    },
    async (uri) => {
      requireExact(uri, 'game-dev://runs');
      return json(uri.href, {
        schema: 'game_dev.run_index.v1',
        runs: (await listRunIds(runsDir)).map((runId) => ({ runId, uri: `game-dev://runs/${runId}` })),
      });
    },
  );

  server.registerResource(
    'run',
    new ResourceTemplate('game-dev://runs/{runId}', {
      list: async () => ({
        resources: (await listRunIds(runsDir)).map((runId) => ({
          uri: `game-dev://runs/${runId}`,
          name: runId,
          mimeType: 'application/json',
        })),
      }),
    }),
    {
      title: 'A sealed run manifest',
      description: 'run.json for one run, re-verified against its closed artifact roster on every read.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const runId = requireRunId(String(variables.runId));
      const verified = await verifyRunBundle(await resolveRunPath(runsDir, runId));
      return json(uri.href, {
        ...verified.manifest,
        artifactUris: verified.manifest.artifacts.map((artifact) => ({
          path: artifact.path,
          kind: artifact.kind,
          uri: `game-dev://runs/${runId}/artifacts/${artifact.path.split('/').map(encodeURIComponent).join('/')}`,
        })),
      });
    },
  );

  server.registerResource(
    'run-artifact',
    new ResourceTemplate('game-dev://runs/{runId}/artifacts/{+path}', { list: undefined }),
    {
      title: 'A sealed run artifact',
      description:
        'One file from a sealed run: a capture frame, a heatmap, telemetry, a profile. Served only ' +
        'if the run roster names it, and only after its bytes match the recorded hash.',
    },
    async (uri, variables) => {
      const runId = requireRunId(String(variables.runId));
      const requested = decodeURIComponent(String(variables.path));
      const verified = await verifyRunBundle(await resolveRunPath(runsDir, runId));

      // Exact match against the roster. Not "inside the directory" -- the
      // roster. A path the seal did not record is not evidence, whatever it is.
      const artifact = verified.manifest.artifacts.find((entry) => entry.path === requested);
      if (!artifact) throw notFound('sealed run artifact', requested);

      const absolute = path.join(verified.runPath, ...artifact.path.split('/'));
      const stats = await fs.lstat(absolute);
      if (stats.isSymbolicLink() || !stats.isFile()) throw notFound('sealed run artifact', requested);
      const bytes = await fs.readFile(absolute);
      if (sha256(bytes) !== artifact.sha256) {
        throw invalidInput('artifact bytes no longer match the sealed roster', { path: requested });
      }

      const { mimeType, binary } = mimeFor(artifact.path);
      return {
        contents: [binary
          ? { uri: uri.href, mimeType, blob: bytes.toString('base64') }
          : { uri: uri.href, mimeType, text: bytes.toString('utf8') }],
      };
    },
  );

  server.registerResource(
    'catalog',
    'game-dev://catalog',
    {
      title: 'The local asset catalog',
      description: 'Every package built on this machine. Read game-dev://packages/{packageId} for a manifest.',
      mimeType: 'application/json',
    },
    async (uri) => {
      requireExact(uri, 'game-dev://catalog');
      const catalog = await AssetCatalog.open(ctx.config.catalogPath);
      try {
        const assets = catalog.list({ limit: 1000 });
        return json(uri.href, {
          schema: 'game_dev.catalog_list.v1',
          total: assets.length,
          assets: assets.map((asset) => ({ ...asset, uri: `game-dev://packages/${asset.packageId}` })),
        });
      } finally {
        catalog.close();
      }
    },
  );

  server.registerResource(
    'package',
    new ResourceTemplate('game-dev://packages/{packageId}', {
      list: async () => {
        const catalog = await AssetCatalog.open(ctx.config.catalogPath);
        try {
          return {
            resources: catalog.list({ limit: 1000 }).map((asset) => ({
              uri: `game-dev://packages/${asset.packageId}`,
              name: asset.displayName,
              mimeType: 'application/json',
            })),
          };
        } finally {
          catalog.close();
        }
      },
    }),
    {
      title: 'A built package manifest',
      description: 'The manifest of one content-addressed package, re-read and re-verified from disk.',
      mimeType: 'application/json',
    },
    async (uri, variables) => {
      const packageId = String(variables.packageId);
      if (!PACKAGE_ID.test(packageId)) throw invalidInput('package id must match pkg_<24 hex>', { packageId });
      const catalog = await AssetCatalog.open(ctx.config.catalogPath);
      let packagePath: string;
      try {
        packagePath = catalog.get(packageId).packagePath;
      } finally {
        catalog.close();
      }
      return json(uri.href, { packagePath, manifest: await readAssetPackage(packagePath) });
    },
  );
}
