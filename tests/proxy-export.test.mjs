import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { createProxy } from '../src/traced-mcp-proxy.mjs';
import { inspectTrace } from '../scripts/trace-inspect.mjs';
import { exportTraces } from '../src/trace-export.mjs';
import { listRuns, pidAlive } from '../src/runtime.mjs';
import { createPlatformTools } from '../src/platform.mjs';
const root=path.resolve(import.meta.dirname,'..');

test('proxy preserves tools/prompts/resources, traces metadata and serializes calls; OTLP redacts payloads', {timeout:30000}, async()=>{
  const proxy=await createProxy({name:'fixture',command:process.execPath,args:[path.join(root,'tests/fixtures/proxy-backend.mjs')],cwd:root,resource:'vivado',timeoutMs:2000});
  const [a,b]=InMemoryTransport.createLinkedPair();
  const client=new Client({name:'offline-proxy-test',version:'1'});
  try {
    await proxy.server.connect(b); await client.connect(a);
    assert.equal((await client.listTools()).tools.length,3);
    assert.equal((await client.listPrompts()).prompts.length,1);
    assert.equal((await client.getPrompt({name:'fixture_prompt'})).messages.length,1);
    assert.equal((await client.readResource({uri:'fixture://status'})).contents[0].text,'ready');
    const context={trace_id:'a'.repeat(32),parent_span_id:'b'.repeat(16),parent_run_id:'offline-root'};
    const responses=await Promise.all([client.callTool({name:'echo',arguments:{text:'PRIVATE_PAYLOAD_SENTINEL',delay:100},_meta:{'eda.trace':context}}),client.callTool({name:'failed',arguments:{}})]);
    assert.equal(responses[1].isError,true);
    const dirs=responses.map(r=>r._meta['eda.trace'].directory);
    console.log(`Proxy trace evidence: ${dirs.join(', ')}`);
    const reports=dirs.map(d=>inspectTrace(d));
    assert.ok(reports.every(r=>r.valid));
    assert.equal(reports[0].trace_id,context.trace_id);
    assert.equal(reports[0].parent_span_id,context.parent_span_id);
    const windows=dirs.map(dir=>{
      const events=fs.readFileSync(path.join(dir,'events.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
      return {start:Date.parse(events.find(e=>e.type==='state_transition' && e.status==='running').timestamp_utc),end:Date.parse(events.find(e=>e.type==='run_end').timestamp_utc)};
    }).sort((a,b)=>a.start-b.start);
    assert.ok(windows[0].end<=windows[1].start,'Resource lease must serialize dispatch windows');
    const exported=exportTraces(dirs);
    assert.equal(exported.summary.span_count,2);
    assert.equal(exported.summary.uploaded,false);
    assert.ok(!JSON.stringify(exported.payload).includes('PRIVATE_PAYLOAD_SENTINEL'));
    assert.deepEqual(exported.payload.resourceSpans[0].scopeSpans[0].spans.map(s=>s.status.code),[1,2]);
    for(const span of exported.payload.resourceSpans[0].scopeSpans[0].spans) assert.match(span.startTimeUnixNano,/^\d{19}$/);
    fs.writeFileSync(path.join(dirs[0],'offline-export.json'),JSON.stringify(exported.payload,null,2));
    const exportTool=createPlatformTools(root).find(t=>t.name==='eda_trace');
    const exportReply=await exportTool.execute('export-offline',{directory:dirs[0],action:'export'});
    assert.equal(exportReply.details.uploaded,false);assert.ok(fs.existsSync(exportReply.details.output));
    const responseFile=path.join(dirs[0],'mcp-response.json'), originalResponse=fs.readFileSync(responseFile);
    try {fs.writeFileSync(responseFile,'tampered');assert.equal(inspectTrace(dirs[0]).valid,false);assert.throws(()=>exportTraces([dirs[0]]),/Invalid evidence/);}
    finally {fs.writeFileSync(responseFile,originalResponse);}
    const slow=await client.callTool({name:'slow',arguments:{delay:10000}},{timeout:10000});
    assert.equal(slow.isError,true);
    const timed=inspectTrace(slow._meta['eda.trace'].directory);
    assert.equal(timed.status,'timed_out'); assert.equal(timed.valid,true);
    const blocked=await client.callTool({name:'echo',arguments:{}});
    assert.equal(blocked.isError,true);
    assert.match(blocked.content[0].text,/quarantined/);
    assert.ok(listRuns(root).filter(r=>dirs.includes(r.directory)).every(r=>['completed','failed'].includes(r.status)));
  } finally { await client.close(); await proxy.close(); }
});

test('production community proxy exposes 45 tools and 11 prompts without starting Vivado', {timeout:45000},async()=>{
  const client=new Client({name:'community-static-contract',version:'1'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.join(root,'src/traced-mcp-proxy.mjs'),'vivado-community'],cwd:root,stderr:'pipe'});
  let errors=''; transport.stderr?.on('data',b=>{errors+=b;});
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length,45,errors);
    assert.equal((await client.listPrompts()).prompts.length,11);
    const resources=await client.listResources(); assert.ok(resources.resources.length>0);
    const response=await client.callTool({name:'run_tcl',arguments:{session_id:'no-session-offline-check',command:'puts SHOULD_NEVER_EXECUTE'}});
    assert.equal(response.isError,true);
    const report=inspectTrace(response._meta['eda.trace'].directory); assert.equal(report.valid,true); assert.equal(report.status,'failed');
  } finally { await client.close(); }
});

test('cancelling a dispatched proxy call closes its owned backend and records cancellation', {timeout:20000},async()=>{
  const name=`cancel-fixture-${Date.now()}`;
  const proxy=await createProxy({name,command:process.execPath,args:[path.join(root,'tests/fixtures/proxy-backend.mjs')],cwd:root,resource:'vivado',timeoutMs:10000});
  const pid=proxy.transport.pid, [a,b]=InMemoryTransport.createLinkedPair(), client=new Client({name:'cancel-test',version:'1'});
  try {
    await proxy.server.connect(b);await client.connect(a);
    const controller=new AbortController();
    const call=client.callTool({name:'slow',arguments:{delay:10000}},{signal:controller.signal});
    const rejected=assert.rejects(call);
    let run;
    const deadline=Date.now()+5000;
    while(Date.now()<deadline) {
      run=listRuns(root).find(r=>r.tool===`mcp_${name}_slow`);
      if(run?.status==='running') break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(run?.status,'running');controller.abort();await rejected;
    const end=Date.now()+5000;
    while(Date.now()<end) {
      run=listRuns(root).find(r=>r.run_id===run.run_id);
      if(run.status==='cancelled') break;
      await new Promise(resolve=>setTimeout(resolve,20));
    }
    assert.equal(run.status,'cancelled');assert.equal(pidAlive(pid),false);
    assert.equal(inspectTrace(run.directory).valid,true);
  } finally {await client.close();await proxy.close();}
});
