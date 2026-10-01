# OpenGL example

A windowless OpenGL engine that produces a sealed, GPU-attested capture: a
CGL context on macOS, a surfaceless EGL context on Linux, a framebuffer
object as the only render target, and `glReadPixels` for the readback.

```sh
./build.sh          # OpenGL.framework on macOS; -lGL -lEGL on Linux
./gdprobe-opengl    # outside the harness: renders once and exits 0
```

| claim | how it knows | provenance emitted |
| --- | --- | --- |
| the GPU ran | `GL_TIMESTAMP` query pair available after `glClientWaitSync`; else the fence alone | attestation `TIMESTAMP_RESOLVED`, else `FENCE_SIGNALLED` |
| per-pass GPU time | `glQueryCounter(GL_TIMESTAMP)` around the draw | `gpu_timestamp_query` |
| samples passed, overdraw | `GL_SAMPLES_PASSED`; with no depth test, samples per pixel is the overdraw | `pipeline_statistics_query` |
| frame time, program link time | CPU clock | `wall_clock` |
| draw calls, debug messages, GL errors | numbers the engine incremented | `engine_counter` |

What it is honest about, because the harness checks:

- The `GL_RENDERER` string decides the class. llvmpipe, softpipe, SwiftShader
  and Apple's software renderer are declared software and attest nothing.
- Apple's GL-over-Metal returns no `GL_TIMESTAMP` result in practice, so on
  macOS the example attests by fence, not by timestamp, and emits no per-pass
  GPU time. It says so rather than reporting zero.
- VRAM is a vendor extension on OpenGL (`GL_NVX_gpu_memory_info`,
  `GL_ATI_meminfo`) and nothing here claims it.
- `GL_KHR_debug` is enabled where the context offers it (Linux, GL 4.3+); its
  messages are counted into `diagnostic.opengl.debug_messages` and printed to
  stderr, which the harness seals into the run. macOS ships GL 4.1 and has no
  debug output; `glGetError` is still checked and reported.

The software lane on Linux is this same binary with `LIBGL_ALWAYS_SOFTWARE=1`
in the scenario's declared environment, which the harness allows precisely so
that the choice is sealed into `plan.json`.
