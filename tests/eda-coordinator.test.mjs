import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createTrace} from '../src/trace.mjs';
import {createWorkflowTools,inspectWorkflow} from '../src/workflow.mjs';
import {createEdaCoordinator} from '../src/eda-coordinator.mjs';

const project=path.resolve(import.meta.dirname,'..');
const digest=value=>createHash('sha256').update(value).digest('hex');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'eda-coordinator-'));
  t.after(()=>{
    const relative=path.relative(os.tmpdir(),fs.realpathSync(root));
    assert.ok(relative.startsWith('eda-coordinator-')&&!relative.includes(path.sep));
    fs.rmSync(root,{recursive:true,force:true});
  });
  for(const directory of ['knowledge','.pi/skills'])fs.cpSync(path.join(project,directory),path.join(root,directory),{recursive:true});
  for(const file of ['src/workflow.mjs','src/knowledge.mjs','src/trace.mjs','scripts/check-knowledge.mjs','scripts/eda-tool.mjs','scripts/replay-experiment.mjs','scripts/collect-system-evidence.py','projects/system-bench/run.py','projects/system-bench/implement-common.tcl','docs/workflows.md','docs/reference/tools.md','docs/results.md']){
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(project,file),path.join(root,file));
  }
  fs.mkdirSync(path.join(root,'artifacts'),{recursive:true});
  fs.writeFileSync(path.join(root,'rtl.sv'),'module dut; endmodule\n');
  fs.writeFileSync(path.join(root,'tb.sv'),'module tb; // PRIVATE_CHECKER_CONTENT_SENTINEL\nendmodule\n');
  const spec={schema_version:1,id:'coordinator-fixture',goal:'Verify fixed fixture RTL',inputs:['rtl.sv','tb.sv'],limits:{max_calls:2,wall_seconds:20},
    steps:[{id:'simulation',tool:'eda_xsim',args:{sources:['rtl.sv','tb.sv'],top:'tb',pass_marker:'FIXED_PASS'},checks:[{pointer:'/simulation_acceptance/status',op:'eq',value:'pass'}]}],
    acceptance:{profile:'rtl_simulation',bindings:{functional:'simulation'}}};
  fs.writeFileSync(path.join(root,'task.json'),JSON.stringify(spec));
  let passed=true,calls=0;
  const registry=new Map([['eda_xsim',{parameters:{type:'object',additionalProperties:true},async execute(id,args,_signal,_update,ctx){
    calls++;
    const trace=createTrace({root,tool:'eda_xsim',args,toolCallId:id,context:ctx?.edaTraceContext});
    trace.capture(path.join(root,'rtl.sv'),'rtl');trace.capture(path.join(root,'tb.sv'),'checker');trace.finalizeDependencies();
    return {details:trace.finish('completed',null,{simulation_acceptance:{status:passed?'pass':'fail',pass_marker:'FIXED_PASS',marker_matches:passed?1:0,completion_observed:true,failure_diagnostic:!passed}})};
  }}]]);
  const tools=new Map(createWorkflowTools(root,registry).map(tool=>[tool.name,tool]));
  const run=async(value=true)=>{passed=value;return (await tools.get('eda_workflow_run').execute('coordinator-fixture',{spec:'task.json'})).details;};
  return {root,run,get calls(){return calls;}};
}

function fakePi(){
  const handlers=new Map(),writes=[];let branch=[];
  const ctx={sessionManager:{getBranch:()=>branch,getEntries:()=>{throw new Error('Must not scan other branches');}}};
  const pi={on:(name,handler)=>{handlers.set(name,handler);return ()=>handlers.delete(name);},
    appendEntry:(customType,data)=>{const entry={type:'custom',customType,data:structuredClone(data),id:`entry-${writes.length+1}`};writes.push(entry);branch.push(entry);}};
  return {pi,ctx,handlers,writes,get branch(){return branch;},setBranch:value=>{branch=value;},emit:(name,event={})=>handlers.get(name)?.({type:name,...event},ctx)};
}

test('unbound coordinator publishes unknown without executing tools or changing compaction',t=>{
  const f=fixture(t),states=[],sdk=fakePi(),coordinator=createEdaCoordinator(f.root,{onState:s=>states.push(s)});
  coordinator.install(sdk.pi);
  const state=coordinator.refresh();
  assert.equal(state.binding,null);assert.equal(state.execution_status,'unbound');assert.equal(state.task_acceptance.status,'unknown');
  assert.equal(state.evidence_status,'unknown');assert.equal(state.decision.action,'bind_workflow');
  assert.equal(f.calls,0);
  coordinator.refresh();assert.equal(states.length,1);
  assert.deepEqual([...sdk.handlers.keys()].sort(),['context','session_start','session_tree','tool_result']);
  assert.equal(sdk.writes.length,0);
});

