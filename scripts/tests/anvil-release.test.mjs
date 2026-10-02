import { URL } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { artifactName, archiveReadme, treeEvidence, validateAppIdentity } from '../package-anvil-release.mjs';
import { anvilProvenance } from '../anvil-provenance.mjs';
const archive = new URL('../anvil-archive.py', import.meta.url).pathname;
test('Anvil release identity and provenance preserve dependencies without claiming notarization', () => {
  assert.equal(artifactName('1.2.0'), 'Anvil-1.2.0-macos-arm64.zip');
  const source = { schema: 'game_dev.macos_bundled_third_party_provenance.v1', release: {appVersion:'1.0.0'}, bundledRuntime: {gameDevCli:{version:'1.2.0'}}, legalAssets:[{sha256:'abc'}] };
  const actual = anvilProvenance(source,'1.2.0');
  assert.equal(actual.release.bundleIdentifier,'com.theisegoria.Anvil');
  assert.equal(actual.legalAssets,source.legalAssets);
  assert.equal(source.release.appVersion,'1.0.0');
  assert.throws(()=>anvilProvenance(source,'1.3.0'));
  assert.throws(()=>validateAppIdentity({},'1.2.0'));
  assert.match(archiveReadme('1.2.0'), /NOT notarized/);
  assert.match(archiveReadme('1.2.0'), /doctor --output-dir/);
});
test('archive roundtrip is deterministic, closed and independent of source tree', async () => {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'anvil-fixture-'));
  try {
    const app=path.join(temp,'Anvil.app'), bin=path.join(app,'Contents/MacOS');
    await fs.mkdir(bin,{recursive:true}); await fs.writeFile(path.join(bin,'Anvil'),'mock only',{mode:0o755});
    const readme=path.join(temp,'README.txt'); await fs.writeFile(readme,archiveReadme('1.2.0'));
    const before=await treeEvidence(app);
    for(const name of ['a.zip','b.zip']) execFileSync('python3',[archive,'create',app,path.join(temp,name),'--readme',readme]);
    assert.deepEqual(await fs.readFile(path.join(temp,'a.zip')),await fs.readFile(path.join(temp,'b.zip')));
    await fs.rm(app,{recursive:true}); await fs.rm(readme);
    const out=path.join(temp,'out'); execFileSync('python3',[archive,'extract',path.join(temp,'a.zip'),out]);
    assert.deepEqual(await treeEvidence(path.join(out,'Anvil.app')),before);
    assert.equal(await fs.readFile(path.join(out,'README.txt'),'utf8'),archiveReadme('1.2.0'));
    assert.throws(()=>execFileSync('python3',[archive,'extract',path.join(temp,'a.zip'),out],{stdio:'pipe'}));
    await fs.symlink('/tmp',path.join(out,'Anvil.app','escape'));
    await assert.rejects(treeEvidence(path.join(out,'Anvil.app')), /Link or special/);
  } finally {await fs.rm(temp,{recursive:true,force:true});}
});
test('malicious archives fail before extraction', async () => {
 const temp=await fs.mkdtemp(path.join(os.tmpdir(),'anvil-hostile-'));
 try {
  for(const [i,name] of ['../escape','Anvil.app/../escape','README.txt/escape','Other.app/x','Anvil.app/a\\b'].entries()) {
   const file=path.join(temp,`${i}.zip`);
   execFileSync('python3',['-c',"import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],'w'); z.writestr(sys.argv[2],'bad'); z.close()",file,name]);
   assert.throws(()=>execFileSync('python3',[archive,'extract',file,path.join(temp,`out${i}`)],{stdio:'pipe'}));
   await assert.rejects(fs.stat(path.join(temp,`out${i}`)));
  }
 } finally {await fs.rm(temp,{recursive:true,force:true});}
});
