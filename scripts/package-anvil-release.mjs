#!/usr/bin/env node
/** Source-repository ad-hoc Anvil ZIP lane. No signing identity, Apple submission or app launch. */
import { promises as fs, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, URL } from 'node:url';
import { verifyRuntimePayload } from './cli-runtime-payload.mjs';
import { provenanceBytes } from './anvil-provenance.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const profile = path.join(root, 'distribution/macos-ci-upstream-node');
const resourceStager = path.join(root, 'apps/macos/Anvil/Tools/stage-resource-bundle.mjs');
const archiveTool = path.join(root, 'scripts/anvil-archive.py');
const repository = 'theisegoria/game-development-studio';
const environment = { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C', TZ: 'UTC' };
function run(command, args, options = {}) { return execFileSync(command, args, { env: environment, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8', ...options }); }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function hash(file) { const digest = createHash('sha256'); for await (const chunk of createReadStream(file)) digest.update(chunk); return digest.digest('hex'); }
async function regular(file) { const info = await fs.lstat(file); assert(info.isFile() && !info.isSymbolicLink(), `Not a regular file: ${file}`); return fs.readFile(file); }
async function exact(directory, names) {
  const actual = await fs.readdir(directory);
  assert(JSON.stringify(actual.sort()) === JSON.stringify([...names].sort()), `Closed roster differs: ${directory}`);
}
/** Portable complete tree evidence: no symlink, special file or unsafe filename accepted. */
export async function treeEvidence(directory) {
  const result = [];
  const info = await fs.lstat(directory); assert(info.isDirectory() && !info.isSymbolicLink(), 'Bundle root is not a regular directory');
  async function walk(parent, relative = '') {
    for (const name of (await fs.readdir(parent)).sort()) {
      assert(!name.includes('\\') && ![...name].some(character => character.charCodeAt(0) < 32), 'Unsafe archive filename');
      const file = path.join(parent, name), rel = relative ? `${relative}/${name}` : name;
      const entry = await fs.lstat(file);
      assert(!entry.isSymbolicLink() && (entry.isDirectory() || entry.isFile()), `Link or special file in app: ${rel}`);
      result.push(entry.isDirectory() ? { path: rel, type: 'directory', mode: entry.mode & 0o777 }
        : { path: rel, type: 'file', mode: entry.mode & 0o777, bytes: entry.size, sha256: await hash(file) });
      if (entry.isDirectory()) await walk(file, rel);
    }
  }
  await walk(directory); return result;
}
export function validateAppIdentity(info, version) {
  const expected = { CFBundleIdentifier: 'com.theisegoria.Anvil', CFBundleExecutable: 'Anvil',
    CFBundleName: 'Anvil', CFBundleDisplayName: 'Anvil', CFBundlePackageType: 'APPL',
    CFBundleShortVersionString: version, CFBundleVersion: version, LSMinimumSystemVersion: '26.0', CFBundleIconFile: 'AppIcon' };
  for (const [key, value] of Object.entries(expected)) assert(info[key] === value, `Anvil ${key} mismatch`);
}
async function verifyApp(app, version) {
  const tree = await treeEvidence(app);
  const contents = path.join(app, 'Contents'), resources = path.join(contents, 'Resources');
  await exact(app, ['Contents']);
  await exact(contents, ['Info.plist', 'MacOS', 'Resources', '_CodeSignature']);
  await exact(path.join(contents, 'MacOS'), ['Anvil']);
  await exact(path.join(contents, '_CodeSignature'), ['CodeResources']);
  await exact(resources, ['ANVIL_BUILD.json', 'AppIcon.icns', 'Anvil_AnvilKit.bundle', 'GameDevelopmentStudioRuntime', 'THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_PROVENANCE.json', 'ThirdPartyLicenses']);
  validateAppIdentity(JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path.join(contents, 'Info.plist')])), version);
  const binary = path.join(contents, 'MacOS/Anvil');
  assert((await fs.stat(binary)).mode & 0o111, 'Anvil binary is not executable');
  assert(run('/usr/bin/lipo', ['-archs', binary]).trim() === 'arm64', 'Anvil must be arm64 only');
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  // codesign describes signatures on stderr, so capture it without shell redirection.
  let signature = '';
  const { spawnSync } = await import('node:child_process');
  const inspection = spawnSync('/usr/bin/codesign', ['-dvvv', app], { env: environment, encoding: 'utf8' });
  assert(inspection.status === 0, 'Could not inspect Anvil signature'); signature = inspection.stderr;
  assert(/^Signature=adhoc$/m.test(signature) && /^TeamIdentifier=not set$/m.test(signature)
    && !/^Authority=/m.test(signature) && !/flags=.*runtime/.test(signature), 'Expected ad-hoc signing only; Developer ID/notarization not claimed');
  const cdhash = /^CDHash=([a-f0-9]+)$/m.exec(signature)?.[1]; assert(cdhash, 'Signature lacks CodeDirectory hash');
  const entitlements = spawnSync('/usr/bin/codesign', ['-d', '--entitlements', ':-', app], { env: environment, encoding: 'utf8' });
  assert(entitlements.status === 0 && entitlements.stdout.trim() === '', 'Unexpected application entitlements');
  const sourceProvenance = JSON.parse(await regular(path.join(profile, 'THIRD_PARTY_PROVENANCE.json')));
  assert((await regular(path.join(resources, 'THIRD_PARTY_PROVENANCE.json'))).equals(provenanceBytes(sourceProvenance, version)), 'Anvil provenance is not derived from the pinned source profile');
  assert((await regular(path.join(resources, 'THIRD_PARTY_NOTICES.md'))).equals(await regular(path.join(profile, 'THIRD_PARTY_NOTICES.md'))), 'Third-party notices differ');
  const licenseNames = sourceProvenance.legalAssets.map(asset => asset.path);
  await exact(path.join(resources, 'ThirdPartyLicenses'), licenseNames);
  for (const asset of sourceProvenance.legalAssets) {
    assert(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(asset.path), 'Unsafe legal asset name');
    const bytes = await regular(path.join(resources, 'ThirdPartyLicenses', asset.path));
    assert(bytes.equals(await regular(path.join(profile, 'legal/third-party-licenses', asset.path)))
      && bytes.length === asset.bytes && createHash('sha256').update(bytes).digest('hex') === asset.sha256, `License evidence mismatch: ${asset.path}`);
  }
  run(process.execPath, [resourceStager, '--verify', path.join(resources, 'Anvil_AnvilKit.bundle')]);
  const build = JSON.parse(await regular(path.join(resources, 'ANVIL_BUILD.json')));
  assert(build.schema === 'game_dev.anvil_build.v1' && build.version === version && build.configuration === 'release'
    && build.platform === 'macos' && build.architecture === 'arm64'
    && build.sourceRevision === run('git', ['-C', root, 'rev-parse', 'HEAD']).trim()
    && typeof build.swift === 'string' && typeof build.xcode === 'string', 'Build receipt differs from source/release platform');
  const runtime = path.join(resources, 'GameDevelopmentStudioRuntime');
  const runtimeEvidence = await verifyRuntimePayload(runtime);
  const node = path.join(runtime, 'payload/node/bin/node');
  const nodeVersion = run(node, ['--version']).trim();
  run(process.execPath, [path.join(root, 'scripts/verify-macos-runtime-provenance.mjs'), '--runtime', runtime,
    '--provenance', path.join(resources, 'THIRD_PARTY_PROVENANCE.json'), '--node-version', nodeVersion]);
  assert(run(node, [path.join(runtime, 'payload/app/dist/cli.js'), '--version']).trim() === version, 'Bundled CLI version mismatch');
  return { tree, cdhash, nodeVersion, runtime: runtimeEvidence, build };
}
function requireHost() { assert(process.platform === 'darwin' && process.arch === 'arm64', 'Anvil archive verification requires a macOS arm64 host'); }
async function version() { const value = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')).version; assert(/^\d+\.\d+\.\d+$/.test(value), 'Invalid package version'); return value; }
export function artifactName(value) { return `Anvil-${value}-macos-arm64.zip`; }
export function archiveReadme(value) {
  return `Anvil ${value} — standalone macOS archive

Requirements: Apple Silicon (arm64), macOS 26 or later.
This app is ad-hoc signed, NOT Developer ID signed and NOT notarized.
This ZIP is not an installer. No clean-machine Gatekeeper acceptance is claimed.
Verify the GitHub release SHA256SUMS before extraction. Review the release's
ANVIL_RELEASE.json for source revision, runtime, licenses and signature evidence.
Gatekeeper may block this app; consult your own organization's security policy.

Extract into a user-chosen directory. Before opening the app, run free diagnostics
from that directory using its bundled CLI (no provider submissions):

APP="$PWD/Anvil.app"
NODE="$APP/Contents/Resources/GameDevelopmentStudioRuntime/payload/node/bin/node"
CLI="$APP/Contents/Resources/GameDevelopmentStudioRuntime/payload/app/dist/cli.js"
CHECK_WORKSPACE="$(mktemp -d)"
"$NODE" "$CLI" doctor --output-dir "$CHECK_WORKSPACE"
"$NODE" "$CLI" capabilities --output-dir "$CHECK_WORKSPACE"

Keep this diagnostic workspace for inspection or remove it manually afterward.
Blender and optional provider tools are separate dependencies; diagnostics report
availability. The archive does not authorize paid operations or install profiles.
Updates and rollback remain manual, after verifying the chosen GitHub artifacts.
`;
}
async function verifyReadme(extracted, value) {
  await exact(extracted, ['Anvil.app', 'README.txt']);
  assert((await regular(path.join(extracted, 'README.txt'))).toString() === archiveReadme(value), 'Archive README differs');
}
async function packageRelease(app, output) {
  requireHost(); const releaseVersion = await version();
  assert(run('git', ['-C', root, 'status', '--porcelain', '--untracked-files=all']).trim() === '', 'Public packaging requires a clean source checkout');
  const sourceRevision = run('git', ['-C', root, 'rev-parse', 'HEAD']).trim();
  await verifyApp(app, releaseVersion);
  await fs.mkdir(output); // Never overwrite an existing release directory.
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anvil-release-'));
  try {
    const staged = path.join(temporary, 'Anvil.app');
    run('/usr/bin/ditto', ['--norsrc', '--noextattr', '--noqtn', app, staged]);
    const verified = await verifyApp(staged, releaseVersion);
    const readme = path.join(temporary, 'README.txt');
    await fs.writeFile(readme, archiveReadme(releaseVersion), { mode: 0o644 });
    const name = artifactName(releaseVersion), artifact = path.join(output, name), second = path.join(temporary, name);
    run('python3', [archiveTool, 'create', staged, artifact, '--readme', readme]);
    run('python3', [archiveTool, 'create', staged, second, '--readme', readme]);
    const sha256 = await hash(artifact); assert(sha256 === await hash(second), 'Archive construction was not byte-reproducible');
    const extracted = path.join(temporary, 'extracted');
    run('python3', [archiveTool, 'extract', artifact, extracted]);
    await verifyReadme(extracted, releaseVersion);
    const roundtrip = await verifyApp(path.join(extracted, 'Anvil.app'), releaseVersion);
    assert(JSON.stringify(verified.tree) === JSON.stringify(roundtrip.tree) && verified.cdhash === roundtrip.cdhash, 'Extracted archive differs from verified staged app');
    const metadata = { schema: 'game_dev.anvil_release.v1', repository, sourceRevision, version: releaseVersion,
      artifact: name, sha256, bytes: (await fs.stat(artifact)).size, architecture: 'arm64', minimumMacOS: '26.0',
      signing: { kind: 'ad-hoc', developerID: false, notarized: false, hardenedRuntimeClaimed: false, cdhash: verified.cdhash },
      runtimeProfile: 'upstream-node-ci', nodeVersion: verified.nodeVersion, tree: verified.tree,
      build: verified.build,
      runtime: verified.runtime, readmeSha256: await hash(readme),
      evidence: { archiveReproducible: true, extractedAndVerified: true, appLaunched: false, nativeUIAccepted: false,
        note: 'Standalone ZIP; not a signed/notarized installer. No clean-machine Gatekeeper acceptance claimed.' } };
    await fs.writeFile(path.join(output, 'ANVIL_RELEASE.json'), JSON.stringify(metadata, null, 2) + '\n', { flag: 'wx' });
    await fs.writeFile(path.join(output, 'ANVIL_SHA256SUMS.txt'), `${sha256}  ${name}\n${await hash(path.join(output, 'ANVIL_RELEASE.json'))}  ANVIL_RELEASE.json\n`, { flag: 'wx' });
    console.log(JSON.stringify({ artifact, sha256, sourceRevision, signing: metadata.signing }));
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
async function verifyRelease(output) {
  requireHost(); const releaseVersion = await version(), name = artifactName(releaseVersion);
  await exact(output, [name, 'ANVIL_RELEASE.json', 'ANVIL_SHA256SUMS.txt']);
  const metadata = JSON.parse(await regular(path.join(output, 'ANVIL_RELEASE.json')));
  assert(metadata.schema === 'game_dev.anvil_release.v1' && metadata.repository === repository && metadata.version === releaseVersion
    && metadata.artifact === name && metadata.sourceRevision === run('git', ['-C', root, 'rev-parse', 'HEAD']).trim(), 'Release identity differs from this source revision');
  assert(metadata.architecture === 'arm64' && metadata.minimumMacOS === '26.0' && metadata.runtimeProfile === 'upstream-node-ci'
    && metadata.signing.kind === 'ad-hoc' && metadata.signing.developerID === false && metadata.signing.notarized === false
    && metadata.signing.hardenedRuntimeClaimed === false && metadata.evidence.appLaunched === false, 'Release trust claims differ');
  const sha256 = await hash(path.join(output, name));
  assert(metadata.sha256 === sha256 && metadata.bytes === (await fs.stat(path.join(output, name))).size, 'Archive bytes differ');
  const sums = `${sha256}  ${name}\n${await hash(path.join(output, 'ANVIL_RELEASE.json'))}  ANVIL_RELEASE.json\n`;
  assert((await regular(path.join(output, 'ANVIL_SHA256SUMS.txt'))).toString() === sums, 'Checksums mismatch');
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'anvil-verify-'));
  try {
    const extracted = path.join(temporary, 'extracted');
    run('python3', [archiveTool, 'extract', path.join(output, name), extracted]);
    await verifyReadme(extracted, releaseVersion);
    const result = await verifyApp(path.join(extracted, 'Anvil.app'), releaseVersion);
    assert(JSON.stringify(result.tree) === JSON.stringify(metadata.tree) && result.cdhash === metadata.signing.cdhash
      && result.nodeVersion === metadata.nodeVersion && metadata.readmeSha256 === await hash(path.join(extracted, 'README.txt'))
      && JSON.stringify(result.runtime) === JSON.stringify(metadata.runtime) && JSON.stringify(result.build) === JSON.stringify(metadata.build), 'Re-extracted app evidence differs');
    console.log('Verified ad-hoc Anvil ZIP, complete tree, signatures, runtime, licenses and schemas; no app launch');
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, ...args] = process.argv.slice(2);
  if (action === 'package' && args.length === 4 && args[0] === '--app' && args[2] === '--output') await packageRelease(path.resolve(args[1]), path.resolve(args[3]));
  else if (action === 'verify' && args.length === 2 && args[0] === '--release-root') await verifyRelease(path.resolve(args[1]));
  else throw new Error('Usage: package-anvil-release.mjs package --app APP --output NEW_DIRECTORY | verify --release-root DIRECTORY');
}
