import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {taskFixture} from './fixtures/agent-task.mjs';
import {prepareAgentTask} from '../src/agent-task.mjs';
import {taskFiles,readTaskSource,projectTasks} from '../src/workbench-task-files.mjs';

test('candidate preview exposes the admitted source pair, line pages and frozen-original drift',t=>{
  const f=taskFixture(t),task=prepareAgentTask(f.root,f.configuration,f.registry),id=path.basename(task.directory);
  const listing=taskFiles(f.root,id,f.registry);
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
