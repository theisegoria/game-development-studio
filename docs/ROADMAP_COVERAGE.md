# Full-roadmap requirement coverage ledger

Baseline: 23 October 2026. Source: owner-supplied `Game_Development_Studio_Full_Roadmap_Implementation_Prompt.md`, SHA-256 `69f8a7a60999ee4efc17f11b5cdfa02d4dad2e170f6be0d9a19cc3c672be71be`. Scope follows `ROADMAP_V2.md`: Godot/Unity/Unreal deferred. Each non-heading paragraph/list item in sections 3–14 is preserved verbatim below, including researched constraints, acceptance lists, and source citations. Atomic clauses inside a row are conjunctive obligations: a row cannot pass while any clause is open. IDs remain stable; add suffixes when splitting a row. Source-only research/citation rows remain tracked evidence prerequisites, never runtime proof.

## Evidence policy and inspected baseline

Every row started OPEN: source coverage was partial/reuse candidate, automated fixtures NOT RERUN, real tools/clients NOT EXERCISED, human review NOT PERFORMED in the initial audit. Subsequent row updates and [execution evidence](ROADMAP_PROGRESS.md) distinguish implemented clauses and rerun fixtures from the obligations still open. Existing paths are relevant anchors, not proof that the whole requirement exists. `src/production/recipes.ts` was inspected: v1 bounded step/checkpoint records exist, but its operation enum is mesh/provider oriented. `src/tools/audio.ts` was inspected: provider generation explicitly describes its live response as unverified; it is not a local DSP pipeline. `src/harness/spans.ts` was inspected: bounded complete/B/E JSON spans and CPU/GPU domains exist; this does not establish native processor/async support. `src/commands/registry.ts` was inspected: shared typed registration exists. Other listed paths were located in the source inventory, not exhaustively validated. No tools installed, apps/Blender/GPU launched, paid calls made, or tests run by that documentation audit.

Required real Blender/GPU/native/client checks remain OPEN until authorized CI or remote interactive execution supplies artifacts and exact tested versions. Absence of entitlement can block conditional integration qualification, but cannot pass it. Shared delivery requirements apply to every milestone, not only M10. Section 10 numbered journeys additionally map crate M1/M2, character M2, material M3, sound M4, bug M5/M9; their metrics and transport checks map M10.

## Requirement inventory

### R03-001 — 3. Slice A: connected code, asset, and runtime graph

Implement a locally queryable graph connecting source files, symbols, shaders, pipelines, resources, materials, meshes, skeletons, animations, scenes, tests, capture scenarios, runtime object IDs, diagnostics, and profiler spans.

- Assignment: **M5**; required engine-neutral platform/SDK.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Incremental/clean rebuild parity; rename/delete/dirty/generated/cycle/unresolved fixtures; transactional interruption; bounded provenance queries and run-scoped joins; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R03-002 — 3. Slice A: connected code, asset, and runtime graph

Begin with reliable file/manifest/package relationships and one supported language/compiler integration selected from repository needs. Use parsers or compiler outputs where available; do not silently present text-search relationships as semantic dependencies. Keep importer interfaces extensible without inventing empty engine backends.

- Assignment: **M5**; required engine-neutral platform/SDK.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Incremental/clean rebuild parity; rename/delete/dirty/generated/cycle/unresolved fixtures; transactional interruption; bounded provenance queries and run-scoped joins; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R03-003 — 3. Slice A: connected code, asset, and runtime graph

Each edge records origin, extraction method, confidence, source hash/revision, and validity scope. Scope runtime object IDs to their run/session and map them to persistent entities only with evidence. Handle renames, deletes, generated files, unresolved references, cycles, and unavailable sources.

- Assignment: **M5**; required engine-neutral platform/SDK.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Incremental/clean rebuild parity; rename/delete/dirty/generated/cycle/unresolved fixtures; transactional interruption; bounded provenance queries and run-scoped joins; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R03-004 — 3. Slice A: connected code, asset, and runtime graph

Implement incremental indexing, explicit invalidation, rebuildability, transaction safety, and bounded traversal. Separate immutable capture provenance from mutable working-tree indexes. Queries must disclose stale/mixed revisions and allow callers to require freshness. A graph database is optional; choose the simplest storage supported by measured requirements, reusing existing SQLite infrastructure where appropriate.

- Assignment: **M5**; required engine-neutral platform/SDK.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Incremental/clean rebuild parity; rename/delete/dirty/generated/cycle/unresolved fixtures; transactional interruption; bounded provenance queries and run-scoped joins; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R03-005 — 3. Slice A: connected code, asset, and runtime graph

Deliver impact queries such as: which scenes, tests, materials, and captures might be affected by this shader change; which package supplied this runtime object; which source revision produced this asset; what should be recaptured? Report definite dependencies separately from possible ones. Missing/unused asset findings remain advisory, never automatic deletion.

- Assignment: **M5**; required engine-neutral platform/SDK.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Incremental/clean rebuild parity; rename/delete/dirty/generated/cycle/unresolved fixtures; transactional interruption; bounded provenance queries and run-scoped joins; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R03-006 — 3. Slice A: connected code, asset, and runtime graph

Acceptance: fixtures covering modification, rename, removal, stale captures, ambiguous runtime IDs, cycles, and interrupted updates; incremental results match a clean rebuild; bounded queries return provenance and uncertainty.

- Assignment: **M5**; required engine-neutral platform/SDK.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Incremental/clean rebuild parity; rename/delete/dirty/generated/cycle/unresolved fixtures; transactional interruption; bounded provenance queries and run-scoped joins; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R04-001 — 4. Slice B: production-ready meshes and animation

Extend existing production recipes into a complete inspect-plan-transform-validate-preview-package workflow. Preserve editable sources alongside derived artifacts.

- Assignment: **M2**; required engine-neutral platform/SDK.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R04-002 — 4. Slice B: production-ready meshes and animation

Mesh operations should cover units and coordinate conventions, scale and pivot, transforms, normals/tangents, material slots, UV checks, manifold/degenerate geometry diagnostics, topology budgets, LODs, collision proxies, and target profiles. Reuse current Blender, provider, compression, and convex-decomposition integrations. Optional generation is a provider adapter, not a prerequisite for local finishing.

- Assignment: **M2**; required engine-neutral platform/SDK.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R04-003 — 4. Slice B: production-ready meshes and animation

Classify validations correctly: manifold requirements vary by use; open surfaces may be intentional; UV overlap may be intentional for tiling or mirroring. Validate against declared intent rather than universal rules. Preserve negative scale/handedness semantics and test exports. Record lossy transforms and approximation error; never silently overwrite sources.

- Assignment: **M2**; required engine-neutral platform/SDK.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R04-004 — 4. Slice B: production-ready meshes and animation

Animation operations should inspect skeleton hierarchy and bind poses; validate names, scales, weights, missing bones, animation ranges, and required root motion; support existing rig/retarget paths, clip extraction, trimming, looping, resampling, and compression where supported. Preserve events and timing. Provide pose/contact-sheet and sequence previews plus numerical checks for discontinuities, foot sliding, and penetration as qualified diagnostics, not guaranteed perceptual judgments.

- Assignment: **M2**; required engine-neutral platform/SDK.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R04-005 — 4. Slice B: production-ready meshes and animation

Acceptance: deterministic fixture processing, cancellation/recovery, malformed-input bounds, round-trip checks, skeleton mismatch refusals, target budget reports, and a real end-to-end mesh-plus-animation package. Character quality still requires human review.

- Assignment: **M2**; required engine-neutral platform/SDK.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R05-001 — 5. Slice C: physically coherent PBR materials and VFX

Build a material workflow, not merely an image-generation wrapper. Support procedural recipes, supplied/scanned maps, high-to-low baking, and optional licensed provider-generated candidates. Record whether parameters are authored, measured, baked, or inferred. A single photograph does not uniquely determine albedo, roughness, normals, or lighting; inferred maps must never be advertised as measured ground truth.

- Assignment: **M3**; required engine-neutral platform/SDK.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R05-002 — 5. Slice C: physically coherent PBR materials and VFX

Define a versioned material manifest: workflow, maps, channel semantics, color spaces, normal convention, tangent basis, physical scale, texture dimensions, bit depth, value ranges, alpha mode, UV sets, packing, provenance, and license. Keep metallic-roughness as an explicit profile; support other workflows through documented conversion with loss/ambiguity warnings.

- Assignment: **M3**; required engine-neutral platform/SDK.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R05-003 — 5. Slice C: physically coherent PBR materials and VFX

Implement base color without intended baked lighting, roughness, metallic, normal, height/displacement, AO, and emission as applicable. Validate maps independently and together. Respect sRGB versus linear data, preserve signed/vector semantics, and never blindly gamma-correct data maps. Normal Y orientation, handedness, tangent generation, and renderer conventions must be explicit. Distinguish height units and midpoint from arbitrary normalized values.

- Assignment: **M3**; required engine-neutral platform/SDK.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R05-004 — 5. Slice C: physically coherent PBR materials and VFX

Add mesh-aware baking with configurable cage/ray settings, padding, resolution, UV sets, and overlap policy. Support seamless tiling with edge metrics and repeated-surface previews; continuity metrics do not prove a convincing material. Generate channel-packed exports from named target profiles, not assumed universal ORM conventions. Reuse existing compression and mip verification. Treat UDIM and unsupported extensions as declared capabilities, not silently flattened inputs.

- Assignment: **M3**; required engine-neutral platform/SDK.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R05-005 — 5. Slice C: physically coherent PBR materials and VFX

Preview on standard sphere, plane, and representative mesh under several controlled lighting environments, with fixed exposure and color management. Provide before/after and channel inspection. Include physical-scale checks and roughness/metal response stress cases. Numerical sanity and energy/plausibility checks must be separated from artistic approval.

- Assignment: **M3**; required engine-neutral platform/SDK.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R05-006 — 5. Slice C: physically coherent PBR materials and VFX

Extend VFX recipes to simulation/render-to-flipbook workflows: frame ranges, atlas layout, padding, playback metadata, alpha/premultiplication, normals/depth/emission when available, and engine-specific shader requirements. Reuse recipes and packaging rather than building a second asset system.

