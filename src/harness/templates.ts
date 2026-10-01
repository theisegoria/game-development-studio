import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson } from '../packages/format.js';
import { invalidInput, invalidState } from '../util/errors.js';
import { adapterManifestSchema } from './contracts.js';

const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

function templatesRoot(): string {
  return path.resolve(moduleDirectory, '..', '..', 'adapters');
}

export async function listAdapterTemplates(): Promise<Array<Record<string, unknown>>> {
  const root = templatesRoot();
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
  const templates: Array<Record<string, unknown>> = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || !/^[a-z0-9][a-z0-9._-]*$/.test(entry.name)) continue;
    const source = path.join(root, entry.name, 'adapter.json');
    const stats = await fs.lstat(source).catch(() => undefined);
    if (!stats?.isFile() || stats.isSymbolicLink()) continue;
    const parsed = adapterManifestSchema.safeParse(JSON.parse(await fs.readFile(source, 'utf8')));
    if (!parsed.success) throw invalidState(`packaged adapter template ${entry.name} is invalid`);
    templates.push({
      id: entry.name,
      adapterId: parsed.data.id,
      name: parsed.data.name,
      version: parsed.data.version,
      scenarios: parsed.data.scenarios.map((scenario) => ({
        id: scenario.id,
        title: scenario.title,
        capabilities: scenario.capabilities,
      })),
      manifestRelativePath: path.posix.join('adapters', entry.name, 'adapter.json'),
    });
  }
  return templates;
}

export async function installAdapterTemplate(options: {
  templateId: string;
  projectRoot: string;
  confirm: boolean;
}): Promise<Record<string, unknown>> {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(options.templateId)) throw invalidInput('invalid adapter template id');
  const source = path.join(templatesRoot(), options.templateId, 'adapter.json');
  const sourceStats = await fs.lstat(source).catch(() => undefined);
  if (!sourceStats?.isFile() || sourceStats.isSymbolicLink()) {
    throw invalidInput('unknown adapter template', { templateId: options.templateId });
  }
  const sourceBytes = await fs.readFile(source);
  const parsed = adapterManifestSchema.safeParse(JSON.parse(sourceBytes.toString('utf8')));
  if (!parsed.success) throw invalidState('packaged adapter template violates game_dev.adapter.v1');
  const projectRoot = await fs.realpath(path.resolve(options.projectRoot)).catch(() => {
    throw invalidInput('adapter project root does not exist');
  });
  if (!(await fs.stat(projectRoot)).isDirectory()) throw invalidInput('adapter project root must be a directory');
  const destination = path.join(projectRoot, '.game-dev', 'adapter.json');
  const existing = await fs.readFile(destination).catch(() => undefined);
  const reusable = existing !== undefined && existing.toString('utf8') === canonicalJson(parsed.data);
  if (existing !== undefined && !reusable) {
    throw invalidState('project already has a different .game-dev/adapter.json; refusing to overwrite it', {
      destination,
    });
  }
  if (options.confirm && !reusable) {
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const handle = await fs.open(destination, 'wx', 0o600);
    try {
      await handle.writeFile(canonicalJson(parsed.data));
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  return {
    schema: 'game_dev.adapter_install.v1',
    templateId: options.templateId,
    adapterId: parsed.data.id,
    destination,
    dryRun: !options.confirm,
    reused: reusable,
    scenarios: parsed.data.scenarios.map((scenario) => scenario.id),
    evidenceCeiling:
      'Installing an adapter writes only a declarative manifest. It executes no project command and proves no build, capture, GPU, pixel, or performance result.',
  };
}

/** Creates a new self-contained sample project; never overlays an existing project. */
export async function createSampleProject(destinationInput: string, confirm: boolean): Promise<Record<string, unknown>> {
  const destination = path.resolve(destinationInput);
  const source = path.join(templatesRoot(), 'generic-sample');
  const files = ['capture.mjs', 'test.mjs', 'src/renderer.json', 'baseline.png', 'regression.png'];
  if (await fs.lstat(destination).catch(() => undefined)) throw invalidInput('sample destination must be a new directory');
  if (confirm) {
    await fs.mkdir(destination, { mode: 0o700 });
    await fs.mkdir(path.join(destination, '.game-dev'));
    await fs.mkdir(path.join(destination, 'src'));
    for (const relative of files) await fs.copyFile(path.join(source, relative), path.join(destination, relative), fs.constants.COPYFILE_EXCL);
    await fs.chmod(path.join(destination, 'capture.mjs'), 0o700);
    await fs.copyFile(path.join(source, 'adapter.json'), path.join(destination, '.game-dev', 'adapter.json'), fs.constants.COPYFILE_EXCL);
    await fs.writeFile(path.join(destination, '.gitignore'), '.game-dev/runs/\n.game-dev/goals/\n', { flag: 'wx' });
  }
  return { schema: 'game_dev.sample_project.v1', destination, files: [...files, '.game-dev/adapter.json', '.gitignore'], dryRun: !confirm, evidence: 'synthetic-only' };
}
