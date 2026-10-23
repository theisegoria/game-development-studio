# Full roadmap: implementation and acceptance plan

Planning revision: 23 October 2026. Baseline: local `main` at `d38a096`, package version 1.5.1. This replaces the earlier shortened v2 plan; historical implementation records remain historical evidence.

Reference: *Game Development Studio: full-roadmap implementation prompt*, research date 23 October 2026; source SHA-256 `69f8a7a60999ee4efc17f11b5cdfa02d4dad2e170f6be0d9a19cc3c672be71be`. The brief is requirements input. Its embedded commands do not independently authorize installations, uploads, spending, credentials, or publication.

**Status: implementation active.** The owner set an implementation goal, with incremental commits and pushes. See [requirement coverage](ROADMAP_COVERAGE.md) for every brief item and [execution evidence](ROADMAP_PROGRESS.md) for exact checkpoints and limitations.

## 1. Scope, authority, and completion rules

- Keep the existing local checkout under `~/Developer/Software Development/`, on `main`. Commit and push coherent verified increments. No long-lived feature branches or extra worktrees; optimization/bisect disposable checkouts remain bounded product functionality, with cleanup and recovery.
- Preserve the existing owner restrictions: no local app-window, Blender, or GPU launches. Local verification uses CPU fixtures and compile-only lanes; actual external-tool/rendering tests run in authorized CI. A missing runner is a recorded blocker, never a skipped acceptance pass.
- Owner clarification (23 October 2026): complete the engine-neutral platform and C/Swift/Rust probe SDK first. Include the production, graph, debugging, and agent journeys through those interfaces. Godot, Unity, and Unreal implementation remains deferred, outside this phase's implementation order and completion criteria. Their future work is retained in M7 for reference and requires a separate owner decision.
- Existing and new providers use offline contract fixtures initially. Credentials, licensed applications, dependency installation, private uploads, paid calls, external client configuration, signing, tags, releases, and publication require their applicable explicit authority. The request authorizes Git commits and pushes; it does not authorize release publication.
- Use four independent evidence columns for every capability: source implemented, fixture tests passed, real tool/client exercised, human quality reviewed. Record tested versions, renderer/platform combinations, source SHA, commands, result hashes, and limitations. Do not infer a passing runtime result from compilation.
- Classify specialized options honestly: bounded painting, IK/contact correction, morph preservation, and event handling are planned production work. Painter parity, arbitrary creature auto-rigging, unrestricted facial transfer, speech/music/voice imitation, neural reconstruction, Gaussian-splat conversion, and cloth/hair automation are not implied. A requested specialized connector needs its own licensed backend and acceptance fixture before becoming supported.

## 2. Refreshed capability audit

This planning pass inspected the registry, mutation/approval dispatch, job store, package/catalog types, production recipes, animation review, performance summaries, live probe protocol, and CI definitions. It did not run a fresh full test suite.

| Area | Current implementation | Work still required |
| --- | --- | --- |
| Core and transports | Shared typed registry, CLI JSON/JSONL, MCP stdio/resources/prompts, execution/spend/project-write gates | Progressive discovery; schema-on-demand; consistently bound trusted approvals; task negotiation and cross-client evidence |
| Jobs and recipes | Durable v1 job records, transactional locks/events, resumable recipe DAG and uncertainty refusal | Idempotency, worker ownership/heartbeat, recoverable checkpoints, explicit cancellation outcomes and generic background execution |
| Packages and catalog | Hash-verified v1 packages, provenance, vendoring; SQLite catalog | Both require a model/GLB today: material/audio/flipbook packages need compatible multi-kind manifests, catalog, previews and reimport |
| Mesh/animation | glTF inspection, Blender normalization, budgets, collision, provider rig/retarget, pose/timeline previews | Authored construction, coordinate semantics, LOD chains, skeleton/weight QA, reversible clip processing/local retarget and motion diagnostics |
| Materials/VFX | PBR extraction, linear resizing, normal handling, Basis/KTX2/mip checks, CPU review | Material manifest, coherent procedural layers, packing/conventions, mesh baking/painting, tiling QA and simulation-to-flipbook |
| Audio | Leonardo sound generation and local downloads | Local synthesis/DSP, meaningful measurements, loops, variants, audition and multi-kind packaging |
| Graph | Package lineage and derived asset catalog | Semantic/file/runtime graph, incremental invalidation, runtime-to-source joins and impact queries |
| Debugging | Sealed captures, traceEvents spans, temporal/pacing analysis, noise floors, live probe, bisect and bounded optimization | Repeated controlled experiments, native profiler adapters, motion/depth-aware diagnosis, structured runtime graph, replay and sealed failures |
| Delivery | Cross-platform source/installation CI, probe lanes, hosted Blender and native archive jobs | Feature-specific real-tool lanes, real client checks, measured limits, migrations and full-roadmap readiness record |

