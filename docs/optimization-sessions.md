# External-agent optimization sessions

The CLI owns source snapshots, candidate validation, capture evidence, and patch
review. An external coding agent edits the disposable checkout reported by the
session. Studio does not launch an agent or automatically apply its changes.

## Sample workflow

Create a new deterministic sample and initialize its source index:

```sh
game-dev adapter sample --project /tmp/studio-sample --confirm --json
git -C /tmp/studio-sample init
git -C /tmp/studio-sample add .
game-dev scenario run capture --project /tmp/studio-sample --input '{"mode":"normal"}' --confirm --output-dir /tmp/studio-evidence --json
```

Use the returned run path as BASELINE below. Build and test executable paths are
local executable paths; arguments are literal arrays, never shell strings.

```json
{
  "scenarioId": "capture",
  "parameters": {"mode": "normal"},
  "metric": "render.frame_time",
  "unit": "ms",
  "target": 10,
  "direction": "lower",
  "statistic": "median",
  "maximumIterations": 3,
  "allowedPaths": ["src"],
  "build": {"executable": "/absolute/path/to/node", "arguments": ["--check", "capture.mjs"]},
  "tests": [{"executable": "/absolute/path/to/node", "arguments": ["test.mjs"]}],
  "visualThreshold": 0,
  "maximumChangedPixelRatio": 0
}
```

```sh
game-dev optimization plan BASELINE --project /tmp/studio-sample --request goal.json --json
game-dev optimization start BASELINE --project /tmp/studio-sample --request goal.json --session-root /tmp/studio-sessions --plan-hash REVIEWED_PLAN_HASH --confirm --json
```

Start recomputes the plan and refuses source, baseline, adapter, or request drift.
Session storage must be outside the original project. Tracked working-tree bytes,
including tracked modifications and deletions, are preserved in a new independent
Git repository. Untracked source is included only through `includeUntracked`,
inside the source allowlist; the adapter is always included. Symlinked source is
refused. The original Git index and working-tree files are left untouched.

The external agent can now edit `src/renderer.json` in the returned checkout,
reducing `frameTime` to 8 while retaining `visualRegression: false`.

```sh
game-dev optimization evaluate SESSION_DIRECTORY --confirm --jsonl
game-dev optimization status SESSION_DIRECTORY --json
game-dev optimization export SESSION_DIRECTORY --output /tmp/studio-review --confirm --json
```

Each evaluation consumes one attempt, checks the patch against the immutable
snapshot and allowlist, runs the declared build/tests, executes a new capture,
and verifies visual and metric limits. GPU and hardware-performance execution
require fresh `--allow-gpu` and `--allow-performance` authority when applicable.
Changed controls, missing metrics, failed captures, visual regressions, duplicate
patches, and source mutation during validation fail the attempt. Default limits
are three candidates, median comparison, and no changed pixels.

The sample uses declared synthetic values, not hardware timings. Its normal,
visual-regression, failure, and timeout modes test workflow behavior. An improved
candidate is a source edit, keeping scenario parameters fixed.

## Interruption, concurrency, and review

An exclusive session lock prevents simultaneous mutations. A stopped worker's
lock requires `optimization recover SESSION_DIRECTORY --confirm`; recovery
marks unfinished attempts interrupted and executes nothing. A new `evaluate`
invocation is required. `optimization stop ... --confirm` stops future attempts;
cancel the active CLI process to interrupt an in-progress attempt.

Export requires a target-meeting candidate that passed every gate and refuses if
the original source snapshot has drifted. It writes `candidate.patch`,
`review.json`, and visual comparison evidence into a new directory. Review the
patch before applying it, and recheck source drift immediately before application.
No command in this lifecycle automatically modifies the original source checkout.

These are workflow controls, not an agent security sandbox. The session files
and checkout are owned by the same local user. Passing numerical limits is not
proof of causality, statistical significance, human approval, or hardware timing.
Legacy `performance goal-create` and `goal-evaluate` remain numerical records;
they are never upgraded into execution sessions implicitly.

## Analysis interfaces

`capture list` provides read-only discovery and shows corrupt runs explicitly.
`performance summarize` and `compare` now return v2 analysis payloads; CLI
result/event envelopes remain v1. v1 sealed runs and goal records remain readable.
Raw samples retain source, aggregation, frame, and standard telemetry timestamps.
Supplied aggregates are separate, and ambiguous multi-source distributions are
reported without pooling unrelated measurements. Comparison reports missing
metrics, incompatible source groups, and unknown/different controls.

Adapters may optionally report `adapterEvidence.hardware` and
`adapterEvidence.build` scalar metadata maps. Hardware and build configuration
are comparison controls; a build `revision` is recorded but may differ between
optimization candidates. This metadata is adapter-reported, not independent
hardware attestation.

`visual compare ... --output NEW_DIRECTORY` writes comparison JSON, copied PNGs,
heatmaps, and a self-contained HTML report. The export never changes sealed runs.
