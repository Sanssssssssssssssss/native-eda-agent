import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {createWorkbenchState} from '../src/workbench-state.mjs';
import {createWorkbench} from '../src/workbench.mjs';

function temporaryWorkspace(t) {
  const parent = fs.realpathSync(os.tmpdir());
  const root = fs.mkdtempSync(path.join(parent, 'eda-workbench-acceptance-'));
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith('eda-workbench-acceptance-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  });
  return root;
}

test('event replay survives a crash after journal append and before session checkpoint', t => {
  const root = temporaryWorkspace(t), first = createWorkbenchState(root);
  const session = first.createSession('Replay boundary');
  const committed = first.emit(session.id, 'activity', {text: 'First persisted event'});
  assert.equal(committed.sequence, 1);

  // This is the observable disk state when the journal append succeeds but the
  // following session checkpoint does not reach disk before process exit.
  const stale = first.get('sessions', session.id);
  stale.event_sequence = 0;
  first.save('sessions', stale);

  const restarted = createWorkbenchState(root);
  const next = restarted.emit(session.id, 'activity', {text: 'After restart'});
  assert.equal(next.sequence, 2);
  const replay = restarted.events(session.id, 1);
  assert.equal(replay.events.length, 1);
  assert.equal(replay.events[0].text, 'After restart');
  assert.equal(replay.last_sequence, 2);
});

async function fixture(t, options = {}) {
  const root = temporaryWorkspace(t), apps = new Set();
  let executions = 0;
  fs.mkdirSync(path.join(root, 'examples/workflows'), {recursive: true});
  fs.writeFileSync(path.join(root, 'examples/workflows/offline-review.json'), JSON.stringify({goal: 'Check fixed evidence'}));
  const registry = new Map([
    ['eda_workflow_plan', {execute: async () => ({details: {spec: {goal: 'Check fixed evidence', steps: []}, inputs: []}})}],
    ['eda_workflow_run', {execute: async () => {executions++; return {details: {status: 'completed', acceptance: 'fixture-only'}};}}],
  ]);
  const open = async () => {
    const app = createWorkbench(root, registry, options);
    apps.add(app);
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${app.server.address().port}`;
    return {
      get: (route, options) => fetch(base + route, options),
      post: (route, data) => fetch(base + route, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: base}, body: JSON.stringify(data)}),
      close: async () => {await app.close(); apps.delete(app);},
    };
  };
  t.after(async () => {for (const app of apps) await app.close();});
  return {root, open, registry, count: () => executions, client: await open()};
}

async function createSession(client, title) {
  const response = await client.post('/api/session', {action: 'create', title});
  assert.equal(response.status, 200);
  return response.json();
}

async function completedJob(client, id) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await client.get('/api/job?id=' + id);
    assert.equal(response.status, 200);
    const job = await response.json();
    if (!['queued', 'running', 'cancel_requested'].includes(job.status)) return job;
    await delay(5);
  }
  assert.fail('Fixture job did not reach a terminal state');
}

test('a plan is bound to its session, is executed once, and does not leak events into another session', async t => {
  const f = await fixture(t), a = await createSession(f.client, 'Session A'), b = await createSession(f.client, 'Session B');
  const preview = await f.client.post('/api/workflow', {action: 'plan', spec: 'offline-review', session_id: a.id});
  assert.equal(preview.status, 200);
  const plan = await preview.json();
  const wrong = await f.client.post('/api/workflow', {action: 'run', spec: 'offline-review', session_id: b.id, plan_id: plan.plan_id});
  assert.equal(wrong.status, 409);
  assert.equal(f.count(), 0);

  const started = await f.client.post('/api/workflow', {action: 'run', spec: 'offline-review', session_id: a.id, plan_id: plan.plan_id});
  assert.equal(started.status, 202);
  const job = await completedJob(f.client, (await started.json()).id);
  assert.equal(job.status, 'completed');
  assert.equal(job.session_id, a.id);
  assert.equal(job.task_id, plan.task_id);
  assert.equal(f.count(), 1);
  assert.equal((await f.client.post('/api/workflow', {action: 'run', spec: 'offline-review', session_id: a.id, plan_id: plan.plan_id})).status, 409);
  assert.equal(f.count(), 1);

  const own = await (await f.client.get('/api/events?session_id=' + a.id)).json();
  const other = await (await f.client.get('/api/events?session_id=' + b.id)).json();
  assert.ok(own.events.some(event => event.job_id === job.id));
  assert.ok(own.events.every(event => event.session_id === a.id));
  assert.equal(other.events.length, 0);
  assert.equal((await (await f.client.get('/api/session?id=' + b.id)).json()).tasks.length, 0);
});

test('completed tasks survive server replacement without being executed again', async t => {
  const f = await fixture(t), session = await createSession(f.client, 'Persistent task');
  const plan = await (await f.client.post('/api/workflow', {action: 'plan', spec: 'offline-review', session_id: session.id})).json();
  const started = await (await f.client.post('/api/workflow', {action: 'run', spec: 'offline-review', session_id: session.id, plan_id: plan.plan_id})).json();
  await completedJob(f.client, started.id);
  await f.client.close();
  const next = await f.open();
  const restored = await (await next.get('/api/session?id=' + session.id)).json();
  assert.equal(restored.tasks.length, 1);
  assert.equal(restored.tasks[0].id, plan.task_id);
  assert.equal(restored.tasks[0].status, 'completed');
  const job = await (await next.get('/api/job?id=' + started.id)).json();
  assert.equal(job.status, 'completed');
  assert.equal(job.controllable, false);
  assert.equal(f.count(), 1);
});

test('disabled model route does not initialize an adapter or append a fake conversation', async t => {
  let calls = 0;
  const f = await fixture(t, {agentAdapter: async () => {calls++; throw new Error('Must not initialize');}});
  const session = await createSession(f.client, 'Disabled model');
  const response = await f.client.post('/api/agent', {session_id: session.id, message: 'Synthesize a design'});
  assert.equal(response.status, 403);
  assert.equal(calls, 0);
  assert.equal((await (await f.client.get('/api/session?id=' + session.id)).json()).messages.length, 0);
  assert.equal((await (await f.client.get('/api/jobs')).json()).jobs.length, 0);
  assert.equal(fs.existsSync(path.join(f.root, '.pi-state')), false);
  assert.equal(fs.readdirSync(path.join(f.root, 'artifacts')).length, 0);
});

test('SSE reconnect uses its last delivered event rather than the original URL cursor', async t => {
  const f = await fixture(t), session = await createSession(f.client, 'Reconnect');
  const state = createWorkbenchState(f.root);
  state.emit(session.id, 'activity', {text: 'Already received'});
  state.emit(session.id, 'activity', {text: 'Still pending'});
  const response = await f.client.get(`/api/events?format=sse&session_id=${session.id}&after=0`, {
    headers: {'Last-Event-ID': '1'}, signal: AbortSignal.timeout(2000),
  });
  assert.equal(response.status, 200);
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let received = '';
  try {
    while (!/\nid: \d+/.test('\n' + received)) {
      const part = await reader.read();
      if (part.done) break;
      received += decoder.decode(part.value, {stream: true});
    }
  } finally {await reader.cancel();}
  assert.equal((received.match(/(?:^|\n)id: (\d+)/) || [])[1], '2');
  assert.equal(received.includes('Already received'), false);
  assert.equal(received.includes('Still pending'), true);
});

test('a proven departed owner becomes interrupted without rewriting raw evidence or replaying the task', async t => {
  const f = await fixture(t), session = await createSession(f.client, 'Interrupted task'), state = createWorkbenchState(f.root);
  const exited = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], {encoding: 'utf8', windowsHide: true});
  assert.equal(exited.status, 0);
  const jobId = 'departed-job', taskId = 'departed-task', timestamp = new Date().toISOString();
  state.save('tasks', {id: taskId, session_id: session.id, status: 'running', job_id: jobId});
  state.save('jobs', {id: jobId, task_id: taskId, session_id: session.id, status: 'running', started_at: timestamp, owner_pid: Number(exited.stdout)});
  const saved = state.get('sessions', session.id); saved.task_ids = [taskId]; state.save('sessions', saved);
  const evidence = path.join(f.root, 'artifacts', 'raw-evidence.json');
  const original = JSON.stringify({status: 'running', statement: 'Original observation remains unchanged'});
  fs.writeFileSync(evidence, original);
  await f.client.close();
  const next = await f.open();
  const job = await (await next.get('/api/job?id=' + jobId)).json();
  assert.equal(job.status, 'interrupted');
  assert.equal(job.controllable, false);
  assert.equal(job.owner_alive, false);
  const restored = await (await next.get('/api/session?id=' + session.id)).json();
  assert.equal(restored.tasks[0].status, 'interrupted');
  assert.equal(fs.readFileSync(evidence, 'utf8'), original);
  assert.equal(f.count(), 0);
});
