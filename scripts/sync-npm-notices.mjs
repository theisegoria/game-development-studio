#!/usr/bin/env node
// Reconcile notices from the existing lockfile and installed packages; never installs dependencies.
import { readFile, readdir, writeFile, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { URL, fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
const profiles = ['macos-app-repo', 'macos-ci-upstream-node'];
const records = [];
const assets = new Map();
const previous = JSON.parse(await readFile(path.join(root, 'distribution', profiles[0], 'THIRD_PARTY_PROVENANCE.json'), 'utf8'));
for (const [installPath, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  if (!installPath.startsWith('node_modules/') || entry.dev === true) continue;
  const base = path.join(root, installPath);
  const pkg = JSON.parse(await readFile(path.join(base, 'package.json'), 'utf8'));
  if (pkg.version !== entry.version || pkg.license !== entry.license || !entry.license || !entry.integrity) {
    throw new Error(`Missing or inconsistent installed licensing/version evidence: ${installPath}`);
  }
  const names = (await readdir(base, { withFileTypes: true }))
    .filter((f) => f.isFile() && /^(licen[sc]e|copying|notice|copyright)([._-]|$)/i.test(f.name)).map((f) => f.name).sort();
  if (!names.some((name) => /^(licen[sc]e|copying)/i.test(name))) throw new Error(`No upstream license file: ${installPath}`);
  const licenseAssets = [];
  const licenseSources = [];
  for (const name of names) {
    const bytes = await readFile(path.join(base, name));
    const legacy = previous.npmProductionPackages.find((p) => p.name === pkg.name && p.lockedVersion === pkg.version);
    const filename = names.length === 1 && legacy?.licenseAssets.length === 1 ? legacy.licenseAssets[0]
      : `npm-${pkg.name.replace(/^@/, '').replaceAll('/', '-')}-${pkg.version}-${name.replaceAll('.', '-')}.txt`;
    const prior = assets.get(filename);
    if (prior && !prior.contents.equals(bytes)) throw new Error(`Conflicting upstream license bytes: ${filename}`);
    assets.set(filename, { contents: bytes, path: filename, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
      source: `Locked npm package ${pkg.name}@${pkg.version}/${name}`, scope: 'Bundled CLI production package' });
    licenseAssets.push(filename);
    licenseSources.push(name);
  }
  records.push({ name: pkg.name, installPath, lockedVersion: entry.version, lockIntegrity: entry.integrity, license: entry.license, licenseAssets, licenseSources });
}
const table = '| Package install path | Locked version | Declared license |\n| --- | --- | --- |\n' + records.map((p) => `| \`${p.installPath}\` | ${p.lockedVersion} | ${p.license} |`).join('\n');
for (const profile of profiles) {
  const base = path.join(root, 'distribution', profile);
  const provenanceFile = path.join(base, 'THIRD_PARTY_PROVENANCE.json');
  const provenance = JSON.parse(await readFile(provenanceFile, 'utf8'));
  // Remove only previously rostered npm notices replaced by this lockfile.
  // Leaving them behind breaks the closed legal-asset roster after upgrades.
  for (const asset of provenance.legalAssets) {
    if (asset.path.startsWith('npm-') && path.basename(asset.path) === asset.path && !assets.has(asset.path)) {
      await unlink(path.join(base, 'legal/third-party-licenses', asset.path));
    }
  }
  provenance.npmProductionPackages = records;
  provenance.legalAssets = [...provenance.legalAssets.filter((a) => !a.path.startsWith('npm-')), ...[...assets.values()].map(({ contents: _contents, ...record }) => record)].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  for (const asset of assets.values()) await writeFile(path.join(base, 'legal/third-party-licenses', asset.path), asset.contents);
  await writeFile(provenanceFile, `${JSON.stringify(provenance, null, 2)}\n`);
  const noticeFile = path.join(base, 'THIRD_PARTY_NOTICES.md');
  let notice = await readFile(noticeFile, 'utf8');
  notice = notice.replace(/the (?:five|\d+) lockfile-pinned production npm (?:packages|package paths)/g, `the ${records.length} lockfile-pinned production npm package paths`);
  notice = notice.replace(/\| Package(?: install path)? \| Locked version \| (?:Declared license|License) \|\n(?:\|[^\n]*\n)+/, `${table}\n`);
  await writeFile(noticeFile, notice);
}
console.log(`Reconciled ${records.length} production package paths and ${assets.size} unchanged upstream license texts in both profiles.`);
