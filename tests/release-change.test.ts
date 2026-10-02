import { afterEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fetchReleaseMetadata, planReleaseChange, verifyReleaseArtifact } from '../src/installation/releases.js';
const roots: string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await fs.rm(root,{recursive:true,force:true});});
async function artifact(version='1.2.0', kind: 'cli' | 'skills' | 'native' = 'cli') {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'release-plan-')); roots.push(root);
 const name=kind === 'native' ? `Anvil-${version}-macos-arm64.zip` : kind === 'skills' ? `game-development-studio-plugin-${version}.zip` : `theisegoria-game-development-studio-${version}.tgz`, file=path.join(root,name), checksums=path.join(root,'SHA256SUMS.txt');
 const bytes=Buffer.from('synthetic tarball bytes'), sha256=createHash('sha256').update(bytes).digest('hex');
 await fs.writeFile(file,bytes); await fs.writeFile(checksums,`${sha256}  ${name}\n`);
 const release={tag_name:`v${version}`,html_url:`https://github.com/theisegoria/game-development-studio/releases/tag/v${version}`,draft:false,prerelease:false,assets:[{name,size:bytes.length,digest:`sha256:${sha256}`,browser_download_url:`https://github.com/theisegoria/game-development-studio/releases/download/v${version}/${name}`}]};
 return {version,artifact:file,checksums,release};
}
it('distinguishes local checksum integrity from GitHub release provenance and supports rollback',async()=>{
 const target=await artifact(), previous=await artifact('1.1.0');
 const args={installedVersion:previous.version,targetVersion:target.version,artifact:target.artifact,checksums:target.checksums,rollbackArtifact:previous.artifact,rollbackChecksums:previous.checksums};
 expect((await planReleaseChange(args)).readyForManualInstall).toBe(false);
 const verified=await planReleaseChange({...args,targetRelease:target.release,rollbackRelease:previous.release});
 expect(verified.readyForManualInstall).toBe(true);expect(verified.direction).toBe('upgrade');
 const reverse=await planReleaseChange({installedVersion:target.version,targetVersion:previous.version,artifact:previous.artifact,checksums:previous.checksums,rollbackArtifact:target.artifact,rollbackChecksums:target.checksums,targetRelease:previous.release,rollbackRelease:target.release});
 expect(reverse.direction).toBe('rollback');
});
it('rejects hash changes, wrong versions, repositories, missing digests and duplicate checksum records',async()=>{
 const a=await artifact();
 await expect(verifyReleaseArtifact({...a,version:'1.0.0'})).rejects.toThrow('name');
 await expect(verifyReleaseArtifact({...a,githubRelease:{...a.release,html_url:'https://github.com/other/repo/releases/tag/v1.2.0'}})).rejects.toThrow('identity');
 await expect(verifyReleaseArtifact({...a,githubRelease:{...a.release,assets:a.release.assets.map(v=>({...v,digest:null}))}})).rejects.toThrow('digest');
 await fs.appendFile(a.checksums,await fs.readFile(a.checksums)); await expect(verifyReleaseArtifact(a)).rejects.toThrow('duplicate');
 await fs.writeFile(a.checksums,`${'0'.repeat(64)}  ${path.basename(a.artifact)}\n`);await expect(verifyReleaseArtifact(a)).rejects.toThrow('mismatch');
});
it('fetches only the canonical repository stable tag with bounded reads, no redirects',async()=>{
 const a=await artifact();const fetcher=vi.fn(async()=>new Response(JSON.stringify(a.release)));
 expect(await fetchReleaseMetadata(a.version,fetcher)).toEqual(a.release);
 expect(fetcher).toHaveBeenCalledWith('https://api.github.com/repos/theisegoria/game-development-studio/releases/tags/v1.2.0',expect.objectContaining({redirect:'error'}));
 await expect(fetchReleaseMetadata('../../bad',fetcher)).rejects.toThrow();
});
it('keeps native rollback separate from skills ZIPs and makes its platform and signing ceiling explicit',async()=>{
 const target=await artifact('1.3.0','native'), previous=await artifact('1.2.0','native'), skills=await artifact('1.2.0','skills');
 const args={installedVersion:previous.version,targetVersion:target.version,artifact:target.artifact,checksums:target.checksums,rollbackArtifact:previous.artifact,rollbackChecksums:previous.checksums,targetRelease:target.release,rollbackRelease:previous.release};
 const plan=await planReleaseChange(args);
 expect(plan.target.distribution).toBe('anvil-macos-arm64');
 expect(plan.readyForManualInstall).toBe(true);
 expect(plan.steps.join(' ')).toContain('not notarized');
 expect(plan.steps.join(' ')).toContain('Apple Silicon');
 await expect(planReleaseChange({...args,rollbackArtifact:skills.artifact,rollbackChecksums:skills.checksums,rollbackRelease:skills.release})).rejects.toThrow('same distribution');
 const unsupported=target.artifact.replace('arm64.zip','x64.zip');
 await fs.copyFile(target.artifact,unsupported);
 await expect(verifyReleaseArtifact({version:target.version,artifact:unsupported,checksums:target.checksums})).rejects.toThrow('name');
 const skillsPlan=await planReleaseChange({...args,targetVersion:skills.version,artifact:skills.artifact,checksums:skills.checksums,targetRelease:skills.release,rollbackArtifact:skills.artifact,rollbackChecksums:skills.checksums,rollbackRelease:skills.release});
 expect(skillsPlan.steps.join(' ')).toContain('does not contain the CLI runtime');
 expect(skillsPlan.steps.join(' ')).toContain('Do not change a CLI launcher');
});
