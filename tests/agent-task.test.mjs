import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {prepareAgentTask,inspectAgentTask,claimAgentTask,taskDelivery,guardTaskTool,activeTaskContext} from '../src/agent-task.mjs';
import {runVerifiedLoop} from '../src/verifier-loop.mjs';
import {taskFixture} from './fixtures/agent-task.mjs';

async function execute(f,task,name,{resume=false,generate,signal,onState=()=>{}}={}) {
  const directory=f.attempt(name),claim=claimAgentTask(f.root,task.directory,f.registry,directory,{resume});
  try{return await runVerifiedLoop({...f,configuration:claim.configuration,continuation:claim.continuation,assertScope:claim.assertCurrent,
    directory,prompt:'Repair the declared candidate',signal,onState,generate:generate||(async()=>{})});}
  finally{claim.finish();}
}

test('isolation: candidate includes dependencies and leaves original RTL and oracle unchanged',async t=>{
  const f=taskFixture(t),original=fs.readFileSync(path.join(f.root,'design/dut.sv'));
  const task=prepareAgentTask(f.root,f.configuration,f.registry);
  assert.equal(f.calls.length,0);
  const spec=JSON.parse(fs.readFileSync(path.join(f.root,task.configuration.spec)));
  assert.ok(spec.steps[0].args.include_dirs[0].startsWith(task.candidate));
  assert.equal(fs.readFileSync(path.join(f.root,spec.steps[0].args.include_dirs[0],'defs.svh'),'utf8'),'`define WIDTH 8\n');
  const result=await execute(f,task,'attempt-1',{generate:async()=>fs.appendFileSync(path.join(f.root,task.editable_sources[0]),'// CANDIDATE_OK\n')});
  assert.equal(result.status,'passed');
  assert.deepEqual(fs.readFileSync(path.join(f.root,'design/dut.sv')),original);
  assert.ok(f.calls[0].args.sources.every(name=>name.startsWith(task.candidate)));
  const delivery=taskDelivery(f.root,task.directory,f.registry);
  assert.equal(delivery.task_acceptance.status,'passed');assert.equal(delivery.originals_preserved,true);
});

test('guidance: failed functional evidence selects verification SOP before model repair',async t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry),prompts=[];
  const result=await execute(f,task,'attempt-1',{generate:async prompt=>{
    prompts.push(prompt);if(prompts.length===2)fs.appendFileSync(path.join(f.root,task.editable_sources[0]),'// CANDIDATE_OK');
  }});
  assert.equal(result.status,'passed');assert.equal(prompts.length,2);
  assert.equal(result.rounds[0].guidance.phase,'planning');
  assert.equal(result.rounds[1].guidance.phase,'simulation');
  assert.ok(result.rounds[1].guidance.sop_ids.includes('fpga-rtl-verify'));
  assert.match(prompts[1],/Independent verifier/);assert.match(prompts[1],/Evidence-selected RAG/);
});

test('recovery: a cancelled verified boundary resumes with cumulative rounds and calls',async t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry),controller=new AbortController();
  const first=await execute(f,task,'attempt-1',{signal:controller.signal,onState:state=>{if(state.verifier_rounds===1)controller.abort();}});
  assert.equal(first.status,'cancelled');assert.equal(first.phase,'boundary');
  assert.equal(inspectAgentTask(f.root,task.directory,f.registry).recovery.ready,true);
  const second=await execute(f,task,'attempt-2',{resume:true,generate:async()=>fs.appendFileSync(path.join(f.root,task.editable_sources[0]),'// CANDIDATE_OK')});
  assert.equal(second.status,'passed');assert.equal(second.rounds.length,2);assert.equal(second.calls,2);assert.equal(second.resumed_rounds,1);
  assert.notEqual(second.rounds[0].directory,second.rounds[1].directory);
});

test('budget: cancellation cannot refill the fixed cumulative retry allowance',async t=>{
  const f=taskFixture(t);f.configuration.max_calls=1;
  const task=prepareAgentTask(f.root,f.configuration,f.registry),controller=new AbortController();
  await execute(f,task,'attempt-1',{signal:controller.signal,onState:state=>{if(state.verifier_rounds===1)controller.abort();}});
  assert.equal(inspectAgentTask(f.root,task.directory,f.registry).recovery.ready,false);
  await assert.rejects(execute(f,task,'attempt-2',{resume:true}),/cannot resume/);
  assert.equal(f.calls.length,1);
});

