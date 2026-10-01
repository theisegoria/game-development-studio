# Studio roadmap acceptance matrix

Scope: public Studio and canonical skills export only. No engine integration,
provider purchases, profile installation, paid services, store/npm publication,
or new signing credentials. Local validation uses mocks/compile-only; real
Blender/GPU execution belongs to existing opt-in remote CI.

Implementation starts from v1.1.0 / 04202b9. Source PR #7 and skills PR #4
only pin Actions and remain independent, unmerged work.

| Milestone | Acceptance gate | Evidence/status |
| --- | --- | --- |
| Transactional accounting | Competing processes cannot overspend or lose entries; malformed/unreadable ledger blocks spending while free diagnostics work; reservations survive ambiguity | In progress |
| Durable jobs | Validated records, corrupt/stale visibility and explicit recovery without resubmitting uncertain paid work | In progress |
| Blender receipts and batches | Versioned Python/TS receipt contracts; checkpoint reuse verifies inputs, policy/options, tool identity and output bytes | In progress |
| Visual review | Turntable, wireframe, UV/material views; side-by-side selection; persisted approval tied to exact asset content and package flow | In progress |
| Disk and retention | Measured classes; references protect evidence/jobs/packages; reviewable dry run, explicit reversible cleanup and generic export tested on fixtures | In progress |
| Production recipes | Persisted dependency graph; invalidation and resume; fresh operation-specific spend/mutation authorization | In progress |
| Platform preparation | Declarative variant/LOD/collision/texture/material/budget recipes execute supported operations, identify unavailable ones, produce standalone packages | In progress |
| Installation/update | Dependency diagnostics and checksum-verified GitHub upgrade/rollback planning without installing into user profiles | In progress |
| Blender controls | Default tests never auto-launch Blender/GPU; opt-in remote lanes; process intent, bounded concurrency/resources and useful failure records | In progress |
| Regression dashboard | Named baselines, scenario matrix, expected-change review/history over sealed comparisons; differences never labelled quality automatically | In progress |
| Asset families | Shared approved style/scale/palette/naming, sample approval before expansion, fresh provider authorization | In progress |
| Provider history | Estimates separated from reported charges, unknown costs stay unknown, failures and approvals visible | In progress |
| Release | Source + canonical export parity; typecheck/lint/regression/security/license/package checks; exact-head remote CI; Windows artifact installation; checksums and honest release notes | Pending implementation |

Each row must gain concrete tests and release links before it is complete.
A schema, a plan, a skipped test or a capability refusal alone is not evidence
that a promised executable feature works. Unsupported external capabilities
must remain explicitly unavailable. Existing engine/probe capabilities are not
expanded or presented as new engine acceptance evidence.
