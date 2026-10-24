import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

test('official MCP client discovers registry, calls local preflight and rejects invalid tool input', { timeout: 60000 }, async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const client = new Client({ name: 'eda-offline-contract', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [path.join(root, 'src/mcp-server.mjs')], cwd: root, stderr: 'pipe' });
  let stderr = ''; transport.stderr?.on('data', b => { stderr += b; });
  try {
    await client.connect(transport);
    const listing = await client.listTools();
    assert.equal(listing.tools.length, 53);
    assert.ok(listing.tools.some(t => t.name === 'eda_vivado_reports'));
    assert.ok(listing.tools.some(t => t.name === 'eda_benchmark'));
    assert.ok(listing.tools.find(t=>t.name==='eda_vivado_optimize').inputSchema.properties.resume_from);
    const result = await client.callTool({ name: 'eda_preflight', arguments: {}, _meta:{traceparent:`00-${'d'.repeat(32)}-${'e'.repeat(16)}-01`} });
    assert.ok(!result.isError, stderr);
    assert.equal(result.structuredContent.config.model_api_enabled, false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(result.structuredContent.evidence,'run.json'),'utf8')).trace_id,'d'.repeat(32));
    const bad = await client.callTool({ name: 'eda_xsim', arguments: { sources: [], top: 42 } });
    assert.equal(bad.isError, true);
    const knowledge = await client.callTool({ name: 'eda_knowledge', arguments: { query: 'clock', limit: 2 } });
    assert.ok(!knowledge.isError, JSON.stringify(knowledge));
    assert.ok(knowledge.structuredContent.rules.length > 0);
    const scores=await client.callTool({name:'eda_results_list',arguments:{unit:'rtl_task'}});
    assert.ok(!scores.isError);assert.equal(scores.structuredContent.records.length,3);
    const incompatible=await client.callTool({name:'eda_results_compare',arguments:{baseline:'verilogeval-24-original',candidate:'verilogeval-24-extended'}});
    assert.equal(incompatible.structuredContent.comparable,false);
    const plan=await client.callTool({name:'eda_benchmark_plan',arguments:{ids:['counter']}});
    assert.ok(!plan.isError,JSON.stringify(plan));
    const override=await client.callTool({name:'eda_benchmark_plan',arguments:{action:'run'}});
    assert.equal(override.isError,true);
    const workflow=await client.callTool({name:'eda_workflow_plan',arguments:{spec:'examples/workflows/offline-review.json'}});
    assert.ok(!workflow.isError,JSON.stringify(workflow));assert.equal(workflow.structuredContent.launches_eda,false);
    const fixture=fs.mkdtempSync(path.join(root,'artifacts/mcp-workflow-reject-'));
    const spec=JSON.parse(fs.readFileSync(path.join(root,'examples/workflows/offline-review.json')));
    spec.steps=[{id:'reject',tool:'eda_preflight',args:{},checks:[{pointer:'/config/model_api_enabled',op:'eq',value:true}]}];
    fs.writeFileSync(path.join(fixture,'task.json'),JSON.stringify(spec));
    const rejected=await client.callTool({name:'eda_workflow_run',arguments:{spec:path.relative(root,path.join(fixture,'task.json'))}});
    assert.equal(rejected.isError,true);assert.equal(rejected.structuredContent.outcome,'checks_failed');
  } finally { await client.close(); }
});
