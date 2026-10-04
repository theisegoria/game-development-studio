# Third-party notices and bundled-runtime boundary

Game Development Studio 1.0.0 is distributed under the MIT License in
[LICENSE](LICENSE). This notice, its provenance record, and the complete
license corpus are deliberately carried in both of these locations:

- the public release repository; and
- `GameDevelopmentStudio.app/Contents/Resources` in the signed application.

The release packager rejects a release unless the two copies are byte-for-byte
identical. The canonical paths are `THIRD_PARTY_NOTICES.md`,
`THIRD_PARTY_PROVENANCE.json`, and `ThirdPartyLicenses/`.

## What version 1.0.0 includes

The app is a native macOS application built with Apple's Swift and SwiftUI
toolchain and links Apple system frameworks supplied by macOS. It also carries
a closed local runtime. That runtime includes:

- `game-dev` CLI 1.4.0, licensed under MIT;
- Node.js 25.2.1, including Node's complete distributed `LICENSE` notice;
- the 100 lockfile-pinned production npm package paths below; and
- the 18 non-system dynamic libraries below.

The npm production closure is pinned by the shipped CLI's `package-lock.json`,
not by the broader semver ranges in `package.json`:

| Package install path | Locked version | Declared license |
| --- | --- | --- |
| `node_modules/@gltf-transform/core` | 4.4.2 | MIT |
| `node_modules/@gltf-transform/extensions` | 4.4.2 | MIT |
| `node_modules/@hono/node-server` | 2.1.1 | MIT |
| `node_modules/@modelcontextprotocol/sdk` | 1.30.0 | MIT |
| `node_modules/accepts` | 2.0.0 | MIT |
| `node_modules/ajv` | 8.20.0 | MIT |
| `node_modules/ajv-formats` | 3.0.1 | MIT |
| `node_modules/body-parser` | 2.3.0 | MIT |
| `node_modules/body-parser/node_modules/content-type` | 2.1.0 | MIT |
| `node_modules/bytes` | 3.1.2 | MIT |
| `node_modules/call-bind-apply-helpers` | 1.0.2 | MIT |
| `node_modules/call-bound` | 1.0.4 | MIT |
| `node_modules/content-disposition` | 1.1.0 | MIT |
| `node_modules/content-type` | 1.0.5 | MIT |
| `node_modules/cookie` | 0.7.2 | MIT |
| `node_modules/cookie-signature` | 1.2.2 | MIT |
| `node_modules/cors` | 2.8.6 | MIT |
| `node_modules/cross-spawn` | 7.0.6 | MIT |
| `node_modules/debug` | 4.4.3 | MIT |
| `node_modules/depd` | 2.0.0 | MIT |
| `node_modules/dunder-proto` | 1.0.1 | MIT |
| `node_modules/ee-first` | 1.1.1 | MIT |
| `node_modules/encodeurl` | 2.0.0 | MIT |
| `node_modules/es-define-property` | 1.0.1 | MIT |
| `node_modules/es-errors` | 1.3.0 | MIT |
| `node_modules/es-object-atoms` | 1.1.2 | MIT |
| `node_modules/escape-html` | 1.0.3 | MIT |
| `node_modules/etag` | 1.8.1 | MIT |
| `node_modules/eventsource` | 3.0.7 | MIT |
| `node_modules/eventsource-parser` | 3.1.1 | MIT |
| `node_modules/express` | 5.2.1 | MIT |
| `node_modules/express-rate-limit` | 8.7.0 | MIT |
| `node_modules/fast-deep-equal` | 3.1.3 | MIT |
| `node_modules/fast-uri` | 3.1.8 | BSD-3-Clause |
| `node_modules/finalhandler` | 2.1.1 | MIT |
| `node_modules/forwarded` | 0.2.0 | MIT |
| `node_modules/fresh` | 2.0.0 | MIT |
| `node_modules/function-bind` | 1.1.2 | MIT |
| `node_modules/get-intrinsic` | 1.3.0 | MIT |
| `node_modules/get-proto` | 1.0.1 | MIT |
| `node_modules/gopd` | 1.2.0 | MIT |
| `node_modules/has-symbols` | 1.1.0 | MIT |
| `node_modules/hasown` | 2.0.4 | MIT |
| `node_modules/hono` | 4.13.12 | MIT |
| `node_modules/http-errors` | 2.0.1 | MIT |
| `node_modules/iconv-lite` | 0.7.3 | MIT |
| `node_modules/inherits` | 2.0.4 | ISC |
| `node_modules/ip-address` | 10.7.3 | MIT |
| `node_modules/ipaddr.js` | 1.9.1 | MIT |
| `node_modules/is-promise` | 4.0.0 | MIT |
| `node_modules/isexe` | 2.0.0 | ISC |
| `node_modules/jose` | 6.2.10 | MIT |
| `node_modules/jpeg-js` | 0.4.4 | BSD-3-Clause |
| `node_modules/json-schema-traverse` | 1.0.0 | MIT |
| `node_modules/json-schema-typed` | 8.0.2 | BSD-2-Clause |
| `node_modules/ktx-parse` | 1.1.0 | MIT |
| `node_modules/math-intrinsics` | 1.1.0 | MIT |
| `node_modules/media-typer` | 1.1.1 | MIT |
| `node_modules/merge-descriptors` | 2.0.0 | MIT |
| `node_modules/mime-db` | 1.54.0 | MIT |
| `node_modules/mime-types` | 3.0.2 | MIT |
| `node_modules/ms` | 2.1.3 | MIT |
| `node_modules/negotiator` | 1.1.0 | MIT |
| `node_modules/negotiator/node_modules/content-type` | 2.1.0 | MIT |
| `node_modules/object-assign` | 4.1.1 | MIT |
| `node_modules/object-inspect` | 1.13.4 | MIT |
| `node_modules/on-finished` | 2.4.1 | MIT |
| `node_modules/once` | 1.4.0 | ISC |
| `node_modules/parseurl` | 1.3.3 | MIT |
| `node_modules/path-key` | 3.1.1 | MIT |
| `node_modules/path-to-regexp` | 8.4.2 | MIT |
| `node_modules/pkce-challenge` | 5.0.1 | MIT |
| `node_modules/pngjs` | 7.0.0 | MIT |
| `node_modules/property-graph` | 4.1.0 | MIT |
| `node_modules/proxy-addr` | 2.0.7 | MIT |
| `node_modules/qs` | 6.16.0 | BSD-3-Clause |
| `node_modules/range-parser` | 1.3.0 | MIT |
| `node_modules/raw-body` | 3.0.2 | MIT |
| `node_modules/require-from-string` | 2.0.2 | MIT |
| `node_modules/router` | 2.2.0 | MIT |
| `node_modules/safer-buffer` | 2.1.2 | MIT |
| `node_modules/send` | 1.2.1 | MIT |
| `node_modules/serve-static` | 2.2.1 | MIT |
| `node_modules/setprototypeof` | 1.2.0 | ISC |
| `node_modules/shebang-command` | 2.0.0 | MIT |
| `node_modules/shebang-regex` | 3.0.0 | MIT |
| `node_modules/side-channel` | 1.1.1 | MIT |
| `node_modules/side-channel-list` | 1.0.1 | MIT |
| `node_modules/side-channel-map` | 1.0.1 | MIT |
| `node_modules/side-channel-weakmap` | 1.0.2 | MIT |
| `node_modules/statuses` | 2.0.2 | MIT |
| `node_modules/toidentifier` | 1.0.1 | MIT |
| `node_modules/type-is` | 2.1.0 | MIT |
| `node_modules/type-is/node_modules/content-type` | 2.1.0 | MIT |
| `node_modules/unpipe` | 1.0.0 | MIT |
| `node_modules/vary` | 1.1.2 | MIT |
| `node_modules/which` | 2.0.2 | ISC |
| `node_modules/wrappy` | 1.0.2 | ISC |
| `node_modules/zod` | 3.25.76 | MIT |
| `node_modules/zod-to-json-schema` | 3.25.2 | ISC |

