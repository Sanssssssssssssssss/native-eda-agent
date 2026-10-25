import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {getProject} from './workbench-projects.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonHash = value => hash(JSON.stringify(value));
const fail = (message, statusCode = 400) => { throw Object.assign(new Error(message), {statusCode}); };
const maxFile = 1024 * 1024, maxProject = 16 * 1024 * 1024;
const linesOf = text => text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g)?.filter(Boolean) || [];
const decoder = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true});
const relative = value => typeof value === 'string' && value.length < 400 && !/[\\:\x00-\x1f]/.test(value) && !path.posix.isAbsolute(value) && value.split('/').every(p => p && p !== '.' && p !== '..' && !p.startsWith('.'));
function within(base, name) {
  if (!relative(name)) fail('Invalid project-relative path', 403);
  const baseReal = fs.realpathSync(base), target = path.join(baseReal, name);
  let current = baseReal;
  for (const component of name.split('/')) {
    current = path.join(current, component);
    if (fs.lstatSync(current).isSymbolicLink()) fail('Linked files are outside a modification scope', 403);
  }
  const rel = path.relative(baseReal, fs.realpathSync(target));
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) fail('Path outside modification scope', 403);
  return target;
}
function directory(root, name) {
  const base = fs.realpathSync(root), target = path.join(base, name);
  fs.mkdirSync(target, {recursive: true});
  if (fs.lstatSync(target).isSymbolicLink() || fs.realpathSync(target) !== target) fail('Linked storage is not supported', 403);
  return target;
}
function storeRoot(root) {
  const state = directory(root, '.eda-state');
  return directory(state, 'workbench-changes');
}
function checkedId(id) { if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/.test(id)) fail('Invalid change identifier'); return id; }
function changeDir(root, id) { return within(storeRoot(root), checkedId(id)); }
function save(root, value) {
  const dir = changeDir(root, value.id), file = path.join(dir, 'change.json'), temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx');
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, file);
  return value;
}
function withLock(root, id, action) {
  const lock = path.join(changeDir(root, id), 'write.lock');
  let fd;
  try { fd = fs.openSync(lock, 'wx'); } catch (error) { if (error.code === 'EEXIST') fail('This change has an unfinished write; inspect it before retrying', 409); throw error; }
  try { fs.writeFileSync(fd, JSON.stringify({pid: process.pid, at: new Date().toISOString()})); return action(); }
  finally { fs.closeSync(fd); fs.unlinkSync(lock); }
}
export function getChange(root, id) {
  const file = within(changeDir(root, id), 'change.json');
  if (fs.statSync(file).size > 512 * 1024) fail('Change record exceeds size limit', 413);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function listChanges(root, projectId) {
  return {changes: fs.readdirSync(storeRoot(root), {withFileTypes: true}).filter(e => e.isDirectory() && !e.isSymbolicLink() && /^[0-9a-f-]{36}$/.test(e.name)).flatMap(e => {
    try { const c = getChange(root, e.name); return !projectId || c.project_id === projectId ? [{id: c.id, project_id: c.project_id, goal: c.goal, status: c.status, created_at: c.created_at, session_id: c.session_id, candidate: c.candidate, files: c.scope.map(s => s.path)}] : []; } catch { return []; }
  }).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100)};
}
function projectSnapshot(root, projectId) {
  const project = getProject(root, projectId);
  if (project.truncated || project.files.length > 512) fail('Project inventory is incomplete or exceeds 512 files; narrow the project first', 413);
  within(root, project.publicPath);
  const files = [], bytesByPath = new Map();
  let total = 0;
  for (const file of project.files) {
    if (!relative(file.path)) fail('Invalid inventory path', 403);
    const source = within(root, file.publicPath), stat = fs.statSync(source);
    if (!stat.isFile() || stat.size > maxFile || (total += stat.size) > maxProject) fail('Scoped candidates require files <= 1 MiB and project <= 16 MiB', 413);
    const bytes = fs.readFileSync(source);
    files.push({path: file.path, source_path: file.publicPath, kind: file.kind, dependency: Boolean(file.dependency), editable: file.editable === true && !file.dependency, sha256: hash(bytes), bytes: bytes.length});
    bytesByPath.set(file.path, bytes);
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  return {project, files, bytesByPath, digest: jsonHash(files.map(({path, source_path, sha256}) => ({path, source_path, sha256})))};
}
function baseline(root, change) {
  const current = projectSnapshot(root, change.project_id);
  if (current.project.publicPath !== change.project_path || current.digest !== change.base_digest) fail('Project inputs changed after scope selection; create a new change plan', 409);
  return current;
}
export function planChange(root, data) {
  if (typeof data.goal !== 'string' || !data.goal.trim() || data.goal.length > 2000) fail('Describe the modification goal in 1–2000 characters');
  if (!Array.isArray(data.selections) || !data.selections.length || data.selections.length > 8) fail('Select 1–8 RTL files and explicit line ranges');
  const current = projectSnapshot(root, data.project_id), seen = new Set();
  const scope = data.selections.map(selection => {
    if (seen.has(selection.path)) fail('Use one continuous range per file'); seen.add(selection.path);
    const file = current.files.find(f => f.path === selection.path);
    if (!file?.editable || !/\.(v|sv|vh|svh|vhd|vhdl)$/i.test(file.path) || /(^|[\/_.-])(tb|test|testbench|tests|sim)([\/_.-]|$)/i.test(file.path)) fail('Only editable RTL is allowed; testbenches, constraints and other project files are protected', 403);
    if (typeof selection.sha256 !== 'string' || selection.sha256 !== file.sha256) fail('Source changed since preview; reopen it and select the line range again', 409);
    const bytes = current.bytesByPath.get(file.path), text = decoder.decode(bytes);
    if (text.includes('\0')) fail('Binary content is not editable');
    const lines = linesOf(text), start = selection.start_line, end = selection.end_line;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > lines.length) fail('Select an existing inclusive line range');
    const before = lines.slice(start - 1, end).join('');
    if (Buffer.byteLength(before) > 16384) fail('A selected range may contain at most 16 KiB', 413);
    return {path: file.path, start_line: start, end_line: end, sha256: file.sha256, before};
  });
  const id = randomUUID(), dir = path.join(storeRoot(root), id); fs.mkdirSync(dir);
  const snapshots = path.join(dir, 'inputs'); fs.mkdirSync(snapshots);
  for (const file of current.files) {
    const target = path.join(snapshots, file.path); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, current.bytesByPath.get(file.path), {flag: 'wx'});
  }
  const value = {schema_version: 1, id, project_id: data.project_id, project_path: current.project.publicPath, session_id: data.session_id || null,
    goal: data.goal.trim(), status: 'planned', created_at: new Date().toISOString(), scope, base_digest: current.digest, inputs: current.files,
    protected_files: current.files.filter(f => !seen.has(f.path)).map(({path, kind, sha256}) => ({path, kind, sha256})),
    validation: {status: 'not_run', engineering: 'not_run'}, inventory_scope: current.project.inventory_scope,
    boundary: 'Only the enumerated source, test and constraint files are captured. Changes are restricted to selected line ranges and written to a separate candidate; original files remain unchanged. External dependencies are copied as read-only inputs. This source candidate is not a standalone runnable project; engineering validation has not run.'};
  return save(root, value);
}
function readSnapshots(root, change) {
  const dir = within(changeDir(root, change.id), 'inputs'), files = new Map();
  for (const input of change.inputs) {
    const source = within(dir, input.path);
    if (fs.statSync(source).size > maxFile) fail('Input snapshot exceeds limit', 413);
    const bytes = fs.readFileSync(source);
    if (hash(bytes) !== input.sha256) fail('Frozen input snapshot is damaged; create a new plan', 409);
    files.set(input.path, bytes);
  }
  return files;
}
function previewContract(change, edits, originals) {
  if (!Array.isArray(edits) || edits.length !== change.scope.length || new Set(edits.map(e => e.path)).size !== edits.length) fail('Provide one replacement for each selected RTL range');
  const diff = [], outputs = new Map(originals); let changed = false;
  for (const scope of change.scope) {
    const edit = edits.find(e => e.path === scope.path);
    if (!edit || typeof edit.replacement !== 'string' || Buffer.byteLength(edit.replacement) > 16384 || edit.replacement.includes('\0')) fail('Invalid replacement or path outside selected scope');
    const original = decoder.decode(originals.get(scope.path)), lines = linesOf(original), before = lines.slice(scope.start_line - 1, scope.end_line).join('');
    if (before !== scope.before) fail('Saved line scope does not match its input snapshot', 409);
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    let after = edit.replacement.replace(/\r\n|\r|\n/g, eol);
    // Preserve the boundary between the selected range and the first protected following line.
    if (scope.end_line < lines.length && after && !/[\r\n]$/.test(after)) after += eol;
    const result = lines.slice(0, scope.start_line - 1).join('') + after + lines.slice(scope.end_line).join('');
    if (Buffer.byteLength(result) > maxFile) fail('Replacement would exceed the 1 MiB candidate file limit', 413);
    outputs.set(scope.path, Buffer.from(result)); changed ||= result !== original;
    diff.push({...scope, after, added_lines: linesOf(after).length, removed_lines: linesOf(before).length, candidate_sha256: hash(Buffer.from(result))});
  }
  if ([...outputs.values()].reduce((total, bytes) => total + bytes.length, 0) > maxProject) fail('Replacement would exceed the 16 MiB candidate limit', 413);
  if (!changed) fail('The proposed replacement does not change any selected RTL');
  return {diff, outputs, preview_digest: jsonHash({base_digest: change.base_digest, scope: change.scope, diff})};
}
export function previewChange(root, data) {
  return withLock(root, data.id, () => {
    const change = getChange(root, data.id);
    if (!['planned', 'previewed'].includes(change.status)) fail('This change already has a candidate; create a new plan', 409);
    baseline(root, change);
    const {diff, preview_digest} = previewContract(change, data.edits, readSnapshots(root, change));
    return save(root, {...change, status: 'previewed', diff, preview_digest, checks: {scope: true, baseline: true, protected: true}, updated_at: new Date().toISOString()});
  });
}
export function applyChange(root, data) {
  return withLock(root, data.id, () => {
    const change = getChange(root, data.id);
    if (change.status !== 'previewed' || data.preview_digest !== change.preview_digest) fail('Preview the current edits before creating a candidate', 409);
    baseline(root, change);
    const {outputs, preview_digest} = previewContract(change, change.diff.map(d => ({path: d.path, replacement: d.after})), readSnapshots(root, change));
    if (preview_digest !== change.preview_digest) fail('The saved preview changed; review it again', 409);
    const artifactBase = directory(root, 'artifacts'), runId = `scoped-change-${change.id}`, dir = path.join(artifactBase, runId);
    // Exclusive creation makes a second apply fail closed, including a crash after the first write.
    fs.mkdirSync(dir);
    const candidate = path.join(dir, 'candidate'); fs.mkdirSync(candidate);
    const files = [];
    for (const input of change.inputs) {
      const target = path.join(candidate, input.path), bytes = outputs.get(input.path);
      fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, bytes, {flag: 'wx'});
      files.push({path: input.path, sha256: hash(bytes), baseline_sha256: input.sha256, changed: hash(bytes) !== input.sha256});
    }
    const manifest = {schema_version: 1, change_id: change.id, project_id: change.project_id, project_path: change.project_path, base_digest: change.base_digest,
      preview_digest, scope: change.scope, files, inventory_scope: change.inventory_scope, boundary: change.boundary,
      status: 'candidate_created', engineering_validation: 'not_run', created_at: new Date().toISOString()};
    fs.writeFileSync(path.join(dir, 'candidate-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', {flag: 'wx'});
    const result = {...change, status: 'candidate_created', candidate: {directory: `artifacts/${runId}/candidate`, manifest: `artifacts/${runId}/candidate-manifest.json`, manifest_sha256: hash(fs.readFileSync(path.join(dir, 'candidate-manifest.json'))), files}, updated_at: new Date().toISOString()};
    // Current source drift remains explicit even when another process changes the original during copying.
    result.checks = {scope: true, protected: files.filter(f => !change.scope.some(s => s.path === f.path)).every(f => f.sha256 === f.baseline_sha256), baseline: true};
    try { baseline(root, change); } catch { result.checks.baseline = false; }
    return save(root, result);
  });
}
export function checkChange(root, id) {
  const change = getChange(root, id), issues = []; let baseline_current = true, snapshot_integrity = true, candidate_integrity = null;
  try { baseline(root, change); } catch (error) { baseline_current = false; issues.push(error.message); }
  try { readSnapshots(root, change); } catch (error) { snapshot_integrity = false; issues.push(error.message); }
  if (change.candidate) {
    candidate_integrity = true;
    try {
      const manifest = within(root, change.candidate.manifest);
      if (hash(fs.readFileSync(manifest)) !== change.candidate.manifest_sha256) throw new Error('Candidate manifest changed');
      const base = within(root, change.candidate.directory), expected = new Set(change.candidate.files.map(f => f.path));
      const walk = (dir, prefix = '') => {
        for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
          const name = prefix ? `${prefix}/${entry.name}` : entry.name;
          if (entry.isSymbolicLink()) throw new Error('Candidate contains a linked file');
          if (entry.isDirectory()) walk(path.join(dir, entry.name), name);
          else if (!expected.has(name)) throw new Error('Candidate contains an unreviewed file');
        }
      }; walk(base);
      for (const file of change.candidate.files) {
        const source = within(base, file.path);
        if (fs.statSync(source).size > maxFile || hash(fs.readFileSync(source)) !== file.sha256) throw new Error(`Candidate changed: ${file.path}`);
      }
    } catch (error) { candidate_integrity = false; issues.push(error.message); }
  }
  return {...change, baseline_current, snapshot_integrity, candidate_integrity, issues, engineering_validation: 'not_run'};
}
