import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createTrace} from '../src/trace.mjs';
import {createWorkflowTools,inspectWorkflow} from '../src/workflow.mjs';
import {taskContext} from '../src/task-context.mjs';

const project=path.resolve(import.meta.dirname,'..');

// Run the real workflow/trace/acceptance code against deterministic fake EDA
// tools. Each test owns its inputs, receipts and knowledge bundle.
function fixture(t,{failure=null,unbound=false,throwTool=false}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'eda-context-feedback-'));
  t.after(()=>{
    const relative=path.relative(os.tmpdir(),fs.realpathSync(root));
    assert.ok(relative.startsWith('eda-context-feedback-')&&!relative.includes(path.sep));
    fs.rmSync(root,{recursive:true,force:true});
  });
  for(const directory of ['knowledge','.pi/skills'])fs.cpSync(path.join(project,directory),path.join(root,directory),{recursive:true});
  for(const file of ['src/workflow.mjs','src/knowledge.mjs','src/trace.mjs','scripts/check-knowledge.mjs','scripts/eda-tool.mjs','scripts/replay-experiment.mjs','scripts/collect-system-evidence.py','projects/system-bench/run.py','projects/system-bench/implement-common.tcl','docs/workflows.md','docs/reference/tools.md','docs/results.md']){
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(project,file),path.join(root,file));
  }
  fs.writeFileSync(path.join(root,'rtl.sv'),'module dut(input clk); endmodule\n');
  fs.writeFileSync(path.join(root,'tb.sv'),'module tb; endmodule\n');
  fs.writeFileSync(path.join(root,'fixed.xdc'),'create_clock -period 10 [get_ports clk]\n');
  const spec={schema_version:1,id:'context-feedback',goal:'Fixed synthetic evidence for context routing',inputs:['rtl.sv','tb.sv','fixed.xdc'],limits:{max_calls:16,wall_seconds:60},steps:[
    {id:'simulation',tool:'eda_xsim',args:{sources:['rtl.sv','tb.sv'],top:'tb',pass_marker:'FIXED_PASS'},checks:[{pointer:'/simulation_acceptance/status',op:'eq',value:'pass'}]},
    {id:'synthesis',tool:'eda_vivado_synthesize',args:{sources:['rtl.sv'],constraints:['fixed.xdc'],top:'dut',part:'xc7a100tfgg676-2'},checks:[{pointer:'/fpga/black_boxes',op:'eq',value:0}]},
    {id:'implementation',tool:'eda_vivado_implement',args:{checkpoint:{$result:{step:'synthesis',pointer:'/fpga/artifacts/synthesized.dcp'}}},checks:[{pointer:'/fpga/assessment/setup_hold',op:'eq',value:'pass'}]},
    {id:'drc-report',tool:'eda_vivado_report_drc',args:{checkpoint:{$result:{step:'implementation',pointer:'/fpga/artifacts/routed.dcp'}}},checks:[{pointer:'/fpga/reports/0/status',op:'eq',value:'ok'}]}
  ],acceptance:{profile:'fpga_ooc',bindings:{functional:'simulation',synthesis:'synthesis',setup:'implementation',hold:'implementation',constraints:'implementation',routing:'implementation',drc:'drc-report',cdc:'implementation'},design:{top:'dut',part:'xc7a100tfgg676-2',clock:'clk',period_ns:10}}};
  if(unbound)delete spec.acceptance;
  fs.writeFileSync(path.join(root,'task.json'),JSON.stringify(spec));
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'knowledge/sops.json'),'utf8')).sops;
  const calls=[],registry=new Map();
  for(const name of new Set([...catalog.flatMap(s=>s.required_tools),...spec.steps.map(s=>s.tool)]))registry.set(name,{
    name,description:`Fixture contract for ${name}`,parameters:{type:'object',additionalProperties:true},
    async execute(id,args,signal,_update,ctx){
      calls.push(name);
      const trace=createTrace({root,tool:name,args,toolCallId:id,context:ctx?.edaTraceContext});
      trace.capture(path.join(root,'rtl.sv'),'fixed_rtl');trace.finalizeDependencies();
      try{
        if(throwTool)throw new Error('Synthetic repeated simulator failure');
        let result;
        if(name==='eda_xsim')result={simulation_acceptance:{status:failure==='functional'?'fail':'pass',pass_marker:'FIXED_PASS',marker_matches:1,completion_observed:true,failure_diagnostic:failure==='functional'}};
        else{
          const fpga={part:'xc7a100tfgg676-2',design:'dut',clocks:[{name:'clk',period_ns:10}],black_boxes:failure==='synthesis'?1:0,
            setup_slack_ns:failure==='setup'?-0.2:0.5,hold_slack_ns:0.1,
            assessment:{setup_hold:failure==='setup'?'fail':'pass',clock_and_internal_constraints:'pass',io_constraints:'pass',cdc:failure==='cdc'?'review_required':'pass'},
            parsed_reports:{route:{status:'pass'}},drc:{errors:0,critical_warnings:0,warnings:failure==='drc'?1:0},reports:[{name:'drc',status:'ok'}]};
          if(['eda_vivado_synthesize','eda_vivado_implement'].includes(name)){
            const key=name==='eda_vivado_synthesize'?'synthesized.dcp':'routed.dcp',file=path.join(trace.directory,key);
            fs.writeFileSync(file,`Synthetic ${key}`);fpga.artifacts={[key]:file};
          }
          result={fpga};
        }
        return {details:trace.finish('completed',null,result)};
      }catch(error){throw Object.assign(error,{receipt:trace.finish(signal?.aborted?'cancelled':'failed',error)});}
    }
  });
  const tools=new Map(createWorkflowTools(root,registry).map(tool=>[tool.name,tool]));
  const run=(directory)=>tools.get(directory?'eda_workflow_resume':'eda_workflow_run').execute('context-fixture',directory?{directory}:{spec:'task.json'});
  const context=(directory,args={})=>{
    const before=inspectWorkflow(root,directory),count=calls.length;
    const response=taskContext(root,{query:'继续处理这个',directory,...args},registry);
    assert.equal(calls.length,count,'Context selection must not execute a tool');
    assert.deepEqual(inspectWorkflow(root,directory).task_acceptance,before.task_acceptance,'Context selection must not change acceptance');
    assert.equal(response.model_api_calls,0);
    assert.equal(response.selection.automatic_execution,false);
    return response;
  };
  return {root,calls,run,context};
}

