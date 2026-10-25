// Offline integration receipt: real workflow/trace/ACE Python bridge, deterministic
// generator and fake XSim. This checks the harness and is not an RTL benchmark.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {createTrace} from '../src/trace.mjs';
import {runAgentSession} from '../src/agent-session.mjs';
import {inspectWorkflow} from '../src/workflow.mjs';

const project=path.resolve(import.meta.dirname,'..');
const root=path.join(project,'artifacts',`ace-loop-demo-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,6)}`);
fs.mkdirSync(root,{recursive:true});
// A source snapshot isolates this receipt from later development in the workspace.
for(const folder of ['src','knowledge','.pi/skills'])fs.cpSync(path.join(project,folder),path.join(root,folder),{recursive:true,filter:file=>!file.includes('__pycache__')});
for(const file of ['scripts/trace-inspect.mjs','scripts/check-knowledge.mjs','scripts/eda-tool.mjs','scripts/replay-experiment.mjs','scripts/collect-system-evidence.py','scripts/ace-rtl-feedback.py',
  'projects/system-bench/run.py','projects/system-bench/implement-common.tcl','docs/workflows.md','docs/reference/tools.md','docs/results.md',
  'vendor/ace-rtl/skills/ace-rtl/scripts/ace_rtl_agent/context_builder.py','vendor/ace-rtl/skills/ace-rtl/scripts/ace_rtl_agent/fresh_start_coordinator.py']){
  fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(project,file),path.join(root,file));
}
fs.writeFileSync(path.join(root,'candidate.sv'),'module candidate(input clk); // intentionally failing fixture\nendmodule\n');
fs.writeFileSync(path.join(root,'fixed_tb.sv'),'module fixed_tb; // immutable synthetic checker; no HDL simulator is run\nendmodule\n');
fs.writeFileSync(path.join(root,'fixed.xdc'),'create_clock -period 10 [get_ports clk]\n');
const spec={schema_version:1,id:'ace-loop-offline',goal:'Verify the harness repairs a rejected candidate while retaining the independent fixed verifier',
  inputs:['candidate.sv','fixed_tb.sv','fixed.xdc'],limits:{max_calls:1,wall_seconds:30},
  steps:[{id:'simulation',tool:'eda_xsim',args:{sources:['candidate.sv','fixed_tb.sv'],top:'fixed_tb',pass_marker:'HARNESS_FIXTURE_PASS'},
    checks:[{pointer:'/simulation_acceptance/status',op:'eq',value:'pass'}]}],
  acceptance:{profile:'rtl_simulation',bindings:{functional:'simulation'}}};