test('fresh inspection downgrades previously passed evidence after RTL drift and only notifies on change',async t=>{
  const f=fixture(t),run=await f.run(),states=[],coordinator=createEdaCoordinator(f.root,{onState:s=>states.push(s)});
  const accepted=coordinator.bind(run.directory);
  assert.equal(accepted.task_acceptance.status,'passed');assert.equal(accepted.decision.action,'deliver_evidence');
  assert.equal(accepted.task.goal,'Verify fixed fixture RTL');
  assert.ok(accepted.task.input_count>=3);assert.match(accepted.task.input_hashes_sha256,/^[a-f0-9]{64}$/);
  assert.equal(accepted.task.budget.max_calls,2);assert.equal(accepted.task.budget.remaining_calls,1);
  assert.equal(accepted.task.budget.wall_seconds,20);assert.ok(accepted.task.budget.remaining_ms<=20000);
  coordinator.refresh();assert.equal(states.length,1);
  fs.appendFileSync(path.join(f.root,'rtl.sv'),'// changed candidate\n');
  const changed=coordinator.refresh();
  assert.equal(changed.task_acceptance.status,'unknown');assert.equal(changed.evidence_status,'invalid');
  assert.equal(changed.task.input_hashes_sha256,accepted.task.input_hashes_sha256,'Digest identifies the fixed contract even when live bytes drift');
  assert.equal(changed.decision.phase,'recovery');assert.equal(states.length,2);
  assert.ok(changed.reflection.issues.some(issue=>issue.includes('input_changed')));
  assert.equal(f.calls,1);
  changed.task_acceptance.status='passed';
  assert.equal(coordinator.refresh().task_acceptance.status,'unknown');
  assert.equal(states.length,2,'Returned values cannot mutate coordinator state');
});

test('current branch pointers restore independently and an empty branch clears the former task',async t=>{
  const f=fixture(t),good=await f.run(),bad=await f.run(false),sdk=fakePi(),coordinator=createEdaCoordinator(f.root);
  coordinator.install(sdk.pi);coordinator.bind(good.directory);
  const goodBranch=[...sdk.branch];
  assert.deepEqual(sdk.writes[0].data,{directory:good.directory});
  sdk.setBranch([{type:'custom',customType:'eda-task-binding',data:{directory:bad.directory,task_acceptance:{status:'passed'}}}]);
  sdk.emit('session_tree');
  assert.equal(coordinator.refresh().task_acceptance.status,'failed');
  assert.equal(coordinator.refresh().decision.phase,'simulation');
  sdk.setBranch([]);sdk.emit('session_start',{reason:'resume'});
  assert.equal(coordinator.refresh().binding,null);assert.equal(coordinator.refresh().task_acceptance.status,'unknown');
  sdk.setBranch(goodBranch);sdk.emit('session_tree');
  assert.equal(coordinator.refresh().binding.directory,good.directory);
  assert.equal(coordinator.refresh().task_acceptance.status,'passed');
  assert.equal(sdk.writes.length,1,'Restoration persists no copied result or new binding entry');
});

test('initial explicit task is seeded once and cannot leak into a new session or empty branch',async t=>{
  const f=fixture(t),run=await f.run(),sdk=fakePi(),coordinator=createEdaCoordinator(f.root,{initialDirectory:run.directory});
  coordinator.install(sdk.pi);sdk.emit('session_start',{reason:'startup'});
  assert.equal(coordinator.refresh().binding.directory,run.directory);assert.equal(sdk.writes.length,1);
  sdk.setBranch([]);sdk.emit('session_start',{reason:'new'});
  assert.equal(coordinator.refresh().binding,null);assert.equal(sdk.writes.length,1);
  sdk.emit('context',{messages:[]});assert.equal(coordinator.refresh().binding,null);
});