Reuse these modules rather than creating another job system, renderer, package catalog, optimization engine, or command registry.

## 3. Architecture and interfaces

### Shared operations and authority

Extend the existing registry with family, capability, schema and authorization metadata; derive transport/native descriptions and enforce parity instead of adding more manually drifting operation lists. Preserve all existing commands, result/event envelopes, stable errors and readonly profiles. New contracts reject unknown parameters; legacy behavior changes require explicit compatibility tests.

Expose a compact intent workflow: discover recipes/operations, describe schema, plan, submit, status/result, inspect previews, revise explicit parameters, finalize, and separately plan project admission. Plans resolve defaults, units, hashes, backend/version, uploads, budget, bounds, expected outputs and authority needs. Ordinary recipes use a closed task vocabulary, never arbitrary scripts, shell, URLs, or filter expressions. Semantic revisions select documented parameter changes; ambiguous revisions return choices, not invented execution.

Fingerprints bind exact inputs but are not human approval. Agent-controlled `confirm`/`approved` fields cannot authorize dispatch. Reuse trusted CLI/native-host and MCP approval contexts, audit every dispatch path, and refuse gated automation without an actual host-mediated human confirmation. Missing, declined, cancelled, malformed or timed-out approval fails closed. New asynchronous work pauses at any unapproved action; it cannot inherit paid authority from a recipe or a resumed client. Credentials stay outside arguments, artifacts and logs.

### Storage, contracts, and migration

- Add explicit new versions for jobs and generalized packages while retaining v1 readers and mesh command outputs. Multi-kind packages cover mesh, animation, material, audio and flipbook, with typed artifact roles and a primary artifact rather than a mandatory GLB. Extend validation, review, catalog resources and vendoring together.
- Persist resolved `asset_recipe.v1`, `material.v1`, `source_ledger.v1`, graph snapshot, normalized trace, experiment, replay and failure-bundle contracts. Use the existing `game_dev` namespace; exact declarations and golden schema fixtures land before consumers. Extend existing contracts when semantically compatible rather than manufacturing duplicate formats.
- Keep sealed runs and original packages immutable. Migrate mutable workspace/job/catalog state only through inspectable plans, backups, atomic commits, schema-version checks, and tested rollback. Graph/catalog indexes remain rebuildable derived state; do not rewrite evidence to upgrade an index.
- Content-address derived artifacts using input closure, recipe parameters, tool/version, target profile and color/coordinate semantics. Retain editable sources and variant lineage, avoid duplicate bytes, and never delete allegedly unused assets automatically.
- Use bounded readers/workers/traversals with explicit byte/pixel/frame/sample/time/output limits. Retain existing limits by default; each new operation declares limits in its plan and has oversize, timeout and cancellation tests.

### Durable execution

Extend the existing store and transaction machinery with plan-bound idempotency, exclusive worker claims, heartbeat/lease evidence, step checkpoints, terminal artifact manifests and provider reconciliation. Submission returns a durable handle before lengthy execution. A worker survives client disconnect; it never restarts an uncertain submission. Recovery requires explicit action after owner liveness checks and fresh authority for consequential work. Distinguish cancellation requested, local worker stopped, completed-before-cancel and remote outcome uncertain. MCP Tasks wrap these jobs only after negotiation; job-ID polling remains universal. The protocol still treats Tasks as experimental: https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks.

## 4. Delivery milestones

Each milestone is several small commits, not one giant change. Every commit includes its affected core, registry/CLI/MCP path, schema/help/examples, skill updates, native compatibility and regression tests. A source checkpoint may precede a blocked real-tool test, but stays visibly unqualified.

