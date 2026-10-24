import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createTrace } from '../src/trace.mjs';
import { acquireResource, createRunState, reconcileRuns, listRuns, runHook } from '../src/runtime.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eda-runtime-'));
  t.after(() => { assert.ok(root.startsWith(path.join(os.tmpdir(), 'eda-runtime-'))); fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
test('resource limits queue, time out, cancel and release without stealing live leases', async t => {
  const root = fixture(t), opts = { root, resource: 'vivado', runId: 'test', directory: root, pollMs: 5 };
  const first = await acquireResource(opts);
  await assert.rejects(acquireResource({ ...opts, timeoutMs: 15 }), { code: 'QUEUE_TIMEOUT' });
  const abort = new AbortController();
  const queued = acquireResource({ ...opts, signal: abort.signal }); abort.abort();
  await assert.rejects(queued, { name: 'AbortError' });
  assert.equal(fs.readdirSync(path.join(root, '.eda-state/locks')).length, 1);
  first.release(); first.release();
  const next = await acquireResource(opts); next.release();
  assert.equal(fs.readdirSync(path.join(root, '.eda-state/locks')).length, 0);
});
test('resource ownership applies across Node processes', async t => {
  const root = fixture(t);
  const code = `import {acquireResource} from ${JSON.stringify(new URL('../src/runtime.mjs', import.meta.url).href)};
    const lease=await acquireResource({root:${JSON.stringify(root)},resource:'vivado',runId:'child',directory:${JSON.stringify(root)}});
    process.stdout.write('ready'); process.stdin.once('data',()=>{lease.release();process.exit(0)});`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', code], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null) child.kill(); });
  await once(child.stdout, 'data');
  await assert.rejects(acquireResource({ root, resource: 'vivado', runId: 'parent', directory: root, timeoutMs: 20, pollMs: 5 }), { code: 'QUEUE_TIMEOUT' });
  child.stdin.end('release'); await once(child, 'exit');
  const lease = await acquireResource({ root, resource: 'vivado', runId: 'parent', directory: root }); lease.release();
});
test('state machine rejects skipped stages; hooks preserve failures', async t => {
  const root = fixture(t), trace = createTrace({ root, tool: 'fixture', args: {}, toolCallId: 'fixture' });
  const state = createRunState(root, trace);
  assert.throws(() => state.transition('completed'), /Invalid state transition/);
  state.transition('preflight');
  await assert.rejects(runHook(trace, 'preflight', () => { throw new Error('fixture failure'); }), /fixture failure/);
  state.transition('failed'); trace.finish('failed');
  assert.equal(listRuns(root)[0].status, 'failed');
  const events = fs.readFileSync(path.join(trace.directory, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.find(e => e.type === 'hook_end').status, 'failed');
});
test('reconcile preserves living children and archives dead leases without rewriting raw traces', async t => {
  const root = fixture(t), trace = createTrace({ root, tool: 'fixture', args: {}, toolCallId: 'fixture' });
  const state = createRunState(root, trace); state.transition('preflight');
  const stateFile = path.join(root, '.eda-state/runs', `${trace.manifest.run_id}.json`);
  const stored = JSON.parse(fs.readFileSync(stateFile)); stored.pid = 1073741823; fs.writeFileSync(stateFile, JSON.stringify(stored));
  const lease = await acquireResource({ root, resource: 'vivado', runId: trace.manifest.run_id, directory: trace.directory });
  const lock = path.join(root, '.eda-state/locks/vivado-0.json');
  const owner = JSON.parse(fs.readFileSync(lock)); owner.pid = 1073741823; fs.writeFileSync(lock, JSON.stringify(owner));
  trace.manifest.processes.push({ pid: process.pid, ended_at: null }); trace.persist();
  assert.equal(reconcileRuns(root)[0].action, 'retained'); assert.ok(fs.existsSync(lock));
  trace.manifest.processes[0].pid = 1073741823; trace.persist();
  trace.manifest.owned_backend_pid = process.pid; trace.persist();
  assert.equal(reconcileRuns(root)[0].action,'retained');assert.ok(fs.existsSync(lock));
  trace.manifest.owned_backend_pid = 1073741823;trace.persist();
  const bytes = fs.readFileSync(path.join(trace.directory, 'run.json'));
  assert.equal(reconcileRuns(root)[0].action, 'recovered'); assert.ok(!fs.existsSync(lock));
  assert.equal(listRuns(root)[0].status, 'interrupted');
  assert.deepEqual(fs.readFileSync(path.join(trace.directory, 'run.json')), bytes);
});
