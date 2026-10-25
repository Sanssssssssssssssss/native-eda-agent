// ACE-RTL role loop adapted to Pi and the existing, independently checked EDA workflow.
// The upstream source is pinned in vendor/ace-rtl; only public task/evaluator facts cross the bridge.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {isDeepStrictEqual} from 'node:util';
import {planWorkflow, inspectWorkflow, createWorkflowTools} from './workflow.mjs';
import {validateArguments} from './tool-contracts.mjs';
import {taskContext} from './task-context.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const schema = {type:'object', additionalProperties:false, required:['spec','editable_sources','max_rounds','max_calls'], properties:{
  spec:{type:'string',minLength:1,maxLength:2048},
  editable_sources:{type:'array',minItems:1,maxItems:32,uniqueItems:true,items:{type:'string',minLength:1,maxLength:2048}},
  protected_sources:{type:'array',maxItems:256,uniqueItems:true,items:{type:'string',minLength:1,maxLength:2048}},
  max_rounds:{type:'integer',minimum:1,maximum:8}, max_calls:{type:'integer',minimum:1,maximum:100},
}};
export const verificationSchema = schema;
const relative = (root, file) => path.relative(root, file).replaceAll('\\','/');
const unknown = reason => ({status:'unknown',reason,domains:[],formal:'not_evaluated',hardware:'not_evaluated'});
const bounded=(value,bytes)=>Buffer.from(String(value??'')).subarray(0,bytes).toString('utf8');
function publicObservation(observed){
  if(typeof observed==='number'||typeof observed==='boolean'||typeof observed==='string')return typeof observed==='string'?bounded(observed,256):observed;
  if(!observed||typeof observed!=='object')return undefined;
  return Object.fromEntries(['status','marker_matches','completion_observed','failure_diagnostic','errors','critical_warnings','warnings','internal','io']
    .filter(key=>Object.hasOwn(observed,key)&&['string','number','boolean'].includes(typeof observed[key]))
    .map(key=>[key,typeof observed[key]==='string'?bounded(observed[key],256):observed[key]]));
}

