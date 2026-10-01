import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));
const verifier = path.join(root, 'distribution/skills-repo/scripts/verify.py');
const program = `
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location('skills_verify', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.verify_workflow_pins(pathlib.Path(sys.argv[2]))
`;

function check(directory: string): void {
  execFileSync('python3', ['-B', '-c', program, verifier, directory], { stdio: 'pipe' });
}

function fixture(contents: string, assertion: (directory: string) => void): void {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'workflow-pins-'));
  try {
    writeFileSync(path.join(directory, 'check.yaml'), contents);
    assertion(directory);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('workflow supply-chain pins', () => {
  it('checks every root workflow and the canonical skills workflow template', () => {
    check(path.join(root, '.github/workflows'));
    check(path.join(root, 'distribution/skills-repo/.github/workflows'));
  });

  it('accepts full commit pins, quoted refs, and local reusable workflows', () => {
    fixture(`jobs:
  local:
    uses: ./.github/workflows/ci.yml
  check:
    steps:
      - uses: "actions/checkout@${'a'.repeat(40)}" # version label
`, (directory) => expect(() => check(directory)).not.toThrow());
  });

  it.each(['actions/checkout@v4', 'dtolnay/rust-toolchain@stable', 'owner/repo@abc123', 'owner/repo'])('rejects a mutable or incomplete ref: %s', (reference) => {
    fixture(`jobs:\n  check:\n    uses: ${reference}\n`, (directory) => {
      expect(() => check(directory)).toThrow();
    });
  });
});