- Assignment: **M3**; required engine-neutral platform/SDK.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R05-007 — 5. Slice C: physically coherent PBR materials and VFX

Acceptance: color-space/channel-packing golden fixtures, normal-convention tests, bake/mip/tiling diagnostics, transparent-edge tests, round-trip target profiles, and one complete authored material plus one flipbook package with inspectable previews. Rendering integration must be tested per supported target.

- Assignment: **M3**; required engine-neutral platform/SDK.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R06-001 — 6. Slice D: audio effects production and quality assurance

Extend existing audio generation with a local processing pipeline for supplied recordings, procedural synthesis, layered effects, and optional generated candidates. Implement trimming, fades, resampling, channel conversion, normalization, clipping/true-peak checks where supported, DC offset, silence analysis, loop construction, variation sets, and target-format export.

- Assignment: **M4**; required engine-neutral platform/SDK.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R06-002 — 6. Slice D: audio effects production and quality assurance

Store source hashes, processing parameters, seed where applicable, sample rate, channels, duration, loudness methodology, license, provenance, and intended playback role. Do not enforce one loudness target across dialogue, impacts, ambience, and music. Silence and short duration can make integrated loudness misleading; report inapplicable measurements honestly.

- Assignment: **M4**; required engine-neutral platform/SDK.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R06-003 — 6. Slice D: audio effects production and quality assurance

Preserve transients; avoid destructive normalization by default. Produce auditionable before/after clips and loop-boundary previews. Distinguish bounded sample discontinuity from perceptual seamlessness. Validate variation diversity without promising that metrics establish artistic quality.

- Assignment: **M4**; required engine-neutral platform/SDK.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R06-004 — 6. Slice D: audio effects production and quality assurance

Where an engine adapter supplies audio events, correlate triggers, voices, dropped events, animation cues, and timing. Do not infer absent events from an adapter that cannot observe them. Provide event-bank metadata and one demonstrated integration, not unsupported middleware compatibility claims.

- Assignment: **M4**; required engine-neutral platform/SDK.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R06-005 — 6. Slice D: audio effects production and quality assurance

Acceptance: deterministic DSP fixtures, no unintended clipping, sample-accurate timing tests, loop diagnostics, metadata round-trips, bounded processing, and a complete multi-variation effect package.

- Assignment: **M4**; required engine-neutral platform/SDK.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R07-001 — 7. Slice E: profiler and temporal debugging depth

Extend existing capture and trace machinery. Normalize supported trace formats into versioned spans, counters, thread/queue identities, timestamps, units, and measurement provenance. Start with existing Chrome/Perfetto import and one justified real adapter. Document unsupported trace features. Distinguish CPU submission, GPU execution, overlapping queues, inclusive/exclusive durations, and wall-clock timing; overlapping spans cannot simply be summed.

- Assignment: **M8**; required engine-neutral platform/SDK.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R07-002 — 7. Slice E: profiler and temporal debugging depth

Controlled experiments must capture scenario, revision, assets, hardware, drivers, build configuration, resolution, quality settings, seed, warmup, sampling window, and background-load caveats. Use repeated baseline/candidate runs, alternating order when feasible, distributions and effect sizes with uncertainty. Respect run-level dependence; thousands of correlated frames are not thousands of independent experiments. Small samples, incompatible metadata, missing data, and noisy results should yield inconclusive findings. Do not claim causal speedups from correlation alone.

- Assignment: **M8**; required engine-neutral platform/SDK.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R07-003 — 7. Slice E: profiler and temporal debugging depth

Extend temporal analysis using aligned frame sequences and available depth, motion, history, object/material IDs, camera state, and disocclusion signals. Detect candidate flicker, popping, ghosting, instability, and frame pacing anomalies while distinguishing deliberate animation and camera movement. Missing buffers reduce capability explicitly. Provide annotated sequences and links from findings to graph entities and source evidence.

- Assignment: **M8**; required engine-neutral platform/SDK.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R07-004 — 7. Slice E: profiler and temporal debugging depth

Acceptance: known-bad and known-good synthetic fixtures, overlapping-trace tests, clock/unit mismatch refusals, false-positive cases, statistical coverage checks, bounded storage, and one real captured diagnosis with clearly stated evidence limits.

- Assignment: **M8**; required engine-neutral platform/SDK.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R08-001 — 8. Slice F: reproducible gameplay investigation

Add bounded input recording/replay and state checkpoints through optional project adapters. Record input timing, fixed-step policy, random seeds, asset/build hashes, relevant initial state, and environment. Detect divergence through state hashes and present the first mismatch. Only claim deterministic replay when the engine contract supports and verifies it; otherwise label best-effort replay.

- Assignment: **M9**; required engine-neutral platform/SDK.
- Existing anchors: `src/harness/session.ts`, `src/harness/bisect.ts`, `src/optimization/session.ts`.
- Related test anchors (not execution evidence): `tests/optimization-session.test.ts`, `tests/probe-sdk.test.ts`.
- Acceptance: Supported repeated replay/state agreement; first deliberate divergence; crash/reconnect/cancellation/bounded failure bundles; complete artifact-to-source bug journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R08-002 — 8. Slice F: reproducible gameplay investigation

Exercise collisions, animation transitions, missing assets, crashes, and gameplay assertions through scenario fixtures. Produce sealed failure bundles with inputs, state, logs, frames, diagnostics, and provenance. Integrate existing live-session promotion, bisect, optimization budgets, and graph impact queries. Never treat an exploratory live session as immutable proof.

- Assignment: **M9**; required engine-neutral platform/SDK.
- Existing anchors: `src/harness/session.ts`, `src/harness/bisect.ts`, `src/optimization/session.ts`.
- Related test anchors (not execution evidence): `tests/optimization-session.test.ts`, `tests/probe-sdk.test.ts`.
- Acceptance: Supported repeated replay/state agreement; first deliberate divergence; crash/reconnect/cancellation/bounded failure bundles; complete artifact-to-source bug journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R08-003 — 8. Slice F: reproducible gameplay investigation

Acceptance: deterministic supported fixture, deliberate divergence, unsupported-engine downgrade, crash/cancellation recovery, bounded replay, and reproducible failure navigation.

- Assignment: **M9**; required engine-neutral platform/SDK.
- Existing anchors: `src/harness/session.ts`, `src/harness/bisect.ts`, `src/optimization/session.ts`.
- Related test anchors (not execution evidence): `tests/optimization-session.test.ts`, `tests/probe-sdk.test.ts`.
- Acceptance: Supported repeated replay/state agreement; first deliberate divergence; crash/reconnect/cancellation/bounded failure bundles; complete artifact-to-source bug journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R09-001 — 9. Cross-client delivery, migration, and finish criteria

For every slice, ship a complete CLI-to-core-to-MCP path with schemas, tests, help, examples, evidence artifacts, and documentation. Update native-app views where relevant without making GUI availability mandatory. Maintain shared skill/prompt sources and registry parity tests.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R09-002 — 9. Cross-client delivery, migration, and finish criteria

Verify actual Codex and Claude client behavior where available: discovery, resources, images/audio/artifact access, long jobs, cancellation, errors, and approvals. Record client versions and tested capabilities. If a client lacks an approval mechanism, refuse gated actions and provide a safe manual route; never fabricate compatibility. Separate protocol fixture tests from real-client tests.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R09-003 — 9. Cross-client delivery, migration, and finish criteria

Version schemas and provide migrations with backups and rollback tests. Preserve sealed evidence and old manifests; rebuild derived indexes safely. Include adversarial path/symlink, malformed-input, oversized payload, subprocess, cancellation, interrupted-write, and secret-redaction tests.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R09-004 — 9. Cross-client delivery, migration, and finish criteria

Run repository-documented typechecking, linting, unit/integration tests, verification, packaging checks, and relevant platform lanes. Missing Blender, GPU hardware, clients, or provider permission must be reported as untested, not passed. Use offline provider fixtures by default.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R09-005 — 9. Cross-client delivery, migration, and finish criteria

Finish with a capability matrix, migration guide, executable end-to-end examples, measured performance/storage limits, and a release-readiness report listing implemented features, test commands/results, limitations, and remaining blockers. Prepare release notes but do not publish. No unfinished stubs, silently skipped acceptance criteria, fabricated evidence, or “complete” claims based solely on compilation.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-001 — 10. Make asset creation easy for the calling model

The agent-facing product must work at the level of intent: “make six worn-stone material variants for this wall,” not “write a Blender script and guess every texture option.” Implement typed, discoverable recipes that choose safe defaults and expose advanced settings when needed. Names below are proposed operation families, not claims that these commands already exist; map them onto the current registry intelligently.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-002 — 10. Make asset creation easy for the calling model

- Discovery: enumerate recipes, supported input/output types, installed tool versions, configured providers, authorization requirements, estimated cost basis, and capability limits. Return compact results, with schemas and documentation available on demand.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-003 — 10. Make asset creation easy for the calling model

- Planning: accept an asset kind, brief, references, output profile, constraints, quality tier, and optional overrides. Resolve inputs to hashed local artifacts; search the catalog before generating. Produce a reviewable plan describing selected backend, uploads, transformations, defaults, outputs, resource estimates, and approval requirements.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-004 — 10. Make asset creation easy for the calling model

- Execution: run the approved plan and return a durable job handle promptly. Bind approval to the actual plan and inputs; a changed provider, input asset, cost bound, or upload destination requires renewed approval. Default to no paid service and no uploads unless explicitly selected and authorized.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-005 — 10. Make asset creation easy for the calling model

- Inspection: return representative preview images/audio, key measured properties, qualified warnings, source lineage, and actionable next steps. Large artifacts belong in resources rather than inline context dumps.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-006 — 10. Make asset creation easy for the calling model

- Revision: accept semantic changes such as “less glossy,” “shorter tail,” or “keep the silhouette but halve the budget,” translate them into explicit parameter changes, and show the difference. Prefer changing a recipe parameter or processing stage over rerunning paid generation.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-007 — 10. Make asset creation easy for the calling model