The closed runtime's non-system Mach-O library closure consists of:

```text
libbrotlicommon.1.2.0.dylib
libbrotlidec.1.2.0.dylib
libbrotlienc.1.2.0.dylib
libcares.2.19.5.dylib
libcrypto.3.dylib
libicudata.78.3.dylib
libicui18n.78.3.dylib
libicuuc.78.3.dylib
libnghttp2.14.dylib
libnghttp3.9.5.1.dylib
libngtcp2.16.dylib
libnode.141.dylib
libsimdjson.29.0.0.dylib
libsqlite3.3.53.4.dylib
libssl.3.dylib
libuv.1.0.0.dylib
libuvwasi.dylib
libzstd.1.5.7.dylib
```

`THIRD_PARTY_PROVENANCE.json` records the formula/source version, precise
license file, lockfile integrity value where applicable, and SHA-256/byte count
of every notice asset. It also records why a dylib install-name suffix is not
itself evidence of a source-package patch version: for example,
`libuv.1.0.0.dylib` was audited from libuv 1.51.0 and
`libcares.2.19.5.dylib` from c-ares 1.34.6. The staged runtime's
`runtime-roster.json` remains the authoritative artifact-specific byte roster.

## Complete license texts

Every full text and required supplementary notice is in
[`ThirdPartyLicenses/`](ThirdPartyLicenses/), with the filename, SHA-256, byte
count, source, and scope recorded in `THIRD_PARTY_PROVENANCE.json`. In
particular:

