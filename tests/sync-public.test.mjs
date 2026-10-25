import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';

const project=path.resolve(import.meta.dirname,'..');
const artifacts=path.join(project,'artifacts');
const script=path.join(project,'scripts/sync-public.mjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
function fixture(t){
  fs.mkdirSync(artifacts,{recursive:true});
  const root=fs.mkdtempSync(path.join(artifacts,'sync-test-'));
  t.after(()=>{
    const relative=path.relative(fs.realpathSync(artifacts),fs.realpathSync(root));
    assert.ok(relative.startsWith('sync-test-')&&!relative.includes(path.sep));
    fs.rmSync(root,{recursive:true,force:true});
  });
  const source=path.join(root,'export'),target=path.join(root,'checkout');
  const write=(base,file,text)=>{fs.mkdirSync(path.dirname(path.join(base,file)),{recursive:true});fs.writeFileSync(path.join(base,file),text);};
  write(target,'.gitignore','artifacts/\nruntime/\ncandidate\n.pi/mcp.json\n.codex/config.toml\n');
  write(target,'README.md','Before sync\n');
  write(target,'docs/old-guide.md','Original guide\n');
  write(target,'release/previous-result.json','{"historical":true}\n');
  function git(...args){const p=spawnSync('git',args,{cwd:target,encoding:'utf8',windowsHide:true});assert.equal(p.status,0,p.stderr);return p.stdout.trim();}
  git('init','--quiet');git('add','.');git('-c','user.name=Offline Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','Fixture baseline');
  write(target,'runtime/installed-tool.txt','Existing installation\n');
  write(target,'.pi/mcp.json','Existing machine configuration\n');
  function exportFiles(files){
    for(const [file,text] of Object.entries(files))write(source,file,text);
    write(source,'release/local-evidence-links.json','{"references":[]}\n');
    write(source,'release/source-manifest.json',JSON.stringify({schema_version:1,files:Object.fromEntries(Object.entries(files).map(([file,text])=>[file,hash(text)]))}));
  }
  exportFiles({'README.md':'After sync\n','docs/history/old-guide.md':'Relocated guide\n','src/new-module.mjs':'export const value=1;\n'});
  const run=(apply=false)=>spawnSync(process.execPath,[script,source,target,...(apply?['--apply']:[])],{cwd:project,encoding:'utf8',windowsHide:true});
  return {root,source,target,git,write,exportFiles,run};
}

test('Sync preview is read-only and rejects dirty targets or altered manifest bytes',t=>{
  const f=fixture(t),preview=f.run();
  assert.equal(preview.status,0,preview.stderr);
  assert.equal(JSON.parse(preview.stdout).mode,'plan');
  assert.equal(fs.readFileSync(path.join(f.target,'README.md'),'utf8'),'Before sync\n');
  assert.equal(fs.existsSync(path.join(f.target,'artifacts')),false);
  f.write(f.target,'README.md','Local uncommitted changes\n');
  let result=f.run(true);
  assert.notEqual(result.status,0);assert.match(result.stderr,/uncommitted changes/);
  assert.equal(fs.readFileSync(path.join(f.target,'README.md'),'utf8'),'Local uncommitted changes\n');
  f.write(f.target,'README.md','Before sync\n');
  f.write(f.source,'README.md','Changed after export\n');
  result=f.run(true);
  assert.notEqual(result.status,0);assert.match(result.stderr,/Export bytes changed/);
  assert.equal(fs.existsSync(path.join(f.target,'artifacts')),false);
});

test('Sync preserves historical releases and installations, backs up bytes, and retires only moved documents',t=>{
  const f=fixture(t),head=f.git('rev-parse','HEAD'),result=f.run(true);
  assert.equal(result.status,0,result.stderr);
  const receipt=JSON.parse(result.stdout),backup=JSON.parse(fs.readFileSync(path.join(receipt.backup,'manifest.json'),'utf8'));
  assert.equal(receipt.base_commit,head);assert.equal(f.git('rev-parse','HEAD'),head);
  assert.equal(fs.readFileSync(path.join(f.target,'README.md'),'utf8'),'After sync\n');
  assert.equal(fs.existsSync(path.join(f.target,'docs/old-guide.md')),false);
  assert.equal(fs.readFileSync(path.join(f.target,'docs/history/old-guide.md'),'utf8'),'Relocated guide\n');
  assert.equal(fs.readFileSync(path.join(f.target,'release/previous-result.json'),'utf8'),'{"historical":true}\n');
  assert.equal(fs.readFileSync(path.join(f.target,'runtime/installed-tool.txt'),'utf8'),'Existing installation\n');
  assert.equal(fs.readFileSync(path.join(f.target,'.pi/mcp.json'),'utf8'),'Existing machine configuration\n');
  assert.deepEqual(backup.retire.map(item=>item.path),['docs/old-guide.md']);
  for(const item of [...backup.writes.filter(item=>item.previous_sha256),...backup.retire]){
    const bytes=fs.readFileSync(path.join(receipt.backup,'files',item.path));
    assert.equal(hash(bytes),item.previous_sha256||item.sha256);
  }
});

test('Sync refuses machine configuration and path traversal from an export manifest',t=>{
  const f=fixture(t);
  for(const file of ['.pi/mcp.json','.PI/MCP.JSON','.GIT/config','Runtime/installed-tool.txt']){
    f.exportFiles({[file]:'UNTRUSTED_CONFIGURATION\n'});
    const preview=f.run();
    assert.notEqual(preview.status,0,`Unsafe path was accepted: ${file}`);
  }
  assert.equal(fs.readFileSync(path.join(f.target,'.pi/mcp.json'),'utf8'),'Existing machine configuration\n');
  f.write(f.source,'release/source-manifest.json',JSON.stringify({schema_version:1,files:{'../outside.txt':hash('outside')}}));
  const result=f.run(true);
  assert.notEqual(result.status,0);assert.match(result.stderr,/Unsafe export path/);
});

test('Sync refuses a directory junction into ignored runtime even when it remains inside the checkout',t=>{
  const f=fixture(t);
  f.write(f.target,'runtime/model.mjs','Existing installed module\n');
  fs.symlinkSync(path.join(f.target,'runtime'),path.join(f.target,'candidate'),process.platform==='win32'?'junction':'dir');
  assert.equal(f.git('status','--porcelain','--untracked-files=normal'),'');
  f.exportFiles({'candidate/model.mjs':'Replacement source\n'});
  const result=f.run(); // A rejected preview must never need to alter the installation.
  assert.notEqual(result.status,0);
  assert.equal(fs.readFileSync(path.join(f.target,'runtime/model.mjs'),'utf8'),'Existing installed module\n');
});
