# Asset review and visual regression history

Review extends the asset catalog and the existing sealed visual comparison system. All operations are local and free. They do not launch Blender, a GPU process, an engine, or a provider request. Tools share the CLI/MCP registry and normal transport approval boundary. Reviewer and reason fields are attribution, not authentication or proof of human identity. Direct library callers must obtain authorization themselves.

## Inspect, choose, approve, package

1. Call `create_asset_review` with one to six `{name, modelPath}` candidates. Paths accept a self-contained GLB or catalog `pkg_` ID. Optional `settings` selects appearance rendering or an animation sample. Open the returned local `dashboardPath` when app/browser launch is authorized.
2. Compare synchronized eight-angle geometry, wireframe, UV layout, material swatches, and optional controlled-lighting appearance views. The angle slider/play button controls the angle. Read UV measurements, clip inventory, sampled time, warnings, and the measured resource envelope. Choose a candidate, enter the human reviewer's name/reason, and prepare `decide_asset_review` arguments.
3. Submit those arguments through the normal tool boundary. A v2 decision binds the GLB snapshot digest, renderer version, exact settings, preview digest, complete session evidence, dashboard bytes, and sealed appearance capture manifests. An agent must not invent a human reviewer or equate its own inspection with human approval.
4. Call `package_reviewed_asset` with `decisionId`, package `name`, and `license`. Rejected, superseded, corrupt, changed, or legacy byte-only evidence blocks packaging. The canonical builder still validates licenses and asset policy; visual approval does not override those requirements. The packaged model must match the approved snapshot before catalog admission.

The offline dashboard cannot mutate the workspace from a `file:` origin. Its generated arguments are submitted through the shared CLI/MCP tools. Snapshots and dashboards live under `review/sessions`; session and decision records use exclusive UUID creation. Changing an original model leaves an existing copied snapshot unchanged. Different bytes, settings, renderer versions, or pose samples require a fresh review.

### Appearance settings

```json
{
  "candidates": [
    {"name": "Before normalization", "modelPath": "/path/to/before.glb"},
    {"name": "After normalization", "modelPath": "/path/to/after.glb"}
  ],
  "settings": {
    "mode": "appearance",
    "resolution": 256,
    "exposure": 1,
    "reviewLod": "Artist-authored review mesh",
    "pose": {"clipIndex": 0, "timeSeconds": 0.5}
  }
}
```

`mode` defaults to `geometry`. Appearance resolution is 128 or 256 pixels per angle (default 256), exposure is 0.25–4 (default 1), and `pose` is optional. `reviewLod` is descriptive provenance; the tool never silently decimates or substitutes a mesh. A prepared review LOD is a distinct source and must be reviewed separately from the production asset. Omit `pose` for a default-pose asset with no selected clip.

The dependency-free renderer extension runs inside Node and uses the project's existing glTF, PNG and JPEG libraries. No new renderer, native codec, browser runtime, network dependency or license is added. Renderer identity is `gds-cpu-review@2.1.0`, lighting identity `neutral-studio-v1`. Changes to rendering, sampling or measurement semantics must bump the renderer version.