- `node-25.2.1-LICENSE.txt` is the full distributed Node.js notice, including
  its embedded third-party notices.
- `libuv-1.51.0-BSD-2-Clause-tree.h.txt` is the exact Niels Provos BSD-2
  header from libuv's `include/uv/tree.h`, and
  `libuv-1.51.0-ISC-inet.c.txt` is the exact Internet Software Consortium
  notice from libuv's `src/inet.c`. `LICENSE-extra` indexes these external
  terms but does not reproduce their full text, so all three files are
  included.
- `sqlite-3.53.4-public-domain.txt` preserves SQLite's public-domain
  declaration and blessing.

## Zstandard scope qualification

The staged `libzstd.1.5.7.dylib` is disclosed under the BSD alternative in
Zstandard 1.5.7's root `LICENSE`; the accompanying GPL-2.0 text is retained to
document the upstream dual-license alternative, not to assert that the release
selects the GPL alternative.

Homebrew's source-archive SBOM conclusion for zstd 1.5.7_1 also names
BSD-2-Clause and MIT ancillary terms. Its archive-level record has
`filesAnalyzed=false`, so it is not file-level evidence and does **not** prove
that those ancillary components are present in the staged `libzstd.1.5.7.dylib`.
The complete BSD-2 and MIT texts are nevertheless included as conservative
source-archive ancillary notices. Their scope and this evidence ceiling are
explicit in `THIRD_PARTY_PROVENANCE.json`; neither text should be read as an
object-level composition claim about the shipped dylib.

## Not included in the app bundle

The application does not carry Blender, a game engine, Tripo, Leonardo, a
provider SDK, provider service, or their credentials. Apple system frameworks
and system libraries supplied by macOS are not copied as part of the closed
runtime. Names of optional compatible tools and services do not imply
affiliation or endorsement.

Generated or user-supplied assets are not relicensed by this notice. Users are
responsible for the rights, provider terms, source provenance, and target
project requirements for every asset they produce or vendor.

## Evidence boundary

The notice/provenance pair establishes the audited release composition and the
packager's byte-identity checks. It does not independently prove a future
release's runtime execution, code signature trust, notarization, provider
availability, target-game import, GPU execution, visual approval, or
performance result. Verify a particular ZIP with its release metadata,
checksum, signature inspection, and runtime roster.
