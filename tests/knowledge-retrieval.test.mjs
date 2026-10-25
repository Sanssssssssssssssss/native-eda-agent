import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DefaultResourceLoader,SettingsManager} from '@earendil-works/pi-coding-agent';
import {edaResourceOptions} from '../src/agent-resources.mjs';
import {queryKnowledge,querySop,resolveGuidance,knowledgeFiles} from '../src/knowledge.mjs';
import {readKnowledge,validateKnowledge} from '../scripts/check-knowledge.mjs';
import {evaluateRetrieval} from '../scripts/evaluate-knowledge.mjs';
import {planWorkflow,createWorkflowTools,inspectWorkflow} from '../src/workflow.mjs';
import {createTrace} from '../src/trace.mjs';
const root=path.resolve(import.meta.dirname,'..');
function fixture(t){
  const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'eda-knowledge-'));
  t.after(()=>{assert.ok(tmp.startsWith(path.join(os.tmpdir(),'eda-knowledge-')));fs.rmSync(tmp,{recursive:true,force:true});});
  const bundle=readKnowledge(root),files=new Set(knowledgeFiles(root));
  for(const entry of [...bundle.rules.rules,...bundle.sources.sources])for(const name of entry.local_paths||[])files.add(path.join(root,name));
  for(const skill of bundle.skills)for(const [,target]of skill.content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g))if(!/^https:|^#/.test(target))files.add(path.resolve(skill.directory,target));
  for(const file of files){const to=path.join(tmp,path.relative(root,file));fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(file,to);}
  return tmp;
}
test('Chinese/English questions rank relevant rules and retain original source scope',()=>{
  const result=queryKnowledge(root,{query:'跨时钟总线一致性',limit:5});
  assert.ok(result.rules.some(r=>r.id==='FPGA-CDC-004'));
  assert.ok(result.rules.every(r=>r.scope&&r.evidence_required.length&&r.static_proof_boundary));
  assert.ok(result.rules.every(r=>r.source_refs.every(ref=>result.sources.some(s=>s.id===ref.source_id&&s.url===ref.url))));
  assert.ok(result.retrieval.ranking.every(r=>r.score>0&&r.matched_terms.length));
  assert.equal(result.retrieval.external_model_api_calls,0);
});
test('exact ID, classification and source filters cannot silently substitute another rule',()=>{
  const r=queryKnowledge(root,{id:'FPGA-CDC-001'});assert.equal(r.rules.length,1);assert.equal(r.rules[0].id,'FPGA-CDC-001');
  assert.throws(()=>queryKnowledge(root,{id:'FPGA-MISSING-999'}),/Unknown/);
  assert.throws(()=>queryKnowledge(root,{source_id:'invented'}),/Unknown/);
  const filtered=queryKnowledge(root,{query:'reset',classification:'recommendation',source_id:'amd-ug949-reset'});
  assert.ok(filtered.rules.length);assert.ok(filtered.rules.every(r=>r.classification==='recommendation'&&r.source_refs.some(s=>s.source_id==='amd-ug949-reset')));
});
test('visible retrieval regression reports separate baseline, ranking and unrelated queries',()=>{
  const r=evaluateRetrieval(root);assert.equal(r.cases.length,24);
  assert.ok(r.after.hits>=r.before.hits);assert.ok(r.after.hits>=20);
  assert.ok(r.unrelated.every(q=>q.returned===0));assert.equal(r.case_set_sha256.length,64);
});
test('public bundle works without optional Ross files but missing required SOPs fail',t=>{
  const tmp=fixture(t),r=validateKnowledge(readKnowledge(tmp),{root:tmp});
  assert.equal(r.valid,true,r.errors.join('\n'));assert.ok(r.optional_unavailable.some(x=>x.id==='ross'));
  assert.equal(querySop(tmp,{id:'fpga-plan'}).sop.id,'fpga-plan');
  fs.unlinkSync(path.join(tmp,'.pi/skills/fpga-plan/SKILL.md'));
  assert.throws(()=>queryKnowledge(tmp,{query:'CDC'}),/ENOENT/);
});
test('SOP text, declared knowledge IDs and the catalog cannot drift apart',()=>{
  const b=readKnowledge(root);b.sops.sops[0].rule_ids.push('FPGA-MISSING-999');
  const r=validateKnowledge(b,{root});assert.equal(r.valid,false);assert.ok(r.errors.some(x=>x.includes('unknown SOP rule')));
  const sop=querySop(root,{id:'fpga-reproduce'});assert.ok(sop.content.includes('eda_workflow_resume_check'));
  assert.deepEqual(sop.rules.map(r=>r.id).sort(),sop.sop.rule_ids.toSorted());
  assert.throws(()=>resolveGuidance(root,{sop_ids:['../../outside']}),/Unknown SOP/);
});
test('selected knowledge and SOP bytes are frozen in workflow plans and recovery',async t=>{
  const tmp=fixture(t);fs.writeFileSync(path.join(tmp,'input.txt'),'input');
  const spec={schema_version:1,id:'guidance-test',goal:'Preserve selected knowledge',inputs:['input.txt'],guidance:{sop_ids:['fpga-plan']},limits:{max_calls:2,wall_seconds:10},steps:[{id:'fail',tool:'eda_preflight',args:{},checks:[{pointer:'/ok',op:'eq',value:true}]}]};
  fs.writeFileSync(path.join(tmp,'task.json'),JSON.stringify(spec));
  const registry=new Map([['eda_preflight',{parameters:{type:'object',properties:{},additionalProperties:false},async execute(id,args,_signal,_update,ctx){const trace=createTrace({root:tmp,tool:'eda_preflight',args,toolCallId:id,context:ctx.edaTraceContext});trace.capture(path.join(tmp,'input.txt'),'input');trace.finalizeDependencies();return {details:trace.finish('completed',null,{ok:false})};}}]]);
  const plan=planWorkflow(tmp,'task.json',registry);assert.ok(plan.input_hashes['.pi/skills/fpga-plan/SKILL.md']);assert.ok(plan.guidance.rule_ids.includes('FPGA-CDC-001'));
  const tool=createWorkflowTools(tmp,registry).find(t=>t.name==='eda_workflow_run');
  const run=await tool.execute('test-guidance',{spec:'task.json'});assert.equal(run.details.outcome,'checks_failed',run.details.error);
  fs.appendFileSync(path.join(tmp,'.pi/skills/fpga-plan/SKILL.md'),'\nchanged instruction');
  assert.ok(inspectWorkflow(tmp,run.details.directory,{resume:true}).issues.some(i=>i.includes('input_changed:.pi/skills/fpga-plan')));
});
test('real Pi resource loader discovers all bundled SOPs without a model session',async t=>{
  const agentDir=fs.mkdtempSync(path.join(os.tmpdir(),'eda-loader-'));
  t.after(()=>{assert.ok(agentDir.startsWith(path.join(os.tmpdir(),'eda-loader-')));fs.rmSync(agentDir,{recursive:true,force:true});});
  const loader=new DefaultResourceLoader(edaResourceOptions({root,agentDir,settingsManager:SettingsManager.inMemory({})}));
  await loader.reload();
  const loaded=loader.getSkills();
  for(const id of querySop(root).sops.map(s=>s.id))assert.ok(loaded.skills.some(s=>s.name===id),`Missing ${id}`);
  assert.ok(!loaded.diagnostics.some(d=>d.type==='error'),JSON.stringify(loaded.diagnostics));
});
