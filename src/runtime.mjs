import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import childProcess from 'node:child_process';

export const terminalStates = new Set(['completed', 'failed', 'cancelled', 'timed_out', 'interrupted']);
const edges = {
  queued: ['preflight', 'failed', 'cancelled'], preflight: ['snapshotting', 'failed', 'cancelled'],
  snapshotting: ['waiting', 'failed', 'cancelled'], waiting: ['running', 'failed', 'cancelled', 'timed_out'],
  running: ['finalizing', 'failed', 'cancelled', 'timed_out'], finalizing: ['completed', 'failed', 'cancelled', 'timed_out'],
};
const defaults = { schema_version: 1, model_api_enabled: false, resources: { xsim: 2, vivado: 1, ltspice: 1, verify: 4 }, queue_timeout_ms: 900000 };
export function readConfig(root) {
  const file = path.join(root, '.eda/config.json');
  const config = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : defaults;
  if (config.schema_version !== 1 || typeof config.model_api_enabled !== 'boolean') throw new Error('Invalid EDA config schema');
  for (const name of Object.keys(defaults.resources)) {
    if (!Number.isInteger(config.resources?.[name]) || config.resources[name] < 1 || config.resources[name] > 8) throw new Error(`Invalid resource limit: ${name}`);
  }
  if (!Number.isSafeInteger(config.queue_timeout_ms) || config.queue_timeout_ms < 1) throw new Error('Invalid queue timeout');
  return config;
}
const save = (file, value) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
  fs.renameSync(tmp, file);
};
export function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return null;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'ESRCH' ? false : true; }
}
export function createRunState(root, trace) {
  const file = path.join(root, '.eda-state/runs', `${trace.manifest.run_id}.json`);
  const state = { schema_version: 1, run_id: trace.manifest.run_id, tool: trace.manifest.tool,
    pid: process.pid, status: 'queued', directory: trace.directory, trace_id: trace.manifest.trace_id,
    context: trace.manifest.context, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  save(file, state);
  trace.event('state_transition', { previous: null, status: 'queued' });
  return { state, transition(status, extra = {}, emit = true) {
    if (!edges[state.status]?.includes(status)) throw new Error(`Invalid state transition ${state.status} -> ${status}`);
    const previous = state.status;
    Object.assign(state, extra, { status, updated_at: new Date().toISOString() });
    save(file, state);
    if (emit) trace.event('state_transition', { previous, status, ...extra });
  } };
}
export async function runHook(trace, name, handler) {
  const start = performance.now();
  trace.event('hook_start', { hook: name });
  try { const value = await handler(); trace.event('hook_end', { hook: name, status: 'completed', duration_ms: performance.now() - start }); return value; }
  catch (error) { trace.event('hook_end', { hook: name, status: 'failed', duration_ms: performance.now() - start, error: String(error) }); throw error; }
}
export async function acquireResource({ root, resource, runId, directory, signal, timeoutMs, limit, pollMs = 100 }) {
  const config = readConfig(root);
  if (!(resource in config.resources)) throw new Error(`Unknown resource ${resource}`);
  limit ??= config.resources[resource]; timeoutMs ??= config.queue_timeout_ms;
  if (!Number.isInteger(limit) || limit < 1 || limit > 8 || !Number.isFinite(timeoutMs) || timeoutMs < 1 || !Number.isFinite(pollMs) || pollMs < 1) throw new Error('Invalid resource queue limits');
  signal?.throwIfAborted();
  const locks = path.join(root, '.eda-state/locks');
  const queue = path.join(root, '.eda-state/queues', resource);
  fs.mkdirSync(locks, { recursive: true });
  fs.mkdirSync(queue, { recursive: true });
  const start = performance.now();
  const ticket = { schema_version: 1, token: randomUUID(), pid: process.pid, run_id: runId,
    directory, resource, enqueued_at: new Date().toISOString(), enqueued_ms: Date.now() };
  const ticketName = `${String(ticket.enqueued_ms).padStart(16, '0')}-${ticket.token}.json`;
  const ticketFile = path.join(queue, ticketName);
  save(ticketFile, ticket);
  let acquired = false;
  const removeOwnTicket = () => {
    let current;
    try { current = JSON.parse(fs.readFileSync(ticketFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (current.token !== ticket.token || current.pid !== process.pid) throw new Error('Queue ticket ownership changed; refusing cleanup');
    fs.unlinkSync(ticketFile);
  };
  const eligible = () => {
    // A granted owner keeps its ticket until release: newcomers cannot compete for its successor's place.
    const active = [];
    for (const name of fs.readdirSync(queue).filter(name => name.endsWith('.json')).sort()) {
      try {
        const value = JSON.parse(fs.readFileSync(path.join(queue, name), 'utf8'));
        const valid = value?.schema_version === 1 && value.resource === resource && Number.isSafeInteger(value.enqueued_ms) &&
          typeof value.token === 'string' && name === `${String(value.enqueued_ms).padStart(16, '0')}-${value.token}.json` &&
          Number.isInteger(value.pid) && value.pid > 0;
        if (valid && pidAlive(value.pid) === false) continue; // Keep dead tickets as evidence; explicit lease recovery is separate.
      } catch (error) { if (error.code === 'ENOENT') continue; /* Unknown ownership occupies its ordered place. */ }
      active.push(name);
      if (active.length === limit) break;
    }
    return active.includes(ticketName);
  };
  try {
    while (true) {
      signal?.throwIfAborted();
      if (performance.now() - start >= timeoutMs) throw Object.assign(new Error(`Queue timeout waiting for ${resource}; inspect eda runs before reconciling stale owners`), { code: 'QUEUE_TIMEOUT' });
      if (eligible()) for (let slot = 0; slot < limit; slot++) {
        const file = path.join(locks, `${resource}-${slot}.json`);
        const owner = { schema_version: 1, token: randomUUID(), pid: process.pid, run_id: runId,
          directory, resource, slot, ticket: ticketName, acquired_at: new Date().toISOString() };
        let fd;
        try { fd = fs.openSync(file, 'wx'); }
        catch (error) { if (error.code === 'EEXIST') continue; throw error; }
        try { fs.writeFileSync(fd, JSON.stringify(owner)); fs.fsyncSync(fd); }
        catch (error) { fs.closeSync(fd); fs.unlinkSync(file); throw error; }
        fs.closeSync(fd);
        acquired = true;
        let slotReleased = false, ticketReleased = false;
        return { resource, slot, ticket_id: ticket.token, ticket_file: ticketFile, wait_ms: performance.now() - start, release() {
          if (!slotReleased) {
            const current = JSON.parse(fs.readFileSync(file, 'utf8'));
            if (current.token !== owner.token) throw new Error('Resource ownership changed; refusing release');
            fs.unlinkSync(file); slotReleased = true;
          }
          if (!ticketReleased) { removeOwnTicket(); ticketReleased = true; }
        } };
      }
      await delay(Math.min(pollMs, Math.max(1, timeoutMs - (performance.now() - start))), undefined, { signal });
    }
  } catch (error) {
    if (!acquired) {
      try { removeOwnTicket(); }
      catch (cleanupError) { error.queue_cleanup_error = String(cleanupError); }
    }
    throw error;
  }
}
export function listRuns(root) {
  const directory = path.join(root, '.eda-state/runs');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter(n => n.endsWith('.json')).map(n => {
    const value = JSON.parse(fs.readFileSync(path.join(directory, n), 'utf8'));
    return { ...value, owner_alive: pidAlive(value.pid) };
  }).sort((a, b) => b.created_at.localeCompare(a.created_at));
}
function childStatus(root, directory) {
  const artifacts = fs.realpathSync(path.join(root, 'artifacts'));
  const dir = fs.realpathSync(directory);
  const relative = path.relative(artifacts, dir);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Run directory outside artifacts');
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'run.json'), 'utf8'));
  return { manifest, alive: manifest.processes.some(p => p.ended_at == null && pidAlive(p.pid) !== false) ||
    (manifest.owned_backend_pid != null && pidAlive(manifest.owned_backend_pid) !== false) };
}
function publishGuardDirectory(candidate, guard, owner) {
  if (process.platform !== 'win32') { fs.renameSync(candidate, guard); return; }
  // Node's Windows rename uses replacement semantics, including directory over file.
  // Directory.Move rejects every existing destination. Paths are data, never shell code.
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR;
  const powershell = systemRoot ? path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe') : 'powershell.exe';
  const result = childProcess.spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command',
    'try { [System.IO.Directory]::Move($env:EDA_GUARD_CANDIDATE, $env:EDA_GUARD_DESTINATION); exit 0 } catch { $failure = $_.Exception; while ($null -ne $failure.InnerException) { $failure = $failure.InnerException }; $nativeCode = $failure.HResult -band 65535; [Console]::Error.WriteLine(([pscustomobject]@{ type = $failure.GetType().FullName; native_code = $nativeCode } | ConvertTo-Json -Compress)); if ($nativeCode -eq 183 -or $nativeCode -eq 80) { exit 17 }; exit 18 }'],
  { env: { ...process.env, EDA_GUARD_CANDIDATE: path.resolve(candidate), EDA_GUARD_DESTINATION: path.resolve(guard) },
    windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 8192, stdio: ['ignore', 'ignore', 'pipe'] });
  if (result.status === 0) return;
  // The helper may move successfully and then die before reporting success.
  // Recover only our exact published token, preventing an orphan owned by this live Node process.
  try {
    const info = fs.lstatSync(guard), name = `owner.${owner.token}.json`;
    if (!fs.existsSync(candidate) && info.isDirectory() && !info.isSymbolicLink() && fs.readdirSync(guard).length === 1) {
      const current = JSON.parse(fs.readFileSync(path.join(guard, name), 'utf8'));
      if (current.token === owner.token && current.pid === owner.pid && current.schema_version === 1) return;
    }
  } catch { /* An unproven publication remains a failure. */ }
  if (result.error) throw result.error;
  if (result.status === 17) throw Object.assign(new Error('Reconcile guard destination already exists'), { code: 'EEXIST' });
  throw Object.assign(new Error(`Reconcile guard publication failed (exit ${result.status}): ${String(result.stderr ?? '').trim()}`), { code: 'RECONCILE_PUBLISH_FAILED' });
}

