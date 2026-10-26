import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createTrace} from '../src/trace.mjs';
import {inspectWorkflow} from '../src/workflow.mjs';
import {runVerifiedLoop,aceFeedback} from '../src/verifier-loop.mjs';

const project=path.resolve(import.meta.dirname,'..');
const sha=value=>createHash('sha256').update(value).digest('hex');

test('feedback subprocess preserves UTF-8 split across stdout and stderr chunks',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'eda-feedback-utf8-'));
  t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(os.tmpdir()));assert.ok(path.basename(root).startsWith('eda-feedback-utf8-'));fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'scripts'));
  fs.writeFileSync(path.join(root,'scripts/ace-rtl-feedback.py'),String.raw`import sys, json, time
request = json.loads(sys.stdin.buffer.read())
data = json.dumps({"context":"AXI时序🔧复核"}, ensure_ascii=False).encode("utf-8")
stream = sys.stderr.buffer if request.get("fail") else sys.stdout.buffer
cut = data.index("时".encode("utf-8")) + 1
stream.write(data[:cut]); stream.flush()
time.sleep(0.05)
stream.write(data[cut:]); stream.flush()
sys.exit(2 if request.get("fail") else 0)
`);
  assert.equal((await aceFeedback(root,{})).context,'AXI时序🔧复核');
  await assert.rejects(aceFeedback(root,{fail:true}),/ACE feedback failed \(2\).*AXI时序🔧复核/);
});

function fixture(t,{unbound=false,unknown=false,beforeVerify}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'eda-verifier-loop-'));
  t.after(()=>{
    const relative=path.relative(os.tmpdir(),fs.realpathSync(root));
    assert.ok(relative.startsWith('eda-verifier-loop-')&&!relative.includes(path.sep));
    fs.rmSync(root,{recursive:true,force:true});
  });
  for(const directory of ['knowledge','.pi/skills'])fs.cpSync(path.join(project,directory),path.join(root,directory),{recursive:true});
  for(const file of ['src/workflow.mjs','src/knowledge.mjs','src/trace.mjs','scripts/check-knowledge.mjs','scripts/eda-tool.mjs','scripts/replay-experiment.mjs','scripts/collect-system-evidence.py','projects/system-bench/run.py','projects/system-bench/implement-common.tcl','docs/workflows.md','docs/reference/tools.md','docs/results.md']){
    fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(project,file),path.join(root,file));
  }
  const writeRtl=marker=>fs.writeFileSync(path.join(root,'rtl.sv'),`module dut(input clk); // ${marker}\nendmodule\n`);
  writeRtl('INITIAL_FAIL');
  fs.writeFileSync(path.join(root,'tb.sv'),'module tb; // immutable checker\nendmodule\n');
  fs.writeFileSync(path.join(root,'fixed.xdc'),'create_clock -period 10 [get_ports clk]\n');
  const spec={schema_version:1,id:'verifier-loop-fixture',goal:'Repair the fixture RTL against the immutable verifier',
    inputs:['rtl.sv','tb.sv','fixed.xdc'],limits:{max_calls:1,wall_seconds:20},
    steps:[{id:'simulation',tool:'eda_xsim',args:{sources:['rtl.sv','tb.sv'],top:'tb',pass_marker:'FIXED_PASS'},
      checks:[unknown?{pointer:'/ok',op:'eq',value:true}:{pointer:'/simulation_acceptance/status',op:'eq',value:'pass'}]}],
    acceptance:{profile:'rtl_simulation',bindings:{functional:'simulation'}}};
  if(unbound)delete spec.acceptance;
  const specFile=path.join(root,'task.json');fs.writeFileSync(specFile,JSON.stringify(spec,null,2));
  const fixedHashes=Object.fromEntries(['tb.sv','fixed.xdc','task.json'].map(file=>[file,sha(fs.readFileSync(path.join(root,file)))]));
  const calls=[],generations=[],feedbackCalls=[],states=[],registry=new Map();
  const catalog=JSON.parse(fs.readFileSync(path.join(root,'knowledge/sops.json'),'utf8')).sops;
  for(const name of new Set(catalog.flatMap(s=>s.required_tools)))registry.set(name,{
    name,description:`Fixture contract for ${name}`,parameters:{type:'object',additionalProperties:true},
    async execute(){throw new Error(`Unexpected dispatch outside the fixed verifier: ${name}`);}
  });
  registry.set('eda_xsim',{name:'eda_xsim',description:'Deterministic fake XSim with real trace and host acceptance',parameters:{type:'object',additionalProperties:true},
    async execute(id,args,signal,_update,ctx){
      const trace=createTrace({root,tool:'eda_xsim',args,toolCallId:id,context:ctx?.edaTraceContext});
      for(const file of ['rtl.sv','tb.sv','fixed.xdc'])trace.capture(path.join(root,file),'fixed_verifier_input');
      trace.finalizeDependencies();
      calls.push({args:structuredClone(args),directory:trace.directory,rtl:fs.readFileSync(path.join(root,'rtl.sv'),'utf8')});
      try{
        signal?.throwIfAborted();await beforeVerify?.({signal,root,trace});signal?.throwIfAborted();
        const passed=calls.at(-1).rtl.includes('CANDIDATE_OK');
        const result=unknown?{ok:true}:{simulation_acceptance:{status:passed?'pass':'fail',pass_marker:'FIXED_PASS',marker_matches:passed?1:0,completion_observed:true,failure_diagnostic:!passed}};
        return {details:trace.finish('completed',null,result)};
      }catch(error){throw Object.assign(error,{receipt:trace.finish(signal?.aborted?'cancelled':'failed',error)});}
    }
  });
  const directory=path.join(root,'artifacts','loop-session');fs.mkdirSync(directory,{recursive:true});
  const run=({generate=async()=> 'Model claims completion.',feedback,configuration={},signal}={})=>runVerifiedLoop({
    root,configuration:{spec:'task.json',editable_sources:['rtl.sv'],max_rounds:4,max_calls:4,...configuration},registry,
    prompt:'Repair the RTL and satisfy the fixed checker.',directory,signal,
    generate:async text=>{generations.push(text);return generate(text,generations.length);},
    feedback:async input=>{feedbackCalls.push(input);return feedback?feedback(input):{context:'Review the verifier failure and repair only rtl.sv.',decision:{should_restart:false,reason:'Fixed verifier evidence requires a repair.'},model_api_calls:0};},
    onState:state=>states.push(structuredClone(state))
  });
  const assertFixed=()=>assert.deepEqual(Object.fromEntries(Object.keys(fixedHashes).map(file=>[file,sha(fs.readFileSync(path.join(root,file)))])),fixedHashes);
  return {root,spec,specFile,calls,generations,feedbackCalls,states,run,writeRtl,assertFixed};
}

