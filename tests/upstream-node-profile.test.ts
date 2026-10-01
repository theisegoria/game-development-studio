import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { validateMacOSRuntimeProvenanceBinding } from '../scripts/verify-macos-runtime-provenance.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const profile = path.join(root, 'distribution/macos-ci-upstream-node');
const verifier = path.join(root, 'scripts/verify-upstream-node-profile.mjs');
const temporaryRoots: string[] = [];
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});
const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gds-node-profile-'));
  temporaryRoots.push(directory);
  const target = path.join(directory, 'profile');
  await cp(profile, target, { recursive: true });
  const executable = path.join(directory, 'node');
  const payload = Buffer.from('test-only Node bytes; never executed');
  await writeFile(executable, payload);
  const provenancePath = path.join(target, 'THIRD_PARTY_PROVENANCE.json');
  const provenance = JSON.parse(await readFile(provenancePath, 'utf8'));
  provenance.bundledRuntime.node.sourceArtifact.executableSha256 = sha256(payload);
  await writeFile(provenancePath, JSON.stringify(provenance));
  return { executable, target };
}
function verify(executable: string, target: string) {
  return execFileSync(process.execPath, [verifier, '--node', executable, '--profile', target], { encoding: 'utf8', stdio: 'pipe' });
}

describe('explicit upstream Node CI profile', () => {
  it('binds to the package version and rejects unexpected external libraries', async () => {
    const provenance = JSON.parse(await readFile(path.join(profile, 'THIRD_PARTY_PROVENANCE.json'), 'utf8'));
    const runtimePackage = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
    const runtimeRoster = { schema: 'game_dev.cli_runtime_roster.v1', payloadRoot: 'payload', entries: [] as object[] };
    expect(validateMacOSRuntimeProvenanceBinding({ provenance, runtimePackage, runtimeRoster, nodeVersion: 'v25.2.1' }).nonSystemDylibCount).toBe(0);
    runtimeRoster.entries.push({ type: 'file', path: 'node/lib/libunexpected.dylib' });
    expect(() => validateMacOSRuntimeProvenanceBinding({ provenance, runtimePackage, runtimeRoster, nodeVersion: 'v25.2.1' })).toThrow('dylib filenames');
    const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
    for (const pkg of provenance.npmProductionPackages) {
      expect(pkg.lockedVersion).toBe(lock.packages[`node_modules/${pkg.name}`].version);
      expect(pkg.lockIntegrity).toBe(lock.packages[`node_modules/${pkg.name}`].integrity);
    }
    const license = provenance.legalAssets.find((asset: { path: string }) => asset.path === `game-development-studio-${runtimePackage.version}-MIT.txt`);
    expect(license?.sha256).toBe(sha256(await readFile(path.join(root, 'LICENSE'))));
  });

  it('checks source bytes without executing them and refuses an altered executable', async () => {
    const { executable, target } = await fixture();
    expect(verify(executable, target)).toContain('Verified pinned upstream');
    await writeFile(executable, 'tampered');
    expect(() => verify(executable, target)).toThrow('differs from the pinned upstream artifact');
  });

  it('refuses altered license bytes and unrostered legal files', async () => {
    const { executable, target } = await fixture();
    const legal = path.join(target, 'legal/third-party-licenses');
    await writeFile(path.join(legal, 'extra.txt'), 'extra');
    expect(() => verify(executable, target)).toThrow('exact declared roster');
    await rm(path.join(legal, 'extra.txt'));
    await writeFile(path.join(legal, 'node-25.2.1-LICENSE.txt'), 'incomplete license');
    expect(() => verify(executable, target)).toThrow('license digest/size mismatch');
  });
});
