import fs from 'node:fs';
import path from 'node:path';
import {queryKnowledge,querySop,knowledgeFiles,tokenize} from './knowledge.mjs';
import {inspectWorkflow} from './workflow.mjs';
import {createTrace} from './trace.mjs';
import {validateArguments} from './tool-contracts.mjs';
const phaseSops={planning:'fpga-plan',simulation:'fpga-rtl-verify',timing:'fpga-timing-triage',recovery:'fpga-reproduce',cdc:'fpga-cdc-review',ip:'fpga-ip-integrate'};
export const contextSchema={type:'object',properties:{query:{type:'string',minLength:1,maxLength:2048},phase:{type:'string',enum:Object.keys(phaseSops)},directory:{type:'string',minLength:1}},required:['query'],additionalProperties:false};
const phaseTerms={
  planning:'RTL synthesis black box specification 固定输入 器件 规格 验收',
  simulation:'RTL simulation functional scoreboard testbench 功能 仿真 负控',
  timing:'setup hold timing constraints routing DRC 时序 约束 布局布线',
  recovery:'trace evidence integrity hash recovery 证据 哈希 恢复',
  cdc:'CDC clock domain crossing 跨时钟',
  ip:'Vivado IP simulation library black box 仿真库',
  review:'trace evidence acceptance scope 证据复核 验收范围 交付'
};
const domainPhases={functional:'simulation',synthesis:'planning',setup:'timing',hold:'timing',constraints:'timing',routing:'timing',drc:'timing',cdc:'cdc'};

// Consume host-verified observations before lexical retrieval. These choices are
// advisory: neither an explicit phase nor an inferred SOP changes acceptance.
export function selectContextPhase(args,observation=null){
  const explicit=args.phase||null;
  const unmet=(observation?.task_acceptance?.domains||[]).filter(d=>!['passed','not_requested'].includes(d.status));
  const basis=[];
  let inferred=null,reason='query_only',nextAction='select_guidance';
  if(observation){
    basis.push({source:'workflow',run_id:observation.run_id,valid:observation.valid,status:observation.status,outcome:observation.outcome});
    if(observation.valid!==true||observation.issues?.length||unmet.some(d=>d.domain==='artifact_integrity')){
      inferred='recovery';reason='evidence_integrity_requires_review';nextAction='repair_evidence_or_start_new_task';
      basis.push({source:'workflow_integrity',issues:observation.issues||[],domains:unmet.filter(d=>d.domain==='artifact_integrity')});
    }else if(observation.recovery?.stalled){
      inferred='recovery';reason='repeated_failure_requires_diagnosis';nextAction='diagnose_before_new_task';
      basis.push({source:'recovery',stalled:true,same_failure_count:observation.recovery.same_failure_count});
    }else{
      // Follow dependency order: do not optimize timing ahead of an unmet
      // functional or synthesis target, including missing verified evidence.
      const domain=Object.keys(domainPhases).map(name=>unmet.find(d=>d.domain===name)).find(Boolean);
      if(domain){
        inferred=domainPhases[domain.domain];reason='unmet_acceptance_domain';nextAction='review_unmet_domain';
        basis.push({source:'task_acceptance.domains',...domain});
      }else if(observation.status==='completed'&&observation.next_step===null){
        inferred='review';
        const accepted=observation.task_acceptance?.status==='passed';
        reason=accepted?'accepted_task_ready_for_delivery':'completed_steps_require_scope_review';
        nextAction=accepted?'deliver_evidence':'review_unbound_goal';
        basis.push({source:'task_acceptance',status:observation.task_acceptance?.status,reason:observation.task_acceptance?.reason,completed_steps:observation.completed_steps});
      }else if(['failed','cancelled','timed_out'].includes(observation.status)){
        inferred='recovery';reason='interrupted_task_requires_review';nextAction='inspect_failed_step_then_resume_check';
      }
    }
  }
  const effective=explicit||inferred;
  const conflict=explicit&&inferred&&explicit!==inferred?{explicit_phase:explicit,inferred_phase:inferred,reason:'Explicit intent overrides guidance only; observed acceptance and integrity issues remain unchanged.'}:null;
  const evidenceTerms=[...new Set([effective,inferred].filter(Boolean))].map(phase=>phaseTerms[phase]).filter(Boolean);
  const retrievalQuery=evidenceTerms.length?`${evidenceTerms.join(' ')} ${args.query||''}`.slice(0,2048):args.query||'';
  return {method:explicit?'explicit_phase':inferred?'workflow_evidence':'query_only',explicit_phase:explicit,inferred_phase:inferred,effective_phase:effective,
    reason,conflict,basis,unmet_domains:unmet,retrieval_query:retrievalQuery,next_action:nextAction,
    evidence_valid:observation?.valid??null,automatic_execution:false,acceptance_changed:false};
}

