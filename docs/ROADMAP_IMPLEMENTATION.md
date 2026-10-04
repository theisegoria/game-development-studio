# Game Development Studio roadmap implementation ledger

Checkpoint work began 4 October 2026 from public main `3a9cd3f08f970ded8db71d31e71ac665f313f9cd` (CLI 1.3.1), companion skills main `c55245f`. The saved plan is [Game Development Studio next roadmap](https://chatgpt.com/space/page_836a5b5afbc4819182138b588cf0bc28).

## Isolation and authorization

The discovered `game-asset-mcp` local checkout is older (`29715a5`) and dirty. None of its changes are inputs to this implementation. Work uses an independent public-source clone and local branch `codex/roadmap-checkpoints-20261004`. Its source changes were left intact; only the separately requested Codex model preference was updated in the original project's configuration. Ben authorized local implementation, CPU checks and commits, then approved isolated branch pushes, draft PRs and the existing hosted CI workflows, including hosted Blender/Metal and optional CPU tools. His subsequent correction permits CI testing only: local Anvil/application-window, Blender and GPU launches remain excluded. Merges, releases, npm publication, paid provider calls, account creation, cloud sync, user-asset purge and unattended updates require separate authorization. Draft core PR #11 and skills PR #8 are open; no merge or release occurred.

## Intended integrated checkpoints

| Area | Concrete checkpoint | State |
| --- | --- | --- |
| P0 first run | Canonical verified release install; executable compiler-free generic sample; release drift gate; PowerShell/POSIX and CI matrix | All six source first-run and four exact public update/rollback lanes passed at `b6c69b3` |
| P0 diagnostics | Workflow-aware required/optional checks; local redacted support report; pre-install issue forms | Implemented |
| P1 production | Typed recipe templates, bindings from actual results, graph reasons, next-step review and existing recovery semantics | Implemented |
| P1 native UX | Guided Anvil forms, advanced JSON, recipe status, persistent explicit optional tool paths | Built and CPU-tested; interaction pending |
| P2 review | Bounded controlled-light appearance preview, UV evidence, reproducible pose selection and snapshot comparison | Implemented bounded checkpoint |
| P3 distribution | Tarball remains baseline; exact artifact/install/update/rollback checks and channel readiness | Local artifact gates passed; publication pending |
| Shared gates | Canonical skill export parity, immutable Actions pins, license roster, artifact-byte checks, independent review | Third slice source/CPU checks and independent review passed; fresh hosted and exact artifact checks pending |

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

- Current-source first-run passed on all six Windows/Linux/macOS Node 22/24 lanes at `b6c69b3`. The absolute System32 lookup, install-only 180-second bound and filesystem canonicalization resolved the earlier Windows failures while retaining first-match/stale-install rejection. New implementation heads need their own CI acceptance.
- Exact public 1.2.0/1.3.1 Linux/macOS install, upgrade, rollback and reinstall passed on all four Node 22/24 lanes at `9984cc8`. The fixed metadata API request uses the runner's read-only token; downloads remain anonymous and npm/CLI children receive no GitHub token. API digest, size, exact URL and manifest checks precede every release installation.
- Native keyboard/accessibility/light-dark/repeated-click/cancel/relaunch interaction: requires authorized app-window launch.
- Hosted Blender and Metal tests passed at `4f22383`, together with all four real CoACD runners, all three Basis runners, Windows install/fsync, native CPU tests and ad-hoc archive verification. These are runner evidence, not local/target-engine or signed-launch acceptance. Local execution remains disallowed.
- Three unfamiliar testers completing the free route: requires human usability sessions.
- npm publication: requires publisher access plus explicit publication approval; no credentials will be created.
- Developer ID signing/notarization and normal clean-Mac launch: require account access and explicit authorization. Gatekeeper bypass is not acceptance.
- Additional bundled Windows runtime: decision requires measured setup friction; not justified by the closed historical Windows question alone.
- The third slice implements direct compressed KTX2 appearance, bounded sampled playback and fuller comparison controls below. Real-time interpolated playback, IBL/shadows and combined Basis+timeline decoding remain deliberate renderer limits; none is silently claimed by sampled CPU review.

### Second checkpoint implementation and hosted acceptance

Core draft [PR #11](https://github.com/theisegoria/game-development-studio/pull/11) and companion [PR #8](https://github.com/theisegoria/game-development-studio-skills/pull/8) preserve the isolated branch. First-head hosted evidence is tied to core `bede3f7` / skills `f785d97`: Linux/macOS first-run, Basis on three platforms, installed Windows CLI/fsync, native archive, hosted Blender and hosted Metal passed. Windows first-run failed at the shim path-with-spaces check. CoACD on four runners refused the standard setuptools `.pth` hook before decomposition, so its native algorithm was not established by that run. The fixes preserve the exact allowlist and structured CLI argument boundaries; real hosted reruns are required.

The next source slice adds CUBICSPLINE and validated animation metadata shared by CLI/MCP/native forms; fixed default-pose or explicit shared framing; authored/morphed tangents with reflection parity; bounded per-pixel transparency; a measured 50,000-triangle/150,000-vertex appearance envelope with explicitly sampled 2,000-triangle auxiliary diagrams; and source-bound clip/time selection. Renderer identity advances to `gds-cpu-review@2.1.0`, requiring fresh appearance review. Native interactions are source/CPU evidence only until separately approved. Second-checkpoint CPU/mock suite passed **99 files / 1,010 tests**, with 30 real optional/GPU tests skipped. Native CPU build/tests passed **124 tests in 11 suites**; the subsequent candidate-path contract fix passed all 14 guided-workflow tests. A final targeted review/runtime check passed 27 cases, including 2 runtime payload fixture tests kept distinct from real installed-byte evidence. Additional raw-reference, flat-normal/morph-tangent and fetch cleanup fixes were rechecked by targeted suites. Typecheck, lint, production build and 51 native schema snapshots passed. The exact saved local tarball (`cb985c638cbd3a84330d98baa103c71cc67dc0ab803110468c6a632dc32e772e`, source `4f22383`) passed the free workflow on macOS. All four public-release lanes subsequently passed at `9984cc8`; Windows source-first-run proof still requires the path-alias correction head.

The final envelope fixture is a 4,801,020-byte GLB with 50,000 triangles / 150,000 vertex instances. An isolated static preview took 487 ms with +376,995,840 bytes RSS; a selected-pose pass took 992 ms with +423,215,104 bytes RSS. Auxiliary SVGs were about 3.87 MB. The earlier temporary 100,000-triangle experiment is retained as rejected-cap research, not current support. Resource measurements are host/asset specific; neither RSS deltas nor accepted source size imply a universal peak.

The existing CI workflow now separates current-source six-platform/Node installs from exact public 1.3.1/1.2.0 Linux/macOS install, update, rollback and reinstall. Both tarballs and manifests must match GitHub release API digests, sizes and URLs before execution. Published Windows 1.3.1 sample capture remains unsupported and explicitly documented; the source Windows fix is its own hosted gate.

### Final second-checkpoint CI acceptance

Core `b6c69b3de371c381b687895ebe8ca21140d00f2c` and skills `db21af41676144a04543c9f9fa415a325fb49a66` are the tested branch heads. All six automatic core PR workflows succeeded: [main CI](https://github.com/theisegoria/game-development-studio/actions/runs/37180425860), [Windows install](https://github.com/theisegoria/game-development-studio/actions/runs/37180425852), [archive](https://github.com/theisegoria/game-development-studio/actions/runs/37180425890), [Basis](https://github.com/theisegoria/game-development-studio/actions/runs/37180425905), [Windows fsync](https://github.com/theisegoria/game-development-studio/actions/runs/37180425842) and [CoACD](https://github.com/theisegoria/game-development-studio/actions/runs/37180425892). [Skills validation](https://github.com/theisegoria/game-development-studio-skills/actions/runs/37179218408) also succeeded. Source first-run passed on Windows/Linux/macOS × Node 22/24; exact public install/update/rollback/reinstall passed on all four Linux/macOS Node lanes. Each Node 22/24 suite passed 1,011 tests with 31 explicit skips; native CPU tests passed 124 tests in 11 suites. Hosted Blender, Metal/SDK/software/lavapipe, runtime staging, archive, Basis 3/3 and CoACD 4/4 lanes passed. No local app, Blender or GPU launch occurred.

### Third review slice plan and current evidence

Continue the remaining software work within source/CPU/CI authorization: direct Basis KTX2 appearance; bounded sampled animation playback; shared framing and fuller before/after controls over existing sealed regressions. Keep rendering approximations explicit. Real app interaction and unfamiliar-user usability remain separate unmet evidence gates, and publication/signing remain blocked on access plus authorization.

Direct Basis review uses explicit opt-in, bounded original-source decoding and sealed decoder/source/pixel receipts. Recipe planning hashes configured bytes without a launch, and approval/package checks require a current matching decoder identity. Native shared framing and the opt-in form are implemented. Sampled playback prepares 2–16 fixed-frame PNG/JPEG appearance poses, binds actual timestamps and all time/angle pixels to existing sealed captures, and exposes offline scrub/play controls. Sequence limits and the unsupported Basis combination fail explicitly. Verified regression images gain side-by-side/opacity overlays; controls do not change metrics or promote baselines.

Initial focused validation passed 52 CPU/fault-injection tests plus 22 playback/comparison tests; two real codec cases were intentionally skipped locally. Independent review findings were fixed, including passing the remaining cumulative raster budget into each animation sample before its pixel loop; the final read-only review reported no unresolved actionable findings. The complete final CPU/mock suite passed **107 files / 1,046 tests**, with **30 explicitly skipped** optional/GPU cases. Native Foundation-only build/tests passed **126 tests in 11 suites**. The preliminary native schema/version expectation failures were corrected and are retained as failed historical logs, not passing evidence. Typecheck, lint, production build, 51 runtime schema snapshots, install-doc drift, canonical skill export and the companion 36-file ZIP validator passed. The source-packed disposable install verified **98 CLI operations / 98 MCP tools**, five installed skills and clean stdout. Real hosted ETC1S/UASTC decode/compare/package tests and exact final-checkpoint byte verification remain required before accepting this slice. No real optional decoder, Blender, GPU or app window ran locally. These additions are source checkpoint features, not a published v1.3.1 release.

## Integration procedure

Keep disjoint owners during implementation, integrate CLI/MCP contracts, run bounded targeted checks, independently review the patch, fix actionable findings, then commit local checkpoints. Export the companion skills from the canonical source and verify its closed roster. Preserve a Git bundle and this evidence ledger for resumption; publication approval is a final separate gate.
