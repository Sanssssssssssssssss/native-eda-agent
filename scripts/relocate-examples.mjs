// Explicit relocation of historical inputs. New traces must record the changed hashes.
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const marker='E:/GPTProject2/EDAAgent';
const files=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,entry.name);
  if(entry.isDirectory()&&!['runs','__pycache__','.Xil'].includes(entry.name))walk(p);
  else if(entry.isFile()&&/\.(v|sv|svh|vh|tcl|json)$/.test(p)&&!/(latest|result|acceptance|initial-candidates)/.test(entry.name)){
    const text=fs.readFileSync(p,'utf8');if(text.includes(marker))files.push({p,text});
  }
}}
for(const name of ['fft-spectrum','system-bench','hard-bench','verilogeval-mini','verilogeval-24'])walk(path.join(root,'projects',name));
if(process.argv.includes('--apply')){
  const backup=fs.mkdtempSync(path.join(root,'artifacts/example-relocation-'));
  for(const {p,text} of files){const rel=path.relative(root,p);fs.mkdirSync(path.dirname(path.join(backup,rel)),{recursive:true});fs.copyFileSync(p,path.join(backup,rel));fs.writeFileSync(p,text.replaceAll(marker,root.replaceAll('\\','/')));}
  console.log(`Relocated ${files.length} files; backup: ${backup}. Historical hashes remain archival; new runs capture new inputs.`);
}else console.log(JSON.stringify({mode:'plan',files:files.map(x=>path.relative(root,x.p)),apply:'node scripts/relocate-examples.mjs --apply'}));
