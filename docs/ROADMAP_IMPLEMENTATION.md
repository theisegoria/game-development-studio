# Game Development Studio roadmap implementation ledger

Checkpoint work began 4 October 2026 from public main `3a9cd3f08f970ded8db71d31e71ac665f313f9cd` (CLI 1.3.1), companion skills main `c55245f`. The saved plan is [Game Development Studio next roadmap](https://chatgpt.com/space/page_836a5b5afbc4819182138b588cf0bc28).

## Isolation and authorization

The discovered `game-asset-mcp` local checkout is older (`29715a5`) and dirty. None of its changes are inputs to this implementation. Work uses an independent public-source clone and local branch `codex/roadmap-checkpoints-20261004`. Its source changes were left intact; only the separately requested Codex model preference was updated in the original project's configuration. Ben authorized local implementation, CPU checks and commits, then approved isolated branch pushes, draft PRs and the existing hosted CI workflows, including hosted Blender/Metal and optional CPU tools. His subsequent correction permits CI testing only: local Anvil/application-window, Blender and GPU launches remain excluded. Merges, releases, npm publication, paid provider calls, account creation, cloud sync, user-asset purge and unattended updates require separate authorization. Draft core PR #11 and skills PR #8 are open; no merge or release occurred.

## Intended integrated checkpoints

| Area | Concrete checkpoint | State |
| --- | --- | --- |
| P0 first run | Canonical verified release install; executable compiler-free generic sample; release drift gate; PowerShell/POSIX and CI matrix | Linux/macOS passed; Windows verifier fixes awaiting hosted rerun |
| P0 diagnostics | Workflow-aware required/optional checks; local redacted support report; pre-install issue forms | Implemented |
| P1 production | Typed recipe templates, bindings from actual results, graph reasons, next-step review and existing recovery semantics | Implemented |
| P1 native UX | Guided Anvil forms, advanced JSON, recipe status, persistent explicit optional tool paths | Built and CPU-tested; interaction pending |
| P2 review | Bounded controlled-light appearance preview, UV evidence, reproducible pose selection and snapshot comparison | Implemented bounded checkpoint |
| P3 distribution | Tarball remains baseline; exact artifact/install/update/rollback checks and channel readiness | Local artifact gates passed; publication pending |
| Shared gates | Canonical skill export parity, immutable Actions pins, license roster, artifact-byte checks, independent review | Local gates and hosted optional/native lanes passed; install rerun pending |

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

### First checkpoint local validation (bede3f7 / f785d97)

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

- Current-source Linux/macOS free-route execution passed on Node 22/24 at `4f22383`. Windows Node 22 stopped at a 60-second isolated dependency-install timeout; Node 24 stopped at `where.exe` lookup before reaching the fixed shim invocation. The verifier now uses an absolute System32 lookup and an install-only 180-second bound; hosted Windows reruns are required.
- Exact public 1.2.0/1.3.1 Linux/macOS update/rollback passed on Node 22 at `4f22383`. Both Node 24 lanes stopped before install at GitHub release API HTTP 403. The fixed metadata API request now uses the runner's read-only token; downloads remain anonymous and npm/CLI children receive no GitHub token. Reruns must establish all four lanes.
- Native keyboard/accessibility/light-dark/repeated-click/cancel/relaunch interaction: requires authorized app-window launch.
- Hosted Blender and Metal tests passed at `4f22383`, together with all four real CoACD runners, all three Basis runners, Windows install/fsync, native CPU tests and ad-hoc archive verification. These are runner evidence, not local/target-engine or signed-launch acceptance. Local execution remains disallowed.
- Three unfamiliar testers completing the free route: requires human usability sessions.
- npm publication: requires publisher access plus explicit publication approval; no credentials will be created.
- Developer ID signing/notarization and normal clean-Mac launch: require account access and explicit authorization. Gatekeeper bypass is not acceptance.
- Additional bundled Windows runtime: decision requires measured setup friction; not justified by the closed historical Windows question alone.
- Continuous playback rendering, IBL/shadows, direct compressed KTX2 appearance and fuller comparison UX remain implementation follow-ups, distinct from launch/publication permission gates. Compressed assets currently need a separately prepared decoded core-glTF review source.

### Second checkpoint implementation and hosted acceptance

Core draft [PR #11](https://github.com/theisegoria/game-development-studio/pull/11) and companion [PR #8](https://github.com/theisegoria/game-development-studio-skills/pull/8) preserve the isolated branch. First-head hosted evidence is tied to core `bede3f7` / skills `f785d97`: Linux/macOS first-run, Basis on three platforms, installed Windows CLI/fsync, native archive, hosted Blender and hosted Metal passed. Windows first-run failed at the shim path-with-spaces check. CoACD on four runners refused the standard setuptools `.pth` hook before decomposition, so its native algorithm was not established by that run. The fixes preserve the exact allowlist and structured CLI argument boundaries; real hosted reruns are required.

The next source slice adds CUBICSPLINE and validated animation metadata shared by CLI/MCP/native forms; fixed default-pose or explicit shared framing; authored/morphed tangents with reflection parity; bounded per-pixel transparency; a measured 50,000-triangle/150,000-vertex appearance envelope with explicitly sampled 2,000-triangle auxiliary diagrams; and source-bound clip/time selection. Renderer identity advances to `gds-cpu-review@2.1.0`, requiring fresh appearance review. Native interactions are source/CPU evidence only until separately approved. Second-checkpoint CPU/mock suite passed **99 files / 1,010 tests**, with 30 real optional/GPU tests skipped. Native CPU build/tests passed **124 tests in 11 suites**; the subsequent candidate-path contract fix passed all 14 guided-workflow tests. A final targeted review/runtime check passed 27 cases, including 2 runtime payload fixture tests kept distinct from real installed-byte evidence. Additional raw-reference, flat-normal/morph-tangent and fetch cleanup fixes were rechecked by targeted suites. Typecheck, lint, production build and 51 native schema snapshots passed. The exact saved local tarball (`cb985c638cbd3a84330d98baa103c71cc67dc0ab803110468c6a632dc32e772e`, source `4f22383`) passed the free workflow on macOS. Full Windows and public-release matrix proof still depends on the verifier-fix CI head.

The final envelope fixture is a 4,801,020-byte GLB with 50,000 triangles / 150,000 vertex instances. An isolated static preview took 487 ms with +376,995,840 bytes RSS; a selected-pose pass took 992 ms with +423,215,104 bytes RSS. Auxiliary SVGs were about 3.87 MB. The earlier temporary 100,000-triangle experiment is retained as rejected-cap research, not current support. Resource measurements are host/asset specific; neither RSS deltas nor accepted source size imply a universal peak.

The existing CI workflow now separates current-source six-platform/Node installs from exact public 1.3.1/1.2.0 Linux/macOS install, update, rollback and reinstall. Both tarballs and manifests must match GitHub release API digests, sizes and URLs before execution. Published Windows 1.3.1 sample capture remains unsupported and explicitly documented; the source Windows fix is its own hosted gate.

## Integration procedure

Keep disjoint owners during implementation, integrate CLI/MCP contracts, run bounded targeted checks, independently review the patch, fix actionable findings, then commit local checkpoints. Export the companion skills from the canonical source and verify its closed roster. Preserve a Git bundle and this evidence ledger for resumption; publication approval is a final separate gate.
