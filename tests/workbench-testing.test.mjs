import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { getTestingOverview } from '../src/workbench-testing.mjs';

const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const item = (id, extra = {}) => ({ id, title: id, family: `family-${id}`, category: 'rtl.sequential', tier: 'light', tool: 'eda_xsim', availability: 'runnable', ...extra });
function fixture(t, cases = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eda-testing-overview-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, value) => {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  };
  write('benchmarks/catalog.json', { schema_version: 1, catalog_version: 'test', categories: ['rtl.sequential'], tiers: ['light'], cases });
  write('knowledge/retrieval-cases.json', { cases: [], unrelated_queries: [] });
  return { root, write, read: () => getTestingOverview(root) };
}
const lane = (result, id) => result.lanes.find(item => item.id === id);
const cases = result => result.groups.flatMap(group => group.cases);
function campaign(f, rows, definitions, suffix = '01') {
  const id = `benchmark-2026-10-25T14-00-${suffix}-000Z-test`;
  const values = rows.map(row => ({ ...row, started_at: `2026-10-25T14:00:${suffix}.000Z`, case_definition_sha256: hash(definitions.find(def => def.id === row.id)) }));
  f.write(`artifacts/${id}/summary.json`, { schema_version: 1, cases: values });
  for (const row of values) f.write(`artifacts/${id}/cases/${row.id}/result.json`, row);
  return id;
}

test('testing catalog retains unrun and failed denominators and separates expected controls', t => {
  const definitions = [item('pass'), item('fail'), item('none'), item('negative'), item('timeout')];
  const f = fixture(t, definitions);
  campaign(f, [
    { id: 'pass', acceptance: { status: 'PASS' } }, { id: 'fail', acceptance: { status: 'FAIL' } },
    { id: 'negative', acceptance: { status: 'EXPECTED_FAILURE' } }, { id: 'timeout', acceptance: { status: 'EXPECTED_TIMEOUT' } },
  ], definitions);
  const result = f.read(), tools = lane(result, 'tool_execution');
  assert.equal(result.aggregate_score, null);
  assert.equal(result.catalog.total, 5);
  assert.equal(tools.summary.passed, 1);
  assert.equal(tools.summary.failed, 1);
  assert.equal(tools.summary.not_run, 1);
  assert.equal(tools.summary.expected_failure, 1);
  assert.equal(tools.summary.expected_timeout, 1);
  assert.equal(tools.summary.executed, 4);
  assert.equal(lane(result, 'online_agent').summary.total, 0);
});

test('online tasks keep separate denominators, repeated assessments and unbound failures', t => {
  const f=fixture(t);
  const receipts=[
    {session:'artifacts/session-a',workflow:'artifacts/workflow-a',status:'passed'},
    {session:'artifacts/session-b',workflow:'artifacts/workflow-b',status:'passed'},
    {session:'artifacts\\session-a',workflow:'artifacts\\workflow-a',status:'failed',error:'Current evidence drift'},
    {status:'blocked',reason:'agent_session_and_workflow_required'},
    {status:'failed',error:'Legacy failure without subject paths'},
  ];
  receipts.forEach((value,i)=>f.write(`artifacts/evaluation-2026-10-26T08-00-0${i}-000Z-test/result.json`,
    {suite:'online-agent',started_at:`2026-10-26T08:00:0${i}Z`,...value}));
  const online=lane(f.read(),'online_agent');
  assert.equal(online.summary.total,2);assert.equal(online.summary.passed,1);assert.equal(online.summary.failed,1);
  const first=cases(online).find(item=>item.session==='artifacts/session-a');
  assert.deepEqual(first.history.map(item=>item.status),['failed','passed']);assert.equal(first.history_count,2);
  assert.equal(first.latest.reason,'Current evidence drift');
  assert.equal(online.unbound_history.length,2);assert.ok(online.unbound_history.every(item=>item.evidence.length===1));
});

