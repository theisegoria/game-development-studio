import { Buffer } from 'node:buffer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function anvilProvenance(source, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version) || source.schema !== 'game_dev.macos_bundled_third_party_provenance.v1'
      || source.bundledRuntime?.gameDevCli?.version !== version) throw new Error('Anvil/runtime provenance version mismatch');
  return { ...source, release: { ...source.release, appVersion: version, bundleIdentifier: 'com.theisegoria.Anvil' } };
}
export function provenanceBytes(source, version) { return Buffer.from(JSON.stringify(anvilProvenance(source, version), null, 2) + '\n'); }
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 6 || args[0] !== '--source' || args[2] !== '--version' || args[4] !== '--output') throw new Error('Usage: anvil-provenance.mjs --source FILE --version VERSION --output FILE');
  await fs.writeFile(args[5], provenanceBytes(JSON.parse(await fs.readFile(args[1], 'utf8')), args[3]));
}
