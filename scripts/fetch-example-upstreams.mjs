// Optional public RTL dependencies. Exact commit check; never reset an existing checkout.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=path.resolve(import.meta.dirname,'..');
const sources=JSON.parse(fs.readFileSync(path.join(root,'release/upstreams.json'),'utf8')).sources;
function git(args,cwd=root){const p=spawnSync('git',args,{cwd,encoding:'utf8',windowsHide:true});if(p.status!==0)throw new Error(p.stderr||'Git failed');return p.stdout.trim();}
for(const s of sources.filter(s=>!s.bundled)){
  const target=path.join(root,'vendor',s.name);
  if(fs.existsSync(target)){
    const head=git(['rev-parse','HEAD'],target);
    if(head!==s.commit)throw new Error(`${s.name}: existing checkout differs; preserved`);
  }else{
    fs.mkdirSync(target,{recursive:true});git(['init'],target);git(['remote','add','origin',s.url],target);
    git(['fetch','--depth','1','origin',s.commit],target);git(['checkout','--detach','FETCH_HEAD'],target);
  }
  console.log(`${s.name} ${s.commit}`);
}