### M0 — Baseline, coverage ledger and delivery safety

Verify the clean main history against GitHub, preserve existing local commits, and establish fresh CPU/type/lint/native baselines. Map every requirement in brief sections 3–14 to an owner milestone, acceptance test and evidence status. Record executable/client versions by safe discovery, without launching restricted tools. Freeze supported-version matrices when the corresponding integration is implemented; pin test binaries and official contract fixtures before advertising support.

**Gate:** no unassigned requirements; clear distinction between mandatory capabilities, candidate options, unsupported extensions and externally blocked validations. Commit/push the plan and audited baseline first.

### M1 — Discovery, job substrate, packages and first useful recipe

Implement registry discovery and schemas, generalized packages/catalog, source/license ledger and SBOM export, migrations, and durable execution before broad feature growth. Build one complete local crate recipe using existing glTF tooling: explicit dimensions/axes/pivot, LOD chain, box collision, target validation, CPU contact sheet and verified package. Store provenance graph-ready entity IDs immediately.

**Gate:** crate succeeds without provider credentials; typed invalid-call recovery; altered backend/input/budget/upload invalidates approval; concurrent identical submissions produce one job; crash/reconnect/recovery creates no duplicate charge; package v1 remains readable and rollback restores prior mutable state.

### M2 — Mesh, animation and target delivery

Extend Blender scripts through the existing bounded runner, using isolated job directories, factory settings, disabled embedded-script execution, JSON I/O, explicit tool identity and editable `.blend` outputs. Add parameterized props/modular geometry, selective repair, UV/tangent workflows, topology/error budgets, collision profiles, instancing preservation and coherent LOD chains. Treat open surfaces and mirrored/overlapping UVs according to declared intent. Preserve skin/morph/custom attributes or disclose export losses before execution.

Add skeleton/bind-pose/weight validation; authored/imported clips; extraction, trim, loop, resample, smoothing and compression where supported; rest-pose-aware retarget maps; root motion and event preservation. Add reversible IK/contact correction and blend previews with measured trajectory changes. Foot sliding, penetration and continuity remain qualified diagnostics. Imported humanoid routes refuse unsupported anatomy.

Add declarative target profiles and inspect-plan-reimport with additions/replacements/removals, override conflicts, stable target IDs, pre-write source drift checks and receipts/rollback.

**Gate:** complete crate and humanoid walk/idle packages; negative/nonuniform scales, handedness, instancing, UV seams/zero areas, skeleton mismatch, zero-length bones, quaternion sign changes, morph loss, root drift and sample-accurate event offsets tested. Blender round trips/render previews must run in CI.

### M3 — Materials, baking and VFX

Implement a versioned material manifest covering map semantics, color space, workflow, normal convention/tangent basis, physical scale, UVs/UDIM capability, packing, alpha, bit depth, provenance and rights. Build editable procedural layers/masks from shared fields so color/roughness/normal/height variants describe the same morphology. Support supplied maps, deliberate workflow conversions and bounded UV/surface brush/stencil edits with undoable checkpoints.

Add high-to-low mesh baking with cage/ray/UV/padding settings, seam/texel-density/tiling diagnostics, named packing profiles, normal conversion, mip/compression checks, and controlled sphere/plane/mesh/repeat/grazing-light previews. Export source map values independently of display transforms. Add decals/trim-sheet/atlas routes with tested semantics; unsupported material extensions or UDIM consumption get explicit refusals or reviewed fallbacks.

Extend recipes to seeded simulation/render-to-flipbook, frame atlas layout, padding, timing, alpha/premultiplication and available auxiliary buffers, with renderer/shader requirements recorded.

**Gate:** two-metre weathered-stone family with six coherent variants, an authored material and a complete flipbook package. Golden gamma/packing/normal tests; mirrored seams, intentional overlap, atlas bleed, transparency, displacement and mip stress cases; real baking/render/reimport fixtures on supported CI targets.

### M4 — Audio production and event banks