export function taskContext(root,args,registry){
  validateArguments(args,contextSchema);
  let observation=null;
  if(args.directory){const r=inspectWorkflow(root,args.directory);observation={run_id:r.run_id,directory:r.directory,status:r.status,valid:r.valid,issues:r.issues,outcome:r.outcome,task_acceptance:r.task_acceptance,recovery:r.recovery,completed_steps:r.completed_steps,next_step:r.next_step};}
  const selection=selectContextPhase(args,observation);
  const primarySop=selection.effective_phase==='review'?'fpga-reproduce':phaseSops[selection.effective_phase];
  const evidenceOnly=['review','recovery'].includes(selection.effective_phase)&&selection.method==='workflow_evidence';
  const knowledge=queryKnowledge(root,{query:selection.retrieval_query,limit:5}),catalog=querySop(root).sops;
  const matched=new Map(knowledge.retrieval.ranking.map((r,i)=>[r.id,1/(i+1)])),terms=new Set(tokenize(selection.retrieval_query));
  const ranked=catalog.map(s=>({sop:s,score:s.rule_ids.reduce((sum,id)=>sum+(matched.get(id)||0),0)+tokenize(s.triggers.join(' ')).filter(t=>terms.has(t)).length/10}))
    .filter(s=>evidenceOnly?s.sop.id===primarySop:s.score>0||s.sop.id===primarySop).sort((a,b)=>(b.sop.id===primarySop)-(a.sop.id===primarySop)||b.score-a.score||a.sop.id.localeCompare(b.sop.id)).slice(0,2);
  const selected=ranked.map(({sop,score})=>{const {content,input_hashes}=querySop(root,{id:sop.id});return {sop,content,input_hashes,selection:{method:sop.id===primarySop?selection.method:'rule_overlap_and_trigger_terms',score,phase:selection.effective_phase,reason:selection.reason}};});
  const names=[...new Set(selected.flatMap(s=>s.sop.required_tools||[]))],contracts=names.map(name=>{
    const tool=registry.get(name);if(!tool)throw new Error(`SOP references unavailable tool: ${name}`);
    return {name,description:tool.description,inputSchema:tool.parameters};
  });
  const allContracts=[...registry.values()].map(t=>({name:t.name,description:t.description,inputSchema:t.parameters}));
  return {schema_version:1,query:args.query,phase:args.phase||null,rules:knowledge.rules,sources:knowledge.sources,retrieval:knowledge.retrieval,sops:selected,tools:contracts,observation,selection,
    context_budget:{selected_tools:contracts.length,available_tools:registry.size,selected_schema_bytes:Buffer.byteLength(JSON.stringify(contracts)),all_schema_bytes:Buffer.byteLength(JSON.stringify(allContracts)),token_estimate:null},
    boundary:'Task-scoped context only. Selection does not execute tools, publish a new model tool set, establish SOP compliance or authorize EDA. Changed or incomplete observations remain unknown.',model_api_calls:0};
}
export function createContextTools(root,registry){return [{name:'eda_task_context',label:'EDA task context',description:'Prepare ranked rules, phase-selected SOPs and their actual tool contracts. Optionally revalidate a workflow and attach domain outcomes, evidence citations and recovery advice. No model or EDA execution.',parameters:contextSchema,
  async execute(id,args,signal,_update,ctx){
    const trace=createTrace({root,tool:'eda_task_context',args,toolCallId:id,context:ctx?.edaTraceContext});
    try{signal?.throwIfAborted();for(const file of [...knowledgeFiles(root),'src/task-context.mjs','src/task-outcome.mjs','src/workflow.mjs'])trace.capture(path.resolve(root,file),'context_input');
      const result=taskContext(root,args,registry);
      if(result.observation)trace.capture(path.join(result.observation.directory,'workflow.json'),'observation_pointer');
      trace.finalizeDependencies();fs.writeFileSync(path.join(trace.directory,'result.json'),JSON.stringify(result,null,2));trace.finish('completed');
      const details={...result,evidence:trace.directory};return {content:[{type:'text',text:JSON.stringify(details)}],details};
    }catch(error){const receipt=trace.finish(signal?.aborted?'cancelled':'failed',error);throw Object.assign(error,{receipt});}
  }}];}
