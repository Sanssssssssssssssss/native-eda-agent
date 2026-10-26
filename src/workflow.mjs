// Sequential EDA task contracts. No model client; every resumed execution gets a new trace.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {createTrace,validateTraceEvent} from './trace.mjs';
import {createRunState, listRuns, pidAlive} from './runtime.mjs';
import {validateArguments} from './tool-contracts.mjs';
import {inspectTrace} from '../scripts/trace-inspect.mjs';
import {resolveGuidance} from './knowledge.mjs';
import {acceptanceSchema,compileAcceptance,evaluateTask,recoveryAdvice} from './task-outcome.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const hashFile=file=>digest(fs.readFileSync(file));
const str={type:'string',minLength:1,maxLength:2048};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const checkSchema=object({pointer:str,op:{enum:['eq','gte','lte'],type:'string'},value:{}},['pointer','op','value']);
export const workflowSchema=object({schema_version:{type:'integer',enum:[1]},id:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,63}$'},goal:str,
  inputs:{type:'array',items:str,minItems:1,maxItems:256,uniqueItems:true},
  guidance:object({rule_ids:{type:'array',items:str,uniqueItems:true,maxItems:40},sop_ids:{type:'array',items:str,uniqueItems:true,maxItems:16}}),
  acceptance:acceptanceSchema,
  limits:object({max_calls:{type:'integer',minimum:1,maximum:100},wall_seconds:{type:'integer',minimum:1,maximum:14400}},['max_calls','wall_seconds']),
  steps:{type:'array',minItems:1,maxItems:32,items:object({id:{type:'string',pattern:'^[a-z][a-z0-9_-]{0,63}$'},tool:str,args:{type:'object'},checks:{type:'array',items:checkSchema,minItems:1,maxItems:32}},['id','tool','args','checks'])}
},['schema_version','id','goal','inputs','limits','steps']);
export const offlineWorkflowTools=new Set(['eda_preflight','eda_knowledge','eda_sop','eda_results_get','eda_results_verify']);
const allowed=name=>offlineWorkflowTools.has(name)||['eda_xsim','eda_vivado_synthesize','eda_vivado_implement','eda_vivado_reports','eda_vivado_objects','eda_vivado_timing_paths','eda_vivado_catalog'].includes(name)||/^eda_vivado_(report_|query_|find_|setup_paths$|hold_paths$)/.test(name);
const relative=(root,file)=>path.relative(root,file).replaceAll('\\','/');
function inside(root,name,{artifacts=false}={}){
  if(typeof name!=='string'||!name||/[\0\r\n]/.test(name))throw new Error('Invalid workflow path');
  const base=fs.realpathSync(artifacts?path.join(root,'artifacts'):root);
  const target=fs.realpathSync(path.resolve(root,name)),rel=path.relative(base,target);
  if(!rel||rel==='..'||rel.startsWith(`..${path.sep}`)||path.isAbsolute(rel))throw new Error('Workflow path escapes its workspace');
  if(/(?:^|[\\/])(?:\.git|\.pi-state|node_modules|\.env(?:\.[^\\/]*)?|auth\.json|credentials[^\\/]*)(?:$|[\\/])/i.test(rel))throw new Error('Private path is not a workflow input');
  return target;
}
export function pointerValue(value,pointer){
  if(typeof pointer!=='string'||!pointer.startsWith('/')||/~(?![01])/g.test(pointer))throw new Error('Expected an RFC 6901 JSON pointer');
  for(const segment of pointer.slice(1).split('/').map(s=>s.replaceAll('~1','/').replaceAll('~0','~'))){
    if(['__proto__','prototype','constructor'].includes(segment)||value===null||typeof value!=='object'||!Object.hasOwn(value,segment))throw new Error(`Missing result field: ${pointer}`);
    value=value[segment];
  }
  return value;
}
export function evaluateChecks(result,checks){
  return checks.map(check=>{
    try{
      const actual=pointerValue(result,check.pointer);
      const passed=check.op==='eq'?isDeepStrictEqual(actual,check.value):Number.isFinite(actual)&&Number.isFinite(check.value)&&(check.op==='gte'?actual>=check.value:actual<=check.value);
      return {...check,actual,passed};
    }catch(error){return {...check,passed:false,error:error.message};}
  });
}
function refs(value,visit){
  if(Array.isArray(value))return value.map(v=>refs(v,visit));
  if(value&&typeof value==='object'){
    if(Object.hasOwn(value,'$result')){
      validateArguments(value,object({$result:object({step:str,pointer:str},['step','pointer'])},['$result']));
      return visit(value.$result);
    }
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,refs(v,visit)]));
  }
  return value;
}
function validateTemplate(value,schema){
  if(value&&typeof value==='object'&&Object.hasOwn(value,'$result'))return;
  if(schema.type==='object'){
    validateArguments(value,{...schema,properties:Object.fromEntries(Object.keys(schema.properties||{}).map(k=>[k,{}]))});
    for(const [k,v]of Object.entries(value))if(schema.properties?.[k])validateTemplate(v,schema.properties[k]);
  }else if(schema.type==='array'){
    validateArguments(value,{...schema,items:{}});value.forEach(v=>validateTemplate(v,schema.items));
  }else validateArguments(value,schema);
}
function inputFiles(root,args){
  const names=[...(Array.isArray(args.sources)?args.sources:[]),...(Array.isArray(args.constraints)?args.constraints:[]),...(Array.isArray(args.constraint_scripts)?args.constraint_scripts:[]),args.checkpoint].filter(v=>typeof v==='string');
  // Includes are declared as directories; hash their file contents to detect header drift.
  for(const dir of args.include_dirs||[]){
    if(typeof dir!=='string')throw new Error('include_dirs must be literal directories');
    const base=inside(root,dir);
    const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){
      if(e.isSymbolicLink())throw new Error('Symlink in include directory');
      const p=path.join(d,e.name);if(e.isDirectory())walk(p);else names.push(p);
      if(names.length>1024)throw new Error('Too many workflow input files');
    }};walk(base);
  }
  return names;
}
function codeHashes(root){
  const files=[];
  const walk=d=>{if(!fs.existsSync(d))return;for(const e of fs.readdirSync(d,{withFileTypes:true})){
    const f=path.join(d,e.name);if(e.isDirectory()&&e.name!=='__pycache__')walk(f);else if(e.isFile()&&/\.(mjs|ts|py|tcl)$/.test(e.name))files.push(f);
  }};walk(path.join(root,'src'));
  for(const name of ['package.json','package-lock.json','.eda/config.json','scripts/trace-inspect.mjs',
    'scripts/ace-rtl-feedback.py',
    'vendor/ace-rtl/skills/ace-rtl/scripts/ace_rtl_agent/context_builder.py',
    'vendor/ace-rtl/skills/ace-rtl/scripts/ace_rtl_agent/fresh_start_coordinator.py'])if(fs.existsSync(path.join(root,name)))files.push(path.join(root,name));
  return Object.fromEntries(files.sort().map(f=>[relative(root,f),hashFile(f)]));
}
export function planWorkflow(root,specFile,registry){
  const file=inside(root,specFile);if(fs.statSync(file).size>1024*1024)throw new Error('Workflow spec exceeds 1 MiB');
  const spec=json(file);validateArguments(spec,workflowSchema);
  const seen=new Set(),inputs=new Set(),bindings={},includeDirs=new Set();
  const capture=name=>{const resolved=inside(root,name);inputs.add(resolved);bindings[relative(root,path.resolve(root,name))]=relative(root,resolved);};
  capture(specFile);spec.inputs.forEach(capture);
  const acceptance=compileAcceptance(spec);
  const guidance=spec.guidance||acceptance?resolveGuidance(root,{rule_ids:spec.guidance?.rule_ids||[],sop_ids:[...new Set([...(spec.guidance?.sop_ids||[]),...(acceptance?.sop_ids||[])])]}):null;
  if(guidance)Object.keys(guidance.input_hashes).forEach(capture);
  for(const step of spec.steps){
    if(seen.has(step.id))throw new Error(`Duplicate workflow step: ${step.id}`);
    if(!allowed(step.tool)||!registry.has(step.tool))throw new Error(`Unsupported workflow tool: ${step.tool}`);
    refs(step.args,ref=>{if(!seen.has(ref.step))throw new Error('Result references must name an earlier step');if(!ref.pointer.startsWith('/'))throw new Error('Invalid result pointer');return ref;});
    // Only the referenced value's type is deferred; static siblings and hidden fields still validate.
    validateTemplate(step.args,registry.get(step.tool).parameters);
    for(const f of inputFiles(root,step.args))capture(f);
    for(const dir of step.args.include_dirs||[])includeDirs.add(dir);
    for(const check of step.checks){if(!check.pointer.startsWith('/'))throw new Error('Invalid check pointer');if(check.op!=='eq'&&!Number.isFinite(check.value))throw new Error('Numeric check requires a finite threshold');}
    seen.add(step.id);
  }
  return {schema_version:1,spec_path:relative(root,file),spec,spec_sha256:hashFile(file),input_hashes:Object.fromEntries([...inputs].sort().map(f=>{
    if(!fs.statSync(f).isFile())throw new Error('Workflow inputs must be files');return [relative(root,f),hashFile(f)];
  })),input_bindings:bindings,include_directories:[...includeDirs].map(dir=>({path:dir,files:inputFiles(root,{include_dirs:[dir]}).map(f=>relative(root,f)).sort()})),
    code_hashes:codeHashes(root),guidance,acceptance,execution_requires_eda:spec.steps.some(s=>!offlineWorkflowTools.has(s.tool)),launches_eda:false,mode:'plan',model_api_calls:0};
}
function durableWrite(file,bytes){const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
function checkpoint(trace,state){
  fs.mkdirSync(path.join(trace.directory,'checkpoints'),{recursive:true});
  const name=`checkpoints/${String(++state.sequence).padStart(5,'0')}.json`,bytes=JSON.stringify(state,null,2)+'\n';
  durableWrite(path.join(trace.directory,name),bytes);
  const pointer={schema_version:1,path:name,sha256:digest(bytes)};
  trace.event('workflow_checkpoint',pointer);
  const pending=path.join(trace.directory,`workflow.${randomUUID()}.tmp`);
  durableWrite(pending,JSON.stringify(pointer,null,2));fs.renameSync(pending,path.join(trace.directory,'workflow.json'));
}
function readWorkflow(root,directory){
  directory=inside(root,directory,{artifacts:true});
  const p=json(path.join(directory,'workflow.json'));
  if(p.schema_version!==1||!/^checkpoints\/\d{5}\.json$/.test(p.path))throw new Error('Invalid workflow checkpoint pointer');
  const file=inside(directory,p.path);
  if(hashFile(file)!==p.sha256)throw new Error('Workflow checkpoint hash mismatch');
  const text=fs.readFileSync(path.join(directory,'events.jsonl'),'utf8'),lines=text.split(/\r?\n/).filter(Boolean);
  let committed=false;
  for(let i=0;i<lines.length;i++){
    let e;try{e=JSON.parse(lines[i]);}catch{if(i===lines.length-1&&!text.endsWith('\n'))break;throw new Error('Malformed workflow event');}
    if(validateTraceEvent(e,{expectedSeq:i+1,runId:path.basename(directory),requireSpans:true}).length)throw new Error('Invalid workflow event sequence or metadata');
    if(e.type==='workflow_checkpoint'&&e.path===p.path&&e.sha256===p.sha256)committed=true;
  }
  if(!committed)throw new Error('Workflow checkpoint lacks committed event');
  const state=json(file);
  if(state.schema_version!==1||state.run_id!==path.basename(directory))throw new Error('Workflow identity mismatch');
  return {state,directory};
}
function frozenIssues(root,plan){
  const issues=[];
  for(const [name,target]of Object.entries(plan.input_bindings)){
    try{if(relative(root,inside(root,name))!==target)issues.push(`input_redirected:${name}`);}catch{issues.push(`input_missing:${name}`);}
  }
  for(const dir of plan.include_directories){
    try{if(!isDeepStrictEqual(inputFiles(root,{include_dirs:[dir.path]}).map(f=>relative(root,f)).sort(),dir.files))issues.push(`include_contents_changed:${dir.path}`);}catch{issues.push(`include_unavailable:${dir.path}`);}
  }
  for(const [name,sha]of Object.entries(plan.input_hashes)){
    try{if(hashFile(inside(root,name))!==sha)issues.push(`input_changed:${name}`);}catch{issues.push(`input_missing:${name}`);}
  }
  if(!isDeepStrictEqual(codeHashes(root),plan.code_hashes))issues.push('implementation_changed');
  return issues;
}
function verifyStep(root,record,spec,{requireChecks=true}={}){
  const file=inside(root,record.result_path,{artifacts:true});
  if(hashFile(file)!==record.result_sha256)throw new Error('Committed step result changed');
  const result=json(file),checks=evaluateChecks(result,spec.checks);
  if(result.status!=='completed'||requireChecks&&checks.some(c=>!c.passed))throw new Error('Committed step no longer satisfies its checks');
  const inspected=inspectTrace(inside(root,record.child_directory,{artifacts:true}));
  if(!inspected.valid||inspected.input_drift||inspected.status!=='completed')throw new Error('Committed child trace is incomplete or drifted');
  for(const [file,sha]of Object.entries(record.artifact_hashes))if(hashFile(inside(root,file,{artifacts:true}))!==sha)throw new Error('Committed child artifact changed');
  return result;
}
const failureLogLimit=6*1024;
function failedChild(root,workflowDirectory,state,record){
  const step=state.plan.spec.steps.find(step=>step.id===record.step);
  if(!step||step.tool!==record.tool)throw new Error('Failed tool does not match its workflow step');
  const child=inside(root,record.child_directory,{artifacts:true});
  const receiptPath=inside(child,'receipt.json');
  if(inside(root,record.receipt_path,{artifacts:true})!==receiptPath||hashFile(receiptPath)!==record.receipt_sha256)throw new Error('Failed child receipt changed');
  const receipt=json(receiptPath),inspection=inspectTrace(child,{checkCurrent:true});
  const parent=json(inside(workflowDirectory,'run.json'));
  if(!inspection.valid||inspection.input_drift||!['failed','timed_out','cancelled'].includes(inspection.status))throw new Error('Failed child trace is incomplete, drifted or not a failure');
  if(inspection.tool!==record.tool||inspection.context?.parent_run_id!==state.run_id||inspection.trace_id!==parent.trace_id||inspection.parent_span_id!==parent.span_id)
    throw new Error('Failed trace is not a causal child of this workflow');
  if(receipt.status!==inspection.status||receipt.run_id!==inspection.run_id||receipt.context?.parent_run_id!==state.run_id||receipt.trace_id!==inspection.trace_id||receipt.span_id!==inspection.span_id||inside(root,receipt.directory,{artifacts:true})!==child)
    throw new Error('Failure receipt disagrees with its original child trace');
  return {child,receipt};
}
function failureLogTail(child){
  const file=inside(child,'process.log'),fd=fs.openSync(file,'r');
  try{
    const stat=fs.fstatSync(fd);if(!stat.isFile())throw new Error('Child process log must be a file');
    const size=Math.min(stat.size,failureLogLimit),bytes=Buffer.alloc(size);
    let read=0;while(read<size){const count=fs.readSync(fd,bytes,read,size-read,stat.size-size+read);if(!count)throw new Error('Child process log changed while reading');read+=count;}
    return {bytes,total_bytes:stat.size};
  }finally{fs.closeSync(fd);}
}
function captureToolFailure(root,trace,state,receipt){
  const step=state.plan.spec.steps.find(step=>step.id===state.current_step);
  const child=inside(root,receipt?.directory,{artifacts:true}),receiptPath=inside(child,'receipt.json');
  if(!isDeepStrictEqual(receipt,json(receiptPath)))throw new Error('Thrown failure receipt differs from original evidence');
  const record={step:step.id,tool:step.tool,child_directory:relative(root,child),receipt_path:relative(root,receiptPath),receipt_sha256:hashFile(receiptPath)};
  failedChild(root,trace.directory,state,record);
  const tail=failureLogTail(child),file=path.join(trace.directory,`${step.id}.failure-diagnostic.log`);
  durableWrite(file,tail.bytes);
  return {...record,diagnostic_path:relative(root,file),diagnostic_sha256:digest(tail.bytes),diagnostic_bytes:tail.bytes.length,
    source_log_bytes:tail.total_bytes,diagnostic_truncated:tail.total_bytes>tail.bytes.length,
    diagnostic_scope:'Frozen child process.log tail only; diagnostic hints never satisfy engineering acceptance.'};
}
function verifyToolFailure(root,workflowDirectory,state){
  const record=state.failed_tool,{child}=failedChild(root,workflowDirectory,state,record);
  const diagnostic=inside(workflowDirectory,`${record.step}.failure-diagnostic.log`);
  if(inside(root,record.diagnostic_path,{artifacts:true})!==diagnostic||fs.statSync(diagnostic).size>failureLogLimit||hashFile(diagnostic)!==record.diagnostic_sha256)
    throw new Error('Frozen failure diagnostic changed');
  const tail=failureLogTail(child);
  if(tail.total_bytes!==record.source_log_bytes||tail.bytes.length!==record.diagnostic_bytes||digest(tail.bytes)!==record.diagnostic_sha256)
    throw new Error('Original failure diagnostic changed');
  return fs.readFileSync(diagnostic,'utf8');
}
export function inspectWorkflow(root,directory,{resume=false}={}){
  const {state,directory:dir}=readWorkflow(root,directory),issues=frozenIssues(root,state.plan),results={};
  // A hard crash can leave elapsed time after the last checkpoint unknown. Charge
  // that whole wall interval conservatively, including time awaiting recovery.
  let spent=state.spent_ms,uncheckpointed=0;
  if(state.status==='running'){
    const saved=Date.parse(state.checkpoint_at);
    if(!Number.isFinite(saved))issues.push('missing_budget_timestamp');
    else {uncheckpointed=Math.max(0,Date.now()-saved);spent+=uncheckpointed;}
  }
  if(state.passed.length>state.plan.spec.steps.length)issues.push('invalid_step_count');
  for(let i=0;i<state.passed.length;i++){
    const record=state.passed[i],step=state.plan.spec.steps[i];
    try{if(record.id!==step.id)throw new Error('Steps are not a committed prefix');results[step.id]=verifyStep(root,record,step);}catch(e){issues.push(`${record.id}:${e.message}`);}
  }
  let failureDiagnostic=null;
  if(state.failed_step){
    try{
      const result=verifyStep(root,state.failed_step,state.plan.spec.steps.find(s=>s.id===state.failed_step.id),{requireChecks:false});
      results[state.failed_step.id]=result;
      // XSim can exit normally after a checker Fatal. Its committed result is
      // already hash-checked above; reuse the captured transcript as repair hints.
      if(typeof result.transcript_tail==='string')failureDiagnostic=Buffer.from(result.transcript_tail,'utf8').subarray(-failureLogLimit).toString('utf8');
    }catch(e){issues.push(`failed_evidence:${e.message}`);}
  }
  if(state.failed_tool){try{failureDiagnostic=verifyToolFailure(root,dir,state);}catch(error){issues.push(`failed_tool_evidence:${error.message}`);}}
  if(state.failed_tool_rejected)issues.push(`failed_tool_rejected:${state.failed_tool_rejected}`);
  if(state.task_acceptance_hash){try{if(hashFile(inside(dir,'task-outcome.json'))!==state.task_acceptance_hash)issues.push('task_outcome_changed');}catch{issues.push('task_outcome_missing');}}
  const taskAcceptance=evaluateTask(state.plan.acceptance,results,[...state.passed,...(state.failed_step?[state.failed_step]:[])],issues);
  const recovery=recoveryAdvice({...state,task_acceptance:taskAcceptance},issues);
  if(resume){
    if(state.outcome==='passed')issues.push('already_completed');
    if(state.status==='running'&&pidAlive(state.owner_pid)!==false)issues.push('owner_may_be_alive');
    for(const run of listRuns(root).filter(r=>r.context?.parent_run_id===state.run_id)){
      const manifestFile=path.join(run.directory,'run.json');const m=fs.existsSync(manifestFile)?json(manifestFile):null;
      if(!m)issues.push('child_manifest_missing');
      else if((m.status==='running'&&pidAlive(run.pid)!==false)||(m.processes||[]).some(p=>!p.ended_at&&pidAlive(p.pid)!==false))issues.push('child_may_be_alive');
    }
    if(state.calls>=state.plan.spec.limits.max_calls||spent>=state.plan.spec.limits.wall_seconds*1000)issues.push('budget_exhausted');
    if(recovery.stalled)issues.push('repeated_failure_requires_diagnosis');
    if(state.passed.length===state.plan.spec.steps.length&&state.outcome!=='passed')issues.push('all_steps_done_review_goal_before_new_task');
  }
  if(issues.length)failureDiagnostic=null;
  return {schema_version:1,directory:dir,run_id:state.run_id,status:state.status,outcome:state.outcome,valid:issues.length===0,ready:resume?issues.length===0:undefined,
    issues,completed_steps:state.passed.map(s=>s.id),child_evidence:state.passed.map(s=>({step:s.id,directory:s.child_directory,result:s.result_path})),next_step:state.plan.spec.steps[state.passed.length]?.id||null,calls:state.calls,spent_ms:spent,uncheckpointed_wall_ms:uncheckpointed,
    task_acceptance:taskAcceptance,recovery,failure_diagnostic:failureDiagnostic,
    failure_diagnostic_scope:'Verified failed-tool log or committed result transcript tail for repair hints only; never acceptance evidence.',
    boundary:'Checks cover the declared workflow only. No formal proof, CDC waiver or board signoff is inferred.',state,results};
}
async function executeWorkflow(root,registry,trace,args,signal,update,resuming){
  const prior=resuming?inspectWorkflow(root,args.directory,{resume:true}):null;
  if(prior&&!prior.ready)throw new Error(`Workflow cannot resume: ${prior.issues.join(', ')}`);
  if(prior&&!isDeepStrictEqual(planWorkflow(root,prior.state.plan.spec_path,registry),prior.state.plan))throw new Error('Recovery plan differs from the current frozen spec');
  const plan=prior?.state.plan||planWorkflow(root,args.spec,registry),results=prior?.results||{};
  const state={schema_version:1,run_id:trace.manifest.run_id,owner_pid:process.pid,status:'running',outcome:null,sequence:0,plan,
    calls:prior?.state.calls||0,spent_ms:prior?.spent_ms||0,passed:[...(prior?.state.passed||[])],failure_history:[...(prior?.state.failure_history||[])],resume_from:prior?.directory||null};
  const runtime=createRunState(root,trace);runtime.transition('preflight');runtime.transition('snapshotting');
  for(const file of [...Object.keys(plan.input_hashes),...Object.keys(plan.code_hashes)])trace.capture(path.join(root,file),'workflow_input');
  trace.finalizeDependencies();runtime.transition('waiting');runtime.transition('running');
  const controller=new AbortController(),started=performance.now(),spentBefore=state.spent_ms;
  const abort=()=>controller.abort(signal?.reason||new Error('Workflow cancelled'));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  let deadline=false;
  const timer=setTimeout(()=>{deadline=true;controller.abort(new Error('Workflow wall-time budget exhausted'));},Math.max(1,plan.spec.limits.wall_seconds*1000-spentBefore));
  const persist=()=>{state.spent_ms=spentBefore+Math.round(performance.now()-started);state.checkpoint_at=new Date().toISOString();checkpoint(trace,state);};
  try{
    persist();
    for(const step of plan.spec.steps.slice(state.passed.length)){
      controller.signal.throwIfAborted();
      if(state.calls>=plan.spec.limits.max_calls){state.outcome='budget_exhausted';throw new Error('Workflow call budget exhausted');}
      const drift=frozenIssues(root,plan);if(drift.length){state.outcome='input_or_code_changed';throw new Error(drift.join(', '));}
      const callArgs=refs(step.args,ref=>pointerValue(results[ref.step],ref.pointer));
      validateArguments(callArgs,registry.get(step.tool).parameters);
      state.current_step=step.id;state.calls++;persist();trace.event('workflow_step_start',{step_id:step.id,tool:step.tool});
      const response=await registry.get(step.tool).execute(`workflow-${randomUUID()}`,callArgs,controller.signal,update,{edaTraceContext:{trace_id:trace.manifest.trace_id,parent_span_id:trace.manifest.span_id,parent_run_id:state.run_id}});
      controller.signal.throwIfAborted();
      const result=response.details;
      if(response.isError||!result)throw new Error('Child tool failed or returned no structured result');
      const child=inside(root,result.directory||result.evidence,{artifacts:true}),inspection=inspectTrace(child);
      if(!inspection.valid||inspection.status!=='completed'||inspection.input_drift)throw new Error('Child trace is incomplete or input drift was detected');
      // Platform tools return evidence but no status; the child trace is authoritative.
      const normalized={...result,status:inspection.status};
      const file=path.join(trace.directory,`${step.id}.result.json`),bytes=JSON.stringify(normalized,null,2)+'\n';durableWrite(file,bytes);
      const checks=evaluateChecks(normalized,step.checks);
      const artifacts=Object.values(normalized.fpga?.artifacts||{}).map(f=>inside(root,f,{artifacts:true}));
      const record={id:step.id,tool:step.tool,result_path:relative(root,file),result_sha256:digest(bytes),child_directory:relative(root,child),
        artifact_hashes:Object.fromEntries(artifacts.map(f=>[relative(root,f),hashFile(f)])),checks};
      const driftAfter=frozenIssues(root,plan);if(driftAfter.length){state.outcome='input_or_code_changed';throw new Error(driftAfter.join(', '));}
      if(checks.some(c=>!c.passed)){state.failed_step=record;state.outcome='checks_failed';throw new Error(`Acceptance failed: ${step.id}`);}
      state.passed.push(record);results[step.id]=normalized;delete state.current_step;persist();trace.event('workflow_step_end',{step_id:step.id,status:'passed'});
    }
    // Read the persisted evidence back before declaring the engineering goal met.
    const checked={};for(const record of state.passed)checked[record.id]=verifyStep(root,record,plan.spec.steps.find(s=>s.id===record.id));
    state.task_acceptance=evaluateTask(plan.acceptance,checked,state.passed,frozenIssues(root,plan));
    state.status='completed';state.outcome=plan.acceptance&&state.task_acceptance.status!=='passed'?`acceptance_${state.task_acceptance.status}`:'passed';
    runtime.transition('finalizing');runtime.transition('completed');
  }catch(error){
    state.status=deadline?'timed_out':signal?.aborted?'cancelled':'failed';state.outcome||=deadline?'budget_exhausted':signal?.aborted?'cancelled':'tool_error';state.error=String(error);
    if(error.receipt&&state.current_step){
      try{state.failed_tool=captureToolFailure(root,trace,state,error.receipt);}
      catch(rejected){state.failed_tool_rejected=String(rejected.message||rejected);}
    }
    if(['tool_error','checks_failed'].includes(state.outcome)&&state.current_step){
      const step=plan.spec.steps.find(s=>s.id===state.current_step);
      const fingerprint=digest(JSON.stringify({step:step.id,tool:step.tool,args:step.args,inputs:plan.input_hashes,outcome:state.outcome}));
      state.failure_history.push({fingerprint,step:step.id,outcome:state.outcome,run_id:state.run_id});
    }
    runtime.transition(state.status);
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
  if(!state.task_acceptance){
    const observed={};for(const r of [...state.passed,...(state.failed_step?[state.failed_step]:[])]){try{observed[r.id]=verifyStep(root,r,plan.spec.steps.find(s=>s.id===r.id),{requireChecks:false});}catch{}}
    state.task_acceptance=evaluateTask(plan.acceptance,observed,[...state.passed,...(state.failed_step?[state.failed_step]:[])],frozenIssues(root,plan));
  }
  const outcomeBytes=JSON.stringify(state.task_acceptance,null,2)+'\n';durableWrite(path.join(trace.directory,'task-outcome.json'),outcomeBytes);state.task_acceptance_hash=digest(outcomeBytes);persist();
  const receipt=trace.finish(state.status,state.error?new Error(state.error):null);
  return {directory:trace.directory,run_id:state.run_id,status:state.status,outcome:state.outcome,completed_steps:state.passed.map(s=>s.id),
    next_step:plan.spec.steps[state.passed.length]?.id||null,error:state.error||null,model_api_calls:0,receipt,task_acceptance:state.task_acceptance,recovery:recoveryAdvice(state),
    acceptance_scope:'Only the frozen declared checks; no implicit functional, formal, CDC or board signoff.'};
}
export function createWorkflowTools(root,registry){
  return [
    ['plan','Resolve a frozen sequential task, input hashes, tool dependencies and budget without starting EDA.',object({spec:str},['spec'])],
    ['run','Execute declared steps with shared tool leases, fixed acceptance checks and a cumulative budget. May start EDA. Stops on the first failed check.',object({spec:str},['spec'])],
    ['inspect','Read task checkpoints and verify committed child traces, result files and output hashes.',object({directory:str},['directory'])],
    ['resume_check','Read-only check of task ownership, frozen inputs, implementation, completed results and remaining budget.',object({directory:str},['directory'])],
    ['resume','Continue an eligible task in a new trace, reusing verified completed steps. An interrupted uncommitted step is rerun; no exactly-once guarantee. May start EDA.',object({directory:str},['directory'])]
  ].map(([action,description,parameters])=>({name:`eda_workflow_${action}`,label:`EDA workflow ${action}`,description,parameters,
    async execute(id,args,signal,update,ctx){
      validateArguments(args,parameters);
      const trace=createTrace({root,tool:`eda_workflow_${action}`,args,toolCallId:id,context:ctx?.edaTraceContext});
      try{
        signal?.throwIfAborted();let data;
        if(['run','resume'].includes(action))data=await executeWorkflow(root,registry,trace,args,signal,update,action==='resume');
        else{
          trace.capture(path.join(root,'src/workflow.mjs'),'orchestrator');
          if(action==='plan'){data=planWorkflow(root,args.spec,registry);for(const file of Object.keys(data.input_hashes))trace.capture(path.join(root,file),'planned_input');}
          else {const {state,results,...summary}=inspectWorkflow(root,args.directory,{resume:action==='resume_check'});data=summary;trace.capture(path.join(summary.directory,'workflow.json'),'inspected_pointer');}
          trace.finalizeDependencies();fs.writeFileSync(path.join(trace.directory,'result.json'),JSON.stringify(data,null,2));trace.finish('completed');data={...data,evidence:trace.directory};
        }
        const failed=['run','resume'].includes(action)?data.outcome!=='passed':action==='resume_check'?!data.ready:action==='inspect'?!data.valid:false;
        return {content:[{type:'text',text:JSON.stringify(data)}],details:data,...(failed?{isError:true}:{})};
      }catch(error){const receipt=trace.finish(signal?.aborted?'cancelled':'failed',error);throw Object.assign(new Error(`${error.message}; evidence: ${trace.directory}`),{receipt});}
    }
  }));
}
