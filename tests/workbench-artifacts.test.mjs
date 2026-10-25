import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {listRunArtifacts, readRunArtifact} from '../src/workbench-artifacts.mjs';
import {createWorkbench} from '../src/workbench.mjs';

function fixture(t) {
  const parent = fs.realpathSync(os.tmpdir()), root = fs.mkdtempSync(path.join(parent, 'eda-artifact-preview-'));
  const runId = 'recorded-run', directory = path.join(root, 'artifacts', runId);
  fs.mkdirSync(directory, {recursive: true});
  t.after(() => {
    const resolved = fs.realpathSync(root);
    assert.equal(path.dirname(resolved), parent);
    assert.ok(path.basename(resolved).startsWith('eda-artifact-preview-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  });
  const write = (name, value) => {const file = path.join(directory, name); fs.mkdirSync(path.dirname(file), {recursive: true}); fs.writeFileSync(file, value); return file;};
  return {root, runId, directory, write};
}

test('artifact previews limit reads to permitted reports and reject private files or realpath escapes', t => {
  const f = fixture(t);
  f.write('reports/timing.rpt', 'Setup slack: +2.393 ns');
  f.write('run.log', 'Completed');
  f.write('result.json', '{"status":"completed"}');
  for (const name of ['inputs/captured.log', 'prompt.txt', 'events.jsonl', 'api-key.txt', 'password.log', 'config.json', 'other.json', '.hidden/report.rpt']) {
    f.write(name, 'private');
    assert.throws(() => readRunArtifact(f.root, f.runId, name), error => error.statusCode === 403);
  }
  for (const name of ['../outside.log', '..\\outside.log', 'run.log:secret', '/run.log']) {
    assert.throws(() => readRunArtifact(f.root, f.runId, name), error => error.statusCode === 403);
  }
  const outside = path.join(f.root, 'outside');
  fs.mkdirSync(outside); fs.writeFileSync(path.join(outside, 'stolen.log'), 'Must remain private');
  fs.symlinkSync(outside, path.join(f.directory, 'external'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readRunArtifact(f.root, f.runId, 'external/stolen.log'), error => error.statusCode === 403);
  assert.deepEqual(listRunArtifacts(f.root, f.runId).files.map(row => row.file).sort(), ['reports/timing.rpt', 'result.json', 'run.log']);
});

test('JSON previews redact secret and reasoning fields while retaining usage counts and original bytes', t => {
  const f = fixture(t), original = JSON.stringify({status: 'completed', api_key: 'example-secret',
    nested: {Authorization: 'Bearer private', reasoning_content: 'private reasoning'},
    content: [{type: 'thinking', text: 'Hidden thought'}, {type: 'text', text: 'Public result'}],
    stats: {tokens: {input: 40, output: 12, reasoningTokens: 5}},
  });
  const file = f.write('usage.json', original), preview = readRunArtifact(f.root, f.runId, 'usage.json');
  assert.equal(preview.redacted, true);
  assert.ok(preview.redaction_count >= 4);
  assert.equal(preview.content.includes('example-secret'), false);
  assert.equal(preview.content.includes('private reasoning'), false);
  assert.equal(preview.content.includes('Hidden thought'), false);
  const parsed = JSON.parse(preview.content);
  assert.deepEqual(parsed.stats.tokens, {input: 40, output: 12, reasoningTokens: 5});
  assert.equal(parsed.content[1].text, 'Public result');
  assert.equal(preview.sha256, createHash('sha256').update(original).digest('hex'));
  assert.equal(fs.readFileSync(file, 'utf8'), original);
});

test('workflow step receipts are available with the same JSON redaction and path restrictions', t => {
  const f = fixture(t);
  f.write('simulation.result.json', JSON.stringify({checks: 658158, api_key: 'private-fixture-value'}));
  f.write('drc-report.result.json', JSON.stringify({warnings: 2, errors: 0}));
  f.write('prompt.result.json', JSON.stringify({prompt: 'private'}));
  f.write('inputs/synthesis.result.json', JSON.stringify({captured: true}));
  assert.deepEqual(listRunArtifacts(f.root, f.runId).files.map(row => row.file).sort(), ['drc-report.result.json', 'simulation.result.json']);
  const simulation = readRunArtifact(f.root, f.runId, 'simulation.result.json');
  assert.equal(JSON.parse(simulation.content).checks, 658158);
  assert.equal(simulation.content.includes('private-fixture-value'), false);
  assert.equal(simulation.redacted, true);
  assert.equal(JSON.parse(readRunArtifact(f.root, f.runId, 'drc-report.result.json').content).warnings, 2);
  assert.throws(() => readRunArtifact(f.root, f.runId, 'prompt.result.json'), error => error.statusCode === 403);
  assert.throws(() => readRunArtifact(f.root, f.runId, 'inputs/synthesis.result.json'), error => error.statusCode === 403);
});

test('paged UTF-8 text preserves complete Chinese characters and redacts secrets before page boundaries', t => {
  const f = fixture(t), original = '时序检查成功\n'.repeat(12) + 'api_key = abcdefghijklmnop\nSetup slack: +2.393 ns\n';
  f.write('timing.log', original);
  let offset = 0, combined = '', pages = 0;
  do {
    const preview = readRunArtifact(f.root, f.runId, 'timing.log', {offset, limit: 17});
    assert.equal(preview.content.includes('\uFFFD'), false);
    assert.ok(Buffer.byteLength(preview.content) <= 17);
    combined += preview.content; offset = preview.next_offset;
    assert.ok(++pages < 100);
  } while (offset !== null);
  assert.equal(combined, original.replace('abcdefghijklmnop', '[REDACTED]'));
  assert.equal(combined.includes('abcdefghijklmnop'), false);
  assert.throws(() => readRunArtifact(f.root, f.runId, 'timing.log', {offset: -1}), /Invalid/);
  assert.throws(() => readRunArtifact(f.root, f.runId, 'timing.log', {limit: 65537}), /Invalid/);
});

test('oversized, malformed and binary receipts fail explicitly while UTF-16 EDA logs remain readable', t => {
  const f = fixture(t), huge = f.write('large.log', '');
  fs.truncateSync(huge, 8 * 1024 * 1024 + 1);
  assert.equal(listRunArtifacts(f.root, f.runId).files[0].previewable, false);
  assert.throws(() => readRunArtifact(f.root, f.runId, 'large.log'), error => error.statusCode === 413);
  f.write('result.json', '{"unfinished":');
  assert.throws(() => readRunArtifact(f.root, f.runId, 'result.json'), /incomplete or malformed/);
  f.write('binary.log', Buffer.from([0, 1, 2, 3]));
  assert.throws(() => readRunArtifact(f.root, f.runId, 'binary.log'), /Binary/);
  f.write('ltspice.log', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('测量完成\r\nf3db=159.15', 'utf16le')]));
  const preview = readRunArtifact(f.root, f.runId, 'ltspice.log');
  assert.equal(preview.encoding, 'utf16le');
  assert.equal(preview.content, '测量完成\r\nf3db=159.15');
});

test('HTTP preview exposes paged receipts and rejects foreign origins and excluded files', async t => {
  const f = fixture(t);
  f.write('simulation.result.json', JSON.stringify({checks: 658158}));
  f.write('process.log', 'First line\nSecond line\n');
  f.write('prompt.txt', 'Private prompt');
  const app = createWorkbench(f.root, new Map());
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${app.server.address().port}`;
    const listing = await fetch(`${base}/api/artifacts?run_id=${f.runId}`);
    assert.equal(listing.status, 200);
    assert.deepEqual((await listing.json()).files.map(row => row.file).sort(), ['process.log', 'simulation.result.json']);
    const preview = await fetch(`${base}/api/artifact?run_id=${f.runId}&file=process.log&offset=11&limit=7`);
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).content, 'Second ');
    assert.equal((await fetch(`${base}/api/artifact?run_id=${f.runId}&file=prompt.txt`)).status, 403);
    assert.equal((await fetch(`${base}/api/artifact?run_id=${f.runId}&file=process.log`, {headers: {Origin: 'https://untrusted.example'}})).status, 403);
  } finally {await app.close();}
});