Implement bounded WAV inspection and deterministic DSP/synthesis first: layers, envelopes, seeded noise/oscillators, trim/fades, sample-rate/channel conversion, gain, DC/silence/clipping analysis, loops and attack/sustain/release. Add typed FFmpeg plans for supported codecs, loudness and true-peak methods, recording exact build/license and measurement applicability. Do not call oversampling or RMS an exact loudness/true-peak standard without method validation. Preserve transients by default; retain PCM masters, dither and codec-padding decisions.

Add variation families, before/after and loop audition reels, diversity diagnostics, positional/stereo roles, and event-bank weights/nonrepeat/cooldown/concurrency metadata. Correlate runtime triggers/voices/animation cues only where an adapter observes them.

**Gate:** six stone footsteps with metadata and audition; deterministic synthesis, sample-accurate edits, impulse/silence/short-clip/NaN/DC/clipping/phase-cancellation/Unicode/long-file fixtures; no unintended output clipping. Demonstrate event-bank loading and observed audio-event/timing correlation through an engine-neutral probe sample. Engine-specific bank imports belong to deferred M7 and are not a completion gate or compatibility claim for this phase.

### M5 — Incremental source/asset/runtime graph

Use existing `node:sqlite` infrastructure for adjacency, searchable metadata and transactional index generations. Import files/manifests/packages/recipes/glTF/captures first. Use SCIP for semantic indexes, initially TypeScript/JavaScript, followed by C/C++ with actual compilation database, C# and Python when their indexers are present. Consume official generated bindings or a reviewed schema decoder; do not invent semantic calls from text. LSP is optional interactive enrichment; syntax fallback is explicitly syntax-only. SCIP's format/indexer boundaries are documented at https://github.com/scip-code/scip.

Every edge carries extraction origin/method, confidence, source hash/revision, build scope and validity. Stage incremental updates transactionally, invalidate changed dependencies, handle rename/delete/generated files/cycles/unresolved edges, and expose stale or mixed revisions. Bounded queries return definite versus possible impact, provenance paths and suggested recapture scenarios.

Extend the existing C/Swift/Rust probe protocol through negotiated capabilities for paginated scene snapshots/deltas and explicit runtime-to-asset/source maps. Runtime IDs are scoped to session/run/frame; reconnect cannot reuse stale mappings. Link capture pixel IDs to object, mesh/material, shader/source only when observed bindings exist.

**Gate:** incremental equals clean rebuild across dirty overlays, renames, deletes and interrupted writes; ambiguous runtime IDs, dynamic spawn/despawn/reload, cycles and missing maps remain honest; bounded queries retain evidence links. Benchmark representative small/medium/large fixture graphs before publishing limits.

### M6 — Optional production/library backends

Harden current Tripo/Leonardo contracts and uncertain-outcome accounting first. Then add independently useful, capability-gated work packages in order: Poly Haven discovery/provenance, Meshy mesh/retexture/rig/actions, ElevenLabs SFX, DeepMotion account-enabled video motion, and licensed Substance published-parameter/bake routes. Each needs a pinned contract, backend doctor, create/status/download/cancel semantics where available, fixture coverage, output QA and a source/license/entitlement ledger entry.

Mixamo is user-downloaded import and local retarget only; no unsupported login automation. Neural reconstruction, splats, cloth/hair, and specialized facial routes get separate qualified connectors only if selected, licensed and demonstrated; do not advertise nonexistent backends.

**Gate:** denial yields zero external calls; timeout and repeated submission never blindly regenerate; local cancellation makes no remote-refund promise. Live tests remain blocked until the exact account, rights, upload and spend authority is supplied. Fixture-complete connectors are labelled accordingly, not production-verified.

### M7 — Deferred engine adapters (outside this phase)

The owner explicitly deferred Godot, Unity, and Unreal implementation until after the engine-neutral platform and probe SDK. Do not start adapter code, engine installation, or engine-specific validation under this phase. Retain the following requirements for a future separately authorized phase; its order and tested versions will be chosen then. Each adapter must reuse shared probe, graph, recipe, package and capture contracts.

Godot uses documented editor/debugger/resource UID/dependency APIs. Unity separates editor AssetDatabase GUID maps from the player probe and discovers available ProfilerRecorder counters; rendering support is pipeline-specific. Unreal separates editor Asset Registry/Python automation from a C++ runtime module and native Insights artifacts. Pin actual tested engine/renderer/build versions; preserve declared versus dynamic dependencies and missing counters.

