import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { exportWorkspace, inspectWorkspace, listRetentionReceipts, planRetention, quarantineWorkspace, restoreWorkspace } from '../src/workspace/retention.js';

const roots: string[] = [];
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'retention-test-')); roots.push(root); return root; }
async function put(root: string, p: string, body = 'content') { await fs.mkdir(path.dirname(path.join(root,p)), { recursive:true }); await fs.writeFile(path.join(root,p),body); }
afterEach(async () => { vi.restoreAllMocks(); for(const root of roots.splice(0)) await fs.rm(root,{recursive:true,force:true}); });
describe('retention plans and recovery', () => {
  it('measures and protects original, unknown, package, job, baseline and referenced bytes', async () => {
    const root=await fixture();
    for(const p of ['asset/source/input.png','asset/model/model.glb','derived/cache.glb','captures/old.png','packages/a/previews/a.png','jobs/job/previews/a.png','baselines/frames/a.png','derived/referenced.glb']) await put(root,p);
    await put(root,'job.json',JSON.stringify({artifacts:[{path:'derived/referenced.glb'}]}));
    const inventory=await inspectWorkspace(root);
    expect(inventory.totals.original).toBe(7);
    expect(inventory.totals.unknown).toBe(7);
    expect((await planRetention(root)).files.map(f=>f.path)).toEqual(['captures/old.png','derived/cache.glb']);
  });
  it('protects paths referenced by metadata outside output root', async () => {
    const root=await fixture(), metadata=await fixture(); await put(root,'derived/a.glb');
    await put(metadata,'record.json',JSON.stringify({model:path.join(root,'derived/a.glb')}));
    expect((await planRetention(root,{metadataRoots:[metadata]})).files).toEqual([]);
  });
  it('rejects corrupt records, stale plans, modified bodies, symlinks, and protected selections', async () => {
    const root=await fixture(); await put(root,'derived/a.glb');
    const original=await planRetention(root);
    await expect(quarantineWorkspace(root,{...original,totalBytes:900})).rejects.toThrow('modified');
    await put(root,'derived/a.glb','changed');
    await expect(quarantineWorkspace(root,original)).rejects.toThrow('stale');
    await put(root,'broken.json','{');
    const blocked=await planRetention(root);
    await expect(quarantineWorkspace(root,blocked)).rejects.toThrow('uncertain');
    await fs.rm(path.join(root,'broken.json'));
    await fs.symlink(path.join(root,'derived/a.glb'),path.join(root,'link'));
    expect((await inspectWorkspace(root)).blockers).toHaveLength(1);
    await put(root,'source/a.glb');
    await expect(planRetention(root,{paths:['source/a.glb']})).rejects.toThrow('protected');
  });
  it('quarantines and restores exact bytes without overwrites or physical reclamation claims', async () => {
    const root=await fixture(); await put(root,'derived/a.glb'); const plan=await planRetention(root);
    const receipt=await quarantineWorkspace(root,plan); expect(receipt.bytesReclaimed).toBe(0);
    await expect(fs.stat(path.join(root,'derived/a.glb'))).rejects.toMatchObject({code:'ENOENT'});
    expect(await listRetentionReceipts(root)).toHaveLength(1);
    await put(root,'derived/a.glb','new content');
    await expect(restoreWorkspace(root,receipt.id)).rejects.toThrow();
    expect(await fs.readFile(path.join(root,'derived/a.glb'),'utf8')).toBe('new content');
    await fs.rm(path.join(root,'derived/a.glb'));
    await restoreWorkspace(root,receipt.id);
    expect(await fs.readFile(path.join(root,'derived/a.glb'),'utf8')).toBe('content');
    expect((await restoreWorkspace(root,receipt.id)).state).toBe('restored');
  });
  it('recovers a rename completed before journal update, and exposes corrupt receipts', async () => {
    const root=await fixture(); await put(root,'derived/a.glb'); const receipt=await quarantineWorkspace(root,await planRetention(root));
    const record=path.join(root,'.retention',receipt.id,'receipt.json');
    await fs.writeFile(record,JSON.stringify({...receipt,evidenceCeiling:undefined,bytesReclaimed:undefined,moved:[],state:'moving'}));
    await restoreWorkspace(root,receipt.id); expect(await fs.readFile(path.join(root,'derived/a.glb'),'utf8')).toBe('content');
    await fs.writeFile(record,'broken'); expect(JSON.stringify(await listRetentionReceipts(root))).toContain('Corrupt receipt');
  });
  it('exports selected originals and manifests to a new verified folder, leaving sources intact', async () => {
    const root=await fixture(), destination=await fixture(); await put(root,'source/a.glb');
    const plan=await planRetention(root,{action:'export'}), result=await exportWorkspace(root,plan,destination);
    expect(await fs.readFile(path.join(result.bundle,'files/source/a.glb'),'utf8')).toBe('content');
    expect(JSON.parse(await fs.readFile(path.join(result.bundle,'export.json'),'utf8')).state).toBe('verified');
    expect(await fs.readFile(path.join(root,'source/a.glb'),'utf8')).toBe('content');
    await expect(exportWorkspace(root,plan,root)).rejects.toThrow('outside');
  });
});
it('refuses restore through a replaced parent symlink and leaves the external directory unchanged', async () => {
  const root=await fixture(), external=await fixture(); await put(root,'derived/a.glb');
  const receipt=await quarantineWorkspace(root,await planRetention(root));
  await fs.rmdir(path.join(root,'derived')); await fs.symlink(external,path.join(root,'derived'),'dir');
  await expect(restoreWorkspace(root,receipt.id)).rejects.toThrow('Symlink');
  expect(await fs.readdir(external)).toEqual([]);
});
it('exposes active/interrupted operation locks without stealing them',async()=>{
  const root=await fixture(); await put(root,'derived/a.glb'); const plan=await planRetention(root);
  await fs.mkdir(path.join(root,'.retention/operation.lock'),{recursive:true});
  await expect(quarantineWorkspace(root,plan)).rejects.toMatchObject({code:'EEXIST'});
  expect(JSON.stringify(await listRetentionReceipts(root))).toContain('interrupted');
  expect(await fs.readFile(path.join(root,'derived/a.glb'),'utf8')).toBe('content');
});
it('retains quarantined source when restored copy is corrupted before verification',async()=>{
  const root=await fixture(); await put(root,'derived/a.glb'); const receipt=await quarantineWorkspace(root,await planRetention(root));
  const original=fs.copyFile.bind(fs);
  vi.spyOn(fs,'copyFile').mockImplementationOnce(async(source,destination,mode)=>{ await original(source,destination,mode); await fs.writeFile(destination,'corrupt restore'); });
  await expect(restoreWorkspace(root,receipt.id)).rejects.toThrow('quarantine source retained');
  expect(await fs.readFile(path.join(root,'.retention',receipt.id,'files/derived/a.glb'),'utf8')).toBe('content');
});
it('refuses structurally valid edited receipt plans before restoring or changing receipt state',async()=>{
  const root=await fixture(); await put(root,'derived/a.glb'); const receipt=await quarantineWorkspace(root,await planRetention(root));
  const record=path.join(root,'.retention',receipt.id,'receipt.json');
  const json=JSON.parse(await fs.readFile(record,'utf8'));json.plan.totalBytes++;
  await fs.writeFile(record,JSON.stringify(json));
  await expect(restoreWorkspace(root,receipt.id)).rejects.toThrow('integrity');
  expect(JSON.parse(await fs.readFile(record,'utf8')).state).toBe('quarantined');
  expect(JSON.stringify(await listRetentionReceipts(root))).toContain('Corrupt receipt');
});
