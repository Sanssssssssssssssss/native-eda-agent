import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {listProjects} from '../src/workbench-projects.mjs';
import {planChange, previewChange, applyChange, checkChange, getChange} from '../src/workbench-changes.mjs';
import {createWorkbench} from '../src/workbench.mjs';

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'eda-scope-'));
  const source = 'module top(input wire a, output wire y);\r\n  assign y = a;\r\nendmodule\r\n';
  const write = (name, data) => {const file = path.join(root, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, data); return file;};
  write('projects/demo/rtl/top.v', source);
  write('projects/demo/tb/top_tb.sv', 'module top_tb; initial $finish; endmodule\n');
  write('projects/demo/constraints/top.xdc', 'create_clock -period 10 [get_ports clk]\n');
  write('projects/demo/README.md', 'A scoped change fixture.');
  t.after(() => {
    const resolved = fs.realpathSync(root); assert.equal(path.dirname(resolved), parent); assert.ok(path.basename(resolved).startsWith('eda-scope-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  });
  const project = listProjects(root).projects.find(p => p.publicPath === 'projects/demo');
  assert.ok(project, 'fixture project discovered');
  const sourceHash = () => createHash('sha256').update(fs.readFileSync(path.join(root, 'projects/demo/rtl/top.v'))).digest('hex');
  const plan = () => planChange(root, {project_id: project.id, goal: 'Invert the output in the implementation line', selections: [{path: 'rtl/top.v', start_line: 2, end_line: 2, sha256: sourceHash()}]});
  const preview = id => previewChange(root, {id, edits: [{path: 'rtl/top.v', replacement: '  assign y = ~a;'}]});
  return {root, project, source, sourceHash, write, plan, preview};
}

test('scoped candidate preserves original, protected inputs, unselected lines and CRLF; verification stays unrun', t => {
  const f = fixture(t), plan = f.plan();
  assert.equal(plan.status, 'planned');
  assert.ok(plan.protected_files.some(p => p.path.endsWith('.xdc')));
  const preview = f.preview(plan.id);
  assert.equal(preview.diff[0].after, '  assign y = ~a;\r\n');
  const result = applyChange(f.root, {id: plan.id, preview_digest: preview.preview_digest});
  assert.equal(result.status, 'candidate_created');
  assert.equal(fs.readFileSync(path.join(f.root, 'projects/demo/rtl/top.v'), 'utf8'), f.source);
  assert.equal(fs.readFileSync(path.join(f.root, result.candidate.directory, 'rtl/top.v'), 'utf8'), f.source.replace('= a;', '= ~a;'));
  assert.deepEqual(fs.readFileSync(path.join(f.root, result.candidate.directory, 'constraints/top.xdc')), fs.readFileSync(path.join(f.root, 'projects/demo/constraints/top.xdc')));
  assert.equal(result.validation.engineering, 'not_run');
  assert.equal(checkChange(f.root, plan.id).candidate_integrity, true);
  assert.equal(getChange(f.root, plan.id).preview_digest, preview.preview_digest);
  assert.throws(() => applyChange(f.root, {id: plan.id, preview_digest: preview.preview_digest}), e => e.statusCode === 409);
});

test('scope rejects protected files, traversal, invalid ranges and edits outside the selected file', t => {
  const f = fixture(t);
  for (const file of ['tb/top_tb.sv', 'constraints/top.xdc', '../outside.v', 'rtl/top.v:stream']) {
    assert.throws(() => planChange(f.root, {project_id: f.project.id, goal: 'Change', selections: [{path: file, start_line: 1, end_line: 1}]}));
  }
  assert.throws(() => planChange(f.root, {project_id: f.project.id, goal: 'Change', selections: [{path: 'rtl/top.v', start_line: 2, end_line: 4, sha256: f.sourceHash()}]}), /line range/);
  const plan = f.plan();
  assert.throws(() => previewChange(f.root, {id: plan.id, edits: [{path: 'tb/top_tb.sv', replacement: 'weaken checker'}]}), /scope/);
  assert.throws(() => previewChange(f.root, {id: plan.id, edits: [{path: 'rtl/top.v', replacement: plan.scope[0].before}]}), /does not change/);
});

test('changing an unselected constraint invalidates a frozen scope and cannot produce a candidate', t => {
  const f = fixture(t), plan = f.plan(), preview = f.preview(plan.id);
  f.write('projects/demo/constraints/top.xdc', 'create_clock -period 100 [get_ports clk]\n');
  assert.throws(() => applyChange(f.root, {id: plan.id, preview_digest: preview.preview_digest}), e => e.statusCode === 409);
  assert.equal(checkChange(f.root, plan.id).baseline_current, false);
  assert.equal(fs.existsSync(path.join(f.root, 'artifacts', `scoped-change-${plan.id}`)), false);
});

test('adding a new project source or revising a preview invalidates the old reviewed digest', t => {
  const f = fixture(t), plan = f.plan(), first = f.preview(plan.id);
  const next = previewChange(f.root, {id: plan.id, edits: [{path: 'rtl/top.v', replacement: "  assign y = 1'b0;"}]});
  assert.notEqual(first.preview_digest, next.preview_digest);
  assert.throws(() => applyChange(f.root, {id: plan.id, preview_digest: first.preview_digest}), e => e.statusCode === 409);
  f.write('projects/demo/rtl/new.v', 'module new_module; endmodule');
  assert.throws(() => applyChange(f.root, {id: plan.id, preview_digest: next.preview_digest}), e => e.statusCode === 409);
});

test('tampered snapshots, candidate files, added files and manifest fail integrity checks', t => {
  const f = fixture(t), plan = f.plan(), preview = f.preview(plan.id);
  const snapshot = path.join(f.root, '.eda-state/workbench-changes', plan.id, 'inputs/rtl/top.v');
  fs.writeFileSync(snapshot, 'module damaged; endmodule');
  assert.throws(() => applyChange(f.root, {id: plan.id, preview_digest: preview.preview_digest}), /snapshot/);
  assert.equal(checkChange(f.root, plan.id).snapshot_integrity, false);
  const clean = f.plan(), checked = f.preview(clean.id), candidate = applyChange(f.root, {id: clean.id, preview_digest: checked.preview_digest});
  const rtl = path.join(f.root, candidate.candidate.directory, 'rtl/top.v');
  fs.appendFileSync(rtl, '// unreviewed');
  assert.equal(checkChange(f.root, clean.id).candidate_integrity, false);
  const extra = path.join(f.root, candidate.candidate.directory, 'extra.v'); fs.writeFileSync(extra, 'module extra; endmodule');
  assert.ok(checkChange(f.root, clean.id).issues.some(s => s.includes('unreviewed')));
});

test('line-range deletion preserves following protected text and a linked output storage is refused', t => {
  const f = fixture(t), plan = f.plan();
  const preview = previewChange(f.root, {id: plan.id, edits: [{path: 'rtl/top.v', replacement: ''}]});
  const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(f.root, 'artifacts'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => applyChange(f.root, {id: plan.id, preview_digest: preview.preview_digest}), /Linked storage/);
  assert.deepEqual(fs.readdirSync(outside), []);
  assert.equal(preview.diff[0].after, '');
});

test('HTTP routes bind change to session and enforce origin, then return a persisted candidate', async t => {
  const f = fixture(t), app = createWorkbench(f.root, new Map());
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => app.close());
  const origin = `http://127.0.0.1:${app.server.address().port}`;
  const post = (route, value, requestOrigin = origin) => fetch(origin + route, {method: 'POST', headers: {'Content-Type': 'application/json', Origin: requestOrigin}, body: JSON.stringify(value)});
  const session = await (await post('/api/session', {action: 'create', title: 'Scoped RTL change'})).json();
  const sessionId = session.id;
  const data = {action: 'plan', session_id: sessionId, project_id: f.project.id, goal: 'Invert output', selections: [{path: 'rtl/top.v', start_line: 2, end_line: 2, sha256: f.sourceHash()}]};
  assert.equal((await post('/api/changes', data, 'http://foreign.invalid')).status, 403);
  const response = await post('/api/changes', data); assert.equal(response.status, 200);
  const plan = await response.json();
  const other = await (await post('/api/session', {action: 'create', title: 'Another session'})).json();
  assert.equal((await post('/api/changes', {action: 'preview', id: plan.id, session_id: other.id, edits: []})).status, 409);
  const preview = await (await post('/api/changes', {action: 'preview', id: plan.id, edits: [{path: 'rtl/top.v', replacement: '  assign y = ~a;'}]})).json();
  const result = await (await post('/api/changes', {action: 'apply', id: plan.id, preview_digest: preview.preview_digest})).json();
  assert.equal(result.status, 'candidate_created');
  const stored = await (await fetch(origin + `/api/change?id=${plan.id}`)).json();
  assert.equal(stored.candidate.manifest_sha256, createHash('sha256').update(fs.readFileSync(path.join(f.root, stored.candidate.manifest))).digest('hex'));
  const savedSession = await (await fetch(origin + `/api/session?id=${sessionId}`)).json();
  assert.equal(savedSession.messages.find(m => m.role === 'change').change_id, plan.id);
});

test('source hash binds the selected lines, and oversize candidate content is rejected before writing', t => {
  const f = fixture(t), oldHash = f.sourceHash();
  f.write('projects/demo/rtl/top.v', '// inserted line\n' + f.source);
  assert.throws(() => planChange(f.root, {project_id: f.project.id, goal: 'Change', selections: [{path: 'rtl/top.v', start_line: 2, end_line: 2, sha256: oldHash}]}), e => e.statusCode === 409);
  const prefix = 'module top;\nwire y;\n//';
  f.write('projects/demo/rtl/top.v', prefix + 'x'.repeat(1024 * 1024 - Buffer.byteLength(prefix)));
  const plan = f.plan();
  assert.throws(() => f.preview(plan.id), e => e.statusCode === 413);
  assert.equal(getChange(f.root, plan.id).status, 'planned');
});
