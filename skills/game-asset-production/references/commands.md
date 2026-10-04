# Asset-production commands

Use a dedicated output workspace consistently with `--output-dir PATH`.

## Discover and diagnose

```text
game-dev capabilities --json
game-dev doctor --json
game-dev credentials status --json
```

`capabilities.data.localOperations` is the installed command/schema authority. Do not infer request fields from an older example.

Guided forms and renderer 2.2 settings (including optional Basis appearance decoding and sampled playback) require CLI 1.4.0 or newer; inspect the installed schemas before using them.

## Provider jobs

Provider execution requires `game-dev` 1.0.2 or newer. The account holder must
configure any provider credential outside the plugin
conversation in a local mechanism they control. Never request, accept, print,
store, or paste a key. The commands below may be shown only after
`game-dev credentials status --json` reports the selected provider configured;
that status command never returns the value.

```text
game-dev provider tripo generate --request request.json --approve-spend --spend-limit-cents N --jsonl
game-dev provider tripo retexture --request request.json --approve-spend --spend-limit-cents N --jsonl
game-dev provider tripo rig --request request.json --approve-spend --spend-limit-cents N --jsonl
game-dev provider tripo retarget --request request.json --approve-spend --spend-limit-cents N --jsonl
game-dev provider tripo retopologize --request request.json --approve-spend --spend-limit-cents N --jsonl
game-dev provider leonardo image-generate --request request.json --approve-spend --spend-limit-cents N --jsonl
game-dev provider leonardo sound-generate --request request.json --approve-spend --spend-limit-cents N --jsonl
```

Omitting spend flags reaches the structured approval boundary without making the provider call. Creating that durable local job is still a write, so do it only as part of an execution request.

```text
game-dev job show JOB_ID --detail --json
game-dev job follow JOB_ID --max-seconds N --jsonl
game-dev job resume JOB_ID --confirm --approve-spend --spend-limit-cents N --jsonl
game-dev job cancel JOB_ID --confirm --json
```

A retry requires fresh authorization. A local cancelled state does not prove remote cancellation.

## Inspect, normalize, and package

Inspection, validation, and package verification are read-only. Normalization,
USDZ preview generation, and package construction create files. Resolve and
show their exact source, destination, output workspace, and overwrite/collision
implications first, then leave the command unexecuted until the user explicitly
authorizes that invocation. These commands do not expose a `--confirm` flag;
the missing flag does not waive the conversation-level approval boundary.

```text
game-dev asset inspect model.glb --json
game-dev asset validate model.glb --request policy.json --json
game-dev asset normalize model.glb --output normalized.glb --request options.json --jsonl
game-dev asset preview-usdz model.glb --output preview.usdz --jsonl
game-dev package build model.glb --name NAME --version VERSION --license SPDX --request metadata.json --jsonl
game-dev package verify PACKAGE_ID_OR_PATH --json
```

Use `game-dev tool call NAME --request request.json` only for an installed local operation not represented by a higher-level command. Prefer the high-level command because its durable receipt and approval behavior are clearer.

Package metadata should bind the original source digest, provider and job identity when applicable, prompts, generation parameters, transformations, license, and validation policy. An optional USDZ file is a preview artifact; the portable GLB remains the canonical game asset.

## Over MCP

| CLI | MCP tool |
| --- | --- |
| `game-dev tool call <name>` | the tool itself, by the same name |
| `game-dev provider leonardo image-generate` | `generate_asset_reference` / `create_game_prop` — candidates come back as images |
| `game-dev provider tripo generate` | `create_3d_asset` |
| `game-dev job show` / `job list` | `get_asset_job` / `list_asset_jobs` |
| `game-dev asset inspect` | `inspect_asset` |
| `game-dev asset validate` | `validate_game_asset` |
| `game-dev asset normalize` | `normalize_mesh` |
| (no CLI form) | `render_asset_contact_sheet` — UV layout and textures as images |
| `game-dev package build` | `plan_asset_package`, then `build_asset_package` |
| `game-dev package verify` | `verify_asset_package` |
| `game-dev credentials status` | `credentials_status` |
| `game-dev doctor` | `run_doctor` |

Paid tools are disabled over MCP unless the server was configured with a spend
ceiling, and each charge is confirmed in the client. Free operations may still
mutate files or launch processes and require the applicable authorization.


## Standalone CPU preparation and recipes (CLI 1.3.0+)

```text
game-dev tool call diagnose_texture_compression --json
game-dev tool call diagnose_collision_decomposition --json
game-dev tool call prepare_texture_variant --request resize.json --confirm --json
game-dev tool call compress_texture_variant --request compression.json --confirm --json
game-dev tool call decompose_collision_mesh --request collision.json --confirm --json
game-dev tool call plan_platform_preparation --request platform.json --json
game-dev tool call save_platform_preparation --request platform.json --confirm --json
game-dev tool call plan_production_recipe --input '{"recipeId":"prop_v1"}' --json
```

Read installed schemas before building requests. A compression request uses an
absolute `modelPath`, optional `colorCodec` (`etc1s` or `uastc`), `quality`, and
`timeoutSeconds`. It requires `GAME_DEV_BASISU_PATH` and
`GAME_DEV_BASISU_SHA256` from a trusted pinned CPU build. The diagnostic does not
start it. A collision request uses an absolute `modelPath` and explicit geometry/
resource budgets; `GAME_DEV_COACD_PYTHON` must name the configured isolated,
hash-pinned environment. That diagnostic starts a bounded metadata reader.
Neither optional dependency ships inside the native CLI runtime; do not install
into profiles or infer setup permission from an asset request.

