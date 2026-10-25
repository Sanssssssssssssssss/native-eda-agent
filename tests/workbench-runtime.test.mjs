import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {createWorkbench} from '../src/workbench.mjs';
import {createWorkbenchState} from '../src/workbench-state.mjs';

async function fixture(t, execute = async () => ({details: {status: 'completed'}}), options = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'eda-workbench-runtime-'));
  fs.mkdirSync(path.join(root, 'examples/workflows'), {recursive: true});
  fs.writeFileSync(path.join(root, 'examples/workflows/offline-review.json'), '{}');
  let version = 'one';
  const registry = new Map([
    ['eda_workflow_plan', {execute: async () => ({details: {spec: {goal: 'Frozen test goal', steps: []}, input_hashes: {rtl: version}, model_api_calls: 0, evidence: `preview-${Math.random()}`}})}],
    ['eda_workflow_run', {execute}],
    ['eda_task_context', {execute: async () => ({details: {model_api_calls: 0}})}],
  ]);
  const apps = [];
  async function server() {
    const app = createWorkbench(root, registry, options); apps.push(app);
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    return {get: route => fetch(base + route), post: (route, body) => fetch(base + route, {method: 'POST', headers: {Origin: base, 'Content-Type': 'application/json'}, body: JSON.stringify(body)})};
  }
  const api = await server();
  t.after(async () => {
    for (const app of apps) await app.close();
    assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir()));
    fs.rmSync(root, {recursive: true, force: true});
  });
  return {...api, root, registry, server, changeInputs() { version = 'two'; },
    session: async () => (await api.post('/api/session', {action: 'create', title: 'Task workspace'})).json(),
    plan: async id => (await api.post('/api/workflow', {session_id: id, spec: 'offline-review', action: 'plan'})).json(),
    run: async (id, plan) => (await api.post('/api/workflow', {session_id: id, spec: 'offline-review', plan_id: plan.plan_id, action: 'run'})).json(),
  };
}
async function terminal(api, id) {
  for (let i = 0; i < 100; i++) {
    const job = await (await api.get(`/api/job?id=${id}`)).json();
    if (!['queued', 'running', 'cancel_requested'].includes(job.status)) return job;
    await delay(5);
  }
  throw new Error('Job failed to finish');
}
test('session rename and archive preserve messages and archived sessions require explicit restore', async t => {
  const f = await fixture(t), session = await f.session();
  await f.post('/api/session', {id: session.id, message: 'Clock constraints'});
  const renamed = await (await f.post('/api/session', {id: session.id, action: 'rename', title: 'AXI timing'})).json();
  assert.equal(renamed.title, 'AXI timing'); assert.equal(renamed.messages.length, 2);
  await f.post('/api/session', {id: session.id, action: 'archive'});
  assert.equal((await f.post('/api/session', {id: session.id, message: 'Should wait'})).status, 409);
  assert.equal((await f.post('/api/workflow', {session_id: session.id, spec: 'offline-review', action: 'plan'})).status, 409);
  const restored = await (await f.post('/api/session', {id: session.id, action: 'restore'})).json();
  assert.equal(restored.archived, false); assert.equal(restored.messages.length, 2);
});
test('previewed input drift refuses execution before the EDA tool is invoked', async t => {
  let executions = 0;
  const f = await fixture(t, async () => { executions++; return {details: {status: 'completed'}}; }), session = await f.session(), plan = await f.plan(session.id);
  f.changeInputs();
  const response = await f.post('/api/workflow', {session_id: session.id, spec: 'offline-review', action: 'run', plan_id: plan.plan_id});
  assert.equal(response.status, 409); assert.equal(executions, 0);
  assert.match((await response.json()).error, /changed/);
});
test('session leases reject a second server while another server owns its running task', async t => {
  let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, async () => { entered(); await gate; return {details: {status: 'completed'}}; });
  const session = await f.session(), plan = await f.plan(session.id), job = await f.run(session.id, plan); await started;
  const other = await f.server();
  try {
    assert.equal((await other.post('/api/session', {id: session.id, message: 'Cannot overwrite live task'})).status, 409);
    assert.equal((await other.post('/api/cancel', {id: job.id})).status, 409);
    const observed = await (await other.get(`/api/job?id=${job.id}`)).json(); assert.equal(observed.controllable, false); assert.equal(observed.status, 'running');
  } finally { release(); }
  assert.equal((await terminal(f, job.id)).status, 'completed');
});
test('cancel request remains pending until tool acknowledgement and preserves its event sequence', async t => {
  let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, async (_id, _args, signal) => { entered(); await gate; signal.throwIfAborted(); });
  const session = await f.session(), plan = await f.plan(session.id), job = await f.run(session.id, plan); await started;
  try {
    assert.equal((await (await f.post('/api/cancel', {id: job.id, session_id: session.id})).json()).status, 'cancel_requested');
    assert.equal((await (await f.get(`/api/job?id=${job.id}`)).json()).status, 'cancel_requested');
    assert.equal((await f.post('/api/session', {id: session.id, action: 'archive'})).status, 409);
  } finally { release(); }
  const done = await terminal(f, job.id); assert.equal(done.status, 'cancelled'); assert.equal(done.cancel_acknowledged, true); assert.ok(done.cancel_requested_at);
  const events = await (await f.get(`/api/events?session_id=${session.id}`)).json();
  assert.deepEqual(events.events.filter(e => e.type === 'job_status').map(e => e.status), ['queued', 'running', 'cancel_requested', 'cancelled']);
  const replay = await (await f.get(`/api/events?session_id=${session.id}&after=${events.last_sequence - 1}`)).json(); assert.equal(replay.events.length, 1);
  assert.equal((await (await f.get(`/api/session?id=${session.id}`)).json()).tasks[0].status, 'cancelled');
});
test('late cancellation does not replace a completed backend result with a cancelled claim', async t => {
  let release, entered; const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const f = await fixture(t, async () => { entered(); await gate; return {details: {status: 'completed', task_acceptance: {status: 'review_required'}}}; });
  const session = await f.session(), plan = await f.plan(session.id), job = await f.run(session.id, plan); await started;
  await f.post('/api/cancel', {id: job.id}); release();
  const done = await terminal(f, job.id); assert.equal(done.status, 'completed'); assert.equal(done.cancel_acknowledged, false); assert.equal(done.result.task_acceptance.status, 'review_required');
});
test('recovery rechecks eligibility and saves a new task with source lineage without replaying its parent', async t => {
  const f = await fixture(t), session = await f.session(), plan = await f.plan(session.id);
  const store = createWorkbenchState(f.root), source = store.get('tasks', plan.task_id);
  source.run_id = 'failed-source'; source.status = 'failed'; store.save('tasks', source);
  const dir = path.join(f.root, 'artifacts/failed-source'); fs.mkdirSync(dir, {recursive: true}); fs.writeFileSync(path.join(dir, 'workflow.json'), '{}');
  let eligible = false, executions = 0;
  f.registry.set('eda_workflow_resume_check', {execute: async () => ({details: {ready: eligible, calls: 3, spent_ms: 100, issues: eligible ? [] : ['input_changed']}})});
  f.registry.set('eda_workflow_resume', {execute: async (_id, args) => { executions++; assert.equal(args.directory, dir); return {details: {status: 'completed', directory: path.join(f.root, 'artifacts/new-continuation')}}; }});
  const request = {session_id: session.id, run_id: 'failed-source', action: 'resume'};
  assert.equal((await f.post('/api/recovery', request)).status, 409); assert.equal(executions, 0);
  eligible = true; assert.equal((await (await f.post('/api/recovery', {...request, action: 'check'})).json()).ready, true);
  eligible = false; assert.equal((await f.post('/api/recovery', request)).status, 409); assert.equal(executions, 0);
  eligible = true; const response = await f.post('/api/recovery', request); assert.equal(response.status, 202);
  const job = await response.json(); assert.equal((await terminal(f, job.id)).status, 'completed');
  const child = await (await f.get(`/api/task?id=${job.task_id}`)).json();
  assert.equal(child.source_run_id, 'failed-source'); assert.equal(child.source_task_id, source.id); assert.equal(child.recovery_check.calls, 3); assert.notEqual(child.id, source.id);
  assert.equal(store.get('tasks', source.id).status, 'failed');
  assert.equal((await f.post('/api/recovery', request)).status, 409); assert.equal(executions, 1);
});
test('fake native adapter batches text deltas without losing public text or exposing its resume path', async t => {
  const f = await fixture(t, undefined, {agentAdapter: async ({onEvent}) => {
    for (let i = 0; i < 120; i++) onEvent({type: 'text_delta', text: 'answer ', sequence: i + 1});
    onEvent({type: 'assistant_message', text: 'answer '.repeat(120), sequence: 121});
    return {status: 'completed', answer: 'answer '.repeat(120), sessionFile: 'private-pi-session.jsonl'};
  }});
  fs.mkdirSync(path.join(f.root, '.eda'), {recursive: true});
  fs.writeFileSync(path.join(f.root, '.eda/config.json'), JSON.stringify({schema_version: 1, model_api_enabled: true, resources: {xsim: 2, vivado: 1, ltspice: 1, verify: 4}, queue_timeout_ms: 900000}));
  const session = await f.session(), job = await (await f.post('/api/agent', {session_id: session.id, message: 'Fake adapter only'})).json();
  const done = await terminal(f, job.id); assert.equal(done.status, 'completed'); assert.equal(done.result.sessionFile, undefined);
  const events = (await (await f.get(`/api/events?session_id=${session.id}`)).json()).events.filter(e => e.type === 'agent_event');
  const deltas = events.filter(e => e.event.type === 'text_delta'); assert.equal(deltas.length, 2); assert.equal(deltas.map(e => e.event.text).join(''), 'answer '.repeat(120));
  assert.equal(events.at(-1).event.type, 'assistant_message');
  const restored = await (await f.get(`/api/session?id=${session.id}`)).json(); assert.equal(restored.native_session_file, undefined); assert.equal(restored.messages.at(-1).text, 'answer '.repeat(120));
});
