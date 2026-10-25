// Exercise the real orchestration function with a local fake SDK; no provider is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAgentSession, publicAgentEvent } from '../src/agent-session.mjs';
import {createTrace} from '../src/trace.mjs';

const fixtureConfig = enabled => JSON.stringify({schema_version:1,model_api_enabled:enabled,resources:{xsim:2,vivado:1,ltspice:1,verify:4},queue_timeout_ms:1000});

async function exercise(failAt) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eda-agent-record-'));
  fs.mkdirSync(path.join(root, '.eda'));
  fs.writeFileSync(path.join(root, '.eda/config.json'), fixtureConfig(true));
  fs.mkdirSync(path.join(root, '.pi'));
  fs.writeFileSync(path.join(root, '.pi/APPEND_SYSTEM.md'), 'Offline fixture');
  let listener;
  const publicEvents = [];
  let factoryCalls = 0;
  const session = {
    model: { provider: 'offline-fixture', id: 'no-model' }, thinkingLevel: 'off',
    getSessionStats: () => ({ sessionId: 'fixture-session', tokens: { total: 0 } }),
    subscribe: fn => { listener = fn; return () => {}; },
    abort() {}, dispose() {}, bindExtensions: async () => {},
    prompt: async () => {
      listener({ type: 'turn_start' });
      listener({ type: 'tool_execution_start', toolName: 'fixture', toolCallId: 'call-1' });
      if (failAt === 'prompt') throw new Error('fixture prompt failure');
      if (failAt === 'retry-recovered') {
        listener({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: '429 retryable failure' } });
        listener({ type: 'auto_retry_start', attempt: 1 });
        listener({ type: 'auto_retry_end', success: true, attempt: 1 });
      }
      if (failAt === 'compaction') {
        listener({ type: 'compaction_start', reason: 'threshold' });
        listener({ type: 'compaction_end', reason: 'threshold', aborted: false, willRetry: false,
          result: { summary: 'private compacted context', details: { thinking: 'private' }, tokensBefore: 12000 } });
      }
      listener({ type: 'message_end', message: { role: 'assistant', content: [{type:'text',text:'Offline fixture response'}], stopReason: failAt === 'aborted' ? 'aborted' : 'stop' } });
    },
    getLastAssistantText: () => 'Offline fixture response',
    extensionRunner: { emit: async () => { if (failAt === 'shutdown') throw new Error('fixture shutdown failure'); } },
  };
  try {
    const result = await runAgentSession({ root, prompt:'Offline prompt', limits:{maxTurns:2,timeoutSeconds:5},
      onEvent: event => publicEvents.push(event),
      sessionFactory: async () => {
        factoryCalls++;
        if (failAt === 'initialize') throw new Error('fixture initialization failure');
        return {session,extensionsResult:{errors:[]},resources:{skills:[]}};
      },
    });
    const dir = result.directory;
    return {
      run: JSON.parse(fs.readFileSync(path.join(dir, 'run.json'))),
      usage: JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'))),
      events: fs.existsSync(path.join(dir, 'events.jsonl')) ? fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [],
      exitCode: result.status === 'completed' ? 0 : 1, publicEvents, factoryCalls, answer: result.answer,
    };
  } finally {
    // Only this uniquely created temporary fixture tree is removed.
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('records completed session, ordered timestamps and scoped usage', async () => {
  const result = await exercise();
  assert.equal(result.run.status, 'completed');
  assert.equal(result.run.sessionId, 'fixture-session');
  assert.equal(result.answer, 'Offline fixture response');
  assert.equal(result.usage.scope, 'pi-sdk-agent-only');
  assert.equal(result.events.at(-1).type, 'run_end');
  let ready=false;
  result.events.forEach((event, i) => {
    if(event.type==='session_ready')ready=true;
    assert.equal(event.sequence, i + 1);
    assert.ok(Number.isFinite(Date.parse(event.timestamp_utc)));
    assert.equal(event.session_id, ready?'fixture-session':undefined);
  });
});

test('initialization failure persists status with unknown usage', async () => {
  const result = await exercise('initialize');
  assert.equal(result.run.status, 'initialization_failed');
  assert.equal(result.usage.stats, null);
  assert.equal(result.exitCode, 1);
});

test('prompt and shutdown errors retain evidence and nonzero status', async () => {
  const prompt = await exercise('prompt');
  assert.equal(prompt.run.status, 'failed');
  assert.match(prompt.run.error, /fixture prompt failure/);
  assert.equal(prompt.exitCode, 1);
  const shutdown = await exercise('shutdown');
  assert.equal(shutdown.run.status, 'shutdown_failed');
  assert.match(shutdown.run.shutdownError, /fixture shutdown failure/);
  assert.equal(shutdown.events.at(-1).type, 'run_end');
  assert.equal(shutdown.events.at(-1).status, 'shutdown_failed');
  assert.equal(shutdown.events.filter(event => event.type === 'run_end').length, 1);
  assert.equal(shutdown.usage.status, 'shutdown_failed');
  assert.match(shutdown.usage.error, /fixture shutdown failure/);
  assert.equal(shutdown.exitCode, 1);
});

test('SDK aborted response cannot become a completed session', async () => {
  const result = await exercise('aborted');
  assert.equal(result.run.status, 'stopped');
  assert.equal(result.run.stoppedReason, 'model-aborted');
  assert.equal(result.events.at(-1).status, 'stopped');
  assert.equal(result.exitCode, 1);
});

test('recovered SDK retry retains error history and records final success', async () => {
  const result = await exercise('retry-recovered');
  assert.equal(result.run.status, 'completed');
  assert.equal(result.usage.error, null);
  assert.equal(result.exitCode, 0);
  assert.ok(result.events.some(event => event.message?.errorMessage === '429 retryable failure'));
  assert.ok(result.events.some(event => event.type === 'auto_retry_end' && event.success));
});

test('real Pi compaction events are recorded while public events omit the summary', async () => {
  const result = await exercise('compaction');
  const raw = result.events.find(event => event.type === 'compaction_end');
  assert.equal(raw.result.summary, 'private compacted context');
  const publicEvents = result.publicEvents.filter(event => event.type.startsWith('compaction_'));
  assert.deepEqual(publicEvents.map(event => event.type), ['compaction_start', 'compaction_end']);
  assert.equal(publicEvents[1].reason, 'threshold');
  assert.equal(publicEvents[1].aborted, false);
  assert.equal(publicEvents[1].willRetry, false);
  assert.equal(publicEvents[1].result, undefined);
  assert.equal(JSON.stringify(publicEvents).includes('private'), false);
});

test('disabled model gate does not initialize SDK or create a run', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eda-disabled-agent-'));
  try {
    fs.mkdirSync(path.join(root, '.eda'));
    fs.writeFileSync(path.join(root, '.eda/config.json'), fixtureConfig(false));
    let called = false;
    await assert.rejects(runAgentSession({root,prompt:'no model',sessionFactory:async()=>{called=true;}}), /disabled/);
    assert.equal(called, false);
    assert.equal(fs.existsSync(path.join(root, 'artifacts')), false);
  } finally { fs.rmSync(root, {recursive:true,force:true}); }
});

