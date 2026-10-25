// Real Pi SDK + QuickJS codemode + local scripted stream. No network/model client or EDA.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createJiti} from 'jiti';
import {createAgentSession,DefaultResourceLoader,SettingsManager,SessionManager,createCodemodeExtension} from '@earendil-works/pi-coding-agent';
import {runAgentSession} from '../src/agent-session.mjs';
import {guardTaskTool} from '../src/agent-task.mjs';
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
