#!/usr/bin/env node
/** Verify the published CLI release and its rollback using only fixed public GitHub assets. */
import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';
import { verifyChecksum, verifyFirstRun } from './verify-first-run.mjs';

const repository = 'theisegoria/game-development-studio';
const currentReleaseBaseline = '1.3.1';
const previousReleaseVersion = '1.2.0';
const allowedVersions = new Set([currentReleaseBaseline, previousReleaseVersion]);
const maxMetadataBytes = 1024 * 1024;
const maxManifestBytes = 1024 * 1024;
const maxArtifactBytes = 64 * 1024 * 1024;
const requestTimeoutMs = 20_000;
const maxAssetRedirects = 3;
const assetHosts = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));

function invariant(value, message) { if (!value) throw new Error(message); }

function artifactName(version) { return `theisegoria-game-development-studio-${version}.tgz`; }

function releaseApiUrl(version) { return `https://api.github.com/repos/${repository}/releases/tags/v${version}`; }

function releaseAssetUrl(version, filename) { return `https://github.com/${repository}/releases/download/v${version}/${filename}`; }

function assertAssetUrl(value, label) {
  const url = new URL(value);
  invariant(url.protocol === 'https:' && !url.username && !url.password && !url.port && assetHosts.has(url.hostname), `${label} redirected outside the fixed GitHub asset hosts`);
  return url;
}

async function readBoundedBody(response, maxBytes, label) {
  const declaredLength = response.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength) || Number(declaredLength) > maxBytes) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`${label} exceeds its byte limit`);
    }
  }
  const reader = response.body?.getReader();
  invariant(reader, `${label} has no response body`);
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`${label} exceeds its byte limit`);
      }
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, size);
}

async function fetchReleaseMetadata(version, fetcher) {
  const response = await fetcher(releaseApiUrl(version), {
    headers: { Accept: 'application/vnd.github+json' },
    redirect: 'error',
    signal: globalThis.AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new Error(`GitHub release metadata for v${version} failed: HTTP ${response.status}`);
  }
  const bytes = await readBoundedBody(response, maxMetadataBytes, `GitHub release metadata for v${version}`);
  return JSON.parse(bytes.toString('utf8'));
}

async function fetchReleaseAsset(url, maxBytes, label, fetcher) {
  const initialUrl = url;
  let current = url;
  const signal = globalThis.AbortSignal.timeout(requestTimeoutMs);
  for (let redirectCount = 0; redirectCount <= maxAssetRedirects; redirectCount += 1) {
    const parsed = assertAssetUrl(current, label);
    if (parsed.hostname === 'github.com') invariant(current === initialUrl, `${label} redirected to a different GitHub URL`);
    const response = await fetcher(current, {
      headers: { Accept: 'application/octet-stream' },
      redirect: 'manual',
      signal,
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      invariant(location, `${label} returned a redirect without a location`);
      invariant(redirectCount < maxAssetRedirects, `${label} exceeded the redirect limit`);
      current = new URL(location, current).toString();
      assertAssetUrl(current, label);
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new Error(`${label} download failed: HTTP ${response.status}`);
    }
    return readBoundedBody(response, maxBytes, label);
  }
  throw new Error(`${label} exceeded the redirect limit`);
}

/** Fetch one exact public release pair and verify its bytes against the GitHub API digest and checksum manifest. */
export async function fetchPublishedRelease(version, fetcher = globalThis.fetch) {
  invariant(allowedVersions.has(version), `Unsupported published first-run release version: ${version}`);
  const release = await fetchReleaseMetadata(version, fetcher);
  const name = artifactName(version);
  const [artifactBytes, manifestBytes] = await Promise.all([
    fetchReleaseAsset(releaseAssetUrl(version, name), maxArtifactBytes, `CLI tarball v${version}`, fetcher),
    fetchReleaseAsset(releaseAssetUrl(version, 'SHA256SUMS.txt'), maxManifestBytes, `checksum manifest v${version}`, fetcher),
  ]);
  const verification = verifyChecksum(artifactBytes, name, manifestBytes.toString('utf8'), release, manifestBytes);
  invariant(verification.integrity === 'github-release-digest-and-manifest', `Published release v${version} lacks GitHub digest verification`);
  return { version, name, artifactBytes, manifestBytes, release, verification };
}

export async function verifyPublishedFirstRun() {
  const packageJson = JSON.parse(await readFile(path.join(repositoryRoot, 'package.json'), 'utf8'));
  const currentVersion = packageJson.version;
  invariant(currentVersion === currentReleaseBaseline, `package.json release baseline must be ${currentReleaseBaseline}; found ${currentVersion}`);
  const [current, previous] = await Promise.all([
    fetchPublishedRelease(currentVersion),
    fetchPublishedRelease(previousReleaseVersion),
  ]);
  const root = await mkdtemp(path.join(os.tmpdir(), 'game dev published rollback '));
  try {
    const paths = {
      artifact: path.join(root, current.name),
      checksums: path.join(root, 'current SHA256SUMS.txt'),
      release: path.join(root, 'current release.json'),
      previousArtifact: path.join(root, previous.name),
      previousChecksums: path.join(root, 'previous SHA256SUMS.txt'),
      previousRelease: path.join(root, 'previous release.json'),
    };
    await Promise.all([
      writeFile(paths.artifact, current.artifactBytes, { flag: 'wx' }),
      writeFile(paths.checksums, current.manifestBytes, { flag: 'wx' }),
      writeFile(paths.release, JSON.stringify(current.release), { flag: 'wx' }),
      writeFile(paths.previousArtifact, previous.artifactBytes, { flag: 'wx' }),
      writeFile(paths.previousChecksums, previous.manifestBytes, { flag: 'wx' }),
      writeFile(paths.previousRelease, JSON.stringify(previous.release), { flag: 'wx' }),
    ]);
    const execution = await verifyFirstRun({
      artifact: paths.artifact,
      checksums: paths.checksums,
      'release-metadata': paths.release,
      'previous-artifact': paths.previousArtifact,
      'previous-checksums': paths.previousChecksums,
      'previous-release-metadata': paths.previousRelease,
    });
    invariant(execution.version === currentVersion && execution.integrity === 'github-release-digest-and-manifest', 'Current installed artifact did not retain published-release provenance');
    invariant(execution.rollback?.from === previousReleaseVersion && execution.rollback.to === currentVersion && execution.rollback.verified === true,
      'Published rollback did not complete all upgrade, rollback and reinstall stages');
    return {
      schema: 'game_dev.published_first_run_verification.v1',
      source: 'fixed-public-github-release-assets',
      repository,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      targetRelease: { version: current.version, sha256: current.verification.sha256, bytes: current.artifactBytes.length, integrity: current.verification.integrity },
      rollbackRelease: { version: previous.version, sha256: previous.verification.sha256, bytes: previous.artifactBytes.length, integrity: previous.verification.integrity },
      stages: ['install-1.2.0-and-verify', 'upgrade-to-1.3.1-and-verify', 'rollback-to-1.2.0-and-verify', 'reinstall-1.3.1-and-verify'],
      execution,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  verifyPublishedFirstRun().then((report) => console.log(JSON.stringify(report, null, 2))).catch((error) => {
    console.error(`published-first-run: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