test('public events expose text and tool identity but omit thinking and arguments', () => {
  assert.equal(publicAgentEvent({type:'message_update',assistantMessageEvent:{type:'thinking_delta',delta:'private'}}),null);
  assert.deepEqual(publicAgentEvent({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'public'}}),{type:'text_delta',text:'public'});
  const message=publicAgentEvent({type:'message_end',message:{role:'assistant',stopReason:'stop',content:[{type:'thinking',thinking:'private'},{type:'text',text:'public'}]}});
  assert.equal(message.text,'public');
  const tool=publicAgentEvent({type:'tool_execution_start',toolName:'fixture',args:{secret:'private'},toolCallId:'1'});
  assert.equal(tool.args,undefined);
  assert.equal(tool.toolName,'fixture');
});

test('cancel before initialization remains stopped and never calls the SDK', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eda-cancel-agent-'));
  try {
    fs.mkdirSync(path.join(root, '.eda'));
    fs.writeFileSync(path.join(root, '.eda/config.json'), fixtureConfig(true));
    const controller = new AbortController(); controller.abort();
    let calls=0;
    const result=await runAgentSession({root,prompt:'fixture',signal:controller.signal,sessionFactory:async()=>{calls++;}});
    assert.equal(calls,0); assert.equal(result.status,'stopped'); assert.equal(result.run.stoppedReason,'user-interrupt');
    assert.equal(result.usage.stats,null);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('resume rejects files outside the owned Pi session directory before SDK loading', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'eda-resume-agent-'));
  try {
    fs.mkdirSync(path.join(root,'.eda')); fs.mkdirSync(path.join(root,'.eda-state/pi-sessions'),{recursive:true});
    fs.writeFileSync(path.join(root,'.eda/config.json'),fixtureConfig(true));
    const outside=path.join(root,'outside.jsonl');fs.writeFileSync(outside,JSON.stringify({type:'session',cwd:root})+'\n');
    let calls=0;
    await assert.rejects(runAgentSession({root,prompt:'fixture',resumeSessionFile:outside,sessionFactory:async()=>{calls++;}}),/must belong/);
    assert.equal(calls,0);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('owned continuation snapshots prior context and carries session identity through the next run', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'eda-continue-agent-'));
  try {
    fs.mkdirSync(path.join(root,'.eda')); fs.mkdirSync(path.join(root,'.eda-state/pi-sessions'),{recursive:true});
    fs.writeFileSync(path.join(root,'.eda/config.json'),fixtureConfig(true));
    const sessionFile=path.join(root,'.eda-state/pi-sessions/session.jsonl');
    const prior=JSON.stringify({type:'session',cwd:root,id:'existing'})+'\n';fs.writeFileSync(sessionFile,prior);
    const result=await runAgentSession({root,prompt:'continue',resumeSessionFile:sessionFile,sessionFactory:async options=>{
      assert.equal(options.resumeSessionFile,fs.realpathSync(sessionFile));
      return {session:{sessionFile,getSessionStats:()=>({sessionId:'existing'}),subscribe:()=>()=>{},bindExtensions:async()=>{},prompt:async()=>{},getLastAssistantText:()=>'',dispose(){}}};
    }});
    assert.equal(result.sessionId,'existing'); assert.equal(result.sessionFile,sessionFile); assert.equal(result.run.resumed,true);
    assert.equal(fs.readFileSync(path.join(result.directory,'session-before.jsonl'),'utf8'),prior);
    assert.ok(result.run.sessionBefore.sha256);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('cancellation during initialization prevents the first model request', async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'eda-initialize-cancel-'));
  try {
    fs.mkdirSync(path.join(root,'.eda'));fs.writeFileSync(path.join(root,'.eda/config.json'),fixtureConfig(true));
    const controller=new AbortController(); let prompts=0,disposed=false;
    const result=await runAgentSession({root,prompt:'fixture',signal:controller.signal,sessionFactory:async()=>{
      controller.abort();
      return {session:{getSessionStats:()=>({sessionId:'fixture'}),subscribe:()=>()=>{},bindExtensions:async()=>{},prompt:async()=>{prompts++;},getLastAssistantText:()=> 'Previous turn must not become the new answer',dispose(){disposed=true;}}};
    }});
    assert.equal(result.status,'stopped'); assert.equal(prompts,0); assert.equal(disposed,true);
    assert.equal(result.answer,'');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

function recordingFixture(t) {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'eda-recording-contract-'));
  fs.mkdirSync(path.join(root, '.eda'));
  fs.writeFileSync(path.join(root, '.eda/config.json'), fixtureConfig(true));
  t.after(() => {
    assert.equal(path.dirname(fs.realpathSync(root)), parent);
    assert.ok(path.basename(root).startsWith('eda-recording-contract-'));
    fs.rmSync(root, {recursive: true, force: true});
  });
  return root;
}
const fakeSession = overrides => ({getSessionStats: () => ({sessionId: 'task-session'}), subscribe: () => () => {},
  bindExtensions: async () => {}, prompt: async () => {}, dispose() {}, ...overrides});

