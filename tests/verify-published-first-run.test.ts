import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { expect, it, vi } from 'vitest';

const repository = 'theisegoria/game-development-studio';
const verifier = new URL('../scripts/verify-published-first-run.mjs', import.meta.url).href;
const firstRunVerifier = new URL('../scripts/verify-first-run.mjs', import.meta.url).href;
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function releaseFixture(version: string) {
  const name = `theisegoria-game-development-studio-${version}.tgz`;
  const artifactBytes = Buffer.from(`fixture bytes for ${version}; never installed`);
  const manifestBytes = Buffer.from(`${sha256(artifactBytes)}  ${name}\n`);
  const release = {
    tag_name: `v${version}`,
    html_url: `https://github.com/${repository}/releases/tag/v${version}`,
    draft: false,
    prerelease: false,
    assets: [
      { name, size: artifactBytes.length, digest: `sha256:${sha256(artifactBytes)}`, browser_download_url: `https://github.com/${repository}/releases/download/v${version}/${name}` },
      { name: 'SHA256SUMS.txt', size: manifestBytes.length, digest: `sha256:${sha256(manifestBytes)}`, browser_download_url: `https://github.com/${repository}/releases/download/v${version}/SHA256SUMS.txt` },
    ],
  };
  return { version, name, artifactBytes, manifestBytes, release };
}

function fixtureFetcher(fixtures: Awaited<ReturnType<typeof releaseFixture>>[], override?: (url: string) => Response | undefined) {
  const assets = new Map<string, Buffer>();
  for (const fixture of fixtures) {
    assets.set(`https://github.com/${repository}/releases/download/v${fixture.version}/${fixture.name}`, fixture.artifactBytes);
    assets.set(`https://github.com/${repository}/releases/download/v${fixture.version}/SHA256SUMS.txt`, fixture.manifestBytes);
  }
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
    const url = String(input);
    calls.push({ url, init });
    const overridden = override?.(url);
    if (overridden) return overridden;
    const release = fixtures.find((fixture) => url === `https://api.github.com/repos/${repository}/releases/tags/v${fixture.version}`);
    if (release) return new Response(JSON.stringify(release.release), { headers: { 'content-type': 'application/json' } });
    const bytes = assets.get(url);
    if (bytes) return new Response(bytes);
    throw new Error(`Unexpected fetch URL: ${url}`);
  });
  return { fetcher, calls };
}

it('loads only the exact public CLI and manifest URLs and verifies each release digest', async () => {
  const current = await releaseFixture('1.3.1');
  const previous = await releaseFixture('1.2.0');
  const { fetcher, calls } = fixtureFetcher([current, previous]);
  const { fetchPublishedRelease } = await import(verifier);

  const currentResult = await fetchPublishedRelease('1.3.1', fetcher);
  const previousResult = await fetchPublishedRelease('1.2.0', fetcher);

  expect(currentResult.verification).toMatchObject({ version: '1.3.1', sha256: sha256(current.artifactBytes), integrity: 'github-release-digest-and-manifest' });
  expect(previousResult.verification).toMatchObject({ version: '1.2.0', sha256: sha256(previous.artifactBytes), integrity: 'github-release-digest-and-manifest' });
  expect(calls.map((call) => call.url)).toEqual([
    `https://api.github.com/repos/${repository}/releases/tags/v1.3.1`,
    `https://github.com/${repository}/releases/download/v1.3.1/${current.name}`,
    `https://github.com/${repository}/releases/download/v1.3.1/SHA256SUMS.txt`,
    `https://api.github.com/repos/${repository}/releases/tags/v1.2.0`,
    `https://github.com/${repository}/releases/download/v1.2.0/${previous.name}`,
    `https://github.com/${repository}/releases/download/v1.2.0/SHA256SUMS.txt`,
  ]);
  expect(calls[0]?.init).toMatchObject({ redirect: 'error' });
  expect(calls.filter((call) => call.url.includes('/releases/download/')).every((call) => call.init?.redirect === 'manual')).toBe(true);
  await expect(fetchPublishedRelease('1.3.2', fetcher)).rejects.toThrow('Unsupported published first-run release version');
});

it('rejects a release whose API digest disagrees with the downloaded bytes', async () => {
  const fixture = await releaseFixture('1.3.1');
  fixture.release.assets[0]!.digest = `sha256:${'0'.repeat(64)}`;
  const { fetcher } = fixtureFetcher([fixture]);
  const { fetchPublishedRelease } = await import(verifier);
  await expect(fetchPublishedRelease('1.3.1', fetcher)).rejects.toThrow('declared asset digest');
});

