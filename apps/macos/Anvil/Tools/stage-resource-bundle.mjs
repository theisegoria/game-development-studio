// Stage only the resource-only SwiftPM bundle. Never launches Anvil or executes build output.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const bundleName = 'Anvil_AnvilKit.bundle';
const schemaName = 'roadmap-tool-schemas.json';
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  const key = process.argv[i], value = process.argv[i + 1];
  if (!['--build-products', '--app-resources', '--verify', '--schema'].includes(key) || !value || args.has(key)) throw new Error('Invalid resource staging arguments');
  args.set(key, value);
}
const schema = path.resolve(args.get('--schema') ?? fileURLToPath(new URL('../Sources/AnvilKit/Resources/roadmap-tool-schemas.json', import.meta.url)));
const expected = await fs.readFile(schema);
const decoded = JSON.parse(expected.toString('utf8'));
if (!decoded || Array.isArray(decoded) || typeof decoded !== 'object' || Object.keys(decoded).length === 0) throw new Error('Expected schema must be a nonempty object');

async function inspect(bundle) {
  const root = await fs.lstat(bundle);
  if (!root.isDirectory() || root.isSymbolicLink()) throw new Error('Resource bundle must be a regular directory');
  const structured = (await fs.readdir(bundle)).includes('Contents');
  const resourcePath = structured ? `Contents/Resources/${schemaName}` : schemaName;
  const allowedDirectories = new Set(structured ? ['Contents', 'Contents/Resources', 'Contents/_CodeSignature'] : ['_CodeSignature']);
  const signaturePrefix = structured ? 'Contents/_CodeSignature/' : '_CodeSignature/';
  const allowedFiles = new Set([resourcePath, structured ? 'Contents/Info.plist' : 'Info.plist',
    ...['CodeResources', 'CodeSignature', 'CodeDirectory', 'CodeRequirements'].map(name => signaturePrefix + name)]);
  const files = new Map();
  async function walk(directory, relative = '') {
    for (const name of await fs.readdir(directory)) {
      const entry = relative ? `${relative}/${name}` : name;
      const absolute = path.join(directory, name);
      const info = await fs.lstat(absolute);
      if (info.isSymbolicLink()) throw new Error(`Symlinked bundle resource: ${entry}`);
      if (info.isDirectory()) {
        if (!allowedDirectories.has(entry)) throw new Error(`Unexpected resource directory: ${entry}`);
        await walk(absolute, entry);
      } else {
        if (!info.isFile() || !allowedFiles.has(entry) || (info.mode & 0o111) || info.size > 2 * 1024 * 1024) throw new Error(`Unexpected or unsafe bundle resource: ${entry}`);
        files.set(entry, await fs.readFile(absolute));
      }
    }
  }
  await walk(bundle);
  if (!files.get(resourcePath)?.equals(expected)) throw new Error('Staged resource schema missing or differs from canonical source');
  if (structured && !files.has('Contents/Info.plist')) throw new Error('Structured bundle requires Info.plist');
  return files;
}

if (args.has('--verify')) {
  if (args.has('--build-products') || args.has('--app-resources')) throw new Error('Verify cannot also stage resources');
  await inspect(path.resolve(args.get('--verify')));
} else {
  if (!args.has('--build-products') || !args.has('--app-resources')) throw new Error('Provide build products and app resources directories');
  const source = path.join(path.resolve(args.get('--build-products')), bundleName);
  const files = await inspect(source);
  const resources = path.resolve(args.get('--app-resources'));
  const parent = await fs.lstat(resources);
  if (!parent.isDirectory() || parent.isSymbolicLink()) throw new Error('App resources must be a regular directory');
  const destination = path.join(resources, bundleName);
  // Exclusive destination prevents accidental replacement of an already staged bundle.
  await fs.mkdir(destination, { mode: 0o755 });
  try {
    for (const [relative, bytes] of files) {
      const target = path.join(destination, relative);
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
      await fs.writeFile(target, bytes, { flag: 'wx', mode: 0o644 });
    }
    await inspect(destination);
  } catch (error) {
    await fs.rm(destination, { recursive: true, force: true });
    throw error;
  }
}
process.stdout.write(`${bundleName}: closed resource roster and canonical schema verified\n`);
