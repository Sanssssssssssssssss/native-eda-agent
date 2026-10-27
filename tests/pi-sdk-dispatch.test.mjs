// Real Pi SDK + QuickJS codemode + local scripted stream. No network/model client or EDA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createJiti} from 'jiti';
import {createAgentSession,DefaultResourceLoader,SettingsManager,SessionManager,createCodemodeExtension} from '@earendil-works/pi-coding-agent';
import {runAgentSession} from '../src/agent-session.mjs';
import {guardTaskTool,prepareAgentTask} from '../src/agent-task.mjs';
import {edaCodemodeOptions} from '../src/agent-resources.mjs';

async function exercise(t,scenario){
  const parent=path.resolve(import.meta.dirname,'../artifacts');fs.mkdirSync(parent,{recursive:true});
  const root=fs.mkdtempSync(path.join(parent,'eda-real-sdk-'));
  t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(parent));assert.ok(path.basename(root).startsWith('eda-real-sdk-'));fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'.eda'));fs.writeFileSync(path.join(root,'.eda/config.json'),JSON.stringify({schema_version:1,model_api_enabled:true,resources:{xsim:2,vivado:1,ltspice:1,verify:4},queue_timeout_ms:1000}));
  for(const directory of ['src','scripts'])fs.cpSync(path.resolve(import.meta.dirname,'..',directory),path.join(root,directory),{recursive:true});
  fs.writeFileSync(path.join(root,'candidate.sv'),'original');fs.writeFileSync(path.join(root,'checker.sv'),'fixed checker');
  const extension=await createJiti(import.meta.url).import(path.join(root,'src/extension.ts'),{default:true});
  const model={id:'scripted',name:'Scripted offline responses',provider:'offline-fixture',api:'openai-completions',baseUrl:'https://invalid.invalid',
    reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1000};
  let requests=0;
  const code=`text({auxiliary_models:typeof models});
    await tools.write({path:'candidate.sv',content:'candidate edited by real SDK'});
    try {await tools.write({path:'checker.sv',content:'must never write'});} catch(error) {text(error.message);}
    ${scenario==='tool-limit'?"await tools.write({path:'candidate.sv',content:'must not pass tool budget'});":''}`;
  // Explicit in-memory runtime: neither real credentials nor provider code is constructed.
  const modelRuntime={getModel:()=>model,getPhysicalModel:()=>model,getAvailableSnapshot:()=>[model],
    getRegisteredProviderIds:()=>[],getRegisteredNativeProvider:()=>undefined,getRegisteredProviderConfig:()=>undefined,
    hasConfiguredAuth:()=>true,isUsingOAuth:()=>false,isUsingSubscription:()=>false,getAuth:async()=>({auth:{apiKey:'offline-sentinel'},env:{}}),
    getError:()=>undefined,streamSimple:()=>{
      requests++;assert.ok(requests<=(scenario==='complete'?2:1),'budget must stop further model turns');
      const message={role:'assistant',content:requests===1?[{type:'toolCall',id:'code-1',name:'codemode',arguments:{code}}]:[{type:'text',text:'Offline scripted response complete'}],api:model.api,provider:model.provider,model:model.id,
        usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason:requests===1?'toolUse':'stop',timestamp:Date.now()};
      return {async *[Symbol.asyncIterator](){yield {type:'done',reason:message.stopReason,message};},result:async()=>message};
    }};
  const result=await runAgentSession({root,prompt:'Execute scripted offline tool calls',limits:{maxTurns:scenario==='turn-limit'?1:2,timeoutSeconds:20,maxToolCalls:3},sessionFactory:async options=>{
    const settingsManager=SettingsManager.inMemory({compaction:{enabled:false},retry:{enabled:false},cacheWarming:'off'});
    const loader=new DefaultResourceLoader({cwd:root,agentDir:path.join(root,'.pi-state'),settingsManager,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,
      extensionFactories:[pi=>extension(pi,{...options,toolPolicy:event=>{
        const budget=options.toolPolicy(event);return budget?.block?budget:guardTaskTool(root,{editable_sources:['candidate.sv']},event);
      }}),createCodemodeExtension(edaCodemodeOptions)]});
    await loader.reload();
    const created=await createAgentSession({cwd:root,agentDir:path.join(root,'.pi-state'),modelRuntime,model,thinkingLevel:'off',settingsManager,resourceLoader:loader,
      sessionManager:SessionManager.inMemory(root),tools:['write','codemode']});
    assert.deepEqual(created.extensionsResult.errors,[]);
    return created;
  }});
  assert.equal(result.run.stoppedReason,scenario==='complete'?null:scenario==='turn-limit'?'model-turn-limit':'model-tool-limit',JSON.stringify({status:result.status,error:result.run.error}));
  assert.equal(result.status,scenario==='complete'?'completed':'stopped');
  assert.equal(requests,scenario==='complete'?2:1);assert.equal(result.run.execution_provenance.session_factory,'injected');
  assert.equal(fs.readFileSync(path.join(root,'candidate.sv'),'utf8'),'candidate edited by real SDK');
  assert.equal(fs.readFileSync(path.join(root,'checker.sv'),'utf8'),'fixed checker');
  assert.equal(result.run.tool_budget.attempted,scenario==='tool-limit'?4:3);assert.equal(result.run.tool_budget.nested,scenario==='tool-limit'?3:2);
  const events=fs.readFileSync(path.join(result.directory,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
  const codeResult=events.find(event=>event.type==='tool_execution_end'&&event.toolName==='codemode');
  assert.match(JSON.stringify(codeResult),/auxiliary_models.*undefined/);
}
test('real SDK tool-limit: nested dispatch, fixed checker and no auxiliary model access',t=>exercise(t,'tool-limit'));
test('real SDK turn-limit: no subsequent provider dispatch after stopping',t=>exercise(t,'turn-limit'));
test('real SDK complete: permitted candidate edits and normal session completion',t=>exercise(t,'complete'));

for(const mode of ['verification','task','taskDirectory']) {
  test(`real SDK model tool declarations preserve host registry: ${mode}`,async t=>{
    const project=path.resolve(import.meta.dirname,'..'),parent=path.join(project,'artifacts');
    fs.mkdirSync(parent,{recursive:true});
    const root=fs.mkdtempSync(path.join(parent,'eda-sdk-tool-scope-'));
    t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(parent));assert.ok(path.basename(root).startsWith('eda-sdk-tool-scope-'));fs.rmSync(root,{recursive:true,force:true});});
    for(const directory of ['src','scripts','knowledge','.pi/skills'])fs.cpSync(path.join(project,directory),path.join(root,directory),{recursive:true});
    for(const file of ['docs/workflows.md','docs/reference/tools.md','docs/results.md','projects/system-bench/run.py','projects/system-bench/implement-common.tcl']){
      fs.mkdirSync(path.dirname(path.join(root,file)),{recursive:true});fs.copyFileSync(path.join(project,file),path.join(root,file));
    }
    fs.mkdirSync(path.join(root,'.eda'));
    fs.writeFileSync(path.join(root,'.eda/config.json'),JSON.stringify({schema_version:1,model_api_enabled:true,resources:{xsim:2,vivado:1,ltspice:1,verify:4},queue_timeout_ms:1000}));
    fs.writeFileSync(path.join(root,'candidate.sv'),'module dut; endmodule\n');
    fs.writeFileSync(path.join(root,'checker.sv'),'module tb; endmodule\n');
    fs.writeFileSync(path.join(root,'spec.json'),JSON.stringify({schema_version:1,id:'tool-scope',goal:'Inspect native tool scope without generation',
      inputs:['candidate.sv','checker.sv'],limits:{max_calls:1,wall_seconds:10},
      steps:[{id:'sim',tool:'eda_xsim',args:{sources:['candidate.sv','checker.sv'],top:'tb',pass_marker:'FIXED_PASS'},checks:[{pointer:'/simulation_acceptance/status',op:'eq',value:'pass'}]}],
      acceptance:{profile:'rtl_simulation',bindings:{functional:'sim'}}}));
    const configuration={spec:'spec.json',editable_sources:['candidate.sv'],max_rounds:1,max_calls:1};
    const extension=await createJiti(import.meta.url).import(path.join(root,'src/extension.ts'),{default:true});
    let preparationRegistry;
    extension({registerTool(){}},{onRegistry:value=>{preparationRegistry=value;}});
    const options=mode==='verification'?{verification:configuration}:mode==='task'?{task:prepareAgentTask(root,configuration,preparationRegistry).directory}:{taskDirectory:'artifacts/prior-workflow'};
    if(mode==='taskDirectory')fs.mkdirSync(path.join(root,options.taskDirectory),{recursive:true});
    const fetch=t.mock.method(globalThis,'fetch',()=>{throw new Error('Provider calls are forbidden in tool-scope tests');});
    const model={id:'never-dispatched',name:'Never dispatched',provider:'offline-fixture',api:'openai-completions',baseUrl:'https://invalid.invalid',
      reasoning:false,input:['text'],cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:100000,maxTokens:1000};
    let observed=false;
    const result=await runAgentSession({root,prompt:'Inspect native declarations',...options,limits:{maxTurns:1,timeoutSeconds:30},sessionFactory:async factoryOptions=>{
      let registry;
      const settingsManager=SettingsManager.inMemory({defaultTools:['read','write','edit','grep','find','ls','powershell'],compaction:{enabled:false},retry:{enabled:false},cacheWarming:'off'});
      const loader=new DefaultResourceLoader({cwd:root,agentDir:path.join(root,'.pi-state'),settingsManager,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,
        extensionFactories:[pi=>extension(pi,{...factoryOptions,onRegistry:value=>{registry=value;}}),createCodemodeExtension(edaCodemodeOptions)]});
      await loader.reload();
      const created=await createAgentSession({cwd:root,agentDir:path.join(root,'.pi-state'),model,thinkingLevel:'off',settingsManager,resourceLoader:loader,sessionManager:SessionManager.inMemory(root)});
      assert.deepEqual(created.extensionsResult.errors,[]);
      const originalNames=created.session.getActiveToolNames().sort(),originalRegistry=new Map(registry);
      // Stop at the native session boundary: no provider stream or host EDA is invoked.
      created.session.prompt=async()=>{
        const names=created.session.getActiveToolNames().sort();
        assert.deepEqual(created.session.agent.state.tools.map(tool=>tool.name).sort(),names);
        assert.deepEqual([...registry.keys()],[...originalRegistry.keys()]);
        for(const [name,tool] of originalRegistry)assert.equal(registry.get(name),tool);
        for(const name of ['eda_xsim','eda_vivado_synthesize','eda_vivado_implement','eda_verify'])assert.equal(typeof registry.get(name)?.execute,'function');
        if(mode==='taskDirectory')assert.deepEqual(names,originalNames,'ordinary workflow context retains the full native catalog');
        else {
          assert.deepEqual(names,['read','write','edit','grep','find','ls','eda_task_context','eda_task_inspect','eda_knowledge','eda_sop','eda_preflight','eda_runs'].sort());
          assert.ok(originalNames.includes('powershell')&&originalNames.includes('eda_xsim'));
          assert.ok(created.session.getAllTools().some(tool=>tool.name==='codemode'));
          assert.equal(names.some(name=>/^(?:bash|powershell|codemode|eda_xsim|eda_vivado.*|eda_verify|eda_ltspice.*|eda_workflow.*|eda_benchmark.*)$/.test(name)),false);
        }
        observed=true;
        throw new Error('offline tool-scope inspection complete');
      };
      return {...created,registry};
    }});
    assert.equal(observed,true,result.run.error||result.run.verification?.reason);
    assert.match(result.run.error||result.run.verification?.reason,/offline tool-scope inspection complete/);
    if(mode==='taskDirectory')assert.equal(result.status,'failed');
    else assert.equal(result.run.verification.status,'invalid');
    assert.equal(result.run.execution_provenance.session_factory,'injected','native SDK offline inspection is not a live model result');
    assert.equal(result.run.verification?.calls??0,0);
    assert.equal(fetch.mock.callCount(),0);
  });
}

