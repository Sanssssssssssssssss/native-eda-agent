// Host-owned EDA acceptance: fixed domain evaluators over verified tool receipts.
// No model-authored success text or arbitrary JSON pointer can satisfy a domain.
import {validateArguments} from './tool-contracts.mjs';
const str={type:'string',minLength:1,maxLength:256};
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
export const domains=['functional','synthesis','setup','hold','constraints','routing','drc','cdc','artifact_integrity'];
export const profiles={
  evidence_review:{required:['artifact_integrity'],sops:['fpga-reproduce'],scope:'Retained evidence integrity only; no design rerun.'},
  rtl_simulation:{required:['functional'],sops:['fpga-plan','fpga-rtl-verify'],scope:'Explicit testbench acceptance; no physical or formal signoff.'},
  fpga_ooc:{required:['functional','synthesis','setup','hold','constraints','routing','drc'],sops:['fpga-plan','fpga-rtl-verify','fpga-timing-triage'],scope:'Fixed-part OOC implementation; CDC is evaluated only when bound. No formal or hardware signoff.'},
};
export const acceptanceSchema=object({profile:{type:'string',enum:Object.keys(profiles)},
  bindings:object(Object.fromEntries(domains.map(d=>[d,str]))),
  design:object({top:str,part:str,clock:str,period_ns:{type:'number',minimum:0.001}},['top','part','clock','period_ns']),
  minimum_setup_ns:{type:'number',minimum:0},minimum_hold_ns:{type:'number',minimum:0}
},['profile','bindings']);
const physicalTools=['eda_vivado_implement','eda_vivado_reports','eda_vivado_report_timing','eda_vivado_report_route','eda_vivado_report_cdc','eda_vivado_report_drc'];
const toolsFor={functional:['eda_xsim'],synthesis:['eda_vivado_synthesize'],artifact_integrity:['eda_results_verify'],
  setup:physicalTools,hold:physicalTools,constraints:physicalTools,routing:physicalTools,drc:physicalTools,cdc:physicalTools};
