// Read-only views of files explicitly captured by the verifier contract.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectAgentTask, taskDelivery, activeTaskContext} from './agent-task.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const source = /\.(?:v|sv|vh|svh|vhd|vhdl|xdc|sdc|tcl|c|h|s|ld|hex|mem)$/i;
function taskPath(id) {
  if (!/^agent-task-[0-9a-f-]{36}$/.test(id || '')) throw fail('Invalid task identifier');
  return `artifacts/${id}`;
}
function read(root, name) {
  if (typeof name !== 'string' || name.split('/').some(p => !p || p === '..' || p.startsWith('.')) || /[\\:\x00-\x1f]/.test(name)) throw fail('Invalid captured source path', 403);
  let file = fs.realpathSync(root);
  for (const part of name.split('/')) {
    file = path.join(file, part);
    if (fs.lstatSync(file).isSymbolicLink()) throw fail('Linked sources cannot be previewed', 403);
  }
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 1024 * 1024) throw fail('Source exceeds the 1 MiB preview limit', 413);
  const bytes = fs.readFileSync(file);
  if (bytes.length > 1024 * 1024 || bytes.includes(0)) throw fail('Source is not previewable text', 415);
  return {bytes, sha256: hash(bytes), text: new TextDecoder('utf-8', {fatal:true}).decode(bytes)};
}
export function taskFiles(root, id, registry) {
  const checked = inspectAgentTask(root, taskPath(id), registry);
  const editable = new Set(checked.contract.verification.editable_sources);
  const delivery=taskDelivery(root,taskPath(id),registry);
  let progress=null;
  if(delivery.status==='running') {
    // The open checkpoint is observational only. Never promote its verdict or
    // budget into the sealed delivery or recovery decision.
    try {
      const context=activeTaskContext(root,taskPath(id),registry);
      const budget=Object.fromEntries(Object.entries(context.budget).map(([key,value])=>[key,
        Number.isSafeInteger(value)&&value>=0?value:null]));
      progress={available:true,phase:context.phase,budget,observed_at:new Date().toISOString()};
    }catch {
      progress={available:false,observed_at:new Date().toISOString()};
    }
  }
  return {id, delivery, progress, files:Object.entries(checked.contract.mapping)
    .filter(([name]) => source.test(name)).map(([original,candidate]) => ({original,candidate,
      editable:editable.has(candidate), frozen_sha256:checked.contract.original.plan.input_hashes[original]}))};
}
export function readTaskSource(root, id, original, registry, {start_line=1,line_count=160}={}) {
  if (!Number.isSafeInteger(start_line) || start_line<1 || !Number.isSafeInteger(line_count) || line_count<1 || line_count>240) throw fail('Invalid source page');
  const task = taskFiles(root,id,registry), file = task.files.find(f => f.original===original);
  if (!file) throw fail('File is outside the captured source inventory',403);
  const before=read(root,file.original), after=read(root,file.candidate);
  const page = value => {
    const lines=value.text.replace(/\r\n/g,'\n').split('\n'); if(lines.at(-1)==='')lines.pop();
    let bytes=0;const rows=[];
    for(let i=start_line-1;i<Math.min(lines.length,start_line-1+line_count);i++) {
      bytes+=Buffer.byteLength(lines[i]);if(bytes>32*1024){if(!rows.length)throw fail('Source line exceeds the preview limit',413);break;}rows.push({number:i+1,text:lines[i]});
    }
    return {sha256:value.sha256,total_lines:lines.length,lines:rows};
  };
  const originalPage=page(before),candidatePage=page(after),end=Math.max(originalPage.lines.at(-1)?.number||0,candidatePage.lines.at(-1)?.number||0);
  if(start_line>Math.max(originalPage.total_lines,candidatePage.total_lines,1))throw fail('Source page is out of range',416);
  return {id,file,original:originalPage,candidate:candidatePage,start_line,
    next_line:end<Math.max(originalPage.total_lines,candidatePage.total_lines)?end+1:null,
    original_matches_frozen:before.sha256===file.frozen_sha256,changed:before.sha256!==after.sha256,
    scope:'Current original and candidate, aligned by line number. This is not a semantic diff or independent module verification.'};
}
export function projectTasks(root, project, registry) {
  const directory=path.join(root,'artifacts');if(!fs.existsSync(directory))return [];
  const entries=fs.readdirSync(directory,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&/^agent-task-[0-9a-f-]{36}$/.test(e.name))
    .sort((a,b)=>fs.statSync(path.join(directory,b.name)).mtimeMs-fs.statSync(path.join(directory,a.name)).mtimeMs).slice(0,80);
  const rows=[];
  for(const entry of entries) {
    let belongs=false;
    try {
      const contractFile=path.join(directory,entry.name,'task-contract.json');
      if(fs.lstatSync(contractFile).isSymbolicLink()||fs.statSync(contractFile).size>8*1024*1024)continue;
      const contract=JSON.parse(fs.readFileSync(contractFile,'utf8'));
      if(!Object.keys(contract.mapping||{}).some(name=>name.startsWith(project+'/')))continue;
      belongs=true;
      rows.push({id:entry.name,...taskFiles(root,entry.name,registry).delivery});
    }catch {
      if(belongs)rows.push({id:entry.name,goal:'任务证据需复核',status:'invalid',rounds:0,calls:0,
        task_acceptance:{status:'unknown'},issues:['Task contract or captured inputs could not be inspected.']});
    }
    if(rows.length===8)break;
  }
  return rows;
}