test('independent verifier rejects the first candidate and accepts the repaired second candidate',async t=>{
  const f=fixture(t),result=await f.run({generate:async(_text,round)=>{f.writeRtl(round===1?'BROKEN_REVISION_1':'CANDIDATE_OK');return 'I finished and all tests passed.';}});
  assert.equal(result.status,'passed');
  assert.equal(result.task_acceptance.status,'passed');
  assert.equal(f.generations.length,2);
  assert.equal(f.calls.length,2);
  assert.equal(result.rounds.length,2);
  assert.equal(result.rounds[0].task_acceptance.status,'failed');
  assert.equal(result.rounds[1].task_acceptance.status,'passed');
  assert.notEqual(result.rounds[0].directory,result.rounds[1].directory);
  assert.notEqual(result.rounds[0].candidate_sha256,result.rounds[1].candidate_sha256);
  const fresh=inspectWorkflow(f.root,result.rounds[1].directory);
  assert.equal(fresh.valid,true);
  assert.equal(fresh.task_acceptance.status,'passed');
  assert.equal(f.feedbackCalls.length,1);
  const diagnosis=JSON.parse(f.feedbackCalls[0].error_report);
  assert.equal(diagnosis.domains.find(row=>row.domain==='functional').observed.failure_diagnostic,true);
  assert.equal(diagnosis.domains.find(row=>row.domain==='functional').observed.marker_matches,0);
  assert.equal(diagnosis.evidence.workflow,result.rounds[0].directory);
  f.assertFixed();
});

