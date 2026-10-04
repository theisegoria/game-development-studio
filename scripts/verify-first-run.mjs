#!/usr/bin/env node
/** Installed-artifact, compiler-free first run. No provider, GPU, or Blender execution. */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const packageName = '@theisegoria/game-development-studio';
const repository = 'theisegoria/game-development-studio';
function invariant(value, message) { if (!value) throw new Error(message); }
function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }

export function verifyChecksum(bytes, name, manifest, release, manifestBytes) {
  const records = manifest.split(/\r?\n/).filter(Boolean).map((line) => {
    const match = /^([a-f0-9]{64}) {2}([^\r\n]+)$/.exec(line);
    invariant(match, 'Malformed SHA256SUMS.txt record');
    return { sha256: match[1], name: match[2] };
  });
  invariant(new Set(records.map((item) => item.name)).size === records.length, 'Duplicate checksum filename');
  const record = records.find((item) => item.name === name);
  invariant(record, 'CLI tarball checksum is missing');
  const sha256 = digest(bytes);
  invariant(record.sha256 === sha256, 'CLI tarball checksum mismatch');
  const version = /^theisegoria-game-development-studio-(\d+\.\d+\.\d+)\.tgz$/.exec(name)?.[1];
  invariant(version, 'Expected a versioned CLI release tarball');
  if (release) {
    invariant(release.tag_name === `v${version}` && !release.draft && !release.prerelease &&
      release.html_url === `https://github.com/${repository}/releases/tag/v${version}`, 'GitHub release identity mismatch');
    for (const [filename, content] of [[name, bytes], ['SHA256SUMS.txt', manifestBytes]]) {
      const assets = release.assets.filter((asset) => asset.name === filename);
      invariant(assets.length === 1 && content, 'GitHub release asset is missing or ambiguous');
      invariant(assets[0].size === content.length && assets[0].digest === `sha256:${digest(content)}` &&
        assets[0].browser_download_url === `https://github.com/${repository}/releases/download/v${version}/${filename}`,
      'GitHub release bytes differ from the declared asset digest, size, or URL');
    }
  }
  return { version, sha256, integrity: release ? 'github-release-digest-and-manifest' : 'local-manifest-only' };
}

