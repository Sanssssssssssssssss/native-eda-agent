import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createTrace, runProcess } from '../src/trace.mjs';
import { inventoryArtifacts, retentionPlan } from '../scripts/artifact-inventory.mjs';
import { inspectTrace, compareTraces, summarizeTraces } from '../scripts/trace-inspect.mjs';

const evidence = path.resolve(import.meta.dirname, '../artifacts', `artifact-tests-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`);
fs.mkdirSync(evidence, { recursive: true });
const sha = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');

test('inventory distinguishes logical bytes, hard-link bytes, and waveform share without reading waveform contents', () => {
  const root = path.join(evidence, 'inventory'); fs.mkdirSync(root);
  fs.writeFileSync(path.join(root, 'a.txt'), '12345');
  fs.linkSync(path.join(root, 'a.txt'), path.join(root, 'b.txt'));
  fs.writeFileSync(path.join(root, 'trace.wdb'), 'waveform12');
  const result = inventoryArtifacts(root);
  assert.equal(result.file_count, 3);
  assert.equal(result.logical_bytes, 20);
  assert.equal(result.hardlink_unique_bytes, 15);
  assert.equal(result.hardlink_saved_bytes, 5);
  assert.equal(result.waveform_bytes, 10);
  assert.equal(result.waveform_fraction, 0.5);
  assert.equal(result.disk_allocated_bytes, null);
});

test('retention planning changes no files and preserves failure, timeout, active, pinned, legacy and analog evidence', () => {
  const root = path.join(evidence, 'retention'); fs.mkdirSync(root);
  for (const [name, status, extra] of [['success', 'completed', {}], ['failure', 'failed', {}], ['timeout', 'timed_out', {}], ['active', 'running', {}], ['pinned', 'completed', { retention: { pinned: true } }], ['drift', 'completed', { input_drift: true }], ['legacy', null, {}]]) {
    const directory = path.join(root, name); fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'trace.wdb'), 'wave data');
    fs.writeFileSync(path.join(directory, 'process.log'), 'real failure/pass evidence');
    if (status) fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify({ run_id: name, status, finished_at: '2026-01-01T00:00:00Z', ...extra }));
  }
  fs.writeFileSync(path.join(root, 'success/analog.raw'), 'numeric analog evidence');
  const before = inventoryArtifacts(root, { includeFiles: true });
  const hashes = Object.fromEntries(before.files.map(file => [file.path, sha(path.join(root, file.path))]));
  const plan = retentionPlan(before, { now: Date.parse('2026-10-23T00:00:00Z') });
  assert.deepEqual(plan.candidates.map(item => item.path), ['success/trace.wdb']);
  assert.equal(plan.deletes_files, false);
  assert.equal(plan.mode, 'plan_only');
  const after = inventoryArtifacts(root, { includeFiles: true });
  assert.equal(after.logical_bytes, before.logical_bytes);
  assert.deepEqual(Object.fromEntries(after.files.map(file => [file.path, sha(path.join(root, file.path))])), hashes);
});

test('inspection summarizes process events and compares inputs without printing process log content', async () => {
  const root = path.join(evidence, 'inspect'); fs.mkdirSync(root);
  const runs = [];
  for (const content of ['first', 'second']) {
    fs.writeFileSync(path.join(root, 'input.sv'), content);
    const trace = createTrace({ root, tool: 'fixture', args: { config: content }, toolCallId: content, context: { campaign_id: 'offline-fixture', case_id: content } });
    trace.capture('input.sv');
    await runProcess(trace, process.execPath, ['-e', 'console.log("DO_NOT_PRINT_LOG_BODY")']);
    trace.finish('completed', null, { build_result: { version: 'fixture-version', setup_slack_ns: content === 'first' ? 1 : 2 } });
    runs.push(inspectTrace(trace.directory));
  }
  assert.ok(runs.every(run => run.valid));
  assert.ok(!JSON.stringify(runs).includes('DO_NOT_PRINT_LOG_BODY'));
  assert.equal(runs[0].process_count, 1);
  assert.equal(runs[0].context.campaign_id, 'offline-fixture');
  const comparison = compareTraces(...runs);
  assert.equal(comparison.changed_inputs.length, 1);
  assert.equal(comparison.parameters_changed, true);
  assert.equal(comparison.changed_metrics.setup_slack_ns.delta, 1);
  assert.equal(summarizeTraces(runs).by_tool.fixture.completed, 2);
  fs.appendFileSync(path.join(runs[0].directory, 'events.jsonl'), '{"seq":999,"type":"bad"}\n');
  const invalid = inspectTrace(runs[0].directory);
  assert.equal(invalid.valid, false);
  assert.ok(invalid.validation_issues.some(issue => issue.includes('sequence')));
  assert.ok(invalid.validation_issues.some(issue => issue.includes('timestamp')));
});

test('Pi SDK aliases are inspected without fabricating missing initialization events', () => {
  const directory = path.join(evidence, 'pi-alias-fixture'); fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'snapshot.txt'), 'SYNTHETIC_PI_INPUT');
  const manifest = { mode: 'pi-sdk-agent', schemaVersion: 1, runId: 'synthetic-pi', status: 'completed',
    trace_id: 'a'.repeat(32), span_id: 'b'.repeat(16), startedAt: '2026-10-24T00:00:00Z', endedAt: '2026-10-24T00:00:01Z', wallSeconds: 1,
    inputs: [{ path: 'source.txt', snapshot: 'snapshot.txt', sha256: sha(path.join(directory, 'snapshot.txt')) }] };
  fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify(manifest));
  const events = ['run_start', 'run_end'].map((type, i) => ({ type, sequence: i + 1, agent_run_id: manifest.runId,
    timestamp_utc: `2026-10-24T00:00:0${i}Z`, trace_id: manifest.trace_id, span_id: manifest.span_id }));
  fs.writeFileSync(path.join(directory, 'events.jsonl'), events.map(JSON.stringify).join('\n'));
  const result = inspectTrace(directory);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(result.run_id, 'synthetic-pi');
  assert.equal(result.duration_ms, 1000);
  assert.equal(inspectTrace(directory, { checkCurrent: true }).valid, false);
  fs.writeFileSync(path.join(directory, 'run.json'), JSON.stringify({ ...manifest, status: 'initialization_failed' }));
  fs.writeFileSync(path.join(directory, 'events.jsonl'), '');
  assert.equal(inspectTrace(directory).valid, false);
});
