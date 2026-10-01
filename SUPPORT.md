# Support

Use
[GitHub Issues](https://github.com/theisegoria/game-development-studio-skills/issues)
for installation questions, reproducible defects, feature requests, and
documentation problems.

If `game-dev` is not recognized, see the
[Windows source-build and PATH guide](https://github.com/theisegoria/game-development-studio/blob/d92bb63da83fa068f869756fc0721eea6471a4d6/docs/windows-install.md).
The skills plugin does not contain the CLI. For installation failures, report
which setup step failed and the Node/npm versions instead of requiring a doctor
report from a command that is not installed.

Before filing (when the CLI is installed):

1. run `game-dev --version`
2. run `game-dev doctor --json`
3. remove credentials, signed URLs, private paths, private source, and paid
   provider assets from the report
4. include the command shape, structured error code, operating system, Node
   version, and whether Blender was involved

Use private vulnerability reporting for security issues. Provider billing,
account, policy, or service availability questions belong with the provider.
