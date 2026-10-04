# Game Development Studio

Game Development Studio is a screenshot-free, skills-only plugin for local
game asset production, package vendoring, sealed render-capture diagnosis, and
bounded performance work.

The five packaged skills provide workflow guidance, approval boundaries, and
evidence discipline. They do not include an MCP server, hosted backend, UI,
provider credential, shared provider account, hook, or automatic installation
step. They never ask a user to paste or configure a provider key in a plugin
conversation.

## Install the CLI separately

The CLI source is public at
[game-development-studio](https://github.com/theisegoria/game-development-studio).
The [CLI 1.4.0 GitHub release](https://github.com/theisegoria/game-development-studio/releases/tag/v1.4.0)
provides a compiled Node.js package (`.tgz`) and SHA-256 manifest. It requires
Node.js 22.5+ and is not a standalone Windows installer. The public npm registry
package remains unpublished. This plugin's ZIP installs skills only.

Follow the [canonical install guide](https://github.com/theisegoria/game-development-studio/blob/v1.4.0/docs/install.md)
and [first capture](https://github.com/theisegoria/game-development-studio/blob/v1.4.0/docs/quickstart.md).
The [Windows installation and PATH guide](https://github.com/theisegoria/game-development-studio/blob/v1.4.0/docs/windows-install.md)
covers release-tarball verification, PowerShell commands, and source-build fallback.
The manifest verifies the downloaded package bytes; no Windows code-signing
certificate or EXE/MSI is supplied. Installing the plugin alone cannot add the
CLI to PATH.

## Local execution boundary

The plugin can route work and analyze user-supplied manifests, telemetry,
metrics, capture summaries, and structured results. Executing local workflows
requires the separately installed `game-dev` 1.0.2-or-newer CLI in an
environment that exposes the chosen files and executable under the user's
approval policy.

Provider spend, every local file write, project execution, GPU work, and
performance measurement remain separately authorized for each invocation. A
plan never becomes standing permission. Commands that lack a `--confirm` flag
still require explicit conversation-level authorization for their resolved
inputs and destinations.

Optional provider work uses only a preconfigured credential and provider
account controlled by the user. The local CLI sends an authorized request
directly to the selected independent provider; the publisher does not proxy,
pool, receive, share, or resell provider credentials or access.

## Included skills

| Skill | Purpose |
| --- | --- |
| `game-development-studio` | Routes work and enforces the shared operating contract |
| `game-asset-production` | Provider jobs, GLB inspection, Blender preparation, and packages |
| `game-asset-vendoring` | Integrity, licenses, migration, catalogues, and project admission |
| `game-visual-debugging` | Adapters, captures, telemetry, semantic buffers, and heatmaps |
| `game-performance-optimization` | Comparable metrics and finite optimization goals |

## Evidence boundary

- static inspection is not Blender, GPU, or pixel evidence
- a decoded raster is not a human visual judgement
- adapter-reported GPU identity is not independent hardware proof
- arithmetic improvement is not causality or broad performance proof

See [Privacy](PRIVACY.md), [Terms](TERMS.md), [Support](SUPPORT.md), and
[Security](SECURITY.md).
