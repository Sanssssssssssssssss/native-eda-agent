import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { acquireResource, acquireReconcileGuard, reconcileRuns } from '../src/runtime.mjs';

const base = path.join(import.meta.dirname, '../artifacts/runtime-concurrency-tests', `fixtures-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`);
fs.mkdirSync(base, { recursive: true });
const records = [];
process.on('exit', () => fs.writeFileSync(path.join(base, 'worker-events.json'), JSON.stringify(records, null, 2)));
const fixture = name => { const root = path.join(base, name); fs.mkdirSync(root); return root; };
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
function worker(t, operation, root, options = {}) {
  const child = spawn(process.execPath, [path.join(import.meta.dirname, 'fixtures/runtime-worker.mjs'), operation, root, JSON.stringify(options)], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const messages = [];
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('message', message => { messages.push(message); records.push({ at: new Date().toISOString(), root, operation, ...message }); });
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code)); });
  t.after(async () => { if (child.exitCode === null) child.kill(); await done; });
  // The Windows publication helper itself has a 30 s bound; allow its result to arrive.
  return { child, messages, done, async wait(event, ms = 45000) {
    const until = Date.now() + ms;
    while (Date.now() < until) {
      const match = messages.find(message => message.event === event);
      if (match) return match;
      if (child.exitCode !== null) throw new Error(`Worker exited ${child.exitCode}: ${JSON.stringify(messages)} ${stderr}`);
      await delay(10);
    }
    throw new Error(`Worker timeout for ${event}: ${JSON.stringify(messages)} ${stderr}`);
  } };
}
async function marker(root, phase) {
  const file = path.join(root, `${phase}.paused.json`);
  for (let i = 0; i < 600; i++) { if (fs.existsSync(file)) return; await delay(10); }
  throw new Error(`Missing barrier ${phase}`);
}
async function killedGuard(t, root) {
  const owner = worker(t, 'guard', root);
  const held = await owner.wait('guard_acquired');
  owner.child.kill(); await owner.done;
  return held;
}
const queueFiles = root => fs.readdirSync(path.join(root, '.eda-state/queues/vivado')).filter(file => file.endsWith('.json'));

test('FIFO survives a faster late poller across processes without making the oldest waiter lose its place', async t => {
  const root = fixture('fifo');
  const holding = await acquireResource({ root, resource: 'vivado', runId: 'holder', directory: root });
  const first = worker(t, 'lease', root, { id: 'first', pollMs: 150 }); await first.wait('queued');
  const second = worker(t, 'lease', root, { id: 'second', pollMs: 1 }); await second.wait('queued');
  const third = worker(t, 'lease', root, { id: 'third', pollMs: 1 }); await third.wait('queued');
  holding.release();
  await first.wait('acquired');
  assert.ok(!second.messages.some(message => message.event === 'acquired'));
  assert.ok(!third.messages.some(message => message.event === 'acquired'));
  first.child.send('release'); assert.equal(await first.done, 0);
  await second.wait('acquired');
  assert.ok(!third.messages.some(message => message.event === 'acquired'));
  second.child.send('release'); assert.equal(await second.done, 0);
  await third.wait('acquired'); third.child.send('release'); assert.equal(await third.done, 0);
  assert.deepEqual(queueFiles(root), []);
});

test('the first limit owners retain queue tickets during leases and one freed slot admits the oldest pending ticket', async t => {
  const root = fixture('limit-two');
  const a = await acquireResource({ root, resource: 'vivado', runId: 'holder-a', directory: root, limit: 2 });
  const b = await acquireResource({ root, resource: 'vivado', runId: 'holder-b', directory: root, limit: 2 });
  const first = worker(t, 'lease', root, { id: 'first', limit: 2, pollMs: 150 }); await first.wait('queued');
  const late = worker(t, 'lease', root, { id: 'late', limit: 2, pollMs: 1 }); await late.wait('queued');
  a.release(); await first.wait('acquired');
  assert.ok(!late.messages.some(message => message.event === 'acquired'));
  b.release(); await late.wait('acquired');
  first.child.send('release'); late.child.send('release');
  assert.equal(await first.done, 0); assert.equal(await late.done, 0);
});

