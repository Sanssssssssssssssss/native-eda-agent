// Allowlisted source export. Original workspace and historical evidence stay untouched.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const destination=path.resolve(process.argv[2]||path.join(root,'artifacts','public-source'));
if(destination===root||root.startsWith(destination+path.sep))throw new Error('Export cannot overwrite the source workspace or an ancestor');
const destinationRelative=path.relative(root,destination);
if(!destinationRelative.startsWith('..'+path.sep)&&!path.isAbsolute(destinationRelative)&&destinationRelative.split(path.sep)[0]!=='artifacts')throw new Error('An export inside the source workspace must be under artifacts/');
if(fs.existsSync(destination)&&fs.readdirSync(destination).length)throw new Error('Destination must be empty; existing files preserved');
fs.mkdirSync(destination,{recursive:true});
const excluded=new Set(['.git','node_modules','runtime','downloads','artifacts','Gameboy','.pi-state','.eda-state','__pycache__','.Xil','runs']);
const extensions=new Set(['.mjs','.js','.ts','.py','.tcl','.json','.toml','.yaml','.yml','.md','.html','.css','.ps1','.v','.sv','.vh','.svh','.vhd','.vhdl','.xdc','.c','.h','.S','.ld','.hex','.mem','.txt','.cir','.net','.rpt','.csv','.coe']);
const files=[];
const sourcePins=JSON.parse(fs.readFileSync(path.join(root,'release/upstreams.json'),'utf8'));
function permitted(name){return name!=='write_report.py'&&!/^(latest[-.]|codex-usage|collect_usage|collect-usage)/.test(name)&&!/(\.egg-info|\.cache)$/.test(name)&&(extensions.has(path.extname(name))||/^(LICENSE|NOTICE|Makefile|\.gitignore)$/.test(name));}
function copy(relative){
  relative=relative.replaceAll('\\','/');
  if(path.isAbsolute(relative)||relative.split('/').some(part=>part==='..'||excluded.has(part)))throw new Error(`Export path is not allowed: ${relative}`);
  if(files.includes(relative))return;
  const from=path.join(root,relative),to=path.join(destination,relative),stat=fs.lstatSync(from);
  if(stat.isSymbolicLink())throw new Error(`Symlink requires explicit review: ${relative}`);
  if(!stat.isFile()||stat.size>8*1024*1024)throw new Error(`Not a small source file: ${relative}`);
  fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);files.push(relative.replaceAll('\\','/'));
}
function walk(relative,accept=(next,name)=>permitted(name)){
  for(const e of fs.readdirSync(path.join(root,relative),{withFileTypes:true})){
    if(excluded.has(e.name))continue;
    const next=path.join(relative,e.name);
    if(e.isDirectory())walk(next,accept);else if(accept(next.replaceAll('\\','/'),e.name))copy(next);
  }
}
for(const name of ['src','scripts','tests','benchmarks','knowledge','examples','prompts','docs','results','web','.github','.pi/extensions','.pi/skills'])walk(name,(relative,filename)=>permitted(filename)||(relative.startsWith('tests/fixtures/')&&filename.endsWith('.log')));
for(const image of ['workbench.png','workbench-axi.png','workbench-evaluations.png','workbench-project.png','workbench-scope.png','workbench-tests.png']){
  if(fs.existsSync(path.join(root,'docs/media',image)))copy(`docs/media/${image}`);
}
for(const name of ['fft-spectrum','fpga-tool-validation','hard-bench','system-bench','verilogeval-24','verilogeval-mini','native-vivado-workbench'])walk(`projects/${name}`);
for(const name of ['README.md','AGENTS.md','CONTRIBUTING.md','CHANGELOG.md','LICENSE','THIRD_PARTY_NOTICES.md','.gitignore','.gitattributes','.editorconfig','package.json','package-lock.json','eda.ps1','start-pi.ps1','.eda/config.json','.eda/optimizer-upstreams.json','.pi/APPEND_SYSTEM.md','.pi/settings.json','projects/README.md','vendor/README.md','release/upstreams.json','release/python-requirements.lock','release/README.md'])copy(name);
// Release summaries are deliberately named and reviewed; raw logs, events,
// conversations and private artifacts are never copied by this traversal.
walk('release',(relative,name)=>name.endsWith('.md')||
  /^(?:validation|evaluation|knowledge-evaluation|verifier-loop|ace-loop|repository|cleanup|summary)(?:[-.][A-Za-z0-9_.-]+)?\.json$/.test(name)||
  (path.posix.dirname(relative)==='release/verifier-loop'&&/^(?:validation|demo|axi-plan|backup)\.json$/.test(name))||
  (path.posix.dirname(relative)==='release'&&/^validation(?:[-.][A-Za-z0-9_.-]+)?\.txt$/.test(name))||
  (relative.startsWith('release/eda-v06/')&&/\.(?:json|rpt|txt)$/.test(name)&&!/^(?:events?|trace|run|session|transcript)(?:[-.]|$)/i.test(name)));
