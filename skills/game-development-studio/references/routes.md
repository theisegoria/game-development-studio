# Workflow routes

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


## Standalone production roadmap (CLI 1.2.0+)

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
| Workspace | `inspect_workspace_storage`, `plan_workspace_retention`, `execute_workspace_retention`, `list_workspace_retention`, `restore_workspace_retention`, `export_workspace_files` |
| Recipes | `save_production_recipe`, `plan_production_recipe`, `run_production_step`, `recover_production_lock`, `reconcile_production_step` |
| Families | `create_asset_family`, `plan_family_approval`, `approve_family_sample`, `expand_asset_family` |
| Platform variants | `plan_platform_preparation`, `save_platform_preparation`, `validate_platform_asset`, `prepare_collision_box` |
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
user-selected destination. The three retention writes also need the configured
project-write launch grant. Never clean actual user files as a test.

Upgrade/rollback planning verifies downloaded artifacts against fixed-repository
GitHub release digests; missing provenance stays blocked. It does not install,
change profiles, acquire signing credentials or imply a native installer.
