# Vendoring commands

## Catalog and integrity

```text
game-dev catalog list --query TEXT --category CATEGORY --json
game-dev catalog show PACKAGE_ID --json
game-dev package show PACKAGE_ID_OR_PATH --json
game-dev package verify PACKAGE_ID_OR_PATH --json
```

Treat `package verify` as the required integrity gate immediately before project admission.

## Project admission

```text
game-dev vendor admit PACKAGE_ID_OR_PATH --project PROJECT --destination RELATIVE --json
game-dev vendor admit PACKAGE_ID_OR_PATH --project PROJECT --destination RELATIVE --confirm --jsonl
```

The first form is the default no-write plan. Use `--allow-unknown-license` or `--allow-invalid` only after the user accepts that exact blocker; these flags do not waive any other condition.

## Migration and derived catalog repair

```text
game-dev migrate legacy --from LEGACY_OUTPUT_ROOT --license SPDX --json
game-dev migrate legacy --from LEGACY_OUTPUT_ROOT --license SPDX --confirm --jsonl
game-dev catalog rebuild --json
game-dev catalog rebuild --confirm --jsonl
```

Migration and rebuild are dry-run or approval-gated operations. A catalog is derived state; packages and their receipts are authoritative.

## Local preview launch

```text
game-dev launch PACKAGE_ID_OR_PATH --with finder --json
game-dev launch PACKAGE_ID_OR_PATH --with quicklook --json
game-dev launch PACKAGE_ID_OR_PATH --with blender --json
```

Without `--confirm`, launch returns a plan. Add `--confirm` only when the user asked to open the selected application.

## Over MCP

| CLI | MCP tool |
| --- | --- |
| `game-dev catalog list` | `list_catalog_assets` |
| `game-dev catalog show` | `show_catalog_asset` |
| `game-dev package verify` | `verify_asset_package` |
| `game-dev vendor admit` (dry run) | `plan_vendor_admission` |
| `game-dev vendor admit --confirm` | `vendor_package_into_project` |
| `game-dev probe install` | `plan_probe_install`, then `install_probe_sdk` |

Admitting a package and installing the probe SDK write into the project, so
they need `GAME_DEV_MCP_ALLOW_PROJECT_WRITE=1` plus a confirmation each time.
An unknown license blocks admission and is returned as an error. The catalog is
also readable as `game-dev://catalog`, and a package as
`game-dev://packages/{packageId}`.
