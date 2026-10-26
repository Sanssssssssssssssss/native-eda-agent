import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { createTrace, runProcess, storeSnapshot, verifyInputEvidence, traceContext, validateTraceEvent, mcpTraceContext } from '../src/trace.mjs';
import {inspectTrace} from '../scripts/trace-inspect.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const evidence = path.join(workspace, 'artifacts', `trace-tests-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`);
fs.mkdirSync(evidence, { recursive: true });
console.log(`Trace test evidence: ${evidence}`);
function setup(name) {
  const root = path.join(evidence, name);
  fs.mkdirSync(root, { recursive: true });
  return { root, trace: createTrace({ root, tool: 'test_process', args: { name }, toolCallId: name }) };
}
function readRun(trace) { return JSON.parse(fs.readFileSync(path.join(trace.directory, 'run.json'), 'utf8')); }

test('Pi drift history remains visible even if the original file is restored later',()=>{
  const {root,trace}=setup('pi-drift-history');fs.writeFileSync(path.join(root,'input.txt'),'original');trace.capture(path.join(root,'input.txt'),'input');trace.finalizeDependencies();trace.finish('completed');
  const m=readRun(trace);m.mode='pi-sdk-agent';m.inputDrift=['input.txt'];fs.writeFileSync(path.join(trace.directory,'run.json'),JSON.stringify(m));
  const r=inspectTrace(trace.directory,{checkCurrent:true});assert.equal(r.valid,true);assert.equal(r.input_drift,true);
});

