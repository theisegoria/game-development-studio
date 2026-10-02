# Studio roadmap acceptance matrix

Goal: implement and debug the full standalone Studio roadmap, commit and push
reviewable increments, then release verified source and canonical skills artifacts
on GitHub. A passing partial milestone does not complete this goal.

Scope: public Studio and canonical skills export only. No engine integration,
provider purchases, profile installation, paid services, store/npm publication,
or new signing credentials. Local validation uses mocks/compile-only; real
Blender/GPU execution belongs to existing opt-in remote CI.

Implementation starts from v1.1.0 / 04202b9. Source PR #7 and skills PR #4
only pin Actions and remain independent, unmerged work.

| Milestone | Acceptance gate | Evidence/status |
| --- | --- | --- |
| Transactional accounting | Competing processes cannot overspend or lose entries; malformed/unreadable ledger blocks spending while free diagnostics work; reservations survive ambiguity | Implemented; `accounting-reliability.test.ts`, `spend.test.ts` (including eight competing Node processes) |
| Durable jobs | Validated records, corrupt/stale visibility and explicit recovery without resubmitting uncertain paid work | Implemented; `accounting-reliability.test.ts`, `durable-jobs.test.ts`, `cli-durable-contract.test.ts` |
| Blender receipts and batches | Versioned Python/TS receipt contracts; checkpoint reuse verifies inputs, policy/options, tool identity and output bytes | Implemented; `mesh-checkpoints.test.ts`, `blender-protocol.test.ts`, `mesh-batch.test.ts`; real Blender gate passed in tagged 1.2.0 release |
| Visual review | Turntable, wireframe, UV/material views; side-by-side selection; persisted approval tied to exact asset content and package flow | Implemented; `asset-review.test.ts`, `asset-packages.test.ts`; synthetic dashboard visually checked |
| Disk and retention | Measured classes; references protect evidence/jobs/packages; reviewable dry run, explicit reversible cleanup and generic export tested on fixtures | Implemented; `workspace-retention.test.ts`, `workspace-tools.test.ts`; quarantine reclaims zero physical bytes |
| Production recipes | Persisted dependency graph; invalidation and resume; fresh operation-specific spend/mutation authorization | Implemented; `production-recipes.test.ts`, `roadmap-transports.test.ts` (real CLI validate/package fixture) |
| Platform preparation | Declarative variant/LOD/collision/texture/material/budget recipes execute supported operations, identify unavailable ones, produce standalone packages | Implemented; `production-recipes.test.ts`, `production-textures.test.ts`; 1.2.0 compression/convex unavailable; actual CPU implementations now under 1.3.0 validation |
| Installation/update | Dependency diagnostics and checksum-verified GitHub upgrade/rollback planning without installing into user profiles | Implemented; `release-change.test.ts`, existing doctor tests; Windows Node 22/24 actual 1.2.0 release tarball installation passed |
| Blender controls | Default tests never auto-launch Blender/GPU; opt-in remote lanes; process intent, bounded concurrency/resources and useful failure records | Implemented; default opt-ins and process controls; real CI pair tests serialized under one-child limit |
| Regression dashboard | Named baselines, scenario matrix, expected-change review/history over sealed comparisons; differences never labelled quality automatically | Implemented; `asset-review.test.ts`; changed sealed runs and replaced heatmaps reject approval/display |
| Asset families | Shared approved style/scale/palette/naming, sample approval before expansion, fresh provider authorization | Implemented; `production-recipes.test.ts`; template substitution and sample-graph edits covered |
| Provider history | Estimates separated from reported charges, unknown costs stay unknown, failures and approvals visible | Implemented; `accounting-reliability.test.ts`, transport approval-scope regression; unknown charges/outcomes explicit |
| Release | Source + canonical export parity; typecheck/lint/regression/security/license/package checks; exact-head remote CI; Windows artifact installation; checksums and honest release notes | [Studio 1.2.0](https://github.com/theisegoria/game-development-studio/releases/tag/v1.2.0) and [skills 1.2.0](https://github.com/theisegoria/game-development-studio-skills/releases/tag/v1.2.0) published after all 16 tagged release jobs passed; uploaded digests verified |

Each row must gain concrete tests and release links before it is complete.
A schema, a plan, a skipped test or a capability refusal alone is not evidence
that a promised executable feature works. Unsupported external capabilities
must remain explicitly unavailable. Existing engine/probe capabilities are not
expanded or presented as new engine acceptance evidence.

## Current validation checkpoint

- Final 1.2.0 local suite: 880 passed, 27 skipped (real Blender/GPU opt-in and platform gates).
- Latest focused texture/recipe/transport/skill-reference run: 20 passed.
- Anvil compiles with all 104 native mock tests passing; all 35 new tools have
  runtime-derived request schemas, stdin transport and fresh approval controls.
- Typecheck and lint passed; both license profiles bind to the refreshed lockfile.
- Dependency audit reported zero vulnerabilities after compatible updates.
- Source: https://github.com/theisegoria/game-development-studio/pull/8
- Canonical skills: https://github.com/theisegoria/game-development-studio-skills/pull/5
- Source PR #7 and skills PR #4 remain open and were not merged into this work.

Known 1.2.0 capability limits: CPU review is static geometry/base-color/material swatches,
not final PBR/animation rendering. Texture compression and convex decomposition are
unavailable; supported texture resize, decimation, opacity normalization, budget
checks and AABB collision produce real standalone artifacts. Recovery never proves
provider non-submission merely from a timeout. Retention requires independent
writers stopped, retains reversible quarantine bytes, and reports no space reclaimed.
Upgrade plans do not install software or attest signing. No engine integration added.

## Functional gap closure after 1.2.0

The published release does not claim the unavailable capabilities above work.
The full implementation goal continues through these independently verified changes:

| Follow-up | Concrete acceptance | Status |
| --- | --- | --- |
| Quarantine purge | Digest-bound dry run, fresh reference protection, explicit irreversible confirmation, durable partial-failure recovery; fixture-only tests | Implemented; owner 56 focused tests and independent 27-test purge audit passed; final release pending |
| Actual GPU texture compression | CPU Basis Universal ETC1S/UASTC KTX2, valid glTF extension and package round trip, versioned tool/source receipts, bounded real remote CPU tests | Implemented; real Basis CPU tests passed Linux/macOS/Windows; adversarial MIME/source binding regressions fixed; independent 35-test audit passed |
| Actual convex decomposition | Pinned CoACD CPU multi-hull output, geometric validation, concave fixture retaining its opening, honest approximation error and platform limits | Implemented; real Linux x64/ARM64 and macOS passed; Windows repaired; all four real CPU gates passed run 36951772468 |
| Standalone Anvil bundle | Copy and verify SwiftPM schema resource bundle; prove lookup independently of build tree | Implemented; installed resource fixture and all 108 native tests passed |
| Native GitHub archive | Adapt existing ZIP verification for Anvil/current version/pinned runtime, verify extracted archive on remote macOS; explicitly ad-hoc and non-notarized | Actual macOS staging, archive extraction and signature/runtime verification passed run 36951396198; final 1.3.0 release pending |

Verified update/rollback **planning** is the original installation requirement and
is implemented. Automatic installation and DMG/PKG delivery are different features.
Developer ID/notarization is not configured by the existing release chain; acquiring
new credentials/accounts is excluded. This does not assert that the user lacks an
account. The ad-hoc ZIP engineering gap is now implemented and remote-verified; its tagged release gate remains required.

## 1.3.0 validation checkpoint

- Source follow-up: https://github.com/theisegoria/game-development-studio/pull/9
- Canonical export: https://github.com/theisegoria/game-development-studio-skills/pull/6
- Local mock suite: 912 passed, 30 skipped; real Blender/GPU/optional CPU opt-ins disabled.
- Disposable tarball installation: 479 files, 88 CLI/MCP operations, five skills, clean MCP stdout.
- Native archive is verified ad-hoc/non-notarized, not Developer ID signing or Gatekeeper acceptance.
- Independent admission/authorization/recipe review found and verified fixes for MIME spoofing and diagnostic process intent; no remaining blocker from that scoped audit.
- Full exact-head gates and uploaded 1.3.0 artifact verification remain required before release.

## Native integration correction before publication

The 1.3.0 candidate passed all 21 exact-head PR checks and its native archive was
downloaded and verified (2,304 entries). Before public release, code review found
Anvil stripped the three explicit optional CPU dependency settings. The 1.3.0 tags
remain unchanged and unpublished. A narrow process-boundary repair and regression
test are being released as 1.3.1; no inherited spend/mutation grants are retained.
The final broad mock suite at the 1.3.0 candidate was 916 passed, 30 skipped.