test('recovery: cancelling mid generation requires a fresh task rather than trusting unfinished edits',async t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry),controller=new AbortController();
  const result=await execute(f,task,'attempt-1',{signal:controller.signal,generate:async()=>{fs.appendFileSync(path.join(f.root,task.editable_sources[0]),'// unfinished');controller.abort();}});
  assert.equal(result.phase,'generating');assert.equal(f.calls.length,0);
  assert.equal(inspectAgentTask(f.root,task.directory,f.registry).recovery.ready,false);
});

test('ownership: simultaneous agents cannot claim the same candidate',t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry);
  const claim=claimAgentTask(f.root,task.directory,f.registry,f.attempt('first'));
  try{assert.throws(()=>claimAgentTask(f.root,task.directory,f.registry,f.attempt('second')),/owner_active/);}
  finally{claim.finish();}
});

for(const target of ['original','checker','header'])test(`integrity: ${target} drift blocks independent dispatch`,async t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry);
  const file=target==='original'?'design/dut.sv':`${task.candidate}/design/${target==='checker'?'checker.sv':'include/defs.svh'}`;
  const result=await execute(f,task,'attempt-1',{generate:async()=>fs.appendFileSync(path.join(f.root,file),'\n// tampered\n')});
  assert.equal(result.status,'invalid');assert.equal(f.calls.length,0);
  assert.equal(taskDelivery(f.root,task.directory,f.registry).task_acceptance.status,'unknown');
});

test('delivery: corrupting the saved loop or candidate revokes a historical pass',async t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry);
  await execute(f,task,'attempt-1',{generate:async()=>fs.appendFileSync(path.join(f.root,task.editable_sources[0]),'// CANDIDATE_OK')});
  fs.appendFileSync(path.join(f.root,task.editable_sources[0]),'\n// later drift');
  const changed=taskDelivery(f.root,task.directory,f.registry);
  assert.equal(changed.status,'invalid');assert.equal(changed.task_acceptance.status,'unknown');
  fs.appendFileSync(path.join(f.root,'artifacts/attempt-1/verification-loop.json'),'\n');
  assert.match(taskDelivery(f.root,task.directory,f.registry).issues.join(' '),/checkpoint changed/);
});

test('dispatch: candidate writes are allowed while oracle, shell and nested EDA bypasses are blocked',t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry);
  const guard=(toolName,input)=>guardTaskTool(f.root,task.configuration,{toolName,input,parentToolCallId:'codemode-1'});
  assert.equal(guard('write',{path:task.editable_sources[0]}),undefined);
  assert.equal(guard('edit',{path:`${task.candidate}/design/checker.sv`}).block,true);
  assert.equal(guard('write',{path:'design/dut.sv'}).block,true);
  assert.equal(guard('bash',{command:'vivado'}).block,true);
  assert.equal(guard('eda_workflow_run',{spec:task.configuration.spec}).block,true);
  assert.equal(guard('eda_sop',{id:'fpga-rtl-verify'}),undefined);
});

test('context: provider refresh retains frozen candidate scope and live remaining budgets',async t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry),packets=[];
  const result=await execute(f,task,'attempt-1',{generate:async()=>{
    packets.push(activeTaskContext(f.root,task.directory,f.registry));
    if(packets.length===2)fs.appendFileSync(path.join(f.root,task.editable_sources[0]),'// CANDIDATE_OK');
  }});
  assert.equal(result.status,'passed');
  assert.deepEqual(packets[1].editable_sources,task.editable_sources);
  assert.equal(packets[1].budget.used_rounds,1);assert.equal(packets[1].budget.used_calls,1);
  assert.equal(packets[1].scope_valid,true);assert.equal(packets[1].task_acceptance,'unknown');
  assert.equal(packets[1].guidance.phase,'simulation');assert.ok(packets[1].contract.sha256);
});
