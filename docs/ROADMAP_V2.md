# Roadmap v2: implementation plan

This is the checked-in plan for the brief *Game Development Studio: full-roadmap implementation prompt* (research date 23 October 2026). It records the capability audit, the rules every slice follows, the milestones in dependency order with their acceptance tests, the deferred or blocked work, and the decision log.

**Status: planned only.** Nothing below is implemented unless the audit marks it **implemented** against v1.5.1. No milestone starts without the owner's go-ahead.

## Owner decisions (23 October 2026)

| Topic | Decision |
| --- | --- |
| Execution | Plan only for now. Milestone 1 starts when the owner says so. |
| Git | Commit and push to `main` as slices land. No tag or release unless asked. This overrides the brief's "do not push". |
| Real tools | **Fixtures only locally.** No local Blender or GPU launches. Real-tool evidence comes from CI runners. |
| Engine adapters | None yet. The C/Swift/Rust probe SDK is the only runtime path. Godot, Unity and Unreal are deferred. |
| Providers | New connectors stay fixture-only and report "not configured" until the owner grants accounts. |

Locally installed tools, recorded for completeness but not run: Blender.app, FFmpeg 9.0.1, Tracy, clangd, Apple `gpucapture` (macOS 27.0.1). Not installed: Godot, Unity, Unreal, Perfetto `trace_processor`, Rust toolchain, RenderDoc.

## 1. Capability audit (v1.5.1)

Three agents audited the code itself (not the docs). The registry holds **109** operations in 24 `src/tools/*.ts` files.

### Brief §3: connected code/asset/runtime graph (Slice A)

| Capability | Status | Where |
| --- | --- | --- |
| Asset catalog | Implemented | `src/packages/catalog.ts` (`node:sqlite`, WAL, rebuildable) |
| Package provenance | Implemented | `src/packages/format.ts` (`asset_provenance.v1`, parent packages) |
| Code / shader / symbol graph | Missing | — |
| Runtime object ID → asset → source | Missing | Only `object_id` / `material_id` rasters and `gdprobe_attach_ids` |
| Impact queries | Missing | — |

### Brief §4: meshes and animation (Slice B)

| Capability | Status | Where |
| --- | --- | --- |
| Blender runner, receipts, checkpoints | Implemented | `src/util/blender.ts`, `src/domain/blender-receipt.ts`, `src/storage/mesh-checkpoints.ts` |
| Blender version detection | Partial | Executable hash only; version is script-reported |
| Inspection | Implemented | `src/inspection/gltf.ts` |
| Normalize / weld / UV / decimate | Implemented | `normalize_mesh`, `scripts/blender_normalize.py` |
| Budgets | Implemented | `src/domain/asset-policy.ts`, `validate_game_asset`, `validate_platform_asset` |
| Units / pivot / axis / handedness | Partial | Dimension bounds only |
| LOD | Partial | Per-LOD separate packages; no LOD chain object |
| Collision | Implemented | `prepare_collision_box`, CoACD (`src/collision/*`) |
| Retopology | Partial | Tripo `refine_model` only |
| Procedural mesh construction | Missing | — |
| Rig / retarget | Partial | Tripo `animate_rig` / `animate_retarget` only |
| Animation inspection and previews | Partial | `inspect_review_animation`, `src/review/pose.ts`, `timeline.ts` |
| Skeleton / weight validation, local retarget, motion QA | Missing | — |

### Brief §5: PBR materials and VFX (Slice C)

| Capability | Status | Where |
| --- | --- | --- |
| PBR plane extraction with colour space | Implemented | `extract_pbr_trio` (`src/tools/pbr.ts`) |
| Linear-light resize, normal renormalise | Implemented | `prepare_texture_variant` |
| Basis/KTX2 with CPU mip verification | Implemented | `src/production/compression.ts`, `basis.ts`, `ktx2.ts` |
| CPU appearance review | Implemented | `gds-cpu-review@2.2.0` (`src/review/*`) |
| Material manifest, normal convention, tangent basis | Missing | — |
| Procedural material generation, tiling metrics | Missing | — |
| Channel-packing target profiles | Missing | — |
| Baking | Missing | Provider `bake` flag only |
| Flipbooks / VFX | Missing | — |

### Brief §6: audio (Slice D)

| Capability | Status | Where |
| --- | --- | --- |
| Provider sound generation | Implemented | `generate_sound_effect` (Leonardo) |
| Any DSP, analysis, loudness, loops, variation sets | Missing | — |

### Brief §7: profiler and temporal depth (Slice E)