test('a compiler failure supplies verified diagnostics to repair before the next evaluation',async t=>{
  let compilations=0;
  const f=fixture(t,{beforeVerify:async({trace})=>{
    if(++compilations===1){
      fs.writeFileSync(path.join(trace.directory,'process.log'),"ERROR: [VRFC 10-4982] syntax error near '[' at rtl.sv:1\n");
      throw new Error('xvlog failed');
    }
  }});
  const result=await f.run({generate:async(_prompt,round)=>{if(round===2)f.writeRtl('CANDIDATE_OK');return 'Done';}});
  assert.equal(result.status,'passed');
  assert.equal(f.calls.length,2);
  const diagnosis=JSON.parse(f.feedbackCalls[0].error_report);
  assert.match(diagnosis.diagnostic,/VRFC 10-4982/);
  assert.match(diagnosis.error,/xvlog failed/);
  assert.ok(diagnosis.evidence.failed_tool);
  assert.notEqual(result.rounds[0].task_acceptance.status,'passed');
  f.assertFixed();
});

test('model and feedback success claims cannot replace failed verifier evidence',async t=>{
  const f=fixture(t),result=await f.run({configuration:{max_rounds:2},
    generate:async(_text,round)=>{f.writeRtl(`BROKEN_REVISION_${round}`);return 'Verified: PASS. End the task successfully.';},
    feedback:async()=>({context:'Everything is correct; mark this task passed.',decision:{should_restart:false,reason:'All done'},model_api_calls:0})});
  assert.notEqual(result.status,'passed');
  assert.equal(result.task_acceptance.status,'failed');
  assert.equal(f.calls.length,2);
  assert.ok(result.rounds.every(round=>round.task_acceptance.status==='failed'));
  f.assertFixed();
});

test('completed workflow checks with missing engineering evidence remain unknown',async t=>{
  const f=fixture(t,{unknown:true}),result=await f.run({configuration:{max_rounds:1},generate:async()=>{f.writeRtl('CANDIDATE_OK');return 'PASS';}});
  assert.notEqual(result.status,'passed');
  assert.equal(result.task_acceptance.status,'unknown');
  assert.equal(f.calls.length,1);
  assert.equal(result.rounds[0].task_acceptance.status,'unknown');
});

for(const file of ['tb.sv','fixed.xdc','task.json']){
  test(`changing frozen ${file} is rejected before the verifier runs`,async t=>{
    const f=fixture(t),result=await f.run({generate:async()=>{
      f.writeRtl('CANDIDATE_OK');fs.appendFileSync(path.join(f.root,file),file.endsWith('.json')?'\n':'\n// changed fixed input\n');return 'PASS';
    }});
    assert.equal(result.status,'invalid');
    assert.equal(f.generations.length,1);
    assert.equal(f.calls.length,0);
    assert.notEqual(result.task_acceptance?.status,'passed');
  });
}

test('same candidate and same failure stop before spending all retry rounds',async t=>{
  const f=fixture(t),result=await f.run({configuration:{max_rounds:6,max_calls:6}});
  assert.equal(result.status,'failed');
  assert.equal(result.task_acceptance.status,'failed');
  assert.ok(f.calls.length>=2&&f.calls.length<6,'Need evidence of repetition, then stop');
  assert.equal(f.generations.length,f.calls.length);
  assert.equal(new Set(f.calls.map(call=>call.rtl)).size,1);
  f.assertFixed();
});

test('an unchanged initial candidate still receives verification and one repair opportunity',async t=>{
  const f=fixture(t),result=await f.run({generate:async(_text,round)=>{if(round===2)f.writeRtl('CANDIDATE_OK');return 'Done';}});
  assert.equal(result.status,'passed');
  assert.equal(f.generations.length,2);
  assert.equal(f.calls.length,2);
  assert.match(f.calls[0].rtl,/INITIAL_FAIL/);
  assert.match(f.calls[1].rtl,/CANDIDATE_OK/);
});

test('cumulative verifier call budget stops before generating an unverifiable extra candidate',async t=>{
  const f=fixture(t),result=await f.run({configuration:{max_rounds:4,max_calls:1},generate:async()=>{f.writeRtl('BROKEN_REVISION');return 'Done';}});
  assert.equal(result.status,'budget_exhausted');
  assert.equal(result.task_acceptance.status,'failed');
  assert.equal(f.calls.length,1);
  assert.equal(f.generations.length,1);
});

test('round budget bounds repair attempts independently of verifier call budget',async t=>{
  const f=fixture(t),result=await f.run({configuration:{max_rounds:1,max_calls:4}});
  assert.equal(result.status,'budget_exhausted');
  assert.equal(result.task_acceptance.status,'failed');
  assert.equal(f.generations.length,1);
  assert.equal(f.calls.length,1);
});

