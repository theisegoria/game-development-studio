#!/usr/bin/env node
/**
 * Install a released game-dev CLI exactly as docs/install.md describes:
 * download the tarball and SHA256SUMS.txt, require exactly one matching
 * checksum line, verify the bytes, then install with --ignore-scripts into a
 * private prefix. Any mismatch stops the job before anything executes.
 */

import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const [version, prefix] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !prefix) {
  process.stderr.write('usage: install.mjs <x.y.z> <prefix>\n');
  process.exit(2);
}
const release = `https://github.com/theisegoria/game-development-studio/releases/download/v${version}`;
const name = `theisegoria-game-development-studio-${version}.tgz`;
const download = path.join(prefix, 'download');
mkdirSync(download, { recursive: true });

async function fetchBytes(url) {
  const response = await globalThis.fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

const tarball = await fetchBytes(`${release}/${name}`);
const sums = (await fetchBytes(`${release}/SHA256SUMS.txt`)).toString('utf8');
const matches = sums.trim().split(/\r?\n/).filter((line) => line.slice(66) === name && /^[a-f0-9]{64} {2}/.test(line));
if (matches.length !== 1) throw new Error(`missing or ambiguous checksum for ${name}`);
const actual = createHash('sha256').update(tarball).digest('hex');
if (actual !== matches[0].slice(0, 64)) throw new Error(`checksum mismatch for ${name}`);
const tarballPath = path.join(download, name);
writeFileSync(tarballPath, tarball);
process.stdout.write(`verified ${name}: ${actual}\n`);

execFileSync('npm', ['install', '--global', '--prefix', prefix, '--ignore-scripts', tarballPath], { stdio: 'inherit' });
const installed = path.join(prefix, 'lib', 'node_modules', '@theisegoria', 'game-development-studio', 'package.json');
if (JSON.parse(readFileSync(installed, 'utf8')).version !== version) throw new Error('installed version differs from the requested release');
