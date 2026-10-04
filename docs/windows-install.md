# Windows CLI installation and troubleshooting

Use the [canonical install guide](install.md#windows-powershell) for the current
**1.3.1** GitHub tarball, checksum verification and PowerShell commands. The npm
registry package is unpublished. Node 22.5+ is installed separately; no Windows
EXE/MSI or Authenticode signature is supplied. The skills/plugin ZIP does not
contain the CLI. Runtime dependencies are downloaded from npm during install.

Use `npm.cmd` and `game-dev.cmd` when PowerShell selects a blocked `.ps1` shim.
No administrator shell or execution-policy change is required. The dedicated
user prefix may contain spaces. npm puts Windows global shims in that prefix,
without a `bin` subdirectory.

## Missing or old command

```powershell
node --version
npm.cmd --version
$cliPrefix = Join-Path $env:LOCALAPPDATA 'GameDevelopmentStudio\cli'
& (Join-Path $cliPrefix 'game-dev.cmd') --version
Get-Command game-dev -All
where.exe game-dev
$env:Path = "$cliPrefix;$env:Path"
game-dev.cmd doctor --json
```

If the explicit launcher works, correct user PATH and restart PowerShell and
the invoking app; rebuilding does not fix an inherited PATH. Preserve existing
PATH entries. If the explicit launcher says Node is missing, repair Node's PATH
first. If the bare command finds an old install, put the intended prefix first.
Record both paths and versions before changing anything.

## Sample workflow support

Published 1.3.1 can install and run CLI startup checks on Windows. Its generic
sample directly executes a `.mjs` file, which is unsupported by Windows process
creation. The source checkpoint uses an explicit Node interpreter for this
sample. Run [Your first capture](quickstart.md#powershell-source-builds-with-the-node-sample-fix)
from a source build containing that fix until a verified new release ships.
Prepared Windows Node 22/24 CI gates exercise the installed tarball's first-run
flow; prepared CI is not a recorded Windows pass.

## Source build

Use a new writable checkout. Node, npm and Git are required; provider credentials
and C compilers are not. Record the revision and preserve the local tarball.

```powershell
git clone https://github.com/theisegoria/game-development-studio.git
if ($LASTEXITCODE -ne 0) { throw 'Clone failed' }
Set-Location game-development-studio
git rev-parse HEAD
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency install/build failed' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
node .\dist\cli.js --version
if ($LASTEXITCODE -ne 0) { throw 'Source CLI startup failed' }
$packJson = npm.cmd pack --ignore-scripts --json
if ($LASTEXITCODE -ne 0) { throw 'Pack failed' }
$pack = @($packJson | ConvertFrom-Json)[0]
$tarball = (Resolve-Path -LiteralPath $pack.filename).Path
Get-FileHash -LiteralPath $tarball -Algorithm SHA256
$cliPrefix = Join-Path $env:LOCALAPPDATA 'GameDevelopmentStudio\cli'
npm.cmd install --global --prefix "$cliPrefix" --ignore-scripts "$tarball"
if ($LASTEXITCODE -ne 0) { throw 'Install failed' }
& (Join-Path $cliPrefix 'game-dev.cmd') --version
if ($LASTEXITCODE -ne 0) { throw 'Installed CLI startup failed' }
npm.cmd run verify:docs
if ($LASTEXITCODE -ne 0) { throw 'Documentation check failed' }
npm.cmd run verify:first-run
if ($LASTEXITCODE -ne 0) { throw 'First-run check failed' }
```

A locally computed hash records your bytes; it is not an official release
checksum. `--ignore-scripts` is for the compiled artifact install/pack, not for
the source's `npm ci`. Keep the source revision and lockfile with any test report.

## Update, rollback and help

Follow the canonical guide's [manual update and rollback](install.md#manual-update-and-rollback)
steps. Verify each tarball against its own release manifest and preserve a
separate workspace before using an older CLI on newer metadata. Never compare
a plugin ZIP checksum to a CLI tarball.

For a failed install, the [installation issue form](https://github.com/theisegoria/game-development-studio/issues/new?template=installation.yml)
accepts the failed command and exit code, OS/architecture, Node/npm versions,
artifact checksum and command discovery without requiring a working CLI.
After startup, use the [reviewed support report](install.md#support) in builds
containing the diagnostic checkpoint. Remove credentials and private paths
before sending any additional logs.
