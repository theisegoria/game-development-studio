# Workspace retention and GitHub update plans

The registry exposes these operations through `game-dev tool call <name> --input '<JSON>'` and MCP. Use the configured asset workspace. No command launches Blender, a provider, a GPU capture, an installer, or an engine adapter.

## Disk inventory and reversible cleanup

`inspect_workspace_storage` measures logical bytes and SHA-256 hashes for regular files, split into original, derived, capture, metadata, and unknown classes. Source folders are originals; previews/cache/derived/normalized/variants folders are derived; capture/frame/run folders are captures. Unrecognized files stay protected. Logical bytes are not allocated blocks or available disk capacity.

`plan_workspace_retention` accepts `action: "quarantine"` (default) or `"export"`, plus optional workspace-relative `paths`. The returned versioned plan is bound to its root, current bytes, references, and policy by its `id`. The planning command writes nothing. Review its files and totalBytes before execution.

Cleanup protects original, unknown, and metadata files; every package/job/baseline tree; and files or directories referenced by JSON/JSONL records in the workspace and configured data root. Absolute references are canonicalized, including macOS path aliases. A symlink, unreadable record, or oversized record blocks cleanup rather than guessing whether its references are safe. The metadata reader is intentionally conservative; it does not interpret opaque third-party databases as evidence that an asset is disposable.

`execute_workspace_retention` accepts the full returned `plan`. It recalculates the selection and rejects stale or edited plans. It moves selected bytes into `.retention/<receiptId>/files`, saving a versioned receipt before and after moves. It **does not delete bytes or free physical disk space**. There is deliberately no automatic expiry or irreversible purge. Export to user-chosen storage can help archive assets; physical deletion remains a separate human action.

`list_workspace_retention` exposes receipts, corrupt records, and operation locks. `restore_workspace_retention` accepts a `receiptId` and verifies hashes before restoring without overwriting changed files. Receipt plan digests are checked on read, and restoration verifies and flushes the destination before removing its quarantine source. Recovery examines all planned paths, including a move that completed before its receipt update. A crash between a restore copy and unlink is recoverable if the destination bytes match. An interrupted operation lock is never stolen automatically: verify that no retention operation is running and inspect its receipt before manually removing a stale `.retention/operation.lock` directory. Corrupt receipts are reported and never executed. The lock serializes retention operations, not independent producers: stop other writers while executing a reviewed retention plan. Portable Node filesystem operations cannot provide isolation against a hostile process changing directory entries between checks.

`export_workspace_files` accepts an export `plan` and an existing `destination` outside the workspace. It creates a fresh named bundle, copies selected files, checks every hash, and records `state: "verified"` in `export.json`. A failed export retains its incomplete bundle with `state: "copying"` for inspection. Source bytes are retained. The destination is user-chosen; the tool does not configure any drive or mount.

On the CLI, also supply `--confirm` for each mutation. All three mutation commands require `GAME_DEV_MCP_ALLOW_PROJECT_WRITE=1` in the human-controlled launch environment and per-call transport confirmation. This is the existing explicit-write grant; no approval field in JSON can supply authority.

## Upgrade and rollback planning

`plan_release_change` requires `installedVersion`, `targetVersion`, local `artifact` and `checksums`, and retained `rollbackArtifact` and `rollbackChecksums`. It supports the existing release CLI `.tgz` and skills-plugin `.zip` artifacts, requires the exact versioned file name, rejects ambiguous checksums, and hashes local bytes without extracting or executing them.

Set `verifyGitHub: true` to fetch stable release metadata from the fixed public `theisegoria/game-development-studio` GitHub API. The target **and** rollback artifact must match release identity, canonical download URL, size, and GitHub's SHA-256 asset digest before `readyForManualInstall` is true. A release lacking a GitHub digest is a blocker; the tool does not silently lower verification to local checksum agreement. Without the option, a useful offline integrity plan is produced but readiness remains false. Versions are explicit; the tool never silently selects a latest release or upgrades to a prerelease.

The result contains staged installation, smoke-test and rollback steps using the existing GitHub release chain. It performs no install, profile change, signing, notarization, npm publication, store submission, or automatic launcher switch. GitHub HTTPS digest agreement is provenance relative to the release API, not a publisher signing guarantee. Use existing `doctor` to check runtime/dependency discovery and `capabilities` against a temporary workspace before switching a manually managed installation. Doctor does not contact providers or launch Blender/GPU processes.
