import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {listProjects, getProject, readProjectSource} from '../src/workbench-projects.mjs';
import {createWorkflowTools} from '../src/workflow.mjs';
import {createTrace} from '../src/trace.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'eda-project-inventory-'));
  const write = (relative, content) => {const target = path.join(root, relative); fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, content); return target;};
  write('projects/demo/rtl/top.sv', '// module ignored;\nmodule top(input clk);\n  logic [7:0] count;\nendmodule\n');
  write('projects/demo/tb/top_tb.sv', 'module top_tb; endmodule\n');
  write('projects/demo/constraints/top.xdc', 'create_clock -period 10 [get_ports clk]\n');
  write('projects/demo/vectors/check.mem', '00000001\n');
  write('projects/demo/README.md', '# Demonstration design\n');
  write('Gameboy/private.sv', 'module should_never_appear; endmodule');
  write('runtime/private.sv', 'module should_never_appear; endmodule');
  write('projects/demo/credentials.json', '{"secret":"private"}');
  t.after(() => {assert.equal(path.dirname(fs.realpathSync(root)), fs.realpathSync(os.tmpdir())); fs.rmSync(root, {recursive: true, force: true});});
  return {root, write, id: listProjects(root).projects.find(p => p.publicPath === 'projects/demo').id};
}
test('inventory identifies real sources and fixed checkers without declaring engineering completion', t => {
  const f = fixture(t), p = getProject(f.root, f.id);
  assert.equal(p.implementation, 'sources_present'); assert.equal(p.verification, 'unknown');
  assert.equal(p.counts.rtl, 1); assert.equal(p.counts.testbench, 1); assert.equal(p.counts.constraint, 1); assert.equal(p.counts.test_data, 1);
  assert.deepEqual(p.files.find(x => x.kind === 'rtl').modules, [{name: 'top', line: 2}]);
  assert.equal(p.files.find(x => x.kind === 'rtl').editable, true);
  assert.ok(p.files.filter(x => ['testbench', 'constraint', 'test_data'].includes(x.kind)).every(x => !x.editable));
  assert.ok(Object.values(p.verification_matrix).every(x => x.status === 'unknown'));
  assert.ok(!p.files.some(x => /credential|private/.test(x.publicPath)));
  assert.equal(listProjects(f.root).projects.length, 1);
});
test('source preview binds current bytes and numbered pages, refusing traversal, private paths and cross-project access', t => {
  const f = fixture(t), first = readProjectSource(f.root, f.id, 'rtl/top.sv', {start_line: 2, line_count: 2});
  assert.deepEqual(first.lines.map(l => l.number), [2, 3]); assert.equal(first.next_line, 4);
  assert.equal(first.sha256, hash(fs.readFileSync(path.join(f.root, first.publicPath))));
  f.write('projects/demo/rtl/top.sv', 'module changed; endmodule\n');
  const second = readProjectSource(f.root, f.id, 'rtl/top.sv');
  assert.notEqual(first.sha256, second.sha256); assert.match(second.lines[0].text, /changed/);
  for (const file of ['../demo/rtl/top.sv', 'projects/demo/credentials.json', 'runtime/private.sv', 'E:/outside.sv', 'rtl\\top.sv']) assert.throws(() => readProjectSource(f.root, f.id, file), /outside/);
  assert.throws(() => readProjectSource(f.root, f.id, 'rtl/top.sv', {start_line: 999}), /outside/);
  assert.throws(() => readProjectSource(f.root, f.id, 'rtl/top.sv', {line_count: 10000}), /range/);
});
test('VHDL declaration jumps point at the entity line after blank lines and indentation', t => {
  const f = fixture(t);
  f.write('projects/demo/rtl/clocked.vhd', 'library ieee;\n\n\n  entity clocked is\nend clocked;\n');
  const file = getProject(f.root, f.id).files.find(x => x.path === 'rtl/clocked.vhd');
  assert.deepEqual(file.modules, [{name: 'clocked', line: 4}]);
  assert.match(readProjectSource(f.root, f.id, file.path, {start_line: file.modules[0].line, line_count: 1}).lines[0].text, /entity clocked/);
});
test('workflow specification and external fixed constraints are immutable inventory inputs and change the baseline digest', t => {
  const f = fixture(t), xdc = 'projects/shared-constraints/fixed.xdc', specPath = 'examples/workflows/demo.json';
  f.write(xdc, 'create_clock -period 10 [get_ports clk]\n');
  const spec = {schema_version: 1, id: 'demo-fixed', inputs: [xdc, 'projects/demo/rtl/top.sv'], steps: [{id: 'synth', tool: 'eda_vivado_synthesize', args: {sources: ['projects/demo/rtl/top.sv'], constraints: [xdc]}}]};
  f.write(specPath, JSON.stringify(spec));
  const before = getProject(f.root, f.id);
  for (const name of [xdc, specPath]) {
    const file = before.files.find(f => f.publicPath === name);
    assert.equal(file.dependency, true); assert.equal(file.editable, false);
  }
  const rtlHash = before.files.find(f => f.kind === 'rtl').sha256;
  f.write(xdc, 'create_clock -period 20 [get_ports clk]\n');
  const changed = getProject(f.root, f.id);
  assert.notEqual(before.digest, changed.digest); assert.equal(changed.files.find(f => f.kind === 'rtl').sha256, rtlHash);
  f.write(specPath, JSON.stringify({...spec, goal: 'Changed task identity'}));
  assert.notEqual(changed.digest, getProject(f.root, f.id).digest);
});
test('explicit external RTL dependencies are visible and immutable; linked directories never enter the inventory', t => {
  const f = fixture(t);
  f.write('vendor/ip/core.v', 'module external_core; endmodule\n');
  f.write('projects/demo/sources.json', JSON.stringify({sources: ['vendor/ip/core.v', 'Gameboy/private.sv', 'runtime/private.sv']}));
  fs.symlinkSync(path.join(f.root, 'Gameboy'), path.join(f.root, 'projects/demo/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  const p = getProject(f.root, f.id), dependency = p.files.find(x => x.dependency);
  assert.equal(dependency.publicPath, 'vendor/ip/core.v'); assert.equal(dependency.editable, false);
  assert.equal(readProjectSource(f.root, f.id, dependency.path).lines[0].text, 'module external_core; endmodule');
  assert.ok(!p.files.some(x => /linked|private/.test(x.path)));
  assert.throws(() => readProjectSource(f.root, f.id, 'linked/private.sv'), /outside/);
  fs.rmSync(path.join(f.root, 'projects/demo/rtl/top.sv'));
  fs.symlinkSync(path.join(f.root, 'vendor/ip'), path.join(f.root, 'projects/demo/replaced'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => readProjectSource(f.root, f.id, 'replaced/core.v'), /outside/);
});
test('oversized, invalid UTF-8 and binary input are bounded and cannot be editable source', t => {
  const f = fixture(t);
  f.write('projects/demo/rtl/too-large.sv', Buffer.alloc(1024 * 1024 + 1, 65));
  f.write('projects/demo/rtl/invalid.sv', Buffer.from([0xc3, 0x28]));
  f.write('projects/demo/rtl/binary.sv', Buffer.from([0, 65, 0, 66]));
  const p = getProject(f.root, f.id);
  assert.equal(p.truncated, true); assert.ok(p.omitted.some(x => x.reason === 'size_limit'));
  assert.equal(p.files.find(x => x.path === 'rtl/invalid.sv').editable, false);
  assert.equal(p.files.find(x => x.path === 'rtl/binary.sv').editable, false);
  assert.throws(() => readProjectSource(f.root, f.id, 'rtl/invalid.sv'), /UTF-8/);
  assert.throws(() => readProjectSource(f.root, f.id, 'rtl/binary.sv'), /Binary|UTF-16/);
});
test('historical aggregate score and a legacy pass pointer cannot promote an individual RTL project', t => {
  const f = fixture(t);
  f.write('projects/system-bench/dma/dma.v', 'module dma; endmodule');
  f.write('artifacts/old-sim/result.json', '{"passed":true}');
  f.write('projects/system-bench/dma/latest-sim.json', JSON.stringify({pass: true, stage: 'sim', artifact_directory: path.join(f.root, 'artifacts/old-sim')}));
  const evidence = '{"passed":4,"total":4}'; f.write('results/evidence/four.json', evidence);
  f.write('results/catalog.json', JSON.stringify({records: [{id: 'system-projects-4', title: 'Four designs', passed: 4, total: 4, evidence: [{path: 'results/evidence/four.json', sha256: hash(evidence)}]}]}));
  // Separate root observations bypass the short list cache by reading the deterministic project ID.
  const id = `dma-${hash('projects/system-bench/dma').slice(0, 10)}`, p = getProject(f.root, id);
  assert.equal(p.verification, 'historical'); assert.equal(p.historical_results[0].project_scope, 'aggregate_not_project_specific');
  assert.equal(p.historical_results[0].public_evidence_valid, true); assert.equal(p.runs[0].integrity, 'unbound_legacy_receipt');
  assert.ok(Object.values(p.verification_matrix).every(x => x.status === 'unknown'));
});
test('current evidence becomes historical after input drift and tampered reports cannot retain a passing matrix', async t => {
  const f = fixture(t), project = path.resolve(import.meta.dirname, '..');
  for (const name of ['knowledge', '.pi/skills']) fs.cpSync(path.join(project, name), path.join(f.root, name), {recursive: true});
  for (const name of ['src/knowledge.mjs', 'src/trace.mjs', 'scripts/check-knowledge.mjs', 'scripts/eda-tool.mjs', 'scripts/replay-experiment.mjs', 'scripts/collect-system-evidence.py', 'projects/system-bench/run.py', 'projects/system-bench/implement-common.tcl', 'docs/workflows.md', 'docs/reference/tools.md', 'docs/results.md']) {
    f.write(name, fs.readFileSync(path.join(project, name)));
  }
  const source = 'projects/demo/rtl/top.sv', specPath = 'examples/workflows/demo.json';
  const spec = {schema_version: 1, id: 'demo-sim', goal: 'Fixed fake backend contract', inputs: [source], limits: {max_calls: 2, wall_seconds: 10}, acceptance: {profile: 'rtl_simulation', bindings: {functional: 'simulation'}}, steps: [{id: 'simulation', tool: 'eda_xsim', args: {sources: [source], pass_marker: 'PASS'}, checks: [{pointer: '/simulation_acceptance/status', op: 'eq', value: 'pass'}]}]};
  f.write(specPath, JSON.stringify(spec));
  const registry = new Map([['eda_xsim', {parameters: {type: 'object', properties: {sources: {type: 'array', items: {type: 'string'}}, pass_marker: {type: 'string'}}}, async execute(id, args, signal, update, context) {
    const trace = createTrace({root: f.root, tool: 'eda_xsim', args, toolCallId: id, context: context.edaTraceContext});
    trace.capture(path.join(f.root, source), 'input'); trace.finalizeDependencies();
    return {details: trace.finish('completed', null, {simulation_acceptance: {status: 'pass', pass_marker: 'PASS', marker_matches: 1, completion_observed: true, failure_diagnostic: false}})};
  }}]]);
  const execute = createWorkflowTools(f.root, registry).find(t => t.name === 'eda_workflow_run');
  const older = await execute.execute('inventory-test-older', {spec: specPath});
  const run = await execute.execute('inventory-test', {spec: specPath});
  let p = getProject(f.root, f.id);
  assert.equal(p.verification, 'current_evidence'); assert.equal(p.verification_matrix.functional.status, 'passed'); assert.equal(p.verification_matrix.functional.scope, 'current');
  const reportPath = path.join(run.details.directory, 'simulation.result.json'), originalReport = fs.readFileSync(reportPath);
  fs.appendFileSync(reportPath, ' ');
  p = getProject(f.root, f.id);
  assert.equal(p.verification_matrix.functional.status, 'unknown'); assert.equal(p.verification, 'historical');
  assert.equal(p.runs.find(r => r.id === path.basename(older.details.directory)).scope, 'current');
  fs.writeFileSync(reportPath, originalReport);
  f.write(source, 'module top; logic changed; endmodule\n');
  p = getProject(f.root, f.id);
  assert.equal(p.verification, 'historical'); assert.equal(p.verification_matrix.functional.scope, 'historical'); assert.equal(p.runs[0].current_inputs, 'mismatch');
  fs.appendFileSync(path.join(run.details.directory, 'simulation.result.json'), ' ');
  p = getProject(f.root, f.id);
  assert.equal(p.runs[0].integrity, 'mismatch'); assert.equal(p.verification_matrix.functional.status, 'unknown');
  assert.equal(p.verification_matrix.functional.run_id, path.basename(run.details.directory));
  assert.equal(p.runs.find(r => r.id === path.basename(older.details.directory)).acceptance.domains.find(d => d.domain === 'functional').status, 'passed');
});


test('a candidate workflow sharing original vectors cannot become original-project evidence', t => {
  const f=fixture(t), id='2026-10-26T12-00-00-000Z-eda_workflow_run-candidate';
  f.write(`artifacts/${id}/run.json`,JSON.stringify({tool:'eda_workflow_run',status:'running',arguments:{spec:'artifacts/agent-task-123/candidate-workflow.json'},inputs:[{relative_path:'projects/demo/vectors/check.mem'}]}));
  const project=getProject(f.root,f.id);
  assert.equal(project.runs.some(run=>run.id===id),false);
  assert.equal(project.verification_matrix.functional.run_id,null);
});
