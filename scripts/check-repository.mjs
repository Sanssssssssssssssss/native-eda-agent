// Check a Git index or exported source inventory without inspecting local runtimes.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const ACE_COMMIT='94754d796350d42502c9a32639a20d86f50e9678';
export const REQUIRED_FILES=[
  'README.md','AGENTS.md','LICENSE','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','.gitignore',
  '.eda/config.json','.pi/APPEND_SYSTEM.md','.github/workflows/validate.yml',
  'src/agent.mjs','src/agent-session.mjs','src/extension.ts','src/workflow.mjs','src/verifier-loop.mjs','src/eda-coordinator.mjs','src/trace.mjs',
  'scripts/ace-rtl-feedback.py','scripts/demo-verifier-loop.mjs','scripts/validate-agent-offline.mjs','scripts/check-repository.mjs',
  'docs/README.md','docs/ace-rtl-adaptation.md','docs/agent-framework-and-traces.md','docs/agent-workflow-and-trace-contract.md',
  'release/upstreams.json','vendor/ace-rtl/LICENSE',
  'vendor/ace-rtl/skills/ace-rtl/scripts/ace_rtl_agent/context_builder.py',
  'vendor/ace-rtl/skills/ace-rtl/scripts/ace_rtl_agent/fresh_start_coordinator.py',
];
const LOCAL_DIRECTORIES=new Set(['node_modules','runtime','downloads','artifacts','output','.pi-state','.eda-state','.playwright-cli','gameboy','.xil','.agents']);
const SOURCE_DIRECTORIES=['src','scripts','tests','benchmarks','knowledge','examples','prompts','docs','results','web','.github','.pi/skills','.pi/extensions'];
const slash=value=>value.replaceAll('\\','/');
const privatePath=file=>{
  const normalized=file.toLowerCase();
  return LOCAL_DIRECTORIES.has(normalized.split('/')[0])||normalized.split('/').includes('.git')||
    ['.codex/config.toml','.pi/mcp.json','.pi/auth.json'].includes(normalized)||
    /(^|\/)\.env(?:\..*)?$/.test(normalized)&&!/(^|\/)\.env\.(example|template)$/.test(normalized)||
    /^projects\/(?:wb[^/]*\/|.*\/runs\/)/.test(normalized);
};
const validRelative=file=>typeof file==='string'&&file.length>0&&!path.isAbsolute(file)&&!path.win32.isAbsolute(file)&&!slash(file).split('/').some(piece=>['','..','.'].includes(piece)||/[:\x00-\x1f]/.test(piece)||/[. ]$/.test(piece));

