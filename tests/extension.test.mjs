import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createJiti } from 'jiti';
const root = path.resolve(import.meta.dirname, '..');
const extension = await createJiti(import.meta.url).import('../src/extension.ts', { default: true });

test('project extension associates supplied SDK context and parent trace with tool evidence', async () => {
  const registry = new Map();
  extension({ registerTool: tool => registry.set(tool.name, tool) }, { traceContext: () => ({ parent_run_id: 'agent-fixture', trace_id: 'a'.repeat(32), parent_span_id: 'b'.repeat(16) }) });
  const ctx = {};
  Object.defineProperty(ctx, 'sessionManager', { get: () => ({ getSessionId: () => 'sdk-session-fixture' }) });
  Object.defineProperty(ctx, 'executeTool', { value: () => { throw new Error('not called'); } });
  const result = await registry.get('eda_knowledge').execute('context-test', { query: 'clock', limit: 1 }, undefined, undefined, ctx);
  const run = JSON.parse(fs.readFileSync(path.join(result.details.evidence, 'run.json'), 'utf8'));
  assert.equal(run.context.session_id, 'sdk-session-fixture');
  assert.equal(run.context.parent_run_id, 'agent-fixture');
  assert.equal(run.trace_id, 'a'.repeat(32));
  assert.equal(run.context.parent_span_id, 'b'.repeat(16));
  assert.ok(run.inputs.some(input => input.relative_path.replaceAll('\\', '/') === 'knowledge/rules.json'));
  assert.ok(run.inputs.some(input => input.relative_path.replaceAll('\\', '/') === 'knowledge/sources.json'));
  assert.equal(run.snapshot_integrity.valid, true);
});

test('project input hook handles text while model API is disabled', async () => {
  const handlers = new Map();
  extension({ registerTool() {}, registerCommand() {}, appendEntry() {}, on: (event, handler) => handlers.set(event, handler) });
  let notification;
  assert.deepEqual(await handlers.get('input')({ text: 'offline fixture' }, { ui: { notify: text => { notification = text; } } }), { action: 'handled' });
  assert.match(notification, /API/);
});
