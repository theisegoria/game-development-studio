# Accounting, provider history, and durable recovery

Every paid reservation reads the current ledger while holding an exclusive filesystem lock. The ceiling check and atomic, fsynced write occur under that lock. Independent CLI/MCP processes sharing a workspace therefore share the same accounting state. Use a local filesystem with exclusive-create and atomic-rename semantics; this is not a distributed database for unrelated machines or eventually consistent network storage.

Unreadable JSON, an unsupported schema, invalid entry values, duplicate entry identifiers, or a previously initialized ledger disappearing block paid work even after a process restart. A separate fsynced `spend-ledger.json.present` marker is written before the first transaction and backfilled when a valid legacy ledger is opened. A damaged marker also blocks paid work. Deleting both the ledger and its marker is outside this accidental-loss protection; do not remove either during cleanup. Free `get_spend_report` still returns health diagnostics with unknown balances. Never delete a damaged ledger to reset a budget. Preserve it and reconcile against a verified backup and provider records before restoring accounting.

Reservations survive network failures, because a lost response does not prove that the provider did not bill. Released reservations retain their audit history. Releasing a reservation is only safe when no provider request was sent; provider-reported charges cannot be released. A repeated reservation for the same asset job and operation is rejected. The ceiling counts the larger of estimated and reported cents, while reports retain both figures separately.

## CLI and MCP tools

All tools below are available through MCP or `game-dev tool call NAME --input '{...}' --output-dir WORKSPACE --json`:

- `get_spend_report`: local accounting health and conservative ceiling balance.
- `get_provider_history`: reservation/approval provenance, estimates, reported charges, unknown-charge counts, reviewed outcome failure rates, and user quality ratings. Current asset-job outcomes are reported separately because a job may include several pipeline stages. Provider-reported credits are not silently converted into a known USD invoice amount.
- `record_provider_outcome`: `entryId` and `outcome` (`succeeded`, `failed`, or `unknown`). This records an operator-reviewed outcome; failure does not release spend or authorize replay.
- `rate_provider_result`: `entryId`, `rating` from zero to five, and `note`. Ratings are subjective review evidence, not a claim of objective quality.
- `diagnose_durable_jobs`: optional `staleAfterMs`; lists corrupt records and stale queued/running jobs without hiding either.
- `recover_durable_job`: `jobId` and `confirm: true`; seals local orchestration as cancelled. It cannot stop or prove the status of external work.
- `quarantine_corrupt_job`: `jobId` and `confirm: true`; durably preserves original job/event bytes as recovery evidence and replaces the corrupt local identity with an immutable cancelled record. It never reconstructs a request or submits a provider call.
- `recover_storage_lock`: `kind` (`spend` or `job`), optional `jobId` for a job lock, and `confirm: true`. Recovery requires a provably dead owner process on the same host. Live, malformed, or foreign-host locks are refused; stop all workers and investigate such cases manually.

Locks never expire merely because time passed. A crashed worker may leave a lock, deliberately blocking mutation until explicit recovery. Storage lock recovery does not establish whether a paid request reached its provider.

Asset-job records also validate identity, statuses, timestamps, nested provider records, reference selections, and file metadata on read and before save. Corrupt records are surfaced in listings, and an incomplete provider-task lookup cannot be treated as proof that a task never existed.

Invocation history explicitly sets `userApprovalVerified: false` when transport approval evidence has not been supplied. An observed tool invocation is not independently verified human consent.

Durable v1 records now validate identity, statuses, timestamps, counters, artifacts, and optional fields. Only one process may start a queued job. Retry creation atomically claims the parent, preventing concurrent duplicate retries. A failed provider operation (including generic paid tool calls) cannot be retried through `job resume` when its submission outcome could be unknown. Inspect the original provider task and reservation. An approval-required job may resume with the existing CLI's fresh approval boundary; prior approval is never carried forward.

Validation uses temporary synthetic workspaces, mock providers, and concurrent Node processes. No provider calls, Blender launches, GPU work, or user-workspace cleanup are involved.