test('success preserves ordered events, actual process metadata, stdout/stderr and a distinct tool status', async () => {
  const { trace } = setup('success');
  assert.equal(readRun(trace).status, 'running');
  await runProcess(trace, process.execPath, ['-e', 'console.log("stdout-evidence"); console.error("stderr-evidence")']);
  const receipt = trace.finish('completed', null, { transcript_tail: 'compatible-field' });
  const manifest = readRun(trace);
  assert.equal(receipt.transcript_tail, 'compatible-field');
  assert.equal(manifest.acceptance, 'not_evaluated_by_trace');
  assert.equal(manifest.usage.outer_codex_tokens, null);
  assert.equal(manifest.processes[0].exit_code, 0);
  assert.equal(manifest.processes[0].termination_reason, 'completed');
  assert.ok(manifest.processes[0].pid > 0);
  assert.ok(manifest.processes[0].started_at && manifest.processes[0].ended_at);
  const events = fs.readFileSync(path.join(trace.directory, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.map(event => event.seq), events.map((_, index) => index + 1));
  assert.ok(events.every(event => Number.isFinite(Date.parse(event.timestamp_utc))));
  assert.match(fs.readFileSync(receipt.process_log, 'utf8'), /stdout-evidence[\s\S]*stderr-evidence/);
});

test('transient replacement locks retain the old JSON until atomic publication succeeds', t => {
  const { trace } = setup('transient-publish-lock');
  const target = path.join(trace.directory, 'run.json');
  const original = fs.readFileSync(target, 'utf8');
  const rename = fs.renameSync;
  const failures = ['EPERM', 'EACCES', 'EBUSY'];
  let attempts = 0;
  const temporaryFiles = new Set();
  t.mock.method(fs, 'renameSync', (source, destination) => {
    if (destination === target) {
      attempts++;
      temporaryFiles.add(source);
      assert.equal(fs.readFileSync(target, 'utf8'), original);
      assert.equal(JSON.parse(fs.readFileSync(source, 'utf8')).publication_probe, 'complete replacement');
      if (failures.length) throw Object.assign(new Error('injected transient replacement lock'), { code: failures.shift() });
    }
    return rename(source, destination);
  });
  trace.manifest.publication_probe = 'complete replacement';
  trace.persist();
  assert.equal(attempts, 4);
  assert.equal(temporaryFiles.size, 1);
  assert.equal(readRun(trace).publication_probe, 'complete replacement');
  assert.ok([...temporaryFiles].every(file => !fs.existsSync(file)));
});

test('non-lock publication errors fail immediately and retain both old and pending evidence', t => {
  const { trace } = setup('publish-io-error');
  const target = path.join(trace.directory, 'run.json');
  const original = fs.readFileSync(target, 'utf8');
  const rename = fs.renameSync;
  const failure = Object.assign(new Error('injected storage I/O failure'), { code: 'EIO' });
  let attempts = 0, temporary;
  t.mock.method(fs, 'renameSync', (source, destination) => {
    if (destination !== target) return rename(source, destination);
    attempts++;
    temporary = source;
    throw failure;
  });
  trace.manifest.publication_probe = 'pending replacement';
  assert.throws(() => trace.persist(), error => error === failure);
  assert.equal(attempts, 1);
  assert.equal(fs.readFileSync(target, 'utf8'), original);
  assert.equal(JSON.parse(fs.readFileSync(temporary, 'utf8')).publication_probe, 'pending replacement');
});

test('persistent close-time publication failure rejects the process task without crashing the host', { timeout: 10000 }, async t => {
  const { trace } = setup('close-publish-lock');
  const target = path.join(trace.directory, 'run.json');
  const rename = fs.renameSync;
  const failure = Object.assign(new Error('injected persistent replacement lock'), { code: 'EPERM' });
  let attempts = 0, previous, temporary;
  const mock = t.mock.method(fs, 'renameSync', (source, destination) => {
    if (destination !== target || !trace.manifest.processes[0]?.ended_at) return rename(source, destination);
    attempts++;
    previous ??= fs.readFileSync(target, 'utf8');
    assert.equal(fs.readFileSync(target, 'utf8'), previous);
    temporary = source;
    throw failure;
  });
  await assert.rejects(runProcess(trace, process.execPath, ['-e', 'console.log("child finished before publication failed")']), error => error === failure);
  assert.ok(attempts > 1 && attempts <= 10, `replacement retries must be finite: ${attempts}`);
  assert.equal(fs.readFileSync(target, 'utf8'), previous);
  assert.equal(readRun(trace).processes[0].ended_at, null);
  const pending = JSON.parse(fs.readFileSync(temporary, 'utf8'));
  assert.equal(pending.processes[0].exit_code, 0);
  assert.ok(pending.processes[0].ended_at);
  const events = fs.readFileSync(path.join(trace.directory, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(events.filter(event => event.type === 'process_end').length, 1);
  assert.match(fs.readFileSync(path.join(trace.directory, 'process.log'), 'utf8'), /child finished before publication failed/);
  mock.mock.restore();
  assert.equal(trace.finish('failed', failure).status, 'failed');
  assert.ok(fs.existsSync(temporary), 'failed temporary evidence must remain available after finalization');
  const next = setup('host-survives-publish-failure').trace;
  await runProcess(next, process.execPath, ['-e', '']);
  assert.equal(next.finish('completed').status, 'completed');
});

test('process-end event write failure also rejects from the child callback', { timeout: 10000 }, async t => {
  const { trace } = setup('close-event-error');
  const event = trace.event;
  const failure = Object.assign(new Error('injected process-end event write failure'), { code: 'EIO' });
  const mock = t.mock.method(trace, 'event', (type, details) => {
    if (type === 'process_end') throw failure;
    return event(type, details);
  });
  await assert.rejects(runProcess(trace, process.execPath, ['-e', '']), error => error === failure);
  assert.equal(trace.manifest.processes[0].exit_code, 0);
  mock.mock.restore();
  assert.equal(trace.finish('failed', failure).status, 'failed');
});

test('nonzero exit and spawn failure retain their distinct causes and failure directory', async () => {
  for (const [name, exe, args, reason, code] of [
    ['nonzero', process.execPath, ['-e', 'console.error("known failure");process.exit(7)'], 'exit_nonzero', 7],
    ['spawn', path.join(evidence, 'missing-executable-421.exe'), [], 'spawn_error', null],
  ]) {
    const { trace } = setup(name);
    let failure;
    try { await runProcess(trace, exe, args); } catch (error) { failure = error; }
    assert.ok(failure);
    const receipt = trace.finish('failed', failure);
    const processRecord = readRun(trace).processes[0];
    assert.equal(processRecord.termination_reason, reason);
    assert.equal(processRecord.exit_code, code);
    assert.equal(receipt.directory, trace.directory);
    assert.ok(fs.existsSync(receipt.process_log));
  }
});

test('timeout terminates the owned process and records a timeout cause', async () => {
  const { trace } = setup('timeout');
  let failure;
  try { await runProcess(trace, process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 200 }); }
  catch (error) { failure = error; }
  assert.ok(failure);
  trace.finish('timed_out', failure);
  const record = readRun(trace).processes[0];
  assert.equal(record.termination_reason, 'timeout');
  assert.ok(record.duration_ms >= 150 && record.duration_ms < 15000);
  assert.throws(() => process.kill(record.pid, 0));
});

test('abort and cancellation before startup remain distinguishable from timeout', async () => {
  for (const before of [false, true]) {
    const { trace } = setup(before ? 'preabort' : 'abort');
    const controller = new AbortController();
    if (before) controller.abort();
    else setTimeout(() => controller.abort(), 200);
    let failure;
    try { await runProcess(trace, process.execPath, ['-e', 'setInterval(()=>{},1000)'], { signal: controller.signal, timeoutMs: 10000 }); }
    catch (error) { failure = error; }
    assert.ok(failure);
    trace.finish('cancelled', failure);
    const record = readRun(trace).processes[0];
    assert.equal(record.termination_reason, before ? 'abort_before_start' : 'abort');
    assert.equal(record.pid === null, before);
  }
});

test('snapshot retains original bytes and reports a source edit during execution', async () => {
  const { root, trace } = setup('drift');
  const file = path.join(root, 'input.sv');
  fs.writeFileSync(file, 'original bytes');
  trace.capture(file);
  await runProcess(trace, process.execPath, ['-e', 'require("fs").writeFileSync(process.argv[1],"new bytes")', file]);
  const receipt = trace.finish('completed');
  const input = readRun(trace).inputs[0];
  assert.equal(receipt.input_drift, true);
  assert.notEqual(input.sha256, input.end_sha256);
  assert.equal(fs.readFileSync(path.join(trace.directory, input.snapshot), 'utf8'), 'original bytes');
});

test('SV include/readmemh/fopen, Tcl source, and SPICE include dependencies are captured; computed paths are explicit gaps', () => {
  const { root, trace } = setup('dependencies');
  const write = (name, content) => fs.writeFileSync(path.join(root, name), content);
  write('vector-config.svh', 'localparam VECTOR_FILE = "vectors.txt";');
  write('vectors.txt', '00 11');
  write('firmware.hex', '00ff');
  write('top.sv', '`include "vector-config.svh"\nparameter FIRMWARE = "firmware.hex";\ninitial $readmemh(FIRMWARE, ram);\ninitial fd=$fopen(VECTOR_FILE,"r");\ninitial $readmemh(dynamic_path(), other);');
  write('child.tcl', 'read_verilog -sv [file join $root top.sv]\nread_xdc $runtime_constraints');
  write('main.tcl', 'source [file join $root child.tcl]');
  write('models.lib', '* model library');
  write('analog.cir', '.include "models.lib"\n.op');
  trace.capture('main.tcl'); trace.capture('analog.cir');
  trace.finish('completed');
  const manifest = readRun(trace);
  const captured = manifest.inputs.map(input => input.relative_path);
  for (const file of ['main.tcl', 'child.tcl', 'top.sv', 'vector-config.svh', 'vectors.txt', 'firmware.hex', 'analog.cir', 'models.lib']) assert.ok(captured.includes(file), file);
  assert.ok(manifest.unresolved_dependencies.some(item => item.expression === '$runtime_constraints'));
  assert.ok(manifest.unresolved_dependencies.some(item => item.expression.includes('dynamic_path')));
});

test('snapshots exclude credential files and external inputs', () => {
  const { root, trace } = setup('exclusions');
  fs.writeFileSync(path.join(root, '.env'), 'FAKE_TEST_SECRET=must-not-copy');
  fs.writeFileSync(path.join(root, 'auth.json'), '{"test":"must-not-copy"}');
  trace.capture('.env'); trace.capture('auth.json'); trace.capture(path.join(workspace, 'README.md'));
  trace.finish('failed', new Error('validation fixture'));
  const manifest = readRun(trace);
  assert.equal(manifest.inputs.length, 0);
  assert.equal(manifest.unresolved_dependencies.length, 3);
  assert.ok(!JSON.stringify(manifest).includes('must-not-copy'));
});

test('same-named constants in separate RTL files resolve locally and ambiguous references are reported', () => {
  const { root, trace } = setup('ambiguous-symbols');
  for (const [name, content] of [['a.hex', 'a'], ['b.hex', 'b'],
    ['a.sv', 'parameter MEM_FILE="a.hex"; initial $readmemh(MEM_FILE, mem);'],
    ['b.sv', 'parameter MEM_FILE="b.hex"; initial $readmemh(MEM_FILE, mem);'],
    ['ambiguous.sv', 'initial $readmemh(MEM_FILE, mem);']]) fs.writeFileSync(path.join(root, name), content);
  trace.capture('a.sv'); trace.capture('b.sv'); trace.capture('ambiguous.sv');
  trace.finish('completed');
  const manifest = readRun(trace);
  assert.ok(manifest.inputs.some(item => item.relative_path === 'a.hex'));
  assert.ok(manifest.inputs.some(item => item.relative_path === 'b.hex'));
  assert.ok(manifest.unresolved_dependencies.some(item => item.from.endsWith('ambiguous.sv') && item.reason.startsWith('Ambiguous')));
});

test('CLI input validation and malformed JSON return a parseable directory receipt without launching EDA', () => {
  for (const [name, content] of [['invalid-top', '{"sources":[],"top":"bad;top"}'], ['malformed-json', '{broken']]) {
    const argsFile = path.join(evidence, `${name}.json`);
    fs.writeFileSync(argsFile, content);
    // This checks input rejection, not startup speed; allow Windows module loading alongside concurrent EDA jobs.
    const child = spawnSync(process.execPath, ['scripts/eda-tool.mjs', 'eda_xsim', argsFile], { cwd: workspace, encoding: 'utf8', timeout: 60000 });
    assert.equal(child.status, 1, child.stderr);
    const receipt = JSON.parse(child.stdout);
    assert.equal(Object.keys(receipt)[0], 'directory');
    assert.equal(receipt.status, 'failed');
    assert.ok(fs.existsSync(receipt.process_log));
    assert.equal(JSON.parse(fs.readFileSync(receipt.run_manifest, 'utf8')).processes.length, 0);
    assert.ok(child.stderr.includes('Error'));
  }
});

test('concurrent runs publish one verified content object and never hard-link the original input', async () => {
  const root = path.join(evidence, 'concurrent-objects'); fs.mkdirSync(root);
  const source = path.join(root, 'same.sv'); fs.writeFileSync(source, 'same immutable captured bytes');
  const module = pathToFileURL(path.join(workspace, 'src/trace.mjs')).href;
  const command = 'const {createTrace}=await import(process.argv[1]);const t=createTrace({root:process.argv[2],tool:"fixture",args:{},toolCallId:process.argv[3]});t.capture("same.sv");console.log(JSON.stringify(t.finish("completed")));';
  const results = await Promise.all(Array.from({ length: 4 }, (_, index) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', command, module, root, String(index)], { windowsHide: true });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject); child.once('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
  })));
  const manifests = results.map(result => JSON.parse(fs.readFileSync(result.run_manifest, 'utf8')));
  const objectPaths = manifests.map((manifest, index) => path.resolve(results[index].directory, manifest.inputs[0].object_path));
  assert.equal(new Set(objectPaths).size, 1);
  const objectStat = fs.statSync(objectPaths[0], { bigint: true });
  const sourceStat = fs.statSync(source, { bigint: true });
  assert.notEqual(objectStat.ino, sourceStat.ino);
  for (let index = 0; index < results.length; index++) {
    assert.equal(verifyInputEvidence(manifests[index], results[index].directory).valid, true);
    const item = manifests[index].inputs[0];
    if (item.storage === 'hardlink') assert.equal(fs.statSync(path.join(results[index].directory, item.snapshot), { bigint: true }).ino, objectStat.ino);
  }
  fs.writeFileSync(source, 'original source remains writable');
  assert.equal(fs.readFileSync(objectPaths[0], 'utf8'), 'same immutable captured bytes');
});

