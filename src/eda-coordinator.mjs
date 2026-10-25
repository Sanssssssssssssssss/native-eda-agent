// Branch-local pointers and fresh host evidence for Pi's normal context hook.
// No model client, EDA dispatch, custom compaction or persisted success summary.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {inspectWorkflow} from './workflow.mjs';
import {selectContextPhase} from './task-context.mjs';

const bindingType='eda-task-binding';
const messageType='eda-task-state';
const unknown=reason=>({status:'unknown',reason,domains:[],formal:'not_evaluated',hardware:'not_evaluated'});
const brief=(value,limit=256)=>typeof value==='string'?value.slice(0,limit):value??null;

function contextFor(state){
  const acceptance=state.task_acceptance;
  const view={schema_version:1,binding:state.binding?{directory:brief(state.binding.directory,512),run_id:brief(state.binding.run_id,128)}:null,
    execution_status:state.execution_status,evidence_status:state.evidence_status,task:state.task,
    task_acceptance:{status:acceptance.status,reason:brief(acceptance.reason),profile:acceptance.profile,
      scope:brief(acceptance.scope,384),formal:acceptance.formal,hardware:acceptance.hardware,
      domains:(acceptance.domains||[]).slice(0,16).map(d=>({domain:brief(d.domain,48),status:d.status,reason:brief(d.reason,128),step:brief(d.step,80),
        ...(Number.isFinite(d.observed)?{observed:d.observed}:{}),...(Number.isFinite(d.expected_min)?{expected_min:d.expected_min}:{}),
        ...(d.evidence?{evidence:{result:brief(d.evidence.result,256),sha256:brief(d.evidence.sha256,64)}}:{})}))},
    decision:state.decision,reflection:state.reflection,active_task:state.active_task||null};
  const prefix='Fresh host-verified EDA state. Use this state instead of historical success claims or compaction summaries. Unknown, invalid, failed and review_required are not acceptance. Guidance does not authorize execution or change fixed checks.\n';
  let text=prefix+JSON.stringify(view);
  if(Buffer.byteLength(text)>12000){
    view.task_acceptance.domains=view.task_acceptance.domains.map(({domain,status,reason})=>({domain,status,reason}));
    view.reflection={...view.reflection,issues:view.reflection.issues.slice(0,3),recent_failures:view.reflection.recent_failures.slice(-3),truncated:true};
    text=prefix+JSON.stringify(view);
  }
  // All remaining strings and arrays are bounded above. This is a final guard
  // for unusual Unicode paths or future additions, without cutting JSON bytes.
  if(Buffer.byteLength(text)>12000)text=prefix+JSON.stringify({schema_version:1,binding:view.binding,evidence_status:view.evidence_status,
    execution_status:view.execution_status,task:state.task,task_acceptance:{status:acceptance.status,reason:brief(acceptance.reason,128)},decision:state.decision,
    active_task:state.active_task?{...state.active_task,editable_sources:null,editable_sources_omitted:true}:null,truncated:true});
  return text;
}

