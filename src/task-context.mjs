import fs from 'node:fs';
import path from 'node:path';
import {queryKnowledge,querySop,knowledgeFiles,tokenize} from './knowledge.mjs';
import {inspectWorkflow} from './workflow.mjs';
import {createTrace} from './trace.mjs';
import {validateArguments} from './tool-contracts.mjs';
const phaseSops={planning:'fpga-plan',simulation:'fpga-rtl-verify',timing:'fpga-timing-triage',recovery:'fpga-reproduce',cdc:'fpga-cdc-review',ip:'fpga-ip-integrate'};
export const contextSchema={type:'object',properties:{query:{type:'string',minLength:1,maxLength:2048},phase:{type:'string',enum:Object.keys(phaseSops)},directory:{type:'string',minLength:1}},required:['query'],additionalProperties:false};
export function taskContext(root,args,registry){
  validateArguments(args,contextSchema);
  const knowledge=queryKnowledge(root,{query:args.query,limit:5}),catalog=querySop(root).sops;
  const matched=new Map(knowledge.retrieval.ranking.map((r,i)=>[r.id,1/(i+1)])),terms=new Set(tokenize(args.query));
  const ranked=catalog.map(s=>({sop:s,score:s.rule_ids.reduce((sum,id)=>sum+(matched.get(id)||0),0)+tokenize(s.triggers.join(' ')).filter(t=>terms.has(t)).length/10}))
    .filter(s=>s.score>0||s.sop.id===phaseSops[args.phase]).sort((a,b)=>(b.sop.id===phaseSops[args.phase])-(a.sop.id===phaseSops[args.phase])||b.score-a.score||a.sop.id.localeCompare(b.sop.id)).slice(0,2);
  const selected=ranked.map(({sop,score})=>{const {content,input_hashes}=querySop(root,{id:sop.id});return {sop,content,input_hashes,selection:{method:args.phase&&sop.id===phaseSops[args.phase]?'explicit_phase':'rule_overlap_and_trigger_terms',score}};});
  const names=[...new Set(selected.flatMap(s=>s.sop.required_tools||[]))],contracts=names.map(name=>{
    const tool=registry.get(name);if(!tool)throw new Error(`SOP references unavailable tool: ${name}`);
    return {name,description:tool.description,inputSchema:tool.parameters};
  });
  let observation=null;
  if(args.directory){const r=inspectWorkflow(root,args.directory);observation={run_id:r.run_id,directory:r.directory,valid:r.valid,issues:r.issues,outcome:r.outcome,task_acceptance:r.task_acceptance,recovery:r.recovery,completed_steps:r.completed_steps,next_step:r.next_step};}
  const allContracts=[...registry.values()].map(t=>({name:t.name,description:t.description,inputSchema:t.parameters}));
  return {schema_version:1,query:args.query,phase:args.phase||null,rules:knowledge.rules,sources:knowledge.sources,retrieval:knowledge.retrieval,sops:selected,tools:contracts,observation,
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
