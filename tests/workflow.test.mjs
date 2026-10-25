import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createTrace} from '../src/trace.mjs';
import {inspectTrace} from '../scripts/trace-inspect.mjs';
import {createRunState} from '../src/runtime.mjs';
import {createWorkflowTools,planWorkflow,inspectWorkflow,evaluateChecks,pointerValue} from '../src/workflow.mjs';
const digest=b=>createHash('sha256').update(b).digest('hex');
function fixture(t,behavior=async()=>({token:'evidence',ok:true})){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'eda-workflow-'));
  t.after(()=>{assert.ok(root.startsWith(path.join(os.tmpdir(),'eda-workflow-')));fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'src'));fs.writeFileSync(path.join(root,'src/workflow.mjs'),'fixture implementation');fs.writeFileSync(path.join(root,'input.txt'),'frozen checker');
  const spec={schema_version:1,id:'test-task',goal:'Verify deterministic two-step workflow',inputs:['input.txt'],limits:{max_calls:4,wall_seconds:5},steps:[
    {id:'first',tool:'eda_preflight',args:{},checks:[{pointer:'/ok',op:'eq',value:true}]},
    {id:'second',tool:'eda_results_verify',args:{token:{$result:{step:'first',pointer:'/token'}}},checks:[{pointer:'/ok',op:'eq',value:true}]}
  ]};
  const save=()=>fs.writeFileSync(path.join(root,'task.json'),JSON.stringify(spec));save();
  const calls=[];const registry=new Map();
  for(const name of ['eda_preflight','eda_results_verify'])registry.set(name,{parameters:{type:'object',properties:{token:{type:'string'},include_dirs:{type:'array',items:{type:'string'}}},additionalProperties:false},async execute(id,args,signal,update,ctx){
    calls.push({name,args});const trace=createTrace({root,tool:name,args,toolCallId:id,context:ctx.edaTraceContext});trace.capture(path.join(root,'input.txt'),'input');trace.finalizeDependencies();
    try{const result=await behavior(name,args,signal,calls,trace);return {details:trace.finish('completed',null,result)};}
    catch(error){throw Object.assign(error,{receipt:trace.finish(signal?.aborted?'cancelled':'failed',error)});}
  }});
  const tools=new Map(createWorkflowTools(root,registry).map(t=>[t.name,t]));
  const run=(action,args={spec:'task.json'},signal)=>tools.get(`eda_workflow_${action}`).execute(`test-${action}`,args,signal);
  return {root,spec,save,calls,registry,run};
}
test('plan dispatches nothing; run resolves prior outputs and records causal child traces',async t=>{
  const f=fixture(t);const p=await f.run('plan');assert.equal(p.details.launches_eda,false);assert.equal(f.calls.length,0);
  const r=await f.run('run');assert.equal(r.details.outcome,'passed');assert.equal(r.isError,undefined);assert.equal(f.calls[1].args.token,'evidence');
  const checked=inspectWorkflow(f.root,r.details.directory);assert.equal(checked.valid,true);assert.equal(checked.state.calls,2);
  assert.equal(inspectTrace(r.details.directory).valid,true);
  const child=JSON.parse(fs.readFileSync(path.join(f.root,checked.state.passed[0].child_directory,'run.json')));
  assert.equal(child.trace_id,r.details.receipt.trace_id);assert.equal(child.parent_span_id,r.details.receipt.span_id);
  assert.ok(inspectWorkflow(f.root,r.details.directory,{resume:true}).issues.includes('already_completed'));
});
test('tool failure resumes in a new run and reuses only the committed prefix',async t=>{
  let second=0;const f=fixture(t,async name=>{if(name==='eda_results_verify'&&second++===0)throw new Error('synthetic tool failure');return {ok:true,token:'evidence'};});
  const failed=await f.run('run');assert.equal(failed.isError,true);assert.equal(failed.details.outcome,'tool_error');
  const original=fs.readFileSync(path.join(failed.details.directory,'workflow.json'));
  const eligible=await f.run('resume_check',{directory:failed.details.directory});assert.equal(eligible.details.ready,true);assert.equal(eligible.isError,undefined);
  assert.equal((await f.run('inspect',{directory:failed.details.directory})).isError,undefined);
  const resumed=await f.run('resume',{directory:failed.details.directory});assert.equal(resumed.details.outcome,'passed');assert.notEqual(resumed.details.directory,failed.details.directory);
  assert.equal(f.calls.filter(c=>c.name==='eda_preflight').length,1);assert.equal(f.calls.length,3);
  assert.deepEqual(fs.readFileSync(path.join(failed.details.directory,'workflow.json')),original);
});
test('failed acceptance stops downstream work even when the child completed successfully',async t=>{
  const f=fixture(t,async()=>({ok:false,token:'evidence'}));const r=await f.run('run');
  assert.equal(r.isError,true);assert.equal(r.details.outcome,'checks_failed');assert.equal(f.calls.length,1);
  const s=inspectWorkflow(f.root,r.details.directory).state;assert.equal(s.failed_step.checks[0].passed,false);assert.equal(s.passed.length,0);
});
test('resume refuses changed frozen inputs, implementation and committed outputs',async t=>{
  const f=fixture(t,async(name,_args,_signal,_calls,trace)=>{if(name==='eda_results_verify')throw new Error('stop');const artifact=path.join(trace.directory,'output.dcp');fs.writeFileSync(artifact,'synthetic checkpoint bytes');return {ok:true,token:'evidence',fpga:{artifacts:{checkpoint:artifact}}};});
  fs.mkdirSync(path.join(f.root,'headers'));fs.writeFileSync(path.join(f.root,'headers/base.vh'),'frozen header');f.spec.steps[0].args.include_dirs=['headers'];f.save();
  const r=await f.run('run');const dir=r.details.directory;
  fs.writeFileSync(path.join(f.root,'headers/override.vh'),'new header');assert.ok(inspectWorkflow(f.root,dir,{resume:true}).issues.some(x=>x.startsWith('include_contents_changed')));fs.unlinkSync(path.join(f.root,'headers/override.vh'));
  fs.appendFileSync(path.join(f.root,'input.txt'),'changed');assert.ok(inspectWorkflow(f.root,dir,{resume:true}).issues.some(x=>x.startsWith('input_changed')));
  fs.writeFileSync(path.join(f.root,'input.txt'),'frozen checker');
  fs.appendFileSync(path.join(f.root,'src/workflow.mjs'),'changed');assert.ok(inspectWorkflow(f.root,dir,{resume:true}).issues.includes('implementation_changed'));
  fs.writeFileSync(path.join(f.root,'src/workflow.mjs'),'fixture implementation');
  const state=inspectWorkflow(f.root,dir).state,artifact=path.join(f.root,Object.keys(state.passed[0].artifact_hashes)[0]);
  fs.appendFileSync(artifact,'changed');assert.ok(inspectWorkflow(f.root,dir,{resume:true}).issues.some(x=>x.includes('artifact changed')));fs.writeFileSync(artifact,'synthetic checkpoint bytes');
  fs.appendFileSync(path.join(f.root,state.passed[0].result_path),' ');
  assert.ok(inspectWorkflow(f.root,dir,{resume:true}).issues.some(x=>x.includes('result changed')));
  await assert.rejects(f.run('resume',{directory:dir}),/cannot resume/);
});
test('invalid references, missing checks and arbitrary Tcl are rejected before dispatch',t=>{
  const f=fixture(t);f.spec.steps[1].args.hidden='override';f.save();assert.throws(()=>planWorkflow(f.root,'task.json',f.registry),/unexpected/);delete f.spec.steps[1].args.hidden;
  f.spec.steps[0].args={token:{$result:{step:'second',pointer:'/token'}}};f.save();assert.throws(()=>planWorkflow(f.root,'task.json',f.registry),/earlier/);
  f.spec.steps[0].args={};f.spec.steps[0].tool='eda_vivado';f.save();assert.throws(()=>planWorkflow(f.root,'task.json',f.registry),/Unsupported/);
  f.spec.steps[0].tool='eda_preflight';f.spec.steps[0].checks=[];f.save();assert.throws(()=>planWorkflow(f.root,'task.json',f.registry),/array/);
  assert.equal(f.calls.length,0);
  assert.throws(()=>pointerValue({},'/__proto__'),/Missing/);assert.equal(evaluateChecks({slack:null},[{pointer:'/slack',op:'gte',value:0}])[0].passed,false);
});
test('cumulative call budget survives recovery and cannot be reset by resuming',async t=>{
  const f=fixture(t,async()=>{throw new Error('stop');});f.spec.limits.max_calls=1;f.save();
  const r=await f.run('run');assert.equal(f.calls.length,1);assert.ok(inspectWorkflow(f.root,r.details.directory,{resume:true}).issues.includes('budget_exhausted'));
});
test('wall-time timeout and user cancellation reach the active child and persist distinct outcomes',async t=>{
  const behavior=async(_name,_args,signal)=>{await delay(5000,null,{signal});return {ok:true};};
  const f=fixture(t,behavior);f.spec.limits.wall_seconds=1;f.save();
  const timed=await f.run('run');assert.equal(timed.details.status,'timed_out');assert.equal(timed.details.outcome,'budget_exhausted');
  const g=fixture(t,behavior),abort=new AbortController();setTimeout(()=>abort.abort(),40);
  const cancelled=await g.run('run',undefined,abort.signal);assert.equal(cancelled.details.status,'cancelled');assert.equal(cancelled.details.outcome,'cancelled');
});
test('recovery refuses a live owner and a forged pointer without a committed event',async t=>{
  const f=fixture(t,async()=>{throw new Error('stop');});const r=await f.run('run'),dir=r.details.directory;
  const pfile=path.join(dir,'workflow.json'),p=JSON.parse(fs.readFileSync(pfile)),checkpoint=path.join(dir,p.path),s=JSON.parse(fs.readFileSync(checkpoint));
  s.status='running';s.owner_pid=process.pid;s.checkpoint_at=new Date(Date.now()-6000).toISOString();const bytes=JSON.stringify(s);fs.writeFileSync(checkpoint,bytes);p.sha256=digest(bytes);fs.writeFileSync(pfile,JSON.stringify(p));
  assert.throws(()=>inspectWorkflow(f.root,dir,{resume:true}),/committed event/);
  const events=fs.readFileSync(path.join(dir,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse),last=events.at(-1);
  fs.appendFileSync(path.join(dir,'events.jsonl'),JSON.stringify({...last,type:'workflow_checkpoint',...p,seq:last.seq+1})+'\n');
  assert.ok(inspectWorkflow(f.root,dir,{resume:true}).issues.includes('owner_may_be_alive'));
  assert.ok(inspectWorkflow(f.root,dir,{resume:true}).issues.includes('budget_exhausted'));
  fs.appendFileSync(path.join(dir,'events.jsonl'),'{"torn":');
  assert.ok(inspectWorkflow(f.root,dir,{resume:true}).issues.includes('owner_may_be_alive'));
  fs.appendFileSync(path.join(dir,'events.jsonl'),'\n');assert.throws(()=>inspectWorkflow(f.root,dir),/Malformed/);
});

test('a live unfinished child blocks recovery after its parent has failed',async t=>{
  let child;
  const f=fixture(t,async(_name,_args,_signal,_calls,trace)=>{child=trace;createRunState(f.root,trace);throw new Error('parent observes failure');});
  const r=await f.run('run'),manifestFile=path.join(child.directory,'run.json'),manifest=JSON.parse(fs.readFileSync(manifestFile));
  manifest.processes.push({pid:process.pid,ended_at:null});fs.writeFileSync(manifestFile,JSON.stringify(manifest));
  assert.ok(inspectWorkflow(f.root,r.details.directory,{resume:true}).issues.includes('child_may_be_alive'));
  manifest.processes[0].ended_at=new Date().toISOString();fs.writeFileSync(manifestFile,JSON.stringify(manifest));
  assert.equal(inspectWorkflow(f.root,r.details.directory,{resume:true}).ready,true);
});

test('three unchanged failures across new recovery directories stop further replay',async t=>{
  const f=fixture(t,async()=>{throw new Error('unchanged EDA failure');});f.spec.limits.max_calls=8;f.save();
  let result=await f.run('run');
  for(let i=0;i<2;i++)result=await f.run('resume',{directory:result.details.directory});
  assert.equal(f.calls.length,3);assert.equal(result.details.recovery.stalled,true);
  const check=await f.run('resume_check',{directory:result.details.directory});assert.equal(check.details.ready,false);assert.ok(check.details.issues.includes('repeated_failure_requires_diagnosis'));
  await assert.rejects(f.run('resume',{directory:result.details.directory}),/cannot resume/);
});

test('final acceptance is independently read back and outcome tampering is visible',async t=>{
  const f=fixture(t);const r=await f.run('run');assert.equal(r.details.task_acceptance.reason,'goal_scope_unbound');
  fs.appendFileSync(path.join(r.details.directory,'task-outcome.json'),' ');
  assert.ok(inspectWorkflow(f.root,r.details.directory).issues.includes('task_outcome_changed'));
});

test('completed step checks cannot upgrade an unobserved bound engineering goal to passed',async t=>{
  const f=fixture(t),project=path.resolve(import.meta.dirname,'..');
  for(const name of ['knowledge','.pi/skills'])fs.cpSync(path.join(project,name),path.join(f.root,name),{recursive:true});
  for(const name of ['src/knowledge.mjs','src/trace.mjs','scripts/check-knowledge.mjs','scripts/eda-tool.mjs','scripts/replay-experiment.mjs','scripts/collect-system-evidence.py','projects/system-bench/run.py','projects/system-bench/implement-common.tcl','docs/workflows.md','docs/reference/tools.md','docs/results.md']){fs.mkdirSync(path.dirname(path.join(f.root,name)),{recursive:true});fs.copyFileSync(path.join(project,name),path.join(f.root,name));}
  f.spec.acceptance={profile:'evidence_review',bindings:{artifact_integrity:'second'}};f.save();
  const r=await f.run('run');assert.equal(r.details.status,'completed');assert.equal(r.isError,true);assert.equal(r.details.outcome,'acceptance_unknown');assert.equal(r.details.task_acceptance.status,'unknown');
  const inspected=inspectWorkflow(f.root,r.details.directory,{resume:true});assert.equal(inspected.completed_steps.length,2);assert.equal(inspected.ready,false);
});
