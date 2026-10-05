# Pull-request visual regression gate

A GitHub Action that tells you, on every pull request, whether your engine
still draws what it drew before, and shows you the difference when it does
not.

```yaml
# .github/workflows/visual.yml in YOUR engine's repository
name: Visual regression
on: pull_request

jobs:
  gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - id: gate
        uses: theisegoria/game-development-studio/action@v1.4.0
        with:
          scenario: capture
          request: scenarios/main-view.json   # optional, relative to the project
          build: make engine                   # optional, run in base and head
      - if: always()
        uses: actions/upload-artifact@v4
        with:
          name: visual-regression
          path: ${{ steps.gate.outputs.report-dir }}
```

Pin `actions/*` to commit SHAs in a real workflow, as this repository does.

## What it does

1. Installs the `game-dev` CLI from the checksum-verified GitHub release, the
   same steps as [the install guide](install.md).
2. Checks the pull request's **base commit** out into a temporary worktree,
   runs your `build` command there, and captures the scenario
   `baseline-runs` times (default 2).
3. Measures the base's own run-to-run noise with `visual stability`.
4. Builds and captures the **head**.
5. Compares head against base with `visual compare --noise-floor`, so a pixel
   counts as changed only when it moved by more than `threshold` **and** more
   than it moved between identical base runs.
6. Writes the verdict, the plain-language summary, a per-attachment table and
   an informational performance comparison to the job summary, and fails the
   job on `changed` or `incomparable` unless `fail-on: never`.
7. Removes the worktree, whatever happened.

There are no baseline files to commit or keep up to date: the base is
re-captured on the same runner as the head, so the two differ only by the code
under review.

## What you need

- A `.game-dev/adapter.json` in the project, already present in the **base**
  commit (add it in its own pull request first). `game-dev adapter sample` or
  the [probe SDK](../probe/README.md) gets you one.
- A scenario that runs on a hosted runner. GitHub's Linux runners have no GPU,
  so use the software lane: Mesa's llvmpipe or lavapipe, declared through the
  scenario's `environment` (`LIBGL_ALWAYS_SOFTWARE`, `VK_ICD_FILENAMES`). It is
  usually bit-deterministic, which makes the gate exact.
- Linux or macOS runners. Windows is not supported by this Action.

## Inputs

| input | default | meaning |
| --- | --- | --- |
| `scenario` | (required) | scenario id from the adapter |
| `project` | `.` | project path in the repository |
| `request` | | scenario parameters JSON, relative to the project |
| `build` | | shell command run in base and head before capturing |
| `base-ref` | PR base, else `HEAD^` | commit to compare against |
| `baseline-runs` | `2` | base captures; 2+ measures the noise floor |
| `threshold` | `0` | per-channel difference below which a pixel is unchanged |
| `fail-on` | `change` | `change` fails on regression; `never` only reports |
| `allow-gpu` | `false` | for self-hosted GPU runners only |
| `version` | the Action's release | CLI release to install |

Outputs: `verdict` (`identical`, `within-tolerance`, `changed`,
`incomparable`) and `report-dir` (holding `report.md`, `report.json` and the
heatmaps).

## What it does not claim

The gate compares pixels between two captures on one runner. It does not say
the head is wrong, only that it is different, and an intended change looks
exactly like a regression. Hosted-runner timings are not target-hardware
timings, so the performance section is informational and never fails the job.
