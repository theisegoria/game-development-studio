# Your first capture

Use the built-in `generic-sample` adapter to create, seal, verify and compare a
synthetic capture. This free workflow requires only Node.js 22.5+, npm and the
CLI. It does not require a compiler, provider credentials, Blender or a GPU.
Follow the [canonical install guide](install.md) first. The baseline is the
checksum-verified GitHub release **1.4.0**; the npm registry name is unpublished.

The sample copies small known PNGs and synthetic measurements. It proves the
capture workflow and comparison, not renderer performance, target-engine
correctness or artistic approval. Release 1.4.0 uses an explicit Node interpreter
for the sample on Windows, macOS and Linux. The release artifact gate exercises
the installed tarball on each platform with Node 22 and 24.


## POSIX: macOS and Linux

Run from a writable directory outside the source checkout. Choose project and
workspace paths with spaces deliberately; the project destination must not
already exist. A shell error should stop the workflow.

```sh
set -eu
game-dev --version
workspace="$(pwd)/first capture workspace"
project="$(pwd)/first capture project"
game-dev doctor --output-dir "$workspace" --json
game-dev adapter sample --project "$project" --output-dir "$workspace" --json
```

The last command is a plan. Review its destination and files. Approve creating
that new sample directory, inspect the adapter, and review the capture command:

```sh
game-dev adapter sample --project "$project" --output-dir "$workspace" --confirm --json
game-dev adapter inspect --project "$project" --output-dir "$workspace" --json
game-dev scenario plan capture --project "$project" --output-dir "$workspace" --json
```

The plan requests only confirmation for a CPU sample. Execute the reviewed
scenario twice, keeping each returned run path:

```sh
game-dev scenario run capture --project "$project" --output-dir "$workspace" --confirm --json > baseline.json
game-dev scenario run capture --project "$project" --output-dir "$workspace" --confirm --json > repeated.json
baseline=$(node --input-type=module -e 'import{readFileSync}from"node:fs"; const r=JSON.parse(readFileSync("baseline.json","utf8")); if(!r.ok)process.exit(1); console.log(r.data.runPath)')
repeated=$(node --input-type=module -e 'import{readFileSync}from"node:fs"; const r=JSON.parse(readFileSync("repeated.json","utf8")); if(!r.ok)process.exit(1); console.log(r.data.runPath)')
game-dev capture verify "$baseline" --output-dir "$workspace" --json
game-dev capture verify "$repeated" --output-dir "$workspace" --json
game-dev visual compare "$baseline" "$repeated" --threshold 0 --output-dir "$workspace" --json
```

Both verifications report `hashesVerified` and `closedArtifactRosterVerified`.
The comparable pair has `changedPixelRatio: 0` and `meanAbsoluteError: 0`.
Now request the sample's known visual change, review its plan, and run it:

```sh
node --input-type=module -e 'import{writeFileSync}from"node:fs"; writeFileSync("regression.json",JSON.stringify({mode:"visual-regression"}))'
game-dev scenario plan capture --project "$project" --request regression.json --output-dir "$workspace" --json
game-dev scenario run capture --project "$project" --request regression.json --output-dir "$workspace" --confirm --json > candidate.json
candidate=$(node --input-type=module -e 'import{readFileSync}from"node:fs"; const r=JSON.parse(readFileSync("candidate.json","utf8")); if(!r.ok)process.exit(1); console.log(r.data.runPath)')
game-dev capture verify "$candidate" --output-dir "$workspace" --json
game-dev visual compare "$baseline" "$candidate" --threshold 0 --output "$(pwd)/first capture diff" --output-dir "$workspace" --json
```

The comparison reports changed pixels and writes diff artifacts. Read its
summary and evidence ceiling. The generated files come from this fixture's
declared inputs; they are not a screenshot of a real game.

## PowerShell: Windows

Install as described in [the canonical guide](install.md), then use `.cmd`
launchers. Do not use PowerShell process substitution or change execution policy.

```powershell
$ErrorActionPreference = 'Stop'
function Invoke-GameDev {
  & game-dev.cmd @args
  if ($LASTEXITCODE -ne 0) { throw "game-dev failed with exit code $LASTEXITCODE" }
}
Invoke-GameDev --version
$workspace = Join-Path (Get-Location).Path 'first capture workspace'
$project = Join-Path (Get-Location).Path 'first capture project'
Invoke-GameDev doctor --output-dir "$workspace" --json
Invoke-GameDev adapter sample --project "$project" --output-dir "$workspace" --json
# Review the destination and files before confirming.
Invoke-GameDev adapter sample --project "$project" --output-dir "$workspace" --confirm --json
Invoke-GameDev adapter inspect --project "$project" --output-dir "$workspace" --json
Invoke-GameDev scenario plan capture --project "$project" --output-dir "$workspace" --json
# Review the scenario plan before running it.
$baseline = Invoke-GameDev scenario run capture --project "$project" --output-dir "$workspace" --confirm --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $baseline.ok) { throw 'Baseline capture failed' }
$repeated = Invoke-GameDev scenario run capture --project "$project" --output-dir "$workspace" --confirm --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $repeated.ok) { throw 'Repeated capture failed' }
Invoke-GameDev capture verify "$($baseline.data.runPath)" --output-dir "$workspace" --json
Invoke-GameDev capture verify "$($repeated.data.runPath)" --output-dir "$workspace" --json
Invoke-GameDev visual compare "$($baseline.data.runPath)" "$($repeated.data.runPath)" --threshold 0 --output-dir "$workspace" --json
$request = Join-Path (Get-Location).Path 'regression.json'
[System.IO.File]::WriteAllText($request, '{"mode":"visual-regression"}')
Invoke-GameDev scenario plan capture --project "$project" --request "$request" --output-dir "$workspace" --json
$candidate = Invoke-GameDev scenario run capture --project "$project" --request "$request" --output-dir "$workspace" --confirm --json | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $candidate.ok) { throw 'Candidate capture failed' }
Invoke-GameDev capture verify "$($candidate.data.runPath)" --output-dir "$workspace" --json
$diff = Join-Path (Get-Location).Path 'first capture diff'
Invoke-GameDev visual compare "$($baseline.data.runPath)" "$($candidate.data.runPath)" --threshold 0 --output "$diff" --output-dir "$workspace" --json
```

## Diagnostics, AI tools and next steps

Run `doctor --workflow generic-capture --expected-version 1.4.0 --json` with
the same `--output-dir`. Required and optional checks are identified for this
workflow; missing optional tools do not block the free capture.

Shell-capable agents can call the CLI. For an MCP client, generate configuration
with `game-dev mcp config --client generic --output-dir ABSOLUTE_WORKSPACE`, using
your actual supported client name. Review it before installing. Scenario
execution over MCP requires the user's `GAME_DEV_MCP_ALLOW_EXECUTION=1` setting
and confirmation per run; the model cannot approve itself. Paid tools remain
disabled without a spend limit, and this sample does not need them.

For engine instrumentation and compilation, use the separate
[advanced C probe tutorial](advanced-c-probe.md). For installation failures,
follow the [support steps](install.md#support) and share only a reviewed redacted
report. The exact verifier is `npm run verify:first-run` from a source checkout;
its JSON distinguishes source-packed artifacts from public release bytes.