KTX2 compression is limited to embedded GLB with unambiguous color/data/normal
usage and bounded 8-bit PNG/JPEG inputs. It validates metadata and CPU-transcodes
every mip, including again during package admission. CoACD requires static,
closed manifold geometry and returns separate parts plus a manifest; it refuses
unsupported glTF features and measures approximation with samples. Inspect
reported platform/resource limits, particularly macOS's sampled RSS watchdog,
before execution. Neither CPU operation uses Blender/GPU or proves engine import.

Recipes execute one approved step at a time using the current plan fingerprint;
input/tool changes invalidate checkpoints. `create_asset_family` first creates
one sample recipe. Complete it, review its evidence with `plan_family_approval`,
record `approve_family_sample`, then `expand_asset_family`. Expansion creates
recipes only. Every subsequent write/process and paid call still needs its own
current approval; uncertain submissions must be reconciled from existing job
evidence rather than silently retried.

See the source [production guide](https://github.com/theisegoria/game-development-studio/blob/main/docs/PRODUCTION_RECIPES.md),
[Basis setup](https://github.com/theisegoria/game-development-studio/blob/main/docs/TEXTURE_COMPRESSION.md),
and [CoACD setup](https://github.com/theisegoria/game-development-studio/blob/main/docs/coacd.md).

## Guided workflows (CLI 1.4.0+, capability discovery required)

Use these additions only when installed CLI 1.4.0+ capabilities expose the named
tools and schemas. The shared templates are `inspect-validate-package`,
`review-select-package` and `platform-variants`.

```text
game-dev workflow templates --json
game-dev workflow create inspect-validate-package model.glb --name NAME --license SPDX --recipe-id RECIPE --json
game-dev workflow create inspect-validate-package model.glb --name NAME --license SPDX --recipe-id RECIPE --confirm --json
game-dev workflow plan RECIPE --json
game-dev workflow step RECIPE STEP --fingerprint CURRENT_STEP_FINGERPRINT --confirm --json
game-dev workflow review RECIPE CANDIDATE --fingerprint CURRENT_REVIEWED_FINGERPRINT --reviewer NAME --reason REASON --confirm --json
game-dev tool list --json
game-dev tool configure basisu --executable ABSOLUTE_PATH --confirm --json
game-dev doctor --workflow asset-package --json
game-dev support report --json
game-dev support report --output NEW_LOCAL_REPORT.json --confirm --json
```

The first `workflow create` is a plan. Inspect/package and review/package
templates accept self-contained GLB; platform requests retain explicit variant
settings through the native form or advanced `--request`. Choose the returned
candidate ID after reviewing actual outputs. Candidate selection uses the
completed review's `reviewedFingerprint`; execution uses the next step's
`fingerprint`. Changes to source, settings or rendered evidence require a fresh
review. Repeated invocations cannot reuse stale approval or silently resubmit
uncertain work. Inspect existing job evidence and the recipe's recovery reason.

`list_optional_tools`, `configure_optional_tool` and `clear_optional_tool` share
the CLI/native persistent configuration. Configuration hashes a selected regular
executable without launching it; subsequent operations fail closed after drift.
Selecting a path is not installing a tool or approving a later process launch.
`preview_support_report` and `write_support_report` emit an allowlisted local
report. Review it before sharing; neither command transmits it.

`create_asset_review` optionally accepts settings for controlled CPU appearance,
resolution/exposure, explicit review LOD and clip/time selection. It reports its
size/work envelope and unsupported features rather than silently truncating.
Normals, roughness, metallic, alpha, UV overlap/density, skinning and morph
inspection are bounded technical evidence. This renderer is not a target engine
and its preview is not artistic approval. Use existing sealed snapshot comparison
and regression tools for before/after outputs under the same review settings.

Direct KTX2 appearance requires `mode:"appearance",decodeBasisTextures:true`
and a configured, hash-verified Basis 2.50 CPU executable. Planning stays
process-free; authorized execution decodes into bounded temporary DDS pixels
and records actual process counts plus executable/source/pixel hashes. Originals
remain unchanged and reviewed packaging uses the compressed snapshot bytes.
Use the same opt-in and explicit shared frame for PNG/compressed comparisons.
Changed decoder configuration or bytes requires fresh evidence and approval.

`inspect_review_animation` reads clip metadata without rendering, launching a
process or creating records. Metadata binds exact source bytes and renderer.
LINEAR, STEP and CUBICSPLINE samples use the asset's default-pose frame; clipped
views are explicit. Use an explicit shared `framing.center/extent` when comparing
normalized, compressed-review or LOD sources whose bounds differ. Matching
settings alone do not establish a matching camera. New source/settings/time
requires fresh review; native clip-name mapping acknowledgment is also bound
to source hashes and renderer identity. A timeline slider selects a reproducible
sample for explicit execution. Optional `timeline` prepares 2–16 sealed still
samples at 128 pixels for offline appearance playback/scrubbing; it requires an
increasing supported clip range, no separate `pose`, and PNG/JPEG sources without
Basis decoding. Offline playback shows existing samples and starts no process.
Sequence budgets can require fewer frames or an explicit smaller review LOD.
The existing regression dashboard offers verified side-by-side/opacity overlays;
view controls never change comparison metrics, verdicts or baselines.