function markdownTargets(text){
  // Code examples are not document navigation. Anchors and remote protocols are checked elsewhere.
  const prose=text.replace(/^\s*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\s*\1\s*$/gm,'').replace(/`[^`\n]*`/g,'');
  const targets=[];
  for(const match of prose.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g))targets.push(match[1]);
  for(const match of prose.matchAll(/^\s*\[[^\]\n]+\]:\s*(<[^>\n]*>|\S+)/gm))targets.push(match[1]);
  return targets;
}

export function checkRepository(root){
  root=path.resolve(root);
  const issues=[],warnings=[];
  const report={schema_version:1,root,scope:'source-only',tracked_check:false,files_checked:0,markdown_files:0,local_links:0,issues,warnings};
  const issue=(code,file,detail)=>issues.push({code,file,...(detail?{detail}:{})});
  let files=[];
  const manifest=path.join(root,'release/source-manifest.json');
  if(fs.existsSync(path.join(root,'.git'))){
    report.scope='git-index';report.tracked_check=true;
    const git=spawnSync('git',['-C',root,'ls-files','--stage','-z'],{encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024});
    if(git.status!==0||git.error)issue('git_inventory_failed','.git','Unable to read the Git index');
    else for(const entry of git.stdout.split('\0').filter(Boolean)){
      const match=entry.match(/^(\d+) [0-9a-f]+ (\d)\t([\s\S]+)$/);
      if(!match){issue('git_inventory_invalid','.git');continue;}
      const [,mode,stage,file]=match;files.push(file);
      if(mode==='160000')issue('gitlink',file,'Nested repository entries are not bundled source files');
      if(mode==='120000')issue('symlink',file,'Publish an explicit source file');
      if(stage!=='0')issue('unmerged_file',file);
    }
  }else if(fs.existsSync(manifest)){
    report.scope='export-manifest';
    try{
      const content=JSON.parse(fs.readFileSync(manifest,'utf8'));
      if(!content.files||typeof content.files!=='object'||Array.isArray(content.files))throw new Error('Invalid inventory');
      files=Object.keys(content.files);
    }catch{issue('manifest_invalid','release/source-manifest.json');}
  }else{
    warnings.push({code:'source_only',detail:'No Git index or export manifest; local source structure only, not a publication audit'});
    function walk(relative){
      const absolute=path.join(root,relative);
      if(!fs.existsSync(absolute))return;
      for(const entry of fs.readdirSync(absolute,{withFileTypes:true})){
        if(['.git','__pycache__','node_modules','runs','.Xil'].includes(entry.name))continue;
        const next=`${relative}/${entry.name}`;
        if(entry.isDirectory())walk(next);else if(entry.isFile())files.push(next);
      }
    }
    for(const directory of SOURCE_DIRECTORIES)walk(directory);
    files.push(...REQUIRED_FILES);
    for(const entry of fs.readdirSync(root,{withFileTypes:true}))if(entry.isFile()&&/\.md$/i.test(entry.name))files.push(entry.name);
  }
  files=[...new Set(files.map(slash))];
  const inventory=new Set(files.filter(validRelative));
  const published=report.scope!=='source-only';
  report.files_checked=inventory.size;
  for(const file of files){
    if(!validRelative(file)){issue('invalid_source_path',file);continue;}
    if(published&&privatePath(file))issue('private_file',file,'Local state or machine configuration must not be published');
    const absolute=path.join(root,file);
    if(!fs.existsSync(absolute)){issue('missing_file',file);continue;}
    const stat=fs.lstatSync(absolute);
    if(published&&stat.isSymbolicLink())issue('symlink',file);
    if(!stat.isFile())continue;
    if(!file.endsWith('.md')||file.startsWith('vendor/'))continue;
    report.markdown_files++;
    for(let target of markdownTargets(fs.readFileSync(absolute,'utf8'))){
      target=target.replace(/^<|>$/g,'');
      if(!target||target.startsWith('#')||target.startsWith('//'))continue;
      // Only relative file links are this check's responsibility.
      if(path.isAbsolute(target)||path.win32.isAbsolute(target)||/^[a-z][a-z\d+.-]*:/i.test(target))continue;
      target=target.split(/[?#]/,1)[0];
      try{target=decodeURIComponent(target);}catch{issue('invalid_link',file,'Invalid URL encoding');continue;}
      target=slash(target).replace(/:\d+(?::\d+)?$/,'');
      if(!target)continue;
      report.local_links++;
      const destination=path.resolve(path.dirname(absolute),target);
      const relative=slash(path.relative(root,destination));
      const outside=relative==='..'||relative.startsWith('../')||path.isAbsolute(relative);
      const exists=fs.existsSync(destination);
      const inInventory=inventory.has(relative)||[...inventory].some(item=>item.startsWith(`${relative}/`));
      if(!exists||published&&(outside||!inInventory))issue('broken_link',file,`Relative target is unavailable in ${published?'published source':'this workspace'}: ${target}`);
    }
  }
  for(const file of REQUIRED_FILES){
    if(!inventory.has(file))issue('required_file_unlisted',file);
    else if(!fs.existsSync(path.join(root,file))||!fs.lstatSync(path.join(root,file)).isFile())issue('required_file_missing',file);
  }
  try{
    if(JSON.parse(fs.readFileSync(path.join(root,'.eda/config.json'),'utf8')).model_api_enabled!==false)issue('model_api_gate','.eda/config.json','Repository defaults must disable other model APIs');
  }catch{issue('model_api_gate','.eda/config.json','Configuration is missing or invalid');}
  try{
    const pins=JSON.parse(fs.readFileSync(path.join(root,'release/upstreams.json'),'utf8')).sources;
    const ace=pins?.find(item=>item.name==='ace-rtl');
    if(!ace||ace.commit!==ACE_COMMIT||ace.bundled!==true)issue('ace_pin','release/upstreams.json','Bundled ACE-RTL must use the reviewed commit');
  }catch{issue('ace_pin','release/upstreams.json','Dependency manifest is missing or invalid');}
  report.passed=issues.length===0;
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const report=checkRepository(process.argv[2]||path.resolve(import.meta.dirname,'..'));
    console.log(JSON.stringify(report,null,2));
    if(!report.passed)process.exitCode=1;
  }catch{
    console.error(JSON.stringify({passed:false,error:'Unable to inspect repository structure; check the supplied root path'}));
    process.exitCode=1;
  }
}