test('tampering a snapshot alias is detected and a damaged content object is never reused or repaired silently', () => {
  const { root, trace } = setup('object-tampering');
  const source = path.join(root, 'input.sv'); fs.writeFileSync(source, 'source bytes');
  trace.capture(source); trace.finish('completed');
  const manifest = readRun(trace), item = manifest.inputs[0];
  const object = path.resolve(trace.directory, item.object_path);
  fs.chmodSync(object, 0o644); fs.writeFileSync(object, 'damaged object');
  assert.equal(fs.readFileSync(source, 'utf8'), 'source bytes');
  assert.equal(verifyInputEvidence(manifest, trace.directory).valid, false);
  assert.throws(() => storeSnapshot(Buffer.from('source bytes'), path.join(root, 'new-snapshot.sv'), path.join(root, 'artifacts/.trace-objects/sha256')), /Object integrity failure/);
  assert.equal(fs.readFileSync(object, 'utf8'), 'damaged object');
});

test('trace association reads only whitelisted IDs and events have validated common span fields', async () => {
  assert.deepEqual(mcpTraceContext({mcpReq:{_meta:{traceparent:`00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`,authorization:'private'}}}),{trace_id:'a'.repeat(32),parent_span_id:'b'.repeat(16)});
  assert.deepEqual(mcpTraceContext({mcpReq:{_meta:{traceparent:`00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`}}}),{});
  assert.deepEqual(traceContext({trace_id:'0'.repeat(32)},{}).context,{});
  const chosen = traceContext({ case_id: 'case-7' }, { EDA_TRACE_CAMPAIGN_ID: 'campaign.2026', EDA_TRACE_CASE_ID: 'ignored', EDA_TRACE_SESSION_ID: 'invalid value', DEEPSEEK_API_KEY: 'never-copy-secret' });
  assert.deepEqual(chosen.context, { campaign_id: 'campaign.2026', case_id: 'case-7' });
  assert.deepEqual(chosen.invalid_context_fields, ['session_id']);
  assert.ok(!JSON.stringify(chosen).includes('never-copy-secret'));
  const { trace } = setup('event-schema');
  await runProcess(trace, process.execPath, ['-e', '']); trace.finish('completed');
  const events = fs.readFileSync(path.join(trace.directory, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  for (let index = 0; index < events.length; index++) assert.deepEqual(validateTraceEvent(events[index], { expectedSeq: index + 1, runId: trace.manifest.run_id }), []);
  const processStart = events.find(event => event.type === 'process_start');
  assert.notEqual(processStart.span_id, trace.manifest.span_id);
  assert.equal(processStart.parent_span_id, trace.manifest.span_id);
  assert.ok(validateTraceEvent({ ...processStart, seq: -1, timestamp_utc: 'bad', trace_id: 'bad', process_id: 'not-an-id' }).length >= 4);
});
