import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { acquireResource, acquireReconcileGuard } from '../../src/runtime.mjs';

const [operation, root, encoded = '{}'] = process.argv.slice(2);
const opts = JSON.parse(encoded);
const send = value => process.send?.({ pid: process.pid, ...value });
process.once('disconnect', () => process.exit(3));
function pause(phase) {
  const marker = path.join(root, `${phase}.paused.json`);
  fs.writeFileSync(marker, JSON.stringify({ phase, pid: process.pid }));
  const resume = path.join(root, `${phase}.resume`);
  const until = Date.now() + 15000;
  while (!fs.existsSync(resume)) {
    if (Date.now() > until) throw new Error(`Test barrier timed out: ${phase}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}
try {
  if (operation === 'lease') {
    const controller = new AbortController();
    let releaseRequested = false, releaseWait;
    process.on('message', message => {
      if (message === 'cancel') controller.abort();
      if (message === 'release') { releaseRequested = true; releaseWait?.(); }
    });
    const waiting = acquireResource({ root, directory: root, resource: 'vivado', runId: opts.id, signal: controller.signal,
      limit: opts.limit ?? 1, pollMs: opts.pollMs ?? 10, timeoutMs: opts.timeoutMs ?? 5000 });
    send({ event: 'queued', id: opts.id });
    const lease = await waiting;
    send({ event: 'acquired', id: opts.id, slot: lease.slot, ticket: lease.ticket_id, wait_ms: lease.wait_ms });
    if (!releaseRequested) await new Promise(resolve => { releaseWait = resolve; if (opts.holdMs !== undefined) setTimeout(resolve, opts.holdMs); });
    lease.release(); send({ event: 'released', id: opts.id });
  } else {
    if (opts.publishFailure) {
      const spawnSync = childProcess.spawnSync;
      childProcess.spawnSync = (executable, args, options) => {
        if (!options?.env?.EDA_GUARD_CANDIDATE) return spawnSync(executable, args, options);
        if (opts.publishFailure === 'permission') return { status: 18, stderr: '{"type":"System.UnauthorizedAccessException","native_code":5}' };
        const result = spawnSync(executable, args, options);
        if (result.status !== 0) return result;
        return { ...result, status: null, error: Object.assign(new Error('fixture helper timeout after move'), { code: 'ETIMEDOUT' }) };
      };
    }
    if (opts.phase) {
      const rename = fs.renameSync;
      let paused = false;
      const spawnSync = childProcess.spawnSync;
      childProcess.spawnSync = (executable, args, options) => {
        if (!paused && opts.phase === 'before-publish' && options?.env?.EDA_GUARD_CANDIDATE) { paused = true; pause(opts.phase); }
        return spawnSync(executable, args, options);
      };
      fs.renameSync = (source, destination) => {
        const archive = path.dirname(source) === path.join(root, '.eda-state/locks/reconcile.lock') && path.basename(source).startsWith('owner.');
        const publication = path.basename(source).startsWith('.reconcile-candidate.') && path.basename(destination) === 'reconcile.lock';
        const selected = !paused && ((opts.phase === 'before-publish' && publication) || (opts.phase !== 'before-publish' && archive));
        if (selected) { paused = true; if (opts.phase !== 'after-archive') pause(opts.phase); }
        const value = rename(source, destination);
        if (selected && opts.phase === 'after-archive') pause(opts.phase);
        return value;
      };
    }
    if (opts.permissionUnknownPid) {
      const kill = process.kill;
      process.kill = (pid, signal) => { if (pid === opts.permissionUnknownPid) throw Object.assign(new Error('fixture EPERM'), { code: 'EPERM' }); return kill(pid, signal); };
    }
    const guard = acquireReconcileGuard(root);
    send({ event: 'guard_acquired', token: guard.token, recovered: guard.recovered });
    await new Promise(resolve => process.once('message', resolve));
    guard.release(); send({ event: 'guard_released' });
  }
  process.exit(0);
} catch (error) {
  send({ event: 'error', code: error.code, name: error.name, message: String(error), cleanup_error: error.queue_cleanup_error });
  process.exit(2);
}
