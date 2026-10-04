# Advanced: compile the C probe example

Complete the [compiler-free first capture](quickstart.md) first. This tutorial
adds engine instrumentation and requires a C compiler on macOS/Linux. It uses
the installed package's exact C sources; Windows compiler integration is a
separate engine build task, not a prerequisite for the free workflow.

## Compile without changing the example's include path

The packaged example includes `../../c/gdprobe.h`. Compile it **in its original
package layout** rather than copying just `main.c`, which breaks that include.
Use a new writable project directory; the output binary belongs to that project.

```sh
set -eu
package_root="$(npm root --global --prefix "$cli_prefix")/@theisegoria/game-development-studio"
project="$(pwd)/probe capture project"
mkdir "$project"
cc -std=c99 -Wall -Wextra -Werror \
  "$package_root/probe/c/gdprobe.c" \
  "$package_root/probe/examples/minimal/main.c" \
  -o "$project/engine"
"$project/engine"
```

Use the prefix chosen in [installation](install.md). Outside the harness the
example prints `not attached to the harness; rendering normally` and exits 0.
For integration into your own build, `game-dev probe install --project PATH`
first plans copying the SDK; review before adding `--confirm`. The installer
refuses to overwrite a changed copy.

## Describe the compiled engine

Create `$project/.game-dev/adapter.json` (create `.game-dev` first) with:

```json
{
  "schema": "game_dev.adapter.v1",
  "id": "first-c-probe",
  "name": "First C probe capture",
  "version": "1.0.0",
  "scenarios": [{
    "id": "capture",
    "title": "CPU probe capture",
    "command": {"executable": "engine", "arguments": ["{param.brightness}"], "workingDirectory": "."},
    "timeoutSeconds": 30,
    "capabilities": ["software-raster", "project-write"],
    "parameters": {"brightness": {"type": "integer", "required": false, "default": 0, "minimum": 0, "maximum": 50}},
    "outputs": {"format": "game-dev-capture-v1", "path": "capture.json"}
  }]
}
```

```sh
game-dev adapter inspect --project "$project" --json
game-dev scenario plan capture --project "$project" --json
# Review the resolved executable, arguments, output and required authority.
game-dev scenario run capture --project "$project" --confirm --json
```

Use returned run paths with `capture verify`, `visual analyze` and `visual
compare` as in the free quickstart. Request `{"brightness":40}` in a UTF-8 JSON
file for a known change; do not depend on shell process substitution. This
example writes object IDs and synthetic frame measurements. Performance
summaries describe fixture values and do not prove target-hardware speed.

## Integrate an actual renderer

Replace the example's CPU `render` with your renderer's readback. Declare the
actual backend and the synchronization you observed, for example:

```c
gdprobe_declare_backend(run, GDPROBE_BACKEND_VULKAN, "device", "driver",
                       GDPROBE_RENDERER_HARDWARE);
gdprobe_attest_gpu(run, GDPROBE_GPU_FENCE_SIGNALLED, "vkWaitForFences");
```

GPU scenarios require explicit GPU authority, and timing scenarios require
their own performance authority. Review those plans before authorizing them.
This tutorial and its CPU verifier do not authorize or perform a GPU run.
See the installed `probe/README.md` for backend examples, attachment formats and
evidence limits. A capture preview cannot establish artistic approval or correct
behavior in a target engine.
