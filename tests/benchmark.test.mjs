import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadCatalog, validateCatalog, selectCases, hash } from '../src/bench/catalog.mjs';
import { planBenchmark, scheduleCases } from '../src/bench/runner.mjs';
import { evaluateAcceptance, guardIntegrity } from '../src/bench/acceptance.mjs';
import { compareRuns } from '../src/bench/compare.mjs';
import { generateRtl, reference, GENERATOR_FAMILIES } from '../src/bench/generators.mjs';
import { prepareCase } from '../src/bench/prepare.mjs';
const root = path.resolve(import.meta.dirname, '..');
const completed = { status: 'completed' };
const spec = { kind: 'marker', pattern: 'BENCH_PASS checks=(\\d+)', checks: 40 };
const evaluate = (transcript, extra = {}) => evaluateAcceptance(spec, { receipt: completed, tool_exit: 0, transcript, ...extra });

test('catalog validates explicit families, variant counts and external placeholders', () => {
  const catalog = loadCatalog();
  assert.equal(validateCatalog(catalog).valid, true);
  const generated = catalog.cases.filter(item => item.input.kind === 'generated');
  assert.equal(generated.length, 24);
  assert.equal(new Set(generated.map(item => item.family)).size, 12);
  assert.equal(catalog.cases.filter(item => item.origin === 'external').every(item => item.availability !== 'runnable'), true);
  const duplicate = structuredClone(catalog); duplicate.cases.push(duplicate.cases[0]);
  assert.equal(validateCatalog(duplicate).valid, false);
  const unsafe = structuredClone(catalog); unsafe.cases[0].seed = -1;
  assert.equal(validateCatalog(unsafe).valid, false);
  assert.equal(validateCatalog({ cases: {} }).valid, false);
});

test('selection rejects typos and default plans remain a small smoke set', () => {
  const catalog = loadCatalog();
  assert.throws(() => selectCases(catalog, { ids: 'unknown' }));
  assert.equal(selectCases(catalog, { category: 'analog', tier: 'smoke' }).length, 2);
  assert.equal(planBenchmark().case_count, 3);
  assert.equal(planBenchmark({ ids: ['gen-fifo-w4'], seed: 77 }).cases[0].effective_seed, 77);
  assert.throws(() => planBenchmark({ concurrency: 5 }));
  assert.throws(() => planBenchmark({ seed: NaN }));
});

test('pass-like output cannot override timeout, error, zero samples, missing completion or failed tools', () => {
  assert.equal(evaluate('BENCH_PASS checks=40\r\n').status, 'PASS');
  for (const text of ['BENCH_PASS checks=0', 'prefix BENCH_PASS checks=40', '', 'BENCH_PASS checks=40\nFatal: mismatch', 'BENCH_PASS checks=40\nERROR: broken']) assert.notEqual(evaluate(text).status, 'PASS');
  assert.equal(evaluate('BENCH_PASS checks=40\nTIMEOUT').status, 'TIMEOUT');
  assert.equal(evaluate('BENCH_PASS checks=40', { receipt: { status: 'timed_out' } }).status, 'TIMEOUT');
  assert.equal(evaluate('BENCH_PASS checks=40', { receipt: { status: 'cancelled' } }).status, 'INCOMPLETE');
  assert.notEqual(evaluate('BENCH_PASS checks=40', { tool_exit: 7 }).status, 'PASS');
  assert.notEqual(evaluateAcceptance({ kind: 'verilogeval' }, { receipt: completed, tool_exit: 0, transcript: 'Mismatches: 0 in 0 samples' }).status, 'PASS');
  assert.equal(guardIntegrity({ status: 'PASS', passed: true }, { snapshot_integrity: false }).status, 'INCOMPLETE');
  assert.equal(guardIntegrity({ status: 'PASS', passed: true }, { input_drift: true }).status, 'INCOMPLETE');
});

test('negative rejection and expected timeout stay separate from design PASS', () => {
  const rejected = evaluateAcceptance({ kind: 'expected_failure', error_pattern: 'syntax error' }, { receipt: { status: 'failed', error: 'syntax error near semicolon' }, tool_exit: 1 });
  assert.equal(rejected.status, 'EXPECTED_FAILURE');
  assert.equal(evaluateAcceptance({ kind: 'expected_failure', error_pattern: 'syntax error' }, { receipt: { status: 'failed', error: 'licence failure' }, tool_exit: 1 }).status, 'FAIL');
  const timeout = evaluateAcceptance({ kind: 'expected_timeout' }, { receipt: { status: 'timed_out' }, tool_exit: 1 });
  assert.equal(timeout.status, 'EXPECTED_TIMEOUT'); assert.equal(timeout.passed, false);
});

test('analog acceptance rejects malformed or incorrect measurements and routed policy rejects unconstrained failure', () => {
  const rc = { kind: 'rc', names: ['gain_1k'], relative_tolerance: 0.002 };
  assert.equal(evaluateAcceptance(rc, { receipt: { ...completed, measurements_and_log: 'gain_1k: mag(V(out))=(-1.44507011621dB,0deg) at 1000' }, tool_exit: 0 }).status, 'PASS');
  for (const value of ['', 'gain_1k: bad', 'gain_1k: mag(V(out))=(-6.020599913dB,0deg) at 1000']) assert.equal(evaluateAcceptance(rc, { receipt: { ...completed, measurements_and_log: value }, tool_exit: 0 }).status, 'FAIL');
  assert.equal(evaluateAcceptance({ kind: 'routed' }, { receipt: { ...completed, build_result: { stage: 'routed', setup_slack_ns: -1, hold_slack_ns: 1, clock_period_ns: 10 } }, tool_exit: 0 }).status, 'FAIL');
});

