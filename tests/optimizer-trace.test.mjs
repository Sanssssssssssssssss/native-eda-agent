import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createTrace, runProcess } from '../src/trace.mjs';
import { inspectTrace } from '../scripts/trace-inspect.mjs';
import { inspectOptimizer } from '../src/optimizer-inspection.mjs';
import { createPlatformTools } from '../src/platform.mjs';

const root = path.resolve(import.meta.dirname, '..');
const python = path.join(root, 'runtime/vivado-community-venv/Scripts/python.exe');
// A real Node -> Python boundary with a synthetic EDA backend. No Vivado process.
const fixture = `import asyncio,json,sys
from pathlib import Path
sys.path.insert(0,sys.argv[1]+'/src')
sys.path.insert(0,sys.argv[1]+'/tests')
from test_fpga_optimizer import FakeBackend,measured
from fpga_optimizer.runner import optimize
from unittest.mock import patch
async def run():
    with patch('socket.socket.connect',side_effect=AssertionError('network forbidden')):
        await optimize({'checkpoint':sys.argv[2],'mode':'run','max_trials':1},sys.argv[3],
          lambda _: FakeBackend([measured(wns_ns=0.4)]),trace_context=json.loads(sys.argv[4]))
asyncio.run(run())`;

test('native tool -> optimizer causal trace, offline tool access and corruption/interruption counterexamples', { timeout: 60000 }, async () => {
  const trace = createTrace({ root, tool: 'eda_vivado_optimize', args: { test: 'synthetic-only' }, toolCallId: 'offline-contract' });
  console.log(`Synthetic trace evidence: ${trace.directory}`);
  const input = path.join(trace.directory, 'synthetic-input.dcp');
  fs.writeFileSync(input, 'SYNTHETIC_DCP_NO_EDA');
  trace.capture(input, 'test_fixture');
  const out = path.join(trace.directory, 'optimizer');
  const context = { trace_id: trace.manifest.trace_id, parent_span_id: trace.manifest.span_id, parent_run_id: trace.manifest.run_id };
  trace.event('optimizer_link', { directory: out });
  await runProcess(trace, python, ['-c', fixture, root, input, out, JSON.stringify(context)], { timeoutMs: 20000 });
  trace.finish('completed');
  let report = inspectTrace(trace.directory);
  assert.equal(report.valid, true, JSON.stringify(report.validation_issues));
  assert.equal(report.optimizer.valid, true, JSON.stringify(report.optimizer));
  assert.equal(report.optimizer.outcome, 'improved');
  assert.equal(report.optimizer.parent_span_id, trace.manifest.span_id);
  assert.ok(report.optimizer.reviewable_checkpoint);
  assert.equal(inspectOptimizer(out, { parent: { ...trace.manifest, status: 'failed' } }).reviewable_checkpoint, null);
  const tool = createPlatformTools(root).find(t => t.name === 'eda_trace');
  const reply = await tool.execute('inspect-offline', { directory: out });
  assert.equal(reply.details.valid, true);
  assert.equal(reply.details.model_api_calls, 0);

  const eventFile = path.join(out, 'optimizer-events.jsonl');
  const originalEvents = fs.readFileSync(eventFile, 'utf8');
  const resultFile = path.join(out, 'optimizer-result.json');
  const originalResult = fs.readFileSync(resultFile, 'utf8');
  const result = JSON.parse(originalResult);
  const checkpoint = result.best.checkpoint, originalDcp = fs.readFileSync(checkpoint);
  try {
    fs.writeFileSync(checkpoint, 'CORRUPTED_SYNTHETIC_DCP');
    report = inspectTrace(trace.directory);
    assert.equal(report.valid, false);
    assert.equal(report.optimizer.reviewable_checkpoint, null);
    assert.match(report.validation_issues.join(' '), /hash/);
    fs.writeFileSync(checkpoint, originalDcp);

    result.trace.parent_span_id = 'b'.repeat(16);
    fs.writeFileSync(resultFile, JSON.stringify(result));
    assert.equal(inspectTrace(trace.directory).valid, false);
    fs.writeFileSync(resultFile, originalResult);

    const lines = originalEvents.trim().split('\n');
    fs.writeFileSync(eventFile, lines.slice(0, -1).join('\n') + '\n');
    report = inspectTrace(trace.directory);
    assert.equal(report.valid, false);
    assert.equal(report.optimizer.complete, false);
    assert.equal(report.optimizer.reviewable_checkpoint, null);

    const orphan = lines.map(JSON.parse);
    orphan.find(e => e.type === 'span_start').parent_span_id = 'c'.repeat(16);
    fs.writeFileSync(eventFile, orphan.map(JSON.stringify).join('\n') + '\n');
    assert.equal(inspectTrace(trace.directory).valid, false);

    fs.writeFileSync(eventFile, originalEvents + '{truncated');
    assert.equal(inspectTrace(trace.directory).valid, false);
    fs.writeFileSync(eventFile, originalEvents);
    fs.writeFileSync(resultFile, 'null');
    assert.equal(inspectTrace(trace.directory).valid, false);
  } finally {
    fs.writeFileSync(eventFile, originalEvents); fs.writeFileSync(resultFile, originalResult); fs.writeFileSync(checkpoint, originalDcp);
  }
  assert.equal(inspectTrace(trace.directory).valid, true);
});
