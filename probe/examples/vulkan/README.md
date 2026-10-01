# Vulkan example

A windowless Vulkan engine that produces a sealed, GPU-attested capture. This
is the best-instrumented lane, and the example uses what it offers.

```sh
./build.sh          # glslc for the shaders, cc for the rest; needs a Vulkan loader
./gdprobe-vulkan    # outside the harness: renders once and exits 0
```

The two `.spv` files are loaded from the executable's own directory at
runtime, so a scenario command points at the built binary and nothing else.
A scenario for it declares `vulkan` and `gpu`; the run needs `--allow-gpu`,
and `--allow-performance` to have its timings admitted.

| claim | how it knows | provenance emitted |
| --- | --- | --- |
| the GPU ran | timestamp query pair available after `vkWaitForFences`; else the fence alone | attestation `TIMESTAMP_RESOLVED`, else `FENCE_SIGNALLED` |
| per-pass GPU time | `vkCmdWriteTimestamp` top-of-pipe to bottom-of-pipe, scaled by `timestampPeriod` | `gpu_timestamp_query` |
| fragment invocations, clipped primitives, overdraw | `VK_QUERY_TYPE_PIPELINE_STATISTICS`, when the device has the feature | `pipeline_statistics_query` |
| VRAM in use | `VK_EXT_memory_budget` heap usage over device-local heaps | `driver_report` |
| frame time, pipeline creation time | CPU clock | `wall_clock` |
| draw calls, validation message count | numbers the engine incremented | `engine_counter` |

What it is honest about, because the harness checks:

- A CPU device (lavapipe, SwiftShader) is declared a software renderer and
  makes no GPU attestation. The SDK would refuse one; the harness downgrades
  the run regardless of what either says.
- Pipeline statistics are emitted only when the device reports the feature.
  MoltenVK does not, so on macOS nothing is claimed about overdraw. On Linux
  with a real driver, `render.overdraw.fragments_per_pixel` is the genuinely
  hardware-measured figure the plan's capability matrix promises.
- The validation layer, when installed, is enabled and its warnings and
  errors are counted into `diagnostic.vulkan.validation_messages` and
  printed to stderr, which the harness seals into the run. For an AI writing
  an engine, that count going from 0 to 1 is often the finding.

The software lane on Linux is this same binary with lavapipe selected
through the scenario's declared environment (`VK_ICD_FILENAMES`), which the
harness allows precisely so that the choice is sealed into `plan.json`
rather than inherited from whichever shell launched the run.
