# Source and license evidence

Source builds after CLI 1.5.1 add a local evidence ledger. Discover the installed
`provenance` family before using these operations; released 1.5.1 has no ledger.
This checkpoint supplies explicit record and export workflows. Automatic
dependency discovery and release-byte population are still required by the full
roadmap. The subsequent [v2 package checkpoint](generalized-packages.md) consumes
exact ledger references during v2 project admission; legacy v1 packages retain
their existing admission behavior.

## Record workflow

Use the shared `game-dev tool call NAME --input JSON --json` interface or the same
named MCP tool:

1. `plan_source_record` takes `{ "record": RECORD }`. It validates the strict
   `game_dev.source_record.v1` contract and returns normalized record bytes'
   canonical `sha256` plus the ledger's `expectedRevision`. Planning and inspection
   create no provenance directories.
2. Review the record, then call `record_source_evidence` with `record`,
   `expectedSha256` equal to that digest, and `expectedRevision`. The CLI requires
   `--confirm`; MCP obtains a fresh human confirmation through the client.
   Agent-written approval fields are rejected. Neither a hash nor a prior
   confirmation authorizes this write.
3. `inspect_source_ledger` returns compact summaries with bounded `offset`/`limit`
   pagination (default 20, maximum 100), or full detail for one explicit `id`.
   It also returns exact inventory and CycloneDX snapshot export plans.
4. `export_source_ledger` takes the reviewed export plan's `format`,
   `expectedRevision` and `expectedSha256`. Omit the informational `bytes` field.
   A new confirmation is required. Exports go only to a fixed hash-named file
   under the configured output directory; there is no arbitrary destination or
   upload. Existing exports are reused only after their bytes verify.

Concurrent record writes use a shared transaction and revision check. A changed
record or revision invalidates the plan. Refresh the inspection and review the
new plan; never replace an unreadable ledger with an empty one. The mutable
ledger is `.provenance/source-ledger.json`, with a maximum of 2,000 records and
8 MiB. Exports have a 16 MiB limit. Symlink and hard-linked private evidence files
are refused. These filesystem checks do not provide a sandbox against hostile
same-user processes.

## Evidence boundaries

A record identifies an executable, package, provider, asset, model or recipe
dependency and its exact version/model, official source, content hash when known,
acquisition date, attribution, restrictions, retention and entitlement evidence.
Code, model and output rights are separate domains. Unknown rights remain
unknown; an allowed code license cannot grant model or output rights.

Evidence references accept public HTTPS URLs without credentials, query strings
or fragments, or `urn:sha256:<64 lowercase hex digits>` for locally identified
evidence. Do not put credentials, signed URLs or private file paths in records.
Secret-like strings are rejected, but operators must still review free text.
No reference is fetched and no account entitlement is checked by these tools.

`evidence_reviewed` records require a review date and documentary evidence beyond
a user assertion. Even then, the result is a documented declaration:
`independentlyVerified` and `authorizationGranted` remain false. These tools do
not grant legal clearance or permission to ship, execute, upload or spend.
Material changes to terms, versions or account conditions require new evidence;
this checkpoint does not automatically detect those changes.

## Resources and exports

| URI | Evidence |
| --- | --- |
| `game-dev://sources` | bounded inventory of record identities |
| `game-dev://sources/records/{id}/{sha256}` | the exact record still present in the verified ledger |
| `game-dev://sources/exports/{format}/{sha256}` | a previously exported inventory or CycloneDX snapshot, rehashed on every read |

A superseded record URI fails explicitly. An exported historical snapshot remains
readable after later ledger updates, provided its own bytes verify. There is no
silent rewrite of old exports.

The CycloneDX export uses the [official 1.6 JSON format](https://cyclonedx.org/schema/bom-1.6.schema.json)
for component identities, known hashes, public/content references and evidence
properties. It is a local inventory of recorded components, not a complete
automatically discovered dependency graph, certification or vulnerability scan.
It does not invent SPDX identifiers from rights assertions.
