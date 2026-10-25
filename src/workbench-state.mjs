import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {pidAlive} from './runtime.mjs';

export const activeJobStates = new Set(['queued', 'running', 'cancel_requested']);
export const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9._-]{1,200}$/.test(value) && !['.', '..'].includes(value);
export const now = () => new Date().toISOString();
export function contained(base, id) {
  if (!safeId(id)) throw new Error('Invalid workspace identifier');
  const target = fs.realpathSync(path.join(base, id));
  const rel = path.relative(fs.realpathSync(base), target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Path outside workspace');
  return target;
}
export const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8'));
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  const temp = `${file}.${randomUUID()}.tmp`, fd = fs.openSync(temp, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
}
function conflict(message) { return Object.assign(new Error(message), {statusCode: 409}); }

// Session leases guard all writes, including a task's entire execution. A live owner is never stolen.
export function createWorkbenchState(root) {
  const bases = Object.fromEntries(['sessions', 'tasks', 'jobs'].map(kind => {
    const base = path.join(root, '.eda-state', `workbench-${kind}`);
    fs.mkdirSync(base, {recursive: true}); return [kind, base];
  }));
  const ownLeases = new Map(), subscribers = new Set();
  const file = (kind, id, existing = true) => path.join(existing ? contained(bases[kind], id) : path.join(bases[kind], id), `${kind.slice(0, -1)}.json`);
  const get = (kind, id) => readJson(file(kind, id));
  const save = (kind, value) => { if (!safeId(value.id)) throw new Error('Invalid identifier'); writeJson(file(kind, value.id, false), value); return value; };
  const list = kind => fs.readdirSync(bases[kind], {withFileTypes: true}).filter(e => e.isDirectory() && !e.isSymbolicLink()).flatMap(e => {
    try { return [get(kind, e.name)]; } catch { return []; }
  });
  function acquire(id) {
    if (ownLeases.has(id)) throw conflict('This session has an unfinished request; wait before sending another message');
    const lock = path.join(contained(bases.sessions, id), 'request.lock');
    const owner = {pid: process.pid, token: randomUUID(), created_at: now()};
    let fd;
    try { fd = fs.openSync(lock, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      let previous; try { previous = readJson(lock); } catch { throw conflict('Session lock ownership is unknown'); }
      if (pidAlive(previous.pid) !== false) throw conflict('This session has an unfinished request owned by another worker');
      // Only a proven dead owner can be removed. Never remove a replacement lease.
      if (readJson(lock).token !== previous.token) throw conflict('Session ownership changed');
      fs.unlinkSync(lock); fd = fs.openSync(lock, 'wx');
    }
    try { fs.writeFileSync(fd, JSON.stringify(owner)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    ownLeases.set(id, owner.token);
    let released = false;
    return () => {
      if (released) return;
      if (readJson(lock).token !== owner.token) throw new Error('Session lease ownership changed');
      fs.unlinkSync(lock); ownLeases.delete(id); released = true;
    };
  }
  function createSession(title = '新会话') {
    const s = {schema_version: 2, id: randomUUID(), title, mode: 'local_context', archived: false,
      created_at: now(), updated_at: now(), messages: [], task_ids: [], event_sequence: 0};
    return save('sessions', s);
  }
  function emit(id, type, fields = {}) {
    if (!id) return null;
    const s = get('sessions', id), log = path.join(contained(bases.sessions, id), 'events.jsonl');
    const journal = fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
    const previous = journal.split(/\r?\n/).filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line).sequence || 0]; } catch { return []; }
    }).reduce((a, b) => Math.max(a, b), 0);
    const event = {...fields, sequence: Math.max(s.event_sequence || 0, previous) + 1, type, at: now(), session_id: id};
    const fd = fs.openSync(log, 'a');
    try { fs.writeFileSync(fd, (journal && !journal.endsWith('\n') ? '\n' : '') + JSON.stringify(event) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    s.event_sequence = event.sequence; s.updated_at = event.at; save('sessions', s);
    for (const subscriber of subscribers) subscriber(event);
    return event;
  }
  function events(id, after = 0) {
    const dir = contained(bases.sessions, id), log = path.join(dir, 'events.jsonl');
    const rows = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split(/\r?\n/).filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    }) : [];
    const filtered = rows.filter(e => e.sequence > after).slice(0, 500);
    return {events: filtered, last_sequence: filtered.at(-1)?.sequence ?? after, has_more: rows.some(e => e.sequence > (filtered.at(-1)?.sequence ?? after))};
  }
  function appendMessage(id, message) {
    const s = get('sessions', id); s.messages ||= [];
    if (s.messages.length >= 1000) throw new Error('Session message limit reached; create a new session');
    const value = {id: randomUUID(), at: now(), ...message};
    s.messages.push(value); s.updated_at = value.at; save('sessions', s);
    emit(id, 'message', {message: value}); return value;
  }
  function session(id, {privateFields = false} = {}) {
    const s = get('sessions', id);
    const result = {...s, archived: Boolean(s.archived), tasks: (s.task_ids || []).flatMap(taskId => { try { return [get('tasks', taskId)]; } catch { return []; } })};
    if (!privateFields) delete result.native_session_file;
    return result;
  }
  return {bases, get, save, list, acquire, createSession, emit, events, appendMessage, session,
    subscribe(listener) { subscribers.add(listener); return () => subscribers.delete(listener); }};
}