export function createEdaCoordinator(root,{initialDirectory,onState=()=>{},taskContext}={}){
  root=fs.realpathSync(root);
  let pointer=null,pi=null,initialPending=Boolean(initialDirectory),bindingProblem=null,lastFingerprint=null;
  const resolveDirectory=directory=>{
    if(typeof directory!=='string'||!directory||/[\0\r\n]/.test(directory))throw new Error('Expected a workflow directory');
    const artifacts=fs.realpathSync(path.join(root,'artifacts'));
    const file=fs.realpathSync(path.resolve(root,directory)),relative=path.relative(artifacts,file);
    if(!relative||relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative)||!fs.statSync(file).isDirectory())throw new Error('Workflow binding must be a real directory inside workspace artifacts');
    return file;
  };
  if(initialDirectory)pointer=resolveDirectory(initialDirectory);

  function refresh(){
    let state;
    if(!pointer){
      state={schema_version:1,binding:null,execution_status:'unbound',task:null,task_acceptance:unknown(bindingProblem||'workflow_unbound'),
        decision:{action:'bind_workflow',reason:bindingProblem||'workflow_unbound',phase:null},
        reflection:{issues:bindingProblem?[bindingProblem]:[],unmet_domains:[],recent_failures:[],stalled:false},evidence_status:bindingProblem?'invalid':'unknown'};
    }else{
      try{
        // Recheck containment as well as receipts: an existing pointer can later
        // be replaced with a directory junction or lose its workflow checkpoint.
        const directory=resolveDirectory(pointer),observed=inspectWorkflow(root,directory);
        const selection=selectContextPhase({},observed);
        const plan=observed.state.plan,limits=plan.spec.limits;
        const inputHashes=Object.entries(plan.input_hashes).sort(([a],[b])=>a<b?-1:a>b?1:0);
        state={schema_version:1,binding:{directory,run_id:observed.run_id},execution_status:observed.status,
          task:{goal:brief(plan.spec.goal,800),design:plan.acceptance?.design||null,input_count:inputHashes.length,
            input_hashes_sha256:createHash('sha256').update(JSON.stringify(inputHashes)).digest('hex'),input_hashes_scope:'frozen_workflow_inputs',
            budget:{max_calls:limits.max_calls,remaining_calls:Math.max(0,limits.max_calls-observed.calls),wall_seconds:limits.wall_seconds,
              remaining_ms:observed.status==='running'?null:Math.max(0,limits.wall_seconds*1000-observed.spent_ms),
              remaining_ms_reason:observed.status==='running'?'active_owner_elapsed_time_not_frozen':null}},
          task_acceptance:observed.task_acceptance,
          decision:{action:selection.next_action,reason:selection.reason,phase:selection.effective_phase},
          reflection:{issues:observed.issues.slice(0,8).map(issue=>brief(issue,160)),
            unmet_domains:selection.unmet_domains.map(({domain,status,reason})=>({domain,status,reason:brief(reason,128)})),
            recent_failures:(observed.state.failure_history||[]).slice(-6).map(({fingerprint,step,outcome})=>({fingerprint:brief(fingerprint,64),step:brief(step,80),outcome:brief(outcome,64)})),
            stalled:observed.recovery.stalled,same_failure_count:observed.recovery.same_failure_count,
            completed_steps:observed.completed_steps.slice(0,32),next_step:observed.next_step},
          evidence_status:observed.valid?'checked':'invalid'};
      }catch(error){
        state={schema_version:1,binding:{directory:pointer,run_id:null},execution_status:'invalid',task:null,task_acceptance:unknown('workflow_inspection_failed'),
          decision:{action:'repair_evidence_or_start_new_task',reason:'workflow_inspection_failed',phase:'recovery'},
          reflection:{issues:[brief(error.message,320)],unmet_domains:[],recent_failures:[],stalled:false},evidence_status:'invalid'};
      }
    }
    if(taskContext)try{
      const active=taskContext();
      if(active){state.active_task=active;state.task_acceptance=unknown(active.scope_valid?'awaiting_current_candidate_verification':'active_task_integrity_failed');
        state.decision={action:active.scope_valid?'repair_within_frozen_scope':'inspect_evidence',phase:active.scope_valid?active.phase:'recovery'};
        if(!active.scope_valid)state.evidence_status='invalid';}
    }catch(error){state.active_task={scope_valid:false,issue:brief(error.message,256)};state.task_acceptance=unknown('active_task_inspection_failed');}
    state.context=contextFor(state);
    const fingerprint=JSON.stringify(state);
    if(fingerprint!==lastFingerprint){
      lastFingerprint=fingerprint;
      try{onState(structuredClone(state));}catch{/* UI observers cannot alter authoritative evidence. */}
    }
    return structuredClone(state);
  }

  function bind(directory){
    const resolved=resolveDirectory(directory),changed=resolved!==pointer||bindingProblem||initialPending;
    pointer=resolved;bindingProblem=null;initialPending=!pi;
    if(pi&&changed)pi.appendEntry(bindingType,{directory:pointer});
    return refresh();
  }

  function restore(ctx,{seed=false}={}){
    if(seed&&initialPending){
      initialPending=false;
      // initialDirectory is an explicit initial task request, scoped to this
      // first session only. Subsequent branch/session changes never reuse it.
      pi.appendEntry(bindingType,{directory:pointer});
      return refresh();
    }
    initialPending=false;pointer=null;bindingProblem=null;
    const branch=ctx?.sessionManager?.getBranch?.()||[];
    const entry=branch.filter(item=>item.type==='custom'&&item.customType===bindingType).at(-1);
    if(entry){try{pointer=resolveDirectory(entry.data?.directory);}catch{bindingProblem='saved_workflow_binding_invalid';}}
    return refresh();
  }

  const api={bind,refresh,install(extension){
    if(pi){if(pi!==extension)throw new Error('Coordinator is already installed');return api;}
    if(typeof extension?.on!=='function'||typeof extension?.appendEntry!=='function')throw new Error('Coordinator requires the Pi extension lifecycle and appendEntry API');
    pi=extension;
    pi.on('session_start',(_event,ctx)=>{restore(ctx,{seed:true});});
    pi.on('session_tree',(_event,ctx)=>{restore(ctx);});
    pi.on('context',(event,ctx)=>{
      const state=restore(ctx,{seed:true});
      const messages=event.messages.filter(message=>!(message.role==='custom'&&message.customType===messageType));
      return {messages:[...messages,{role:'custom',customType:messageType,content:state.context,display:false,timestamp:Date.now()}]};
    });
    pi.on('tool_result',(event)=>{
      const details=event.details;
      const directory=['eda_workflow_run','eda_workflow_resume'].includes(event.toolName)?details?.directory:
        event.toolName==='eda_task_context'?details?.observation?.directory:undefined;
      if(typeof directory!=='string')return;
      try{bind(directory);}catch{/* Unrelated/unsafe output cannot replace the active branch binding. */}
    });
    return api;
  }};
  return api;
}
