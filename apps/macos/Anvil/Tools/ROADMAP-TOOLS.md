# Production tool surface

The toolbar's **Production workflows** sheet opens guided forms for inspect / validate /
package, review / select / package and platform preparation. Form values expand through
the runtime's canonical templates. Previewing executes no step; saving only persists
the recipe. The graph reports completed, ready, blocked, invalidated and uncertain
states, dependency reasons and actual recorded result/output evidence.

**Advanced JSON** exposes roadmap tools grouped by catalog route. Its editor shows
full field types, required fields and defaults
exported from the shipped runtime's MCP `tools/list`. The runtime remains the
validation authority; the native editor only checks that the request is a bounded
JSON object. Regenerate schemas after changing a roadmap tool:

```
npm run build
node apps/macos/Anvil/Tools/export-roadmap-schemas.mjs
```

`CatalogParityTests` checks native tool coverage, request property names,
confirmation, durable-job classification and conditional spend metadata against
runtime capabilities. Schema harvesting lists tools only and uses a disposable
workspace with paid MCP operations disabled.

For `run_production_step`, fill in the current recipe id, step id and approved
fingerprint, then **Review selected step**. The app reads the current plan and shows
that leaf operation and its arguments. A stale fingerprint or non-ready step is
refused. Only a paid leaf shows a separate spend checkbox and ceiling. Clicking
**Run once** captures the request and current grant, clears the UI authority before
any asynchronous work, and sends JSON on stdin through RunStore. Previous run
records and ledger entries never supply authority. Unknown estimates remain absent
in the approval record instead of being reported as zero. Existing numeric estimate
records remain readable.

The guided view re-reads a current plan before presenting one step's arguments and
fingerprint. Editing the form, loading another recipe, refreshing, cancelling an
inspection or leaving the guided view clears authority. Each invocation clears
approval synchronously before its first await and remains disabled while its run is
active. No step starts automatically after completion. Only the saved recipe ID
persists for restart recovery; a new process must load its current checkpoints and
review again. Candidate selection uses IDs from actual current review results and
records attribution/reason through `set_production_review`; the subsequent decision
step still needs a fresh approval. Uncertain operations are never automatically
retried. Runs retains cancellation/result evidence, and the advanced recovery tools
remain available for operator reconciliation.

The Setup workspace and macOS Settings scene save explicit Blender, CPU Basis and
CoACD Python paths through the runtime's per-user configuration. File validation
starts no tool. Missing, moved, changed and invalid selections remain visible, and
saved identities work from Finder without shell PATH setup. Writes and unknown
registry calls require a measured closed runtime and cannot fall back to PATH.

The app reads only the selected paid leaf's existing provider credential from its
Keychain store. Missing credentials remain runtime configuration errors. No new
credentials are provisioned by this surface. Results are visible in Runs. Preview
and packaging evidence do not imply target-engine correctness or artistic approval.

## Native roadmap verification checkpoint

CPU-only debug build and all 119 Swift tests in 11 suites passed on 2026-10-04 using
the host Swift 6.4 toolchain. Form/plan tests cover malformed values, paths containing
spaces, actual result evidence, current/changed fingerprints, unknown spend/operation
metadata, invalidated/uncertain steps and bounded appearance/animation settings.
Process tests cover explicit dependency settings, mutation PATH refusal, identity
handshakes, cancellation and timeout behavior. Mock-process transport checks remain
distinct from the actual built-runtime template contract, which expands all three
native form requests through the CLI without executing recipe steps. All 50 roadmap
schemas were regenerated from MCP `tools/list`; complete schemas, catalog coverage,
CLI forms, authorities and resource staging parity passed.

The local test command redirected compiler/package caches into the writable temporary
directory and launched only CPU test/metadata subprocesses:

```sh
CLANG_MODULE_CACHE_PATH=/tmp/gds-anvil-clang-cache \
SWIFTPM_MODULECACHE_OVERRIDE=/tmp/gds-anvil-swift-cache \
swift test --package-path apps/macos/Anvil \
  --scratch-path /tmp/gds-anvil-roadmap-build \
  --cache-path /tmp/gds-anvil-package-cache --disable-sandbox
```

Native app interaction, keyboard navigation, VoiceOver, repeated-click/cancel/restart
interaction and Light/Dark visual checks are not yet exercised. They require an
approved app-window launch. No native app, GPU or local Blender was launched by this
checkpoint. Platform normalization/decomposition/compression behavior still needs its
separate tool execution evidence; saving a path is not version or behavior validation.

## Standalone resource staging

Known issue in the initial v1.2.0 source build helper: it copied Anvil's executable
but omitted the SwiftPM `Anvil_AnvilKit.bundle`. A bundle separated from its build
tree could therefore lose schema lookup. CLI and skills release artifacts are
unaffected; v1.2.0 did not distribute an Anvil binary.

The follow-up build helper stages that resource bundle before signing and verifies
its closed roster and canonical schema again after moving the completed app.
`stage-resource-bundle.mjs` accepts the flat native SwiftPM layout and the structured
Swift Build layout, rejects unknown files, links and changed/missing schema bytes,
and never overwrites an existing staged bundle. Installed apps use only their own
resource directory; a missing bundle disables tools instead of attempting a
build-tree fallback. Fixture tests remove the source build products before resolving
the staged resource through Foundation. These checks do not claim a launched-app
or quarantined-download acceptance test, and do not add a native GitHub archive lane.
