// Stdio proxy for local EDA backends. No model clients; stdout is MCP only.
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createTrace, mcpTraceContext } from './trace.mjs';
import { acquireResource, createRunState, pidAlive } from './runtime.mjs';

export const root = path.resolve(import.meta.dirname, '..');
export function backendConfig(name) {
  if (name === 'vivado-community') return { name, command: path.join(root, 'runtime/vivado-community-venv/Scripts/python.exe'),
    args: [path.join(root, 'src/vivado_workbench.py')], cwd: path.join(root, 'projects/native-vivado-workbench'),
    env: { VIVADO_PATH: process.env.VIVADO_PATH || 'E:/Xilinx/Vivado/2020.2/bin/vivado.bat', PYTHONUTF8: '1' }, resource: 'vivado', timeoutMs: 1200000 };
  if (name === 'ltspice') return { name, command: path.join(root, 'runtime/ltspice/ltspice-mcp-bridge.exe'), args: [], cwd: root, resource: 'ltspice', timeoutMs: 120000 };
  throw new Error('Backend must be vivado-community or ltspice');
}
function resultFailed(result) {
  if (result.isError) return true;
  return (result.content || []).some(item => {
    if (item.type !== 'text') return false;
    if (/^\s*\[ERROR\]/m.test(item.text)) return true;
    try { return JSON.parse(item.text).ok === false; } catch { return false; }
  });
}
function incomingContext(ctx) { return mcpTraceContext(ctx); }

