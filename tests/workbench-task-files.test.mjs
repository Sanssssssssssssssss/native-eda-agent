import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {taskFixture} from './fixtures/agent-task.mjs';
import {prepareAgentTask,claimAgentTask} from '../src/agent-task.mjs';
import {runVerifiedLoop} from '../src/verifier-loop.mjs';
import {taskFiles,readTaskSource,projectTasks} from '../src/workbench-task-files.mjs';

test('candidate preview exposes the admitted source pair, line pages and frozen-original drift',t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry),id=path.basename(task.directory);
  const listing=taskFiles(f.root,id,f.registry);
  assert.equal(listing.progress,null);
  assert.equal(listing.files.find(x=>x.original==='design/dut.sv').editable,true);
  const candidate=path.join(f.root,task.editable_sources[0]);
  fs.writeFileSync(candidate,'module changed;\n// 中文\nendmodule\n');
  const page=readTaskSource(f.root,id,'design/dut.sv',f.registry,{start_line:2,line_count:1});
  assert.equal(page.original_matches_frozen,true);assert.equal(page.changed,true);
  assert.equal(page.candidate.lines[0].text,'// 中文');assert.equal(page.next_line,3);
  assert.equal(projectTasks(f.root,'design',f.registry).length,1);
  assert.equal(projectTasks(f.root,'unrelated',f.registry).length,0);
  fs.appendFileSync(path.join(f.root,'design/dut.sv'),'// original changed');
  assert.equal(readTaskSource(f.root,id,'design/dut.sv',f.registry).original_matches_frozen,false);
});
test('candidate preview denies traversal, uncaptured files, modified contracts and invalid pages',t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry),id=path.basename(task.directory);
  assert.throws(()=>taskFiles(f.root,'../private',f.registry),/identifier/);
  for(const name of ['../../.env','src/agent-task.mjs','design/unknown.sv'])assert.throws(()=>readTaskSource(f.root,id,name,f.registry),/inventory/);
  assert.throws(()=>readTaskSource(f.root,id,'design/dut.sv',f.registry,{start_line:0}),/page/);
  fs.appendFileSync(path.join(f.root,task.directory,'task-contract.json'),' ');
  assert.throws(()=>taskFiles(f.root,id,f.registry),/contract changed/);
  assert.equal(projectTasks(f.root,'design',f.registry)[0].status,'invalid');
});
test('candidate preview refuses linked directories even when their files were captured',t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry),id=path.basename(task.directory);
  const directory=path.dirname(path.join(f.root,task.editable_sources[0])),saved=directory+'-original';
  assert.equal(path.dirname(directory),path.join(f.root,task.candidate));
  fs.renameSync(directory,saved);
  fs.symlinkSync(saved,directory,process.platform==='win32'?'junction':'dir');
  assert.throws(()=>readTaskSource(f.root,id,'design/dut.sv',f.registry),/Linked/);
});

test('candidate preview shows live completed and reserved budgets without accepting an unsealed attempt',async t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry),id=path.basename(task.directory);
  const directory=f.attempt('preview-progress'),claim=claimAgentTask(f.root,task.directory,f.registry,directory);
  let generation=0,verifying;
  try {
    const result=await runVerifiedLoop({...f,directory,configuration:claim.configuration,assertScope:claim.assertCurrent,
      prompt:'Repair the candidate',generate:async()=>{
        generation++;
        fs.appendFileSync(path.join(f.root,task.editable_sources[0]),`// ${generation===3?'CANDIDATE_OK':`repair ${generation}`}\n`);
      },onState:state=>{
        if(state.decision.phase==='verifying'&&state.budget.used_rounds===2)verifying=taskFiles(f.root,id,f.registry);
      }});
    assert.equal(result.status,'passed');assert.equal(f.calls.length,3);
    assert.equal(verifying.delivery.status,'running');
    assert.equal(verifying.delivery.rounds,0);assert.equal(verifying.delivery.calls,0);
    assert.equal(verifying.delivery.task_acceptance.status,'unknown');assert.equal(verifying.delivery.recovery.ready,false);
    assert.equal(verifying.progress.available,true);assert.equal(verifying.progress.phase,'verifying');
    assert.deepEqual(verifying.progress.budget,{max_rounds:4,max_calls:4,used_rounds:2,used_calls:2,reserved_calls:1});
    assert.ok(Number.isFinite(Date.parse(verifying.progress.observed_at)));
    assert.equal(Object.hasOwn(verifying.progress,'task_acceptance'),false);assert.equal(Object.hasOwn(verifying.progress,'recovery'),false);
    const unsealed=taskFiles(f.root,id,f.registry);
    assert.equal(unsealed.delivery.task_acceptance.status,'unknown');assert.equal(unsealed.progress.budget.used_rounds,3);
  }finally {claim.finish();}
  const sealed=taskFiles(f.root,id,f.registry);
  assert.equal(sealed.progress,null);assert.equal(sealed.delivery.task_acceptance.status,'passed');assert.equal(sealed.delivery.rounds,3);
});

test('unreadable live progress keeps candidate browsing and sealed acceptance available',t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry),id=path.basename(task.directory);
  const directory=f.attempt('preview-unreadable'),claim=claimAgentTask(f.root,task.directory,f.registry,directory);
  try {
    fs.writeFileSync(path.join(directory,'verification-loop.json'),'{incomplete');
    const listing=taskFiles(f.root,id,f.registry);
    assert.equal(listing.delivery.status,'running');assert.equal(listing.delivery.task_acceptance.status,'unknown');
    assert.equal(listing.delivery.recovery.ready,false);assert.equal(listing.progress.available,false);
    assert.equal(Object.hasOwn(listing.progress,'budget'),false);assert.ok(listing.files.length>0);
    assert.ok(readTaskSource(f.root,id,'design/dut.sv',f.registry).candidate.lines.length>0);
  }finally {claim.finish();}
});
