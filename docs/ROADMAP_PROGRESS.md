# Roadmap execution evidence

Goal: implement the engine-neutral plan and probe SDK, with verified commits/pushes to main. Godot, Unity and Unreal remain deferred. This record does not replace the item-level [coverage ledger](ROADMAP_COVERAGE.md).

## Baseline: 7f0bc9f, 23 October 2026

Tests ran from an immutable Git archive of the starting commit, independently of concurrent implementation. Existing installed dependencies were reused; no application, Blender, GPU workload or provider was launched.

| Check | Result | Evidence limit |
| --- | --- | --- |
| TypeScript typecheck and lint | passed | source/static checks |
| CPU/fixture suite | 114 files passed, 2 skipped; 1,091 tests passed, 30 skipped | macOS runtime payload file excluded; optional Blender/GPU/Basis/CoACD opt-ins disabled |
| Anvil SwiftPM | 126 tests in 11 suites passed | Foundation/process/catalog tests; no app window |
| Legacy Studio SwiftPM | 47 tests in 4 suites passed | Foundation/process/store tests; no app window |

Commands: `npm run typecheck`, `npm run lint`, `npm test -- --exclude tests/cli-runtime-payload.test.ts --no-file-parallelism`, `swift test --package-path apps/macos/Anvil -j 2`, `swift test --package-path apps/macos/GameDevelopmentStudio -j 2`. Optional real-tool test environment switches were explicitly set to zero. The baseline's Node was 25.2.1; existing CI matrices cover other declared platforms separately.

## First foundation checkpoint

Operation discovery now groups the registered tools into explicit families, supports bounded search/pagination, and describes a single operation's actual input schema, direct cost basis and authority requirements. Legacy tool names/envelopes and argument stripping are retained. Only new strict operations reject extra arguments. MCP discovery respects its readonly profile, and schemas match tools/list. Configuration evidence remains credential presence only.

Durable v2 storage is opt-in through the existing store, sharing job identities and JSONL event infrastructure. Tests exercise independent-process idempotency/claims, stopped-owner recovery, bounded checkpoints, path swaps and interrupted state/event evidence. These are storage primitives: a generic background worker, reconnect execution and high-level asset submission are still required. Interrupted state/event disagreement fails closed and does not fabricate completion or resubmit work.

The coverage ledger assigns 153 source-brief paragraphs/list items across sections 3–14. Entries stay open until their full acceptance is shown; the initial source inventory is not execution evidence.

All remaining M1 requirements, M2–M6 and M8–M10 remain open. Real optional tools, actual clients, hardware evidence and human quality review have not been established by this checkpoint.

### Checkpoint validation

- Typecheck, lint, install-doc verification, plugin verification and scoped diff checks passed.
- Seven focused discovery/MCP/recipe/durable suites passed 42 tests. A later focused run covering the hardened storage, custom-registrar compatibility and install-roster correction passed 69 tests across four files.
- Current native suites passed again: Anvil 126 tests / 11 suites, Studio 47 tests / 4 suites.
- The broad candidate run passed 1,115 tests and skipped 30 optional cases, with one install-roster coverage failure. The new runtime-derived family check exposed the omitted workspace family; `inspect_workspace_storage` was added to the install verifier roster and that test passed in the subsequent focused run. An earlier sandboxed run could not open mock sockets/Swift caches; its environment failures are not recorded as passing tests.
- The job review found that a lost idempotency mapping could permit a second identity after paid reservation. Submission now scans bounded existing identities under the key lock and refuses missing/ambiguous evidence; the new deletion-after-reservation regression passes.

Generic background execution, source-ledger transport integration, generalized packages and crate orchestration remain unfinished. Unwired follow-on cores are not part of the first committed capability claim.

## Source evidence checkpoint

The `provenance` operation family now plans strict source records, saves exact
reviewed hashes against ledger revisions, inspects bounded summaries/details, and
exports inventory or CycloneDX snapshots. CLI and MCP share the same schemas and
fresh mutation confirmation. Native catalog/schema entries and the installed
package verifier include all four operations. Code, model and output rights stay
independent. Unknown rights and user assertions never become legal clearance or
execution authority.

MCP resources expose the verified index, exact current records and immutable
export snapshots. Stale record references fail explicitly; previously exported
snapshots remain readable after ledger changes if their bytes still verify.
Private path aliases, hard links, tampering and oversized evidence are refused.
Read-only planning and inspection create no provenance files. This remains an
explicit operator-maintained ledger: automatic dependency/release-byte population,
account/terms revalidation and ledger-aware shipping admission are still open.