export function prepareVerification(root, configuration, registry) {
  validateArguments(configuration, schema, 'verification');
  const plan = planWorkflow(root, configuration.spec, registry);
  if (!plan.acceptance) throw new Error('Verification loop requires a bound acceptance profile');
  if (!plan.acceptance.required.includes('functional')) throw new Error('RTL repair requires independent functional acceptance');
  const simulation=plan.spec.steps.find(step=>step.id===plan.acceptance.bindings.functional);
  const simulationSources=simulation.args.sources.map(name=>relative(root,fs.realpathSync(path.resolve(root,name))));
  const top=simulation.args.top?.split('.').at(-1);
  if(!top)throw new Error('Functional verifier requires an explicit testbench top');
  // Conservative top-declaration detection, not an HDL parser. Unrecognized or
  // generated tops require a statically declared checker before admission.
  const topSources=simulationSources.filter(name=>{
    const code=fs.readFileSync(path.join(root,name),'utf8').replace(/\/\*[\s\S]*?\*\//g,' ').replace(/\/\/[^\n]*|--[^\n]*/g,' ');
    const declarations=[...code.matchAll(/\b(?:module\s+(?:(?:automatic|static)\s+)?|entity\s+)(\\[^\s]+|[A-Za-z_$][\w$]*)/gi)].map(match=>match[1].replace(/^\\/,''));
    return declarations.some(declaration=>/\.vhd(?:l)?$/i.test(name)?declaration.toLowerCase()===top.toLowerCase():declaration===top);
  });
  if(!topSources.length)throw new Error('Cannot identify the immutable testbench top source');
  const protectedSources=(configuration.protected_sources||[]).map(name=>{
    const key=relative(root,fs.realpathSync(path.resolve(root,name)));
    if(!Object.hasOwn(plan.input_hashes,key))throw new Error('Protected source must be a workflow input');
    return key;
  });
  const synthesis=plan.spec.steps.find(step=>step.id===plan.acceptance.bindings.synthesis);
  const synthesisSources=synthesis?.args.sources.map(name=>relative(root,fs.realpathSync(path.resolve(root,name))));
  const editable = configuration.editable_sources.map(name => {
    const file = fs.realpathSync(path.resolve(root,name)), key = relative(root,file);
    if (!/\.(?:sv|v|vhd|vhdl)$/i.test(key) || !Object.hasOwn(plan.input_hashes,key)) throw new Error('Editable RTL must be an explicit workflow input');
    if (key === plan.spec_path) throw new Error('Verification contract cannot be editable');
    if(!simulationSources.includes(key)||(synthesisSources&&!synthesisSources.includes(key)))throw new Error('Editable RTL must be a verified design source');
    if(topSources.includes(key)||protectedSources.includes(key)||/(?:^|[/_.-])(?:tb|testbench)(?:[/_.-]|$)/i.test(key))throw new Error('Verifier testbench or protected checker cannot be editable');
    return key;
  });
  if (new Set(editable).size !== editable.length) throw new Error('Editable source aliases are not allowed');
  if (plan.spec.limits.max_calls > configuration.max_calls) throw new Error('Verifier total budget must fit at least one declared workflow budget');
  return {schema_version:1,configuration:structuredClone(configuration),plan,editable_sources:editable,
    protected_inputs:Object.fromEntries(Object.entries(plan.input_hashes).filter(([name])=>!editable.includes(name))),
    boundary:'Only listed RTL bytes may change between verification rounds. This is a drift gate, not a filesystem sandbox.'};
}

function currentPlan(root, frozen, registry) {
  const plan = planWorkflow(root,frozen.configuration.spec,registry);
  for (const field of ['spec','spec_sha256','code_hashes','input_bindings','include_directories','acceptance','guidance']) {
    if (!isDeepStrictEqual(plan[field],frozen.plan[field])) throw new Error(`Verification contract changed: ${field}`);
  }
  if (!isDeepStrictEqual(Object.keys(plan.input_hashes),Object.keys(frozen.plan.input_hashes))) throw new Error('Verification input inventory changed');
  for (const [file,hash] of Object.entries(frozen.protected_inputs)) if (plan.input_hashes[file] !== hash) throw new Error(`Protected verifier input changed: ${file}`);
  return plan;
}

export function aceFeedback(root, request, signal) {
  return new Promise((resolve,reject) => {
    const bundled = path.join(root,'runtime/vivado-community-venv/Scripts/python.exe');
    const child = spawn(fs.existsSync(bundled)?bundled:'python',[path.join(root,'scripts/ace-rtl-feedback.py')],
      {cwd:root,windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8',PYTHONDONTWRITEBYTECODE:'1'}});
    let stdout='',stderr='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>{child.kill();finish(signal?.reason||new Error('Feedback cancelled'));};
    const timer=setTimeout(()=>{child.kill();finish(new Error('ACE feedback exceeded 15 seconds'));},15000);
    child.on('error',error=>finish(error));child.stdin.on('error',error=>finish(error));
    child.stdout.on('data',bytes=>{stdout+=bytes.toString();if(Buffer.byteLength(stdout)>131072){child.kill();finish(new Error('ACE feedback exceeded output budget'));}});
    child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-4000);});
    child.on('close',code=>{if(code!==0)return finish(new Error(`ACE feedback failed (${code}): ${stderr}`));try{finish(null,JSON.parse(stdout));}catch(error){finish(error);}});
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();else child.stdin.end(JSON.stringify(request));
  });
}

