# Install Game Development Studio

This is the canonical CLI install guide for release **1.4.0**. The compiled
tarball and `SHA256SUMS.txt` are published on
[GitHub Releases](https://github.com/theisegoria/game-development-studio/releases/tag/v1.4.0).
The public npm registry package remains unpublished. Install the downloaded
tarball with npm; installing its registry name does not work. The skills/plugin
ZIP contains instructions and does not install the CLI.

You need Node.js **22.5 or newer** and npm. The tarball does not bundle Node or a
Windows EXE/MSI. Use [Node's official downloads](https://nodejs.org/en/download).
Installation and the [free sample](quickstart.md) require no compiler, provider
credentials, Blender, GPU, native macOS app, or paid service.

## POSIX: macOS and Linux

Run in a new writable download directory. The dedicated user prefix avoids
administrator access. Keep the tarball and checksum file for a later reinstall.

```sh
set -eu
node --version
npm --version
version=1.4.0
release="https://github.com/theisegoria/game-development-studio/releases/download/v$version"
package="theisegoria-game-development-studio-$version.tgz"
curl --fail --location "$release/$package" --output "$package"
curl --fail --location "$release/SHA256SUMS.txt" --output SHA256SUMS.txt
node --input-type=module - "$package" <<'NODE'
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const name = process.argv[2];
const records = readFileSync('SHA256SUMS.txt', 'utf8').trim().split(/\r?\n/);
const matches = records.filter(line => line.slice(66) === name && /^[a-f0-9]{64}  /.test(line));
if (matches.length !== 1) throw new Error('Missing or ambiguous package checksum');
const actual = createHash('sha256').update(readFileSync(name)).digest('hex');
if (actual !== matches[0].slice(0, 64)) throw new Error('Package checksum mismatch');
console.log(`Verified ${name}: ${actual}`);
NODE
cli_prefix="$HOME/.local/share/GameDevelopmentStudio/cli"
npm install --global --prefix "$cli_prefix" --ignore-scripts "$(pwd)/$package"
export PATH="$cli_prefix/bin:$PATH"
command -v game-dev
game-dev --version
game-dev doctor --json
```

Stop if any command fails. For future terminal sessions, add the `export PATH`
line with the full chosen prefix to your shell's profile and restart the
terminal or agent that calls the CLI. For GUI/Finder processes, use an explicit
CLI path or generated MCP configuration; a shell profile is not guaranteed to
be inherited.

## Windows: PowerShell

Open a fresh PowerShell window after installing Node. Run in a new writable
download directory. `.cmd` launchers work under restrictive PowerShell execution
policies without changing the policy or using an administrator shell.

```powershell
$ErrorActionPreference = 'Stop'
node --version
npm.cmd --version
$version = '1.4.0'
$release = "https://github.com/theisegoria/game-development-studio/releases/download/v$version"
$package = "theisegoria-game-development-studio-$version.tgz"
Invoke-WebRequest "$release/$package" -OutFile $package
Invoke-WebRequest "$release/SHA256SUMS.txt" -OutFile SHA256SUMS.txt
$record = @(Get-Content SHA256SUMS.txt | Where-Object { $_ -match ('^[a-f0-9]{64}  ' + [regex]::Escape($package) + '$') })
if ($record.Count -ne 1) { throw 'Missing or ambiguous package checksum' }
$expected = $record[0].Substring(0, 64)
if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ne $expected) { throw 'Package checksum mismatch' }
$cliPrefix = Join-Path $env:LOCALAPPDATA 'GameDevelopmentStudio\cli'
$tarball = (Resolve-Path -LiteralPath $package).Path
npm.cmd install --global --prefix "$cliPrefix" --ignore-scripts "$tarball"
if ($LASTEXITCODE -ne 0) { throw 'CLI install failed' }
$env:Path = "$cliPrefix;$env:Path"
Get-Command game-dev.cmd
game-dev.cmd --version
if ($LASTEXITCODE -ne 0) { throw 'CLI startup failed' }
game-dev.cmd doctor --json
if ($LASTEXITCODE -ne 0) { throw 'CLI doctor failed' }
```

Windows places npm's global launchers directly in the prefix. To persist PATH,
open **Edit environment variables for your account**, add the full `$cliPrefix`
value to your user **Path**, preserving other entries, and restart PowerShell
and the invoking app. See [Windows troubleshooting](windows-install.md).

## What the checksum proves

The checksum identifies the downloaded release tarball and rejects corruption
or a different file. It is not an Authenticode signature, Developer ID signature,
or independent proof that a publisher account is uncompromised. The install
fetches runtime dependencies from npm under the artifact's declared ranges;
keeping the tarball alone does not freeze transitive dependency resolution.

For release engineering, `scripts/verify-first-run.mjs --artifact ...
--checksums ... --release-metadata ...` also binds tarball and checksum bytes to
the release API's SHA-256 digests, sizes, URLs and release identity. That is a
separate exact release check from the CI check that packs the current source.

## First free workflow

Continue with [Your first capture](quickstart.md). `doctor` can list unavailable
optional providers, tools and skills while the free workflow remains available.
If Node or SQLite fails, fix that required dependency before proceeding.

## Find the intended install

If a command reports an old version, inspect every launcher. On POSIX use
`type -a game-dev`; on Windows use `Get-Command game-dev -All` and
`where.exe game-dev`. Check your PATH order, then restart the invoking process.
An explicit launcher bypasses PATH selection:

```sh
"$cli_prefix/bin/game-dev" --version
```

```powershell
& (Join-Path $cliPrefix 'game-dev.cmd') --version
```

When the launcher works but a GUI cannot find it, generate MCP config using
the installed CLI and an absolute output directory: `game-dev mcp config
--client generic --output-dir /absolute/workspace`. Choose your actual client
when supported. Review the printed configuration before installing it.

## Manual update and rollback

1. Record the current version, launcher path and workspace path. Preserve the
   previous CLI tarball and its release's checksum manifest. Keep user assets
   and workspace metadata; installing a CLI must not purge them.
2. Choose a release on GitHub, then repeat download and verification using that
   release's version, artifact and manifest. Install into the same dedicated
   prefix only after verification succeeds.
3. Run the explicit launcher with `--version`, then `doctor`, and complete the
   free sample in a **new** project and workspace. Inspect failures before using
   the new CLI on production assets. Update and rollback remain manual.
4. To roll back the executable, verify the previous artifact against its own
   manifest and repeat `npm install --global --prefix ... --ignore-scripts
   ABSOLUTE_PREVIOUS_TARBALL`. Confirm the explicit launcher reports the previous
   version and rerun the sample. A CLI rollback does not reverse workspace
   migrations; restore a preserved workspace when an older CLI cannot read
   newer metadata.

The existing `game-dev tool call plan_release_change --request FILE --json`
command reviews artifact identity and update/rollback compatibility before
installation. A request uses this shape, replacing both versions and paths with
your actual releases; `verifyGitHub: true` reads public GitHub release metadata:

```json
{
  "installedVersion": "PRIOR_VERSION",
  "targetVersion": "1.4.0",
  "artifact": "/absolute/theisegoria-game-development-studio-1.4.0.tgz",
  "checksums": "/absolute/current/SHA256SUMS.txt",
  "rollbackArtifact": "/absolute/PRIOR_CLI_TARBALL.tgz",
  "rollbackChecksums": "/absolute/prior/SHA256SUMS.txt",
  "verifyGitHub": true
}
```

This produces a reviewed plan and does not perform unattended updates.

## Source alternative and contributor checks

Build a new checkout when testing unreleased fixes. Record `git rev-parse HEAD`;
the resulting tarball represents that revision and local changes, not the
published GitHub release.

```sh
set -eu
git clone https://github.com/theisegoria/game-development-studio.git
cd game-development-studio
npm ci
npm run build
node dist/cli.js --version
npm run verify:docs
npm run verify:first-run
```

In PowerShell use `npm.cmd` for npm commands. The first-run verifier packs
the already-built source, installs it into a disposable prefix outside the
checkout, and exercises the compiler-free route. It includes spaces, PATH
precedence over a simulated old shim and missing optional tools. It contacts npm
for dependencies, never providers. Its JSON states the artifact digest,
platform and evidence limit. The six source first-run lanes passed on
Windows/Linux/macOS with Node 22 and 24. Exact release artifact checks remain
a separate publication gate.

## Support

Record the failed step, CLI/Node/npm versions, launcher path, OS and architecture,
release version or source revision, artifact SHA-256, exit code and redacted
output. Preview
`game-dev support report --workflow generic-capture --json`, review its redacted
contents, then save with `--output NEWFILE --confirm`. Do not send automatically.
Never attach credentials, project assets or unreviewed raw logs. Use the
[installation issue form](https://github.com/theisegoria/game-development-studio/issues/new?template=installation.yml).

See [distribution readiness](distribution-roadmap.md) for channels and the exact
tested/missing ledger.