- Finalization: package the chosen variant, preserve rejected-candidate lineage without unnecessary duplicate storage, and plan engine admission separately. A preview choice is not permission to overwrite project assets.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-008 — 10. Make asset creation easy for the calling model

Persist a canonical recipe document with resolved defaults and its schema version. Do not rely on a language model remembering defaults across turns. Use explicit units, bounded ranges, enums, and meaningful validation errors. Unknown parameters fail rather than being silently ignored. Enable local presets and style families without locking users to a vendor. Keep generation seeds where supported, but label provider nondeterminism even when a seed was recorded.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-009 — 10. Make asset creation easy for the calling model

Use a closed task vocabulary and reviewed internal scripts for ordinary workflows. Do not expose arbitrary shell, Python, FFmpeg expressions, network URLs, or filesystem paths as a convenient universal asset-generation tool. An expert escape hatch, if justified, is separately named, gated, bounded, and excluded from the normal recipes. Disabling Blender auto-execution is defense in depth, not a complete process sandbox.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-010 — 10. Make asset creation easy for the calling model / Required agent usability scenarios

Implement and test these as complete journeys with a small number of high-level calls, not rigid requirements on particular tool names:

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-011 — 10. Make asset creation easy for the calling model / Required agent usability scenarios

1. A crate: generate or procedurally construct a crate, normalize dimensions, create target LODs and collision, validate, preview, and package. Without provider credentials, offer a local procedural recipe rather than failing the entire product.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/production/procedural-crate.ts`, `src/tools/procedural-crate.ts`, `src/tools/generalized-packages.ts`, `src/packages/format-v2.ts`.
- Related test anchors: `tests/procedural-crate.test.ts`, `tests/procedural-crate-tools.test.ts`, `tests/generalized-packages.test.ts`, `tests/crate-journey-transports.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; complete local CPU crate construction/package/resource/copy journey fixture-tested through actual CLI and MCP transports, with retained sources, real LODs, collision and separate approvals. Generic background recipe execution, actual Codex/Claude client usability, human quality and engine qualification remain open; fixture copying is not shipping clearance.

### R10-012 — 10. Make asset creation easy for the calling model / Required agent usability scenarios

2. A character: inspect an existing humanoid, find a supported rigging route, produce a walk/idle set, validate skeleton and root motion, preview, and package. Refuse unsupported anatomy rather than silently treating a dragon as a humanoid.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-013 — 10. Make asset creation easy for the calling model / Required agent usability scenarios

3. A material: create a two-meter tileable weathered stone surface, derive coherent maps from one procedural source, bake/export a named target profile, show repeat and grazing-light previews, and package six parameterized variations.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-014 — 10. Make asset creation easy for the calling model / Required agent usability scenarios

4. A sound family: create or process six stone footstep variations, preserve transient attack, report peaks and durations, offer an audition reel, and package event metadata. If generative synthesis needs payment, stop at the plan until approved; local processing remains available.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-015 — 10. Make asset creation easy for the calling model / Required agent usability scenarios

5. A bug: from a selected visual artifact, inspect its run-scoped object/material identity, traverse provenance, identify affected shader and scenarios, replay a supported fixture, compare a candidate, and return evidence rather than a fabricated diagnosis.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R10-016 — 10. Make asset creation easy for the calling model / Required agent usability scenarios

Measure task completion, number of tool interactions, invalid-call recovery, unnecessary regeneration, context size, latency, cancellation behavior, and whether a user can understand the approval. Do not optimize tool count by concealing consequential choices.

- Assignment: **M1**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-001 — 11. Researched integration options and implementation routes

Research snapshot: 23 October 2026. These are integration recommendations, not a promise that all providers are installed, accessible, licensed, or already implemented. Revalidate current API versions, account entitlements, terms, and installed executable capabilities during implementation. Prefer existing integrations before adding another provider. Choose implementation libraries intelligently and document trade-offs; the feature contracts and acceptance criteria matter more than a prescribed dependency list.

- Assignment: **M6**; conditional optional integration; existing provider hardening required.
- Existing anchors: `src/providers/model3d/tripo.ts`, `src/providers/audio/leonardo.ts`, `src/jobs/durable.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`, `tests/durable-jobs.test.ts`.
- Acceptance: Pinned provider fixtures; denied/uncertain/repeated requests and bounds; capability doctor; rights ledger; authorized live account test before production qualification; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-002 — 11. Researched integration options and implementation routes / 11.1 Blender: local production backbone

