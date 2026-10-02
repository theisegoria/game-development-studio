# Anvil native ZIP release lane

The source repository can stage and verify an Apple Silicon Anvil app for macOS
26 or later. This is an **ad-hoc signed, non-notarized standalone ZIP**, not a
Developer ID signed installer, DMG or PKG. It creates no credentials and does not
submit anything to Apple. Gatekeeper acceptance on a clean Mac and native UI
acceptance are not claimed by the packaging checks.

Use a clean exact source revision on a macOS arm64 runner with the required SDK,
`npm ci`, Python 3 and the checked-in pinned upstream Node runtime profile. Download
and validate Node using the existing release workflow's archive checksum and
`scripts/verify-upstream-node-profile.mjs`; set `GAME_DEV_NODE_EXECUTABLE` to that
verified archive's `bin/node`. Do not substitute a host Homebrew runtime.

```sh
node --test scripts/tests/anvil-release.test.mjs
GAME_DEV_RUNTIME_PROFILE=upstream-node-ci GAME_DEV_BUILD_CONFIGURATION=release \
  ./script/build_and_run_anvil.sh --build-only
node scripts/package-anvil-release.mjs package \
  --app apps/macos/Anvil/dist/Anvil.app --output "$RUNNER_TEMP/anvil-assets"
node scripts/package-anvil-release.mjs verify \
  --release-root "$RUNNER_TEMP/anvil-assets"
```

The build-only helper does not launch Anvil. It compiles SwiftPM, generates the
icon, stages the verified CLI closure and SwiftPM resource bundle, binds the
current source/version/toolchain into `ANVIL_BUILD.json`, and ad-hoc signs the app.
Packaging enforces the closed bundle roster, arm64 executable, macOS minimum,
source SHA/version, resource schemas, signatures, dependency/license bytes and
pinned Node. It constructs the archive twice, checks byte equality, extracts it,
and re-verifies the whole tree. Only bundled Node/CLI version metadata commands
run; no app, Blender, GPU workload or provider operation runs.

Outputs:

- `Anvil-VERSION-macos-arm64.zip`, containing only `Anvil.app` and `README.txt`.
- `ANVIL_RELEASE.json`, with source/build/runtime identity, complete tree evidence,
  archive checksum and bounded acceptance claims.
- `ANVIL_SHA256SUMS.txt`, the producer's intermediate verification manifest.

The shared release workflow uploads these as an exact-head CI artifact and
verifies them before publication. Its release artifact contains the ZIP and
`ANVIL_RELEASE.json` with the overall `SHA256SUMS.txt` covering both. The intermediate manifest
need not become a second public checksum document. This script does not publish.

The included README documents manual extraction and free diagnostic commands
using `Anvil.app/Contents/Resources/GameDevelopmentStudioRuntime/payload/node/bin/node`
and `payload/app/dist/cli.js`, with a disposable user-chosen workspace. Upgrade and
rollback planning identifies this distribution separately from CLI and skills;
installation is manual. Existing original GameDevelopmentStudio app source and
its release packager are unchanged.

Local fixture tests verify deterministic archive I/O, executable-mode retention,
build-tree-independent extraction, unsafe path rejection, symlink refusal and
version/provenance contracts. Real macOS staging and extracted signature/runtime
verification must pass in remote CI before a native ZIP is published.

## Optional CPU dependencies in Anvil

Prepare the explicitly chosen tools using [texture compression](TEXTURE_COMPRESSION.md)
and [CoACD setup](coacd.md). Anvil forwards only the three dependency settings below
to its CLI child; the runtime still validates their configuration. They grant no
spend or mutation approval. Do not place provider credentials in this command.

Quit an existing Anvil instance, then start the bundle executable directly from a
terminal with your own absolute paths and the SHA-256 recorded by the Basis build
manifest (replace the example values):

```sh
GAME_DEV_BASISU_PATH='/absolute/chosen-tools/basisu' \
GAME_DEV_BASISU_SHA256='REPLACE_WITH_MANIFEST_SHA256' \
GAME_DEV_COACD_PYTHON='/absolute/chosen-tools/coacd/bin/python' \
  '/absolute/chosen-apps/Anvil.app/Contents/MacOS/Anvil'
```

Launching from Finder does not inherit this terminal's settings. In Anvil's
Production tools, run **Diagnose texture compression** and **Diagnose collision
decomposition** first. Basis diagnostics inspect configuration and hash the encoder
without starting it. Configured CoACD diagnostics start a bounded metadata-only
Python child; they do not run decomposition, Blender or GPU work. Compression and
decomposition still require a fresh mutation confirmation; missing dependencies
remain explicitly unavailable.
