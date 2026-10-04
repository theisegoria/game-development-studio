# Workflow routes

Guided forms, renderer 2.2, Basis appearance decoding and sampled playback are roadmap-source features, not published v1.3.1 capabilities. Inspect the installed CLI/MCP schemas before constructing requests; use the matching roadmap source checkpoint for these additions until a release is approved.

## Asset request to project admission

1. Produce or locate source bytes with `$game-asset-production`.
2. Inspect and validate the source; normalize with Blender only when policy requires it.
3. Build and verify a canonical package with provenance and a license.
4. Hand the verified package ID or package path to `$game-asset-vendoring`.
5. Dry-run admission, resolve blockers, obtain explicit write approval, then verify the copied package and lock receipt.

Provider submission, download, normalization, packaging, and project admission are distinct receipts. Do not collapse them into one success claim.

## Visual problem to performance goal

1. Use `$game-visual-debugging` to inspect an adapter, plan the scenario, and capture a baseline.
2. Verify the run bundle. Use color plus depth, normal, object-ID, material-ID, motion, or overdraw attachments when the adapter can emit them.
3. Correlate deterministic raster deltas with telemetry and profiles to form a bounded hypothesis.
4. If the problem is measurable, hand the sealed baseline run and exact metric to `$game-performance-optimization`.
5. Create a goal with a small path allowlist and fixed iteration ceiling. Stop when met or exhausted.

Raster and telemetry correlations guide code inspection; they do not establish causality by themselves.

## Existing game integration

Adapter templates are opt-in. `game-dev adapter install` is dry-run-first and must not be treated as permission to run its scenarios. Inspect the installed declarative manifest, plan the chosen scenario, and request each required execution flag separately.


## Standalone production workflows (CLI 1.3.0+)

Use `game-dev tool call NAME --input JSON --json` for these shared CLI/MCP tools.
Read current capabilities before constructing inputs. Every mutation below needs
fresh conversation authorization and CLI `--confirm`; MCP asks through elicitation.
No saved recipe, review digest or family sample grants permission for later spend.

| Workflow | Operations |
| --- | --- |
| Reliability | `get_spend_report`, `diagnose_durable_jobs`, `recover_durable_job`, `quarantine_corrupt_job`, `recover_storage_lock` |
| Provider history | `get_provider_history`, `record_provider_outcome`, `rate_provider_result` |
| Review/package | `create_asset_review`, `decide_asset_review`, `package_reviewed_asset` |
| Regression history | `name_visual_baseline`, `compare_visual_matrix`, `decide_visual_regression`, `visual_regression_dashboard` |
| Workspace | `inspect_workspace_storage`, `plan_workspace_retention`, `execute_workspace_retention`, `list_workspace_retention`, `restore_workspace_retention`, `export_workspace_files`, `plan_workspace_purge`, `purge_workspace_retention` |
| Recipes | `save_production_recipe`, `plan_production_recipe`, `run_production_step`, `recover_production_lock`, `reconcile_production_step` |
| Families | `create_asset_family`, `plan_family_approval`, `approve_family_sample`, `expand_asset_family` |
| Platform variants | `plan_platform_preparation`, `save_platform_preparation`, `validate_platform_asset`, `prepare_collision_box`, `prepare_texture_variant`, `compress_texture_variant`, `decompose_collision_mesh` |
| Optional CPU dependencies | `diagnose_texture_compression`, `diagnose_collision_decomposition` |
| Updates | `plan_release_change` |

A recipe executes one step. Inspect its current fingerprint and exact arguments,
then authorize that operation. Paid steps additionally require current
`--approve-spend --spend-limit-cents N`. If submission status is uncertain, inspect
existing job evidence; do not regenerate. Record non-submission only with evidence.

Use static CPU turntable/wireframe/UV/material swatches for inspection. They do not
prove final PBR rendering, animation, engine compatibility or artistic quality.
Human review attribution is not identity verification. Expected-change decisions
never alter the original numerical comparison or silently promote a baseline.