export async function createProxy(config, workspace = root) {
  const client = new Client({ name: 'eda-traced-proxy', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: config.command, args: config.args, cwd: config.cwd, env: config.env, stderr: 'pipe' });
  // Diagnostics remain on stderr, never mixed into the MCP transport.
  transport.stderr?.on('data', chunk => process.stderr.write(chunk));
  try { await client.connect(transport); } catch (error) { await client.close(); throw error; }
  let quarantined = false, cleanupConfirmed = false;
  const capabilities = client.getServerCapabilities() || {};
  const server = new McpServer({ name: `eda-traced-${config.name}`, version: '1.0.0' }, { capabilities: {
    ...(capabilities.tools ? { tools: {} } : {}), ...(capabilities.prompts ? { prompts: {} } : {}),
    ...(capabilities.resources ? { resources: {} } : {}) } });
  const close = async () => { await terminateOwned(); };
  server.server.onclose = () => { void close().catch(error => process.stderr.write(`EDA proxy cleanup: ${error.message}\n`)); };
  const terminateOwned = async trace => {
    quarantined = true;
    const pid = transport.pid;
    if (pid && pidAlive(pid) !== false) {
      if (process.platform === 'win32') {
        try { await promisify(execFile)('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, timeout: 15000 }); }
        catch (error) { if (pidAlive(pid) !== false) throw error; }
      } else { process.kill(pid, 'SIGTERM'); }
    }
    await client.close();
    cleanupConfirmed = !pid || pidAlive(pid) === false;
    if (!cleanupConfirmed) throw new Error('Owned backend has not exited; resource lease must remain held');
    trace?.event('backend_quarantined', { owned_backend_pid: pid, reconnect_required: true });
  };
  if (capabilities.tools) {
    server.server.setRequestHandler('tools/list', request => client.listTools(request.params));
    server.server.setRequestHandler('tools/call', async (request, ctx) => {
      const { name, arguments: args = {} } = request.params;
      const trace = createTrace({ root: workspace, tool: `mcp_${config.name}_${name}`, toolCallId: `proxy-${randomUUID()}`,
        args: { backend: config.name, tool: name, arguments_sha256: createHash('sha256').update(JSON.stringify(args)).digest('hex') }, context: incomingContext(ctx) });
      const state = createRunState(workspace, trace);
      trace.manifest.owned_backend_pid = transport.pid;
      trace.manifest.coverage = 'MCP boundary; opaque dynamic Tcl dependencies are not captured';
      trace.persist();
      let lease, dispatched = false, safeToRelease = true;
      try {
        state.transition('preflight');
        if (quarantined) throw new Error('Backend quarantined; reconnect this MCP server before continuing.');
        state.transition('snapshotting');
        trace.capture(path.join(root, 'src/traced-mcp-proxy.mjs'), 'proxy');
        if (config.name === 'vivado-community') trace.capture(path.join(root, 'src/vivado_workbench.py'), 'backend');
        state.transition('waiting');
        lease = await acquireResource({ root: workspace, resource: config.resource, runId: trace.manifest.run_id, directory: trace.directory, signal: ctx.mcpReq.signal });
        if (quarantined) throw new Error('Backend quarantined while queued; reconnect required.');
        state.transition('running');
        dispatched = true;
        trace.event('mcp_request', { backend: config.name, name, argument_keys: Object.keys(args) });
        const response = await client.callTool({ name, arguments: args,
          _meta: { traceparent:`00-${trace.manifest.trace_id}-${trace.manifest.span_id}-01`,
            'eda.trace': { trace_id: trace.manifest.trace_id, parent_span_id: trace.manifest.span_id, parent_run_id: trace.manifest.run_id } } },
          { timeout: config.timeoutMs, signal: ctx.mcpReq.signal });
        fs.writeFileSync(path.join(trace.directory, 'mcp-response.json'), JSON.stringify(response, null, 2));
        const failed = resultFailed(response);
        // An upstream textual timeout can leave EDA running despite a normal RPC return.
        const timedOut = failed && /timed out|命令执行超时|等待响应超时/i.test(JSON.stringify(response.content));
        if (timedOut) await terminateOwned(trace);
        trace.event('mcp_response', { is_error: failed, timed_out: timedOut, response_file: 'mcp-response.json',
          sha256: createHash('sha256').update(fs.readFileSync(path.join(trace.directory, 'mcp-response.json'))).digest('hex') });
        state.transition('finalizing');
        const status = timedOut ? 'timed_out' : failed ? 'failed' : 'completed';
        state.transition(status);
        const receipt = trace.finish(status, failed ? new Error('Backend reported an error; inspect mcp-response.json') : null);
        return { ...response, isError: failed, _meta: { ...response._meta, 'eda.trace': { trace_id: receipt.trace_id, span_id: receipt.span_id, directory: receipt.directory, status } } };
      } catch (error) {
        if (dispatched && !quarantined) {
          try { await terminateOwned(trace); }
          catch (cleanup) { safeToRelease = false; trace.event('backend_cleanup_failed', { error_type: cleanup.name, lease_retained: true }); }
        }
        if (dispatched && quarantined && !cleanupConfirmed) safeToRelease = false;
        const status = ctx.mcpReq.signal?.aborted ? 'cancelled' : error.code === 'QUEUE_TIMEOUT' || /timed out|timeout/i.test(error.message) ? 'timed_out' : 'failed';
        if (!['completed', 'failed', 'cancelled', 'timed_out'].includes(state.state.status)) state.transition(status);
        const receipt = trace.finish(status, error);
        return { isError: true, content: [{ type: 'text', text: `${error.message}; evidence: ${receipt.directory}` }],
          _meta: { 'eda.trace': { trace_id: receipt.trace_id, span_id: receipt.span_id, directory: receipt.directory, status } } };
      } finally { if (safeToRelease) lease?.release(); }
    });
  }
  for (const [capability, handlers] of [ ['prompts', { 'prompts/list': 'listPrompts', 'prompts/get': 'getPrompt' }],
    ['resources', { 'resources/list': 'listResources', 'resources/templates/list': 'listResourceTemplates', 'resources/read': 'readResource' }] ]) {
    if (capabilities[capability]) for (const [method, fn] of Object.entries(handlers)) server.server.setRequestHandler(method, (request, ctx) => client[fn](request.params, { signal: ctx.mcpReq.signal }));
  }
  return { server, close, client, transport };
}

async function main() {
  const config = backendConfig(process.argv[2]);
  const proxy = await createProxy(config);
  serveStdio(() => proxy.server);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
