# Support

Use
[GitHub Issues](https://github.com/theisegoria/game-development-studio-skills/issues)
for installation questions, reproducible defects, feature requests, and
documentation problems.

For verified release installation, see the
[canonical install guide](https://github.com/theisegoria/game-development-studio/blob/main/docs/install.md).
If `game-dev` is not recognized, see the
[Windows installation and PATH guide](https://github.com/theisegoria/game-development-studio/blob/main/docs/windows-install.md).
The skills plugin does not contain the CLI. For installation failures, report
which setup step failed and the Node/npm versions instead of requiring a doctor
report from a command that is not installed.

Before filing (when the CLI is installed):

1. run `game-dev --version`
2. on CLI 1.4.0+, preview `game-dev support report --workflow generic-capture --json`
3. review the redacted report before choosing to share it; remove credentials,
   signed URLs, private paths, private source and paid provider assets from any
   additional logs. Older CLI versions can run `doctor --json`, but its raw output
   must be reviewed and redacted before sharing
4. include the command shape, structured error code, operating system, Node
   version, and whether Blender was involved

Use private vulnerability reporting for security issues. Provider billing,
account, policy, or service availability questions belong with the provider.
