#!/usr/bin/env node
/** Reject current install/release claims drifting away from package.json. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { URL, fileURLToPath, pathToFileURL } from 'node:url';

const sourceRoot = fileURLToPath(new URL('..', import.meta.url));
const installFiles = ['README.md', 'docs/install.md', 'docs/quickstart.md', 'docs/windows-install.md', 'docs/distribution-roadmap.md', 'distribution/skills-repo/README.md'];
function invariant(value, message) { if (!value) throw new Error(message); }

export async function checkInstallDocs(root = sourceRoot) {
  const { version, engines } = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  invariant(/^\d+\.\d+\.\d+$/.test(version), 'Unexpected package version');
  const contents = new Map(await Promise.all(installFiles.map(async (file) => [file, await fs.readFile(path.join(root, file), 'utf8')])));
  for (const [file, content] of contents) {
    for (const match of content.matchAll(/(?:releases\/(?:tag|download)\/v|theisegoria-game-development-studio-)(\d+\.\d+\.\d+)/g)) {
      invariant(match[1] === version, `${file}: current install link references ${match[1]}, package is ${version}`);
    }
    invariant(!/npm(?:\.cmd)?\s+(?:i|install)\s+(?:(?:--global|-g)\s+)?@theisegoria\/game-development-studio\b/.test(content), `${file}: unpublished registry-name installation advertised`);
  }
  const canonical = contents.get('docs/install.md');
  invariant(canonical.includes(`release **${version}**`) && canonical.includes(`version=${version}`) && canonical.includes(`$version = '${version}'`), 'Canonical POSIX/PowerShell release versions drifted');
  invariant(engines.node === '>=22.5' && canonical.includes('22.5'), 'Node requirement drifted');
  for (const file of ['README.md', 'docs/quickstart.md', 'docs/windows-install.md']) invariant(contents.get(file).includes('install.md'), `${file}: canonical install guide link missing`);
  const quickstart = contents.get('docs/quickstart.md');
  invariant(quickstart.includes('adapter sample') && quickstart.includes('scenario plan capture') && quickstart.includes('capture verify') && quickstart.includes('visual compare'), 'Free quickstart workflow incomplete');
  invariant(!/\bcc -|<\(echo|probe install/.test(quickstart), 'Free quickstart regained compiler or POSIX-only request dependency');
  invariant(quickstart.includes('advanced-c-probe.md') && quickstart.includes('game-dev.cmd'), 'Advanced/Windows workflow link missing');
  return { schema: 'game_dev.install_docs_verification.v1', version, files: installFiles.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  checkInstallDocs().then((result) => console.log(JSON.stringify(result))).catch((error) => {
    console.error(`install-docs: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