test('changed benchmark definitions and tampered case receipts cannot inherit a recorded pass', t => {
  const definitions = [item('changed'), item('tampered')], f = fixture(t, definitions);
  const id = campaign(f, definitions.map(def => ({ id: def.id, acceptance: { status: 'PASS' } })), definitions);
  definitions[0].title = 'a different task with same ID';
  f.write('benchmarks/catalog.json', { cases: definitions, categories: [], tiers: [] });
  f.write(`artifacts/${id}/cases/tampered/result.json`, { acceptance: { status: 'PASS' } });
  const result = lane(f.read(), 'tool_execution');
  assert.equal(result.summary.passed, 0);
  assert.equal(result.summary.unknown, 2);
  assert.equal(cases(result)[0].latest.observed_status, 'passed');
  assert.equal(cases(result)[0].latest.current_definition_match, false);
  assert.equal(cases(result)[1].latest.receipt_integrity, false);
});

test('software parses named outcomes, retains failures once and never invents Python case verdicts', t => {
  const f = fixture(t), prefix = 'artifacts/agent-offline-2026-10-25T14-00-00-000Z-test';
  const source = "test('lease expires safely',()=>{});\ntest('failure is retained',()=>{});";
  f.write('tests/workbench-runtime.test.mjs', source);
  f.write(`${prefix}/result.json`, { started_at: '2026-10-25T14:00:00Z', passed: false, checks: [{ name: 'node', passed: false, test_count: 2 }, { name: 'python', passed: true, test_count: 21 }], source_hashes: { 'tests/workbench-runtime.test.mjs': hash(source) } });
  f.write(`${prefix}/node.log`, '✔ lease expires safely (1.2ms)\n✖ failure is retained (5ms)\nℹ tests 2\n✖ failure is retained\n');
  f.write(`${prefix}/python.log`, '.....................\nRan 21 tests in 1s\nOK\n');
  const result = lane(f.read(), 'software');
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.groups[0].id, 'workbench');
  assert.equal(result.aggregates.find(item => item.name === 'python').individual_results, 0);
  assert.equal(result.aggregates.find(item => item.name === 'python').recorded_test_count, 21);
  assert.equal(result.receipt.current_sources_match, true);
  f.write('tests/workbench-runtime.test.mjs', source + '\n// changed');
  assert.equal(lane(f.read(), 'software').receipt.current_sources_match, false);
});

test('retrieval joins exact queries and refuses to transfer pass after test-set changes', t => {
  const f = fixture(t), querySet = { cases: [{ query: 'clock question', relevant: ['CLOCK-1'] }, { query: 'new question', relevant: ['NEW-1'] }], unrelated_queries: ['unrelated'] };
  f.write('knowledge/retrieval-cases.json', querySet);
  const receipt = { suite: 'offline-retrieval', started_at: '2026-10-25T14:00:00Z', status: 'passed', metrics: { case_set_sha256: hash(querySet), cases: [{ query: 'clock question', after: ['CLOCK-1'] }], unrelated: [{ query: 'unrelated', returned: 0 }] } };
  f.write('artifacts/evaluation-2026-10-25T14-00-00-test/result.json', receipt);
  let result = lane(f.read(), 'retrieval');
  assert.equal(result.summary.passed, 2);
  assert.equal(result.summary.not_run, 1);
  querySet.cases[0].relevant = ['OTHER-1'];
  f.write('knowledge/retrieval-cases.json', querySet);
  result = lane(f.read(), 'retrieval');
  assert.equal(result.summary.unknown, 2);
  assert.equal(result.summary.passed, 0);
});

test('duplicate named software checks remain distinct observations in the denominator', t => {
  const f = fixture(t), prefix = 'artifacts/agent-offline-2026-10-25T14-00-00-000Z-test';
  f.write(`${prefix}/result.json`, { started_at: '2026-10-25T14:00:00Z', checks: [{ name: 'node', passed: false, test_count: 2 }] });
  f.write(`${prefix}/node.log`, '✔ same title (1ms)\n✖ same title (2ms)\n');
  const result = lane(f.read(), 'software');
  assert.equal(result.summary.total, 2);
  assert.equal(result.summary.passed, 1);
  assert.equal(result.summary.failed, 1);
  assert.equal(new Set(cases(result).map(item => item.id)).size, 2);
  assert.equal(result.aggregates[0].individual_count_matches, true);
});

