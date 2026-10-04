# Distribution readiness and first-run evidence

The baseline is the compiled, checksum-verified GitHub CLI tarball documented
in [Install Game Development Studio](install.md), release **1.4.0**. Updates
remain manual. Its release workflow requires exact compiled artifact checks
before the release is published; source-packed checks are recorded separately.

## Channel decisions

| Channel | Prepared implementation | Remaining acceptance gate |
| --- | --- | --- |
| GitHub CLI tarball | Existing compiled JS package, release SHA-256 manifest, manual install and rollback, compiler-free installed-artifact verifier | Source matrix passed on all six Windows/Linux/macOS Node 22/24 lanes at `9e146810`; exact 1.4.0 bytes must pass the release matrix before publication |
| npm registry | Existing package metadata, publish roster, runtime license inventory and prepublish gates; source tarball exercises the same package | Existing authenticated publisher access; no account or credentials created, and no npm publication is performed by the GitHub release workflow |
| Windows bundled Node | User-prefix npm installation and `.cmd` launchers avoid administrator/policy changes; release 1.4.0 fixes direct `.mjs` sample launch | Measure remaining Node/PATH setup failures before adding a verified bundled runtime and legal inventory; no new bundle justified yet |
| Anvil macOS ad-hoc ZIP | Existing closed runtime, binary-only packaging, checksum manifests and provenance verification; hosted source archive passed at `9e146810` | Exact release staging/extraction/signature/runtime verification must pass; native interaction and clean-Mac Gatekeeper acceptance remain unproven |
| Anvil Developer ID distribution | No Developer ID signed or notarized artifact is produced | Existing account/access, signing/notarization configuration and clean-Mac normal launch acceptance |
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
  --artifact /absolute/theisegoria-game-development-studio-1.4.0.tgz \
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
| Source Windows sample | Passed on both Node 22/24 lanes at `9e146810`, including explicit Node interpreter, spaces/PATH/stale shim and missing optional tools |
| Source Linux/macOS Node 22/24 matrix | All four lanes passed at `9e146810` |
| Historical different-version update/rollback | All four hosted Linux/macOS Node 22/24 lanes passed at `9e146810`; macOS arm64 Node 25.2.1 public 1.2.0 → 1.3.1 → 1.2.0 → 1.3.1 passed in a disposable prefix; both release artifacts/manifest digests bound to GitHub. Prior initial install, rollback and reinstall each passed doctor, sample plan, 2 captures, sealed verification and equal comparison in fresh workspaces. No production workspace migration rollback proven |
| Human completion, keyboard/accessibility/cancel/restart | Requires authorized UI and usability sessions |
| Hosted optional tools and native archive | Basis on three platforms, CoACD on four runners, Blender, Metal and ad-hoc archive checks passed at `9e146810`; these are hosted evidence |
| Local Blender/GPU/app, Developer ID/notarization, paid providers | Not executed or implied by the CPU fixture or hosted results |
| Exact 1.4.0 tarball and manual rollback | Release workflow checks the same artifact on six platform/Node lanes and different-version rollback on Unix; Windows 1.3.1 cannot run the old sample, so full Windows rollback is not claimed |

See [the implementation ledger](ROADMAP_IMPLEMENTATION.md) for the broader
checkpoint and hosted run identities. Ben separately authorized GitHub
publication on 4 October 2026. A CI definition alone is not execution evidence;
release publication requires terminal successful checks on the tagged revision.
