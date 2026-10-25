import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createTrace} from '../../src/trace.mjs';

// Synthetic verdicts exercise real task/workflow/trace machinery, not an HDL compiler.
export function taskFixture(t) {
  const project=path.resolve(import.meta.dirname,'../..');
  const root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'eda-task-lifecycle-'));
  t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  for(const dir of ['knowledge','.pi/skills'])fs.cpSync(path.join(project,dir),path.join(root,dir),{recursive:true});
  for(const file of ['src/workflow.mjs','src/agent-task.mjs','src/verifier-loop.mjs','src/knowledge.mjs','src/trace.mjs','scripts/check-knowledge.mjs','scripts/eda-tool.mjs','scripts/replay-experiment.mjs','scripts/collect-system-evidence.py','projects/system-bench/run.py','projects/system-bench/implement-common.tcl','docs/workflows.md','docs/reference/tools.md','docs/results.md']){
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(project,file),path.join(root,file));
  }
  fs.mkdirSync(path.join(root,'design/include'),{recursive:true});
  fs.writeFileSync(path.join(root,'design/dut.sv'),'`include "defs.svh"\nmodule dut; // BROKEN\nendmodule\n');
  fs.writeFileSync(path.join(root,'design/checker.sv'),'module tb; // fixed independent oracle\nendmodule\n');
  fs.writeFileSync(path.join(root,'design/include/defs.svh'),'`define WIDTH 8\n');
  fs.writeFileSync(path.join(root,'design/fixed.xdc'),'create_clock -period 10 [get_ports clk]\n');
  const spec={schema_version:1,id:'task-lifecycle-fixture',goal:'Repair RTL while retaining fixed interfaces and verification',
    inputs:['design/dut.sv','design/checker.sv','design/fixed.xdc'],limits:{max_calls:1,wall_seconds:15},
    steps:[{id:'sim',tool:'eda_xsim',args:{sources:['design/dut.sv','design/checker.sv'],include_dirs:['design/include'],top:'tb',pass_marker:'FIXED_PASS'},checks:[{pointer:'/simulation_acceptance/status',op:'eq',value:'pass'}]}],
    acceptance:{profile:'rtl_simulation',bindings:{functional:'sim'}}};
  fs.writeFileSync(path.join(root,'spec.json'),JSON.stringify(spec));
  const registry=new Map(),calls=[];
  for(const name of new Set(JSON.parse(fs.readFileSync(path.join(root,'knowledge/sops.json'))).sops.flatMap(s=>s.required_tools)))registry.set(name,{name,description:'Offline fixture',parameters:{type:'object',additionalProperties:true},execute(){throw new Error(`Unexpected tool: ${name}`);}});
  registry.set('eda_xsim',{name:'eda_xsim',description:'Synthetic verifier',parameters:{type:'object',additionalProperties:true},
    async execute(id,args,signal,_update,ctx){
      signal?.throwIfAborted();const trace=createTrace({root,tool:'eda_xsim',args,toolCallId:id,context:ctx?.edaTraceContext});
      for(const name of args.sources)trace.capture(path.resolve(root,name),'source');trace.finalizeDependencies();
      const code=fs.readFileSync(path.resolve(root,args.sources[0]),'utf8');calls.push({args,directory:trace.directory,code});
      const pass=code.includes('CANDIDATE_OK');
      return {details:trace.finish('completed',null,{simulation_acceptance:{status:pass?'pass':'fail',pass_marker:'FIXED_PASS',marker_matches:pass?1:0,completion_observed:true,failure_diagnostic:!pass}})};
    }});
  const configuration={spec:'spec.json',editable_sources:['design/dut.sv'],max_rounds:4,max_calls:4};
  const attempt=name=>{const directory=path.join(root,'artifacts',name);fs.mkdirSync(directory,{recursive:true});return directory;};
  const feedback=async()=>({context:'Use the independent failure report to repair the fixed candidate.',decision:{should_restart:false},model_api_calls:0});
  return {root,registry,configuration,calls,attempt,feedback};
}
