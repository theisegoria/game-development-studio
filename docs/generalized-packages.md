# Multi-kind packages and the local crate journey

Source builds after CLI 1.5.1 add explicit v2 package operations. Discover the
installed schemas before using them. Existing `package build` and
`build_asset_package` still create v1 mesh packages. V1 packages remain readable;
sealed evidence is never rewritten to upgrade a catalog.

## One complete local construction path

The shared CLI/MCP operations are available through `game-dev tool call NAME
--input JSON --json`. New mutations require CLI `--confirm` or a fresh MCP human
confirmation. A fingerprint binds a reviewed request; it cannot authorize itself.

1. Call `plan_procedural_crate` with a typed recipe and optional package metadata:

   ```json
   {
     "recipe": { "dimensions": { "width": 1.2, "height": 1, "depth": 0.8 } },
     "packageMetadata": { "name": "Workshop crate", "license": "unknown" }
   }
   ```

   Planning normalizes dimensions in metres, axes, pivot, seed, construction and
   material parameters. It binds the selected package metadata, configured output,
   constructor and observed renderer/inspection identities. It writes nothing.
2. Review the plan and confirm `construct_procedural_crate` with its normalized
   recipe/metadata and `approvedFingerprint`. The result contains hierarchical
   editable GLB source, flattened LOD0, a genuinely reduced box LOD1, box collision,
   a LOD chain, recipe, static validation, CPU appearance images and a hashed
   construction receipt. The reduced box fills recesses and loses interior detail;
   collision is an approximation. No `.blend`, engine import or GPU test is
   implied by this local recipe.
3. Follow the result's `nextOperation` to `plan_generalized_package`. Its complete
   `request` retains the source, runtime files, recipe and evidence, preserving
   LOD-chain filenames. The plan reports exact source identities, destination,
   implementation identity and catalog compatibility. It creates no package.
4. If the existing catalog is v1, separately plan and confirm its migration as
   described below. Then review and separately confirm `build_generalized_package`
   with `request` and the current `approvedFingerprint`. Construction approval
   does not authorize packaging. Source, settings, implementation or output drift
   requires a new plan.
5. `verify_asset_package`, CLI `package show`/`package verify`, catalog lookup and
   package resources understand both manifest versions. Review the images and
   limitations before deciding whether the result is useful.
6. Plan project admission separately. Unknown license or output rights block v2
   admission by default. Record actual source/license evidence and rebuild a
   package with exact ledger references; selecting a license string cannot create
   rights. Default crate metadata deliberately supplies no such clearance.

This path is deterministic local CPU fixture evidence. It does not establish
human artistic approval, game-engine compatibility or hardware performance.

## V2 storage contract

`game_dev.asset_package_request.v2` has a declared kind (`mesh`, `animation`,
`material`, `audio`, `flipbook`), explicit primary artifact and typed artifact
roles. The manifest is `game_dev.asset_package.v2`. It has no mandatory model
field. Source paths stay in the reviewed plan, outside the sealed manifest.
Package/artifact provenance references bind `sourceId` and `recordSha256`.

Limits: 64 artifacts, 64 MiB per artifact, 256 MiB total, 1 MiB manifest. Logical
paths are portable lowercase relative names. Traversal, duplicate/aliased paths,
reserved names, symlinks and hard-linked input files are refused. Sources are
read with explicit byte bounds, rechecked during staging and before publication.
Content identity includes schema, metadata, artifact hashes and recorded validator
identity. V2 packages live under the configured package root's `v2/pkg_<24 hex>`
directory. Exclusive publication and full re-verification support safe reuse;
tampered packages are preserved and refused.

Geometry receives the existing static GLB inspection and default mesh policy;
animation requires an actual clip. Rig, retargeting, root-motion and artistic
quality are separate work. Material, audio and flipbook packaging currently
preserves declared bytes without establishing format decoding or semantic quality:
their primary check is `passed: null`. Such packages need an explicit reviewed
`allowInvalid` override even for project copying. This is storage support, not
production qualification for those kinds. All kinds retain explicit unperformed
engine/human/legal evidence fields.

Implementation evidence records listed local validator hashes, installed library
entrypoint/metadata hashes, versions and Node version. It explicitly identifies
unbound transitive/native code; it is not a complete installed-byte closure or
release SBOM.

## Explicit catalog migration and recovery

Fresh catalogs use database v2. Existing v1 catalogs continue serving v1 packages
and refuse v2 admission until migration; opening one does not silently stamp it
with a new version.

- `plan_catalog_migration` reports source/version, exact reviewed fingerprint,
  ownership and prerequisites without replacing the database.
- Close catalog handles and stop external SQLite/workspace writers. Confirm
  `migrate_asset_catalog` with `expectedFingerprint`. The plan binds the canonical
  target, versions, source database/WAL and exact lease identities. Drift, live or
  unknown owners and unsupported newer versions refuse replacement.
- `plan_catalog_rollback` accepts only the backup created by this catalog's
  replacement receipt. Review its `expectedFingerprint`, then separately confirm
  `rollback_asset_catalog` with `backupPath` and that fingerprint. Backup hashes
  and origin are verified; the displaced index is preserved too.
- Proven-dead leases need a fresh migration inspection and confirmed
  `recover_catalog_leases` with `expectedFingerprint` set to the plan's
  `fingerprint` value. Recovery preserves evidence and never expires ownership
  by age. Live, foreign-host or ambiguous owners remain refused.

Replacement uses a standalone verified backup, staged database and atomic rename.
Nonempty WAL evidence blocks replacement until writers are stopped and the index
is checkpointed and replanned. Node must expose `node:sqlite.backup`; unsupported
older runtimes receive a refusal. These are workflow controls and cannot isolate
hostile concurrent same-user writers. Existing storage-lock recovery still
applies if an interrupted transaction left its own lock.

## Review resources and project copying

`game-dev://packages/{packageId}` returns a verified manifest and artifact URIs.
`game-dev://packages/{packageId}/artifacts/{path}` serves only roster files, with
fresh hash verification and a 16 MiB response cap. Larger files retain their local
package paths for client file fallbacks. PNG/JPEG previews, JSON metadata and
audio file MIME types do not imply that a client has displayed or auditioned them.

V2 admission binds the manifest, current destination, source-ledger references,
rights assessments and explicit overrides in `plan.fingerprint`. For CLI
execution, pass `--plan-fingerprint SHA256` together with `--confirm`; MCP uses
`expectedFingerprint`, the project-write launch ceiling and a new human
confirmation. Any change needs another plan. Copies, lock updates and receipts
are serialized and the copied package is re-verified.

The generic CLI `tool call vendor_package_into_project` path retains the existing
human-controlled `GAME_DEV_MCP_ALLOW_PROJECT_WRITE=1` launch ceiling as well as
per-call `--confirm`. A tool argument cannot grant that ceiling. The direct CLI
`vendor admit` command keeps its existing explicit-confirmation interface.

Unknown license/rights and unperformed kind validation block by default.
Explicit fixture-copy overrides remain visible and fingerprint-bound; they grant
no legal or quality clearance. Known denied output rights cannot be overridden.
V2 lock entries describe kind and primary identity; they do not call audio a
model. Mixed v1/v2 lock history remains readable. Legacy v1 admission retains its
existing behavior; it is not silently converted to v2 evidence.