test('cancel and timeout remove only their own queue tickets; later work proceeds', async t => {
  const root = fixture('cancel-timeout');
  const holding = await acquireResource({ root, resource: 'vivado', runId: 'holder', directory: root });
  const cancelled = worker(t, 'lease', root, { id: 'cancel' }); await cancelled.wait('queued');
  const next = worker(t, 'lease', root, { id: 'next' }); await next.wait('queued');
  cancelled.child.send('cancel');
  assert.equal((await cancelled.wait('error')).name, 'AbortError'); assert.equal(await cancelled.done, 2);
  const timed = worker(t, 'lease', root, { id: 'timeout', timeoutMs: 80 });
  assert.equal((await timed.wait('error')).code, 'QUEUE_TIMEOUT'); assert.equal(await timed.done, 2);
  assert.equal(queueFiles(root).length, 2);
  holding.release(); await next.wait('acquired'); next.child.send('release'); assert.equal(await next.done, 0);
  assert.equal(queueFiles(root).length, 0);
});

test('dead queued owner is skipped but retained; unknown ticket blocks acquisition', async t => {
  const root = fixture('dead-ticket');
  const holding = await acquireResource({ root, resource: 'vivado', runId: 'holder', directory: root });
  const dead = worker(t, 'lease', root, { id: 'dead' }); await dead.wait('queued');
  dead.child.kill(); await dead.done;
  const deadFile = queueFiles(root).map(name => path.join(root, '.eda-state/queues/vivado', name)).find(file => JSON.parse(fs.readFileSync(file)).run_id === 'dead');
  const before = hash(deadFile);
  holding.release();
  const next = await acquireResource({ root, resource: 'vivado', runId: 'next', directory: root, timeoutMs: 500 }); next.release();
  assert.equal(hash(deadFile), before);
  const unknown = path.join(root, '.eda-state/queues/vivado/0000000000000000-unknown.json'); fs.writeFileSync(unknown, '{}');
  await assert.rejects(acquireResource({ root, resource: 'vivado', runId: 'blocked', directory: root, timeoutMs: 30, pollMs: 2 }), { code: 'QUEUE_TIMEOUT' });
  assert.equal(fs.readFileSync(unknown, 'utf8'), '{}');
});

test('crashed guard owner is archived and recovered; a live owner is never stolen', async t => {
  const root = fixture('guard-owner');
  const held = await killedGuard(t, root);
  const next = acquireReconcileGuard(root);
  assert.equal(next.recovered[0].token, held.token);
  assert.equal(JSON.parse(fs.readFileSync(next.recovered[0].archive)).pid, held.pid);
  const blocked = worker(t, 'guard', root);
  assert.equal((await blocked.wait('error')).code, 'RECONCILE_BUSY'); assert.equal(await blocked.done, 2);
  assert.ok(fs.existsSync(path.join(next.guard, `owner.${next.token}.json`)));
  next.release(); next.release();
  assert.ok(!fs.existsSync(next.guard));
  assert.deepEqual(reconcileRuns(root), []);
});

for (const phase of ['before-archive', 'after-archive']) {
  test(`late reaper at ${phase} cannot remove a newly published guard`, async t => {
    const root = fixture(phase); await killedGuard(t, root);
    const stale = worker(t, 'guard', root, { phase }); await marker(root, phase);
    const replacement = worker(t, 'guard', root); const newer = await replacement.wait('guard_acquired');
    fs.writeFileSync(path.join(root, `${phase}.resume`), 'resume');
    assert.equal((await stale.wait('error')).code, 'RECONCILE_BUSY'); assert.equal(await stale.done, 2);
    const guard = path.join(root, '.eda-state/locks/reconcile.lock');
    assert.ok(fs.existsSync(path.join(guard, `owner.${newer.token}.json`)));
    replacement.child.send('release'); assert.equal(await replacement.done, 0);
  });
}

