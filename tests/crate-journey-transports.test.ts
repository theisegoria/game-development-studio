/** Deterministic CPU fixtures: this is not real-client, engine, hardware or aesthetic evidence. */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { createGameDevRuntime } from '../src/runtime.js';
import { createMcpServer } from '../src/mcp/server.js';
const roots: string[] = [];
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { vi.unstubAllEnvs(); while (cleanup.length) await cleanup.pop()!(); await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
async function workspace() { const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'crate-journey-'))); roots.push(root); return root; }
const recipe = { dimensions: { width: 1, height: 1.2, depth: 0.8 }, seed: 7 };
function body(result: Record<string, unknown>): Record<string, any> {
  return JSON.parse((result.content as { type: string; text?: string }[]).find(item => item.type === 'text')?.text ?? '{}');
}
// Generic tool-call project authority is a human-controlled launch environment ceiling, independent of --confirm.
async function cli(root: string, name: string, args: Record<string, unknown>, confirm = false, projectWrite = false) {
  return new Promise<Record<string, any>>((resolve, reject) => execFile(process.execPath, [fileURLToPath(new URL('../dist/cli.js', import.meta.url)), 'tool', 'call', name, '--input', JSON.stringify(args), '--output-dir', root, '--json', ...(confirm ? ['--confirm'] : [])], { env: { ...process.env, ASSET_LOG_LEVEL: 'silent', TRIPO_API_KEY: '', LEONARDO_API_KEY: '', GAME_DEV_MCP_ALLOW_PROJECT_WRITE: projectWrite ? '1' : '' }, maxBuffer: 4 * 1024 * 1024 }, (_error, stdout) => { try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); } }));
}
async function connect(root: string, profile: 'all' | 'readonly' = 'all') {
  let accepted = true, approvals = 0;
  const runtime = await createGameDevRuntime({ outputDir: root, env: { ASSET_LOG_LEVEL: 'silent', TRIPO_API_KEY: '', LEONARDO_API_KEY: '' } });
  const server = await createMcpServer(runtime, { profile });
  const client = new Client({ name: 'crate-journey-fixture', version: '1' }, { capabilities: { elicitation: {} } });
  client.setRequestHandler(ElicitRequestSchema, () => { approvals++; return accepted ? { action: 'accept', content: { confirm: true } } : { action: 'decline' }; });
  const [a, b] = InMemoryTransport.createLinkedPair(); await Promise.all([client.connect(a), server.connect(b)]);
  cleanup.push(async () => { await client.close(); await server.close(); });
  return { client, call: (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args }), approve: (value: boolean) => { accepted = value; }, approvals: () => approvals };
}
it('MCP completes local crate→separate package approval→verified resources→reviewed copy with honest rights blockers', async () => {
  const root = await workspace(); const mcp = await connect(root); const project = path.join(root, 'game'); await fs.mkdir(project);
  const planned = body(await mcp.call('plan_procedural_crate', { recipe })); expect(planned.cpuOnly).toBe(true); expect(mcp.approvals()).toBe(0);
  mcp.approve(false); expect((await mcp.call('construct_procedural_crate', planned.operation.arguments)).isError).toBe(true);
  await expect(fs.stat(planned.artifactDir)).rejects.toMatchObject({ code: 'ENOENT' });
  mcp.approve(true); expect((await mcp.call('construct_procedural_crate', { ...planned.operation.arguments, recipe: { ...recipe, seed: 8 } })).isError).toBe(true);
  const builtCrate = await mcp.call('construct_procedural_crate', planned.operation.arguments); expect(builtCrate.isError).not.toBe(true); const crate = body(builtCrate);
  expect(crate.generalizedPackageRequest.license).toBe('unknown'); expect(crate.generalizedPackageRequest.provenance.references).toEqual([]);
  expect(crate.nextOperation.name).toBe('plan_generalized_package');
  const packagePlanResult = await mcp.call(crate.nextOperation.name, crate.nextOperation.arguments); expect(packagePlanResult.isError).not.toBe(true); const packagePlan = body(packagePlanResult);
  const packageArgs = { request: crate.generalizedPackageRequest, approvedFingerprint: packagePlan.fingerprint };
  mcp.approve(false); expect((await mcp.call('build_generalized_package', packageArgs)).isError).toBe(true); await expect(fs.stat(packagePlan.destination)).rejects.toMatchObject({ code: 'ENOENT' });
  mcp.approve(true); const builtResult = await mcp.call('build_generalized_package', packageArgs); expect(builtResult.isError).not.toBe(true); const built = body(builtResult);
  const verified = body(await mcp.call('verify_asset_package', { package: built.packageId })); expect(verified.hashesVerified).toBe(true); expect(verified.evidence.humanVisualReviewPerformed).toBe(false);
  const resource = await mcp.client.readResource({ uri: built.uri }); const resourceJson = JSON.parse((resource.contents[0] as { text: string }).text); expect(resourceJson.manifest.packageId).toBe(built.packageId);
  const artifactUri = `game-dev://packages/${built.packageId}/artifacts/lod0.glb`;
  const artifact = await mcp.client.readResource({ uri: artifactUri }); expect((artifact.contents[0] as { blob: string }).blob.length).toBeGreaterThan(0);
  await expect(mcp.client.readResource({ uri: `game-dev://packages/${built.packageId}/artifacts/not-recorded.glb` })).rejects.toThrow();
  const vendorArgs = { package: built.packageId, project }; const vendor = body(await mcp.call('plan_vendor_admission', vendorArgs));
  expect(vendor.blockers.join(' ')).toContain('license is unknown'); expect(vendor.blockers.join(' ')).toContain('provenance');
  vi.stubEnv('GAME_DEV_MCP_ALLOW_PROJECT_WRITE', '1');
  expect((await mcp.call('vendor_package_into_project', { ...vendorArgs, expectedFingerprint: vendor.plan.fingerprint })).isError).toBe(true);
  const copyArgs = { ...vendorArgs, allowUnknownLicense: true, allowInvalid: true }; const reviewedCopy = body(await mcp.call('plan_vendor_admission', copyArgs)); expect(reviewedCopy.blockers).toEqual([]);
  mcp.approve(false); expect((await mcp.call('vendor_package_into_project', { ...copyArgs, expectedFingerprint: reviewedCopy.plan.fingerprint })).isError).toBe(true); await expect(fs.stat(reviewedCopy.destination)).rejects.toMatchObject({ code: 'ENOENT' });
  mcp.approve(true); expect((await mcp.call('vendor_package_into_project', { ...copyArgs, expectedFingerprint: 'a'.repeat(64) })).isError).toBe(true);
  const copied = await mcp.call('vendor_package_into_project', { ...copyArgs, expectedFingerprint: reviewedCopy.plan.fingerprint }); expect(copied.isError).not.toBe(true); expect(body(copied).evidence.projectImportTestPerformed).toBe(false);
  const driftPlan = body(await mcp.call('plan_vendor_admission', { ...copyArgs, destination: 'Other/Crate' })); await fs.mkdir(driftPlan.destination, { recursive: true }); await fs.writeFile(path.join(driftPlan.destination, 'user.txt'), 'keep');
  expect((await mcp.call('vendor_package_into_project', { ...copyArgs, destination: 'Other/Crate', expectedFingerprint: driftPlan.plan.fingerprint })).isError).toBe(true); expect(await fs.readFile(path.join(driftPlan.destination, 'user.txt'), 'utf8')).toBe('keep');
  await fs.writeFile(path.join(built.packagePath, 'lod0.glb'), 'tampered'); expect((await mcp.call('verify_asset_package', { package: built.packageId })).isError).toBe(true); await expect(mcp.client.readResource({ uri: artifactUri })).rejects.toThrow();
});
it('CLI keeps crate construction, generalized packaging and project copying separately confirmed', async () => {
  const root = await workspace(); const planned = await cli(root, 'plan_procedural_crate', { recipe }); expect(planned.ok).toBe(true);
  expect((await cli(root, 'construct_procedural_crate', planned.data.operation.arguments)).ok).toBe(false);
  const constructed = await cli(root, 'construct_procedural_crate', planned.data.operation.arguments, true); expect(constructed.ok).toBe(true);
  const next = constructed.data.nextOperation; const packaging = await cli(root, next.name, next.arguments); expect(packaging.ok).toBe(true);
  const args = { request: constructed.data.generalizedPackageRequest, approvedFingerprint: packaging.data.fingerprint };
  expect((await cli(root, 'build_generalized_package', args)).ok).toBe(false);
  expect((await cli(root, 'build_generalized_package', { ...args, approvedFingerprint: 'a'.repeat(64) }, true)).ok).toBe(false);
  const built = await cli(root, 'build_generalized_package', args, true); expect(built.ok).toBe(true);
  expect((await cli(root, 'verify_asset_package', { package: built.data.packageId })).data.hashesVerified).toBe(true);
  const project = path.join(root, 'game'); await fs.mkdir(project); const vendor = { package: built.data.packageId, project };
  const blocked = await cli(root, 'plan_vendor_admission', vendor); expect(blocked.data.blockers.length).toBeGreaterThan(0);
  const copy = { ...vendor, allowUnknownLicense: true, allowInvalid: true }; const copyPlan = await cli(root, 'plan_vendor_admission', copy); expect(copyPlan.data.blockers).toEqual([]);
  expect((await cli(root, 'vendor_package_into_project', { ...copy, expectedFingerprint: copyPlan.data.plan.fingerprint })).ok).toBe(false);
  expect((await cli(root, 'vendor_package_into_project', { ...copy, expectedFingerprint: copyPlan.data.plan.fingerprint }, true)).ok).toBe(false);
  await expect(fs.stat(copyPlan.data.destination)).rejects.toMatchObject({ code: 'ENOENT' });
  expect((await cli(root, 'vendor_package_into_project', { ...copy, expectedFingerprint: copyPlan.data.plan.fingerprint }, true, true)).ok).toBe(true);
});
it('readonly MCP exposes plans and verification while hiding every crate/package/project writer', async () => {
  const root = await workspace(); const { client, call } = await connect(root, 'readonly'); const listed = await client.listTools(); const names = listed.tools.map(tool => tool.name);
  for (const name of ['plan_procedural_crate', 'plan_generalized_package', 'verify_asset_package', 'plan_vendor_admission']) expect(names).toContain(name);
  for (const name of ['construct_procedural_crate', 'build_generalized_package', 'vendor_package_into_project', 'migrate_asset_catalog']) expect(names).not.toContain(name);
  expect((await call('plan_procedural_crate', { recipe, approved: true })).isError).toBe(true);
  const plan = body(await call('plan_procedural_crate', { recipe })); expect((await call('construct_procedural_crate', plan.operation.arguments)).isError).toBe(true);
  expect((await call('plan_generalized_package', { request: { kind: 'mesh', name: 'unknown', primary: 'a.glb', artifacts: [], unsafeScript: 'run' } })).isError).toBe(true);
  await expect(fs.stat(path.join(root, '.production'))).rejects.toMatchObject({ code: 'ENOENT' });
});
