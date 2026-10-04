# Production recipes, asset families, and standalone platform variants

These tools are available through `game-dev tool call NAME --request FILE --json` and the same MCP tool names. They persist under `<outputDir>/.production`. No engine integration is performed. Recipes execute **one step per invocation**, with fresh transport approval for each mutation and paid call. A saved fingerprint or family review is never spend authority.

## Guided workflows

Use a typed workflow first; keep manual recipe JSON for advanced graphs. The CLI and MCP share three templates:

| Template ID | Form inputs | Result |
| --- | --- | --- |
| `inspect-validate-package` | Recipe ID, name, actual license, local self-contained GLB path, optional validation policy | Inspect → validate → standalone package |
| `review-select-package` | Recipe ID, name, actual license, one GLB path or 1–6 named GLB candidates, optional policy and review settings | Saved review → explicit human selection → validate selected snapshot → package approved bytes |
| `platform-variants` | Recipe ID, name, actual license, model path, variants with LOD and material/texture budgets | Existing platform preparation graph with separate variant/LOD packages |

The first workflow is free, requires no provider credential or compiler, and launches neither Blender nor a GPU. Platform normalization requires Blender; compression and convex collision require their separately configured CPU tools. Planning verifies paths/tool identity when a step becomes ready and explains missing dependencies without installing or launching tools. Template compilation lists required tools but does not claim to have checked their availability.

The inspect/package and review/package forms require self-contained GLB input because canonical packages require binary GLB. Advanced inspection accepts glTF, and the platform workflow can convert it through separately approved Blender normalization. The guided first route never starts a conversion implicitly.

```sh
game-dev workflow templates --json
game-dev workflow create inspect-validate-package "/absolute/path/prop.glb" --name "Reviewed prop" --license CC0-1.0 --recipe-id prop_v1 --json
```

Without `--confirm`, creation previews the typed recipe. Inspect the source, license and policy, then repeat with `--confirm` to save it. Saving executes no operations. PowerShell accepts the same command shape and quoted paths; use the actual asset license rather than assuming the example grants rights.

```sh
game-dev workflow create inspect-validate-package "/absolute/path/prop.glb" --name "Reviewed prop" --license CC0-1.0 --recipe-id prop_v1 --confirm --json
game-dev workflow plan prop_v1 --json
game-dev workflow step prop_v1 inspect --fingerprint COPY_CURRENT_FINGERPRINT --confirm --json
```

Plan again before `validate`, and again before `package`; use each step's current fingerprint. The validation source comes from the actual inspection result and the package source from the actual validation result. A failed validation blocks packaging. Each invocation executes one operation through the existing transport approval boundary.

For MCP or portable request-file usage, call `list_production_templates`, `plan_production_template`, or `save_production_template`. Plan/save both accept `{templateId,request}`. For example:

```json
{"templateId":"inspect-validate-package","request":{"recipeId":"prop_v1","name":"Reviewed prop","license":"CC0-1.0","modelPath":"/absolute/path/prop.glb","policy":{"maxTriangles":5000}}}
```

The plan response contains `recipe`, `template`, `requiredTools` and `executes:false`. Save returns those fields plus `record` and the current `plan`. Repeated identical saves preserve the revision and checkpoints. Extra or mismatched form fields fail validation; templates cannot introduce provider calls.

### Review an actual candidate

Create a `review-select-package` workflow with `modelPath` or `candidates:[{name,modelPath},...]`. Execute only `review` first. The new plan exposes the saved dashboard path, candidate IDs, snapshot paths and current `reviewedFingerprint` under `nextStep`. The `select` step stays blocked until the reviewer inspects that saved evidence and explicitly chooses an actual candidate.

Optional `reviewSettings` use the same schema as `create_asset_review`: `mode` (`geometry` or `appearance`), `resolution` (128 or 256), `exposure`, optional `pose:{clipIndex,timeSeconds}`, and an explicit `reviewLod` label. Settings, renderer version and controlled-lighting identity bind the current checkpoint. Changed settings require fresh evidence and selection; appearance output remains a bounded CPU review with documented limitations.

Prepare `selection.json` from those returned values:

```json
{"recipeId":"prop_v1","stepId":"select","reviewedFingerprint":"COPY_CURRENT_REVIEW_FINGERPRINT","candidateId":"COPY_ACTUAL_CANDIDATE_UUID","reviewer":"Reviewer name","reason":"Specific reason for approving this saved candidate"}
```

```sh
game-dev tool call set_production_review --request selection.json --confirm --json
```

Binding saves the explicit choice and attribution; it does not execute the decision or package. Plan again, review `select` arguments and execute that step with its fresh fingerprint. Then plan/execute `validate` and `package` individually. Validation reads the selected saved snapshot rather than a predicted filename. Packaging uses the actual approved decision ID and verifies the approved bytes. Source or preview changes require a new current review and selection. Reviewer attribution does not prove human identity, and static review does not establish target-engine correctness or artistic acceptance.

Use `nextStep.reviewedFingerprint` for candidate binding. It hashes the completed review result and artifacts as well as its input checkpoint. It differs from the execution `fingerprint`, so regenerating a review with the same source/settings still requires a fresh selection of the newly returned evidence.

### Understand a saved graph

