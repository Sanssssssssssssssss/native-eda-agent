// Exercise the real orchestration function with a local fake SDK; no provider is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAgentSession, publicAgentEvent } from '../src/agent-session.mjs';

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