| Capability | Status | Where |
| --- | --- | --- |
| Telemetry v1/v2 spans, `measured_by` | Implemented | `src/harness/contracts.ts` |
| Chrome/Perfetto JSON `X` and `B`/`E` spans, breakdown | Implemented | `src/harness/spans.ts` |
| Async (`b`/`e`/`n`) and flow events | Missing | — |
| Separability (2 SE), warmup, control comparability | Implemented | `src/harness/performance.ts` |
| Repeated alternating runs, effect size, CIs | Missing | — |
| Required experiment metadata (driver, seed) | Partial | Free-form `adapterEvidence.hardware/build` |
| Temporal flicker / popping / pacing | Implemented | `src/harness/temporal.ts` |
| Motion/depth-aware temporal analysis | Missing | `motion` kind exists, unused |
| `trace_processor`, Tracy, gpucapture | Missing | — |

### Brief §8: reproducible gameplay (Slice F)

| Capability | Status | Where |
| --- | --- | --- |
| Live sessions (snapshot, query, pause, step) | Implemented | `src/harness/session.ts`, `probe/c/gdprobe_session.c` |
| Scene snapshots / deltas | Missing | Free-text `state_query` only |
| Bisect | Implemented | `src/harness/bisect.ts` |
| Input record/replay, state hashes, divergence | Missing | — |
| Failure bundles | Partial | Run `failure{code,message}` and diagnostics diffs only |

### Brief §9–10, §14: platform and agent API

| Capability | Status | Where |
| --- | --- | --- |
| One registry for CLI and MCP | Implemented | `src/commands/registry.ts`, `register.ts` |
| Schemas in discovery | Partial | MCP `tools/list` only; `capabilities` lists argument names |
| Progressive discovery | Missing | 109 flat tools |
| Spend / execution / project-write gates | Implemented | `src/mcp/spend-gate.ts`, `execution-gate.ts` |
| Production recipes (closed vocabulary) | Implemented | `src/production/recipes.ts` (18 operations) |
| Intent-level asset API | Missing | — |
| Durable jobs | Partial | `src/jobs/durable.ts`; no idempotency key, heartbeat, generic checkpoints |
| MCP Tasks, Streamable HTTP | Missing | SDK 1.30.0, stdio only |
| Migrations | Partial | `migrate legacy` only |
| Licence handling | Partial | Per-package licence, unknown-licence block; no ledger or asset SBOM |

## 2. Rules for every slice

1. **One registry.** Every operation is reachable by CLI and MCP, with these registrations:
   - `src/tools/*`;
   - `FREE_TOOLS` / `TOOL_COSTS` (`src/domain/spend.ts`);
   - `EXECUTION_TOOLS` / `PROJECT_WRITE_TOOLS` (`src/mcp/execution-gate.ts`), and `ROADMAP_MUTATION_TOOLS` where relevant;
   - `KNOWN_FLAGS` and a HELP line;
   - `EXPECTED_TOOLS` (`scripts/verify-install.mjs`);
   - the skill references;
   - Anvil `CommandCatalog+Tools.swift` / `+CLI.swift` and `RoadmapToolSchemas.swift`.

   `swift test --package-path apps/macos/Anvil` runs before every push.
2. **Evidence.** Every result keeps an `evidenceCeiling` and `z.literal(false)` impossible-claim fields. Facts carry their origin: `measured`, `engine-reported`, `heuristic`, `synthetic`, `human-approved`. Prose says "consistent with", never "because".
3. **Authority.** No model-writable approval input. Spend, execution and project writes keep the human-written ceiling plus per-call elicitation, and fail closed on decline, cancel, timeout or malformed answers. Every gated write has a free `plan_*` twin, and approval binds to the plan fingerprint.
4. **Real tools run in CI, not locally.**
   - Prefer pure-JS cores, which stay deterministic and fixture-testable: gltf-transform geometry, PNG/noise maths for materials, a WAV reader for audio analysis.
   - Blender (existing `blender` job), FFmpeg (new job) and `trace_processor` (new job) run on hosted runners.
   - `gpucapture` needs macOS 27; it is **blocked** until a runner or local authorisation exists.
5. **Four statuses per item.** Source implemented · fixtures passed · real tool exercised · human quality review. Never collapse them into one "supported" mark.
6. **Closed task vocabulary.** No arbitrary shell, Python, FFmpeg expression, URL or path as an asset-generation input. Any expert escape hatch is separately named and gated, and excluded from the normal recipes.

## 3. Milestones

Dependency order: M1 → M2 → M3 → M5. M4 can run alongside M3 once the M1 job substrate exists. M6 closes.

### M1. Foundation and honest discovery

