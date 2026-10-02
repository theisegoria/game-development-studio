# CPU texture compression

`compress_texture_variant` creates a standalone embedded GLB with real ETC1S or UASTC KTX2 textures and required `KHR_texture_basisu`. It preserves the original file. This is optional local CPU processing; it does not call providers, launch Blender, use OpenCL, or test an engine import.

## Dependency and diagnostics

The supported encoder is official [Basis Universal](https://github.com/BinomialLLC/basis_universal) 2.50, source commit `9bebe16726b3a61c8c213eeee3b7cffb462ef34e`. No executable is bundled or downloaded during installation. The explicit build helper requires Git, CMake and a C++ compiler. Run it only where native CPU compilation and execution are intended:

```sh
node scripts/build-basis-cpu.mjs /absolute/new/basis-build-directory
```

The helper disables OpenCL, examples and SSE specialization, builds with parallelism two, and records the executable SHA-256 and platform in `basis-cpu.json`. Configure `GAME_DEV_BASISU_PATH` and `GAME_DEV_BASISU_SHA256` from that manifest. These variables refer to a trusted executable selected by the user; the hash protects its identity, not its provenance. A separately supplied binary's version and hash cannot prove which source built it.

`diagnose_texture_compression` checks the configured file and hash without starting a process. Compression and compressed-package admission probe its version, recheck the hash, and launch bounded CPU subprocesses. Missing or changed dependencies fail closed with an actionable error. Packaging ordinary PNG/JPEG assets needs no encoder.

The reusable `.github/workflows/basis.yml` builds and tests Linux, macOS and Windows on hosted runners. Real support evidence is the successful exact-commit matrix, not a mocked test result. Builds remain runner-local; the workflow uploads no large binaries. To repeat the opted-in synthetic test after an explicit build:

```sh
node scripts/verify-texture-compression.mjs /absolute/new/basis-build-directory/basis-cpu.json
```

## Use through CLI or MCP

After setting the two environment variables, invoke the registered operation through the ordinary CLI mutation approval flow or MCP confirmation. Example CLI:

```sh
game-dev tool call diagnose_texture_compression --input '{}' --json
game-dev tool call compress_texture_variant --confirm --json --input '{"modelPath":"/absolute/source.glb","colorCodec":"etc1s","quality":128,"timeoutSeconds":120}'
```

Use the returned `outputPath` with `inspect_asset`, validation and `build_asset_package` through their normal tool interface. `plan_platform_preparation` with texture mode `compress` produces the resize/normalize/compress/validate/package graph; every mutation still requires fresh transport approval. Compression identity participates in recipe checkpoint invalidation.

Inputs must be embedded GLB with 1–64 unambiguously used 8-bit PNG/JPEG textures, dimensions divisible by four, at most 16 million pixels per texture and 32 million total. An explicit resize variant can prepare unsuitable dimensions. Unsupported extensions, ambiguous color/data use and already-compressed maps are refused. The model and each encoded output are bounded to 128 MiB.

Base color and emissive use sRGB ETC1S by default, with UASTC selectable. Data maps use linear UASTC. Normal maps use linear UASTC, normal renormalization and renormalized mipmaps. Every output includes a complete mip chain. Linear data metadata uses unspecified color primaries as required by the glTF profile. The subprocess uses one encoding thread, bounded logs and a 1–300 second total operation budget. No OpenCL flag is used.

Inspection validates bounded KTX2 structure and dimensions without decoding texture pixels. Compression then CPU-transcodes every mip to BC7 and requires individual success evidence. Package admission repeats CPU transcoding on the actual staged GLB; a receipt or plausible header cannot replace this check. The package validation document records compressed payload hashes and encoder identity. This proves decodability, not visual quality; inspect the result and approve it separately. No cross-platform byte-identical encoding or target GPU quality is promised.

## Licenses and distribution

Basis Universal's main code is Apache-2.0, with additional third-party licenses recorded in its pinned source. The build helper preserves upstream `LICENSE`, `NOTICE`, `LICENSES` and `.reuse` metadata in the build's `notices` directory. Keep those notices and inspect their file attribution before redistributing a separately built encoder. This project distributes the build instructions only, not Basis binaries or source. The optional encoder is separate from the packaged native CLI runtime.

The JavaScript extension integration is pinned to `@gltf-transform/extensions` 4.4.2 (MIT), alongside the existing glTF Transform core. Its transitive `ktx-parse` dependency is covered by the generated npm third-party notices. No signing credentials or paid service is required.
