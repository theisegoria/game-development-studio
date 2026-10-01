import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { it, expect } from 'vitest';
import { verifyNpmRuntimeBinding } from '../scripts/verify-macos-runtime-provenance.mjs';

it('rejects missing, extra, duplicate and version-drifted npm provenance, including nested packages', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'npm-runtime-notices-'));
  try {
    const packages = ['node_modules/@example/a', 'node_modules/@example/a/node_modules/b'];
    const records = packages.map((installPath, i) => ({ installPath, name: i ? 'b' : '@example/a', lockedVersion: '1.0.0', license: 'MIT' }));
    for (const pkg of records) {
      const base = path.join(root, 'payload/app', pkg.installPath);
      await mkdir(base, { recursive: true });
      await writeFile(path.join(base, 'package.json'), JSON.stringify({ name: pkg.name, version: pkg.lockedVersion, license: pkg.license }));
    }
    const roster = { entries: packages.map((p) => ({ type: 'file', path: `app/${p}/package.json` })) };
    expect(await verifyNpmRuntimeBinding(root, roster, { npmProductionPackages: records })).toBe(2);
    await expect(verifyNpmRuntimeBinding(root, roster, { npmProductionPackages: records.slice(1) })).rejects.toThrow('exactly match');
    await expect(verifyNpmRuntimeBinding(root, { entries: roster.entries.slice(1) }, { npmProductionPackages: records })).rejects.toThrow('exactly match');
    await expect(verifyNpmRuntimeBinding(root, roster, { npmProductionPackages: [...records, records[0]] })).rejects.toThrow('duplicate');
    records[1]!.lockedVersion = '2.0.0';
    await expect(verifyNpmRuntimeBinding(root, roster, { npmProductionPackages: records })).rejects.toThrow('identity');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