| Deliverable | Notes | Depends on |
| --- | --- | --- |
| `discover_operations`, `describe_operation` | Compact families, recipes, installed tool versions, providers, authority needs, cost basis; schema on demand. No tool removed. | — |
| Source/licence ledger `game_dev.source_ledger.v1` | Executables, providers, downloaded assets, models: version, terms URL, acquisition date, entitlement, verification status. CycloneDX SBOM export. Unknown rights still block vendoring. | — |
| Durable job substrate | Extend `DurableJobStore` with idempotency key, heartbeat, checkpoints, and the cancellation states requested / stopped / completed / outcome-uncertain. Adopt for Blender runs, recipe steps, bisect. MCP Tasks where negotiated; job ids otherwise. | — |
| Intent-level asset API | `discover_asset_recipes`, `plan_asset`, `run_asset_plan`, `inspect_asset_result`, `revise_asset_plan`, `finalize_asset` over the recipe engine. Canonical `game_dev.asset_recipe.v1` with resolved defaults, units, ranges, enums; unknown parameters fail. | Job substrate |
| Versioned migrations | `migrate workspace` with backup and rollback; catalog `user_version`. | — |
| First recipe: procedural crate | Pure-JS glTF construction → normalise → LOD → box collision → validate → contact sheet → package. | Asset API |

**Acceptance**

- `describe_operation` schemas equal MCP `tools/list`.
- A changed provider, input asset, cost bound or upload destination invalidates approval.
- Resubmission is idempotent, and a timeout causes no duplicate charge.
- Migration rollback, interrupted write and adversarial path tests pass.
- The crate journey completes in five calls or fewer with no provider configured.

### M2. Local production baseline

| Deliverable | Notes |
| --- | --- |
| Mesh finishing | Axis/unit/pivot/handedness conversion preserving negative scale; validation against declared intent (open surfaces, UV overlap); LOD chain object, optional `MSFT_lod`; per-platform budget profiles in `targets/`; density, normal and UV-island overlays in the CPU renderer. |
| Animation | Skeleton, bind-pose and weight validation; pure-JS trim/loop/resample keeping quaternion sign continuity and events; retarget mapping profiles with rest-pose offsets; qualified discontinuity, foot-sliding and penetration diagnostics; non-humanoid input refused on humanoid routes. |
| Materials | `game_dev.material.v1` (channel semantics, colour space, normal convention, tangent basis, physical scale, packing, provenance, licence); procedural generator where shared height/mask fields drive every map; periodic noise for tiling; named packing profiles; GL↔DX normal conversion; edge, tiling and mip metrics; sphere/plane/repeat/grazing-light previews; Blender high→low bake (CI only). |
| VFX | Frame sequence → flipbook atlas with padding, premultiplication, playback metadata, through the existing recipe and package system. |
| Audio | Pure-JS WAV analysis (peak, ~4× oversampled true peak, DC, silence, RMS, loop-seam discontinuity); procedural synthesis (noise, oscillators, envelopes); FFmpeg typed filter plans as an optional tool (CI only); variation sets; event-bank metadata. |
| Agent journeys 1–4 | Crate, character (fixture humanoid), two-metre tileable stone with six variants, six stone footsteps. |

**Acceptance.** All the brief's difficult fixtures:

- **Materials:** incorrect gamma, normal Y inversion, channel-packed linear maps, mirrored UV seams, intentional overlaps, zero-area UVs, transparent edges, UV atlas bleed.
- **Audio:** silent clips, impulses, sub-second sounds, clipping, DC offset, phase-inverted stereo, loop clicks, encoder padding, Unicode filenames.
- **Animation:** rest-pose differences, zero-length bones, quaternion sign flips, loop seams, root drift, event offsets.

### M3. Game understanding

| Deliverable | Notes |
| --- | --- |
| Graph store | `graph.sqlite3` through `node:sqlite`. Nodes and edges carry origin, extraction method, confidence, source hash, revision and validity scope. Incremental indexing, invalidation, rebuild, bounded traversal. Immutable capture provenance is kept apart from the mutable working-tree index. |
| Importers | Files, manifests, packages, recipes, runs, captures, glTF internals (mesh → material → texture). SCIP index ingestion with a pure-JS protobuf reader; fixture indexes generated in CI by `scip-typescript` / `scip-clang`. Shader references from declared manifests. Text matches are never presented as semantic edges. |
| Runtime bridge | `gdprobe_declare_object` seals a run-scoped object map. Live-session protocol v1.1 adds typed, paginated `scene_snapshot` and deltas. Run IDs join to assets only through the map. |
| Queries | `query_impact` (what to recapture; definite vs possible), `trace_provenance` (runtime object → package → source revision). |
| Engine profiles | Declarative axes, units, packing, mip and budgets; engine-neutral reimport preview with override-conflict reporting. |