test('upstream codemode queues concurrent calls and releases workers after cancellation',async()=>{
  let tool;
  createCodemodeExtension(edaCodemodeOptions)({registerTool:value=>{tool=value;},getAllTools:()=>[],getSettings:()=>({}),appendEntry:()=>{}});
  const controllers=Array.from({length:6},()=>new AbortController());
  const calls=controllers.map((controller,index)=>tool.execute(`concurrent-${index}`,{code:`const until=Date.now()+150;while(Date.now()<until){};text({id:${index},models:typeof models});`},controller.signal));
  controllers[4].abort();
  const results=await Promise.allSettled(calls);
  for(let i=0;i<results.length;i++) {
    const row=results[i];
    if(i===4){assert.ok(row.status==='rejected'||row.value.isError,'cancelled work must not be reported successful');continue;}
    assert.equal(row.status,'fulfilled');assert.notEqual(row.value.isError,true,JSON.stringify(row.value));
    assert.match(JSON.stringify(row.value.content),/undefined/);
  }
  const next=await tool.execute('after-concurrent',{code:'text(42);'});
  assert.notEqual(next.isError,true);assert.match(JSON.stringify(next.content),/42/);
});

// Exercise upstream compaction/retry state machines, rather than injecting their
// lifecycle events. Only the provider response stream is scripted in memory.
for(const scenario of ['summary-success','summary-cancel','summary-length','overflow-recovered','retry-recovered','retry-exhausted','retry-cancel']) {
  test(`real SDK lifecycle: ${scenario}`,{timeout:20000},async t=>{
    const parent=path.resolve(import.meta.dirname,'../artifacts');fs.mkdirSync(parent,{recursive:true});
    const root=fs.mkdtempSync(path.join(parent,'eda-sdk-lifecycle-'));
    t.after(()=>{assert.equal(path.dirname(fs.realpathSync(root)),fs.realpathSync(parent));assert.ok(path.basename(root).startsWith('eda-sdk-lifecycle-'));fs.rmSync(root,{recursive:true,force:true});});
    fs.mkdirSync(path.join(root,'.eda'));fs.writeFileSync(path.join(root,'.eda/config.json'),JSON.stringify({schema_version:1,model_api_enabled:true,resources:{xsim:2,vivado:1,ltspice:1,verify:4},queue_timeout_ms:1000}));
    const model={id:'scripted',name:'Offline lifecycle',provider:'offline-fixture',api:'openai-completions',baseUrl:'https://invalid.invalid',reasoning:false,input:['text'],
      cost:{input:0,output:0,cacheRead:0,cacheWrite:0},contextWindow:4096,maxTokens:1000};
    const controller=new AbortController();let requests=0,manager;
    const message=(stopReason,text,input=20)=>({role:'assistant',content:[{type:'text',text}],api:model.api,provider:model.provider,model:model.id,
      usage:{input,output:10,cacheRead:0,cacheWrite:0,totalTokens:input+10,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},stopReason,timestamp:Date.now(),...(stopReason==='error'?{errorMessage:text}:{})});
    const modelRuntime={getModel:()=>model,getPhysicalModel:()=>model,getAvailableSnapshot:()=>[model],getRegisteredProviderIds:()=>[],getRegisteredNativeProvider:()=>undefined,
      getRegisteredProviderConfig:()=>undefined,hasConfiguredAuth:()=>true,isUsingOAuth:()=>false,isUsingSubscription:()=>false,getAuth:async()=>({auth:{apiKey:'offline-sentinel'},env:{}}),getError:()=>undefined,
      streamSimple:(_model,_context,options={})=>{
        const n=++requests;assert.ok(n<=3);assert.notEqual(options.signal?.aborted,true,'no provider dispatch after cancellation');
        let response;
        if(scenario.startsWith('retry-'))response=message(n===1||scenario==='retry-exhausted'?'error':'stop',n===1||scenario==='retry-exhausted'?'429 rate limit':'Recovered');
        else if(n===1)response=message(scenario==='overflow-recovered'?'length':'stop','Completed work. '+('Evidence '.repeat(150)),3600);
        else response=message(scenario==='summary-length'?'length':'stop',n===2?'## Goal\nContinue the task.\n## Progress\nCompleted work.':'Recovered from overflow.');
        const result=async()=>{
          if(scenario==='summary-cancel'&&n===2){
            const timer=setTimeout(()=>controller.abort(),10);
            try{await new Promise((_,reject)=>{if(options.signal.aborted)reject(options.signal.reason);else options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});}
            finally{clearTimeout(timer);}
          }
          return response;
        };
        return {async *[Symbol.asyncIterator](){const value=await result();yield {type:value.stopReason==='error'?'error':'done',reason:value.stopReason,message:value,error:value};},result};
      }};
    const result=await runAgentSession({root,prompt:'Review the candidate. '+('Fixed checker evidence. '.repeat(80)),limits:{maxTurns:5,maxToolCalls:5,timeoutSeconds:10},signal:controller.signal,
      onEvent:event=>{if(scenario==='retry-cancel'&&event.type==='auto_retry_start')controller.abort();},
      sessionFactory:async()=>{
        const settingsManager=SettingsManager.inMemory({compaction:{enabled:!scenario.startsWith('retry-'),reserveTokens:1024,keepRecentTokens:64},retry:{enabled:true,maxRetries:1,baseDelayMs:5,maxDelayMs:20},cacheWarming:'off'});
        const loader=new DefaultResourceLoader({cwd:root,agentDir:path.join(root,'.pi-state'),settingsManager,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true});await loader.reload();
        manager=SessionManager.inMemory(root);
        return createAgentSession({cwd:root,agentDir:path.join(root,'.pi-state'),modelRuntime,model,thinkingLevel:'off',settingsManager,resourceLoader:loader,sessionManager:manager,tools:[]});
      }});
    const events=fs.readFileSync(path.join(result.directory,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    const cancelled=scenario.endsWith('-cancel');
    assert.equal(result.status,cancelled?'stopped':scenario==='retry-exhausted'?'failed':'completed',result.run.error);
    assert.equal(result.run.stoppedReason,cancelled?'user-interrupt':null);
    assert.equal(requests,scenario==='retry-cancel'?1:scenario==='overflow-recovered'?3:2);
    assert.equal(manager.getEntries().filter(e=>e.type==='compaction').length,['summary-success','overflow-recovered'].includes(scenario)?1:0);
    if(scenario==='summary-cancel')assert.equal(events.find(e=>e.type==='compaction_end').aborted,true);
    if(scenario==='summary-length')assert.match(events.find(e=>e.type==='compaction_end').errorMessage,/summary is incomplete/);
    if(scenario.startsWith('retry-'))assert.equal(events.find(e=>e.type==='auto_retry_end').success,scenario==='retry-recovered');
    if(scenario==='overflow-recovered')assert.equal(result.run.error,null);
    assert.equal(events.filter(e=>e.type==='run_end').length,1);
  });
}