test('newer software success retains an earlier failure in its case history', t => {
  const f = fixture(t);
  for (const [minute, mark] of [['00', '✖'], ['01', '✔']]) {
    const prefix = `artifacts/agent-offline-2026-10-25T14-${minute}-00-000Z-test`;
    f.write(`${prefix}/result.json`, { started_at: `2026-10-25T14:${minute}:00Z`, checks: [{ name: 'node', passed: mark === '✔', test_count: 1 }] });
    f.write(`${prefix}/node.log`, `${mark} recovery boundary (1ms)\n`);
  }
  const result = cases(lane(f.read(), 'software'))[0];
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.history.map(item => item.status), ['passed', 'failed']);
  assert.equal(result.history_count, 2);
});

test('retrieval history orders standalone receipt timestamps against evaluator receipts', t => {
  const f = fixture(t), querySet = { cases: [{ query: 'clock', relevant: ['CLOCK-1'] }], unrelated_queries: [] };
  f.write('knowledge/retrieval-cases.json', querySet);
  const metrics = { case_set_sha256: hash(querySet), cases: [{ query: 'clock', after: [] }], unrelated: [] };
  f.write('artifacts/evaluation-2026-10-25T14-00-00-test/result.json', { suite: 'offline-retrieval', started_at: '2026-10-25T14:00:00.000Z', metrics });
  metrics.cases[0].after = ['CLOCK-1'];
  f.write('artifacts/knowledge-eval-2026-10-25T14-01-00-000Z-test/result.json', metrics);
  const result = cases(lane(f.read(), 'retrieval'))[0];
  assert.equal(result.latest.started_at, '2026-10-25T14:01:00.000Z');
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.history.map(item => item.status), ['passed', 'failed']);
});

test('engineering uses bound domain evidence and retains DRC review separately from process completion', t => {
  const f = fixture(t), id = '2026-10-25T14-00-00-000Z-eda_workflow_run-test', prefix = `artifacts/${id}`;
  const report = { errors: 0, warnings: 2 }, reportPath = `${prefix}/drc.result.json`;
  const outcome = { status: 'review_required', domains: [{ domain: 'drc', status: 'review_required', observed: report, evidence: { result: reportPath, sha256: hash(report) } }] };
  const saved = { task_acceptance_hash: hash(outcome), plan: { spec_path: 'examples/workflows/test.json', spec: { id: 'test-fpga', acceptance: { profile: 'fpga_ooc', bindings: { drc: 'drc' } } }, input_hashes: {} } };
  f.write(`${prefix}/run.json`, { status: 'completed', started_at: '2026-10-25T14:00:00Z' });
  f.write(reportPath, report);
  f.write(`${prefix}/task-outcome.json`, outcome);
  f.write(`${prefix}/checkpoints/00001.json`, saved);
  f.write(`${prefix}/workflow.json`, { path: 'checkpoints/00001.json', sha256: hash(saved) });
  let result = lane(f.read(), 'engineering');
  assert.equal(result.summary.passed, 0);
  assert.equal(result.summary.review_required, 1);
  assert.equal(result.summary.not_run, 9);
  assert.equal(result.summary.executed, 1);
  f.write(reportPath, { errors: 1 });
  result = lane(f.read(), 'engineering');
  assert.equal(result.summary.unknown, 1);
  assert.equal(cases(result).find(item => item.category === 'drc').latest.receipt_integrity, false);
});

test('testing scan skips external directory links and reports malformed receipts without crashing', t => {
  const f = fixture(t), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'eda-testing-outside-'));
  t.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.writeFileSync(path.join(outside, 'result.json'), JSON.stringify({ suite: 'online-agent', status: 'passed' }));
  fs.mkdirSync(path.join(f.root, 'artifacts'), { recursive: true });
  fs.symlinkSync(outside, path.join(f.root, 'artifacts/evaluation-2026-10-25T15-00-00-link'), process.platform === 'win32' ? 'junction' : 'dir');
  f.write('artifacts/evaluation-2026-10-25T14-00-00-malformed/result.json', '{');
  const result = f.read();
  assert.equal(lane(result, 'online_agent').summary.passed, 0);
  assert.equal(lane(result, 'online_agent').summary.total, 0);
  assert.equal(result.scan.errors[0].reason, 'invalid_json');
});