Retention protects referenced baselines/packages/jobs and originals. Review the
measured plan; stop independent writers before execution. Quarantine is reversible
and reclaims zero physical bytes. Folder export copies only the reviewed plan to a
user-selected destination. To permanently remove quarantined bytes, inspect
`plan_workspace_purge` and obtain fresh explicit authorization for its irreversible
`purge_workspace_retention` plan. ALL other workspace and quarantine writers must be stopped. Portable path checks
do not isolate hostile concurrent same-user writers. Never infer purge consent
from quarantine or a previous failed attempt. Partial purge resumes require a new plan and confirmation.
All retention writes also need the configured project-write launch grant. Unlinked
logical bytes are reported; actual filesystem space reclaimed remains unknown.
Never clean actual user files as a test.

Upgrade/rollback planning verifies downloaded artifacts against fixed-repository
GitHub release digests; missing provenance stays blocked. It does not install,
change profiles or acquire signing credentials. Target and rollback must use the
same exact distribution: CLI `.tgz`, skills `.zip`, or existing
`Anvil-VERSION-macos-arm64.zip`. Anvil plans are for Apple Silicon/macOS 26+;
the existing archive is ad-hoc signed and not notarized. GitHub digest agreement
does not establish Developer ID trust. Plans do not extract archives or launch apps.

CPU compression requires a user-configured pinned Basis executable and SHA-256;
its free diagnostic hashes the binary without starting it. CoACD requires an
explicit isolated Python environment with hash-pinned wheels; its free diagnostic
starts a bounded metadata reader without loading native CoACD. Never install
these dependencies or change profiles implicitly. Missing dependencies block only
the affected operation. Runtime schemas and diagnostics are the authority for
supported platforms and budgets.

Compression emits KTX2 ETC1S/UASTC textures and required `KHR_texture_basisu` in
an embedded GLB, preserves color/data/normal semantics, and CPU-transcodes every
mip. Package admission repeats payload checks; neither check proves visual quality.
CoACD returns separate convex OBJ/GLB parts and a manifest after closed-topology,
convexity and sampled approximation checks. Keep parts separate; do not call the
union an engine collision asset or the sampled error an exact safety bound.
Platform plans declare required dependencies without proving availability.

Setup and limits are documented in the source repository's
[texture compression guide](https://github.com/theisegoria/game-development-studio/blob/main/docs/TEXTURE_COMPRESSION.md)
and [convex decomposition guide](https://github.com/theisegoria/game-development-studio/blob/main/docs/coacd.md).
Real CPU tests run in explicit remote CI lanes; mocked local tests are not native
execution evidence. These standalone workflows require no game-engine integration.

## Guided source checkpoint

Public 1.3.1 remains the release baseline. Discover installed capabilities before
using unreleased `list_production_templates`, `plan_production_template`,
`save_production_template` or `set_production_review`. Prefer the native typed
forms or `workflow` CLI commands, with raw JSON available for advanced requests.
Graphs show completed, ready, blocked, invalidated and uncertain states with
reasons and actual output evidence. Authorize the reviewed next step using its
current fingerprint; selecting a candidate binds the completed review evidence
digest and grants no later execution authority.

The checkpoint also exposes workflow-aware `run_doctor`, persistent optional-tool
selection and local redacted support reports. Inspection does not launch the
selected executable. Missing Blender/Basis/CoACD blocks only workflows that need
it. Support reports must be reviewed by the user before sharing and are never
uploaded automatically.

Optional CPU appearance and reproducible clip/time reviews bind settings,
renderer version, source hashes and dashboard/preview bytes. Their UV, material,
skinning and morph evidence has explicit resource/unsupported-feature limits.
Compare sealed before/after previews through the existing snapshot/regression
tools under matching settings. A fresh input or setting needs fresh review;
engine correctness and artistic approval remain separate human/engine checks.

Direct Basis KTX2 appearance is an explicit appearance-only opt-in using the
existing verified CPU executable. Planning is process-free; the sealed source
receipt records decoder identity, texture/pixel hashes and actual subprocess
counts. Reviewed packaging keeps the original compressed GLB bytes. A decoder
change requires fresh review, and plain/compressed comparisons require matching
settings, decode profile and an explicit shared frame.

Sampled animation playback is an explicit 2–16-frame appearance sequence at
128 pixels, prepared once and bound to source/settings/timestamps. Offline
scrubbing starts no process. It currently uses PNG/JPEG sources without Basis;
other combinations and exceeded sequence budgets refuse execution. Existing
regression dashboards add side-by-side/opacity controls over verified pixels,
without changing numerical verdicts or automatically promoting baselines.
