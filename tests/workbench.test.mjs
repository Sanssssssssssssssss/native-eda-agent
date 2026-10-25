import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createJiti} from 'jiti';
import {createWorkbench} from '../src/workbench.mjs';
import {evaluationPlan,runEvaluation,evaluationFreshness} from '../src/evaluations.mjs';
const root=path.resolve(import.meta.dirname,'..');
async function fixture(t){
  const registry=new Map();(await createJiti(import.meta.url).import('../src/extension.ts',{default:true}))({registerTool:x=>registry.set(x.name,x)});
  const app=createWorkbench(root,registry);await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));t.after(()=>app.close());
  const base=`http://127.0.0.1:${app.server.address().port}`;
  return {base,registry,get:(route,headers={})=>fetch(base+route,{headers}),post:(route,data,headers={Origin:base})=>fetch(base+route,{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(data)})};
}
test('workbench serves its UI and rejects foreign origins, path escapes and unowned jobs',async t=>{
  const f=await fixture(t);assert.equal((await f.get('/')).status,200);assert.equal((await f.get('/app.js')).status,200);
  assert.equal((await f.get('/api/overview',{Origin:'https://untrusted.example'})).status,403);
  assert.equal((await f.post('/api/session',{message:'test'},{})).status,403);
  assert.equal((await f.get('/api/run?id=..%2Fprivate')).status,400);
  assert.equal((await f.post('/api/cancel',{id:'unowned'})).status,400);
  assert.equal((await f.post('/api/workflow',{action:'run',spec:'../../outside'})).status,400);
});
test('local session persists real retrieval context with source scope and no model launch',async t=>{
  const f=await fixture(t),r=await f.post('/api/session',{message:'跨时钟总线一致性',phase:'cdc'});assert.equal(r.status,200);const s=await r.json();
  t.after(()=>{assert.match(s.id,/^[0-9a-f-]{36}$/);const base=path.resolve(root,'.eda-state/workbench-sessions'),dir=path.resolve(base,s.id);assert.equal(path.dirname(dir),base);fs.rmSync(dir,{recursive:true,force:true});});
  assert.equal(s.mode,'local_context');assert.equal(s.messages[1].context.model_api_calls,0);assert.equal(s.messages[1].context.sops[0].sop.id,'fpga-cdc-review');
  const restored=await (await f.get('/api/session?id='+s.id)).json();assert.deepEqual(restored,s);
  const c=s.messages[1].context;assert.ok(c.sources.every(x=>x.url.startsWith('https:')));assert.ok(c.context_budget.selected_schema_bytes<c.context_budget.all_schema_bytes);
});
test('online EDA planning is static and agent assessment requires actual causally linked evidence',async()=>{
  assert.equal(evaluationPlan(root,'online-axi').launches_eda,true);assert.equal(evaluationPlan(root,'online-axi').provider_launch,false);
  const blocked=await runEvaluation(root,'online-agent',new Map());assert.equal(blocked.status,'blocked');assert.equal(blocked.reason,'agent_session_and_workflow_required');
  assert.equal(blocked.provider_calls_by_evaluator,0);assert.throws(()=>evaluationPlan(root,'invented'),/Unknown/);
});
test('offline evidence assessment retains scorecard units instead of inflating design counts',async()=>{
  const r=await runEvaluation(root,'offline-evidence',new Map());assert.equal(r.status,'passed');assert.equal(r.unit,'scorecard_integrity');assert.equal(r.checks.length,11);assert.equal(r.provider_calls_by_evaluator,0);
});

test('concurrent messages cannot silently overwrite a saved session',async t=>{
  const f=await fixture(t),s=await (await f.post('/api/session',{message:'AXI timing'})).json();
  t.after(()=>{const base=path.resolve(root,'.eda-state/workbench-sessions'),dir=path.resolve(base,s.id);assert.equal(path.dirname(dir),base);fs.rmSync(dir,{recursive:true,force:true});});
  const tool=f.registry.get('eda_task_context'),original=tool.execute;
  let release,started;const gate=new Promise(resolve=>{release=resolve;}),entered=new Promise(resolve=>{started=resolve;});
  tool.execute=async(...args)=>{started();await gate;return original(...args);};
  const first=f.post('/api/session',{id:s.id,message:'hold timing'});await entered;
  try{assert.equal((await f.post('/api/session',{id:s.id,message:'must not overwrite'})).status,409);}finally{release();}
  assert.equal((await first).status,200);
  const restored=await (await f.get('/api/session?id='+s.id)).json();assert.equal(restored.messages.length,4);assert.equal(restored.messages[2].text,'hold timing');
});

test('evaluation freshness distinguishes matching, changed, missing and unbound sources',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'eda-eval-freshness-'));t.after(()=>{assert.ok(dir.startsWith(path.join(os.tmpdir(),'eda-eval-freshness-')));fs.rmSync(dir,{recursive:true,force:true});});
  fs.writeFileSync(path.join(dir,'source.txt'),'original');const receipt={source_hashes:{'source.txt':createHash('sha256').update('original').digest('hex')}};
  assert.equal(evaluationFreshness(dir,receipt).current_sources_match,true);
  fs.writeFileSync(path.join(dir,'source.txt'),'changed');assert.equal(evaluationFreshness(dir,receipt).current_sources_match,false);
  assert.equal(evaluationFreshness(dir,{source_hashes:{'missing.txt':'hash'}}).current_sources_match,false);
  assert.equal(evaluationFreshness(dir,{}).current_sources_match,null);
});