`plan_production_recipe` returns dependency `edges`, each step's `dependsOn`, `reasons`, current arguments/fingerprint and `evidence` with actual result and saved artifacts. `nextStep` is a reviewable recommendation, never permission to run automatically.

| Guided `state` | Meaning |
| --- | --- |
| `completed` | Current input fingerprints and saved output bytes verify |
| `ready` | Inputs and dependencies are current; review and authorize one operation |
| `blocked` | An input, tool, dependency or explicit human selection is missing |
| `invalidated` | A previously completed checkpoint no longer matches its inputs, settings, dependencies or outputs |
| `uncertain` | Execution started but completion is unproven; inspect and reconcile before retry |

Legacy v1 `status` remains `complete`, `ready`, `blocked`, `invalid` or `uncertain`. An invalidated step is executable only when its legacy status is `ready` and approval matches its fresh fingerprint. Historical checkpoints retained by older v1 records remain readable; interrupted removed steps appear under `historicalCheckpoints` and are never silently discarded. Completed historical entries are pruned on a later graph edit. Advanced changes preserve recovery and invalidate changed fingerprints rather than reusing stale approval.

## Advanced local validate/package graph

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

The allowlist includes `generate_asset_reference`, `select_reference`, `create_3d_asset`, `get_asset_job`, `download_asset`, `inspect_asset`, `create_asset_review`, `decide_asset_review`, `package_reviewed_asset`, `normalize_mesh`, `validate_game_asset`, `validate_platform_asset`, `build_asset_package`, `prepare_texture_variant`, `compress_texture_variant`, `prepare_collision_box`, and `decompose_collision_mesh` (plus `texture_existing_asset` for provider retexturing). There is no arbitrary command execution.

The complete [text-to-package request](examples/production-recipes/text-to-package.json) can be saved with `save_production_recipe --request docs/examples/production-recipes/text-to-package.json --confirm`. Saving is local; only an explicitly approved generate step spends credits. Its unknown license intentionally makes no rights claim.

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

Run `game-dev tool call plan_platform_preparation --request platform.json --json`, inspect capabilities and unavailable requests, then `game-dev tool call save_platform_preparation --request platform.json --confirm --json`. Plan/run its individual steps as above. Each LOD runs the existing Blender normalization/decimation tool, measures policy and platform budgets, and builds a separate canonical standalone package. Blender is optional and explicitly launched only when the approved normalization step runs. Generated AABB collision OBJ files are standalone conservative proxies linked by recipe checkpoints, not engine-ready collision claims. Material choices preserve or normalize to opaque; texture preservation verifies measured maximum dimensions and fails when dimensions are unknown. Select `textureMode: "resize"` to create a content-addressed embedded GLB with PNG/JPEG maps resized before LOD normalization. Colors are averaged in linear light, data channels linearly, and normal vectors renormalized. Source files are unchanged. Mixed color/data usages, unsupported document extensions, 16-bit PNG precision loss, sidecars, and excessive resource budgets are refused. The operation accepts at most 128 MiB input, 16 MP per decoded image, and 32 MP total decoded pixels.

Select `textureMode: "compress"` for resize, Blender normalization, then CPU ETC1S/UASTC KTX2 compression before validation and packaging. Color/emissive maps use sRGB; data and normal maps use linear UASTC, with normal mip renormalization. Compression and package admission CPU-transcode the actual compressed payloads. Configure the pinned Basis executable and SHA-256 explicitly, then run `diagnose_texture_compression`; this diagnostic starts no process. See [CPU texture compression](TEXTURE_COMPRESSION.md) for input budgets, setup and evidence limits.

Select `collision: "convex"` for CoACD decomposition of each normalized LOD into separate validated OBJ/GLB convex parts and a manifest. This happens before optional KTX2 compression, because the collision bridge refuses glTF extensions. The collision manifest is a separate recipe output, not an engine binding or a file embedded in the visual package. Inputs must be static embedded GLBs with closed, consistently oriented edge-manifold geometry; unsupported topology and source features fail closed. Configure the isolated, hash-pinned CoACD Python environment explicitly, then run `diagnose_collision_decomposition`. This diagnostic starts a bounded metadata reader but does not load native CoACD. See [CPU convex decomposition](coacd.md) for platform support, resource controls and sampled approximation checks.

Planning declares required tools but does not establish their availability: inspect `requiredTools` and `dependencyAvailabilityChecked`, run diagnostics, and resolve blockers before approving an operation. Optional CPU dependencies are not bundled into the native CLI runtime and are never installed automatically. Neither a successful plan nor a sample approval grants permission to launch Blender, a CPU worker, or a paid request. No engine adapter, runtime import verification, signing, or external service is implied.

## Synthetic verification

`npx vitest run tests/production-recipes.test.ts tests/production-textures.test.ts tests/texture-compression.test.ts` uses temporary files and the repository's synthetic game-ready GLB generator. It checks invalidation, validation blocking, concurrent/uncertain submissions, schema failures, family review, real glTF budget measurements, eight-vertex AABB OBJ output, real texture resize/color behavior, normal-vector normalization, and source preservation. It does not start Blender/GPU or call a provider.

Default compression/decomposition tests mock native backends. Real CPU codec and convex-geometry verification runs only in the explicit Basis and CoACD CI lanes; successful mocked tests alone do not prove real native output or platform coverage.