it('rejects an asset redirect outside the fixed GitHub asset hosts without requesting it', async () => {
  const fixture = await releaseFixture('1.3.1');
  const { fetcher, calls } = fixtureFetcher([fixture], (url) => url.endsWith(`/${fixture.name}`)
    ? new Response(null, { status: 302, headers: { location: 'https://attacker.example/asset.tgz' } })
    : undefined);
  const { fetchPublishedRelease } = await import(verifier);
  await expect(fetchPublishedRelease('1.3.1', fetcher)).rejects.toThrow('fixed GitHub asset hosts');
  expect(calls.some((call) => call.url.startsWith('https://attacker.example/'))).toBe(false);
});

it('sends the supplied token only to metadata and follows the asset CDN anonymously', async () => {
  const fixture = await releaseFixture('1.3.1');
  const cdnUrl = 'https://release-assets.githubusercontent.com/github-production-release-asset/fixture?token=redacted';
  const apiToken = 'fixture-token-never-log';
  const { fetcher, calls } = fixtureFetcher([fixture], (url) => {
    if (url.endsWith(`/${fixture.name}`)) return new Response(null, { status: 302, headers: { location: cdnUrl } });
    if (url === cdnUrl) return new Response(fixture.artifactBytes);
    return undefined;
  });
  const { fetchPublishedRelease } = await import(verifier);
  const result = await fetchPublishedRelease('1.3.1', fetcher, apiToken);
  expect(result).toMatchObject({
    verification: { version: '1.3.1', integrity: 'github-release-digest-and-manifest' },
  });
  expect(calls.map((call) => new URL(call.url).hostname)).toContain('release-assets.githubusercontent.com');
  const metadataCalls = calls.filter((call) => new URL(call.url).hostname === 'api.github.com');
  const assetCalls = calls.filter((call) => new URL(call.url).hostname !== 'api.github.com');
  expect(metadataCalls).toHaveLength(1);
  expect(metadataCalls[0]?.init?.headers).toEqual({ Accept: 'application/vnd.github+json', Authorization: `Bearer ${apiToken}` });
  expect(assetCalls.every((call) => !new Headers(call.init?.headers).has('authorization'))).toBe(true);
  expect(JSON.stringify(result)).not.toContain(apiToken);
});

it('strips GitHub release tokens from the npm and CLI child environment', async () => {
  const { firstRunChildEnvironment } = await import(firstRunVerifier);
  const env = firstRunChildEnvironment('/tmp/published first run', {
    PATH: '/system/path',
    GDS_RELEASE_API_TOKEN: 'release-api-token',
    GH_TOKEN: 'gh-token',
    GITHUB_TOKEN: 'github-token',
  });
  expect(env).toMatchObject({ PATH: '/system/path' });
  expect(env).not.toHaveProperty('GDS_RELEASE_API_TOKEN');
  expect(env).not.toHaveProperty('GH_TOKEN');
  expect(env).not.toHaveProperty('GITHUB_TOKEN');
});

it('reports only numeric rate-limit headers for API failures and cancels the response body', async () => {
  const fixture = await releaseFixture('1.3.1');
  const response = new Response('private response body must not be included', {
    status: 403,
    headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '12345' },
  });
  const { fetcher } = fixtureFetcher([fixture], (url) => url.includes('/releases/tags/') ? response : undefined);
  const { fetchPublishedRelease } = await import(verifier);
  const failure = fetchPublishedRelease('1.3.1', fetcher, 'fixture-token');
  await expect(failure).rejects.toThrow('HTTP 403 (rate limit remaining=0, rate limit reset=12345)');
  expect(response.bodyUsed).toBe(true);
  await expect(failure).rejects.not.toThrow('private response body');
});

it('bounds release metadata reads before parsing JSON', async () => {
  const { fetcher } = fixtureFetcher([], (url) => url.endsWith('/releases/tags/v1.3.1')
    ? new Response('x'.repeat(1024 * 1024 + 1))
    : undefined);
  const { fetchPublishedRelease } = await import(verifier);
  await expect(fetchPublishedRelease('1.3.1', fetcher)).rejects.toThrow('exceeds its byte limit');
});

it('rejects a declared release tarball size above the download bound', async () => {
  const fixture = await releaseFixture('1.3.1');
  const { fetcher } = fixtureFetcher([fixture], (url) => url.endsWith(`/${fixture.name}`)
    ? new Response(null, { headers: { 'content-length': String(64 * 1024 * 1024 + 1) } })
    : undefined);
  const { fetchPublishedRelease } = await import(verifier);
  await expect(fetchPublishedRelease('1.3.1', fetcher)).rejects.toThrow('exceeds its byte limit');
});