**Acceptance.** Fixtures for modification, rename, removal, cycles, stale captures, ambiguous runtime IDs and interrupted updates; incremental results equal a clean rebuild; bounded queries return provenance and uncertainty.

### M4. Optional providers

| Deliverable | Notes |
| --- | --- |
| Tripo / Leonardo hardening | Audit pinned schemas against current docs; contract fixtures; no silent model-ID changes. |
| Meshy, ElevenLabs, DeepMotion, Poly Haven, Substance SAT | Fixture-only connectors behind capability, authority and spend gates; "not configured" until accounts exist; outputs validated by the same local QA. |

**Acceptance.** No provider call after a denial; uncertain outcomes are reconciled before any retry; a local cancel never claims provider work stopped.

### M5. Observe and improve

| Deliverable | Notes |
| --- | --- |
| Trace normalisation | `game_dev.trace.v1`: spans, counters, thread/queue identity, inclusive/exclusive time, async and flow events; clock and unit mismatches refused. |
| Native trace adapters | `trace_processor` (PerfettoSQL templates with the processor version recorded) and Tracy (`tracy-csvexport`); real lanes in CI. `gpucapture` / `gpudebug`: discovery and sealing only; real runs blocked. |
| Controlled experiments | `plan_experiment` / `run_experiment`: alternating ABAB runs, required metadata (hardware, driver, seed, build, resolution), run-level bootstrap intervals and effect size, an inconclusive verdict. Optimisation goals may require one. |
| Temporal depth | Motion-vector reprojection to separate camera and animation from flicker; ghosting and disocclusion signals; findings linked to graph entities. |
| Replay | Probe replay API (inputs with timing, fixed-step policy, seed, per-frame state hash); `record_replay` / `run_replay` reporting the first divergence; a determinism claim only when the engine declares it and two runs verify it; `game_dev.failure_bundle.v1` linking live sessions, bisect and the graph. |
| Agent journey 5 | From a selected visual artefact to object identity, provenance, affected shader and scenarios, replay and candidate comparison. |

**Acceptance.** Overlapping-trace tests; known-good and known-bad statistical fixtures; false-positive cases; deliberate divergence; downgrade for an unsupported engine; crash and cancellation recovery; bounded storage.

### M6. Production hardening

- Real Codex and Claude client matrix, with versions recorded and kept separate from protocol fixtures.
- Streamable HTTP only if a client needs it.
- Windows, Linux and macOS lanes.
- Adversarial path, symlink, oversized-payload, subprocess, interrupted-write and secret-redaction tests.
- Final documents: capability matrix, migration guide, executable examples, measured performance and storage limits, release-readiness report, release notes (prepared, not published).

## 4. Status tracker

Updated as slices land. The columns are the four independent statuses from rule 5.

| Milestone | Source | Fixtures | Real tool (CI) | Human review |
| --- | --- | --- | --- | --- |
| M1 | not started | — | — | — |
| M2 | not started | — | — | — |
| M3 | not started | — | — | — |
| M4 | not started | — | — | — |
| M5 | not started | — | — | — |
| M6 | not started | — | — | — |

## 5. Deferred or blocked

| Item | Blocked on | Remaining scope |
| --- | --- | --- |
| Godot / Unity / Unreal adapters | Owner decision (23 Oct) | Engine-specific import, runtime graph, audio-event correlation; fixture engine only meanwhile |
| RenderDoc | Not installed; no Metal support | Vulkan/D3D/GL replay worker |
| `gpucapture` real runs | Fixtures-only policy; no macOS 27 hosted runner | Real capture, texture extraction |
| Substance SAT, DeepMotion, Meshy, ElevenLabs | Accounts, entitlements, terms | Live integration tests |
| Mixamo | No supported automation API | Import of user-downloaded files only |
| Photogrammetry, Gaussian splats, cloth/hair, painting parity, facial transfer | Out of initial scope, as the brief allows | Separate acceptance fixtures if taken up |

## 6. Decision log

| Decision | Reason | Rejected |
| --- | --- | --- |
| SQLite (`node:sqlite`) for the graph | Already a dependency through the catalog; no new native module; measured scale does not need more | A graph database |
| SCIP as the durable code index | Compiler-accurate and language-agnostic; files are produced by user-installed indexers and read offline | LSP as a whole-repo index; text search as semantic edges |
| Pure-JS geometry, material and audio cores | Deterministic, fixture-testable, keeps the npm package free of native code | Blender or FFmpeg as hard dependencies |
| Real tools only in CI | Owner policy; protects the shared dev machine | Local Blender/GPU launches |
| No engine adapter in v2 | Owner decision; the probe SDK already covers custom engines | Godot first |