function run(command, args, cwd, env, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { cwd, env, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024, ...options }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${path.basename(command)} ${args.join(' ')} failed (${error.code}): ${stderr || stdout}`, { cause: error }));
      else resolve(stdout);
    });
  });
}

export function windowsShimInvocation(comSpec, shimPath) {
  return {
    command: comSpec,
    args: ['/d', '/s', '/c', `""${shimPath}" --version"`],
    // cmd.exe must receive its /c string exactly as written. Node's normal
    // Windows argument escaping changes cmd's documented /s quote handling.
    options: { windowsVerbatimArguments: true },
  };
}

export function assertWindowsPathLookup(output, expectedLauncher) {
  const firstLauncher = output.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
  invariant(firstLauncher, 'where.exe did not find the installed game-dev.cmd shim');
  invariant(path.win32.resolve(firstLauncher).toLowerCase() === path.win32.resolve(expectedLauncher).toLowerCase(),
    `Windows PATH selected ${firstLauncher}, expected ${expectedLauncher}`);
  return firstLauncher;
}

// Running npm's JS entry with an explicit Node works without a shell and avoids
// Windows .cmd spawning/quoting differences. npm sets npm_execpath for npm scripts.
async function npmEntry() {
  const candidates = [process.env.npm_execpath, path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')];
  for (const directory of (process.env.PATH ?? '').split(path.delimiter)) {
    candidates.push(path.join(directory, 'node_modules/npm/bin/npm-cli.js'));
    if (process.platform !== 'win32') candidates.push(path.join(directory, 'npm'));
  }
  for (const candidate of candidates.filter(Boolean)) {
    try {
      const resolved = await fs.realpath(candidate);
      if (resolved.endsWith('npm-cli.js')) return resolved;
    } catch { /* Continue to the next supported npm location. */ }
  }
  throw new Error('Cannot locate npm-cli.js; run this verifier through npm run verify:first-run');
}

function optionsFromArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const name = args[index];
    invariant(['--artifact', '--checksums', '--release-metadata', '--previous-artifact', '--previous-checksums', '--previous-release-metadata', '--report'].includes(name) && args[index + 1], 'Usage: verify-first-run.mjs [--artifact CLI.tgz --checksums SHA256SUMS.txt [--release-metadata release.json]] [--previous-artifact CLI.tgz --previous-checksums SHA256SUMS.txt [--previous-release-metadata release.json]] [--report NEWFILE]');
    invariant(!options[name.slice(2)], `Duplicate ${name}`);
    options[name.slice(2)] = path.resolve(args[index + 1]);
  }
  invariant(Boolean(options.artifact) === Boolean(options.checksums), '--artifact and --checksums must be supplied together');
  invariant(!options['release-metadata'] || options.artifact, '--release-metadata requires --artifact');
  invariant(Boolean(options['previous-artifact']) === Boolean(options['previous-checksums']), 'Previous artifact and checksums must be supplied together');
  invariant(!options['previous-release-metadata'] || options['previous-artifact'], '--previous-release-metadata requires --previous-artifact');
  return options;
}

export async function verifyFirstRun(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'game dev first run '));
  try {
    return await verifyFirstRunInRoot(root, options);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function verifyFirstRunInRoot(root, options) {
  const env = { ...process.env, npm_config_cache: path.join(root, 'npm cache'), GAME_DEV_TOOL_CONFIG_PATH: path.join(root, 'optional tools.json') };
  for (const key of ['TRIPO_API_KEY', 'LEONARDO_API_KEY', 'ASSET_SPEND_LIMIT_CENTS', 'GAME_DEV_MCP_ALLOW_EXECUTION', 'GAME_DEV_TEST_BLENDER', 'GAME_DEV_TEST_GPU',
    'BLENDER_PATH', 'GAME_DEV_BLENDER_SHA256', 'GAME_DEV_BASISU_PATH', 'GAME_DEV_BASISU_SHA256', 'GAME_DEV_COACD_PYTHON', 'GAME_DEV_COACD_PYTHON_SHA256',
    'GAME_DEV_DATA_ROOT', 'ASSET_OUTPUT_DIR', 'GAME_DEV_APP_VERSION']) delete env[key];
  const npm = await npmEntry();
  const prefix = path.join(root, 'cli prefix');
  const outside = path.join(root, 'outside source');
  const output = path.join(root, 'asset workspace');
  await fs.mkdir(outside);
  let artifact = options.artifact;
  let identity;
  if (!artifact) {
    const packed = JSON.parse(await run(process.execPath, [npm, 'pack', '--ignore-scripts', '--json', '--pack-destination', root], sourceRoot, env));
    invariant(packed.length === 1 && packed[0].name === packageName, 'Unexpected npm pack record');
    artifact = path.join(root, packed[0].filename);
    identity = { version: packed[0].version, sha256: digest(await fs.readFile(artifact)), integrity: 'source-packed-local-bytes' };
  } else {
    const manifest = await fs.readFile(options.checksums);
    identity = verifyChecksum(await fs.readFile(artifact), path.basename(artifact), manifest.toString('utf8'),
      options['release-metadata'] ? JSON.parse(await fs.readFile(options['release-metadata'], 'utf8')) : undefined, manifest);
  }
  const install = async (tarball) => run(process.execPath, [npm, 'install', '--global', '--prefix', prefix, '--ignore-scripts', '--no-audit', '--no-fund', '--fetch-retries=0', '--fetch-timeout=20000', tarball], outside, env);
  const packageRoot = path.join(prefix, process.platform === 'win32' ? '' : 'lib', 'node_modules/@theisegoria/game-development-studio');
  const entry = path.join(packageRoot, 'dist/cli.js');
  const cli = async (args, customEnv = env, workspace = output) => {
    const envelope = JSON.parse(await run(process.execPath, [entry, ...args, '--output-dir', workspace, '--json'], outside, customEnv));
    invariant(envelope.schema === 'game_dev.result.v1' && envelope.ok, `Installed command ${args[0]} failed: ${JSON.stringify(envelope)}`);
    return envelope.data;
  };
  const verifyInstallStage = async (label, version) => {
    const workspace = path.join(root, `${label} workspace`);
    const project = path.join(root, `${label} project`);
    const stageCli = (args) => cli(args, env, workspace);
    const diagnostic = await stageCli(['doctor']);
    invariant(diagnostic.healthy && diagnostic.version === version, `${label} doctor failed`);
    await stageCli(['adapter', 'sample', '--project', project, '--confirm']);
    await stageCli(['scenario', 'plan', 'capture', '--project', project]);
    const first = await stageCli(['scenario', 'run', 'capture', '--project', project, '--confirm']);
    const second = await stageCli(['scenario', 'run', 'capture', '--project', project, '--confirm']);
    for (const result of [first, second]) {
      const verified = await stageCli(['capture', 'verify', result.runPath]);
      invariant(verified.hashesVerified && verified.closedArtifactRosterVerified, `${label} capture was not sealed`);
    }
    const compared = await stageCli(['visual', 'compare', first.runPath, second.runPath, '--threshold', '0']);
    const comparable = compared.pairs.filter(pair => pair.comparable);
    invariant(comparable.length > 0 && comparable.every(pair => pair.meanAbsoluteError === 0 && pair.changedPixelRatio === 0), `${label} repeated capture differs`);
  };
  let previous;
  if (options['previous-artifact']) {
    const previousManifest = await fs.readFile(options['previous-checksums']);
    previous = verifyChecksum(await fs.readFile(options['previous-artifact']), path.basename(options['previous-artifact']), previousManifest.toString('utf8'),
      options['previous-release-metadata'] ? JSON.parse(await fs.readFile(options['previous-release-metadata'], 'utf8')) : undefined, previousManifest);
    invariant(previous.version !== identity.version, 'Rollback evidence requires a different prior version');
    await install(options['previous-artifact']);
    invariant((await run(process.execPath, [entry, '--version'], outside, env)).includes(previous.version), 'Previous install version mismatch');
    await verifyInstallStage('previous initial', previous.version);
  }
  await install(artifact);
  const installed = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  invariant(installed.version === identity.version, 'Installed artifact version mismatch');
  const doctor = await cli(['doctor']);
  invariant(doctor.healthy && doctor.version === identity.version, 'Installed doctor failed');
  const project = path.join(root, 'sample project');
  const samplePlan = await cli(['adapter', 'sample', '--project', project]);
  invariant(samplePlan.dryRun && !await fs.stat(project).catch(() => undefined), 'Sample plan unexpectedly wrote the project');
  await cli(['adapter', 'sample', '--project', project, '--confirm']);
  const adapter = await cli(['adapter', 'inspect', '--project', project]);
  invariant(adapter.adapter.id === 'generic-sample', 'Installed sample adapter identity mismatch');
  const plan = await cli(['scenario', 'plan', 'capture', '--project', project]);
  invariant(plan.capabilities.every((item) => item === 'cpu') && plan.requiredAuthorizations.length === 1 && plan.requiredAuthorizations[0] === 'confirm', 'Free sample requested extra execution authority');
  const baseline = await cli(['scenario', 'run', 'capture', '--project', project, '--confirm']);
  const repeated = await cli(['scenario', 'run', 'capture', '--project', project, '--confirm']);
  const request = path.join(root, 'regression request.json');
  await fs.writeFile(request, JSON.stringify({ mode: 'visual-regression' }));
  await cli(['scenario', 'plan', 'capture', '--project', project, '--request', request]);
  const candidate = await cli(['scenario', 'run', 'capture', '--project', project, '--request', request, '--confirm']);
  for (const result of [baseline, repeated, candidate]) {
    const verified = await cli(['capture', 'verify', result.runPath]);
    invariant(verified.hashesVerified && verified.closedArtifactRosterVerified, 'Capture was not sealed');
    invariant(!verified.run.evidence.hardwarePerformanceEvidenceAdmitted && !verified.run.evidence.hardwareGpuExecutionProvenByHarnessAlone, 'Synthetic sample admitted hardware evidence');
  }
  const equal = await cli(['visual', 'compare', baseline.runPath, repeated.runPath, '--threshold', '0']);
  const changed = await cli(['visual', 'compare', baseline.runPath, candidate.runPath, '--threshold', '0', '--output', path.join(root, 'visual diff')]);
  const pairs = equal.pairs.filter((item) => item.comparable);
  invariant(pairs.length > 0 && pairs.every((item) => item.meanAbsoluteError === 0 && item.changedPixelRatio === 0), 'Repeated sample capture changed');
  invariant(changed.pairs.some((item) => item.comparable && item.changedPixelRatio > 0), 'Sample regression was not detected');
  // PATH discovery chooses the intended installation ahead of a simulated old
  // shim. An explicit entry remains usable when optional executables are absent.
  const bin = process.platform === 'win32' ? prefix : path.join(prefix, 'bin');
  const oldBin = path.join(root, 'old cli bin');
  await fs.mkdir(oldBin);
  const commandName = process.platform === 'win32' ? 'game-dev.cmd' : 'game-dev';
  await fs.writeFile(path.join(oldBin, commandName), process.platform === 'win32' ? '@echo stale-install\r\n' : '#!/bin/sh\necho stale-install\n', { mode: 0o700 });
  const pathEnv = { ...env, PATH: [bin, path.dirname(process.execPath), oldBin, env.PATH].join(path.delimiter) };
  // Windows .cmd cannot be execFile'd directly. Fixed --version arguments and
  // cmd's quoted program path exercise the user-facing shim without a shell
  // accepting any adapter/request input.
  let shimVersion;
  if (process.platform === 'win32') {
    const expectedLauncher = path.join(bin, commandName);
    const pathLookup = await run('where.exe', ['game-dev.cmd'], outside, pathEnv);
    assertWindowsPathLookup(pathLookup, expectedLauncher);
    const invocation = windowsShimInvocation(process.env.ComSpec ?? 'cmd.exe', expectedLauncher);
    shimVersion = await run(invocation.command, invocation.args, outside, pathEnv, invocation.options);
  } else {
    shimVersion = await run('game-dev', ['--version'], outside, pathEnv);
  }
  invariant(shimVersion.includes(identity.version) && !shimVersion.includes('stale-install'), 'PATH selected a stale installation');
  const missingToolsEnv = { ...env, PATH: path.dirname(process.execPath), BLENDER_PATH: path.join(root, 'missing Blender'), GAME_DEV_BASISU_PATH: path.join(root, 'missing Basis'), GAME_DEV_COACD_PYTHON: path.join(root, 'missing CoACD') };
  const missingToolsDoctor = await cli(['doctor'], missingToolsEnv);
  invariant(missingToolsDoctor.healthy && missingToolsDoctor.checks.filter(check => ['blender', 'basisu', 'coacd-python'].includes(check.id)).every(check => check.status === 'unavailable'), 'Missing optional tools blocked generic first run or were unexpectedly available');
  const missingToolsRun = await cli(['scenario', 'run', 'capture', '--project', project, '--confirm'], missingToolsEnv);
  const missingToolsVerification = await cli(['capture', 'verify', missingToolsRun.runPath], missingToolsEnv);
  invariant(missingToolsVerification.hashesVerified && missingToolsVerification.closedArtifactRosterVerified, 'Capture failed with missing optional tools');
  if (previous) {
    await install(options['previous-artifact']);
    await verifyInstallStage('rollback', previous.version);
    await install(artifact);
    await verifyInstallStage('reinstall', identity.version);
  }
  const report = { schema: 'game_dev.first_run_verification.v1', platform: process.platform, arch: process.arch, node: process.version, artifact: path.basename(artifact), ...identity,
    checks: ['global-prefix-install-outside-source', 'paths-with-spaces', 'doctor', 'sample-plan-no-write', 'sample-capture-three-runs', 'closed-roster-and-hash-verification', 'identical-repeat', 'known-visual-change', 'PATH-ahead-of-simulated-old-shim', 'missing-optional-tools-doctor-and-capture'],
    rollback: previous ? { from: previous.version, to: identity.version, priorSHA256: previous.sha256, priorIntegrity: previous.integrity, verified: true,
      stageChecks: 'doctor-sample-plan-two-captures-sealed-verify-equal-compare-in-fresh-workspaces' } : 'not-executed-no-prior-artifact-supplied',
    evidence: 'Real installed CLI and synthetic CPU sample; no target-engine, hardware timing, GPU, Blender, provider, signing, or human usability evidence.' };
  if (options.report) await fs.writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verifyFirstRun(optionsFromArgs(process.argv.slice(2))).then((report) => console.log(JSON.stringify(report, null, 2))).catch((error) => {
    console.error(`first-run: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
