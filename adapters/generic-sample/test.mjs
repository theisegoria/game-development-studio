import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const config = JSON.parse(await readFile(new URL('src/renderer.json', import.meta.url), 'utf8'));
assert(Number.isFinite(config.frameTime) && config.frameTime > 0);
assert.equal(typeof config.visualRegression, 'boolean');
console.log('Sample configuration checks passed');
