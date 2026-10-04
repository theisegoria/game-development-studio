import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { coacdEnvironmentIdentitySHA256 } from '../src/collision/identity.js';

const roots: string[] = [];

async function scratch(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'coacd-identity-'));
  roots.push(root);
  return root;
}

async function makeVenv(root: string, layout: 'posix' | 'windows' = 'posix') {
  const executable = layout === 'posix'
    ? path.join(root, 'bin', 'python')
    : path.join(root, 'Scripts', 'python.exe');
  const packages = layout === 'posix'
    ? path.join(root, 'lib', 'python3.11', 'site-packages')
    : path.join(root, 'Lib', 'site-packages');
  await fs.mkdir(path.dirname(executable), { recursive: true });
  await fs.mkdir(packages, { recursive: true });
  await fs.writeFile(executable, 'test-only fake interpreter bytes');
  await fs.chmod(executable, 0o700);
  await fs.writeFile(path.join(root, 'pyvenv.cfg'), 'home = /base/python\ninclude-system-site-packages = false\nversion = 3.11.12\n');
  return { executable, packages };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

describe('bounded static CoACD venv identity', () => {
  it('is deterministic and changes for same-path native wheel and metadata byte drift', async () => {
    const root = await scratch();
    const { executable, packages } = await makeVenv(root);
    const native = path.join(packages, 'coacd', '_coacd.abi3.so');
    const metadata = path.join(packages, 'coacd-1.0.14.dist-info', 'METADATA');
    await fs.mkdir(path.dirname(native), { recursive: true });
    await fs.mkdir(path.dirname(metadata), { recursive: true });
    await fs.writeFile(native, 'native-a');
    await fs.writeFile(metadata, 'Version: 1.0.14\n');

    const first = await coacdEnvironmentIdentitySHA256({ executablePath: executable });
    expect(await coacdEnvironmentIdentitySHA256({ executablePath: executable })).toBe(first);
    await fs.writeFile(native, 'native-b');
    const nativeDrift = await coacdEnvironmentIdentitySHA256({ executablePath: executable });
    expect(nativeDrift).not.toBe(first);
    await fs.writeFile(native, 'native-a');
    await fs.writeFile(metadata, 'Version: 9.9.9\n');
    expect(await coacdEnvironmentIdentitySHA256({ executablePath: executable })).not.toBe(first);
    const startup = path.join(packages, 'sitecustomize.py');
    await fs.writeFile(startup, 'import safe_module\n');
    const startupVersion = await coacdEnvironmentIdentitySHA256({ executablePath: executable });
    await fs.writeFile(startup, 'import changed_module\n');
    expect(await coacdEnvironmentIdentitySHA256({ executablePath: executable })).not.toBe(startupVersion);
  });

  it.skipIf(process.platform === 'win32')('uses the selected original interpreter alias to locate its venv', async () => {
    const root = await scratch();
    const { executable, packages } = await makeVenv(root);
    const externalInterpreter = path.join(root, 'base-python');
    await fs.writeFile(externalInterpreter, 'fake external interpreter');
    await fs.rm(executable);
    await fs.symlink(externalInterpreter, executable);
    await fs.writeFile(path.join(packages, 'numpy.pyc'), 'compiled bytecode');
    await expect(coacdEnvironmentIdentitySHA256({ executablePath: executable })).resolves.toMatch(/^[0-9a-f]{64}$/);
  });

  it.skipIf(process.platform === 'win32')('supports standard POSIX executable aliases and a contained lib64 alias', async () => {
    const root = await scratch();
    const { executable, packages } = await makeVenv(root);
    const alias = path.join(root, 'bin', 'python3.11');
    await fs.symlink(executable, alias);
    await fs.symlink(path.join(root, 'lib'), path.join(root, 'lib64'));
    const identity = await coacdEnvironmentIdentitySHA256({ executablePath: alias });
    await fs.mkdir(path.join(packages, 'numpy'), { recursive: true });
    await fs.writeFile(path.join(packages, 'numpy', 'core.pyc'), 'compiled numpy bytecode');
    expect(await coacdEnvironmentIdentitySHA256({ executablePath: alias })).not.toBe(identity);
  });

  it('supports a structurally Windows venv fixture without launching its executable', async () => {
    const root = await scratch();
    const { executable, packages } = await makeVenv(root, 'windows');
    await fs.writeFile(path.join(root, 'pyvenv.cfg'), 'home = C:\\Python311\ninclude-system-site-packages = False\nversion = 3.11.12\n');
    await fs.mkdir(path.join(packages, 'coacd-1.0.14.dist-info'), { recursive: true });
    await fs.writeFile(path.join(packages, 'coacd-1.0.14.dist-info', 'WHEEL'), 'Root-Is-Purelib: false\n');
    expect(await coacdEnvironmentIdentitySHA256({ executablePath: executable })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('allows only the exact contained setuptools distutils startup hook', async () => {
    const root = await scratch();
    const { executable, packages } = await makeVenv(root);
    const hook = "import os; var = 'SETUPTOOLS_USE_DISTUTILS'; enabled = os.environ.get(var, 'local') == 'local'; enabled and __import__('_distutils_hack').add_shim()\n";
    await fs.writeFile(path.join(packages, 'distutils-precedence.pth'), hook);
    const module = path.join(packages, '_distutils_hack', '__init__.py');
    await fs.mkdir(path.dirname(module), { recursive: true });
    await fs.writeFile(module, 'def add_shim(): pass\n');
    await expect(coacdEnvironmentIdentitySHA256({ executablePath: executable })).resolves.toMatch(/^[0-9a-f]{64}$/);
    await fs.writeFile(path.join(packages, 'distutils-precedence.pth'), 'import os; os.system("untrusted")\n');
    await expect(coacdEnvironmentIdentitySHA256({ executablePath: executable })).rejects.toThrow(/exact setuptools/);
  });

  it('rejects missing, malformed, duplicate, or system-site-package configurations', async () => {
    const root = await scratch();
    const { executable } = await makeVenv(root);
    const config = path.join(root, 'pyvenv.cfg');
    await fs.rm(config);
    await expect(coacdEnvironmentIdentitySHA256({ executablePath: executable })).rejects.toThrow(/missing pyvenv.cfg/);
    await fs.writeFile(config, 'include-system-site-packages = false\ninclude-system-site-packages = true\n');
    await expect(coacdEnvironmentIdentitySHA256({ executablePath: executable })).rejects.toThrow(/duplicate settings/);
    await fs.writeFile(config, 'include-system-site-packages = true\n');
    await expect(coacdEnvironmentIdentitySHA256({ executablePath: executable })).rejects.toThrow(/exactly one/);
    await fs.writeFile(config, 'include-system-site-packages false\n');
    await expect(coacdEnvironmentIdentitySHA256({ executablePath: executable })).rejects.toThrow(/malformed setting/);
  });

  it('rejects missing package roots, unsupported layout, and paths outside the venv', async () => {
    const root = await scratch();
    const { executable, packages } = await makeVenv(root);
    await fs.rm(path.join(root, 'lib'), { recursive: true });
    await expect(coacdEnvironmentIdentitySHA256({ executablePath: executable })).rejects.toThrow(/no supported/);
    await fs.mkdir(path.join(root, 'lib', 'python3.13', 'site-packages'), { recursive: true });
    await expect(coacdEnvironmentIdentitySHA256({ executablePath: executable })).rejects.toThrow(/unsupported or malformed/);
    await fs.rm(path.join(root, 'lib'), { recursive: true });
    await fs.mkdir(path.join(root, 'lib', 'python3.11', 'site-packages'), { recursive: true });
    if (process.platform !== 'win32') {
      const outside = await scratch();
      await fs.symlink(outside, path.join(packages, 'external'));
      await expect(coacdEnvironmentIdentitySHA256({ executablePath: executable })).rejects.toThrow(/symlink or external filesystem/);
    }
  });

  it('rejects escaping .pth paths and oversized package files', async () => {
    const root = await scratch();
    const { executable, packages } = await makeVenv(root);
    await fs.writeFile(path.join(packages, 'escape.pth'), '../../outside\n');
    await expect(coacdEnvironmentIdentitySHA256({ executablePath: executable })).rejects.toThrow(/outside site-packages/);
    await fs.rm(path.join(packages, 'escape.pth'));
    const oversized = path.join(packages, 'too-large.whl');
    await fs.writeFile(oversized, '');
    await fs.truncate(oversized, 64 * 1024 * 1024 + 1);
    await expect(coacdEnvironmentIdentitySHA256({ executablePath: executable })).rejects.toThrow(/64 MiB/);
  });

  it('rejects excessive package-tree depth', async () => {
    const root = await scratch();
    const { executable, packages } = await makeVenv(root);
    let nested = packages;
    for (let depth = 0; depth < 34; depth++) {
      nested = path.join(nested, `d${depth}`);
      await fs.mkdir(nested);
    }
    await expect(coacdEnvironmentIdentitySHA256({ executablePath: executable })).rejects.toThrow(/32-level depth limit/);
  });
});