fs.writeFileSync(path.join(root,'workflow.json'),JSON.stringify(spec,null,2)+'\n');
// Only this isolated fake-SDK fixture enables the driver gate. No SDK/model
// client is constructed; the real workspace configuration remains disabled.
fs.mkdirSync(path.join(root,'.eda'));
fs.writeFileSync(path.join(root,'.eda/config.json'),JSON.stringify({schema_version:1,model_api_enabled:true,resources:{xsim:2,vivado:1,ltspice:1,verify:4},queue_timeout_ms:1000}));
const registry=new Map(),sops=JSON.parse(fs.readFileSync(path.join(root,'knowledge/sops.json'),'utf8')).sops;
for(const name of new Set(sops.flatMap(s=>s.required_tools)))registry.set(name,{name,parameters:{type:'object',additionalProperties:true},async execute(){throw new Error(`Unexpected tool: ${name}`);}});
let generations=0,verifierCalls=0;
registry.set('eda_xsim',{name:'eda_xsim',parameters:{type:'object',additionalProperties:true},async execute(id,args,signal,_update,ctx){
  signal?.throwIfAborted();verifierCalls++;
  const trace=createTrace({root,tool:'eda_xsim',args,toolCallId:id,context:ctx?.edaTraceContext});
  for(const file of args.sources)trace.capture(file,'fixed_demo_input');
  const pass=fs.readFileSync(path.join(root,args.sources[0]),'utf8').includes('REPAIRED_FIXTURE');
  return {details:trace.finish('completed',null,{transcript_tail:pass?'HARNESS_FIXTURE_PASS':'ERROR: fixture scoreboard mismatch at cycle 12',
    simulation_acceptance:{status:pass?'pass':'fail',pass_marker:args.pass_marker,marker_matches:pass?1:0,completion_observed:true,failure_diagnostic:!pass}})};
}});
const configuration={spec:'workflow.json',editable_sources:['candidate.sv'],max_rounds:3,max_calls:3};
fs.writeFileSync(path.join(root,'verification.json'),JSON.stringify(configuration,null,2)+'\n');
const original=fs.readFileSync(path.join(root,'fixed_tb.sv'));
const originalRtl=fs.readFileSync(path.join(root,'candidate.sv'));
let listener,candidate;
const sessionResult=await runAgentSession({root,verification:configuration,prompt:'Run the synthetic repair demonstration.',
  limits:{maxTurns:4,timeoutSeconds:60},sessionFactory:async()=>({registry,session:{
    model:{provider:'offline-fixture',id:'no-model'},sessionId:'offline-demo',
    getSessionStats:()=>({sessionId:'offline-demo',tokens:{input:0,output:0,total:0},cost:0}),
    subscribe:fn=>{listener=fn;return ()=>{};},bindExtensions:async()=>{},abort(){},dispose(){},
    prompt:async prompt=>{
      generations++;listener({type:'turn_start'});
      if(generations===1)candidate=JSON.parse(prompt.split('[Host verification contract]\n')[1].split('\n')[0]).editable_sources[0];
      fs.writeFileSync(path.join(root,`generation-${generations}.txt`),prompt);
      if(generations===2)fs.writeFileSync(path.join(root,candidate),'module candidate(input clk); // REPAIRED_FIXTURE\nendmodule\n');
      listener({type:'message_end',message:{role:'assistant',content:[{type:'text',text:'Untrusted generator claims PASS'}],stopReason:'stop'}});
    }
  }})});
const result=sessionResult.run.verification,directory=sessionResult.directory;
const rechecked=result.last_directory?inspectWorkflow(root,result.last_directory):null;
const upstream=result.rounds[0]?.feedback;
const passed=sessionResult.run.task_acceptance.status==='passed'&&sessionResult.run.delivery?.originals_preserved===true&&
  originalRtl.equals(fs.readFileSync(path.join(root,'candidate.sv')))&&result.status==='passed'&&result.rounds.length===2&&generations===2&&verifierCalls===2&&
  result.rounds[0].task_acceptance.status==='failed'&&rechecked?.valid&&rechecked.task_acceptance.status==='passed'&&
  original.equals(fs.readFileSync(path.join(root,'fixed_tb.sv')))&&upstream?.model_api_calls===0&&upstream?.upstream_commit==='94754d796350d42502c9a32639a20d86f50e9678';
const report={schema_version:1,scope:'fake_sdk_and_eda_real_task_session_workflow_delivery_and_upstream_python',passed,directory,root,generations,verifier_calls:verifierCalls,
  task:sessionResult.run.task,delivery:sessionResult.run.delivery,original_rtl_preserved:originalRtl.equals(fs.readFileSync(path.join(root,'candidate.sv'))),
  round_statuses:result.rounds.map(round=>round.task_acceptance.status),upstream_commit:upstream?.upstream_commit,upstream_components:upstream?.component_names,
  other_model_api_calls:0,vivado_runs:0,outer_codex_tokens:null,
  fixed_checker_sha256:createHash('sha256').update(original).digest('hex'),loop_status:result.status,reason:result.reason||null};
fs.writeFileSync(path.join(root,'result.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(!passed)process.exitCode=1;
