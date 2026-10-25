// A durable task binds the user's verifier to an isolated candidate and owned attempts.
// Models may propose/repair RTL; only fresh workflow evidence can accept the task.
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {prepareVerification,verificationSchema} from './verifier-loop.mjs';
import {inspectWorkflow} from './workflow.mjs';
import {pidAlive} from './runtime.mjs';
import {createTrace} from './trace.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const hashFile = file => hash(fs.readFileSync(file));
const relative = (root, file) => path.relative(root, file).replaceAll('\\', '/');
const unknown = reason => ({status:'unknown', reason, domains:[], formal:'not_evaluated', hardware:'not_evaluated'});
const json = file => {
  if (fs.statSync(file).size > 8 * 1024 * 1024) throw new Error('Task record exceeds 8 MiB');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
};
function write(file, value, exclusive = false) {
  const target = exclusive ? file : `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(target, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)+'\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  if (!exclusive) fs.renameSync(target, file);
}
function contained(root, name, base = root) {
  const target = path.resolve(root, name), baseReal = fs.realpathSync(base);
  const rel = path.relative(baseReal, target);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new Error('Task path escapes its storage');
  let cursor = baseReal;
  for (const part of rel.split(path.sep)) {
    if (/[\x00-\x1f:]/.test(part) || /[ .]$/.test(part)) throw new Error('Invalid task path');
    cursor = path.join(cursor, part);
    if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('Linked task paths are not supported');
  }
  return target;
}
function taskDirectory(root, directory) { return contained(root, directory, path.join(root, 'artifacts')); }

export function prepareAgentTask(root, configuration, registry) {
  root = fs.realpathSync(root);
  const original = prepareVerification(root, configuration, registry);
  // Copy declared dependencies with their relative layout, including include trees.
  // Guidance remains bound to the host; tool path fields alone are rewritten.
  const guidance = new Set(Object.keys(original.plan.guidance?.input_hashes || {}));
  const inputs = Object.keys(original.plan.input_hashes).filter(name => name !== original.plan.spec_path && !guidance.has(name));
  if (inputs.length > 1024) throw new Error('Candidate input inventory exceeds 1024 files');
  let total = 0;
  for (const name of inputs) {
    const file = contained(root, name);
    if (/^(?:src|scripts|knowledge|node_modules|runtime|\.git|\.eda|\.pi-state|\.eda-state)(?:\/|$)/i.test(name)) throw new Error('Candidate inputs must be design files, not host state or implementation');
    if ((total += fs.statSync(file).size) > 64 * 1024 * 1024) throw new Error('Candidate input inventory exceeds 64 MiB');
  }
  fs.mkdirSync(path.join(root, 'artifacts'), {recursive:true});
  const directory = path.join(fs.realpathSync(path.join(root, 'artifacts')), `agent-task-${randomUUID()}`);
  if (path.relative(root, directory).startsWith('..')) throw new Error('Artifacts must belong to the workspace');
  fs.mkdirSync(directory);
  const candidate = path.join(directory, 'candidate'); fs.mkdirSync(candidate);
  const mapping = {};
  for (const name of inputs) {
    const target = path.join(candidate, name); fs.mkdirSync(path.dirname(target), {recursive:true});
    const bytes = fs.readFileSync(contained(root, name));
    if (hash(bytes) !== original.plan.input_hashes[name]) throw new Error(`Input changed while preparing candidate: ${name}`);
    fs.writeFileSync(target, bytes, {flag:'wx'}); mapping[name] = relative(root, target);
  }
  const mapFile = name => {
    if (typeof name !== 'string') return name; // Result references are kept intact.
    const key = relative(root, fs.realpathSync(path.resolve(root, name)));
    if (!mapping[key]) throw new Error(`Uncaptured candidate dependency: ${name}`);
    return mapping[key];
  };
  const spec = structuredClone(original.plan.spec);
  spec.inputs = spec.inputs.map(mapFile);
  for (const step of spec.steps) {
    for (const field of ['sources','constraints']) if (step.args[field]) step.args[field] = step.args[field].map(mapFile);
    if (step.args.checkpoint) step.args.checkpoint = mapFile(step.args.checkpoint);
    if (step.args.include_dirs) step.args.include_dirs = step.args.include_dirs.map(name => {
      const rel = relative(root, contained(root, name)), target = path.join(candidate, rel);
      fs.mkdirSync(target, {recursive:true}); return relative(root, target);
    });
  }
  const specFile = path.join(directory, 'workflow.json'); write(specFile, spec, true);
  const bound = {...configuration, spec:relative(root, specFile), editable_sources:original.editable_sources.map(name => mapping[name]),
    protected_sources:(configuration.protected_sources || []).map(mapFile)};
  const frozen = prepareVerification(root, bound, registry);
  const contract = {schema_version:1, id:path.basename(directory), created_at:new Date().toISOString(),
    original, verification:frozen, mapping, candidate:relative(root,candidate),
    boundary:'A declared dependency snapshot and host drift checks. Not an OS sandbox or proof of complete external IP/library dependencies.'};
  const contractFile = path.join(directory, 'task-contract.json'); write(contractFile, contract, true);
  write(path.join(directory, 'task.json'), {schema_version:1,id:contract.id,contract_sha256:hashFile(contractFile),attempts:[]}, true);
  return {directory:relative(root,directory), candidate:contract.candidate, configuration:bound,
    goal:spec.goal, acceptance:frozen.plan.acceptance, editable_sources:frozen.editable_sources,
    protected_input_count:Object.keys(frozen.protected_inputs).length, status:'prepared', launches_eda:false, model_api_calls:0};
}

export function inspectAgentTask(root, directory, registry) {
  root = fs.realpathSync(root); directory = taskDirectory(root,directory);
  const state = json(contained(root,path.join(directory,'task.json')));
  const file = contained(root,path.join(directory,'task-contract.json'));
  if (hashFile(file) !== state.contract_sha256) throw new Error('Task contract changed');
  const contract = json(file), issues = [];
  const check = (name, expected) => { try { if (hashFile(contained(root,name)) !== expected) issues.push(`Changed input: ${name}`); } catch { issues.push(`Missing or linked input: ${name}`); } };
  for (const [name, expected] of Object.entries(contract.original.plan.input_hashes)) check(name,expected);
  const originals_preserved=issues.length===0;
  for (const [name, expected] of Object.entries(contract.verification.protected_inputs)) check(name,expected);
  for (const [name, expected] of Object.entries(contract.verification.plan.code_hashes)) check(name,expected);
  try {
    const current = prepareVerification(root,contract.verification.configuration,registry);
    for (const field of ['spec','spec_sha256','input_bindings','include_directories','acceptance','guidance','code_hashes']) {
      if (!isDeepStrictEqual(current.plan[field],contract.verification.plan[field])) issues.push(`Changed task plan: ${field}`);
    }
    if (!isDeepStrictEqual(Object.keys(current.plan.input_hashes),Object.keys(contract.verification.plan.input_hashes))) issues.push('Changed input inventory');
  } catch (error) { issues.push(error.message); }
  const lockFile = path.join(directory,'owner.json');
  const owner = fs.existsSync(lockFile) ? json(contained(root,lockFile)) : null;
  const ownerActive = owner ? pidAlive(owner.pid) !== false : false;
  const latest = state.attempts.at(-1);
  let loop = null, task_acceptance = unknown('not_verified'), ready = !latest, reason = latest ? 'attempt_incomplete' : 'prepared';
  if (latest?.closed) {
    try {
      const attempt = taskDirectory(root,latest.directory), loopFile = contained(root,path.join(attempt,'verification-loop.json'));
      if (!latest.loop_sha256 || hashFile(loopFile) !== latest.loop_sha256) throw new Error('Verification checkpoint changed');
      loop = json(loopFile);
      if (!isDeepStrictEqual(loop.limits,{max_rounds:contract.verification.configuration.max_rounds,max_calls:contract.verification.configuration.max_calls})) throw new Error('Verification budget changed');
      const last = loop.rounds.at(-1);
      if (last) {
        const checked = inspectWorkflow(root,taskDirectory(root,last.directory));
        if (!checked.valid) throw new Error('Latest workflow evidence is stale or invalid');
        for (const [name, expected] of Object.entries(last.candidate_hashes)) check(name,expected);
        task_acceptance = checked.task_acceptance;
      }
      const remaining = loop.rounds.length < loop.limits.max_rounds && loop.calls + contract.verification.plan.spec.limits.max_calls <= loop.limits.max_calls;
      ready = loop.phase === 'boundary' && loop.status === 'cancelled' && remaining;
      reason = ready ? 'verified_boundary_available' : loop.status === 'passed' ? 'accepted' : loop.status === 'cancelled' ? 'no_safe_boundary_or_budget' : loop.status;
      if (loop.status !== 'passed' && task_acceptance.status === 'passed') task_acceptance = unknown('loop_not_accepted');
      if (loop.status === 'passed' && task_acceptance.status !== 'passed') issues.push('Recorded pass no longer accepted');
    } catch (error) { issues.push(error.message); }
  }
  if (ownerActive) { ready=false; reason='owner_active'; }
  if (issues.length) { ready=false; reason='task_integrity_failed'; task_acceptance=unknown(reason); }
  return {schema_version:1,directory:relative(root,directory),id:contract.id,goal:contract.original.plan.spec.goal,
    candidate:contract.candidate,editable_sources:contract.verification.editable_sources,
    status:ownerActive?'running':issues.length?'invalid':loop?.status || (latest?'interrupted':'prepared'),
    valid:issues.length===0,issues,originals_preserved,task_acceptance,recovery:{ready,reason,owner_active:ownerActive},
    budget:{...contract.verification.configuration,used_rounds:loop?.rounds.length || 0,used_calls:loop?.calls || 0},
    state,contract,loop};
}

export function claimAgentTask(root,directory,registry,attemptDirectory,{resume=false}={}) {
  const checked = inspectAgentTask(root,directory,registry);
  if (!checked.valid || !checked.recovery.ready || Boolean(checked.state.attempts.length) !== resume) throw new Error(`Task cannot ${resume?'resume':'start'}: ${checked.recovery.reason}`);
  directory = taskDirectory(root,directory); attemptDirectory = taskDirectory(root,attemptDirectory);
  const lockFile = path.join(directory,'owner.json');
  if (fs.existsSync(lockFile)) {
    const old = json(contained(root,lockFile));
    if (pidAlive(old.pid) !== false) throw new Error('Task owner is still active or unknown');
    fs.renameSync(lockFile,path.join(directory,`interrupted-owner-${randomUUID()}.json`));
  }
  const token = randomUUID(); write(lockFile,{token,pid:process.pid,directory:relative(root,attemptDirectory)},true);
  const attempt = {directory:relative(root,attemptDirectory),started_at:new Date().toISOString(),closed:false};
  checked.state.attempts.push(attempt); write(path.join(directory,'task.json'),checked.state);
  return {configuration:checked.contract.verification.configuration,continuation:checked.loop,
    assertCurrent:() => {
      const current=inspectAgentTask(root,directory,registry);
      if (!current.valid) throw new Error(current.issues.join('; '));
    },
    finish:() => {
      if (json(lockFile).token !== token) throw new Error('Task ownership changed');
      const loopFile=path.join(attemptDirectory,'verification-loop.json');
      if (fs.existsSync(loopFile)) attempt.loop_sha256=hashFile(loopFile);
      attempt.closed=true; attempt.finished_at=new Date().toISOString();
      write(path.join(directory,'task.json'),checked.state); fs.unlinkSync(lockFile);
    }};
}

export function taskDelivery(root,directory,registry) {
  const task=inspectAgentTask(root,directory,registry);
  return {schema_version:1,task:task.directory,goal:task.goal,status:task.status,task_acceptance:task.task_acceptance,
    candidate:task.candidate,editable_sources:task.editable_sources,
    evidence:task.loop?.last_directory || null,rounds:task.loop?.rounds.length || 0,calls:task.loop?.calls || 0,
    recovery:task.recovery,issues:task.issues,originals_preserved:task.originals_preserved,
    budget:{max_rounds:task.budget.max_rounds,max_calls:task.budget.max_calls},
    formal:'not_evaluated',hardware:'not_evaluated',checked_at:new Date().toISOString()};
}

export function activeTaskContext(root,directory,registry) {
  const task=inspectAgentTask(root,directory,registry);
  const attempt=task.state.attempts.at(-1);
  let loop=task.loop;
  if(attempt&&!attempt.closed) {
    const file=path.join(taskDirectory(root,attempt.directory),'verification-loop.json');
    if(fs.existsSync(file))loop=json(contained(root,file));
  }
  const scope=task.contract.verification;
  const editable=Buffer.byteLength(JSON.stringify(scope.editable_sources))<=5000?scope.editable_sources:null;
  return {schema_version:1,directory:task.directory,goal:task.goal.slice(0,800),phase:loop?.phase||'planning',
    contract:{file:`${task.directory}/task-contract.json`,sha256:task.state.contract_sha256},
    editable_sources:editable,editable_sources_omitted:editable===null,protected_input_count:Object.keys(scope.protected_inputs).length,
    acceptance:{profile:scope.plan.acceptance.profile,required:scope.plan.acceptance.required,design:scope.plan.acceptance.design||null},
    budget:{max_rounds:scope.configuration.max_rounds,max_calls:scope.configuration.max_calls,
      used_rounds:loop?.rounds?.length||0,used_calls:loop?.calls||0,reserved_calls:loop?.reserved_calls||0},
    guidance:loop?.guidance?{phase:loop.guidance.phase,sop_ids:loop.guidance.sop_ids,rule_ids:loop.guidance.rule_ids}:null,
    task_acceptance:task.task_acceptance.status,scope_valid:task.valid,
    rule:'Only the host verifier can accept the current candidate. Edits invalidate prior passing evidence until reverified. Read the full contract when the editable list is omitted. Shell and model-initiated EDA dispatch are blocked in this task.'};
}

// Pi dispatch guard, including calls nested through codemode. The host verifier
// executes the frozen registry directly and does not spend unmetered model calls.
export function guardTaskTool(root,configuration,event) {
  const block=reason=>({block:true,reason});
  const readTools=new Set(['eda_preflight','eda_runs','eda_knowledge','eda_sop','eda_task_context','eda_task_inspect','eda_results_list','eda_results_get','eda_results_verify','eda_results_compare','tool_search','codemode']);
  if (readTools.has(event.toolName)) return;
  if (!configuration) return block('The host has not admitted a candidate scope yet.');
  if (['read','write','edit','grep','find','ls'].includes(event.toolName)) {
    try {
      const file=contained(root,event.input?.path || '.');
      const name=relative(root,file);
      if (/(?:^|\/)(?:\.git|\.eda-state|\.pi-state|auth\.json|credentials[^/]*|\.env(?:\.[^/]*)?)(?:\/|$)/i.test(name)) return block('Private host state is outside the task scope.');
      if (['write','edit'].includes(event.toolName)) {
        const allowed=configuration.editable_sources.map(name=>fs.realpathSync(path.resolve(root,name)));
        if (!allowed.includes(file)) return block('Only the fixed candidate RTL files are editable.');
      }
      return;
    } catch { return block('The requested path is outside the admitted task or is linked.'); }
  }
  return block('This verified task reserves EDA execution to the host verifier. Use read/edit/write on candidate RTL and the knowledge tools; return control to run the fixed checks.');
}

export function createAgentTaskTools(root,registry) {
  const traced=(tool,action)=>({...tool,async execute(id,args,signal,_update,ctx){
    const trace=createTrace({root,tool:tool.name,args,toolCallId:id,context:ctx?.edaTraceContext});
    try {
      signal?.throwIfAborted();
      for(const name of ['src/agent-task.mjs','src/verifier-loop.mjs','src/workflow.mjs'])trace.capture(path.join(root,name),'task_implementation');
      const result=action(args);
      const directory=taskDirectory(root,result.directory||result.task);
      trace.capture(path.join(directory,'task-contract.json'),'task_contract');trace.finalizeDependencies();
      fs.writeFileSync(path.join(trace.directory,'result.json'),JSON.stringify(result,null,2));trace.finish('completed');
      const details={...result,evidence_trace:trace.directory};return {content:[{type:'text',text:JSON.stringify(details)}],details};
    }catch(error){throw Object.assign(error,{receipt:trace.finish(signal?.aborted?'cancelled':'failed',error)});}
  }});
  return [
    traced({name:'eda_task_prepare',label:'Prepare EDA agent task',description:'Freeze an existing independent verification contract and copy declared inputs into an isolated runnable RTL candidate. Static; no model or EDA dispatch. Returns a task directory for the host session.',
      parameters:{type:'object',additionalProperties:false,required:['configuration'],properties:{configuration:verificationSchema}}},args=>prepareAgentTask(root,args.configuration,registry)),
    traced({name:'eda_task_inspect',label:'Inspect EDA agent task',description:'Recheck candidate, immutable inputs, latest independent verdict, owner and cumulative retry budget. Does not execute EDA or resume a model.',
      parameters:{type:'object',additionalProperties:false,required:['directory'],properties:{directory:{type:'string',minLength:1,maxLength:2048}}}},args=>taskDelivery(root,args.directory,registry)),
  ];
}
