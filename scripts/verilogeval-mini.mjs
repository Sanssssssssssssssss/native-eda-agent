import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createJiti } from 'jiti';
import { verdict } from './verilogeval-verdict.mjs';

const root = path.resolve(import.meta.dirname, '..');
const argv = process.argv.slice(2);
const projectArg = argv[0] === '--project' ? argv.splice(0, 2)[1] : 'projects/verilogeval-mini';
if (!projectArg) throw new Error('--project requires a directory');
const project = path.resolve(root, projectArg);
const timeoutArg = argv[0] === '--test-timeout-ps' ? argv.splice(0, 2)[1] : null;
const testTimeoutPs = timeoutArg === null ? null : Number(timeoutArg);
if (testTimeoutPs !== null && (!Number.isSafeInteger(testTimeoutPs) || testTimeoutPs <= 0)) throw new Error('Invalid test timeout');
const source = path.join(root, 'vendor/verilog-eval/dataset_spec-to-rtl');
const selection = JSON.parse(fs.readFileSync(path.join(project, 'selection.json'), 'utf8'));
const requested = argv;
if (requested.some(id => !selection.task_ids.includes(id))) throw new Error('Unknown selected task');
const ids = requested.length ? requested : selection.task_ids;
const out = path.join(root, 'artifacts', `verilogeval-codex-${new Date().toISOString().replace(/[:.]/g, '-')}`);
fs.mkdirSync(out, { recursive: true });
const registry = new Map();
(await createJiti(import.meta.url).import('../src/tools/eda.ts', { default: true }))({ registerTool: t => registry.set(t.name, t) });
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const result = { mode: 'Codex authored solutions; direct local tools; no external model API',
  benchmark: selection, evaluated_ids: ids, model_api_calls: 0, test_timeout_ps_override: testTimeoutPs,
  started: new Date().toISOString(), tasks: [] };
fs.copyFileSync(path.join(project, 'selection.json'), path.join(out, 'selection.json'));

// Freeze all candidate solutions before exposing any test result.
for (const id of ids) {
  fs.copyFileSync(path.join(source, `${id}_prompt.txt`), path.join(out, `${id}_prompt.txt`));
  fs.copyFileSync(path.join(project, 'solutions', `${id}.sv`), path.join(out, `${id}.sv`));
  const ref = fs.readFileSync(path.join(source, `${id}_ref.sv`), 'utf8');
  // Isolate reference compiler directives from the independently authored DUT.
  fs.writeFileSync(path.join(out, `${id}_ref.sv`), '`timescale 1ps/1ps\n' + ref + '\n`default_nettype wire\n');
  const rawTest = fs.readFileSync(path.join(source, `${id}_test.sv`), 'utf8');
  // XSim rejects these two nets being referenced by $dumpvars before declaration.
  const declarations = /\s*wire tb_match;[^\n]*\n\s*wire tb_mismatch = ~tb_match;[^\n]*/;
  if (!declarations.test(rawTest)) throw new Error(`Unexpected upstream test format: ${id}`);
  let adapted = rawTest.replace(declarations, '').replace('module tb();',
    'module tb();\nwire tb_match;\nwire tb_mismatch = ~tb_match;');
  if (testTimeoutPs !== null) {
    const watchdog = /#1000000(\s+\$display\("TIMEOUT"\))/;
    if (!watchdog.test(adapted)) throw new Error(`Unexpected watchdog: ${id}`);
    adapted = adapted.replace(watchdog, `#${testTimeoutPs}$1`);
  }
  fs.writeFileSync(path.join(out, `${id}_test.sv`), adapted);
}
for (const id of ids) {
  const start = Date.now();
  const task = { id, solution_sha256: hash(fs.readFileSync(path.join(out, `${id}.sv`))),
    category: selection.categories?.[id] ?? null,
    prompt_sha256: hash(fs.readFileSync(path.join(out, `${id}_prompt.txt`))),
    upstream_test_sha256: hash(fs.readFileSync(path.join(source, `${id}_test.sv`))),
    upstream_ref_sha256: hash(fs.readFileSync(path.join(source, `${id}_ref.sv`))) };
  console.log(`RUN ${id}`);
  try {
    const r = await registry.get('eda_xsim').execute(id, {
      sources: [path.join(out, `${id}_test.sv`), path.join(out, `${id}_ref.sv`), path.join(out, `${id}.sv`)], top: 'tb',
    }, undefined, u => console.log(u.content[0].text));
    const transcript = fs.readFileSync(r.details.process_log, 'utf8');
    task.directory = r.details.directory;
    Object.assign(task, verdict(transcript));
  } catch (error) {
    task.passed = false;
    task.error = String(error);
  }
  task.wall_seconds = (Date.now() - start) / 1000;
  result.tasks.push(task);
  result.passed = result.tasks.filter(t => t.passed).length;
  result.total = ids.length;
  result.wall_seconds = (Date.now() - Date.parse(result.started)) / 1000;
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(`${task.passed ? 'PASS' : 'FAIL'} ${id}: ${task.mismatches ?? 'tool error'} mismatches / ${task.samples ?? 0} samples`);
}
console.log(`RESULT ${result.passed}/${result.total}; ${out}`);
if (result.passed !== result.total) process.exitCode = 1;