test('context preserves messages and compaction summaries while replacing its own stale state with fresh evidence',async t=>{
  const f=fixture(t),run=await f.run(),sdk=fakePi(),coordinator=createEdaCoordinator(f.root);
  coordinator.install(sdk.pi);coordinator.bind(run.directory);
  const summary={role:'compactionSummary',summary:'Earlier summary claimed PASS',tokensBefore:12000,timestamp:1};
  const user={role:'user',content:'Continue',timestamp:2};
  const messages=[summary,user],first=sdk.emit('context',{messages});
  assert.deepEqual(messages,[summary,user]);assert.equal(first.messages[0],summary);assert.equal(first.messages[1],user);
  const oldState=first.messages.at(-1);
  assert.equal(oldState.role,'custom');assert.equal(oldState.customType,'eda-task-state');assert.equal(oldState.display,false);
  assert.equal(typeof oldState.timestamp,'number');assert.match(oldState.content,/"status":"passed"/);
  assert.doesNotMatch(oldState.content,/PRIVATE_CHECKER_CONTENT_SENTINEL/);
  fs.appendFileSync(path.join(f.root,'rtl.sv'),'// new content\n');
  const second=sdk.emit('context',{messages:first.messages}),current=second.messages.at(-1);
  assert.equal(second.messages.filter(message=>message.customType==='eda-task-state').length,1);
  assert.equal(second.messages[0],summary);assert.equal(second.messages[1],user);
  assert.match(current.content,/"evidence_status":"invalid"/);assert.match(current.content,/"task_acceptance":\{"status":"unknown"/);
  assert.ok(Buffer.byteLength(current.content)<=12000);
  assert.equal(f.calls,1);assert.equal(sdk.writes.length,1);
});

test('only approved native details can bind a workflow; arbitrary result text cannot assert acceptance',async t=>{
  const f=fixture(t),run=await f.run(),sdk=fakePi(),coordinator=createEdaCoordinator(f.root);coordinator.install(sdk.pi);
  sdk.emit('tool_result',{toolName:'some_other_tool',details:{directory:run.directory}});
  sdk.emit('tool_result',{toolName:'eda_workflow_run',content:[{type:'text',text:JSON.stringify({directory:run.directory,outcome:'passed'})}]});
  sdk.emit('tool_result',{toolName:'eda_workflow_run',structuredContent:{directory:run.directory}});
  assert.equal(coordinator.refresh().binding,null);assert.equal(sdk.writes.length,0);
  sdk.emit('tool_result',{toolName:'eda_task_context',details:{evidence:'unrelated-context-trace',observation:{directory:run.directory}}});
  assert.equal(coordinator.refresh().task_acceptance.status,'passed');
  assert.deepEqual(sdk.writes.at(-1).data,{directory:run.directory});
  fs.appendFileSync(path.join(f.root,'rtl.sv'),'// drift\n');
  sdk.emit('tool_result',{toolName:'eda_workflow_resume',isError:false,details:{directory:run.directory,outcome:'passed',task_acceptance:{status:'passed'}}});
  assert.equal(coordinator.refresh().task_acceptance.status,'unknown');
  assert.equal(coordinator.refresh().evidence_status,'invalid');
});

test('outside or missing bindings are rejected and a malformed saved pointer cannot revive an older success',async t=>{
  const f=fixture(t),run=await f.run(),sdk=fakePi(),coordinator=createEdaCoordinator(f.root);coordinator.install(sdk.pi);coordinator.bind(run.directory);
  assert.throws(()=>coordinator.bind(f.root),/artifacts/);
  assert.throws(()=>coordinator.bind(path.join(f.root,'artifacts','missing')));
  sdk.emit('tool_result',{toolName:'eda_workflow_run',details:{directory:f.root}});
  assert.equal(coordinator.refresh().binding.directory,run.directory);
  sdk.setBranch([...sdk.branch,{type:'custom',customType:'eda-task-binding',data:{directory:f.root}}]);sdk.emit('session_tree');
  const state=coordinator.refresh();
  assert.equal(state.binding,null);assert.equal(state.task_acceptance.status,'unknown');assert.equal(state.evidence_status,'invalid');
});

test('damaged workflow metadata yields unknown and a recovery decision without throwing from the context hook',async t=>{
  const f=fixture(t),run=await f.run(),sdk=fakePi(),coordinator=createEdaCoordinator(f.root);coordinator.install(sdk.pi);coordinator.bind(run.directory);
  fs.writeFileSync(path.join(run.directory,'workflow.json'),'{broken');
  const result=sdk.emit('context',{messages:[]}),state=coordinator.refresh();
  assert.equal(state.task_acceptance.status,'unknown');assert.equal(state.execution_status,'invalid');assert.equal(state.decision.phase,'recovery');
  assert.ok(Buffer.byteLength(result.messages[0].content)<=12000);
});

test('context retains at most six historical failure fingerprints and excludes checker bytes',async t=>{
  const f=fixture(t),run=await f.run(false),inspected=inspectWorkflow(f.root,run.directory);
  // Add synthetic historical checkpoint metadata to this owned fixture. Fixed
  // input hashes and independent tool/acceptance receipts remain unchanged.
  const state=inspected.state;
  state.failure_history=Array.from({length:40},(_,i)=>({fingerprint:digest(String(i)),step:'simulation',outcome:'checks_failed'}));
  state.sequence=99999;
  const bytes=JSON.stringify(state),pointer={schema_version:1,path:'checkpoints/99999.json',sha256:digest(bytes)};
  fs.writeFileSync(path.join(run.directory,pointer.path),bytes,{flag:'wx'});
  const eventFile=path.join(run.directory,'events.jsonl'),last=JSON.parse(fs.readFileSync(eventFile,'utf8').trim().split('\n').at(-1));
  fs.appendFileSync(eventFile,JSON.stringify({...last,type:'workflow_checkpoint',...pointer,seq:last.seq+1})+'\n');
  fs.writeFileSync(path.join(run.directory,'workflow.json'),JSON.stringify(pointer));
  assert.equal(inspectWorkflow(f.root,run.directory).valid,true);
  const coordinator=createEdaCoordinator(f.root),result=coordinator.bind(run.directory);
  assert.equal(result.reflection.recent_failures.length,6);
  assert.equal(result.reflection.recent_failures[0].fingerprint,digest('34'));
  assert.ok(Buffer.byteLength(result.context)<=12000);
  assert.doesNotMatch(result.context,new RegExp(digest('0')));assert.doesNotMatch(result.context,/PRIVATE_CHECKER_CONTENT_SENTINEL/);
  assert.equal(f.calls,1);
});
