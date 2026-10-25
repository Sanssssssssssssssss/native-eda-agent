import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {compileAcceptance,evaluateTask,recoveryAdvice} from '../src/task-outcome.mjs';
import {taskContext} from '../src/task-context.mjs';
import {createJiti} from 'jiti';
const root=path.resolve(import.meta.dirname,'..');
const spec=()=>JSON.parse(fs.readFileSync(path.join(root,'examples/workflows/axi-fabric-ooc.json'),'utf8'));
function accepted(){
  const contract=compileAcceptance(spec());
  const fpga={part:contract.design.part,design:contract.design.top,clocks:[{name:contract.design.clock,period_ns:10}],black_boxes:0,setup_slack_ns:0.5,hold_slack_ns:0.1,assessment:{clock_and_internal_constraints:'pass',io_constraints:'pass'},parsed_reports:{route:{status:'pass'}},drc:{errors:0,critical_warnings:0,warnings:0}};
  return {contract,results:{simulation:{simulation_acceptance:{status:'pass',pass_marker:'HARD_BENCH_PASS project=axi_fabric',marker_matches:1,completion_observed:true,failure_diagnostic:false}},synthesis:{fpga:structuredClone(fpga)},implementation:{fpga:structuredClone(fpga)},'drc-report':{fpga:structuredClone(fpga)}}};
}
test('bound engineering goal evaluates each domain and leaves formal/hardware unevaluated',()=>{
  const {contract,results}=accepted(),r=evaluateTask(contract,results,[]);assert.equal(r.status,'passed');assert.equal(r.domains.find(r=>r.domain==='cdc').status,'not_requested');assert.equal(r.hardware,'not_evaluated');
  assert.equal(evaluateTask(null,results,[]).reason,'goal_scope_unbound');
});
test('a completed DRC report with no violation counts remains unknown',()=>{
  const {contract,results}=accepted();delete results['drc-report'].fpga.drc;results['drc-report'].fpga.reports=[{name:'drc',status:'ok'}];
  assert.equal(evaluateTask(contract,results,[]).status,'unknown');
});
test('a passing marker from a different checker cannot satisfy the bound functional target',()=>{
  const {contract,results}=accepted();results.simulation.simulation_acceptance.pass_marker='OTHER_DESIGN_PASS';
  assert.notEqual(evaluateTask(contract,results,[]).status,'passed');
});
test('DRC warnings require review and critical violations fail regardless of positive timing',()=>{
  const {contract,results}=accepted();results['drc-report'].fpga.drc.warnings=2;assert.equal(evaluateTask(contract,results,[]).status,'review_required');
  results['drc-report'].fpga.drc.critical_warnings=1;assert.equal(evaluateTask(contract,results,[]).status,'failed');
});
test('clock relaxation, wrong part and unobserved metrics cannot satisfy fixed target',()=>{
  for(const mutate of [f=>f.clocks[0].period_ns=20,f=>f.part='wrong',f=>f.hold_slack_ns=-0.01]){
    const {contract,results}=accepted();mutate(results.implementation.fpga);assert.equal(evaluateTask(contract,results,[]).status,'failed');
  }
  const {contract,results}=accepted();results.implementation.fpga.setup_slack_ns=null;assert.equal(evaluateTask(contract,results,[]).status,'unknown');
  assert.equal(evaluateTask(contract,accepted().results,[],['artifact_changed']).status,'unknown');
});
test('acceptance cannot bind a preflight boolean as functional evidence or mix unrelated DCPs',()=>{
  const s=spec();s.steps[0].tool='eda_preflight';assert.throws(()=>compileAcceptance(s),/binding/);
  const s2=spec();s2.steps[2].args.checkpoint='other.dcp';assert.throws(()=>compileAcceptance(s2),/bound synthesis/);
  const s3=spec();s3.steps[3].args.checkpoint={$result:{step:'synthesis',pointer:'/fpga/artifacts/synthesized.dcp'}};assert.throws(()=>compileAcceptance(s3),/bound routed/);
});
test('simulation and synthesis source/parameter mismatches fail before dispatch',()=>{
  const s=spec();s.steps[0].args.sources=s.steps[0].args.sources.slice(1);assert.throws(()=>compileAcceptance(s),/every accepted/);
  const t=spec();t.steps[1].args.defines=['BYPASS_CHECKS=1'];assert.throws(()=>compileAcceptance(t),/defines differ/);
  const u=spec();delete u.acceptance.bindings.hold;assert.throws(()=>compileAcceptance(u),/unbound/);
});
test('SOP routing uses phase intent and publishes only existing tool contracts',async()=>{
  const registry=new Map();(await createJiti(import.meta.url).import('../src/extension.ts',{default:true}))({registerTool:t=>registry.set(t.name,t)});
  const cases=[['planning','AXI 接口复位规格','fpga-plan'],['simulation','背压下 data 丢失','fpga-rtl-verify'],['timing','hold 违例时序约束','fpga-timing-triage'],['recovery','恢复中断任务证据','fpga-reproduce'],['cdc','跨时钟总线一致性','fpga-cdc-review'],['ip','IP 版本仿真库','fpga-ip-integrate']];
  for(const [phase,query,id]of cases){const c=taskContext(root,{phase,query},registry);assert.equal(c.sops[0].sop.id,id);assert.ok(c.tools.length);assert.ok(c.tools.every(t=>registry.has(t.name)));assert.equal(c.model_api_calls,0);}
});
test('unrelated retrieval yields no fabricated SOP or tool context',()=>{
  const c=taskContext(root,{query:'zxqv_not_in_corpus'},new Map());assert.equal(c.rules.length,0);assert.equal(c.sops.length,0);assert.equal(c.tools.length,0);
});
test('same failure threshold is scoped and does not reset on unrelated run metadata',()=>{
  const state={plan:{spec:{steps:[{id:'x'}]}},passed:[],outcome:'tool_error',error:'failed',failure_history:[{fingerprint:'same'},{fingerprint:'same'},{fingerprint:'different'},{fingerprint:'same'}]};
  assert.equal(recoveryAdvice(state).stalled,true);assert.equal(recoveryAdvice(state).automatic_retry,false);
});
