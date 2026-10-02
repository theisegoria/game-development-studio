# Studio roadmap acceptance matrix

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
| Blender receipts and batches | Versioned Python/TS receipt contracts; checkpoint reuse verifies inputs, policy/options, tool identity and output bytes | Implemented; `mesh-checkpoints.test.ts`, `blender-protocol.test.ts`, `mesh-batch.test.ts`; real Blender remote gate pending final head |
| Visual review | Turntable, wireframe, UV/material views; side-by-side selection; persisted approval tied to exact asset content and package flow | Implemented; `asset-review.test.ts`, `asset-packages.test.ts`; synthetic dashboard visually checked |
| Disk and retention | Measured classes; references protect evidence/jobs/packages; reviewable dry run, explicit reversible cleanup and generic export tested on fixtures | Implemented; `workspace-retention.test.ts`, `workspace-tools.test.ts`; quarantine reclaims zero physical bytes |
| Production recipes | Persisted dependency graph; invalidation and resume; fresh operation-specific spend/mutation authorization | Implemented; `production-recipes.test.ts`, `roadmap-transports.test.ts` (real CLI validate/package fixture) |
| Platform preparation | Declarative variant/LOD/collision/texture/material/budget recipes execute supported operations, identify unavailable ones, produce standalone packages | Implemented; `production-recipes.test.ts`, `production-textures.test.ts`; compression/convex decomposition explicitly unavailable |
| Installation/update | Dependency diagnostics and checksum-verified GitHub upgrade/rollback planning without installing into user profiles | Implemented; `release-change.test.ts`, existing doctor tests; final Windows release-artifact gate pending |
| Blender controls | Default tests never auto-launch Blender/GPU; opt-in remote lanes; process intent, bounded concurrency/resources and useful failure records | Implemented; default opt-ins and process controls; real CI pair tests serialized under one-child limit |
| Regression dashboard | Named baselines, scenario matrix, expected-change review/history over sealed comparisons; differences never labelled quality automatically | Implemented; `asset-review.test.ts`; changed sealed runs and replaced heatmaps reject approval/display |
| Asset families | Shared approved style/scale/palette/naming, sample approval before expansion, fresh provider authorization | Implemented; `production-recipes.test.ts`; template substitution and sample-graph edits covered |
| Provider history | Estimates separated from reported charges, unknown costs stay unknown, failures and approvals visible | Implemented; `accounting-reliability.test.ts`, transport approval-scope regression; unknown charges/outcomes explicit |
| Release | Source + canonical export parity; typecheck/lint/regression/security/license/package checks; exact-head remote CI; Windows artifact installation; checksums and honest release notes | Source PR #8 and skills PR #5 pushed; skills verifier/parity pass. Exact-head CI, merge and release pending |

Each row must gain concrete tests and release links before it is complete.
A schema, a plan, a skipped test or a capability refusal alone is not evidence
that a promised executable feature works. Unsupported external capabilities
must remain explicitly unavailable. Existing engine/probe capabilities are not
expanded or presented as new engine acceptance evidence.

## Current validation checkpoint

- Broad local suite: 874 passed, 27 skipped (real Blender/GPU opt-in and platform gates).
- Latest focused texture/recipe/transport/skill-reference run: 20 passed.
- Typecheck and lint passed; both license profiles bind to the refreshed lockfile.
- Dependency audit reported zero vulnerabilities after compatible updates.
- Source: https://github.com/theisegoria/game-development-studio/pull/8
- Canonical skills: https://github.com/theisegoria/game-development-studio-skills/pull/5
- Source PR #7 and skills PR #4 remain open and were not merged into this work.

Known capability limits: CPU review is static geometry/base-color/material swatches,
not final PBR/animation rendering. Texture compression and convex decomposition are
unavailable; supported texture resize, decimation, opacity normalization, budget
checks and AABB collision produce real standalone artifacts. Recovery never proves
provider non-submission merely from a timeout. Retention requires independent
writers stopped, retains reversible quarantine bytes, and reports no space reclaimed.
Upgrade plans do not install software or attest signing. No engine integration added.