export async function runVerifiedLoop({root,configuration,registry,prompt,generate,signal,directory,traceContext,onState=()=>{},feedback,continuation,assertScope=()=>{}}) {
  root=path.resolve(root);
  const frozen=prepareVerification(root,configuration,registry);
  configuration=frozen.configuration;
  const output=path.resolve(directory);
  const artifacts=fs.realpathSync(path.join(root,'artifacts'));
  const outReal=fs.realpathSync(output), rel=path.relative(artifacts,outReal);
  if(!rel||rel.startsWith('..')||path.isAbsolute(rel))throw new Error('Verifier evidence must stay inside the owned artifacts directory');
  // Exclusive creation: a second loop cannot silently overwrite the first receipt.
  fs.writeFileSync(path.join(output,'verification-contract.json'),JSON.stringify(frozen,null,2)+'\n',{flag:'wx'});
  const file=path.join(output,'verification-loop.json');
  fs.writeFileSync(file,'{}\n',{flag:'wx'});
  const result={schema_version:1,status:'running',phase:'boundary',task_acceptance:unknown('not_verified'),
    rounds:structuredClone(continuation?.rounds || []),calls:continuation?.calls || 0,
    limits:{max_rounds:configuration.max_rounds,max_calls:configuration.max_calls},
    budget_scope:'Verifier workflow calls only; Pi turns and total wall time are bounded by the owning agent session.',
    protected_inputs:frozen.protected_inputs,editable_sources:frozen.editable_sources,model_api_calls:0,
    model_usage_scope:'The host generator uses the owning Pi session and is metered there. The ACE bridge makes no model calls.',
    started_at:new Date().toISOString()};
  if (continuation) {
    if (continuation.status !== 'cancelled' || continuation.phase !== 'boundary' || !isDeepStrictEqual(continuation.limits,result.limits)) throw new Error('Continuation requires a checked cancelled boundary with unchanged budgets');
    result.last_directory=continuation.last_directory;
    result.task_acceptance=structuredClone(continuation.task_acceptance);
    result.resumed_rounds=continuation.rounds.length;
  }
  const save=()=>{const pending=`${file}.${randomUUID()}.tmp`;const fd=fs.openSync(pending,'wx');try{fs.writeFileSync(fd,JSON.stringify(result,null,2)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(pending,file);};
  const notify=()=>onState({schema_version:1,binding:result.last_directory?{directory:result.last_directory}:null,
    execution_status:result.status,task_acceptance:result.task_acceptance,
    decision:{action:result.status==='passed'?'deliver_evidence':result.status==='running'?'repair_and_reverify':result.status,phase:result.phase},
    evidence_status:result.status==='invalid'?'invalid':result.rounds.length?'checked':'not_checked',verifier_rounds:result.rounds.length,
    budget:{...result.limits,used_rounds:result.rounds.length,used_calls:result.calls},guidance:result.guidance || null});
  const tools=new Map(createWorkflowTools(root,registry).map(tool=>[tool.name,tool]));
  const history=[];
  let nextPrompt=`${prompt}\n\n[Host verification contract]\n${JSON.stringify({goal:frozen.plan.spec.goal,editable_sources:frozen.editable_sources,protected_inputs:Object.keys(frozen.protected_inputs),acceptance:frozen.plan.acceptance,limits:result.limits})}\nPrepare the candidate in the listed RTL files. The host will run the fixed independent verifier after your response. Preserve checker files, constraints, interfaces and acceptance. Do not claim success before the host verifier passes.`;
  if(continuation) nextPrompt+=`\n[Resumed verified boundary]\n${continuation.rounds.at(-1)?.error_report || ''}\nRemaining budgets are cumulative. Previous failures remain recorded. Repair this candidate using the fixed scope.`;
  try {
    for(let index=result.rounds.length;index<configuration.max_rounds;index++) {
      signal?.throwIfAborted();
      await assertScope();
      currentPlan(root,frozen,registry);
      if(result.calls+frozen.plan.spec.limits.max_calls>configuration.max_calls){result.status='budget_exhausted';break;}
      const context=taskContext(root,{query:frozen.plan.spec.goal,...(result.last_directory?{directory:result.last_directory}:{phase:'planning'})},registry);
      result.guidance={phase:context.selection.effective_phase,reason:context.selection.reason,
        rule_ids:context.rules.map(rule=>rule.id),sop_ids:context.sops.map(row=>row.sop.id),
        input_hashes:Object.assign({},...context.sops.map(row=>row.input_hashes)),acceptance_changed:false};
      const guidance=JSON.stringify({selection:context.selection,rules:context.rules.map(rule=>({id:rule.id,title:rule.title,required_evidence:rule.required_evidence})),
        sops:context.sops.map(row=>({id:row.sop.id,content:bounded(row.content,1800),input_hashes:row.input_hashes}))});
      result.phase='generating';save();notify();
      await generate(`${nextPrompt}\n\n[Evidence-selected RAG / SOP guidance]\n${bounded(guidance,10000)}\nThese are cited recommendations. The fixed host checks determine acceptance; read complete SOPs with eda_sop when needed.`);
      signal?.throwIfAborted();
      await assertScope();
      const plan=currentPlan(root,frozen,registry);
      const candidate=Object.fromEntries(frozen.editable_sources.map(name=>[name,plan.input_hashes[name]]));
      const candidateHash=sha(JSON.stringify(candidate));
      let run;
      result.phase='verifying';result.reserved_calls=frozen.plan.spec.limits.max_calls;save();notify();
      try {
        run=await tools.get('eda_workflow_run').execute(`verify-${randomUUID()}`,{spec:configuration.spec},signal,undefined,{edaTraceContext:traceContext?.()||{}});
      } catch(error) {
        // A missing receipt cannot safely refund a possibly executed verifier budget.
        result.calls+=frozen.plan.spec.limits.max_calls;throw error;
      }
      const inspected=inspectWorkflow(root,run.details.directory);
      result.calls+=inspected.calls;
      result.reserved_calls=0;
      await assertScope();
      const verifiedPlan=currentPlan(root,frozen,registry);
      if(frozen.editable_sources.some(name=>verifiedPlan.input_hashes[name]!==candidate[name]))throw new Error('Candidate changed during verification');
      result.last_directory=inspected.directory;
      result.task_acceptance=inspected.task_acceptance;
      const domains=inspected.task_acceptance.domains.map(({domain,status,reason,observed,expected_min})=>({domain,status,reason,
        ...(observed===undefined?{}:{observed:publicObservation(observed)}),...(expected_min===undefined?{}:{expected_min})}));
      const checks=(inspected.state.failed_step?.checks||[]).filter(check=>!check.passed).slice(0,8).map(({pointer,op,value,actual,passed})=>({pointer,op,expected:publicObservation(value),actual:publicObservation(actual),passed}));
      // Only independent evaluator facts enter role feedback, never testbench source or hidden expectations.
      const errorReport=JSON.stringify({status:inspected.status,outcome:inspected.outcome,issues:inspected.issues,domains,
        failure:inspected.state.failed_step?.id||inspected.state.current_step||null,checks,
        error:bounded(inspected.state.error,1024),diagnostic:bounded(inspected.failure_diagnostic,6144),
        evidence:{workflow:inspected.directory,failed_result:inspected.state.failed_step?.result_path||null,
          failed_result_sha256:inspected.state.failed_step?.result_sha256||null,failed_tool:inspected.state.failed_tool?.child_directory||null}});
      const round={index:index+1,directory:inspected.directory,candidate_sha256:candidateHash,candidate_hashes:candidate,
        task_acceptance:inspected.task_acceptance,outcome:inspected.outcome,calls:inspected.calls,
        failure_signature:sha(JSON.stringify({outcome:inspected.outcome,domains,checks})),error_report:errorReport,guidance:structuredClone(result.guidance)};
      result.rounds.push(round);result.phase='boundary';save();notify();
      signal?.throwIfAborted();
      if(inspected.valid&&inspected.task_acceptance.status==='passed'&&inspected.outcome==='passed'){result.status='passed';break;}
      if(!inspected.valid){result.status='invalid';result.reason='verifier_evidence_invalid';break;}
      if(inspected.task_acceptance.status==='review_required'){result.status='failed';result.reason='engineering_review_required';break;}
      const previous=result.rounds.at(-2);
      if(previous?.candidate_sha256===candidateHash&&previous.failure_signature===round.failure_signature){result.status='failed';result.reason='unchanged_candidate_repeated_failure';break;}
      if(index+1===configuration.max_rounds||result.calls+frozen.plan.spec.limits.max_calls>configuration.max_calls){result.status='budget_exhausted';break;}
      const code=frozen.editable_sources.map(name=>`// FILE: ${name}\n${fs.readFileSync(path.join(root,name),'utf8')}`).join('\n');
      if(Buffer.byteLength(code)>98304)throw new Error('Candidate exceeds the bounded ACE feedback input; use a narrower task');
      history.push({rtl_code:code,error_report:errorReport});
      const reflected=await (feedback||((request)=>aceFeedback(root,request,signal)))({specification:frozen.plan.spec.goal,rtl_code:code,error_report:errorReport,history});
      if(typeof reflected?.context!=='string'||Buffer.byteLength(reflected.context)>65536||reflected.model_api_calls!==0)throw new Error('Invalid ACE feedback contract');
      round.feedback={...reflected};save();
      nextPrompt=`[Independent verifier: ${inspected.task_acceptance.status}]\n${errorReport}\n\n[ACE-RTL feedback]\n${reflected.context}\n\n[Coordinator]\n${JSON.stringify(reflected.decision||{})}\nRepair only the allowed RTL. Retain the fixed specification, testbench and constraints. The host will verify again. Any restart advice means a new reasoning approach within this same candidate scope and remaining budget; it does not authorize filesystem reset or a new model.`;
    }
  }catch(error){result.status=signal?.aborted?'cancelled':'invalid';result.reason=String(error.message||error);result.task_acceptance=unknown(signal?.aborted?'verification_cancelled':'verification_invalid');}
  if(result.status==='running')result.status='budget_exhausted';
  if(result.status!=='passed'&&result.task_acceptance.status==='passed')result.task_acceptance=unknown('loop_not_accepted');
  result.finished_at=new Date().toISOString();save();notify();
  return result;
}
