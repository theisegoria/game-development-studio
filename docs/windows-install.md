# Windows CLI installation (PowerShell)

## Distribution status

The CLI source is public. Release 1.1.0 distributes a compiled JavaScript npm
package through [GitHub Releases](https://github.com/theisegoria/game-development-studio/releases/tag/v1.1.0),
with a SHA-256 manifest. It requires Node.js 22.5 or newer; it does not include
Node or a standalone Windows EXE/MSI. The public npm registry package
`@theisegoria/game-development-studio` remains unpublished. There is no Windows
Authenticode signature or installer to verify. The skills/plugin ZIP contains
instructions only, not the CLI.

## Install the release tarball

Install Node.js 22.5+ from [nodejs.org](https://nodejs.org/en/download) and open
a fresh PowerShell window. In a new writable download directory, run:

```powershell
node --version
npm.cmd --version
$release = 'https://github.com/theisegoria/game-development-studio/releases/download/v1.1.0'
$package = 'theisegoria-game-development-studio-1.1.0.tgz'
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
game-dev.cmd --version
game-dev.cmd capabilities --json
game-dev.cmd doctor --json
```

The SHA-256 manifest identifies the package attached to this GitHub release;
it is not an Authenticode signature. Runtime dependencies are fetched from npm
under the package's declared ranges. Use the PATH section below for future
sessions and local agents. `npm.cmd`/`game-dev.cmd` avoid PowerShell selecting
`.ps1` launchers under restrictive execution policies; no policy change or
administrator shell is needed.

## Source-build alternative

The source route below is available now. Windows installation smoke checks pass
on Node 22 and 24; this does not imply every workflow has been validated on
Windows. The independent Windows directory-fsync failure in `package build`
was fixed on `main` by [PR #5](https://github.com/theisegoria/game-development-studio/pull/5)
(merged commit `5c24675730f24389824fd900b402154729355a58`). A new checkout below
includes that fix; older source checkouts or locally built tarballs may not.

## 1. Build the public source

Install Node.js (22.5 or newer) from [nodejs.org](https://nodejs.org/en/download)
and Git from [git-scm.com](https://git-scm.com/downloads/win), then open a fresh
PowerShell window. Use a new checkout directory you can write to. These commands
need network access for GitHub and npm dependencies, but no provider credentials.
`npm.cmd` avoids PowerShell selecting `npm.ps1` under a restrictive execution
policy; no execution-policy change or administrator shell is needed.

```powershell
node --version
npm.cmd --version
git --version
git clone https://github.com/theisegoria/game-development-studio.git
if ($LASTEXITCODE -ne 0) { throw 'Clone failed' }
Set-Location game-development-studio
git rev-parse HEAD # Record this revision for a reproducible support report.
npm.cmd ci
if ($LASTEXITCODE -ne 0) { throw 'Dependency install/build failed' }
npm.cmd run build
if ($LASTEXITCODE -ne 0) { throw 'Build failed' }
node .\dist\cli.js --version
if ($LASTEXITCODE -ne 0) { throw 'CLI startup failed' }
```

This builds the checked-out `main` revision, not a downloaded Windows release.
Check that the reported CLI version meets the skills' requirement (1.0.2+).
You can already run `node .\dist\cli.js capabilities --json` and
`node .\dist\cli.js doctor --json` from this directory without a global command.

## 2. Install a locally built tarball

Still in the checkout, pack the already-built files and install into a dedicated
user directory. This installs the `game-dev.cmd` launcher without publishing
anything or depending on a published package of this name. Runtime dependencies
are fetched from npm. Keep the tarball if you need to reinstall these exact
package bytes; transitive dependency resolution may still change.

```powershell
$packJson = npm.cmd pack --ignore-scripts --json
if ($LASTEXITCODE -ne 0) { throw 'Pack failed' }
$pack = @($packJson | ConvertFrom-Json)[0]
$tarball = (Resolve-Path -LiteralPath $pack.filename).Path
Get-FileHash -LiteralPath $tarball -Algorithm SHA256
$cliPrefix = Join-Path $env:LOCALAPPDATA 'GameDevelopmentStudio\cli'
npm.cmd install --global --prefix "$cliPrefix" --ignore-scripts "$tarball"
if ($LASTEXITCODE -ne 0) { throw 'CLI install failed' }
& (Join-Path $cliPrefix 'game-dev.cmd') --version
if ($LASTEXITCODE -ne 0) { throw 'Installed CLI startup failed' }
```

`--ignore-scripts` is used for packing/installing the compiled artifact, not for
`npm ci` above. A locally calculated SHA-256 identifies your tarball; it is **not**
an official publisher checksum or proof of authenticity. No expected digest or
Authenticode signature is advertised for this locally built package. Do not
compare a plugin ZIP checksum to a CLI tarball. Review the source revision and
lockfile; npm's dependency integrity checks do not sign the CLI publisher's code.

## 3. PATH and smoke checks

Add the install prefix for this PowerShell session and test the generated shim
from outside the source checkout:

```powershell
$env:Path = "$cliPrefix;$env:Path"
Set-Location $env:TEMP
Get-Command game-dev.cmd
where.exe game-dev
$smokeWorkspace = Join-Path $env:TEMP 'game-dev-install-check'
game-dev.cmd --version
game-dev.cmd capabilities --output-dir "$smokeWorkspace" --json
game-dev.cmd doctor --output-dir "$smokeWorkspace" --json
```

For future sessions, open Windows **Edit environment variables for your account**,
edit the user **Path**, and add the full value printed by `$cliPrefix` as a new
entry. Preserve existing entries. Restart PowerShell and the local agent/app
that will run the CLI so they inherit the new PATH. On Windows npm places global
launchers directly in the prefix, not a `bin` subdirectory.

`game-dev --version` normally works too. If PowerShell blocks `game-dev.ps1`, use
`game-dev.cmd` explicitly, including in skill commands; do not disable execution
policy to make it work. If `Get-Command game-dev -All` shows another installation,
use the full path to the intended `game-dev.cmd` and correct the PATH order.
If the full path works but the bare command fails, rebuild is unnecessary: check
PATH and restart the invoking process. If `node` is missing, repair Node's PATH
first; the npm launcher requires a separately installed Node runtime.

These checks may initialize local workspace metadata. They do not call paid
providers. `doctor` can report platform warnings and missing optional Blender,
credentials, or skills; those are separate from command discovery/startup. Never
paste credentials into an issue. If startup fails, report the exact failed step,
source revision, Node/npm versions, exit code, and redacted error output.
