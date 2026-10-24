// Direct native tool entry: creates no model session and makes no model API calls.
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createJiti } from 'jiti';
import { createTrace } from '../src/trace.mjs';
const registry = new Map();
const extension = await createJiti(import.meta.url).import('../src/extension.ts', { default: true });
extension({ registerTool: tool => registry.set(tool.name, tool) });
const [name, input] = process.argv.slice(2);
const abort = new AbortController();
process.on('SIGINT', () => abort.abort());
let parsed;
try {
  if (!registry.has(name) || !input) throw new Error('Usage: node scripts/eda-tool.mjs TOOL arguments.json');
  parsed = JSON.parse(fs.readFileSync(input, 'utf8'));
  const result = await registry.get(name).execute(`codex-local-${randomUUID()}`, parsed,
    abort.signal, update => console.log(update.content?.[0]?.text || 'Running'));
  console.log(JSON.stringify(result.details, null, 2));
  if (result.isError) process.exitCode = 1;
} catch (error) {
  console.error(String(error));
  let receipt = error.receipt;
  if (!receipt) {
    const trace = createTrace({ root: path.resolve(import.meta.dirname, '..'), tool: name || 'invalid_tool', args: parsed ?? { argument_file: input ?? null }, toolCallId: `codex-local-${randomUUID()}` });
    if (input) trace.capture(input, 'argument_file');
    receipt = trace.finish('failed', error);
  }
  console.log(JSON.stringify(receipt, null, 2));
  process.exitCode = 1;
}
