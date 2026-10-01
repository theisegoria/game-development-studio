# wgpu example

A windowless wgpu engine, in Rust, that produces a sealed, GPU-attested
capture. The C probe SDK is compiled into it by cargo through a small FFI
binding (`src/gdprobe.rs`); native code lives in the engine's build, never in
the npm package.

```sh
cargo run --release -- 0     # outside the harness: renders once and exits 0
```

| claim | how it knows | provenance emitted |
| --- | --- | --- |
| the GPU ran | the pass's timestamp writes resolved and mapped back; else the readback map completed after submit | attestation `TIMESTAMP_RESOLVED`, else `FENCE_SIGNALLED` |
| per-pass GPU time | `Features::TIMESTAMP_QUERY` with `timestamp_writes` on the pass, scaled by `get_timestamp_period` | `gpu_timestamp_query` |
| fragment invocations, clipped primitives, overdraw | `Features::PIPELINE_STATISTICS_QUERY`, Vulkan and DX12 backends only | `pipeline_statistics_query` |
| frame time, pipeline creation time | CPU clock | `wall_clock` |
| draw calls | a number the engine incremented | `engine_counter` |

What it is honest about, because the harness checks:

- `DeviceType::Cpu` (lavapipe or SwiftShader through wgpu) is declared a
  software renderer and attests nothing.
- Pipeline statistics are requested only when the adapter offers the feature;
  on Metal and GL backends nothing is claimed about overdraw.
- wgpu exposes no stable VRAM accounting and nothing here claims it.
- Readback rows are padded to 256 bytes. The SDK takes a row stride for
  exactly this reason; the example hands it the padded width, never
  `width * 4`, which would walk into the padding and record it as pixels.

This example is compiled in CI on Linux and run against lavapipe, which is
the software lane. It is not compiled by the harness's own test suite, because
that suite must run anywhere a C compiler does and a Rust toolchain is a
larger ask.
