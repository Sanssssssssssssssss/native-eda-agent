// Exercise the real orchestration function with a local fake SDK; no provider is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

const source = fs.readFileSync(new URL('../src/agent.mjs', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('async function agentRun('), source.indexOf("const [command = 'help'"));

async function exercise(failAt) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eda-agent-record-'));
  const dir = path.join(root, 'run');
  fs.mkdirSync(path.join(root, '.pi'));
  fs.writeFileSync(path.join(root, '.pi/APPEND_SYSTEM.md'), 'Offline fixture');
  fs.mkdirSync(dir);
  let listener;
  const fakeProcess = { exitCode: 0, version: process.version, on() {}, removeListener() {} };
  const session = {
    model: { provider: 'offline-fixture', id: 'no-model' }, thinkingLevel: 'off',
    getSessionStats: () => ({ sessionId: 'fixture-session', tokens: { total: 0 } }),
    subscribe: fn => { listener = fn; return () => {}; },
    abort() {}, dispose() {}, bindExtensions: async () => {},
    prompt: async () => {
      listener({ type: 'turn_start' });
      listener({ type: 'tool_execution_start', toolName: 'fixture', toolCallId: 'call-1' });
      if (failAt === 'prompt') throw new Error('fixture prompt failure');
      if (failAt === 'retry-recovered') {
        listener({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', errorMessage: '429 retryable failure' } });
        listener({ type: 'auto_retry_start', attempt: 1 });
        listener({ type: 'auto_retry_end', success: true, attempt: 1 });
      }
      listener({ type: 'message_end', message: { role: 'assistant', stopReason: failAt === 'aborted' ? 'aborted' : 'stop' } });
    },
    getLastAssistantText: () => 'Offline fixture response',
    extensionRunner: { emit: async () => { if (failAt === 'shutdown') throw new Error('fixture shutdown failure'); } },
  };
  const context = {
    fs, path, createHash, root, agentDir: path.join(root, '.pi-state'), performance,
    outputDir: () => dir, save: (p, value) => fs.writeFileSync(p, JSON.stringify(value)),
    process: fakeProcess, console: { log() {}, error() {} }, setTimeout, clearTimeout,
    SettingsManager: { create() { if (failAt === 'initialize') throw new Error('fixture initialization failure'); } },
    DefaultResourceLoader: class { async reload() {} },
    edaExtension() {}, createCodemodeExtension() {}, createToolSearchExtension() {}, createMcpExtension() {},
    createAgentSession: async () => ({ session, extensionsResult: { errors: [] } }),
  };
  try {
    await vm.runInNewContext(`${body}\nagentRun('Offline prompt', {maxTurns: 2, timeoutSeconds: 5});`, context);
    return {
      run: JSON.parse(fs.readFileSync(path.join(dir, 'run.json'))),
      usage: JSON.parse(fs.readFileSync(path.join(dir, 'usage.json'))),
      events: fs.existsSync(path.join(dir, 'events.jsonl')) ? fs.readFileSync(path.join(dir, 'events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse) : [],
      exitCode: fakeProcess.exitCode,
    };
  } finally {
    // Only this uniquely created temporary fixture tree is removed.
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test('records completed session, ordered timestamps and scoped usage', async () => {
  const result = await exercise();
  assert.equal(result.run.status, 'completed');
  assert.equal(result.run.sessionId, 'fixture-session');
  assert.equal(result.usage.scope, 'pi-sdk-agent-only');
  assert.equal(result.events.at(-1).type, 'run_end');
  result.events.forEach((event, i) => {
    assert.equal(event.sequence, i + 1);
    assert.ok(Number.isFinite(Date.parse(event.timestamp_utc)));
    assert.equal(event.session_id, 'fixture-session');
  });
});

test('initialization failure persists status with unknown usage', async () => {
  const result = await exercise('initialize');
  assert.equal(result.run.status, 'initialization_failed');
  assert.equal(result.usage.stats, null);
  assert.equal(result.exitCode, 1);
});

test('prompt and shutdown errors retain evidence and nonzero status', async () => {
  const prompt = await exercise('prompt');
  assert.equal(prompt.run.status, 'failed');
  assert.match(prompt.run.error, /fixture prompt failure/);
  assert.equal(prompt.exitCode, 1);
  const shutdown = await exercise('shutdown');
  assert.equal(shutdown.run.status, 'shutdown_failed');
  assert.match(shutdown.run.shutdownError, /fixture shutdown failure/);
  assert.equal(shutdown.events.at(-1).type, 'run_end');
  assert.equal(shutdown.events.at(-1).status, 'shutdown_failed');
  assert.equal(shutdown.events.filter(event => event.type === 'run_end').length, 1);
  assert.equal(shutdown.usage.status, 'shutdown_failed');
  assert.match(shutdown.usage.error, /fixture shutdown failure/);
  assert.equal(shutdown.exitCode, 1);
});

test('SDK aborted response cannot become a completed session', async () => {
  const result = await exercise('aborted');
  assert.equal(result.run.status, 'stopped');
  assert.equal(result.run.stoppedReason, 'model-aborted');
  assert.equal(result.events.at(-1).status, 'stopped');
  assert.equal(result.exitCode, 1);
});

test('recovered SDK retry retains error history and records final success', async () => {
  const result = await exercise('retry-recovered');
  assert.equal(result.run.status, 'completed');
  assert.equal(result.usage.error, null);
  assert.equal(result.exitCode, 0);
  assert.ok(result.events.some(event => event.message?.errorMessage === '429 retryable failure'));
  assert.ok(result.events.some(event => event.type === 'auto_retry_end' && event.success));
});
