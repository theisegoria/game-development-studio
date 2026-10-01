#!/usr/bin/env node
// Verify the pinned source executable before it is executed or re-signed.
import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}
async function bytes(file) {
  const info = await lstat(file);
  requireValue(info.isFile() && !info.isSymbolicLink(), `expected regular file: ${file}`);
  return readFile(file);
}
const args = process.argv.slice(2);
requireValue(args.length === 4 && args[0] === '--node' && args[2] === '--profile',
  'usage: verify-upstream-node-profile.mjs --node EXECUTABLE --profile DIRECTORY');
const executable = args[1];
const profile = args[3];
requireValue(path.isAbsolute(executable), 'Node executable must be an absolute path');
const provenance = JSON.parse(await bytes(path.join(profile, 'THIRD_PARTY_PROVENANCE.json')));
const source = provenance.bundledRuntime.node.sourceArtifact;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
requireValue(sha256(await bytes(executable)) === source.executableSha256,
  'Node executable differs from the pinned upstream artifact');
const legalRoot = path.join(profile, 'legal', 'third-party-licenses');
const names = provenance.legalAssets.map((asset) => asset.path);
requireValue(new Set(names).size === names.length, 'duplicate legal asset');
requireValue(JSON.stringify((await readdir(legalRoot)).sort()) === JSON.stringify([...names].sort()),
  'license corpus differs from the exact declared roster');
for (const asset of provenance.legalAssets) {
  requireValue(typeof asset.path === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.path),
    'invalid legal asset filename');
  const content = await bytes(path.join(legalRoot, asset.path));
  requireValue(content.length === asset.bytes && sha256(content) === asset.sha256,
    `license digest/size mismatch: ${asset.path}`);
}
console.log('Verified pinned upstream Node executable and complete license corpus');
