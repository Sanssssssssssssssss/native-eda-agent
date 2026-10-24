import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { checkReplay } from '../scripts/replay-experiment.mjs';
import { createTrace } from '../src/trace.mjs';

const evidence = path.resolve(import.meta.dirname, '../artifacts', `replay-tests-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`);
fs.mkdirSync(evidence, { recursive: true });

test('rejects changed sources, altered snapshots, unresolved inputs and traversal', () => {
  const root = path.join(evidence, 'legacy'); fs.mkdirSync(root);
    const run = path.join(root, 'run'); fs.mkdirSync(run);
    fs.writeFileSync(path.join(root, 'input.sv'), 'original');
    fs.writeFileSync(path.join(run, 'input.sv'), 'original');
    const manifest = { schema_version: 1, tool: 'eda_xsim', arguments: {sources: ['input.sv'], top: 'tb'}, workspace: root, status: 'completed', inputs: [
      { relative_path: 'input.sv', snapshot: 'input.sv', sha256: createHash('sha256').update('original').digest('hex') },
    ] };
    const file = path.join(run, 'run.json');
    const save = () => fs.writeFileSync(file, JSON.stringify(manifest));
    save(); assert.equal(checkReplay(file, root).ready, true);
    const savedArgs = manifest.arguments; delete manifest.arguments; save();
    assert.match(checkReplay(file, root).issues.join(' '), /Missing or invalid tool arguments/);
    manifest.arguments = savedArgs; save();
    fs.writeFileSync(path.join(root, 'input.sv'), 'changed');
    assert.match(checkReplay(file, root).issues.join(' '), /current input differs/);
    fs.writeFileSync(path.join(root, 'input.sv'), 'original');
    fs.writeFileSync(path.join(run, 'input.sv'), 'changed');
    assert.match(checkReplay(file, root).issues.join(' '), /snapshot differs/);
    manifest.unresolved_dependencies = ['dynamic']; save();
    assert.match(checkReplay(file, root).issues.join(' '), /unresolved dependencies/);
    manifest.inputs[0].snapshot = '../../outside'; save();
    assert.match(checkReplay(file, root).issues.join(' '), /Unsafe snapshot/);
});

test('new content-addressed manifest replays only while both snapshot and object are verified', () => {
  for (const fault of ['missing', 'tampered']) {
    const root = path.join(evidence, fault); fs.mkdirSync(root);
    fs.writeFileSync(path.join(root, 'input.sv'), 'original');
    const trace = createTrace({ root, tool: 'eda_xsim', args: { sources: ['input.sv'], top: 'tb' }, toolCallId: fault });
    trace.capture('input.sv'); trace.finish('completed');
    const file = path.join(trace.directory, 'run.json');
    assert.equal(checkReplay(file, root).ready, true);
    const stripped = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete stripped.inputs[0].object_path;
    fs.writeFileSync(file, JSON.stringify(stripped));
    assert.match(checkReplay(file, root).issues.join(' '), /Missing content object reference/);
    fs.writeFileSync(file, JSON.stringify(trace.manifest));
    const object = path.resolve(trace.directory, trace.manifest.inputs[0].object_path);
    if (fault === 'missing') fs.renameSync(object, `${object}.intentionally-missing-fixture`);
    else { fs.chmodSync(object, 0o644); fs.writeFileSync(object, 'corrupt fixture'); }
    const checked = checkReplay(file, root);
    assert.equal(checked.ready, false);
    assert.ok(checked.issues.some(issue => issue.startsWith('object ')));
    assert.equal(fs.readFileSync(path.join(root, 'input.sv'), 'utf8'), 'original');
  }
});

test('legacy snapshot hard-linked to a mutable input is rejected without rewriting it', () => {
  const root = path.join(evidence, 'source-alias'); fs.mkdirSync(root);
  const run = path.join(root, 'run'); fs.mkdirSync(run);
  fs.writeFileSync(path.join(root, 'input.sv'), 'source');
  fs.linkSync(path.join(root, 'input.sv'), path.join(run, 'input.sv'));
  const manifest = { schema_version: 1, tool: 'eda_xsim', arguments: { sources: ['input.sv'], top: 'tb' }, workspace: root, status: 'completed', inputs: [
    { relative_path: 'input.sv', snapshot: 'input.sv', sha256: createHash('sha256').update('source').digest('hex') },
  ] };
  const file = path.join(run, 'run.json'); fs.writeFileSync(file, JSON.stringify(manifest));
  assert.match(checkReplay(file, root).issues.join(' '), /aliases mutable current input/);
  assert.equal(fs.readFileSync(path.join(root, 'input.sv'), 'utf8'), 'source');
});
