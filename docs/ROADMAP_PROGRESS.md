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
