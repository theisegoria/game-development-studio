# Distribution readiness and first-run evidence

The baseline is the compiled, checksum-verified GitHub CLI tarball documented
in [Install Game Development Studio](install.md), currently **1.3.1**. Updates
remain manual. This source checkpoint prepares checks and workflow fixes;
it has not been published and does not replace the public artifact.

## Channel decisions

| Channel | Prepared implementation | Remaining acceptance gate |
| --- | --- | --- |
| GitHub CLI tarball | Existing compiled JS package, release SHA-256 manifest, manual install and rollback, compiler-free installed-artifact verifier | Execute prepared Windows/Linux/macOS matrix for the new source; verify exact bytes again for the next release |
| npm registry | Existing package metadata, publish roster, runtime license inventory and prepublish gates; source tarball exercises the same package | Authorized publisher access and explicit publication approval; no account or credentials created |
| Windows bundled Node | User-prefix npm installation and `.cmd` launchers avoid administrator/policy changes; source fixes direct `.mjs` sample launch | Measure remaining Node/PATH setup failures before adding a verified bundled runtime and legal inventory; no new bundle justified yet |
| Anvil macOS app | Existing closed runtime, binary-only packaging, checksum manifests and provenance verification | Developer ID account/access, signing/notarization approval, clean-Mac normal launch and actual UI tests; ad-hoc builds do not prove Gatekeeper acceptance |
| Skills/plugin ZIP | Existing canonical export and closed roster | Keep release version links and exported skill bytes in parity with CLI source |

The historical Windows installation question was closed. It supports fixing
documented installation friction, not a claim of broad market demand. No new
engine integration, paid provider execution, cloud sync, purge or unattended
update is part of this checkpoint.

## Executable checks

From already-built source, the compiler-free verifier packs and installs into a
new global prefix outside the checkout. It uses paths with spaces, user-facing
launcher discovery, a simulated stale shim, no provider keys and an isolated
optional-tool configuration. It creates a sample, reviews its plan, captures
twice identically, captures a known change, verifies closed rosters/hashes and
compares outputs. Dependencies are fetched from npm with a 20-second fetch
timeout, no retry and a 60-second process bound.

```sh
npm run verify:docs
npm run verify:first-run
```

To test exact public release bytes rather than a source-packed artifact, save
the GitHub release API JSON and download that release's tarball and manifest:

```sh
node scripts/verify-first-run.mjs \
  --artifact /absolute/theisegoria-game-development-studio-1.3.1.tgz \
  --checksums /absolute/SHA256SUMS.txt \
  --release-metadata /absolute/release.json \
  --report /absolute/NEW-first-run-report.json
```

This validates both downloaded files against GitHub's declared digests, sizes,
URLs and release identity before installation. Without `--release-metadata`,
the result explicitly says `local-manifest-only`. The report's SHA-256 identifies
the CLI bytes, not future transitive npm resolution.

Supply `--previous-artifact ABSOLUTE_PRIOR_TARBALL --previous-checksums
ABSOLUTE_PRIOR_MANIFEST` to test an actual different prior version, update,
manual rollback and reinstall in the same disposable prefix. It does not reverse
production workspace migrations or touch user assets. No prior artifact means
the report explicitly marks rollback unexecuted; a simulated old PATH shim is
not rollback evidence.

Add `--previous-release-metadata ABSOLUTE_PRIOR_RELEASE_JSON` to bind the prior
tarball and manifest to its GitHub release identity as well. The report records
both prior digest and prior integrity level.

## Tested and missing

| Evidence | Status |
| --- | --- |
| Public 1.3.1 release identity and downloaded CLI bytes | Verified 4 October 2026; SHA-256 `a3f741aeba2dc3e8315d5bfee17821bef75ff23964653a48721ae50ab9bd52bc`, 11,250,482 bytes; manifest bytes also matched GitHub digest |
| Exact public artifact macOS installed first-run | Passed 4 October 2026 on macOS arm64, Node 25.2.1: installed global prefix outside source, paths with spaces, planned sample, 3 captures, sealed verification, equal repeat, known visual change, PATH ahead of simulated stale shim and missing optional tools |
| Source-packed macOS first-run | Passed 4 October 2026 on macOS arm64, Node 25.2.1; the same installed-artifact checks passed with the explicit Node sample runtime. This is local source-packed byte evidence, not a published release |
| Windows published 1.3.1 sample | Direct `.mjs` scenario execution is unsupported; installation/startup support does not prove sample support |
| Source Windows sample | Explicit Node interpreter prepared, with script/runtime identity checks; Windows Node 22/24 CI prepared, not executed in this session |
| Linux/macOS Node 22/24 matrix | CI prepared; local macOS Node 25.2.1 evidence does not prove this matrix |
| Different-version update/rollback | macOS arm64 Node 25.2.1 public 1.2.0 → 1.3.1 → 1.2.0 → 1.3.1 passed in a disposable prefix; both release artifacts/manifest digests bound to GitHub. Prior initial install, rollback and reinstall each passed doctor, sample plan, 2 captures, sealed verification and equal comparison in fresh workspaces. No production workspace migration rollback proven |
| Human completion, keyboard/accessibility/cancel/restart | Requires authorized UI and usability sessions |
| Blender/GPU, signing/notarization, paid providers | Not executed or implied by this CPU fixture |

See [the implementation ledger](ROADMAP_IMPLEMENTATION.md) for the broader
checkpoint. CI definitions and local checks are evidence preparation; no
workflow dispatch, public push, merge or release is authorized by their presence.