Durable v2 status reads now share writer transactions, preventing a reader from
mistaking the brief record/event update interval for interrupted evidence. The
regression pauses a real record replacement and proves the reader waits; truly
interrupted evidence remains refused. No background worker or silent capture
resume is introduced.

### Checkpoint validation

- Typecheck, lint, documentation verification and scoped whitespace checks passed.
- Five focused ledger/export/transport/durable suites passed 28 tests, including
  separate mutation approval, stale plans, concurrent updates, lost-key refusal,
  coherent reads, historical exports and tamper/path/size refusals.
- Refreshed CPU suite: 121 files passed, two skipped; 1,127 tests passed, 30 skipped.
  Excluded the macOS runtime-payload file and uncommitted procedural-crate tests.
  Optional app/Blender/GPU/Basis/CoACD execution remained disabled. The suite used
  local mock sockets and ordinary Swift caches outside the restrictive sandbox.
- Anvil passed 126 tests in 11 suites; retained Studio passed 47 tests in four
  suites. These are Foundation/process/catalog tests with no app window.
- `npm run verify` passed: the disposable installed package exposed 115 local
  operations across 25 CLI families and 115 MCP tools over clean stdio. Five
  installed skills and the screenshot-free plugin export verified. Only declared
  package dependencies were installed into the temporary consumer.

Generalized packages, the complete crate recipe, generic background execution,
actual client/native interactive review and real hardware/provider qualification
remain open. See `docs/source-evidence.md` for the precise implemented workflow
and evidence limits.

## Multi-kind package and crate checkpoint

The shared registry now exposes a deterministic local crate plan/construction
path and separate generalized package plan/build operations. The complete CPU
fixture journey retains hierarchical editable GLB source, flattened LOD0, reduced
LOD1, box collision, recipe/LOD chain, validation, PNG previews and receipts.
Construction does not authorize packaging; packaging does not authorize project
admission. Parameter, source, destination and recorded implementation drift
invalidate reviewed plans.

V2 packages have explicit primary files and typed artifact roles for mesh,
animation, material, audio and flipbook storage. V1 readers/mesh outputs stay
compatible. Only static geometry and animation presence checks are established;
material/audio/flipbook semantic quality remains unverified and default v2
admission refuses unperformed primary validation. Package resources verify every
roster read and cap responses at 16 MiB, preserving larger local-file fallbacks.

Fresh catalog databases use v2. Existing v1 indexes stay unchanged until explicit
fingerprint-bound migration. Tests cover verified backup/rollback, atomic failure
preservation, canonical destination binding, changed lease evidence, stopped-owner
recovery, unknown newer versions and unmanaged busy writers. Source/ownership
fingerprints are distinct; recovery never expires a lease by age. A missing
runtime backup API refuses the operation rather than attempting replacement.

V2 project-copy plans bind current destination, manifest, exact ledger references
and explicit overrides. Unknown license/rights and unperformed primary validation
block by default; known denied rights cannot be overridden. Mixed v1/v2 lock
history remains readable. Fixture-copy overrides demonstrate the workflow only,
with no legal, engine-import or artistic-quality clearance.

### Checkpoint validation

- The complete CPU suite passed: 128 files passed, two skipped; 1,178 tests passed,
  30 optional cases skipped. Only the macOS runtime-payload file was excluded;
  new crate/package/migration/resource/transport tests were included.
- The actual CLI and MCP fixture journeys pass through plan, refused/confirmed
  construction, separate refused/confirmed packaging, catalog, verification,
  resource retrieval, rights blockers and independently authorized copying.
  CLI `--confirm` alone correctly refused generic project writes; the fixture was
  corrected to supply the existing separate human-controlled launch ceiling.
- Typecheck, lint, documentation checks and plugin verification passed. The native
  schema export now contains 66 tools; runtime/native interactive review remains
  unperformed. An initial native compile caught a nonexistent route name; the
  crate entries now use the existing Mesh workspace.
- Native retest passed: Anvil 126 tests / 11 suites, retained Studio 47 tests /
  four suites. No application window, Blender, GPU workload or provider launched.
- `npm run verify` passed for the disposable installed tarball: 124 CLI operations
  across 25 families, 124 MCP tools over clean stdio, five installed skills and a
  verified screenshot-free plugin export. No host dependency/profile changes.

Generic background workers, full intent/recipe integration, complete dependency
byte closure, source-ledger automatic population, semantic validation for the
remaining asset kinds and real native/client/hardware quality evidence remain
open. The main roadmap goal remains active.
