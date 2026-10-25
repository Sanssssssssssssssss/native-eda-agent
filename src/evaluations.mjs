import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {evaluateRetrieval} from '../scripts/evaluate-knowledge.mjs';
import {loadResults,verifyResult} from './results.mjs';
import {readConfig} from './runtime.mjs';
import {inspectTrace} from '../scripts/trace-inspect.mjs';
import {inspectWorkflow} from './workflow.mjs';
import {knowledgeFiles} from './knowledge.mjs';
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
export function evaluationFreshness(root,receipt){
  const entries=Object.entries(receipt.source_hashes||{}),changed=[];
  for(const [name,expected]of entries){
    try{
      const base=fs.realpathSync(root),file=fs.realpathSync(path.resolve(root,name)),rel=path.relative(base,file);
      if(!rel||rel.startsWith('..')||path.isAbsolute(rel)||hash(file)!==expected)changed.push(name);
    }catch{changed.push(name);}
  }
  const softwareUnbound=receipt.suite==='offline-contracts'&&!receipt.source_hashes?.['scripts/validate-agent-offline.mjs'];
  return {current_sources_match:softwareUnbound?null:entries.length?changed.length===0:null,changed_sources:changed,
    ...(softwareUnbound?{reason:'software_validation_sources_unbound'}:{}),scope:'Recorded protocol/source hashes only; referenced workflow evidence requires separate inspection.'};
}
export const evaluationSuites=[
  {id:'offline-contracts',lane:'offline',category:'agent_mechanism',unit:'software_test',description:'Fake EDA, native MCP, task outcomes, recovery and resource contracts',launches_eda:false},
  {id:'offline-retrieval',lane:'offline',category:'rag',unit:'visible_query',description:'24 visible bilingual rule-retrieval queries; not a blind answer score',launches_eda:false},
  {id:'offline-evidence',lane:'offline',category:'evidence',unit:'scorecard_integrity',description:'Verify retained public and available original evidence hashes; does not rerun designs',launches_eda:false},
  {id:'online-counter',lane:'online_eda',category:'rtl',unit:'workflow_run',description:'Live XSim with the fixed counter checker and host goal verification',spec:'examples/workflows/counter-simulation.json',launches_eda:true},
  {id:'online-axi',lane:'online_eda',category:'system_implementation',unit:'workflow_run',description:'Live AXI simulation, synthesis, route and strict DRC review; needs pinned RTL dependencies',spec:'examples/workflows/axi-fabric-ooc.json',launches_eda:true},
  {id:'online-agent',lane:'online_agent',category:'agent_end_to_end',unit:'session_task',description:'Assess a completed Pi SDK session and its causally linked workflow; does not itself call a provider',launches_eda:false,requires:['session_directory','workflow_directory']},
];
export function evaluationPlan(root,id){
  const suite=evaluationSuites.find(s=>s.id===id);if(!suite)throw new Error('Unknown evaluation suite');
  return {...suite,model_api_enabled:readConfig(root).model_api_enabled,provider_launch:false,
    prerequisites:suite.lane==='online_agent'?['A recorded agent session and its child workflow; new provider sessions remain disabled by current config']:suite.launches_eda?['Installed licensed EDA','Pinned sources, checker and constraints']:[],
    comparability:['same suite','same source/protocol hashes','same unit'],scope:'Categories and units remain separate; no aggregate offline/online score.'};
}
async function command(root,args,signal,log){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{cwd:root,windowsHide:true,signal,stdio:['ignore','pipe','pipe']}),stream=fs.createWriteStream(log);
    child.stdout.pipe(stream,{end:false});child.stderr.pipe(stream,{end:false});child.on('error',error=>{stream.end();reject(error);});child.on('close',code=>{stream.end(()=>resolve(code));});
  });
}
function artifact(root,value){
  const base=fs.realpathSync(path.join(root,'artifacts')),file=fs.realpathSync(path.resolve(root,value)),rel=path.relative(base,file);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Evaluation evidence must stay inside artifacts');return file;
}
export async function runEvaluation(root,id,registry,{signal,session_directory,workflow_directory}={}){
  const plan=evaluationPlan(root,id),dir=path.join(root,'artifacts',`evaluation-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,6)}`);
  fs.mkdirSync(dir,{recursive:true});
  const files=[...new Set(['src/evaluations.mjs','src/task-outcome.mjs','src/task-context.mjs','src/workflow.mjs','scripts/evaluate-knowledge.mjs','knowledge/retrieval-cases.json',...knowledgeFiles(root).map(f=>path.relative(root,f).replaceAll('\\','/')),...(plan.spec?[plan.spec]:[])])];
  const result={schema_version:1,suite:id,lane:plan.lane,category:plan.category,unit:plan.unit,started_at:new Date().toISOString(),status:'running',
    source_hashes:Object.fromEntries(files.map(f=>[f,createHash('sha256').update(fs.readFileSync(path.join(root,f))).digest('hex')])),provider_calls_by_evaluator:0,outer_codex_tokens:null};
  const save=()=>fs.writeFileSync(path.join(dir,'result.json'),JSON.stringify(result,null,2)+'\n');save();
  try{
    signal?.throwIfAborted();
    if(id==='offline-contracts'){
      result.exit_code=await command(root,['scripts/validate-agent-offline.mjs'],signal,path.join(dir,'validation.log'));
      result.status=result.exit_code===0?'passed':'failed';result.detail_log='validation.log';
      // Bind the actual software validation receipt, rather than only this evaluator's source.
      const child=JSON.parse(fs.readFileSync(path.join(dir,'validation.log'),'utf8'));
      const validationDirectory=artifact(root,child.evidence),validation=JSON.parse(fs.readFileSync(path.join(validationDirectory,'result.json'),'utf8'));
      result.validation_directory=path.relative(root,validationDirectory).replaceAll('\\','/');
      result.source_hashes={...result.source_hashes,...validation.source_hashes};
      result.metrics={checks:validation.checks.map(({name,passed,test_count})=>({name,passed,test_count}))};
      if(!validation.passed||!validation.source_hashes?.['scripts/validate-agent-offline.mjs'])result.status='failed';
    }else if(id==='offline-retrieval'){
      result.metrics=evaluateRetrieval(root);result.status=result.metrics.after.hits>=result.metrics.before.hits&&result.metrics.unrelated.every(q=>q.returned===0)?'passed':'failed';
    }else if(id==='offline-evidence'){
      result.checks=loadResults(root).records.map(r=>{const v=verifyResult(root,r.id);return {id:r.id,public_evidence_valid:v.public_evidence_valid,available_originals_valid:v.available_originals_valid,originals_available:v.originals_available};});
      result.status=result.checks.every(c=>c.public_evidence_valid&&c.available_originals_valid)?'passed':'failed';
    }else if(plan.spec){
      const r=await registry.get('eda_workflow_run').execute(`eval-${randomUUID()}`,{spec:plan.spec},signal);
      result.workflow=r.details.directory;result.task_acceptance=r.details.task_acceptance;result.workflow_outcome=r.details.outcome;
      result.status=!r.isError&&r.details.task_acceptance.status==='passed'?'passed':'failed';
    }else{
      if(!session_directory||!workflow_directory){result.status='blocked';result.reason='agent_session_and_workflow_required';}
      else{
        const session=artifact(root,session_directory),workflow=artifact(root,workflow_directory),manifest=JSON.parse(fs.readFileSync(path.join(session,'run.json'),'utf8'));
        const trace=inspectTrace(session,{checkCurrent:true}),task=inspectWorkflow(root,workflow),child=JSON.parse(fs.readFileSync(path.join(workflow,'run.json'),'utf8'));
        if(manifest.mode!=='pi-sdk-agent'||!trace.valid||trace.status!=='completed'||trace.input_drift||child.trace_id!==manifest.trace_id||child.parent_span_id!==manifest.span_id)throw new Error('Agent session evidence is incomplete, stale or not the workflow parent');
        result.session=path.relative(root,session);result.workflow=path.relative(root,workflow);result.task_acceptance=task.task_acceptance;
        result.status=task.valid&&task.outcome==='passed'&&task.task_acceptance.status==='passed'?'passed':'failed';
        result.scope='Recorded session/task result only; no held-out design or reference independence is inferred.';
      }
    }
  }catch(error){result.status=signal?.aborted?'cancelled':'failed';result.error=error.message;}
  result.finished_at=new Date().toISOString();save();return {...result,directory:dir};
}
