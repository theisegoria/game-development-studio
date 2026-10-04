import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const temporaryRoots: string[] = [];
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
const files = ['README.md', 'docs/install.md', 'docs/quickstart.md', 'docs/windows-install.md', 'docs/distribution-roadmap.md', 'distribution/skills-repo/README.md', 'package.json'];
const checker = path.join(root, 'scripts/check-install-docs.mjs');
const verifier = path.join(root, 'scripts/verify-first-run.mjs');
function check(target: string): string {
  return execFileSync(process.execPath, ['--input-type=module', '-e', `const {checkInstallDocs}=await import(${JSON.stringify(`file://${checker}`)}); console.log(JSON.stringify(await checkInstallDocs(process.argv[1])));`, target], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'install docs '));
  temporaryRoots.push(directory);
  for (const file of files) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), await readFile(path.join(root, file)));
  }
  return directory;
}

it('rejects old release links, unpublished registry installation and compiler-dependent free routes', async () => {
  const directory = await fixture();
  expect(JSON.parse(check(directory))).toMatchObject({ version: '1.3.1', files: 6 });
  const readme = await readFile(path.join(directory, 'README.md'), 'utf8');
  await writeFile(path.join(directory, 'README.md'), readme.replace('releases/tag/v1.3.1', 'releases/tag/v1.1.0'));
  expect(() => check(directory)).toThrow();
  await writeFile(path.join(directory, 'README.md'), `${readme}\nnpm install --global @theisegoria/game-development-studio\n`);
  expect(() => check(directory)).toThrow();
  await writeFile(path.join(directory, 'README.md'), readme);
  await writeFile(path.join(directory, 'docs/quickstart.md'), `${await readFile(path.join(directory, 'docs/quickstart.md'), 'utf8')}\ncc -std=c99 main.c\n`);
  expect(() => check(directory)).toThrow();
});

it('rejects version bumps without current release commands and Node requirement drift', async () => {
  const directory = await fixture();
  const packageJson = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ ...packageJson, version: '1.3.2' }));
  expect(() => check(directory)).toThrow();
  await writeFile(path.join(directory, 'package.json'), JSON.stringify({ ...packageJson, engines: { node: '>=24' } }));
  expect(() => check(directory)).toThrow();
});

it('binds exact tarball and manifest bytes to public release metadata and rejects tamper, ambiguity and wrong identity', async () => {
  const name = 'theisegoria-game-development-studio-1.3.1.tgz';
  const bytes = Buffer.from('test fixture tarball bytes; never installed');
  const sha256 = (value: Buffer) => createHash('sha256').update(value).digest('hex');
  const manifest = Buffer.from(`${sha256(bytes)}  ${name}\n`);
  const release = { tag_name: 'v1.3.1', html_url: 'https://github.com/theisegoria/game-development-studio/releases/tag/v1.3.1', draft: false, prerelease: false, assets: [
    { name, size: bytes.length, digest: `sha256:${sha256(bytes)}`, browser_download_url: `https://github.com/theisegoria/game-development-studio/releases/download/v1.3.1/${name}` },
    { name: 'SHA256SUMS.txt', size: manifest.length, digest: `sha256:${sha256(manifest)}`, browser_download_url: 'https://github.com/theisegoria/game-development-studio/releases/download/v1.3.1/SHA256SUMS.txt' },
  ] };
  const { verifyChecksum } = await import(verifier);
  expect(verifyChecksum(bytes, name, manifest.toString('utf8'), release, manifest)).toMatchObject({ version: '1.3.1', sha256: sha256(bytes), integrity: 'github-release-digest-and-manifest' });
  expect(verifyChecksum(bytes, name, manifest.toString('utf8'))).toMatchObject({ integrity: 'local-manifest-only' });
  expect(() => verifyChecksum(Buffer.from('changed'), name, manifest.toString('utf8'))).toThrow('mismatch');
  expect(() => verifyChecksum(bytes, name, manifest.toString('utf8').repeat(2))).toThrow('Duplicate');
  expect(() => verifyChecksum(bytes, name, 'invalid manifest')).toThrow('Malformed');
  expect(() => verifyChecksum(bytes, name, manifest.toString('utf8'), { ...release, tag_name: 'v1.3.0' }, manifest)).toThrow('identity');
  expect(() => verifyChecksum(bytes, name, manifest.toString('utf8'), { ...release, assets: release.assets.slice(0, 1) }, manifest)).toThrow('missing');
  expect(() => verifyChecksum(bytes, name, manifest.toString('utf8'), { ...release, assets: [{ ...release.assets[0], digest: `sha256:${'0'.repeat(64)}` }, release.assets[1]] }, manifest)).toThrow('digest');
});

it('preserves cmd.exe quoting for a Windows shim installed under a path with spaces', async () => {
  const { assertWindowsPathLookup, windowsShimInvocation } = await import(verifier);
  const installedShim = 'C:\\Users\\runner\\AppData\\Local\\Temp\\game dev first run\\cli prefix\\game-dev.cmd';
  expect(windowsShimInvocation('C:\\Windows\\System32\\cmd.exe', 'C:\\Users\\runner\\AppData\\Local\\Temp\\game dev first run\\cli prefix\\game-dev.cmd')).toEqual({
    command: 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/s', '/c', `""${installedShim}" --version"`],
    options: { windowsVerbatimArguments: true },
  });
  const reportedLongPath = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\game dev first run\\cli prefix\\game-dev.cmd';
  const expectedShortPath = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\game dev first run\\cli prefix\\game-dev.cmd';
  const stalePath = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\old cli bin\\game-dev.cmd';
  const canonicalInstalled = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\game dev first run\\cli prefix\\game-dev.cmd';
  const canonicalStale = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\old cli bin\\game-dev.cmd';
  const realpath = async (value: string) => {
    const normalized = path.win32.normalize(value).toLowerCase();
    if ([reportedLongPath, expectedShortPath].some(alias => normalized === path.win32.normalize(alias).toLowerCase())) return canonicalInstalled;
    if (normalized === path.win32.normalize(stalePath).toLowerCase()) return canonicalStale;
    throw Object.assign(new Error(`Unable to resolve ${value}`), { code: 'ENOENT' });
  };
  await expect(assertWindowsPathLookup(`${reportedLongPath}\r\n${stalePath}\r\n`, expectedShortPath, realpath)).resolves.toBe(reportedLongPath);
  await expect(assertWindowsPathLookup(`${stalePath}\r\n${reportedLongPath}\r\n`, expectedShortPath, realpath)).rejects.toThrow('Windows PATH selected');
  await expect(assertWindowsPathLookup(`C:\\Users\\runneradmin\\unknown\\game-dev.cmd\r\n`, expectedShortPath, realpath)).rejects.toThrow('Unable to resolve');
});