test('ambiguous continuation uses verified setup failure to select timing guidance',async t=>{
  const f=fixture(t,{failure:'setup'}),run=await f.run();
  assert.equal(run.details.outcome,'checks_failed');
  const result=f.context(run.details.directory);
  assert.equal(result.observation.valid,true);
  assert.equal(result.selection.inferred_phase,'timing');
  assert.equal(result.selection.method,'workflow_evidence');
  assert.equal(result.sops[0].sop.id,'fpga-timing-triage');
  assert.ok(result.selection.basis.some(b=>b.domain==='setup'&&b.status==='failed'&&b.evidence.sha256));
  assert.match(result.retrieval.query,/setup hold/);
});

test('failed functional evidence takes precedence over unobserved physical domains',async t=>{
  const f=fixture(t,{failure:'functional'}),run=await f.run(),result=f.context(run.details.directory);
  assert.equal(f.calls.length,1);
  assert.equal(result.selection.inferred_phase,'simulation');
  assert.equal(result.sops[0].sop.id,'fpga-rtl-verify');
  assert.ok(result.selection.unmet_domains.some(d=>d.domain==='setup'&&d.status==='unknown'));
  assert.equal(result.observation.task_acceptance.status,'failed');
});

test('tampered committed evidence selects integrity recovery before domain guidance',async t=>{
  const f=fixture(t,{failure:'setup'}),run=await f.run();
  const checked=inspectWorkflow(f.root,run.details.directory);
  fs.appendFileSync(path.join(f.root,checked.state.passed[0].result_path),' ');
  const result=f.context(run.details.directory);
  assert.equal(result.observation.valid,false);
  assert.equal(result.observation.task_acceptance.status,'unknown');
  assert.equal(result.selection.inferred_phase,'recovery');
  assert.equal(result.selection.reason,'evidence_integrity_requires_review');
  assert.deepEqual(result.sops.map(s=>s.sop.id),['fpga-reproduce']);
});

test('explicit phase override publishes its conflict and preserves the failed target',async t=>{
  const f=fixture(t,{failure:'setup'}),run=await f.run(),result=f.context(run.details.directory,{phase:'simulation'});
  assert.equal(result.phase,'simulation');
  assert.equal(result.selection.effective_phase,'simulation');
  assert.equal(result.selection.inferred_phase,'timing');
  assert.deepEqual([result.selection.conflict.explicit_phase,result.selection.conflict.inferred_phase],['simulation','timing']);
  assert.equal(result.sops[0].selection.method,'explicit_phase');
  assert.equal(result.sops[0].sop.id,'fpga-rtl-verify');
  assert.equal(result.observation.task_acceptance.status,'failed');
  assert.equal(result.selection.acceptance_changed,false);
});

test('completed accepted task selects evidence delivery without offering another EDA run',async t=>{
  const f=fixture(t),run=await f.run(),result=f.context(run.details.directory,{query:'继续修复 setup 时序并仿真'});
  assert.equal(result.observation.task_acceptance.status,'passed');
  assert.equal(result.selection.inferred_phase,'review');
  assert.equal(result.selection.next_action,'deliver_evidence');
  assert.deepEqual(result.sops.map(s=>s.sop.id),['fpga-reproduce']);
  assert.ok(result.tools.every(tool=>['eda_trace_inspect','eda_workflow_inspect','eda_workflow_resume_check','eda_results_verify'].includes(tool.name)));
});

test('three real failed recovery segments choose diagnosis before another simulation',async t=>{
  const f=fixture(t,{throwTool:true});let run=await f.run();
  for(let i=0;i<2;i++)run=await f.run(run.details.directory);
  const result=f.context(run.details.directory);
  assert.equal(f.calls.length,3);
  assert.equal(result.observation.recovery.stalled,true);
  assert.equal(result.selection.inferred_phase,'recovery');
  assert.equal(result.selection.next_action,'diagnose_before_new_task');
  assert.deepEqual(result.sops.map(s=>s.sop.id),['fpga-reproduce']);
});

test('completed steps with an unbound engineering goal select scope review without claiming acceptance',async t=>{
  const f=fixture(t,{unbound:true}),run=await f.run(),result=f.context(run.details.directory);
  assert.equal(result.observation.outcome,'passed');
  assert.equal(result.observation.task_acceptance.status,'unknown');
  assert.equal(result.selection.inferred_phase,'review');
  assert.equal(result.selection.next_action,'review_unbound_goal');
});

for(const [domain,phase,sop]of [['synthesis','planning','fpga-plan'],['cdc','cdc','fpga-cdc-review'],['drc','timing','fpga-timing-triage']]){
  test(`${domain} acceptance routes to ${phase} from verified workflow receipts`,async t=>{
    const f=fixture(t,{failure:domain}),run=await f.run(),result=f.context(run.details.directory);
    assert.equal(result.observation.valid,true);
    assert.equal(result.selection.inferred_phase,phase);
    assert.equal(result.sops[0].sop.id,sop);
  });
}
