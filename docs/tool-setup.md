# Optional local tools and support reports

Release 1.4.0 adds workflow-aware diagnostics and saved tool selections. Use the [release-driven quickstart](quickstart.md) for the current published installation baseline. The free generic sample, inspection, and ordinary asset packaging do not require Blender, Basis Universal, CoACD, or provider credentials. Compressed assets require Basis validation when inspected for package admission.

Choose the workflow you intend to run:

```sh
game-dev doctor --workflow generic-capture --expected-version 1.3.1 --json
game-dev doctor --workflow asset-inspect --json
game-dev doctor --workflow asset-package --json
game-dev doctor --workflow blender-normalize --json
game-dev doctor --workflow texture-compression --json
game-dev doctor --workflow collision-decomposition --json
```

`healthy` reflects required checks for that workflow. Missing optional tools and skills appear with `required: false`. `--expected-version` detects invoking a different helper release. `metal-capture` checks the macOS prerequisite, and `all` reports all listed tool prerequisites as required. Doctor reads configuration and bounded executable bytes; it never starts Blender, Python, Basis, a GPU capture, or a provider call. A passing executable check does not prove its version or runtime dependencies. The actual operation performs its own bounded tool and result validation.

Review and select executable files explicitly. Paths containing spaces work on POSIX shells and PowerShell when quoted. Save the Basis digest from its independently verified CPU build manifest when available:

```sh
game-dev tool configure blender --executable "/Applications/Blender.app/Contents/MacOS/Blender" --confirm --json
game-dev tool configure basisu --executable "/absolute/verified CPU tools/basisu" --sha256 VERIFIED_SHA256 --confirm --json
game-dev tool configure coacd-python --executable "/absolute/isolated venv/bin/python" --confirm --json
game-dev tool list --json
```

```powershell
game-dev.cmd tool configure blender --executable "C:\Program Files\Blender Foundation\Blender\blender.exe" --confirm --json
game-dev.cmd tool configure basisu --executable "C:\Verified CPU Tools\basisu.exe" --sha256 VERIFIED_SHA256 --confirm --json
game-dev.cmd tool configure coacd-python --executable "C:\Verified CPU Tools\coacd-venv\Scripts\python.exe" --confirm --json
game-dev.cmd tool list --json
```

Replace `VERIFIED_SHA256` with the full 64-character lowercase SHA-256, never the literal placeholder. If `--sha256` is omitted, saving records the bytes you selected; it establishes a local identity and does not establish publisher provenance. Configuration does not download, install, or execute a tool. Blender launch approval and CPU-operation approvals still apply separately.

Selections persist per user independently of the working directory or shell PATH, including launches from Finder:

| Platform | Default configuration file |
| --- | --- |
| macOS | `~/Library/Application Support/Game Development Studio/tools.json` |
| Windows | `%APPDATA%\Game Development Studio\tools.json` |
| Linux | `$XDG_CONFIG_HOME/Game Development Studio/tools.json`, or `~/.config/Game Development Studio/tools.json` |

`GAME_DEV_TOOL_CONFIG_PATH` can select another absolute configuration-file path. Each saved selection binds the original absolute path, resolved path, and SHA-256. A changed file, retargeted symlink, missing executable, malformed record, or file above the 256 MiB inspection limit fails closed. It does not select another PATH installation. Python keeps its original venv executable path while verifying the resolved interpreter bytes, preserving `pyvenv.cfg` discovery. A production recipe additionally fingerprints CoACD's venv configuration and contained package tree without starting Python; package or configuration changes invalidate its approval. The CPU worker still checks its isolated environment, pinned versions, and package-code hash before accepting a result. See [CoACD setup](coacd.md), [Basis CPU setup](TEXTURE_COMPRESSION.md), and [Blender reliability](BLENDER-RELIABILITY.md).

To review an updated executable, inspect its origin and digest, then repeat `tool configure`. To remove one saved selection, run `game-dev tool clear blender --confirm --json` (or `basisu`/`coacd-python`). Clear does not remove installed tools or environment overrides. Tool configuration uses an atomic file replacement and a writer lock. If a writer is interrupted, inspect whether it is still running before manually removing the reported `tools.json.lock` directory. An invalid configuration file must be reviewed and moved aside before replacing it; the tool never silently discards it.

Environment overrides retain priority: `BLENDER_PATH`, `GAME_DEV_BASISU_PATH` plus `GAME_DEV_BASISU_SHA256`, and `GAME_DEV_COACD_PYTHON`. `GAME_DEV_BLENDER_SHA256` and `GAME_DEV_COACD_PYTHON_SHA256` optionally pin override bytes. Legacy Blender and CoACD overrides without digest pins remain supported and are reported as unpinned. With no explicit Blender selection, discovery uses the supplied PATH and standard installation locations. Basis and CoACD never discover or install themselves automatically. Child-process environments exclude provider credentials and user startup/injection settings; CPU worker limits remain in effect.

Preview a redacted local support report:

```sh
game-dev support report --workflow generic-capture --json
game-dev support report --workflow generic-capture --output "/absolute/new report.json" --confirm --json
```

```powershell
game-dev.cmd support report --workflow generic-capture --output "C:\Reports\new report.json" --confirm --json
```

The output directory must already exist. Saving refuses existing files and symlinks and uses private file permissions where the platform supports them. The `game_dev.support_report.v1` allowlist includes helper/Node versions, platform/architecture, workflow, check IDs, statuses, required flags, and tool failure codes. It excludes paths, arbitrary error text, environment values, credentials, URLs, asset data, and logs. `sharing.transmitted` is always false; read the saved JSON and decide separately whether to include it in an issue. Doctor's ordinary diagnostic output includes local paths, so use the redacted support report for that review.
