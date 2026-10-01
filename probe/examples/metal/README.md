# Metal example

A windowless Metal engine that produces a sealed, GPU-attested capture: two
triangles rendered offscreen into a colour target and an object-id target,
read back through a blit, and handed to the probe SDK.

```sh
clang -fobjc-arc -std=c99 -Wall -Wextra -Werror -x objective-c \
  -framework Metal -framework Foundation \
  ../../c/gdprobe.c main.m -o gdprobe-metal
```

Outside the harness it renders once and exits 0. Under `game-dev scenario run`
it writes the capture. A scenario for it declares `metal` and `gpu`, and the
run needs `--allow-gpu`; add `--allow-performance` to have its timings
admitted as hardware evidence.

What it is honest about, because the harness checks:

| claim | how it knows | provenance emitted |
| --- | --- | --- |
| the GPU ran | `MTLCommandBuffer.status == Completed` after `waitUntilCompleted` | attestation `COMMANDBUFFER_COMPLETED` |
| per-pass GPU time | counter sample buffer at stage boundaries, when supported | `gpu_timestamp_query` |
| command buffer GPU time | `GPUStartTime` / `GPUEndTime` | `driver_report` |
| frame time | CPU clock around commit-to-completion | `wall_clock` |
| draw calls | a number the engine incremented | `engine_counter` |

Metal offers stage-boundary counter sampling on every device but not
draw-boundary sampling on Apple silicon, so "per-pass GPU time" here means the
whole pass, not a draw inside it. Pipeline statistics do not exist on Metal and
nothing here claims them. See `docs/adapters.md` for the vocabulary.