test('resumed usage records a frozen run delta separately from cumulative session totals', async t => {
  const root = recordingFixture(t), sessionDir = path.join(root, '.eda-state/pi-sessions');
  fs.mkdirSync(sessionDir, {recursive: true});
  const sessionFile = path.join(sessionDir, 'prior.jsonl');
  fs.writeFileSync(sessionFile, JSON.stringify({type: 'session', cwd: root, id: 'continued'}) + '\n');
  const totals = {sessionId: 'continued', userMessages: 3, assistantMessages: 8, toolCalls: 6, toolResults: 6, totalMessages: 17,
    tokens: {input: 100, output: 30, cacheRead: 50, total: 180}, cost: 2};
  const result = await runAgentSession({root, prompt: 'Continue', resumeSessionFile: sessionFile, sessionFactory: async () => ({
    session: fakeSession({sessionFile, getSessionStats: () => totals, prompt: async () => {
      totals.userMessages++; totals.assistantMessages++; totals.totalMessages += 2;
      totals.tokens.input += 20; totals.tokens.output += 5; totals.tokens.total += 25;
      totals.tokens.cacheWrite = 7; totals.cost += 0.5;
    }}),
  })});
  assert.equal(result.usage.stats_scope, 'session_cumulative');
  assert.deepEqual(result.usage.stats, result.usage.session_total);
  assert.equal(result.usage.session_total.tokens.total, 205);
  assert.equal(result.usage.run_delta.tokens.total, 25);
  assert.equal(result.usage.run_delta.cost, 0.5);
  assert.equal(result.usage.run_delta.userMessages, 1);
  assert.equal(result.usage.run_delta.toolCalls, 0);
  assert.equal(result.usage.run_delta.tokens.cacheWrite, null, 'missing baseline receipt must stay unknown');
  const receipt = JSON.parse(fs.readFileSync(path.join(result.directory, 'usage.json')));
  assert.deepEqual(receipt.run_delta, result.usage.run_delta);
});

