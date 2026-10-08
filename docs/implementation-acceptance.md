# Local completion acceptance — 2026-09-08

This record covers the completed Studio workflows, versioned analysis, and bounded external-agent optimization implementation. Generic measurements demonstrate workflow correctness; they are not real-game or hardware performance claims.

## Automated and package evidence

- TypeScript build, typecheck, and lint passed.
- The complete TypeScript suite passed: 495 tests across 38 files. A subsequently added release-descriptor consistency regression passed with all eight provenance tests.
- All 47 Swift tests passed, including bound scenario parameters, independent workspace results, approval/trust handling, process cancellation, and timeout cleanup.
- Optimization regressions cover aggregation handling, incompatible controls, isolated dirty snapshots, out-of-scope edits, concurrent locking, explicit interrupted-session recovery, duplicate candidates, visual regression, source drift, and deterministic failure/timeout captures.
- Disposable npm installation passed: 298 packaged files, 20 free local operations across 19 command families, five installed skills, and verified skills-only export. Plugin verification and macOS packager self-test passed.
- The final local macOS app built successfully. Its bundled runtime verifier admitted all 422 entries with tree SHA-256 `bb5ee71d5597d5f40b2bbc69d169fe6fe2a9cf526e3d4769b393a52fb6a2814e`. Ad-hoc signature verification passed after removing Finder metadata introduced by launching the app.
- Release identities are centralized in `docs/release.json`: app 1.0.0/build 1, CLI and skills 1.0.2, Node 25.2.1, macOS 26, arm64. Legal text byte counts/hashes and bundled dependency provenance are checked. Historical screenshot provenance remains unchanged.

## External-agent demonstration

An external coding assistant used the CLI to plan and start a session, edited only the isolated checkout's allowlisted `src/renderer.json`, then evaluated and exported the candidate. The declared test passed, capture artifacts verified, the synthetic median changed from 12 ms to 8 ms, and the visual comparison reported zero changed pixels. The original source remained at 12 ms. The resulting review included a patch, measurements, comparisons, and gate results.

The exported patch SHA-256 was `62a1f85f96e356b774eb71457c5317edf82fe237a15852f622a119df367d760a`. Local demonstration evidence is under `/private/tmp/studio-acceptance-ApKYjF`; this temporary directory is not a distributed product dependency. The checked-in generic sample and optimization tests reproduce the lifecycle.

## Native runtime review

All four workspaces were opened and visually inspected in light and dark appearance. Review exercised generic scenario selection, typed parameter display, planning, approval invalidation after authority changes, verified run discovery, capture viewing, side-by-side comparison, raw sample/distribution charts, metric deltas, and a completed optimization session. Unknown hardware/build comparability is displayed explicitly.

Keyboard focus navigation and accessible control labels were inspected. A missing asset produced an actionable structured error. Relaunch restored the selected workspace and project field without restoring results or approvals. The user's original dark appearance and output location were restored afterward. Command–Period cancelled a running local operation through the native command menu binding, and the UI reported that the process was terminated. Process cancellation and force-termination behavior also passed native automated tests.

No paid provider submission was made. Runtime review is an engineering inspection, not independent human visual approval. Developer ID signing, notarization, public publication, new providers, and Myth/Marathon integration remain deferred.