test('all generated families freeze deterministic stimuli and independently computed expected values', () => {
  for (const family of GENERATOR_FAMILIES) for (const width of [4, 8]) {
    const first = generateRtl({ family, width, seed: 123 });
    assert.deepEqual(first, generateRtl({ family, width, seed: 123 }));
    assert.notEqual(hash(first), hash(generateRtl({ family, width, seed: 456 })));
    assert.equal(first.oracle.vectors.length, 40);
    assert.match(first.rtl, /^`timescale 1ns\/1ps/); assert.match(first.testbench, /^`timescale 1ns\/1ps/);
    assert.ok(first.oracle.vectors.every(item => Number.isInteger(item.expected) && item.expected >= 0));
  }
  assert.deepEqual(reference('pattern', [1, 0, 1, 0, 1].map(a => ({ a, b: 0, ctrl: 0, reset: 0 })), 4), [0, 0, 1, 0, 1]);
  assert.deepEqual(reference('fir', [1, 2, 3, 4].map(a => ({ a, b: 0, ctrl: 0, reset: 0 })), 4), [1, 4, 8, 12]);
  assert.deepEqual(reference('fifo', [{ a: 3, ctrl: 1 }, { a: 5, ctrl: 1 }, { a: 0, ctrl: 2 }, { a: 7, ctrl: 3 }], 4), [19, 35, 21, 23]);
});

test('scheduler caps simulations independently and serializes implementation with stable result order', async () => {
  const items = Array.from({ length: 9 }, (_, id) => ({ id, tier: id % 3 === 0 ? 'implementation' : 'light' }));
  let sim = 0, impl = 0, maxSim = 0, maxImpl = 0;
  const results = await scheduleCases(items, async item => {
    if (item.tier === 'implementation') maxImpl = Math.max(maxImpl, ++impl); else maxSim = Math.max(maxSim, ++sim);
    await new Promise(resolve => setTimeout(resolve, 12));
    if (item.tier === 'implementation') impl--; else sim--;
    return item.id;
  }, 2);
  assert.equal(maxSim, 2); assert.equal(maxImpl, 1); assert.deepEqual(results, items.map(item => item.id));
});

test('comparison refuses source, policy, seed, catalog or incomplete-evidence mismatches', () => {
  const item = { id: 'a', family: 'f', variant: 'v', seed: 1, case_definition_sha256: 'case', catalog_version: '1', catalog_sha256: 'catalog', input_sha256: 'input', task_sha256: 'task', candidate_sha256: 'design', generator_sha256: 'generator', runtime_sha256: 'runner', tool_environment_sha256: 'tools', acceptance_sha256: 'oracle', acceptance: { status: 'PASS' }, duration_ms: 10 };
  const run = entry => ({ schema_version: 1, run_id: 'r', cases: [entry] });
  assert.equal(compareRuns(run(item), run(item)).cases[0].change, 'UNCHANGED');
  for (const key of ['seed', 'task_sha256', 'generator_sha256', 'tool_environment_sha256', 'acceptance_sha256', 'catalog_version', 'case_definition_sha256']) assert.equal(compareRuns(run(item), run({ ...item, [key]: 'changed' })).cases[0].change, 'INCOMPARABLE');
  const changed = compareRuns(run(item), run({ ...item, candidate_sha256: 'new-design' })).cases[0];
  assert.equal(changed.comparable, true); assert.equal(changed.candidate_changed, true);
  assert.equal(compareRuns(run(item), run({ ...item, acceptance: { status: 'TIMEOUT' } })).cases[0].change, 'INCOMPARABLE');
  assert.equal(compareRuns(run(item), run({ ...item, unresolved_dependencies: [{}] })).cases[0].change, 'INCOMPARABLE');
  assert.equal(compareRuns(run(item), run({ ...item, acceptance: { status: 'FAIL' } })).regressions, 1);
});

test('FFT isolation removes only declared latest writes and explicit waveform logging from a copied script', () => {
  const catalog = loadCatalog();
  const evidence = path.join(root, 'artifacts', `benchmark-adapter-test-${randomUUID()}`);
  fs.mkdirSync(evidence, { recursive: true });
  for (const id of ['fft-simulation', 'fft-implementation']) {
    const folder = path.join(evidence, id);
    const item = catalog.cases.find(item => item.id === id);
    const original = path.join(root, 'projects/fft-spectrum', id === 'fft-simulation' ? 'simulate.tcl' : 'implement.tcl');
    const before = hash(fs.readFileSync(original));
    const prepared = prepareCase(root, item, folder, item.seed);
    const adapted = fs.readFileSync(prepared.args.script, 'utf8');
    assert.doesNotMatch(adapted, /latest-(simulation|implementation)\.txt|^log_wave/m);
    assert.match(adapted, /SPECTRUM_.*PASS/);
    assert.equal(hash(fs.readFileSync(original)), before);
  }
});