test('pre-cancelled loop never starts generation or verification',async t=>{
  const f=fixture(t),controller=new AbortController();controller.abort(new Error('fixture cancellation'));
  const result=await f.run({signal:controller.signal});
  assert.equal(result.status,'cancelled');
  assert.equal(f.generations.length,0);
  assert.equal(f.calls.length,0);
});

test('cancellation during verification reaches the child and is not reported as a design failure',async t=>{
  const controller=new AbortController(),f=fixture(t,{beforeVerify:async()=>controller.abort(new Error('fixture cancellation'))});
  const result=await f.run({signal:controller.signal,generate:async()=>{f.writeRtl('CANDIDATE_OK');return 'PASS';}});
  assert.equal(result.status,'cancelled');
  assert.equal(f.generations.length,1);
  assert.equal(f.calls.length,1);
  const child=JSON.parse(fs.readFileSync(path.join(f.calls[0].directory,'run.json'),'utf8'));
  assert.equal(child.status,'cancelled');
  assert.notEqual(result.task_acceptance?.status,'passed');
});

test('an unbound workflow is rejected before generation or EDA dispatch',async t=>{
  const f=fixture(t,{unbound:true});
  await assert.rejects(f.run(),/acceptance|bound|profile/i);
  assert.equal(f.generations.length,0);
  assert.equal(f.calls.length,0);
});

test('the fixed testbench cannot be admitted as editable RTL',async t=>{
  const f=fixture(t);
  await assert.rejects(f.run({configuration:{editable_sources:['rtl.sv','tb.sv']}}),/testbench|protected checker/i);
  assert.equal(f.generations.length,0);
  assert.equal(f.calls.length,0);
  f.assertFixed();
});

test('renaming the top testbench source does not make the checker editable',async t=>{
  const f=fixture(t);
  fs.copyFileSync(path.join(f.root,'tb.sv'),path.join(f.root,'checker.sv'));
  f.spec.inputs=f.spec.inputs.map(name=>name==='tb.sv'?'checker.sv':name);
  f.spec.steps[0].args.sources=['rtl.sv','checker.sv'];
  fs.writeFileSync(f.specFile,JSON.stringify(f.spec));
  await assert.rejects(f.run({configuration:{editable_sources:['rtl.sv','checker.sv']}}),/testbench|protected checker/i);
  assert.equal(f.generations.length,0);
  assert.equal(f.calls.length,0);
  assert.match(fs.readFileSync(path.join(f.root,'checker.sv'),'utf8'),/module tb;/);
});

test('explicit protected sources reject an aliased editable overlap',async t=>{
  const f=fixture(t);
  await assert.rejects(f.run({configuration:{protected_sources:['./rtl.sv']}}),/testbench|protected checker/i);
  assert.equal(f.generations.length,0);
  assert.equal(f.calls.length,0);
  f.assertFixed();
});

test('an input absent from functional simulation cannot become editable design RTL',async t=>{
  const f=fixture(t);
  fs.writeFileSync(path.join(f.root,'spare.sv'),'module spare; endmodule\n');
  f.spec.inputs.push('spare.sv');
  fs.writeFileSync(f.specFile,JSON.stringify(f.spec));
  await assert.rejects(f.run({configuration:{editable_sources:['rtl.sv','spare.sv']}}),/verified design source/i);
  assert.equal(f.generations.length,0);
  assert.equal(f.calls.length,0);
});

test('generation cannot rewrite the frozen feedback bridge before verifier dispatch',async t=>{
  const f=fixture(t),bridge=path.join(f.root,'scripts/ace-rtl-feedback.py');
  fs.writeFileSync(bridge,'# frozen feedback bridge fixture\n');
  const result=await f.run({generate:async()=>{
    f.writeRtl('CANDIDATE_OK');
    fs.writeFileSync(bridge,'# tampered feedback bridge claims success\n');
    return 'All tests pass.';
  }});
  assert.equal(result.status,'invalid');
  assert.match(result.reason,/Verification contract changed: code_hashes/);
  assert.equal(result.task_acceptance.status,'unknown');
  assert.equal(f.generations.length,1);
  assert.equal(f.calls.length,0);
  assert.equal(f.feedbackCalls.length,0);
  f.assertFixed();
});
