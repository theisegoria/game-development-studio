import { promises as fs } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { hashFile } from '../workspace/retention.js';

const repository = 'theisegoria/game-development-studio';
const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/);
const githubReleaseSchema = z.object({ tag_name: z.string(), html_url: z.string().url(), draft: z.boolean(), prerelease: z.boolean(), assets: z.array(z.object({ name: z.string(), browser_download_url: z.string().url(), size: z.number().int().nonnegative(), digest: z.string().nullable().optional() })) });
export type ReleaseDistribution = 'cli' | 'skills' | 'anvil-macos-arm64';
export interface ReleaseEvidence { version: string; releaseUrl: string; artifact: string; artifactUrl: string; sha256: string; bytes: number; checksumFile: string; verification: 'local-checksum' | 'github-release-digest'; distribution?: ReleaseDistribution; }

function distributionFor(name: string, version: string): ReleaseDistribution {
  if (name === `theisegoria-game-development-studio-${version}.tgz`) return 'cli';
  if (name === `game-development-studio-plugin-${version}.zip`) return 'skills';
  if (name === `Anvil-${version}-macos-arm64.zip`) return 'anvil-macos-arm64';
  throw new Error('Artifact name does not match the expected release version and supported GitHub artifact');
}

/** Verify the published digest against local bytes without unpacking or executing the artifact. */
export async function verifyReleaseArtifact(options: { version: string; artifact: string; checksums: string; githubRelease?: unknown }): Promise<ReleaseEvidence> {
  const version = versionSchema.parse(options.version);
  const name = path.basename(options.artifact);
  const distribution = distributionFor(name, version);
  if ((await fs.lstat(options.artifact)).isSymbolicLink()) throw new Error('Release artifact cannot be a symlink');
  if ((await fs.stat(options.checksums)).size > 1024 * 1024) throw new Error('Checksum file exceeds safety limit');
  const lines = (await fs.readFile(options.checksums, 'utf8')).trim().split(/\r?\n/);
  const records = new Map<string,string>();
  for (const line of lines) {
    const match = /^([a-f0-9]{64}) [ *]([A-Za-z0-9._-]+)$/.exec(line);
    if (!match?.[1] || !match[2] || records.has(match[2])) throw new Error('Malformed or duplicate checksum record');
    records.set(match[2], match[1]);
  }
  const sha256 = await hashFile(options.artifact), bytes = (await fs.stat(options.artifact)).size;
  if (records.get(name) !== sha256) throw new Error('Release artifact checksum mismatch or missing checksum');
  const releaseUrl = `https://github.com/${repository}/releases/tag/v${version}`;
  const artifactUrl = `https://github.com/${repository}/releases/download/v${version}/${name}`;
  let verification: ReleaseEvidence['verification'] = 'local-checksum';
  if (options.githubRelease !== undefined) {
    const release = githubReleaseSchema.parse(options.githubRelease);
    if (release.tag_name !== `v${version}` || release.html_url !== releaseUrl || release.draft || release.prerelease) throw new Error('GitHub release identity is not the expected stable public release');
    const matches = release.assets.filter(a => a.name === name);
    const asset = matches[0];
    if (matches.length !== 1 || !asset || asset.browser_download_url !== artifactUrl || asset.size !== bytes || asset.digest !== `sha256:${sha256}`) throw new Error('GitHub release digest does not match artifact bytes');
    verification = 'github-release-digest';
  }
  return { version, releaseUrl, artifact: path.resolve(options.artifact), artifactUrl, sha256, bytes, checksumFile: path.resolve(options.checksums), verification, distribution };
}

/** Fixed origin/repository and bounded response; never fetch arbitrary caller URLs. */
export async function fetchReleaseMetadata(version: string, fetcher: typeof fetch = fetch): Promise<unknown> {
  versionSchema.parse(version);
  const response = await fetcher(`https://api.github.com/repos/${repository}/releases/tags/v${version}`, { headers: { Accept: 'application/vnd.github+json' }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`GitHub release metadata failed: HTTP ${response.status}`);
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing GitHub response');
  const chunks: Uint8Array[] = []; let size = 0;
  try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 1024 * 1024) throw new Error('GitHub metadata exceeds safety bound'); chunks.push(value); } }
  finally { await reader.cancel(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function planReleaseChange(options: { installedVersion: string; targetVersion: string; artifact: string; checksums: string; rollbackArtifact: string; rollbackChecksums: string; targetRelease?: unknown; rollbackRelease?: unknown }) {
  versionSchema.parse(options.installedVersion);
  const target = await verifyReleaseArtifact({ version: options.targetVersion, artifact: options.artifact, checksums: options.checksums, githubRelease: options.targetRelease });
  const rollback = await verifyReleaseArtifact({ version: options.installedVersion, artifact: options.rollbackArtifact, checksums: options.rollbackChecksums, githubRelease: options.rollbackRelease });
  if (target.distribution !== rollback.distribution) throw new Error('Target and rollback must be the same distribution type');
  const compare = (a: string, b: string) => { const left=a.split('.').map(Number), right=b.split('.').map(Number); for (let i=0;i<3;i++) { const delta=left[i]!-right[i]!; if (delta) return Math.sign(delta); } return 0; };
  const direction = compare(target.version, rollback.version);
  const verified = target.verification === 'github-release-digest' && rollback.verification === 'github-release-digest';
  return {
    schema: 'game_dev.release_change_plan.v1', repository, direction: direction > 0 ? 'upgrade' : direction < 0 ? 'rollback' : 'reinstall', target, rollback,
    readyForManualInstall: verified,
    blockers: verified ? [] : ['Local checksum agreement is not GitHub provenance. Fetch and verify both stable release asset digests before installation.'],
    steps: target.distribution === 'anvil-macos-arm64' ? [
      'Confirm this is an Apple Silicon Mac running macOS 26 or later. This archive is ad-hoc signed and is not notarized; a GitHub digest does not establish Developer ID trust.',
      'Keep the current app and workspace backup. Extract the verified target archive into a new user-chosen folder; do not overwrite a running app.',
      'Follow the archive README to verify the bundled CLI version, doctor and capabilities against a temporary workspace before switching apps. Stop if system security policy does not permit this non-notarized build.',
      'Switch to the new app only after these checks pass; retain the same-distribution rollback archive and previous app. No installation or application launch has occurred while creating this plan.',
    ] : target.distribution === 'skills' ? [
      'Keep the current plugin directory and its user-managed selection until the replacement is checked.',
      'Extract the verified skills ZIP into a new user-chosen folder. Check its plugin manifest version and skill inventory against the release documentation; this archive does not contain the CLI runtime.',
      'Use the documented plugin selection flow only after the matching CLI and plugin checks pass. If they fail, retain or select the previous verified plugin directory.',
      'Do not change a CLI launcher as part of this skills-only plan. No profile or plugin selection has been changed while creating it.',
    ] : [
      'Keep the current installation and workspace backup until the replacement passes doctor and capabilities checks.',
      'Stage the verified target artifact into a new user-chosen installation folder using the existing GitHub release installation instructions. Do not overwrite the running installation.',
      'Verify game-dev --version matches the target and run game-dev doctor --json and game-dev capabilities --json against a temporary workspace.',
      'Switch the user-managed launcher only after checks pass. If they fail, retain or switch back to the verified rollback artifact.',
    ],
    evidenceCeiling: 'This is a verified artifact and rollback plan; no install, launcher/profile change, signature/notarization verification, provider authentication, Blender process or GPU operation has occurred. GitHub digest agreement trusts the HTTPS GitHub release API and is not a signing guarantee.',
  };
}