// A nonempty directory prevents a delayed reaper from removing a newly published guard.
export function acquireReconcileGuard(root) {
  const locks = path.join(root, '.eda-state/locks');
  fs.mkdirSync(locks, { recursive: true });
  const guard = path.join(locks, 'reconcile.lock');
  const token = randomUUID();
  const ownerName = `owner.${token}.json`;
  const candidate = path.join(locks, `.reconcile-candidate.${token}`);
  fs.mkdirSync(candidate);
  const owner = { schema_version: 1, token, pid: process.pid, created_at: new Date().toISOString() };
  const fd = fs.openSync(path.join(candidate, ownerName), 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(owner)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const recovered = [];
  let published = false;
  const removeEmptyShell = () => {
    try { fs.rmdirSync(guard); }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST', 'EACCES', 'EPERM'].includes(error.code)) throw error; }
  };
  try {
    for (let attempt = 0; attempt < 20; attempt++) {
      // Refuse existing legacy/unknown entries. Exclusive publication also protects
      // against one appearing after this check.
      let stat;
      try { stat = fs.lstatSync(guard); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (stat && (!stat.isDirectory() || stat.isSymbolicLink())) throw Object.assign(new Error('Legacy, linked or unknown reconcile guard retained; owner cannot be proven dead'), { code: 'RECONCILE_GUARD_UNKNOWN' });
      if (!stat) {
        try { publishGuardDirectory(candidate, guard, owner); published = true; }
        catch (error) { if (!['EEXIST', 'ENOTEMPTY', 'ENOTDIR', 'EISDIR'].includes(error.code)) throw error; }
      }
      if (published) {
        let released = false;
        return { token, guard, recovered, release() {
          if (released) return;
          const info = fs.lstatSync(guard);
          if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Reconcile guard replaced; refusing release');
          const file = path.join(guard, ownerName);
          const current = JSON.parse(fs.readFileSync(file, 'utf8'));
          if (current.token !== token || current.pid !== process.pid) throw new Error('Reconcile guard ownership changed; refusing release');
          fs.unlinkSync(file); released = true;
          removeEmptyShell();
        } };
      }
      try { stat = fs.lstatSync(guard); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw Object.assign(new Error('Legacy, linked or unknown reconcile guard retained; owner cannot be proven dead'), { code: 'RECONCILE_GUARD_UNKNOWN' });
      const names = fs.readdirSync(guard);
      if (!names.length) { removeEmptyShell(); continue; } // New protocol publishes only nonempty directories.
      if (names.length !== 1 || !/^owner\.[a-f0-9-]{36}\.json$/.test(names[0])) throw Object.assign(new Error('Malformed reconcile guard retained'), { code: 'RECONCILE_GUARD_UNKNOWN' });
      const ownerFile = path.join(guard, names[0]);
      let previous;
      try { previous = JSON.parse(fs.readFileSync(ownerFile, 'utf8')); }
      catch (error) { if (error.code === 'ENOENT') continue; throw Object.assign(new Error('Unreadable reconcile owner retained'), { code: 'RECONCILE_GUARD_UNKNOWN' }); }
      if (previous.schema_version !== 1 || names[0] !== `owner.${previous.token}.json` || !Number.isInteger(previous.pid) || previous.pid <= 0) throw Object.assign(new Error('Invalid reconcile owner retained'), { code: 'RECONCILE_GUARD_UNKNOWN' });
      if (pidAlive(previous.pid) !== false) throw Object.assign(new Error('Reconcile owner is alive or unknown; guard retained'), { code: 'RECONCILE_BUSY' });
      const archive = path.join(root, '.eda-state/recovered', `reconcile-${previous.token}-${randomUUID()}.json`);
      fs.mkdirSync(path.dirname(archive), { recursive: true });
      // Move only the observed token file. Never rename or recursively delete the shared guard path.
      try { fs.renameSync(ownerFile, archive); recovered.push({ action: 'guard_recovered', token: previous.token, archive, pid: previous.pid }); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      removeEmptyShell();
    }
    throw Object.assign(new Error('Reconcile guard publication is busy; retry after the current reconciler finishes'), { code: 'RECONCILE_BUSY' });
  } finally {
    if (!published && fs.existsSync(candidate)) { fs.unlinkSync(path.join(candidate, ownerName)); fs.rmdirSync(candidate); }
  }
}

// Explicit recovery never reruns jobs or kills a process. Unknown ownership is retained.
export function reconcileRuns(root) {
  const locks = path.join(root, '.eda-state/locks');
  fs.mkdirSync(locks, { recursive: true });
  const guard = acquireReconcileGuard(root);
  const results = [...guard.recovered];
  try {
    for (const name of fs.readdirSync(locks).filter(n => /^(xsim|vivado|ltspice|verify)-\d+\.json$/.test(n))) {
      const file = path.join(locks, name);
      try {
        const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (pidAlive(owner.pid) !== false) { results.push({ file: name, action: 'retained', reason: 'owner alive or unknown' }); continue; }
        const { manifest, alive } = childStatus(root, owner.directory);
        if (alive) { results.push({ file: name, action: 'retained', reason: 'child alive or unknown' }); continue; }
        const archive = path.join(root, '.eda-state/recovered', `${Date.now()}-${randomUUID()}-${name}`);
        fs.mkdirSync(path.dirname(archive), { recursive: true }); fs.renameSync(file, archive);
        results.push({ file: name, action: 'recovered', archive, run_id: manifest.run_id });
      } catch (error) { results.push({ file: name, action: 'retained', reason: String(error) }); }
    }
    for (const run of listRuns(root)) {
      if (terminalStates.has(run.status) || run.owner_alive !== false) continue;
      try {
        const { manifest, alive } = childStatus(root, run.directory);
        if (alive) continue;
        const status = terminalStates.has(manifest.status) ? manifest.status : 'interrupted';
        delete run.owner_alive;
        save(path.join(root, '.eda-state/runs', `${run.run_id}.json`), { ...run, status, reconciled_at: new Date().toISOString(), recovery_note: 'Owner and recorded child processes are absent; original trace retained.' });
        results.push({ run_id: run.run_id, action: 'state_reconciled', status });
      } catch (error) { results.push({ run_id: run.run_id, action: 'retained', reason: String(error) }); }
    }
  } finally { guard.release(); }
  return results;
}