**Future gate per engine:** fixture project with mesh, material, animation, nested scenes, dynamic spawn and audio events; import/reimport preserves overrides or reports conflict; editor/player evidence is distinct; sealed scenario and runtime object-to-source joins verify; unsupported render diagnostics are refused. These requirements do not block completion of the current engine-neutral phase.

### M8 — Profilers, controlled experiments and temporal depth

Extend current JSON trace import rather than duplicate it: async/flow events, counters, queues/threads, explicit clocks/units, overlap-aware inclusive/exclusive time and separate CPU submission/GPU execution/wall latency. Keep native traces and normalized derived artifacts. Add version-pinned Perfetto Trace Processor with fixed bounded query templates, then Tracy instrumentation/export and overhead/disabled-probe tests. Perfetto's SQL backend is documented at https://perfetto.dev/docs/analysis/trace-processor.

Add separate constrained RenderDoc replay workers on supported graphics APIs; Metal uses Apple programmatic capture/Xcode fallback and feature-detected gpucapture/gpudebug. Add versioned xctrace template/export parsing where available. Never parse undocumented `.gputrace` internals as a stable API. Apple's documented gpucapture route requires macOS 27+, so macOS 26 remains an explicit fallback path: https://github.com/apple/game-porting-toolkit/blob/main/game-porting-skills/skills/using-gpucapture/SKILL.md.

Implement planned repeated paired baseline/candidate experiments with alternating order, explicit scenario/assets/revision/hardware/driver/build/resolution/quality/seed/warmup/window controls, run-level effect/uncertainty and inconclusive results. Frames are not independent trials. Bind optimization acceptance to required controls, admitted measurement provenance, visual limits and goal direction.

Extend temporal analysis with aligned motion/depth/camera/history/disocclusion evidence for flicker/popping/ghosting, deliberate-motion false positives, annotated sequences and graph links. Missing buffers reduce capability instead of synthesizing certainty.

**Gate:** overlapping/async trace fixtures, clock mismatch refusals, known statistical coverage/noise/underpower cases, controlled temporal false positives, instrumented real profiler sample with nonempty artifacts and at least one evidence-limited real diagnosis on an authorized CI target. Unavailable GPU/platform lanes remain open blockers.

### M9 — Replay, failure investigation and optimization journey

Add adapter-negotiated input recording/replay and checkpoints over the existing probe/live path: input timing, fixed-step policy, seed, initial state, asset/build identities and per-frame state hashes. Report first divergence. Deterministic support requires an engine contract plus repeated agreeing executions; unsupported engines remain best-effort.

Seal crash/assertion/collision/missing-asset/animation-transition failures with inputs, states, logs, frames, diagnostics and provenance. Connect promotion from live exploration, graph impact, replay, bisect and existing isolated optimization. Preserve source-path budgets, tests, capture authority, failure history and drift-checked review before applying patches.

**Gate:** deliberate divergence, crash/cancellation/reconnect and bounded replay/storage; complete bug journey from selected artifact through observed identity/source/scenarios, replay and baseline/candidate evidence, with no fabricated diagnosis.

### M10 — Cross-client/native delivery and release readiness

For every previous milestone, surface relevant inspectors/plans/jobs/previews/graphs/diagnoses in Anvil and preserve legacy Studio compatibility. Keep native use optional. Update shared Swift schemas/catalog from the registry; use Foundation/compile-only tests locally. Native light/dark, keyboard, labels, resize, cancellation and error review needs an authorized remote interactive lane; lack of that lane remains explicit.

Verify pinned actual Codex and Claude clients for discovery, schema use, resources, image/audio/file fallbacks, job lifecycle, disconnect/reconnect, errors and every approval outcome. Protocol fixtures are separate evidence. Keep stdio as default. Add loopback-authenticated, Origin-checked Streamable HTTP only for an established client need, using the same registry and gates; no public listener or deprecated SSE route.

**Gate:** all five agent journeys are executable via CLI and MCP with compact high-level calls, explicit approvals and actionable recovery. Measure completion, calls, context bytes, latency, cancellation and unnecessary regeneration; target a small number of calls rather than concealing decisions. Pass Windows/Linux/macOS package-install lanes, migration/rollback/adversarial tests, runtime/provenance/SBOM checks and deterministic archive verification. Finish capability matrix, migrations, examples, measured limits, readiness report and prepared release notes. No public release is part of this plan.

