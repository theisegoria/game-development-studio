#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function readReleaseConfig() {
  const value = JSON.parse(readFileSync(path.join(root, 'docs/release.json'), 'utf8'));
  if (value.schema !== 'game_dev.release.v1') throw new Error('Unsupported release descriptor');
  for (const key of ['appVersion', 'cliVersion', 'skillsVersion', 'nodeVersion']) {
    if (!/^\d+\.\d+\.\d+$/.test(value[key])) throw new Error(`Invalid release ${key}`);
  }
  if (!/^\d+$/.test(value.appBuild) || !/^\d+\.\d+$/.test(value.minimumMacOSVersion) || value.architecture !== 'arm64') throw new Error('Invalid native release identity');
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  if (pkg.version !== value.cliVersion) throw new Error('CLI package differs from release descriptor');
  const plugin = JSON.parse(readFileSync(path.join(root, '.codex-plugin/plugin.json'), 'utf8'));
  if (plugin.version !== value.skillsVersion) throw new Error('Skills plugin differs from release descriptor');
  const legalPath = path.join(root, 'distribution/macos-app-repo/THIRD_PARTY_PROVENANCE.json');
  if (existsSync(legalPath)) {
    const provenance = JSON.parse(readFileSync(legalPath, 'utf8'));
    if (provenance.release.appVersion !== value.appVersion || provenance.bundledRuntime.gameDevCli.version !== value.cliVersion
        || provenance.bundledRuntime.node.version.replace(/^v/, '') !== value.nodeVersion) {
      throw new Error('Native legal provenance differs from release descriptor');
    }
  }
  return value;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = readReleaseConfig();
  const field = process.argv[2];
  if (field && !Object.hasOwn(config, field)) throw new Error('Unknown release field');
  process.stdout.write(field ? `${config[field]}\n` : `${JSON.stringify(config)}\n`);
}
