// Repeatable local integration receipt. Provider APIs are never initialized here.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createTrace, runProcess } from '../src/trace.mjs';
import { inspectTrace } from './trace-inspect.mjs';
const root = path.resolve(import.meta.dirname, '..');
const real = process.argv.includes('--real');
const trace = createTrace({ root, tool: 'platform_validation', args: { real }, toolCallId: randomUUID() });
const abort = new AbortController(); process.on('SIGINT', () => abort.abort());
const result = { schema_version: 1, mode: real ? 'offline-and-real-mcp' : 'offline', model_api_calls: 0, checks: [] };
for (const dir of ['src', 'benchmarks', 'knowledge', '.pi/skills', '.eda', 'tests']) {
  for (const file of fs.readdirSync(path.join(root, dir), { recursive: true })) {
    if (file.split(path.sep).includes('__pycache__') || file.endsWith('.pyc')) continue;
    const source = path.join(root, dir, file);
    if (fs.statSync(source).isFile()) trace.capture(source, 'validation_input');
  }
}
for (const file of ['package.json', 'package-lock.json', 'scripts/validate-platform.mjs']) trace.capture(path.join(root, file), 'validation_input');
let client;
try {
  await runProcess(trace, process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--prefix', root, 'test'], { signal: abort.signal, timeoutMs: 300000 });
  result.checks.push({ name: 'offline_suite', passed: true });
  if (real) {
    client = new Client({ name: 'eda-real-acceptance', version: '1.0.0' });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src/mcp-server.mjs')], cwd: root, stderr: 'inherit' }));
    const run = await client.callTool({ name: 'eda_xsim', arguments: {
      sources: ['examples/digital/counter.v', 'examples/digital/tb_counter.sv'], top: 'tb_counter', capture_top_wave: false,
    } }, { timeout: 180000, signal: abort.signal });
    if (run.isError) throw new Error(JSON.stringify(run));
    const evidence = run.structuredContent;
    const transcript = fs.readFileSync(path.join(evidence.directory, 'process.log'), 'utf8');
    if (!/COUNTER_PASS checks=321 wraps=1 holds=7 resets=3/.test(transcript) || /\b(?:FATAL|FAIL)\b/.test(transcript)) throw new Error('Counter acceptance marker missing or failure present');
    const inspection = inspectTrace(evidence.directory);
    if (!inspection.valid) throw new Error(`Trace invalid: ${JSON.stringify(inspection.validation_issues)}`);
    result.checks.push({ name: 'real_counter_through_mcp', passed: true, directory: evidence.directory, trace_valid: inspection.valid });
  }
  result.passed = true;
} catch (error) { result.passed = false; result.error = String(error); process.exitCode = 1; }
finally {
  await client?.close();
  fs.writeFileSync(path.join(trace.directory, 'validation.json'), JSON.stringify(result, null, 2));
  const receipt = trace.finish(result.passed ? 'completed' : 'failed', result.error);
  console.log(JSON.stringify({ ...result, directory: receipt.directory }, null, 2));
}