## 5. Verification, Git and backup cadence

- Before each commit, review the scoped diff and run focused behavioral tests plus relevant schema/transport/native parity tests. Never commit generated outputs, captures, caches, credentials or unrelated changes. Feature gates land with functionality and refusal tests, not as unused stubs.
- Before each pushed milestone, run `npm run typecheck`, `npm run lint`, `npm test`, `npm run verify`, `npm run verify:docs`, the relevant native suites, and installed-package/roster checks. Use existing CPU/mock selectors locally; publish every skipped optional lane. Run real-tool/platform CI against the pushed SHA, review failures, and fix them in the next small commit before dependent integration continues.
- Keep both `swift test --package-path apps/macos/Anvil -j 2` and the retained Studio suite applicable; compile/test the probe's supported language bindings after protocol changes. Use existing archive/runtime/install scripts for exact candidate bytes, not a different development bundle.
- Push normal fast-forward commits to `origin/main`; never force-push. Re-read remote state before every push. If concurrent work appears, preserve it, integrate without rewriting history, and rerun affected validation. Initial pending main commits differ from GitHub only in documentation; preserve and push their history with the plan checkpoint.
- Update this plan's coverage/evidence ledger and changelog at every milestone. Report commit SHA, checks, CI evidence, blocker and next action. A blocker pauses only dependent work; it cannot justify marking the whole roadmap complete.
- Maintain one current T7 backup at the existing project backup location, preserving full main history and referenced LFS objects. Check available space and backup-only refs/objects before replacement; preserve anything main does not contain. Follow the existing daily backup exclusions for build/dist/captures/caches/venvs/node_modules/DerivedData; no iCloud or dated snapshots. Verify backup main matches the final checkpoint. Do not relocate DailyWork or archived sessions.

## 6. Tracking and exit criteria

| Work | Source | Fixtures | Real tool/client | Human review |
| --- | --- | --- | --- | --- |
| M0 baseline and coverage | 153 requirement rows assigned | CPU baseline passed | optional lanes not exercised | not requested |
| M1 foundation | discovery, durable storage, ledger, multi-kind packages, explicit migration and local crate journey implemented; background execution/full recipe integration open | focused contracts and refreshed CPU suite passed; see progress record | CLI/MCP CPU fixtures only | not reviewed |
| M2 mesh/animation | not started | not started | CI required | not reviewed |
| M3 materials/VFX | not started | not started | CI required | not reviewed |
| M4 audio | not started | not started | CI required | not reviewed |
| M5 graph/probe | not started | not started | real indexer/probe required | not reviewed |
| M6 optional backends | not started | not started | accounts/tools gated | not reviewed |
| M7 engines | deferred; outside this phase | not applicable to this phase | not applicable to this phase | not applicable to this phase |
| M8 profiling/experiments | not started | not started | supported real target required | not reviewed |
| M9 replay/investigation | not started | not started | supported real target required | not reviewed |
| M10 delivery/readiness | not started | not started | real clients/native lane required | not reviewed |

Implementation order: M0 → M1 → M2 → M3 → M4 → M5 → M8 → M9 → M10. M6 can proceed independently after M1 prerequisites. M7 is deferred and cannot run alongside these milestones. Use engine-neutral fixtures and the probe SDK for graph/runtime joins, audio events, replay and failure investigation. Relevant acceptance is integrated into each slice rather than postponed to M10.

Completion of this phase requires every engine-neutral platform and probe-SDK requirement mapped and satisfied at its declared evidence level. Godot, Unity, and Unreal adapter requirements remain explicitly deferred and are excluded from this phase's completion criteria; finishing this phase does not complete those adapters. Optional integrations must be implemented and qualified for an explicitly supported combination or clearly recorded as unsupported/blocked with the exact prerequisite and remaining test. A fixture-only connector or a skipped real test cannot count as full production support. No claim of universal engine compatibility, aesthetic quality, causal speedup or target-hardware performance follows from a CPU preview or synthetic fixture.