export function compileAcceptance(spec){
  if(!spec.acceptance)return null;
  validateArguments(spec.acceptance,acceptanceSchema,'acceptance');
  const a=spec.acceptance,profile=profiles[a.profile],required=[...new Set([...profile.required,...Object.keys(a.bindings)])];
  const missing=required.filter(d=>!a.bindings[d]);
  if(missing.length)throw new Error(`Acceptance has unbound domains: ${missing.join(', ')}`);
  if(a.profile==='fpga_ooc'&&!a.design)throw new Error('FPGA OOC acceptance requires explicit top, part, clock and period');
  for(const [domain,id]of Object.entries(a.bindings)){
    const step=spec.steps.find(s=>s.id===id);
    if(!step||!toolsFor[domain].includes(step.tool))throw new Error(`Invalid ${domain} evidence binding: ${id}`);
    if(domain==='functional'&&!step.args.pass_marker?.trim())throw new Error('Functional acceptance requires a fixed nonempty pass_marker');
    if(a.design&&domain==='synthesis'&&(step.args.top!==a.design.top||step.args.part!==a.design.part))throw new Error('Synthesis arguments differ from the accepted design identity');
  }
  // An implementation must consume the accepted synthesis DCP; reports consume
  // that implementation DCP. Unrelated successful designs cannot be combined.
  if(a.profile==='fpga_ooc'){
    const synthesis=a.bindings.synthesis;
    const implementation=spec.steps.find(s=>s.id===a.bindings.routing);
    if(implementation.tool!=='eda_vivado_implement'||implementation.args.checkpoint?.$result?.step!==synthesis||implementation.args.checkpoint.$result.pointer!=='/fpga/artifacts/synthesized.dcp')throw new Error('OOC routing must consume the bound synthesis checkpoint');
    for(const domain of required.filter(d=>physicalTools.includes(spec.steps.find(s=>s.id===a.bindings[d]).tool))){
      const step=spec.steps.find(s=>s.id===a.bindings[domain]);
      if(step.id!==implementation.id&&(step.tool==='eda_vivado_implement'||step.args.checkpoint?.$result?.step!==implementation.id||step.args.checkpoint.$result.pointer!=='/fpga/artifacts/routed.dcp'))throw new Error('Physical evidence must consume the bound routed checkpoint');
    }
    const sim=spec.steps.find(s=>s.id===a.bindings.functional),synth=spec.steps.find(s=>s.id===synthesis);
    if(synth.args.sources.some(f=>!sim.args.sources.includes(f)))throw new Error('Simulation must include every accepted synthesis source');
    for(const option of ['generics','defines','include_dirs'])if(JSON.stringify(sim.args[option]||[])!==JSON.stringify(synth.args[option]||[]))throw new Error(`Simulation and synthesis ${option} differ`);
  }
  const functional=spec.steps.find(s=>s.id===a.bindings.functional);
  return {...a,required,pass_marker:functional?.args.pass_marker,sop_ids:[...profile.sops,...(a.bindings.cdc?['fpga-cdc-review']:[])],scope:profile.scope};
}
const unknown=reason=>({status:'unknown',reason});
function domainResult(domain,result,contract){
  const f=result.fpga||{},a=f.assessment||{};
  const metric=(value,min,pointer)=>!Number.isFinite(value)?unknown('metric_missing'):{status:value>=min?'passed':'failed',observed:value,expected_min:min,pointers:[pointer]};
  const status=(value,pointer)=>({status:{pass:'passed',fail:'failed',review_required:'review_required',no_reported_warning:'passed'}[value]||'unknown',observed:value??null,pointers:[pointer]});
  if(domain==='functional'){
    const s=result.simulation_acceptance;
    if(!s)return unknown('simulation_acceptance_missing');
    const passed=s.status==='pass'&&s.pass_marker===contract.pass_marker&&s.marker_matches===1&&s.completion_observed===true&&s.failure_diagnostic===false;
    return {status:passed?'passed':s.status==='fail'?'failed':'unknown',observed:s,pointers:['/simulation_acceptance']};
  }
  if(domain==='artifact_integrity')return {status:result.public_evidence_valid===false||result.available_originals_valid===false?'failed':result.public_evidence_valid===true&&result.available_originals_valid===true?'passed':'unknown',observed:{public:result.public_evidence_valid,originals:result.available_originals_valid,available:result.originals_available},pointers:['/public_evidence_valid','/available_originals_valid']};
  if(domain==='synthesis')return Number.isInteger(f.black_boxes)&&f.black_boxes>=0?{status:f.black_boxes===0?'passed':'failed',observed:f.black_boxes,pointers:['/fpga/black_boxes']}:unknown('black_box_count_missing');
  if(domain==='setup'||domain==='hold')return metric(f[`${domain}_slack_ns`],contract[`minimum_${domain}_ns`]??0,`/fpga/${domain}_slack_ns`);
  if(domain==='constraints'){
    const statuses=[a.clock_and_internal_constraints,a.io_constraints].map(v=>status(v).status);
    return {status:statuses.includes('failed')?'failed':statuses.includes('unknown')?'unknown':statuses.includes('review_required')?'review_required':'passed',observed:{internal:a.clock_and_internal_constraints,io:a.io_constraints},pointers:['/fpga/assessment/clock_and_internal_constraints','/fpga/assessment/io_constraints']};
  }
  if(domain==='routing')return status(f.parsed_reports?.route?.status,'/fpga/parsed_reports/route');
  if(domain==='cdc')return status(a.cdc,'/fpga/assessment/cdc');
  if(domain==='drc'){
    const d=f.drc;
    if(!d||!['errors','critical_warnings','warnings'].every(k=>Number.isInteger(d[k])&&d[k]>=0))return unknown('drc_violation_counts_missing');
    return {status:d.errors||d.critical_warnings?'failed':d.warnings?'review_required':'passed',observed:d,pointers:['/fpga/drc']};
  }
  return unknown('unsupported_domain');
}
export function evaluateTask(contract,results,records,issues=[]){
  if(!contract)return {status:'unknown',reason:'goal_scope_unbound',domains:[],scope:'Workflow checks only; no structured engineering goal was bound.',formal:'not_evaluated',hardware:'not_evaluated'};
  const rows=domains.map(domain=>{
    if(!contract.required.includes(domain))return {domain,status:'not_requested'};
    const step=contract.bindings[domain],record=records.find(r=>r.id===step),result=results[step];
    let evaluated=!result?unknown('verified_step_evidence_missing'):domainResult(domain,result,contract);
    if(result?.fpga&&contract.design){
      const f=result.fpga,d=contract.design;
      if(f.part!==d.part||f.design!==d.top)evaluated={...evaluated,status:'failed',reason:'design_identity_mismatch'};
      const clock=f.clocks?.find(c=>c.name===d.clock);
      if(!clock||!Number.isFinite(clock.period_ns))evaluated={...evaluated,status:'unknown',reason:'accepted_clock_missing'};
      else if(Math.abs(clock.period_ns-d.period_ns)>1e-6)evaluated={...evaluated,status:'failed',reason:'clock_period_mismatch'};
    }
    return {domain,step,...evaluated,evidence:record?{result:record.result_path,sha256:record.result_sha256,child_directory:record.child_directory}:null};
  });
  const required=rows.filter(r=>r.status!=='not_requested');
  const status=issues.length?'unknown':required.some(r=>r.status==='failed')?'failed':required.some(r=>r.status==='unknown')?'unknown':required.some(r=>r.status==='review_required')?'review_required':'passed';
  return {profile:contract.profile,status,reason:issues.length?'evidence_integrity_or_freshness_failed':null,issues,domains:rows,scope:contract.scope,formal:'not_evaluated',hardware:'not_evaluated'};
}
export function recoveryAdvice(state,issues=[]){
  const history=state.failure_history||[],last=history.at(-1),same=last?history.filter(h=>h.fingerprint===last.fingerprint).length:0;
  const stalled=same>=3,unmet=state.task_acceptance?.domains?.filter(d=>!['passed','not_requested'].includes(d.status)).map(d=>d.domain)||[];
  const next=issues.length?'repair_evidence_or_start_new_task':stalled?'diagnose_before_new_task':state.outcome==='passed'?'deliver_evidence':state.passed.length===state.plan.spec.steps.length?'review_unmet_goal':'inspect_failed_step_then_resume_check';
  return {next_action:next,automatic_retry:false,stalled,same_failure_count:same,unmet_domains:unmet,
    recommended_tools:stalled||state.error?['eda_trace','eda_sop']:['eda_workflow_inspect'],
    scope:'Advisory diagnosis; no model request, automatic replay or change to acceptance.'};
}
