# Blender reliability and checkpoints

`npm test` runs the fast suite. Real Blender tests require
`GAME_DEV_TEST_BLENDER=1 npx vitest run tests/normalize.test.ts`; Metal GPU tests
require `GAME_DEV_TEST_GPU=1 npx vitest run tests/probe-metal.test.ts` on macOS.
The existing remote CI jobs explicitly set these switches. Finding an installed
Blender is no longer permission for tests to launch it. Protocol tests use small
Node stub executables, never Blender.

Every Blender child prints its script, CPU thread cap and timeout to stderr before
launch. The service admits one Blender child at a time (other CLI processes have
independent limits), defaults to two CPU threads, and accepts 1–16 threads through
the TypeScript runner. Timeouts are capped at 900 seconds and terminate the process
group. This is a thread/time limit, not an OS memory or GPU quota. The runner retains
bounded crash-report tails in error details before deleting the isolated home;
stderr details identify failures without leaving an unbounded capture directory.

Both packaged Python scripts emit `org.gamedebug.blender_receipt.v1`. The shared
TypeScript parser validates known numeric counters and versioned identity fields;
unknown versions fail. Versioned receipt operations must match the packaged script. Legacy wrappers without a schema remain compatible.
CLI and MCP tools use the same parser. Produced mesh geometry and hashes are still
measured independently: a valid receipt is a subprocess claim, not proof of quality.

`batch_prepare_meshes` accepts an optional `checkpointDir`. Each completed self-contained GLB is checkpointed immediately. GLB envelopes are
validated; external resource URIs and unknown extensions disable reuse for both
inputs and outputs. The extension alone never proves dependency closure. A subsequent call reuses it only if the source path and
bytes, complete policy and batch options, normalization script and option-wiring module bytes and Blender
executable bytes match. Output bytes must match their sealed SHA-256 and pass a
fresh inspection under the current policy. Changing output bytes, source bytes,
policy, options or tool executable forces preparation again. Corrupt checkpoints
are ignored; a failed checkpoint save is returned as `checkpointWarning` without
hiding a successfully produced asset. `items[].reused` distinguishes reuse and
`outputsWritten` counts only files written in this call.

External-resource `.gltf` files remain supported for preparation but are never
reused, since their dependency closure is not yet sealed. Checkpoint reuse is disabled for a non-native `BLENDER_PATH` wrapper because its
bytes cannot identify the downstream tool; use the real Blender executable. Checkpoints perform only free local operations and
never carry paid-operation authority across runs.
