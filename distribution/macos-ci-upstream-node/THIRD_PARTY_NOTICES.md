# CI upstream Node runtime notices

This profile is for local CI validation bundles, not a published app release.
It does not replace the default Homebrew release profile.

The bundle includes `game-dev` CLI 1.1.0 (MIT), upstream Node.js 25.2.1 for
macOS ARM64, and the 98 lockfile-pinned production npm package paths below.
The upstream executable links only macOS system libraries: this profile declares
zero non-system dylibs. Node's statically included third-party components are
covered by its complete distributed LICENSE, not by the Homebrew dylib roster.

| Package install path | Locked version | Declared license |
| --- | --- | --- |
| `node_modules/@gltf-transform/core` | 4.4.2 | MIT |
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