const community='vendor/vivado-mcp-community';
let upstreamFiles;
if(fs.existsSync(path.join(root,community,'.git'))){
  upstreamFiles=execFileSync('git',['-C',path.join(root,community),'ls-files','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
}else{
  // Published snapshots intentionally have no nested Git repository. Reuse the
  // exact bundled inventory while preserving reviewed local backend patches.
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'release/source-manifest.json'),'utf8'));
  upstreamFiles=Object.keys(manifest.files||{}).filter(file=>file.startsWith(community+'/')).map(file=>file.slice(community.length+1));
  if(!upstreamFiles.length)throw new Error('Published community backend inventory is missing');
}
for(const f of upstreamFiles)if(permitted(path.basename(f))&&!f.split('/').some(p=>excluded.has(p)))copy(`${community}/${f}`);
for(const f of ['LICENSE','NOTICE','optimizer/recipe_router.py','docs/PLAYBOOK.md'])copy(`vendor/routeagents-fpl26/${f}`);
const ace=sourcePins.sources.find(source=>source.name==='ace-rtl');
if(!ace?.bundled||!ace.files||Object.keys(ace.files).length!==97)throw new Error('Pinned ACE-RTL source inventory is incomplete');
for(const [file,expected] of Object.entries(ace.files)){
  const relative=`vendor/ace-rtl/${file}`;
  const source=fs.readFileSync(path.join(root,relative),'utf8').replaceAll('\r\n','\n');
  if(createHash('sha256').update(source).digest('hex')!==expected)throw new Error(`Pinned ACE-RTL source changed: ${file}`);
  copy(relative);
}
const pins=JSON.parse(fs.readFileSync(path.join(destination,'.eda/optimizer-upstreams.json'),'utf8'));
for(const s of pins.sources)s.path=s.name==='RouteAgents'?'vendor/routeagents-fpl26':'vendor/aer-fpl26-optimizer';
fs.writeFileSync(path.join(destination,'.eda/optimizer-upstreams.json'),JSON.stringify(pins,null,2)+'\n');
const annotations=[];
for(const relative of files.filter(f=>f.endsWith('.md')&&!f.startsWith('vendor/'))){
  const file=path.join(destination,relative);
  let text=fs.readFileSync(file,'utf8');
  text=text.replace(/(!?)\[([^\]\n]*)\]\(([^)\n]+)\)/g,(whole,image,label,target)=>{
    if(/^(https?:|mailto:|#)/i.test(target))return whole;
    let local=target.replace(/^<|>$/g,'').split('#')[0].replaceAll('\\','/');
    const old=root.replaceAll('\\','/');
    const resolved=local.startsWith(old+'/')?path.join(destination,local.slice(old.length+1)):path.resolve(path.dirname(file),local);
    if(fs.existsSync(resolved))return `${image}[${label}](${path.relative(path.dirname(file),resolved).replaceAll('\\','/')}${target.includes('#')?'#'+target.split('#')[1]:''})`;
    annotations.push({document:relative,label,target:local.replace(old,'${WORKSPACE}')});
    return `${label} (local/optional evidence; see results/catalog.json)`;
  });
  text=text.replaceAll(root,'${WORKSPACE}').replaceAll(root.replaceAll('\\','/'),'${WORKSPACE}');
  text=text.replace(/01a[0-9a-f]{5}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,'[local-session-id]');
  fs.writeFileSync(file,text);
}
// Report filenames only if a credential-shaped value is found; never print the value.
const violations=[];
for(const relative of files){
  const text=fs.readFileSync(path.join(destination,relative),'utf8');
  if(/(?:gh[opsu]_[A-Za-z0-9]{24,}|sk-[A-Za-z0-9]{32,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/.test(text))violations.push(relative);
}
if(violations.length)throw new Error(`Possible credentials in export; publication blocked: ${violations.join(', ')}`);
fs.writeFileSync(path.join(destination,'release/local-evidence-links.json'),JSON.stringify({note:'Links to unbundled local evidence were rendered as labels, not public proof.',references:annotations},null,2)+'\n');
const hashes=Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(destination,f))).digest('hex')]));
fs.writeFileSync(path.join(destination,'release/source-manifest.json'),JSON.stringify({schema_version:1,scope:'Exported sources and published summaries before machine-local setup; excludes private runtime logs',files:hashes},null,2)+'\n');
console.log(JSON.stringify({destination,files:files.length,ace_upstream_commit:ace.commit,ace_files:Object.keys(ace.files).length,local_links_annotated:annotations.length,credential_findings:0},null,2));
