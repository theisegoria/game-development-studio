# CPU convex collision decomposition

`decompose_collision_mesh` turns a static embedded GLB into **separate convex parts**, each supplied as OBJ and GLB, with a versioned manifest and receipt. It preserves source geometry and applies the default scene's node transforms before decomposition. The operation does not use Blender, GPU execution, paid providers, engine adapters, or automatic dependency installation.

This is collision approximation, not artistic mesh retopology or engine acceptance testing. Keep the parts separate: convexifying their aggregate can fill holes that the decomposition preserves.

## Explicit isolated setup

The optional backend is [CoACD 1.0.14 on PyPI](https://pypi.org/project/coacd/1.0.14/), paired with [NumPy 2.0.2](https://pypi.org/project/numpy/2.0.2/). The supported interpreter range for these pins is **CPython 3.9–3.12**; CI uses 3.11. The reviewed upstream API reference is [CoACD source commit 1401ce2](https://github.com/SarahWeiii/CoACD/tree/1401ce2a7ae1ed89c65ab958b48d489350c233c7). That reference does not independently attest which source produced an upstream wheel.

Official wheel availability for the selected versions:

| Platform | Architecture | Backend |
| --- | --- | --- |
| Linux, glibc 2.17+ | x86-64, ARM64 | CoACD CPU |
| macOS 11+ | ARM64 | CoACD CPU, subject to platform resource controls |
| Windows | x86-64 | CoACD CPU |
| macOS Intel, Windows ARM64, musl Linux, other Python versions | — | Unsupported by this pinned setup; no source-build fallback |

Choose a tool directory outside user profiles. From a source checkout or installed package, replace the example absolute paths below with your chosen locations:

```sh
python3.11 -m venv /absolute/chosen-tools/coacd
/absolute/chosen-tools/coacd/bin/python -m pip install --disable-pip-version-check --only-binary=:all: --require-hashes -r /absolute/game-development-studio/distribution/coacd/requirements.txt
export GAME_DEV_COACD_PYTHON=/absolute/chosen-tools/coacd/bin/python
```

On Windows, use the environment's `Scripts\python.exe` and set `$env:GAME_DEV_COACD_PYTHON` to that absolute executable. Do not install into the system interpreter or a user-profile package directory. The wrapper refuses a non-venv interpreter, version drift, or an unsupported platform. The CLI never discovers Python on PATH or installs/updates it on your behalf.

The checked-in requirements pin every accepted official wheel by SHA-256; `WHEELS.json` records URLs, sizes, and digests. `--only-binary=:all:` prevents heavy source builds. CoACD wheels are roughly 1.5–3.4 MB; NumPy is additional. These optional binaries are not bundled in the Studio release.

## Diagnose and run

```sh
game-dev tool call diagnose_collision_decomposition --json
game-dev tool call decompose_collision_mesh --input '{"modelPath":"/absolute/asset.glb","threshold":0.03,"maxParts":12,"maxVerticesPerPart":64,"seed":12345,"maxApproximationError":0.04}' --output-dir /absolute/workspace --json
```

Use the existing transport's fresh local-mutation approval when prompted. Setting the Python path authorizes no operation by itself. The diagnostic starts only a bounded Python metadata/hash reader; it does not load CoACD's native library or perform decomposition. A missing dependency is reported as unavailable, while other Studio tools remain usable.

Outputs live under `.production/collision/`:

- `part-NNN.obj` and `part-NNN.glb`: one closed convex part per file.
- `manifest.json`, schema `game_dev.collision_decomposition.v1`: source/interchange hashes, exact tool versions and installed CoACD code hash, options/seed, bounds, part hashes, validation results, and limitations.
- `receipt.json`, schema `game_dev.collision_receipt.v1`: accepted outputs, process intent, enforced resource controls, and a bounded diagnostic tail.
- `source.mesh.json` and `native-result.json`: bounded intermediate evidence; not interchangeable with the accepted part files.

The result's `outputPath` names the manifest, not a merged mesh. A failed or rejected native result leaves no accepted result directory. Original input bytes remain unchanged.

## Validation and budgets

Inputs must have finite coordinates within one million source units, nondegenerate triangles, and closed, consistently oriented edge-manifold topology. Skins, animations, morphs, non-triangle primitives, glTF extensions, external resources, ambiguous scenes, and open surfaces are refused. This validator does not claim a complete self-intersection proof; CoACD uses its bounded automatic preprocessing mode.

Default limits are 64 MiB source GLB, 20,000 source triangles, 16 parts, 64 vertices per part, 2 GiB worker memory, 120 seconds aggregate CPU time, 180 seconds wall time, and 256 approximation samples. Configurable limits have hard maxima: 32 parts, 256 vertices/part, 4 GiB memory, 600 seconds CPU/wall time, and 512 samples. Independent geometry validation also caps its triangle-probe workload. Worker stdout/stderr is bounded to 256 KiB. One worker runs per process and one per collision output directory; the process-shared lock is never expired by elapsed time.

Linux uses hard address-space/CPU rlimits and one-core affinity. Windows uses hard Job Object memory/CPU limits and one-core affinity. macOS rejects address-space/data rlimits: it uses hard aggregate CPU-time and wall-time limits plus a **best-effort RSS watchdog sampled every 50 ms**. A memory spike can overshoot the requested budget between samples; the receipt explicitly records `memoryEnforcement: sampled-rss-watchdog`, the sampling interval, and `memoryOvershootPossible: true`. This is not a hard memory cap. Input/triangle/algorithm limits still apply before launch. A child-side wall deadline complements the parent's watchdog. OpenMP and common math-library thread settings are one; CoACD's macOS standard-thread fallback does not honor OpenMP settings, so a single-thread guarantee is not made. Resource controls must succeed before native code is imported.

Each returned part is checked for finite coordinates, indices, closed topology, nonzero volume, and all-vertices-against-all-face-planes convexity. The GLB's float32 geometry is validated again. Deterministic area-weighted surface samples and interior probes measure deviation between the source solid and the union of the published hulls. Samples inside source solids do not penalize legitimate internal cut faces. A returned single convex envelope that fills the synthetic U opening fails this check.

`maxApproximationError` is measured relative to the source bounds diagonal. It is separate from CoACD's own `threshold`. These are **sampled checks, not an exact Hausdorff bound, collision-safety certificate, or engine import proof**. A fixed seed is recorded for reproducibility; no cross-platform byte-identity promise is made.

## Tests and licenses

Default tests use synthetic GLBs and a mocked backend; they never import native CoACD. `GAME_DEV_TEST_COACD=1` explicitly enables `tests/coacd-native.test.ts`, which requires the real configured environment and fails rather than skipping missing dependencies. The dedicated reusable `CoACD CPU` GitHub workflow installs hash-pinned wheels into its temporary venv and checks that a real connected U fixture yields multiple convex parts, preserves opening probes, covers solid probes, and satisfies budgets. Release validation must require those results before claiming platform coverage.

CoACD's top-level source license is MIT. NumPy's top-level license is BSD-3-Clause; wheel distributions can include additional bundled-library notices. Relevant upstream license metadata is under `distribution/coacd/legal/`. Installed wheels retain their own notices. Studio distributes setup metadata and its own bridge, not these optional native binaries, and does not claim that every platform wheel's complete binary license closure has been independently audited.
