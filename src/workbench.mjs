import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {readConfig} from './runtime.mjs';
import {loadResults} from './results.mjs';
import {querySop} from './knowledge.mjs';
import {taskContext} from './task-context.mjs';
import {inspectTrace} from '../scripts/trace-inspect.mjs';
import {inspectWorkflow} from './workflow.mjs';
import {evaluationSuites,evaluationPlan,runEvaluation,evaluationFreshness} from './evaluations.mjs';
const safeId=value=>typeof value==='string'&&/^[a-zA-Z0-9._-]{1,200}$/.test(value);
function read(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function contained(base,id){
  if(!safeId(id))throw new Error('Invalid run identifier');
  const p=fs.realpathSync(path.join(base,id)),rel=path.relative(fs.realpathSync(base),p);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Run outside workspace');return p;
}
export function createWorkbench(root,registry){
  const artifacts=path.join(root,'artifacts'),sessions=path.join(root,'.eda-state/workbench-sessions'),jobs=new Map(),busySessions=new Set();
  fs.mkdirSync(artifacts,{recursive:true});fs.mkdirSync(sessions,{recursive:true});
  const files={ '/':['index.html','text/html'], '/app.js':['app.js','text/javascript'], '/style.css':['style.css','text/css'] };
  const specimens=['offline-review','counter-simulation','axi-fabric-ooc'];
  const runList=()=>fs.readdirSync(artifacts,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&fs.existsSync(path.join(artifacts,e.name,'run.json')))
    .map(e=>{try{const m=read(path.join(artifacts,e.name,'run.json'));return {id:e.name,tool:m.tool||m.mode,status:m.status,started_at:m.started_at||m.startedAt,workflow:fs.existsSync(path.join(artifacts,e.name,'workflow.json')),pi_session:m.mode==='pi-sdk-agent'};}catch{return null;}})
    .filter(Boolean).sort((a,b)=>(b.started_at||'').localeCompare(a.started_at||'')).slice(0,160);
  const sessionList=()=>fs.readdirSync(sessions,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()).map(e=>{try{const s=read(path.join(sessions,e.name,'session.json'));return {id:s.id,title:s.title,updated_at:s.updated_at,mode:s.mode};}catch{return null;}}).filter(Boolean).sort((a,b)=>b.updated_at.localeCompare(a.updated_at));
  async function body(req){let value='';for await(const chunk of req){value+=chunk;if(Buffer.byteLength(value)>32768)throw new Error('Request exceeds 32 KiB');}return JSON.parse(value||'{}');}
  function startJob(kind,execute){const id=randomUUID(),controller=new AbortController(),job={id,kind,status:'running',started_at:new Date().toISOString(),controller};jobs.set(id,job);
    Promise.resolve().then(()=>execute(controller.signal)).then(result=>{job.result=result;job.status=result.status||'completed';},error=>{job.status=controller.signal.aborted?'cancelled':'failed';job.error=error.message;}).finally(()=>{job.finished_at=new Date().toISOString();});
    return {id,kind,status:job.status};
  }
  const server=http.createServer(async(req,res)=>{
    const address=server.address(),origin=`http://127.0.0.1:${address.port}`;
    const send=(status,value,type='application/json')=>{res.writeHead(status,{'Content-Type':`${type}; charset=utf-8`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"});res.end(type==='application/json'?JSON.stringify(value):value);};
    try{
      if(req.headers.host!==`127.0.0.1:${address.port}`||req.headers.origin&&req.headers.origin!==origin)return send(403,{error:'Local same-origin access required'});
      const url=new URL(req.url,origin),route=url.pathname;
      if(req.method==='GET'&&files[route]){const [file,type]=files[route];return send(200,fs.readFileSync(path.join(root,'web/workbench',file),'utf8'),type);}
      if(req.method==='GET'&&route==='/api/overview')return send(200,{config:{model_api_enabled:readConfig(root).model_api_enabled},runs:runList(),sessions:sessionList(),sops:querySop(root).sops,specimens,suites:evaluationSuites,history:loadResults(root).records.map(({evidence,...r})=>({...r,evidence_count:evidence.length}))});
      if(req.method==='GET'&&route==='/api/run'){
        const dir=contained(artifacts,url.searchParams.get('id')),m=read(path.join(dir,'run.json'));
        let workflow=null;try{if(fs.existsSync(path.join(dir,'workflow.json'))){const {state,results,...r}=inspectWorkflow(root,dir);workflow={...r,goal:state.plan.spec.goal,steps:state.plan.spec.steps.map(s=>({id:s.id,tool:s.tool})),guidance:state.plan.guidance};}}catch(error){workflow={valid:false,error:error.message};}
        const eventsFile=path.join(dir,'events.jsonl'),events=fs.existsSync(eventsFile)?fs.readFileSync(eventsFile,'utf8').trim().split(/\r?\n/).slice(-100).flatMap(line=>{try{const e=JSON.parse(line);return [{seq:e.seq||e.sequence,type:e.type,time:e.timestamp_utc,tool:e.tool||e.tool_name||e.toolName,step:e.step_id,status:e.status}];}catch{return [];}}):[];
        const prompt=m.mode==='pi-sdk-agent'&&fs.existsSync(path.join(dir,'prompt.txt'))?fs.readFileSync(path.join(dir,'prompt.txt'),'utf8').slice(0,8000):null;
        return send(200,{id:path.basename(dir),manifest:{tool:m.tool||m.mode,status:m.status,started_at:m.started_at||m.startedAt,finished_at:m.finished_at||m.endedAt},inspection:inspectTrace(dir),workflow,events,prompt});
      }
      if(req.method==='GET'&&route==='/api/session')return send(200,read(path.join(contained(sessions,url.searchParams.get('id')),'session.json')));
      if(req.method==='GET'&&route==='/api/evaluations'){
        const receipts=fs.readdirSync(artifacts,{withFileTypes:true}).filter(e=>e.isDirectory()&&!e.isSymbolicLink()&&e.name.startsWith('evaluation-')).flatMap(e=>{try{const receipt=read(path.join(artifacts,e.name,'result.json'));return [{...receipt,freshness:evaluationFreshness(root,receipt),id:e.name}];}catch{return [];}}).sort((a,b)=>b.started_at.localeCompare(a.started_at));
        return send(200,{suites:evaluationSuites.map(s=>evaluationPlan(root,s.id)),receipts});
      }
      if(req.method==='GET'&&route==='/api/job'){const j=jobs.get(url.searchParams.get('id'));if(!j)return send(404,{error:'Unknown job'});const {controller,...data}=j;return send(200,data);}
      if(req.method!=='POST')return send(404,{error:'Unknown route'});
      if(req.headers.origin!==origin)return send(403,{error:'POST requires same-origin browser request'});
      const data=await body(req);
      if(route==='/api/context')return send(200,await registry.get('eda_task_context').execute(`ui-${randomUUID()}`,data).then(r=>r.details));
      if(route==='/api/sop')return send(200,querySop(root,{id:data.id}));
      if(route==='/api/session'){
        if(typeof data.message!=='string'||!data.message.trim()||data.message.length>2048)throw new Error('Enter a task of 1–2048 characters');
        const id=data.id||randomUUID(),dir=data.id?contained(sessions,id):path.join(sessions,id);fs.mkdirSync(dir,{recursive:true});
        if(busySessions.has(id))return send(409,{error:'This session has an unfinished request; wait before sending another message'});
        busySessions.add(id);
        try{
        const file=path.join(dir,'session.json'),s=fs.existsSync(file)?read(file):{id,title:data.message.slice(0,60),mode:'local_context',messages:[]};
        const save=()=>{const pending=path.join(dir,`${randomUUID()}.tmp`);fs.writeFileSync(pending,JSON.stringify(s,null,2));fs.renameSync(pending,file);};
        if(s.messages.length>=100)throw new Error('Session limit reached; create a new session');
        s.messages.push({role:'user',text:data.message,at:new Date().toISOString()});s.updated_at=new Date().toISOString();save();
        try{const context=await registry.get('eda_task_context').execute(`ui-${randomUUID()}`,{query:data.message,...(data.phase?{phase:data.phase}:{}),...(data.directory?{directory:data.directory}:{})});s.messages.push({role:'context',context:context.details,at:new Date().toISOString()});}catch(error){s.messages.push({role:'error',text:error.message,at:new Date().toISOString()});}
        s.updated_at=new Date().toISOString();save();return send(200,s);
        }finally{busySessions.delete(id);}
      }
      if(route==='/api/workflow'){
        if(!specimens.includes(data.spec)||!['plan','run'].includes(data.action))throw new Error('Choose a known task and action');
        const args={spec:`examples/workflows/${data.spec}.json`};
        if(data.action==='plan')return send(200,(await registry.get('eda_workflow_plan').execute(`ui-${randomUUID()}`,args)).details);
        return send(202,startJob(`workflow:${data.spec}`,signal=>registry.get('eda_workflow_run').execute(`ui-${randomUUID()}`,args,signal).then(r=>r.details)));
      }
      if(route==='/api/evaluate')return send(202,startJob(`evaluation:${data.suite}`,signal=>runEvaluation(root,data.suite,registry,{signal,session_directory:data.session_directory,workflow_directory:data.workflow_directory})));
      if(route==='/api/cancel'){const job=jobs.get(data.id);if(!job)throw new Error('Unknown owned job');job.controller.abort();return send(200,{cancel_requested:true});}
      return send(404,{error:'Unknown route'});
    }catch(error){send(400,{error:error.message});}
  });
  return {server,close:()=>{for(const j of jobs.values())j.controller.abort();return new Promise(resolve=>server.close(resolve));}};
}
