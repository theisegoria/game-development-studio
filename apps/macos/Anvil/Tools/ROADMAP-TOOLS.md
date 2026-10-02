# Production tool surface

The toolbar's **Production tools** sheet exposes the 35 roadmap tools, grouped by
catalog route. Its JSON editor shows full field types, required fields and defaults
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

The app reads only the selected paid leaf's existing provider credential from its
Keychain store. Missing credentials remain runtime configuration errors. No new
credentials are provisioned by this surface. Results are visible in Runs. Bespoke
scenario and visual pages remain unchanged; this is a generic request surface, not
a new visual artist workflow.

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