The implementation follows the [Khronos glTF 2.0 core specification](https://github.com/KhronosGroup/glTF/blob/main/specification/2.0/Specification.adoc) for linear base-color factors, sRGB base/emissive textures, linear normal/data channels, roughness in G, metallic in B, alpha modes, animation targets, and skin matrices. Its controlled review shading uses GGX specular, fixed key/fill/ambient lighting, orthographic views, Reinhard tone mapping, and linear alpha compositing. It is a bounded inspection renderer with explicit approximations, not a conformance or target-engine certification.

Supported appearance inputs include embedded PNG/JPEG base color, metallic/roughness, normal, occlusion and emissive textures; vertex colors; normal factors; OPAQUE/MASK/BLEND; and texture repeat/mirrored-repeat/clamp. Texture sampling deliberately uses nearest filtering without mipmaps. When NORMAL is absent, the renderer calculates flat normals and ignores authored and morphed tangents. Normal maps otherwise interpolate authored tangent frames, preserve transformed handedness, and re-orthogonalize against the interpolated normal. When authored tangents are absent, the renderer derives a frame from the triangle's world-space edges and UVs. BLEND retains fragments, sorts depth per pixel, and composites in linear space over opaque depth; it is bounded to one million fragments across the eight views and does not implement refraction or order-independent surface transport. There is no IBL, shadowing, refraction or extension material support. Smooth metals can appear dark without environment lighting.

Required extensions are rejected for every review. Appearance rejects all declared extensions, including texture transforms, transmission, clearcoat, mesh compression and KTX2/Basis textures. Geometry mode may show core fallback geometry for optional extensions, with the ignored extensions named in warnings. TEXCOORD_0 is the only mapped texture channel. Missing required UVs, degenerate normal-map UV triangles, unsupported textures and unsupported geometry fail explicitly; preparing a core glTF review LOD is an intentional separate action.

### UV and animation evidence

UV occupancy samples triangle interiors on a 128×128 grid in the primary [0,1] tile. Shared edges are excluded. Coverage/overlap are area estimates, not exact island intersection scores. Coordinates outside the tile, missing UV triangles and degenerate UV triangles are counted separately. Repeated/tiled coordinates are not folded into the primary tile. When the two-million-sample budget is exhausted, `complete` is false and coverage/overlap are null instead of presenting partial measurements as complete.

Texel density reports `sqrt(sum(uv triangle area × base texture pixel area) / sum(world triangle surface area))` for each material using TEXCOORD_0 and a readable base texture size. This is RMS texels per glTF world unit across textured, nondegenerate surfaces. Core glTF nominally uses meters, but exporter physical scale is unverified. A reviewer must establish the intended physical units before treating the number as texels per meter. Density neither proves UV quality nor handles secondary texture channels or extension transforms.

`inspect_review_animation` returns bounded, read-only clip metadata bound to the actual GLB hash and renderer. It creates no review record and launches no process. Clip inventory lists names, duration, channel count, interpolation modes and supported status. `pose.clipIndex/timeSeconds` evaluates a reproducible LINEAR, STEP or CUBICSPLINE sample. LINEAR rotation uses shortest-path quaternion interpolation; cubic samples use component-wise Hermite interpolation with key-interval-scaled tangents, followed by quaternion normalization. Time clamps to the selected clip duration. Invalid sampler layouts, missing input min/max, nonfinite values, duplicate targets and TRS targets on matrix-authored nodes fail explicitly. Declared float32 extrema must match decoded keys, except the core specification's implicit zero-filled accessor case. Core channels without a node target are ignored and counted; extension targets are refused.

POSITION/NORMAL/TANGENT morph targets and animated weights are evaluated. Skinning uses CPU linear blend matrices and up to four influences per vertex; deformed normal transforms remain an approximation. Additional influence sets are unsupported. Each selected sample uses the asset's default-pose frame, so translation or scale remains visible. The result reports posed/reference bounds and clipped views. Optional `framing: {"center": [0, 0, 0], "extent": 4}` uses an explicit common frame for before/after assets. Actual frame identity is part of the sealed comparison scenario; independently fitted assets with different bounds cannot masquerade as equal pixels.

The native workflow inspects every candidate, offers shared supported clip indexes and a time slider bounded by the shortest selected clip duration, and rechecks metadata before planning or saving. Missing or different clip names at the same index across candidates require an explicit, source-bound acknowledgment. Valid one-key clips can select time zero; a zero-duration clip has no time slider. Changing sources, settings or time invalidates earlier plans and approvals. The slider selects the next reproducible sample; rendering occurs on explicit review execution. Continuous playback rendering and interactive accessibility acceptance remain pending. Every new sample/settings selection creates fresh review evidence.

### Resource envelope and fixtures

Limits are enforced before expensive work where possible: six candidates; 64 MB GLB; 50,000 appearance triangles and 150,000 vertex instances per candidate; 32 appearance materials; 4 million pixels per texture and 8 million unique decoded pixels total; 8 MB cumulative encoded image copies including unused/aliased image records; 24 million raster checks; one million retained BLEND fragments across the eight views; 2 million UV checks; 64 clips, 1,024 channels and 100,000 cumulative animation key visits; 16 morph targets per primitive and 480,000 morph evaluations; 256 joints per skin and 4,096 unique joint matrices; 4 million accessor scalars before sparse expansion. Raw object counts and hierarchy depth (128) are bounded before glTF reader allocation. World coordinates/transform coefficients must be finite with absolute values at most 1e12. Dashboard embedding is capped at 48 MB, with an incremental card budget. External resource URIs are rejected.

Auxiliary turntable, wireframe and UV diagrams uniformly sample at most 2,000 triangles, including endpoints. Their warnings and envelope report omitted triangles explicitly; appearance pixels, reference/posed bounds, clipping and UV measurements use all accepted geometry. The returned/dashboard envelope records source bytes, full rendered triangles, vertex instances, decoded texture pixels, raster checks, geometry passes, bounds/UV work, auxiliary sampling, serialized output bytes, duration and all main limits. It is measured work for that asset/settings pair; maximum file size does not guarantee that every asset under 64 MB fits the other budgets. Use a separately prepared review LOD when a limit refuses the input. Originals are never rewritten.

`tests/appearance-review.test.ts` contains authored good/bad fixtures for texture/normal/roughness/metallic pixel responses, alpha modes, shared-edge/overlapping UVs, density basis, selected-time rotations/morphs/skins, supported cubic samples and unsupported extensions, cumulative shared-accessor amplification, image-copy/sparse-allocation amplification, extreme/cyclic transforms, binding tampering, and existing regression integration. The 10,000-triangle plane and six textured material spheres remain smaller fixtures. `tests/review-large-assets.test.ts` generates a real 50,000-triangle/150,000-vertex GLB, checks a UV defect omitted from auxiliary drawings, renders all appearance geometry and validates selected-pose work and larger-asset refusal. Timing and memory vary by runtime and asset; this cap does not guarantee a universal process peak. `GDS_REVIEW_EVIDENCE=/path/to/output npx vitest run tests/appearance-review.test.ts` preserves generated GLBs, PNGs/contact sheet and measurement JSON without launching a graphics app. Timing/RSS depend on the host/runtime and should be measured separately in an isolated Node process for release evidence.

## Compare appearance changes with existing regression history

Appearance candidates return `previewRunPath` and `previewRunManifestSha256`. These are closed, hash-verified `game_dev.run.v1` bundles with eight PNG frames and a source/settings sidecar. They explicitly report software rendering, no executed command/subprocess, no GPU execution, no hardware performance evidence, and no human approval.

Use the existing tools directly:

1. `name_visual_baseline` names a candidate's `previewRunPath` as an immutable baseline version.
2. `compare_visual_matrix` compares that baseline with another candidate's `previewRunPath`, including supported core-glTF normalization or LOD variants prepared by the existing production tools. KTX2/Basis production assets require a separately prepared, decoded core-glTF review source/LOD; its pixels and approval bind to that decoded source, not the compressed production bytes. Direct compressed-texture visual review remains future work. Other compressed/extension-bearing outputs are subject to the same explicit appearance-extension refusal.
3. `visual_regression_dashboard` shows existing baseline/candidate/heatmap evidence and history; `decide_visual_regression` records an explicit expected-change/regression/needs-review decision.

Renderer, full settings and actual frame determine the capture scenario identity. Different exposure, resolution, pose, review-LOD label, or renderer version refuses a direct numerical comparison. Use matching settings and an explicit shared frame for before/after evidence when source bounds differ; name different scenarios intentionally when testing different settings. Source hashes may differ because asset changes are the thing being compared. No parallel asset-specific comparator is introduced.

The original engine-capture baseline/matrix workflow remains available. It verifies sealed captures, comparison digests and every recorded preview image/heatmap before admitting a decision. Missing/changed evidence suppresses previews while retaining historical metrics. Human expected-change decisions never alter pixel verdicts or automatically promote baselines. Pixel difference is not artistic quality.

## Storage and recovery

New records are `game_dev.asset_review.v2` / `game_dev.asset_review_decision.v2`. Existing v1 records remain parseable history; byte-only reviews/approvals must be recreated before a new decision or packaging. No automatic migration invents a renderer/settings approval. Missing required stored settings, unknown schemas, corrupt records and changed evidence fail closed. Preserve damaged records, restore trusted evidence, or create a fresh review; do not silently reset records. Keep snapshots, dashboards, sealed preview runs, named baseline runs, comparison directories, decisions and referenced packages when exporting/cleaning a workspace. Review tools perform no cleanup or paid action.
