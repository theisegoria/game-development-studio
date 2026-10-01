# CI upstream Node runtime notices

This profile is for local CI validation bundles, not a published app release.
It does not replace the default Homebrew release profile.

The bundle includes `game-dev` CLI 1.0.2 (MIT), upstream Node.js 25.2.1 for
macOS ARM64, and the five lockfile-pinned production npm packages below.
The upstream executable links only macOS system libraries: this profile declares
zero non-system dylibs. Node's statically included third-party components are
covered by its complete distributed LICENSE, not by the Homebrew dylib roster.

| Package | Locked version | License |
| --- | --- | --- |
| @gltf-transform/core | 4.4.2 | MIT |
| property-graph | 4.1.0 | MIT |
| jpeg-js | 0.4.4 | BSD-3-Clause |
| pngjs | 7.0.0 | MIT |
| zod | 3.25.76 | MIT |

`THIRD_PARTY_PROVENANCE.json` pins the official archive URL/checksum, original
executable checksum, exact external-library closure, and each full license's
SHA-256 and byte length. Full licenses are copied into `ThirdPartyLicenses/`
in the bundle. Both source executable and license bytes are verified before
staging; the staged runtime then undergoes the same exact-roster and provenance
verification as the Homebrew profile. The runtime builder re-signs its staged
copy, so its final byte identity is recorded separately in runtime-roster.json.

This local bundle uses an ad-hoc signature, not Developer ID signing or
notarization. The release packager retains its separate Homebrew provenance
contract and must reject this CI profile as a production release input.
