// Reviewable, additive sync of a verified export into an existing clean Git
// checkout. Local runtimes and historical release receipts are preserved.
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const [sourceArg,targetArg,...options]=process.argv.slice(2);
if(!sourceArg||!targetArg||options.some(value=>value!=='--apply'))throw new Error('Usage: node scripts/sync-public.mjs EXPORTED_DIRECTORY GIT_DIRECTORY [--apply]');
const source=fs.realpathSync(sourceArg),target=fs.realpathSync(targetArg),apply=options.includes('--apply');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const within=(base,file)=>{const relative=path.relative(base,file);return relative&&!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith(`..${path.sep}`);};
if(source===target||within(source,target)||within(target,source))throw new Error('Export and target must be separate directories');
const git=(...args)=>execFileSync('git',['-C',target,...args],{encoding:'utf8',windowsHide:true}).trim();
if(fs.realpathSync(git('rev-parse','--show-toplevel'))!==target)throw new Error('Target must be a Git working tree root');
if(git('status','--porcelain','--untracked-files=normal'))throw new Error('Target checkout has uncommitted changes; preserve and resolve them before synchronizing');
const commit=git('rev-parse','HEAD');
const manifest=JSON.parse(fs.readFileSync(path.join(source,'release/source-manifest.json'),'utf8'));
if(manifest.schema_version!==1||!manifest.files||!Object.keys(manifest.files).length)throw new Error('Export manifest missing or empty');
const forbidden=new Set(['.git','node_modules','runtime','downloads','artifacts','output','gameboy','.pi-state','.eda-state','.xil','__pycache__','.agents']);
const privateNames=/^(?:auth\.json|credentials(?:\.[^/]*)?|\.env(?:\..*)?)$/i;
function checked(base,relative,{existing=true}={}){
  if(typeof relative!=='string'||/[\\:\0\r\n]/.test(relative)||relative.split('/').some(part=>!part||part==='.'||part==='..'||/[. ]$/.test(part)||forbidden.has(part.toLowerCase())||(privateNames.test(part)&&part.toLowerCase()!=='.env.example'))||path.isAbsolute(relative))throw new Error('Unsafe export path');
  if(['.pi/mcp.json','.codex/config.toml'].includes(relative.toLowerCase()))throw new Error('Machine-local configuration cannot be synchronized');
  const file=path.resolve(base,relative);
  if(!within(base,file))throw new Error('Path outside selected checkout');
  let ancestor=base;
  for(const part of relative.split('/')){
    ancestor=path.join(ancestor,part);
    if(fs.existsSync(ancestor)&&fs.lstatSync(ancestor).isSymbolicLink())throw new Error('Linked path component cannot be synchronized');
  }
  let probe=file;while(!fs.existsSync(probe))probe=path.dirname(probe);
  const real=fs.realpathSync(probe);
  if(real!==base&&!within(base,real))throw new Error('Path resolves outside selected checkout');
  if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()))throw new Error('Sync requires ordinary source files');
  if(existing&&!fs.existsSync(file))throw new Error(`Source missing: ${relative}`);
  return file;
}
const inventory={...manifest.files};
for(const name of ['release/source-manifest.json','release/local-evidence-links.json'])inventory[name]=sha(fs.readFileSync(checked(source,name)));
const writes=[];
for(const [name,digest]of Object.entries(inventory)){
  if(sha(fs.readFileSync(checked(source,name)))!==digest)throw new Error(`Export bytes changed: ${name}`);
  const destination=checked(target,name,{existing:false});
  const previous=fs.existsSync(destination)?sha(fs.readFileSync(destination)):null;
  if(previous!==digest)writes.push({path:name,previous_sha256:previous,sha256:digest});
}
// Only explicit documentation relocations retire an old path. Never infer that
// an absent source authorizes deleting historical receipts or user data.
const retire=[];
for(const name of git('ls-files').split('\n')){
  const replacement=/^docs\/[^/]+\.md$/.test(name)?`docs/history/${path.basename(name)}`:null;
  if(replacement&&Object.hasOwn(inventory,replacement)&&!Object.hasOwn(inventory,name)){
    const old=checked(target,name);retire.push({path:name,replacement,sha256:sha(fs.readFileSync(old))});
  }
}
const plan={schema_version:1,mode:apply?'apply':'plan',source,target,base_commit:commit,writes,retire,
  preserves:'Unlisted files, historical release receipts, installed tools and all Git history.',pushes:false};
if(!apply){console.log(JSON.stringify(plan,null,2));process.exit(0);}
if(git('rev-parse','HEAD')!==commit||git('status','--porcelain','--untracked-files=normal'))throw new Error('Target changed after planning');
const backup=path.join(target,'artifacts',`repository-sync-backup-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,6)}`);
const artifactDirectory=path.dirname(backup);
if(fs.existsSync(artifactDirectory)&&!within(target,fs.realpathSync(artifactDirectory)))throw new Error('Backup directory resolves outside target checkout');
fs.mkdirSync(backup,{recursive:true});
for(const item of [...writes.filter(item=>item.previous_sha256),...retire]){
  const from=checked(target,item.path),bytes=fs.readFileSync(from),expected=item.previous_sha256||item.sha256;
  if(sha(bytes)!==expected)throw new Error(`Target changed after planning: ${item.path}`);
  const saved=path.join(backup,'files',item.path);fs.mkdirSync(path.dirname(saved),{recursive:true});fs.writeFileSync(saved,bytes,{flag:'wx'});
  if(sha(fs.readFileSync(saved))!==expected)throw new Error('Backup verification failed');
}
fs.writeFileSync(path.join(backup,'manifest.json'),JSON.stringify({...plan,backup,created_at:new Date().toISOString()},null,2)+'\n',{flag:'wx'});
for(const item of writes){
  const from=checked(source,item.path),destination=checked(target,item.path,{existing:false});
  if(sha(fs.readFileSync(from))!==item.sha256)throw new Error(`Export changed during sync: ${item.path}`);
  fs.mkdirSync(path.dirname(destination),{recursive:true});fs.copyFileSync(from,destination);
  if(sha(fs.readFileSync(destination))!==item.sha256)throw new Error(`Copy verification failed: ${item.path}`);
}
for(const item of retire){
  const old=checked(target,item.path);
  if(sha(fs.readFileSync(old))!==item.sha256)throw new Error(`Retired document changed: ${item.path}`);
  fs.unlinkSync(old); // Exact verified file; its bytes are preserved above.
}
console.log(JSON.stringify({applied:true,files_written:writes.length,documents_relocated:retire.length,backup,base_commit:commit,pushes:false},null,2));
