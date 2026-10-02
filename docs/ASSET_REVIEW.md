# Asset review and visual regression history

The review tools extend the asset catalog and sealed visual comparison system. All operations are local and free. They do not launch Blender, a GPU process, a target engine, or a provider request. Each tool is available through the shared CLI command registry and MCP after registration. Mutations require explicit transport approval (CLI confirmation or MCP approval). Reviewer and reason fields are descriptive evidence, not authentication or proof of human identity. Direct library callers are responsible for obtaining authorization; do not infer it from these strings.

## Inspect, choose, approve, package

1. Call `create_asset_review` with one to six `{name, modelPath}` candidates. `modelPath` accepts a self-contained GLB or a catalog `pkg_` ID. Open its returned `dashboardPath` in a browser. Files remain local; the dashboard has no network dependencies or requests.
2. Compare synchronized eight-angle turntable views, wireframes, UV channel 0 layouts, and material swatches side by side. The angle slider and play button control both geometry views. Choose the preferred candidate and enter the human reviewer's name and reason. **Prepare decision arguments** produces JSON for `decide_asset_review`.
3. Submit those arguments to `decide_asset_review`. An approve/reject record binds to the SHA-256 of the copied review snapshot. An agent must not invent a human reviewer or treat model inspection as human approval.
4. Call `package_reviewed_asset` with the returned `decisionId`, package `name`, and `license`. The tool rejects rejected, superseded, corrupt, or changed review evidence, checks the packaged model against the approved digest, and admits the standalone package to the existing catalog. License and policy validation remain provided by the canonical package builder. A visual approval does not override validation or license restrictions in downstream tools.

A dashboard is a portable, offline review artifact. It cannot directly mutate the workspace from a `file:` browser origin. Its generated JSON is deliberately submitted through the normal tool boundary. Asset decisions persist under the studio data root's `review/decisions`; snapshots and dashboards live in `review/sessions`. Changing the original model never silently changes a review snapshot. To approve different bytes, create a fresh review.

### Preview evidence limits

The CPU renderer transforms triangle geometry from the default scene into world space and produces eight orthographic azimuth views. It shows base-color factors, UV edges, and decoded base-color texture swatches with metallic/roughness values. It does **not** perform PBR lighting, texture mapping onto geometry, skin deformation, morph animation, transparency sorting, UV overlap scoring, or final GPU rendering. A preview is not a quality score. Unsupported/compressed geometry can require an independently prepared review LOD; the error is surfaced instead of claiming a render succeeded.

Limits: six candidates; 64 MB per GLB; 10,000 triangles per candidate; 32 material swatches; bounded decoded texture sizes and byte budgets; 48 MB review HTML. Inputs must be self-contained. External buffer/image URIs are rejected. Material base-color, metallic, and roughness factors must be finite numbers in [0,1]; external text is escaped and the dashboard script policy allows only its exact script digest. GLB originals are never modified. CPU previews are generated in-process; no Blender process is started.

## Baselines, scenario matrices, expected changes

- `name_visual_baseline`: verify a sealed capture and save a named immutable baseline version with a human-readable scenario label. The record binds the complete sealed manifest hash. Naming a new version does not replace an old version or claim human approval.
- `compare_visual_matrix`: provide up to 32 `{baselineId, candidateRunPath}` entries, optionally with a pixel threshold. Each pair uses the existing sealed-run comparator, which requires the same adapter and capture scenario. Each success persists a digest-bound comparison; each failure stays visible in matrix history. Runs from existing external capture systems are read, not launched.
- `decide_visual_regression`: append an `expected-change`, `regression`, or `needs-review` decision with a reviewer and reason. Decisions bind to the exact comparison digest and preserve history. Recording a decision re-verifies both sealed input manifests and every recorded preview image digest, including generated heatmaps; missing or changed evidence blocks approval. Expected-change never changes the measured pixel verdict and never auto-promotes a baseline.
- `visual_regression_dashboard`: refresh the portable dashboard, filter scenarios, inspect baseline/candidate/heatmap images, browse named baseline versions and matrix history, and prepare decision arguments. Corrupt records are reported rather than trusted. Missing or changed sealed source runs or comparison images suppress previews while retaining historical comparison metrics. Image embedding is capped at a 24 MB total input budget and six attachment pairs per comparison.

Pixel difference is not artistic quality. A numerically changed image may be an intended improvement; an identical image does not establish quality. Human decisions and numerical measurements are shown separately.

## Storage and recovery

Versioned JSON records are written with exclusive creation and UUID identities; independent decisions cannot overwrite each other. Unknown or malformed schemas are rejected. Do not repair a record by silently resetting it. Preserve damaged evidence, restore from a trusted backup, or create a fresh review/baseline. Keep review records, snapshots, named baseline runs, comparison directories, and referenced packages when exporting or cleaning the workspace. No cleanup is performed by these tools.
