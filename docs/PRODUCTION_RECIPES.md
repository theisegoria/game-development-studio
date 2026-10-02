# Production recipes, asset families, and standalone platform variants

These tools are available through `game-dev tool call NAME --request FILE --json` and the same MCP tool names. They persist under `<outputDir>/.production`. No engine integration is performed. Recipes execute **one step per invocation**, with fresh transport approval for each mutation and paid call. A saved fingerprint or family review is never spend authority.

## A local validate/package workflow

Create `recipe.json` with an absolute path to a GLB you own:

```json
{"recipe":{"schema":"game_dev.production_recipe.v1","id":"prop_v1","name":"Reviewed prop","steps":[
 {"id":"validate","operation":"validate_game_asset","arguments":{"modelPath":"/absolute/path/prop.glb","maxTriangles":5000}},
 {"id":"package","operation":"build_asset_package","dependsOn":["validate"],"arguments":{"modelPath":"/absolute/path/prop.glb","name":"Reviewed prop","license":"CC0-1.0"}}
]}}
```

Use the actual license for your asset; the example license does not grant rights.

```sh
game-dev tool call save_production_recipe --request recipe.json --confirm --json
game-dev tool call plan_production_recipe --input '{"recipeId":"prop_v1"}' --json
```

Inspect the `validate` step's arguments and `fingerprint`. Execute exactly that step, supplying the returned fingerprint:

```sh
game-dev tool call run_production_step --input '{"recipeId":"prop_v1","stepId":"validate","approvedFingerprint":"COPY_64_CHARACTER_FINGERPRINT_FROM_PLAN"}' --confirm --json
```

Plan again, inspect `package`, and execute with its current fingerprint and `--confirm`. Failed validation (`passed:false`) blocks packaging, even when the underlying command returned a well-formed result. Source edits, changed recipes, changed tool version or Blender executable/script identity (hashed without launching Blender), missing/tampered outputs, or changed dependencies invalidate reuse. Recipe `files` may include additional local policy/reference inputs to fingerprint. glTF external buffers/images are included in input fingerprints; remote dependencies and symlink evidence are refused.

## Generate, normalize, validate, package

The allowlist includes `generate_asset_reference`, `select_reference`, `create_3d_asset`, `get_asset_job`, `download_asset`, `normalize_mesh`, `validate_game_asset`, `validate_platform_asset`, `build_asset_package`, and `prepare_collision_box` (plus provider retexturing). There is no arbitrary command execution.

The complete [text-to-package request](../examples/production-recipes/text-to-package.json) can be saved with `save_production_recipe --request examples/production-recipes/text-to-package.json --confirm`. Saving is local; only an explicitly approved generate step spends credits. Its unknown license intentionally makes no rights claim.

Connect results using an exact object such as `{"$step":"normalize","field":"outputPath"}`; the referenced step must be in `dependsOn`. Nested result fields and numeric array indexes are supported (for example `files.0.path` after inspecting a download result). Use a `get_asset_job` step after generation and before download: pending jobs leave polling ready to repeat without resubmitting generation. Reference candidate selection is an explicit step supplied by the reviewer; it is never auto-picked. Polling accepts `reference_ready` or `ready`; generation itself checkpoints the returned durable job id and does not pretend its model is downloaded.

For example, the ordered graph is:

1. `create_3d_asset` with `textPrompt`, `spec`, and per-operation provider options.
2. `get_asset_job` with `assetJobId: {"$step":"generate","field":"assetJobId"}`.
3. `download_asset` with that same id, depending on polling.
4. `normalize_mesh` with the downloaded job id, depending on download.
5. `validate_game_asset` using the normalization `outputPath`.
6. `build_asset_package` using the normalization `outputPath`, depending on validation.

Each paid step needs current `--approve-spend --spend-limit-cents N` in addition to applicable mutation confirmation. MCP uses its current authorization/elicitation path. Library callers must supply an authorization-aware dispatcher; an unconfigured caller refuses execution. Recipes never persist CLI flags, confirmation grants, or provider credentials.

If a process stops after an operation starts, the checkpoint becomes uncertain and cannot auto-submit again. `recover_production_lock` only removes a lock whose recorded same-host process is provably gone. Corrupt records are preserved and fail closed. Inspect local/provider jobs before `reconcile_production_step`; its `nonSubmissionEvidence` is an explicit operator assertion that no request was submitted. If a request **was** submitted, retain the checkpoint and continue the existing durable job through the job tools instead of claiming non-submission. This conservative recovery may require a revised recipe starting from the existing downloaded asset.

## Asset families

`create_asset_family` accepts `family` with schema `game_dev.asset_family.v1`, an id, shared `style`, `palette`, `scaleMeters`, `namingPrefix`, ordered `members: [{id,description}, ...]`, and a recipe `template`. The template must include validation and packaging. Strings support `{{name}}`, `{{description}}`, `{{style}}`, `{{palette}}`, and `{{scaleMeters}}`. Generation specs receive the shared style/palette/scale and stable member name. Scale is a provider target, not a claim of measured size; use validation policy to enforce measured dimensions.

Only the first member's sample recipe is created initially. Finish and visually review it, call `plan_family_approval` to obtain its evidence/digest, then `approve_family_sample` with `familyId`, `approvedDigest`, and `reviewer`. `expand_asset_family` creates the remaining member recipes, with no generation or spending. Each later operation requires fresh authorization. Changed sample bytes invalidate expansion and member execution. Family revisions/approvals are immutable: create a new family id when changing the shared design.

## Platform preparation

Save this as `platform.json` (replace the path and license):

```json
{"recipe":{"schema":"game_dev.platform_recipe.v1","id":"prop_mobile","name":"Prop","modelPath":"/absolute/path/prop.glb","license":"CC0-1.0","variants":[
 {"id":"mobile","lodTriangles":[5000,2500,1000],"maxMaterials":4,"maxTextureSize":1024,"textureMode":"preserve","materialMode":"opaque","collision":"box"}
]}}
```

Run `plan_platform_preparation --request platform.json`, inspect capabilities and unavailable requests, then `save_platform_preparation --request platform.json --confirm`. Plan/run its individual steps as above. Each LOD runs the existing Blender normalization/decimation tool, measures policy and platform budgets, and builds a separate canonical standalone package. Blender is optional and explicitly launched only when the approved normalization step runs. Generated AABB collision OBJ files are standalone conservative proxies linked by recipe checkpoints, not engine-ready collision claims. Material choices preserve or normalize to opaque; texture preservation verifies measured maximum dimensions and fails when dimensions are unknown.

Texture resize/compression and convex decomposition requests are explicitly unavailable in this implementation; supply authored/preprocessed inputs or choose a supported mode. No engine adapter, runtime import verification, signing, or external service is implied.

## Synthetic verification

`npx vitest run tests/production-recipes.test.ts` uses temporary files and the repository's synthetic game-ready GLB generator. It checks invalidation, validation blocking, concurrent/uncertain submissions, schema failures, family review, real glTF budget measurements, and eight-vertex AABB OBJ output. It does not start Blender/GPU or call a provider.