test('an unavailable initial usage receipt does not turn all prior usage into this run usage', async t => {
  const root = recordingFixture(t); let sampled = 0;
  const result = await runAgentSession({root, prompt: 'Continue', sessionFactory: async () => ({session: fakeSession({
    sessionId: 'task-session', getSessionStats: () => { if (++sampled === 1) throw new Error('receipt unavailable'); return {sessionId: 'task-session', tokens: {total: 900}}; },
  })})});
  assert.equal(result.status, 'completed');
  assert.equal(result.usage.session_total.tokens.total, 900);
  assert.equal(result.usage.run_delta, null);
});

test('task state snapshots are refreshed after prompt failure and stale success cannot survive', async t => {
  const root = recordingFixture(t), publicEvents = [];
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/eda-coordinator.mjs'), '// frozen coordinator fixture\n');
  const state = {schema_version: 1, binding: {directory: 'artifacts/fixed-workflow', run_id: 'fixed-workflow'}, execution_status: 'completed',
    task_acceptance: {status: 'passed', domains: [{domain: 'functional', status: 'passed', observed: {private_receipt: true}}]},
    decision: {action: 'deliver_evidence', reason: 'private diagnostic', phase: 'verification'},
    reflection: {details: 'private reflection'}, context: {goal: 'fixed goal', private_packet: 'fixed RTL and XDC hashes'}, evidence_status: 'valid'};
  let refreshed = 0;
  const result = await runAgentSession({root, prompt: 'This is all verified', taskDirectory: 'artifacts/fixed-workflow', onEvent: event => publicEvents.push(event),
    sessionFactory: async options => {
      assert.equal(options.taskDirectory, 'artifacts/fixed-workflow');
      return {session: fakeSession({prompt: async () => {
        options.onTaskState(state);
        state.context.goal = 'mutated after callback';
        throw new Error('model stopped after evidence changed');
      }}), refreshTaskState: async () => {
        refreshed++;
        const refreshedState = {...state, task_acceptance: {status: 'unknown', reason: 'evidence_changed', domains: [{domain: 'functional', status: 'unknown'}]},
          evidence_status: 'invalid', decision: {action: 'inspect_evidence', phase: 'verification'}};
        options.onTaskState(refreshedState); return refreshedState;
      }};
    }});
  assert.equal(refreshed, 1);
  assert.equal(result.status, 'failed');
  assert.equal(result.run.task_acceptance.status, 'unknown');
  const events = fs.readFileSync(path.join(result.directory, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const states = events.filter(event => event.type === 'eda_task_state');
  assert.equal(states.length, 2, 'callback plus identical refresh return must not double-record');
  assert.equal(states[0].state.context.goal, 'fixed goal');
  assert.equal(states[1].state.task_acceptance.reason, 'evidence_changed');
  const visible = publicEvents.filter(event => event.type === 'eda_task_state');
  assert.equal(JSON.stringify(visible).includes('private'), false);
  assert.equal(visible[0].task_acceptance.domains[0].observed, undefined);
  assert.equal(visible[1].task_acceptance.status, 'unknown');
  const input = result.run.inputs.find(input => input.path === 'src/eda-coordinator.mjs');
  assert.ok(input.sha256);
  assert.equal(fs.readFileSync(path.join(result.directory, input.snapshot), 'utf8'), '// frozen coordinator fixture\n');
});

test('unbound answers and failed final evidence reads cannot promote engineering acceptance', async t => {
  const root = recordingFixture(t);
  const unbound = await runAgentSession({root, prompt: 'Everything passed', sessionFactory: async () => ({session: fakeSession(), refreshTaskState: () => null})});
  assert.equal(unbound.status, 'completed');
  assert.deepEqual(unbound.run.task_acceptance, {status: 'unknown', reason: 'workflow_unbound', domains: []});
  const unreadable = await runAgentSession({root, prompt: 'Verified', sessionFactory: async options => ({
    session: fakeSession({prompt: async () => options.onTaskState({task_acceptance: {status: 'passed', domains: []}, decision: {action: 'deliver_evidence'}})}),
    refreshTaskState: () => { throw new Error('evidence unavailable'); },
  })});
  assert.equal(unreadable.run.task_acceptance.status, 'unknown');
  assert.equal(unreadable.run.task_acceptance.reason, 'task_revalidation_failed');
  assert.equal(unreadable.run.task_state.decision.action, 'inspect_evidence');
  assert.match(unreadable.run.task_state_error, /evidence unavailable/);
});

function verificationFixture(t, {unbound = false} = {}) {
  const root = recordingFixture(t), project = path.resolve(import.meta.dirname, '..');
  for (const directory of ['knowledge', '.pi/skills']) fs.cpSync(path.join(project, directory), path.join(root, directory), {recursive: true});
  for (const file of ['src/workflow.mjs', 'src/knowledge.mjs', 'src/trace.mjs', 'src/verifier-loop.mjs', 'scripts/check-knowledge.mjs',
    'scripts/eda-tool.mjs', 'scripts/replay-experiment.mjs', 'scripts/collect-system-evidence.py', 'projects/system-bench/run.py',
    'projects/system-bench/implement-common.tcl', 'docs/workflows.md', 'docs/reference/tools.md', 'docs/results.md']) {
    fs.mkdirSync(path.dirname(path.join(root, file)), {recursive: true});
    fs.copyFileSync(path.join(project, file), path.join(root, file));
  }
  fs.writeFileSync(path.join(root, 'rtl.sv'), 'module dut; // BROKEN\nendmodule\n');
  fs.writeFileSync(path.join(root, 'tb.sv'), 'module tb; // immutable checker\nendmodule\n');
  const spec = {schema_version: 1, id: 'recorded-verifier', goal: 'Repair RTL against the fixed checker', inputs: ['rtl.sv', 'tb.sv'],
    limits: {max_calls: 1, wall_seconds: 10},
    steps: [{id: 'simulation', tool: 'eda_xsim', args: {sources: ['rtl.sv', 'tb.sv'], top: 'tb', pass_marker: 'FIXED_PASS'},
      checks: [{pointer: '/simulation_acceptance/status', op: 'eq', value: 'pass'}]}],
    ...(unbound ? {} : {acceptance: {profile: 'rtl_simulation', bindings: {functional: 'simulation'}}})};
  fs.writeFileSync(path.join(root, 'task.json'), JSON.stringify(spec));
  const registry = new Map(), calls = [];
  const sops = JSON.parse(fs.readFileSync(path.join(root, 'knowledge/sops.json'))).sops;
  for (const name of new Set(sops.flatMap(sop => sop.required_tools))) registry.set(name, {name, parameters: {type: 'object', additionalProperties: true},
    execute() { throw new Error(`Unexpected tool dispatch: ${name}`); }});
  registry.set('eda_xsim', {name: 'eda_xsim', parameters: {type: 'object', additionalProperties: true},
    async execute(id, args, signal, _update, context) {
      signal?.throwIfAborted();
      const trace = createTrace({root, tool: 'eda_xsim', args, toolCallId: id, context: context.edaTraceContext});
      for (const file of ['rtl.sv', 'tb.sv']) trace.capture(path.join(root, file), 'fixed_verifier_input');
      trace.finalizeDependencies(); calls.push(trace.directory);
      const passed = fs.readFileSync(path.join(root, 'rtl.sv'), 'utf8').includes('CANDIDATE_OK');
      return {details: trace.finish('completed', null, {simulation_acceptance: {status: passed ? 'pass' : 'fail',
        pass_marker: 'FIXED_PASS', marker_matches: passed ? 1 : 0, completion_observed: true, failure_diagnostic: !passed}})};
    }});
  return {root, registry, calls, verification: {spec: 'task.json', editable_sources: ['rtl.sv'], max_rounds: 1, max_calls: 1}};
}

test('session verifier uses the fixed workflow and meters the whole owned run once', async t => {
  const f = verificationFixture(t), bound = [], publicEvents = [];
  let listener, prompts = 0, statsReads = 0;
  const totals = {sessionId: 'verified-session', tokens: {input: 80, output: 20, total: 100}, cost: 2};
  const result = await runAgentSession({...f, prompt: 'Repair the RTL', onEvent: event => publicEvents.push(event), sessionFactory: async options => ({
    registry: f.registry,
    bindTaskDirectory: directory => {
      bound.push(directory);
      options.onTaskState({binding: {directory}, context: {goal: 'Recovered fixed checker context'}, task_acceptance: {status: 'unknown', domains: []}});
    },
    refreshTaskState: () => null,
    session: fakeSession({getSessionStats: () => { statsReads++; return totals; }, subscribe: callback => {listener = callback; return () => {};},
      prompt: async text => {
        prompts++; assert.match(text, /Host verification contract/);
        listener({type: 'turn_start'});
        fs.writeFileSync(path.join(f.root, 'rtl.sv'), 'module dut; // CANDIDATE_OK\nendmodule\n');
        totals.tokens.input += 6; totals.tokens.output += 4; totals.tokens.total += 10; totals.cost += 0.25;
        listener({type: 'message_end', message: {role: 'assistant', content: [{type: 'text', text: 'Candidate prepared'}], stopReason: 'stop'}});
      }}),
  })});
  assert.equal(result.status, 'completed'); assert.equal(result.run.verification.status, 'passed');
  assert.equal(result.run.task_acceptance.status, 'passed');
  assert.equal(prompts, 1); assert.equal(f.calls.length, 1); assert.equal(statsReads, 2);
  assert.equal(result.usage.session_total.tokens.total, 110); assert.equal(result.usage.run_delta.tokens.total, 10);
  assert.equal(result.usage.run_delta.cost, 0.25);
  assert.equal(result.run.verification.calls, 1);
  assert.equal(result.run.verification.final_recheck.valid, true);
  assert.equal(result.run.task_state.binding.directory, result.run.verification.last_directory);
  assert.equal(result.run.task_state.context.goal, 'Recovered fixed checker context');
  assert.equal(bound.at(-1), result.run.verification.last_directory);
  assert.ok(result.run.inputs.some(input => input.path === 'src/verifier-loop.mjs'));
  const workflow = JSON.parse(fs.readFileSync(path.join(result.run.verification.last_directory, 'run.json')));
  assert.equal(workflow.trace_id, result.run.trace_id); assert.equal(workflow.parent_span_id, result.run.span_id);
  assert.equal(publicEvents.filter(event => event.type === 'eda_task_state').at(-1).task_acceptance.status, 'passed');
  assert.ok(publicEvents.filter(event => event.type === 'eda_task_state' && event.task_acceptance.status === 'passed')
    .every(event => event.execution_status === 'passed'));
});

test('completed model text and stale coordinator success cannot upgrade a failing verifier', async t => {
  const f = verificationFixture(t), publicEvents = [];
  let listener;
  const result = await runAgentSession({...f, prompt: 'All tests passed', onEvent: event => publicEvents.push(event), sessionFactory: async options => ({
    registry: f.registry,
    refreshTaskState: () => ({binding: {directory: 'artifacts/old-task'}, task_acceptance: {status: 'passed', domains: []}}),
    session: fakeSession({subscribe: callback => {listener = callback; return () => {};}, prompt: async () => {
      options.onTaskState({binding: {directory: 'artifacts/old-task'}, task_acceptance: {status: 'passed', domains: []}});
      listener({type: 'turn_start'});
      listener({type: 'message_end', message: {role: 'assistant', content: [{type: 'text', text: 'Everything passed.'}], stopReason: 'stop'}});
    }}),
  })});
  assert.equal(result.status, 'completed'); assert.equal(result.answer, 'Everything passed.');
  assert.equal(result.run.verification.status, 'budget_exhausted'); assert.equal(result.run.task_acceptance.status, 'failed');
  assert.equal(result.run.task_state.binding.directory, result.run.verification.last_directory);
  assert.equal(f.calls.length, 1);
  assert.ok(publicEvents.filter(event => event.type === 'eda_task_state').every(event => event.task_acceptance.status !== 'passed'));
});

test('a verifier without an acceptance contract fails before generating or dispatching tools', async t => {
  const f = verificationFixture(t, {unbound: true}); let prompts = 0;
  const result = await runAgentSession({...f, prompt: 'Please verify', sessionFactory: async () => ({registry: f.registry,
    session: fakeSession({prompt: async () => {prompts++;}})})});
  assert.equal(result.status, 'failed'); assert.match(result.run.error, /requires a bound acceptance profile/);
  assert.equal(result.run.task_acceptance.status, 'unknown'); assert.equal(prompts, 0); assert.equal(f.calls.length, 0);
});

test('final independent evidence read rejects RTL drift after a passing loop', async t => {
  const f = verificationFixture(t); let lastDirectory;
  const result = await runAgentSession({...f, prompt: 'Repair RTL', sessionFactory: async () => ({
    registry: f.registry, bindTaskDirectory: directory => {lastDirectory = directory;},
    session: fakeSession({prompt: async () => fs.writeFileSync(path.join(f.root, 'rtl.sv'), 'module dut; // CANDIDATE_OK\nendmodule\n')}),
    refreshTaskState: () => {
      assert.ok(lastDirectory, 'the loop already produced bound evidence');
      fs.appendFileSync(path.join(f.root, 'rtl.sv'), '// changed after verification\n');
      return {binding: {directory: lastDirectory}, evidence_status: 'unknown', task_acceptance: {status: 'unknown', domains: []}};
    },
  })});
  assert.equal(result.status, 'completed');
  assert.equal(result.run.verification.rounds[0].task_acceptance.status, 'passed', 'retain the historical passing round');
  assert.equal(result.run.verification.status, 'passed', 'the original loop receipt remains historical evidence');
  assert.equal(result.run.verification.final_recheck.status, 'invalid');
  assert.equal(result.run.verification.final_recheck.reason, 'final_evidence_recheck_failed');
  assert.equal(result.run.task_acceptance.status, 'unknown');
  assert.equal(result.run.verification.final_recheck.valid, false);
  assert.ok(result.run.verification.final_recheck.issues.includes('input_changed:rtl.sv'));
  const stored = JSON.parse(fs.readFileSync(path.join(result.directory, 'run.json')));
  assert.equal(stored.verification.final_recheck.status, 'invalid'); assert.equal(stored.task_acceptance.status, 'unknown');
});