**Status:** already used by the repository; extend it. Official documentation supports background execution and Python script entry points. Use a configured executable, isolated per-job working directory, explicit version detection, reviewed scripts, JSON request/result files, nonzero Python-error exit codes, and bounded subprocess execution. Keep argument order intentional. Run with factory settings and disabled automatic script execution where compatible; never trust scripts embedded in downloaded `.blend` files. [Official command-line reference](https://docs.blender.org/manual/en/4.1/advanced/command_line/arguments.html)

- Assignment: **M2**; required core; real execution CI-gated.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-003 — 11. Researched integration options and implementation routes / 11.1 Blender: local production backbone

**Recommended scope:** procedural mesh construction, geometry-node recipe templates, modifiers, UV operations, baking, material-node templates, animation cleanup, rendering, and format conversion. Build direct data-API implementations when possible; context-sensitive operators need explicit scene/context setup. Preserve a `.blend` source artifact, recipe, version, and derived exports. Test specific supported Blender versions and report unsupported versions. Reuse existing Blender reliability work instead of creating a new subprocess runner.

- Assignment: **M2**; required core; real execution CI-gated.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-004 — 11. Researched integration options and implementation routes / 11.1 Blender: local production backbone

**Limits:** background rendering does not guarantee availability of every GPU backend or GUI-dependent operation. Procedural recipes are editable and reproducible within a declared environment, but do not magically solve arbitrary retopology or character design. External add-ons, executable redistribution, and material-source licensing each need independent review.

- Assignment: **M2**; required core; real execution CI-gated.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-005 — 11. Researched integration options and implementation routes / 11.2 Tripo and Leonardo: existing provider infrastructure first

**Status:** repository README already advertises Tripo model operations and Leonardo image/audio jobs. Preserve their durable accounting, explicit spend controls, and receipt/provenance handling. Audit actual operation coverage and tests before extending them. [Repository README](https://github.com/theisegoria/game-development-studio/blob/main/README.md)

- Assignment: **M6**; conditional optional integration; existing provider hardening required.
- Existing anchors: `src/providers/model3d/tripo.ts`, `src/providers/audio/leonardo.ts`, `src/jobs/durable.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`, `tests/durable-jobs.test.ts`.
- Acceptance: Pinned provider fixtures; denied/uncertain/repeated requests and bounds; capability doctor; rights ledger; authorized live account test before production qualification; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-006 — 11. Researched integration options and implementation routes / 11.2 Tripo and Leonardo: existing provider infrastructure first

Tripo's current documentation exposes asynchronous generation, task polling, texture and mesh-processing operations, rig checks, auto-rigging, and retargeting. Current documentation also distinguishes newer API versions and migration material. Compare the repository's pinned schema with current endpoints; do not silently change provider model IDs or interpret a new response with an old schema. [Tripo developer documentation](https://developers.tripo3d.com/en/docs/quick-start)

- Assignment: **M6**; conditional optional integration; existing provider hardening required.
- Existing anchors: `src/providers/model3d/tripo.ts`, `src/providers/audio/leonardo.ts`, `src/jobs/durable.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`, `tests/durable-jobs.test.ts`.
- Acceptance: Pinned provider fixtures; denied/uncertain/repeated requests and bounds; capability doctor; rights ledger; authorized live account test before production qualification; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-007 — 11. Researched integration options and implementation routes / 11.2 Tripo and Leonardo: existing provider infrastructure first

Leonardo additions must be based on the official API contract actually available to the account, not an assumption that every website feature is an API. Audit its existing connector, endpoint references, job schema, error handling, commercial rights evidence, and asset-retention behavior. Do not claim Leonardo image output is a calibrated PBR map set simply because it resembles a texture. Keep image generation distinct from procedural material construction and map inference.

- Assignment: **M6**; conditional optional integration; existing provider hardening required.
- Existing anchors: `src/providers/model3d/tripo.ts`, `src/providers/audio/leonardo.ts`, `src/jobs/durable.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`, `tests/durable-jobs.test.ts`.
- Acceptance: Pinned provider fixtures; denied/uncertain/repeated requests and bounds; capability doctor; rights ledger; authorized live account test before production qualification; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-008 — 11. Researched integration options and implementation routes / 11.3 Meshy: optional second mesh/material/animation provider

**Status:** candidate connector, not a replacement for working Tripo support. Official retexture API accepts existing models and text/reference styles; it documents original-UV and PBR options. Integrate create/status/download through existing jobs, preserve selected model/version and returned map semantics, and locally validate outputs. PBR output remains inferred, not measured physical data. [Meshy retexture API](https://docs.meshy.ai/en/api/retexture)

- Assignment: **M6**; conditional optional integration; existing provider hardening required.
- Existing anchors: `src/providers/model3d/tripo.ts`, `src/providers/audio/leonardo.ts`, `src/jobs/durable.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`, `tests/durable-jobs.test.ts`.
- Acceptance: Pinned provider fixtures; denied/uncertain/repeated requests and bounds; capability doctor; rights ledger; authorized live account test before production qualification; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-009 — 11. Researched integration options and implementation routes / 11.3 Meshy: optional second mesh/material/animation provider

Its rigging API explicitly targets textured humanoid models with a defined body structure. Preflight documented format, size, orientation, and anatomical constraints before charging. Do not expose this as universal creature rigging. Outputs have task identity and potentially expiring links, so import authorized results into verified local packages promptly. [Meshy rigging API](https://docs.meshy.ai/en/api/rigging)

- Assignment: **M6**; conditional optional integration; existing provider hardening required.
- Existing anchors: `src/providers/model3d/tripo.ts`, `src/providers/audio/leonardo.ts`, `src/jobs/durable.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`, `tests/durable-jobs.test.ts`.
- Acceptance: Pinned provider fixtures; denied/uncertain/repeated requests and bounds; capability doctor; rights ledger; authorized live account test before production qualification; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-010 — 11. Researched integration options and implementation routes / 11.3 Meshy: optional second mesh/material/animation provider

Its animation API can apply preset actions or a documented text-to-motion result to a previously rigged character. Discover action IDs instead of inventing them; preserve distinct clips and timing in exports. Treat motion generation, rigging, and application as separate costed dependencies. [Meshy animation API](https://docs.meshy.ai/en/api/animation)

- Assignment: **M6**; conditional optional integration; existing provider hardening required.
- Existing anchors: `src/providers/model3d/tripo.ts`, `src/providers/audio/leonardo.ts`, `src/jobs/durable.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`, `tests/durable-jobs.test.ts`.
- Acceptance: Pinned provider fixtures; denied/uncertain/repeated requests and bounds; capability doctor; rights ledger; authorized live account test before production qualification; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-011 — 11. Researched integration options and implementation routes / 11.3 Meshy: optional second mesh/material/animation provider

Before enabling production use, verify current plan/API access, output rights, attribution obligations, retention, rate limits, cost estimation, and refund/cancellation behavior. Do not translate a local “cancel” button into a promise that provider work stops or charges reverse.

- Assignment: **M6**; conditional optional integration; existing provider hardening required.
- Existing anchors: `src/providers/model3d/tripo.ts`, `src/providers/audio/leonardo.ts`, `src/jobs/durable.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`, `tests/durable-jobs.test.ts`.
- Acceptance: Pinned provider fixtures; denied/uncertain/repeated requests and bounds; capability doctor; rights ledger; authorized live account test before production qualification; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-012 — 11. Researched integration options and implementation routes / 11.4 DeepMotion and Mixamo: different integration classes

**DeepMotion:** official Animate 3D REST documentation supports uploaded-video processing and animation retrieval. It describes provider-issued client credentials and a production host obtained from DeepMotion. Therefore implement this as an optional account-enabled video-to-motion connector, with local fixtures and explicit “not configured” status until access is granted. Require authorization for source-video uploads and applicable performer rights. Preserve source timebase, tracking options, job ID, export format, and confidence limitations. Reuse local animation cleanup and retargeting afterward. [Official Animate 3D API](https://github.com/DeepMotion/Animate-3D-REST-API/blob/main/README.md)

- Assignment: **M6**; conditional optional integration; existing provider hardening required.
- Existing anchors: `src/providers/model3d/tripo.ts`, `src/providers/audio/leonardo.ts`, `src/jobs/durable.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`, `tests/durable-jobs.test.ts`.
- Acceptance: Pinned provider fixtures; denied/uncertain/repeated requests and bounds; capability doctor; rights ledger; authorized live account test before production qualification; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-013 — 11. Researched integration options and implementation routes / 11.4 DeepMotion and Mixamo: different integration classes

**Mixamo:** Adobe's FAQ documents commercial project use and humanoid-only rigging constraints. This research does not establish a supported public automation API. Support user-downloaded/imported assets and documented local retargeting; do not build login scrapers or unofficial bulk downloaders. Project incorporation rights must not be conflated with unrestricted standalone redistribution. Record the applicable license and original download provenance. [Adobe Mixamo FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)

- Assignment: **M6**; conditional optional integration; existing provider hardening required.
- Existing anchors: `src/providers/model3d/tripo.ts`, `src/providers/audio/leonardo.ts`, `src/jobs/durable.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`, `tests/durable-jobs.test.ts`.
- Acceptance: Pinned provider fixtures; denied/uncertain/repeated requests and bounds; capability doctor; rights ledger; authorized live account test before production qualification; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-014 — 11. Researched integration options and implementation routes / 11.4 DeepMotion and Mixamo: different integration classes

Keep motion-library ingestion, video-to-motion inference, procedural/keyframe authoring, and retargeting distinct in discovery. None alone guarantees production-quality contact, facial performance, or physically correct movement.

- Assignment: **M6**; conditional optional integration; existing provider hardening required.
- Existing anchors: `src/providers/model3d/tripo.ts`, `src/providers/audio/leonardo.ts`, `src/jobs/durable.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`, `tests/durable-jobs.test.ts`.
- Acceptance: Pinned provider fixtures; denied/uncertain/repeated requests and bounds; capability doctor; rights ledger; authorized live account test before production qualification; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-015 — 11. Researched integration options and implementation routes / 11.5 PBR: procedural first; Substance optional

**Default local route:** authored Blender material templates and coherent underlying fields, with explicit artistic parameters for grain, wear, cracks, coverage, roughness, and scale. Share masks across map generation so changing wear consistently affects color, roughness, normals, and height according to the recipe. Keep physical coherence a modeled intention and tested constraint, not an assertion that a material has been laboratory measured.

- Assignment: **M3**; required local material; optional licensed/service backend conditional.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-016 — 11. Researched integration options and implementation routes / 11.5 PBR: procedural first; Substance optional

**Substance Automation Toolkit:** Adobe documents `sbsbaker` as a command-line baker, and identifies the toolkit among Enterprise Collection add-ons. Detect a user-configured, licensed installation rather than assuming every Painter or Designer subscriber has it. Wrap documented tools for their documented functions; verify render/cook tooling against the installed toolkit documentation before implementing those paths. Do not describe the toolkit as unrestricted headless automation of every Painter/Sampler feature. [SAT documentation](https://experienceleague.adobe.com/en/docs/substance-3d/bakers/getting-started/software-interface/substance-3d-automation-toolkit), [Adobe product licensing description](https://helpx.adobe.com/legal/product-descriptions/substance.html)

- Assignment: **M3**; required local material; optional licensed/service backend conditional.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-017 — 11. Researched integration options and implementation routes / 11.5 PBR: procedural first; Substance optional

A Substance adapter should expose published graph parameters, supported output usages, resolution, seed where supported, and export profiles. Preserve editable graph/source references when rights allow. Validate outputs through the same material QA pipeline as Blender and provider maps. Absence of Substance must not disable core material production.

- Assignment: **M3**; required local material; optional licensed/service backend conditional.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-018 — 11. Researched integration options and implementation routes / 11.5 PBR: procedural first; Substance optional

**Library materials:** Poly Haven distinguishes CC0 assets, API source-code licensing, and live-service terms. Its current hosted-service terms permit commercial API use but require app-identifying requests and visible source credit when surfacing content through the service. Implement bounded search/download with attribution in the browsing experience and store provenance even when downloaded assets need no attribution. Recheck terms at implementation; never assume an asset license is also a service-access license. [Poly Haven API terms](https://github.com/Poly-Haven/Public-API/blob/master/ToS.md)

- Assignment: **M3**; required local material; optional licensed/service backend conditional.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-019 — 11. Researched integration options and implementation routes / 11.5 PBR: procedural first; Substance optional

**Compression:** extend the repository's existing Basis/KTX2 path and CPU mip verification. Do not rename compression work “material generation.” A correct KTX2 container does not prove target-engine extension support or acceptable normal-map quality; verify the consuming profile and format-specific error metrics.

- Assignment: **M3**; required local material; optional licensed/service backend conditional.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-020 — 11. Researched integration options and implementation routes / 11.6 Audio: local DSP plus optional synthesis

**FFmpeg:** use a configured executable with typed filter plans and machine-readable probe output for conversion, trimming, fades, resampling, measurements, and preview reels. `astats` and `loudnorm` are documented filters. Choose one-pass versus measured two-pass behavior intentionally, retain gain decisions, and verify output afterward. [FFmpeg filter reference](https://ffmpeg.org/ffmpeg-filters.html)

- Assignment: **M4**; required local DSP; optional external backend entitlement-gated.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-021 — 11. Researched integration options and implementation routes / 11.6 Audio: local DSP plus optional synthesis

Audit the precise build and enabled components before bundling: FFmpeg's license depends on its selected components, and optional GPL parts change obligations. Calling a user-installed executable and redistributing a binary are different distribution decisions. [FFmpeg legal reference](https://ffmpeg.org/legal.html)

- Assignment: **M4**; required local DSP; optional external backend entitlement-gated.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-022 — 11. Researched integration options and implementation routes / 11.6 Audio: local DSP plus optional synthesis

**SoX:** a possible secondary local DSP backend, not a mandatory additional dependency. Evaluate its current maintained distribution, supported effects, security posture, and exact license before choosing it. This research did not successfully retrieve its manual, so do not treat SoX-specific behavior as verified or promise it in the initial shipped matrix. Prefer the already-supported backend when capabilities overlap.

- Assignment: **M4**; required local DSP; optional external backend entitlement-gated.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-023 — 11. Researched integration options and implementation routes / 11.6 Audio: local DSP plus optional synthesis

**ElevenLabs:** official documentation provides text-to-sound-effects through its API/SDK. Implement an optional provider adapter using the same spend and provenance architecture as current Leonardo jobs, with request validation, bounded download, format inspection, and local DSP finishing. Never let SDK retries create untracked duplicate charged generations. [Official SFX quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/sound-effects)

- Assignment: **M4**; required local DSP; optional external backend entitlement-gated.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-024 — 11. Researched integration options and implementation routes / 11.6 Audio: local DSP plus optional synthesis

Commercial rights are a separate admission gate. Provider marketing pages are not a substitute for the account's applicable plan and terms; capture the entitlement/terms evidence and generation date. Do not promise free-tier commercial rights, perpetual access, or transferable asset-library resale rights without verification. Human speech, voice cloning, and music licensing are not implicitly authorized by an SFX request.

- Assignment: **M4**; required local DSP; optional external backend entitlement-gated.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R11-025 — 11. Researched integration options and implementation routes / 11.7 Source and license ledger

For every executable, package, provider, downloaded asset, pretrained model, and recipe dependency, record: official source, exact version/model, license or terms URL, acquisition date, allowed use evidence, attribution, redistribution restrictions, provider data retention, account entitlement dependency, and verification status. Distinguish tool-code licensing from model-weight licensing and output rights. Unknown rights block vendoring into a shipping project by default, as existing policy already does.

- Assignment: **M1**; required cross-cutting.
- Existing anchors: `src/provenance/ledger.ts`, `src/tools/provenance.ts`, `src/mcp/resources.ts`, `src/packages/format.ts`.
- Related test anchors: `tests/source-ledger.test.ts`, `tests/provenance-tools.test.ts`, `tests/provenance-transports.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; explicit strict records, independent rights domains, revision/hash-bound writes and CLI/MCP approvals implemented and fixture-tested. V2 admission now consumes exact output-rights references and blocks missing/denied evidence by default. Automatic population for every dependency and legacy admission migration remain open; no live rights/account or human legal review established.

### R11-026 — 11. Researched integration options and implementation routes / 11.7 Source and license ledger

Do not hard-code a perpetual legal interpretation into a provider adapter. Represent the evidence and the user's applicable entitlement; require revalidation when terms/model/account conditions materially change. Provide an SBOM or equivalent dependency inventory for release preparation. A source link establishes documentation, not that live access or legal clearance has been tested.

- Assignment: **M1**; required cross-cutting.
- Existing anchors: `src/provenance/ledger.ts`, `src/provenance/exports.ts`, `src/tools/provenance.ts`, `docs/source-evidence.md`.
- Related test anchors: `tests/source-ledger.test.ts`, `tests/source-exports.test.ts`, `tests/provenance-tools.test.ts`, `tests/provenance-transports.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; local inventory/CycloneDX snapshot export and hash-verified resource retrieval implemented and fixture-tested. Release-byte population and terms/model/account-change revalidation integration remain open; documented declarations grant no legal clearance or execution authority.

### R12-001 — 12. Detailed production backlog and difficult cases

The following expands the acceptance surface of the earlier slices. Implement the core path first, then supported specialized paths. “Optional integration” means the product remains usable without that vendor, not that an unfinished advertised feature may be called complete. Mark unsupported capabilities explicitly in discovery and release notes.

- Assignment: **M1**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-002 — 12. Detailed production backlog and difficult cases / Mesh production and finishing

- Provide primitive composition and parameterized templates for common props, modular architecture, terrain features, foliage cards, and simple equipment. Use reusable node/geometry recipes with exposed dimensions and seeds, not one-off opaque scripts. Generated geometry must have a source recipe and editable intermediate when possible.

- Assignment: **M2**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-003 — 12. Detailed production backlog and difficult cases / Mesh production and finishing

- Support supplied meshes as first-class inputs: inspect, repair selected defects, simplify within silhouette/error constraints, unwrap or preserve UVs, generate tangents, split/merge by material when requested, and export. Separate automatic safe fixes from topology-changing proposals. Preserve vertex attributes, skin weights, morph targets, material assignments, and custom metadata where the format supports them; otherwise report losses before transformation.

- Assignment: **M2**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-004 — 12. Detailed production backlog and difficult cases / Mesh production and finishing

- Add explicit collision shape selection, per-platform triangle/vertex/material/draw-call/texture memory budgets, and preview overlays for density, normals, UV islands, and collision coverage. Budget reports estimate downstream costs unless measured in-engine. LOD switching distances are target-specific settings, not universal constants.

- Assignment: **M2**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-005 — 12. Detailed production backlog and difficult cases / Mesh production and finishing

- Preserve instancing when possible. Diagnose duplicate material slots, unexpectedly expanded instances, excessive submeshes, and tiny triangles. Keep source geometry and delivered runtime geometry distinct. Include import/export stress fixtures for negative scales, mirrored UVs, nonuniform scale, multiple roots, instancing, and large coordinates.

- Assignment: **M2**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-006 — 12. Detailed production backlog and difficult cases / Mesh production and finishing

- Allow photogrammetry or neural reconstruction only through a documented, separately licensed connector with actual input/output validation. Gaussian splats are not interchangeable with collision-ready triangle meshes. Mark conversion and gameplay interaction limitations.

- Assignment: **M2**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-007 — 12. Detailed production backlog and difficult cases / Animation authoring, adaptation, and review

- Support authored keyframe/procedural motion as a local route alongside imported clips and provider motion. Define curve units/interpolation, timebase, loop intent, root-motion policy, skeleton mapping, and coordinate system explicitly.

- Assignment: **M2**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-008 — 12. Detailed production backlog and difficult cases / Animation authoring, adaptation, and review

- Add mapping profiles and previews for retargeting: source/target bone correspondence, rest-pose offset, scale compensation, root trajectory, joint limits, and unsupported bones. A bone-name match is insufficient to prove compatible rigs.

- Assignment: **M2**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-009 — 12. Detailed production backlog and difficult cases / Animation authoring, adaptation, and review

- Where supported by the chosen backend, offer IK constraints/contact correction, foot/hand pinning, curve smoothing, and transition/blend previews as reversible operations. Measure trajectory and contact changes; do not assume an IK solve is automatically more natural.

- Assignment: **M2**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-010 — 12. Detailed production backlog and difficult cases / Animation authoring, adaptation, and review

- Handle blend shapes/morph channels separately from bone animation. Preserve shape names, weights, ranges, and missing target diagnostics. Facial transfer needs declared topology/channel mapping; do not promise arbitrary face transfer or lip sync without a qualified implementation.

- Assignment: **M2**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-011 — 12. Detailed production backlog and difficult cases / Animation authoring, adaptation, and review

- Keep event markers, footstep cues, hit windows, and gameplay timing aligned through resampling and trimming. Produce previews at native timing and slow motion with skeleton/contact overlays. Include regressions for rest-pose differences, zero-length bones, quaternion sign continuity, loop seams, nonuniform scale, missing fingers, root drift, and event offsets.

- Assignment: **M2**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-012 — 12. Detailed production backlog and difficult cases / Animation authoring, adaptation, and review

- Treat cloth/hair simulation baking and complex non-humanoid rig automation as explicit specialized capabilities requiring separate acceptance fixtures. They cannot be implied by a working humanoid demo.

- Assignment: **M2**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/recipes.ts`, `src/collision/geometry.ts`, `src/review/animation-info.ts`, `src/review/pose.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/review-pose.test.ts`, `tests/mesh-batch.test.ts`.
- Acceptance: Deterministic finishing and cancellation; attribute/timing round trips and mismatch refusals; every difficult input named in this requirement; real Blender mesh/animation package on authorized CI; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-013 — 12. Detailed production backlog and difficult cases / PBR material authoring, painting, and variants

- Implement an editable layer/mask model or typed equivalent: base surface, coating, wear, dirt, cracks, decals, and local overrides. Derive geometry-aware masks from curvature, ambient occlusion, thickness or supplied maps where supported. Record mask origin and bake settings; curvature is not a universal wear predictor.

- Assignment: **M3**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-014 — 12. Detailed production backlog and difficult cases / PBR material authoring, painting, and variants

- Provide mesh-aware painting through bounded brush/stencil/mask operations with defined UV or surface coordinates, undoable layers, and preview checkpoints. Do not claim Photoshop/Painter parity. Generative inpainting/retexturing may propose a layer but must preserve explicit untouched-region constraints and report seams or UV changes.

- Assignment: **M3**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-015 — 12. Detailed production backlog and difficult cases / PBR material authoring, painting, and variants

- Offer UV, triplanar/object-space, and supported UDIM workflows. Identify where triplanar materials must be baked for a target shader and where UDIM tiles cannot be consumed natively. Maintain texel-density targets, seam padding, tile identity, and per-target resolution limits.

- Assignment: **M3**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-016 — 12. Detailed production backlog and difficult cases / PBR material authoring, painting, and variants

- Keep shared morphology across variants: reuse geometric height fields, masks, and feature seeds so related maps describe the same cracks/grain/wear. If using a generative provider's internal latent representation, do not claim access or control unless documented; use stored masks/fields/recipes as the dependable local equivalent.

- Assignment: **M3**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-017 — 12. Detailed production backlog and difficult cases / PBR material authoring, painting, and variants

- Add decals, trim sheets, atlas generation, and material-family variants only with explicit UV/packing semantics and tested target import. Separate opacity, transmission, subsurface, clearcoat, anisotropy, and emissive extensions from the metallic-roughness baseline. Unsupported target features produce warnings or deliberate fallbacks, never silent substitutions.

- Assignment: **M3**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-018 — 12. Detailed production backlog and difficult cases / PBR material authoring, painting, and variants

- Preserve calibrated color-management settings in previews and exports, including view transform, exposure, working space, and display assumptions. Export base color as the target expects, not the display-transformed preview. Validate tangent-space normal reconstruction and mip filtering; roughness/gloss conversion, AO packing, and height rescaling require explicit documented transformations.

- Assignment: **M3**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-019 — 12. Detailed production backlog and difficult cases / PBR material authoring, painting, and variants

- Required difficult fixtures: mirrored UV seams, intentional overlaps, zero-area UVs, thin surfaces, translucent edges, large displacement, normal Y inversion, incorrect gamma, channel-packed linear maps, UV atlas bleed, differing normal bases, and material reimport after a texture rename.

- Assignment: **M3**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/production/textures.ts`, `src/production/ktx2.ts`, `src/review/appearance.ts`.
- Related test anchors (not execution evidence): `tests/pbr-factors.test.ts`, `tests/review-basis-textures.test.ts`.
- Acceptance: Golden gamma/channel/normal/alpha/packing fixtures; every difficult UV/map case named here; real bake/render/target round trip; six coherent stone variants and flipbook; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-020 — 12. Detailed production backlog and difficult cases / Audio design, finishing, and runtime delivery

- Add local layered recipes with oscillators/noise where appropriate, recorded sources, envelopes, filters, pitch/time changes, convolution only with licensed impulse responses, and controllable variation. Persist layer alignment and source lineage. Avoid calling pitch-shifted duplicates a genuinely diverse performance set.

- Assignment: **M4**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-021 — 12. Detailed production backlog and difficult cases / Audio design, finishing, and runtime delivery

- Support one-shots, sustained loops, attack/sustain/release constructions, and ambience beds with separate validation profiles. Preview loop joins repeatedly, inspect silence and codec padding, and preserve exact sample boundaries for PCM masters.

- Assignment: **M4**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-022 — 12. Detailed production backlog and difficult cases / Audio design, finishing, and runtime delivery

- Distinguish mono positional assets from stereo ambience; downmixing can create phase cancellation and must be previewed. Output spatial/event metadata and attenuation suggestions as target profiles, not acoustic truth. Explicitly declare channel layouts and export codec/sample-rate constraints.

- Assignment: **M4**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-023 — 12. Detailed production backlog and difficult cases / Audio design, finishing, and runtime delivery

- Provide banks/manifests for random selection, non-repetition rules, weights, cooldowns, concurrency groups, categories, and animation-event mapping. Integrate a particular engine or middleware only through its documented supported authoring/import path. Do not claim a generic JSON bank is directly deployable in every engine.

- Assignment: **M4**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-024 — 12. Detailed production backlog and difficult cases / Audio design, finishing, and runtime delivery

- Include short-transient measurement limits, resampling quality, intersample/true-peak method, dither policy on bit-depth reduction, clipping repair limitations, missing-tail detection, and audition gain controls. Destructive denoising or de-reverb is optional and clearly labeled; it may damage wanted sound.

- Assignment: **M4**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-025 — 12. Detailed production backlog and difficult cases / Audio design, finishing, and runtime delivery

- Required fixtures: silent clips, impulses, sub-second sounds, denormal/NaN samples where relevant, clipped sources, DC offset, phase-inverted stereo, mismatched channel labels, loop click, encoder padding, very long ambience, and Unicode filenames. Music generation, voice imitation, and speech localization require separate scope and rights handling.

- Assignment: **M4**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/tools/audio.ts`, `src/providers/audio/leonardo.ts`.
- Related test anchors (not execution evidence): `tests/audio.test.ts`.
- Acceptance: Deterministic PCM DSP and sample timing; all difficult audio inputs named here; no unintended clipping; six footsteps/audition/event-bank probe demonstration; qualified measurements; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-026 — 12. Detailed production backlog and difficult cases / Import, reimport, catalog, and maintenance

- Make engine profiles declarative where feasible: axes, unit scale, texture formats, material channel packing, skeleton conventions, root motion, naming, mip policy, compression, and target platform budgets. Separate source-package ID from target import ID.

- Assignment: **M1**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-027 — 12. Detailed production backlog and difficult cases / Import, reimport, catalog, and maintenance

- Reimport must preserve project-local overrides or report a conflict. Track source hash, importer version/settings, generated dependencies, and mapping to engine asset IDs. Preview additions, replacements, removals, and broken references before project writes. Provide rollback appropriate to the existing vendoring model.

- Assignment: **M1**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-028 — 12. Detailed production backlog and difficult cases / Import, reimport, catalog, and maintenance

- Record provenance for all derived variants, including compression and platform conversions. Use content addressing and cache keys that include recipe, tool versions, inputs, and material export assumptions. Never reuse a cached output after a semantic dependency changed merely because its filename is unchanged.

- Assignment: **M1**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-029 — 12. Detailed production backlog and difficult cases / Import, reimport, catalog, and maintenance

- Add catalog search by semantic tags and structured properties, with optional embeddings only if configured and justified. Text-search and graph results must remain useful without embeddings or a hosted database. Keep hidden license/account data out of publicly exported packages.

- Assignment: **M1**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R12-030 — 12. Detailed production backlog and difficult cases / Import, reimport, catalog, and maintenance

- Provide migration fixtures from representative old packages and catalogs, corrupted-index recovery, stale artifact detection, and protected evidence retention. Reuse quarantine/retention infrastructure. A graph may advise an asset is unreachable but cannot prove it is unused when dynamic loading is unobserved.

- Assignment: **M1**; required core; explicitly specialized connectors conditional.
- Existing anchors: `src/commands/registry.ts`, `src/production/recipes.ts`, `src/jobs/durable.ts`, `src/packages/format.ts`.
- Related test anchors (not execution evidence): `tests/production-recipes.test.ts`, `tests/durable-jobs.test.ts`, `tests/authorized-dispatch.test.ts`.
- Acceptance: Registry/CLI/MCP parity; immutable plan binding; denial zero calls; resumable idempotent jobs; migration/rollback; inspectable local crate journey; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R13-001 — 13. Delivery order, prioritization, and evidence gates

Implement in dependency order, keeping each milestone genuinely useful:

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R13-002 — 13. Delivery order, prioritization, and evidence gates

1. **Foundation and honest discovery:** repository audit, capability matrix, schema extensions, source/license ledger, recipe planning, durable execution reuse, approval invariants, and migration fixtures. Finish one small local asset recipe end to end to prove the abstraction.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/discovery.ts`, `src/jobs/plan-bound.ts`, `src/provenance/ledger.ts`, `src/packages/catalog.ts`, `src/tools/procedural-crate.ts`.
- Related test anchors: `tests/discovery-transports.test.ts`, `tests/durable-jobs-v2.test.ts`, `tests/provenance-transports.test.ts`, `tests/catalog-generalized-migration.test.ts`, `tests/crate-journey-transports.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; discovery, plan-bound storage, explicit ledger, v2 package/migration and local crate journey implemented with fixture evidence. Generic surviving background execution, full recipe orchestration, actual client/human review and the remaining foundation clauses stay open.

### R13-003 — 13. Delivery order, prioritization, and evidence gates

2. **Local production baseline:** Blender-backed meshes/materials, local animation inspection/cleanup, local audio DSP, packaged previews, and the five agent usability journeys using deterministic fixtures. Introduce graph links for these artifacts immediately rather than reconstructing provenance later.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R13-004 — 13. Delivery order, prioritization, and evidence gates

3. **Game understanding and import:** incremental graph/impact queries, asset budgets, a tested target import/reimport route, provenance-to-runtime mappings, and useful native-app inspectors where supported.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R13-005 — 13. Delivery order, prioritization, and evidence gates

4. **Optional provider breadth:** harden existing Tripo/Leonardo adapters; add selected Meshy/DeepMotion/ElevenLabs/Substance paths behind capability and authorization gates. Offline fixture tests can finish without live access, but production readiness remains conditional until authorized real integration tests run.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R13-006 — 13. Delivery order, prioritization, and evidence gates

5. **Observe and improve:** deeper profiler normalization, controlled comparisons, temporal investigations, deterministic-supported replay, real adapter demonstrations, and evidence-linked optimization/bisect.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R13-007 — 13. Delivery order, prioritization, and evidence gates

6. **Production hardening:** cross-client verification, Windows/Linux/macOS supported-platform lanes, security/resource tests, migrations, documentation, examples, accessibility/usability checks, and release-readiness artifacts.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R13-008 — 13. Delivery order, prioritization, and evidence gates

Core commitments are the coherent local workflow, shared registry, graph/provenance, QA, engine adapter contract, and tested representative integration. Optional vendor connectors and advanced features remain explicit tracked work; do not create empty adapters merely to check a roadmap box. Prioritize according to observed user workflows and dependency constraints, documenting any proposed scope change instead of silently dropping features.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R13-009 — 13. Delivery order, prioritization, and evidence gates

For every milestone, report four independent statuses: source implemented; automated fixtures passed; real tool/client/engine exercised; human quality review performed. A missing third-party entitlement can block the third status without invalidating honest local work. Never collapse these into one green “supported” checkmark.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R13-010 — 13. Delivery order, prioritization, and evidence gates

For every claimed integration, include a reproducible example, exact tested versions, known unsupported cases, and failure recovery. Keep a short decision log for library choices, alternate approaches rejected, performance trade-offs, and remaining product risks. Finish with a coverage checklist mapping every section of this roadmap to implementation paths, tests, evidence, documentation, and any clearly justified blocker.

- Assignment: **M10**; required engine-neutral platform/SDK.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-001 — 14. Researched runtime, graph, profiling, and MCP integrations

Research date: 23 October 2026. Recommendations below are proposed designs, not claims of implemented functionality. Prefer pinned versions and capability discovery over hard-coded assumptions.

- Assignment: **M10**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-002 — 14. Researched runtime, graph, profiling, and MCP integrations / Existing baseline: extend, do not reimplement

Read current repository `docs/mcp.md` and `docs/adapters.md`. Already present: one CLI/MCP registry; typed Zod contracts; frame-sequence temporal analysis; Chrome/Perfetto JSON `traceEvents` import; pass breakdowns; diagnostic grouping; per-pixel measured noise floors; live snapshot/query/pause/step/resume over authenticated Unix socket; live-to-sealed-scenario promotion; temporary-worktree bisect; optimization goals with iteration/path budgets and hardware measurement provenance gates. Capture adapters support object/material IDs, motion, depth, normals and further diagnostic attachments. Existing resource URIs verify sealed rosters and hashes. Preserve these foundations.

- Assignment: **M10**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-003 — 14. Researched runtime, graph, profiling, and MCP integrations / Existing baseline: extend, do not reimplement

Sources: https://github.com/theisegoria/game-development-studio/blob/main/docs/mcp.md and https://github.com/theisegoria/game-development-studio/blob/main/docs/adapters.md

- Assignment: **M10**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-004 — 14. Researched runtime, graph, profiling, and MCP integrations / Code intelligence: SCIP + LSP + syntax fallback

Implement durable code graph ingestion from SCIP Protobuf indexes, initially TypeScript/JavaScript, C/C++, C# and Python where installed indexers support the project. SCIP supports definition/reference/implementation navigation with language-specific indexers. Use LSP for interactive document symbols, definitions, references and call/type hierarchy when the server advertises capabilities; do not treat LSP as a universal whole-repository index. For C/C++, use compile_commands.json and clangd/scip-clang with actual target defines/includes. Tree-sitter supplies fast incremental syntax extraction where semantic tooling is unavailable, but syntax edges must not masquerade as resolved calls.

- Assignment: **M5**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Incremental/clean rebuild parity; rename/delete/dirty/generated/cycle/unresolved fixtures; transactional interruption; bounded provenance queries and run-scoped joins; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-005 — 14. Researched runtime, graph, profiling, and MCP integrations / Code intelligence: SCIP + LSP + syntax fallback

Design: local SQLite adjacency/FTS first; graph database optional only after demonstrated scale need. Nodes and edges carry commit, file hash, build configuration, tool version, provenance, observed/inferred status and stale state. Separate lexical match, compiler reference, runtime observation and model hypothesis. Bound graph queries by hops, edge type and result count. Incremental indexing must invalidate dependency closure and remove deleted symbols. Include generated code/conditional builds explicitly rather than claiming completeness.

- Assignment: **M5**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Incremental/clean rebuild parity; rename/delete/dirty/generated/cycle/unresolved fixtures; transactional interruption; bounded provenance queries and run-scoped joins; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-006 — 14. Researched runtime, graph, profiling, and MCP integrations / Code intelligence: SCIP + LSP + syntax fallback

Acceptance: overload/macro/conditional fixtures; rename/delete invalidation; dirty-tree overlay; unresolved dependencies displayed; no fabricated call edges; identical input produces stable snapshot; impact query returns evidence links and suggested relevant scenarios, not guaranteed proof of every downstream effect.

- Assignment: **M5**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Incremental/clean rebuild parity; rename/delete/dirty/generated/cycle/unresolved fixtures; transactional interruption; bounded provenance queries and run-scoped joins; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-007 — 14. Researched runtime, graph, profiling, and MCP integrations / Code intelligence: SCIP + LSP + syntax fallback

Sources: https://github.com/scip-code/scip (language-agnostic format and indexers); https://clangd.llvm.org/design/indexing (symbols/references/relations and dynamic/background index); https://clang.llvm.org/docs/JSONCompilationDatabase.html ; https://tree-sitter.github.io/tree-sitter/ ; https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/

- Assignment: **M5**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Incremental/clean rebuild parity; rename/delete/dirty/generated/cycle/unresolved fixtures; transactional interruption; bounded provenance queries and run-scoped joins; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-008 — 14. Researched runtime, graph, profiling, and MCP integrations / Code intelligence: SCIP + LSP + syntax fallback

Licensing: verify each indexer and grammar separately, including redistribution and notices. Protocol openness is not a license grant for all implementations; do not bundle compiler/server binaries blindly.

- Assignment: **M5**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Incremental/clean rebuild parity; rename/delete/dirty/generated/cycle/unresolved fixtures; transactional interruption; bounded provenance queries and run-scoped joins; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-009 — 14. Researched runtime, graph, profiling, and MCP integrations / Runtime graph: extend existing live query

Add typed, paginated engine snapshots and deltas for scene nodes/components, asset GUIDs/UIDs, materials, shader variants, render passes/resources, animations/audio events, source symbols and capture IDs. Instrument adapters to expose actual runtime bindings; do not infer complete render/resource graphs from source alone. Runtime IDs are session-local; bridge to stable asset IDs and source provenance through explicit maps. Snapshot-to-capture joins require matching session/frame/revision, with dangling/deleted IDs represented honestly. Read-only inspection first; edits separate from observation and checkpointed.

- Assignment: **M5**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Incremental/clean rebuild parity; rename/delete/dirty/generated/cycle/unresolved fixtures; transactional interruption; bounded provenance queries and run-scoped joins; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-010 — 14. Researched runtime, graph, profiling, and MCP integrations / Runtime graph: extend existing live query

Acceptance: click/select object ID in a capture → runtime object → mesh/material → shader/source where maps exist; omitted maps yield an unsupported/unknown explanation. Graph deltas handle spawn/despawn, asset reload and scene switching; reconnect never reuses stale IDs. Live exploration remains non-sealed and must promote to reproducible scenario before asserting regression evidence.

- Assignment: **M5**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Incremental/clean rebuild parity; rename/delete/dirty/generated/cycle/unresolved fixtures; transactional interruption; bounded provenance queries and run-scoped joins; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-011 — 14. Researched runtime, graph, profiling, and MCP integrations / Godot adapter

EditorPlugin + EditorDebuggerPlugin/EngineDebugger message captures for editor/runtime communication; runtime probe traverses SceneTree and emits supported attachments/telemetry. ResourceLoader.get_dependencies and resource UIDs seed asset relationships; retain declared versus dynamically loaded dependencies separately. Use headless import/export/check scenarios where applicable, not as proof of hardware rendering. Avoid scraping private editor internals.

- Assignment: **M7**; deferred M7.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Future separately authorized pinned engine fixture/import/runtime/profiling lane; excluded from current-phase completion; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: DEFERRED; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-012 — 14. Researched runtime, graph, profiling, and MCP integrations / Godot adapter

Acceptance: fixture project with imported mesh, material, animation, nested scene and dynamic spawn; correct resource dependencies; deterministic scenario entry; runtime graph diff; reject unadvertised diagnostics rather than synthesize passes. Pin Godot major/minor and renderer support in adapter doctor. Godot core MIT does not settle imported asset/addon licenses.

- Assignment: **M7**; deferred M7.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Future separately authorized pinned engine fixture/import/runtime/profiling lane; excluded from current-phase completion; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: DEFERRED; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-013 — 14. Researched runtime, graph, profiling, and MCP integrations / Godot adapter

Sources: https://docs.godotengine.org/en/stable/classes/class_editordebuggerplugin.html ; https://docs.godotengine.org/en/stable/classes/class_resourceloader.html

- Assignment: **M7**; deferred M7.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Future separately authorized pinned engine fixture/import/runtime/profiling lane; excluded from current-phase completion; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: DEFERRED; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-014 — 14. Researched runtime, graph, profiling, and MCP integrations / Unity adapter

C# package with editor-side AssetDatabase dependency/GUID extraction and a distinct player runtime probe. ProfilerRecorder exposes supported counters and marker timings in Editor and Player, including Release Players; enumerate available metrics instead of assuming every counter exists. Dispose native recorder resources. Capture instrumentation and object IDs may need render-pipeline-specific passes for Built-in/URP/HDRP. AssetDatabase is editor-only, so precompute asset maps for player builds.

- Assignment: **M7**; deferred M7.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Future separately authorized pinned engine fixture/import/runtime/profiling lane; excluded from current-phase completion; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: DEFERRED; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-015 — 14. Researched runtime, graph, profiling, and MCP integrations / Unity adapter

Acceptance: scene/prefab/material GUID mapping survives rename; editor/player counters labelled separately; counter absence explicit; no arbitrary assumption that an engine counter equals GPU hardware timestamp; supported pipeline fixture capture, warmup and multiple samples. User-installed Unity and applicable licensing required; don't redistribute the Editor.

- Assignment: **M7**; deferred M7.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Future separately authorized pinned engine fixture/import/runtime/profiling lane; excluded from current-phase completion; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: DEFERRED; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-016 — 14. Researched runtime, graph, profiling, and MCP integrations / Unity adapter

Sources: https://docs.unity.com/en-us/engine/7000.0/script-reference/unityeditor/assetdatabase/getdependencies ; https://docs.unity3d.com/6000.0/Documentation/ScriptReference/Unity.Profiling.ProfilerRecorder.html

- Assignment: **M7**; deferred M7.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Future separately authorized pinned engine fixture/import/runtime/profiling lane; excluded from current-phase completion; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: DEFERRED; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-017 — 14. Researched runtime, graph, profiling, and MCP integrations / Unreal adapter

Editor plugin uses Asset Registry for dependencies and Python/Editor utilities for imports/content automation. Separate C++ runtime module emits graph/telemetry and connects existing live protocol. Unreal Python is editor-only, including no gameplay Python in PIE, standalone or cooked execution; do not design runtime inspection around it. Capture Unreal Insights .utrace through documented trace channels and keep native artifact plus normalized derived metrics. Render/RHI instrumentation depends on supported engine branch and renderer.

- Assignment: **M7**; deferred M7.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Future separately authorized pinned engine fixture/import/runtime/profiling lane; excluded from current-phase completion; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: DEFERRED; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-018 — 14. Researched runtime, graph, profiling, and MCP integrations / Unreal adapter

Acceptance: fixture tests editor import, packaged runtime graph and Insights provenance separately; engine/version-specific parsers; missing traces/counters remain missing. Unreal engine/tooling licensing applies; third-party MCP plugins are optional adapters, not a foundational dependency or universal API.

- Assignment: **M7**; deferred M7.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Future separately authorized pinned engine fixture/import/runtime/profiling lane; excluded from current-phase completion; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: DEFERRED; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-019 — 14. Researched runtime, graph, profiling, and MCP integrations / Unreal adapter

Sources: https://dev.epicgames.com/documentation/en-us/unreal-engine/scripting-the-unreal-editor-using-python ; https://dev.epicgames.com/documentation/en-us/unreal-engine/trace-quick-start-guide-in-unreal-engine ; https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/AssetRegistry?application_version=4.27 (API concept; implement against actual installed engine's matching docs, not this older binding signature).

- Assignment: **M7**; deferred M7.
- Existing anchors: `src/harness/contracts.ts`, `src/harness/session.ts`, `src/packages/catalog.ts`.
- Related test anchors (not execution evidence): `tests/probe-sdk.test.ts`, `tests/scene-semantics.test.ts`.
- Acceptance: Future separately authorized pinned engine fixture/import/runtime/profiling lane; excluded from current-phase completion; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: DEFERRED; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-020 — 14. Researched runtime, graph, profiling, and MCP integrations / Perfetto: beyond current traceEvents

Integrate official Trace Processor CLI/Python API to ingest native supported traces and query PerfettoSQL for frame critical paths, CPU scheduling, thread waits and counters. Existing JSON-span support remains the low-dependency path. Bundle stable query templates with versioned schema expectations; retain raw trace, processor version and SQL alongside results. Treat custom SQL as bounded analysis, not arbitrary host execution. Pin processor version, particularly exported archives that are version-coupled.

- Assignment: **M8**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-021 — 14. Researched runtime, graph, profiling, and MCP integrations / Perfetto: beyond current traceEvents

Acceptance: known trace fixtures verify inclusive/exclusive durations, overlapping async work, clock domains, malformed data and missing slices. Report CPU time, GPU time, wall latency and waits separately; summed concurrent spans cannot equal frame duration. Native profiling overhead must be disclosed. Existing noise-floor and distribution comparison rules remain.

- Assignment: **M8**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-022 — 14. Researched runtime, graph, profiling, and MCP integrations / Perfetto: beyond current traceEvents

Sources: https://perfetto.dev/docs/reference/trace-processor-cli ; https://perfetto.dev/docs/analysis/trace-processor-python ; https://perfetto.dev/docs/analysis/perfetto-sql-getting-started

- Assignment: **M8**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-023 — 14. Researched runtime, graph, profiling, and MCP integrations / Tracy: source instrumentation option

Integrate instrumented zones, frame markers, allocation/lock observations and GPU zones with optional capture/export backend, keeping existing probe API interoperable. Current official README explicitly includes Metal alongside Vulkan, D3D11/12, OpenGL, OpenCL, CUDA and WebGPU; do not assert lack of Metal. API support is not proof every engine/platform/build has working instrumentation. Pin capture/reader versions and test format compatibility. BSD-3-Clause license; maintain notices.

- Assignment: **M8**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-024 — 14. Researched runtime, graph, profiling, and MCP integrations / Tracy: source instrumentation option

Acceptance: real instrumented sample; correlate frame IDs, CPU/GPU zones and source locations; recorder overhead baseline; disabled-probe production configuration; no success if only empty capture. Feature detection per selected GPU API.

- Assignment: **M8**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-025 — 14. Researched runtime, graph, profiling, and MCP integrations / Tracy: source instrumentation option

Sources: https://github.com/wolfpld/tracy ; https://raw.githubusercontent.com/wolfpld/tracy/master/LICENSE

- Assignment: **M8**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-026 — 14. Researched runtime, graph, profiling, and MCP integrations / RenderDoc: frame replay and resource inspection, not Metal

Use supported Python replay/capture automation via a constrained worker process to expose draw/dispatch tree, resource bindings, pipeline/shader inspection and selected textures. Retain native .rdc plus derived manifests. Official supported APIs are Vulkan, D3D11/12, OpenGL/OpenGL ES on supported Windows/Linux/Android targets; Metal explicitly unsupported. Authorized Nintendo support is separate. MIT license. Intended for own/authorized programs, including user-created Unity/Unreal projects.

- Assignment: **M8**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-027 — 14. Researched runtime, graph, profiling, and MCP integrations / RenderDoc: frame replay and resource inspection, not Metal

Acceptance: fixture draw selected → pipeline/material binding → output texture; replay driver/API checks; crash/time limits; resource size limits; unsupported targets clearly refused. A replay capture is not automatically trustworthy benchmark performance. Official repository Python API documentation confirms scripting exposure; verify installed binding signatures against the pinned version before coding.

- Assignment: **M8**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-028 — 14. Researched runtime, graph, profiling, and MCP integrations / RenderDoc: frame replay and resource inspection, not Metal

Sources: https://github.com/baldurk/renderdoc ; https://raw.githubusercontent.com/baldurk/renderdoc/v1.x/docs/python_api/index.rst (official Python API documentation source, inspected).

- Assignment: **M8**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-029 — 14. Researched runtime, graph, profiling, and MCP integrations / Apple Metal and Instruments

Important newer official capability: Apple's game-porting-toolkit documents gpucapture and gpudebug on macOS 27+. gpucapture records .gputrace; gpudebug can navigate call hierarchy, pipeline state, resources, textures/buffers and shader source. Check command availability and installed man pages, never assume these tools on the repo's macOS26 minimum. gpucapture target must launch with MTL_CAPTURE_ENABLED=1; optional MTLCAPTURE_WAIT_FOR_SIGNAL handles fast exit. On older hosts use MTLCaptureManager/programmatic capture and Xcode inspection. Retain native traces; do not reverse-engineer undocumented bundle internals as a stable API. Instruments/xctrace is a separate CPU/system tracing backend; discover installed templates/export schema and keep parsers versioned. GPU counter availability varies by device/API and is separately admitted as evidence.

- Assignment: **M8**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-030 — 14. Researched runtime, graph, profiling, and MCP integrations / Apple Metal and Instruments

Acceptance: macOS26 graceful fallback, macOS27 feature-discovered command path, real target capture, verified nonempty trace, texture extraction when supported, no fake Metal support via RenderDoc. CLI errors, entitlements/device connection/capture disabled are explicit blockers; raw artifacts remain useful if parsing unavailable.

- Assignment: **M8**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-031 — 14. Researched runtime, graph, profiling, and MCP integrations / Apple Metal and Instruments

Sources: https://github.com/apple/game-porting-toolkit/blob/main/game-porting-skills/skills/using-gpucapture/SKILL.md ; https://github.com/apple/game-porting-toolkit/blob/main/game-porting-skills/skills/using-gpudebug/SKILL.md ; https://developer.apple.com/documentation/xcode/capturing-a-metal-workload-programmatically

- Assignment: **M8**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/harness/spans.ts`, `src/harness/performance.ts`, `src/harness/temporal.ts`, `src/harness/stability.ts`.
- Related test anchors (not execution evidence): `tests/ci-performance-refusal.test.ts`, `tests/ssim.test.ts`.
- Acceptance: Overlap/async/clock-unit fixtures; run-level coverage/noise/inconclusive trials; temporal false positives; nonempty real profiler diagnosis on authorized target; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-032 — 14. Researched runtime, graph, profiling, and MCP integrations / Codex + Claude portability and durable work

Preserve stdio baseline plus canonical shared registry and generated client configuration. Official Codex docs support stdio and Streamable HTTP; Claude Code supports both and elicitation. Client UI approval is not equivalent to server-side authority. Keep configuration ceiling + per-call confirmation; no model-writable approval boolean. Negotiate elicitation and task capabilities, fail closed when a required approval cannot be obtained. MCP Tasks in 2025-11-25 are experimental; do not assume universality or freeze to that version if a supported newer revision exists.

- Assignment: **M10**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-033 — 14. Researched runtime, graph, profiling, and MCP integrations / Codex + Claude portability and durable work

Implement durable internal jobs independent of client lifecycle: plan/submit/status/result/cancel/resume with idempotency key, budget reservation, heartbeat, checkpoints, artifact manifest and terminal error. Expose negotiated MCP Tasks where supported, ordinary short job-ID tool calls otherwise. Client backgrounding is not durable server job recovery. Cancellation may not undo already submitted provider charges; distinguish cancellation requested, stopped, completed and outcome uncertain; reconcile provider status before retry.

- Assignment: **M10**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-034 — 14. Researched runtime, graph, profiling, and MCP integrations / Codex + Claude portability and durable work

Acceptance: pinned real Codex and Claude Code/Claude Desktop matrix for startup, tool schemas, image preview, resource retrieval, approved/declined/cancelled/timed-out elicitation, unknown capability, client disconnect/reconnect, long job, repeated submission and provider uncertainty. No extra provider call after denial and no duplicate charge after timeout. Test resource/image consumption separately from audio/video; provide file and text-metadata fallback. Host security and tool annotations are hints, never sole authorization.

- Assignment: **M10**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-035 — 14. Researched runtime, graph, profiling, and MCP integrations / Codex + Claude portability and durable work

Sources: https://developers.openai.com/codex/mcp ; https://code.claude.com/docs/en/mcp ; https://modelcontextprotocol.io/specification/2025-11-25/basic/utilities/tasks ; https://modelcontextprotocol.io/specification/2025-11-25/client/elicitation

- Assignment: **M10**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

### R14-036 — 14. Researched runtime, graph, profiling, and MCP integrations / Codex + Claude portability and durable work

Security note: MCP specification prohibits requesting passwords/API keys/payment credentials using form elicitation. Claude documentation currently gives a contrary password-form example; follow protocol security requirements and secret-safe configuration/URL mode rather than reproducing that example.

- Assignment: **M10**; required platform/SDK; tool/version/platform execution conditional.
- Existing anchors: `src/commands/registry.ts`, `src/commands/authorized-dispatch.ts`, `src/skills/bundle.ts`.
- Related test anchors (not execution evidence): `tests/mcp-resources.test.ts`, `tests/execution-authority.test.ts`, `tests/cli-package-contract.test.ts`.
- Acceptance: Pinned real-client approval/resource/job matrix; cross-platform installed package; native authorized remote review; adversarial/migration/rollback; exact-byte release evidence; verify every clause and named fixture above. CLI/core/MCP parity and provenance/limits apply.
- Status: OPEN; source partial/not fully audited; fixtures not rerun; real execution not exercised; human review not performed.

## Inventory self-check

| Brief section | Requirement rows |
| --- | ---: |
| 3 | 6 |
| 4 | 5 |
| 5 | 7 |
| 6 | 5 |
| 7 | 4 |
| 8 | 3 |
| 9 | 5 |
| 10 | 16 |
| 11 | 26 |
| 12 | 30 |
| 13 | 10 |
| 14 | 36 |

Total: **153** rows; sections 3–14 all represented; every row has a milestone, scope classification, existing anchors, intended acceptance and four independent evidence states. Named difficult fixtures are retained in their original requirement rows rather than silently collapsed into generic happy-path tests.

## Integration risks to resolve during implementation

- Current recipes and audio generation do not establish generalized local production, material authoring or DSP. Extend existing infrastructure rather than treating these names as coverage.
- Graph semantic index ingestion/runtime identity maps require new substantive code and actual indexer/probe qualification; path discovery is not semantic analysis.
- Research recommendations are not installations or legal clearance. Revalidate pinned contracts, sources/terms, account rights and binary licenses before enabling/bundling.
- Engine-specific import/integration wording in the brief is superseded by the owner’s deferral: demonstrate engine-neutral target/package/probe round trips now; preserve deferred requirements rather than silently declaring them passed.
- Mandatory real-tool/client evidence can be blocked by launch restrictions or missing remote infrastructure; fixture completion alone cannot close the roadmap.
