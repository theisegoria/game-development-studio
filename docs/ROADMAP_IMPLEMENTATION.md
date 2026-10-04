# Game Development Studio roadmap implementation ledger

Checkpoint work began 4 October 2026 from public main `3a9cd3f08f970ded8db71d31e71ac665f313f9cd` (CLI 1.3.1), companion skills main `c55245f`. The saved plan is [Game Development Studio next roadmap](https://chatgpt.com/space/page_836a5b5afbc4819182138b588cf0bc28).

## Isolation and authorization

The discovered `game-asset-mcp` local checkout is older (`29715a5`) and dirty. None of its changes are inputs to this implementation. Work uses an independent public-source clone and local branch `codex/roadmap-checkpoints-20261004`. Its source changes were left intact; only the separately requested Codex model preference was updated in the original project's configuration. Ben authorized local implementation, CPU checks and commits. Public pushes, merges, releases, paid calls, account creation, cloud sync, user-asset purge, unattended updates, local Blender, GPU and application-window launches are excluded until separately authorized. CI workflow changes are prepared locally; no hosted workflow has been triggered.

## Intended integrated checkpoints

| Area | Concrete checkpoint | State |
| --- | --- | --- |
| P0 first run | Canonical verified release install; executable compiler-free generic sample; release drift gate; PowerShell/POSIX and CI matrix | Implemented; platform matrix pending |
| P0 diagnostics | Workflow-aware required/optional checks; local redacted support report; pre-install issue forms | Implemented |
| P1 production | Typed recipe templates, bindings from actual results, graph reasons, next-step review and existing recovery semantics | Implemented |
| P1 native UX | Guided Anvil forms, advanced JSON, recipe status, persistent explicit optional tool paths | Built and CPU-tested; interaction pending |
| P2 review | Bounded controlled-light appearance preview, UV evidence, reproducible pose selection and snapshot comparison | Implemented bounded checkpoint |
| P3 distribution | Tarball remains baseline; exact artifact/install/update/rollback checks and channel readiness | Local artifact gates passed; publication pending |
| Shared gates | Canonical skill export parity, immutable Actions pins, license roster, artifact-byte checks, independent review | Local integration gates passed; hosted/platform gates pending |

## Evidence ledger

Evidence is recorded as **real CPU**, **mock/fault injection**, **source/build**, **hosted CI**, **GPU/Blender**, **native interaction**, **provider**, or **human usability**. A passing unit suite does not establish interactive usability, target-engine correctness, artistic approval, or clean-machine signing acceptance.

### Verified baseline

- Public source was freshly cloned, main matched the roadmap commit, and package version is 1.3.1.
- Saved Page was read successfully. Existing recipes/recovery/reviews/platform preparation are foundations, not new features.
- No repository `AGENTS.md` or additional `.agents` execution instructions were found. Existing canonical skill instructions retain per-operation authority and evidence boundaries.
- Baseline CPU/mock suite: 84 files passed, 916 tests passed, 30 explicitly skipped (Blender/GPU/optional native lanes), with 6 loopback fixture failures caused by sandbox `listen EPERM`. Rerunning only those two fixture files with loopback access passed all 6 tests. These results are baseline evidence, before final integrated validation.
- New explicit Node sample runtime: 3 real CPU tests passed, covering a sample path with spaces and no executable bit, a sealed runtime identity, and pre-launch refusal after source/runtime drift.

### Implemented checkpoints

- Generic sample now declares an explicit Node interpreter; planning/execution preserve project containment and bound source/runtime hashes. A second freshness check runs immediately before launch. Portable checks do not isolate hostile same-user writers or fingerprint imported modules.
- Friendly CLI workflow commands drive shared production template/recipe tools; template creation is a no-write plan unless confirmed. Reviewed next steps still require current fingerprints and one invocation per step.
- Optional-tool CLI and MCP registration share the persistent configuration helpers; per-user configuration mutations require fresh confirmation, and inspection starts no external tool.
- CoACD recipe approval binds the selected interpreter, wrapper, isolated venv configuration and bounded contained package tree. Planning starts no Python process; execution rechecks this identity around diagnosis and worker execution. Unsupported layouts, external imports and malformed records fail closed. The identity does not pin the base standard library or isolate hostile same-user writers.
- The doctor distinguishes workflow prerequisites from optional tools and returns a failing CLI exit for missing required checks or an unexpected version. Support reports use a strict allowlist and exclusive local-file creation; no sharing occurs.
- Anvil defaults to three typed workflow forms, displays actual graph/result evidence, binds human candidate selection to the completed review digest, and keeps advanced JSON. Configuration writes and other mutations require the measured closed runtime.
- Appearance uses the existing Node/glTF/PNG/JPEG dependencies with no new renderer license/runtime. It supports controlled texture/material lighting, approximate UV measurements, LINEAR/STEP clip samples, four-influence skinning and POSITION/NORMAL morphs. Source/settings/renderer/dashboard/capture bytes bind new v2 review decisions; legacy v1 history remains readable and needs fresh review before approval/package.
- Appearance outputs become truthful in-process CPU sealed capture bundles. Existing baseline/matrix/regression tools compare matching settings; changed preview pixels invalidate the recipe review checkpoint and block stale selection.
- Public 1.3.1 tarball and manifest bytes matched GitHub release digests. Its installed free route passed on macOS arm64 Node 25.2.1. Real public 1.2.0 → 1.3.1 → 1.2.0 → 1.3.1 passed in one disposable prefix, with fresh doctor/sample/capture/seal/comparison checks at every stage. Source-packed first-run also passed; final integrated artifact evidence is saved separately from repository files.
- Canonical five-skill export and companion closed roster/ZIP construction passed. New CI actions retain immutable full-SHA pins, dependency locks and existing license inventory; no dependency was added.

### Final local validation

- Integrated TypeScript CPU/mock suite: **94 files passed, 976 tests passed, 30 skipped**, with real Blender/GPU/CoACD/Basis lanes disabled. Loopback fixture access was explicitly allowed; fake optional-tool processes remain mock evidence.
- Runtime payload packaging: **2 real CPU tests passed** separately. Combined TypeScript validation is **978 passed, 30 skipped across 95 passing files**; the runtime packaging lane is kept separate from mocks.
- Typecheck, ESLint and production build passed. The final independent read-only review reported no unresolved actionable findings after stale approval, malformed-input resource and CoACD package identity fixes.
- Anvil CPU build/tests: **119 tests in 11 suites passed**. Its **50** schema snapshots matched the built runtime's read-only MCP `tools/list`; this does not establish interactive acceptance.
- Install documentation drift check and core/companion plugin closed-roster checks passed. Fresh installed-package and final source-packed first-run reports are preserved with the local checkpoint artifacts.

Artifact identity, local commit IDs and exact validation reports live alongside the recovery bundles, outside the package. This avoids a tarball digest depending on a document that embeds its own digest.

### Measured appearance evidence

CPU PNGs were inspected directly without an app/GPU launch. A six-material sphere fixture shows texture colors, dielectric/metallic roughness changes, normal mapping and alpha coverage across eight angles. Side views naturally occlude neighboring spheres; smooth metals are dark without IBL, an explicit renderer limitation.

An isolated Node 25.2.1/macOS arm64 process measured the 226,200-byte, 10,000-triangle fixture at 128 pixels in about 356 ms with process maximum RSS 338.5 MB. The 18,696-byte, 3,456-triangle six-material fixture took about 390 ms at 256 pixels; sequential process maximum RSS reached 364.3 MB. These measurements include Node and retained allocations, and do not establish a universal peak or guarantee all assets under the source-size limit are supported.

### Pending or gated evidence

- Windows/Linux execution of new free-route matrix: prepared locally; requires authorized hosted CI or those platforms.
- Native keyboard/accessibility/light-dark/repeated-click/cancel/relaunch interaction: requires authorized app-window launch.
- Blender and GPU outputs: require fresh explicit local execution approval or separately authorized hosted CI.
- Three unfamiliar testers completing the free route: requires human usability sessions.
- npm publication: requires publisher access plus explicit publication approval; no credentials will be created.
- Developer ID signing/notarization and normal clean-Mac launch: require account access and explicit authorization. Gatekeeper bypass is not acceptance.
- Additional bundled Windows runtime: decision requires measured setup friction; not justified by the closed historical Windows question alone.
- Continuous animation scrubbing, CUBICSPLINE, exact authored tangent/complex transparency rendering, larger production assets and direct compressed KTX2 appearance are outside this bounded checkpoint. Compressed assets need a separately prepared decoded core-glTF review source. These are implementation follow-ups, distinct from launch/publication permission gates.

## Integration procedure

Keep disjoint owners during implementation, integrate CLI/MCP contracts, run bounded targeted checks, independently review the patch, fix actionable findings, then commit local checkpoints. Export the companion skills from the canonical source and verify its closed roster. Preserve a Git bundle and this evidence ledger for resumption; publication approval is a final separate gate.