test('crash after archiving owner leaves a recoverable empty shell; pre-publication crash does not claim the guard', async t => {
  const root = fixture('reaper-crash'); await killedGuard(t, root);
  const reaper = worker(t, 'guard', root, { phase: 'after-archive' }); await marker(root, 'after-archive');
  reaper.child.kill(); await reaper.done;
  const next = acquireReconcileGuard(root); next.release();
  const candidate = worker(t, 'guard', root, { phase: 'before-publish' }); await marker(root, 'before-publish');
  candidate.child.kill(); await candidate.done;
  const after = acquireReconcileGuard(root); after.release();
  assert.ok(fs.readdirSync(path.join(root, '.eda-state/locks')).some(name => name.startsWith('.reconcile-candidate.')));
});

test('legacy empty files, malformed metadata and permission-unknown owners fail closed', async t => {
  for (const kind of ['legacy-file', 'malformed', 'permission-unknown']) {
    const root = fixture(kind), guard = path.join(root, '.eda-state/locks/reconcile.lock');
    fs.mkdirSync(path.dirname(guard), { recursive: true });
    if (kind === 'legacy-file') fs.writeFileSync(guard, '');
    else {
      fs.mkdirSync(guard);
      const token = randomUUID();
      fs.writeFileSync(path.join(guard, `owner.${token}.json`), kind === 'malformed' ? '{bad' : JSON.stringify({ schema_version: 1, token, pid: 1073741823 }));
    }
    const probe = worker(t, 'guard', root, kind === 'permission-unknown' ? { permissionUnknownPid: 1073741823 } : {});
    assert.equal((await probe.wait('error')).code, kind === 'permission-unknown' ? 'RECONCILE_BUSY' : 'RECONCILE_GUARD_UNKNOWN');
    assert.equal(await probe.done, 2); assert.ok(fs.existsSync(guard));
  }
});

test('a legacy file published after preflight is never replaced by the new guard', async t => {
  const root = fixture('late-legacy');
  const contender = worker(t, 'guard', root, { phase: 'before-publish' }); await marker(root, 'before-publish');
  const guard = path.join(root, '.eda-state/locks/reconcile.lock');
  fs.writeFileSync(guard, 'legacy owner evidence', { flag: 'wx' });
  const before = hash(guard);
  fs.writeFileSync(path.join(root, 'before-publish.resume'), 'resume');
  assert.equal((await contender.wait('error')).code, 'RECONCILE_GUARD_UNKNOWN');
  assert.equal(await contender.done, 2);
  assert.ok(fs.lstatSync(guard).isFile()); assert.equal(hash(guard), before);
});

test('two simultaneous publishers allow only one live guard owner', async t => {
  const root = fixture('competing-publishers');
  const one = worker(t, 'guard', root, { phase: 'before-publish' }); await marker(root, 'before-publish');
  const two = worker(t, 'guard', root); const held = await two.wait('guard_acquired');
  fs.writeFileSync(path.join(root, 'before-publish.resume'), 'resume');
  assert.equal((await one.wait('error')).code, 'RECONCILE_BUSY'); assert.equal(await one.done, 2);
  const guard = path.join(root, '.eda-state/locks/reconcile.lock');
  assert.ok(fs.existsSync(path.join(guard, `owner.${held.token}.json`)));
  two.child.send('release'); assert.equal(await two.done, 0);
});

test('Windows publication permission failure is distinct from an existing guard', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture('publication-permission');
  const probe = worker(t, 'guard', root, { publishFailure: 'permission' });
  const error = await probe.wait('error');
  assert.equal(error.code, 'RECONCILE_PUBLISH_FAILED'); assert.match(error.message, /native_code.*5/);
  assert.equal(await probe.done, 2);
  assert.deepEqual(fs.readdirSync(path.join(root, '.eda-state/locks')), []);
});

test('Windows helper failure after a successful move recognizes only its own token and releases cleanly', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture('publication-ambiguous-result');
  const probe = worker(t, 'guard', root, { publishFailure: 'after-move' });
  await probe.wait('guard_acquired'); probe.child.send('release'); assert.equal(await probe.done, 0);
  assert.deepEqual(fs.readdirSync(path.join(root, '.eda-state/locks')), []);
});

console.log(`Runtime draft fixture evidence: ${base}`);
