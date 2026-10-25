import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import edaTools, { tracedExecute } from './tools/eda.ts';
import { createFpgaTools } from './tools/fpga.mjs';
import { createOptimizerTools } from './tools/optimizer.mjs';
import { createPlatformTools } from './platform.mjs';
import { readConfig, listRuns } from './runtime.mjs';
import { validateArguments } from './tool-contracts.mjs';
import { createWorkflowTools } from './workflow.mjs';
import { createContextTools } from './task-context.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export default function extension(pi: any, options: any = {}) {
  const registry = new Map();
  const registerTool = (tool: any) => { const wrapped = { ...tool, execute: (id: any, args: any, signal: any, update: any, ctx: any) => {
    validateArguments(args,tool.parameters);
    // Pi context contains nonenumerable tools/executeTool and guarded getters.
    const descriptors = ctx ? Object.getOwnPropertyDescriptors(ctx) : {};
    delete descriptors.edaTraceContext;
    const context = Object.defineProperties({}, descriptors);
    Object.defineProperty(context, 'edaTraceContext', { value: {
      ...(ctx?.sessionManager ? { session_id: ctx.sessionManager.getSessionId() } : {}),
      ...(options.traceContext?.() || {}), ...(ctx?.edaTraceContext || {}),
    } });
    return tool.execute(id, args, signal, update, context);
  } }; registry.set(tool.name, wrapped); pi.registerTool(wrapped); };
  edaTools({ registerTool } as any);
  for (const tool of createFpgaTools(root, tracedExecute)) registerTool(tool);
  for (const tool of createOptimizerTools(root, tracedExecute)) registerTool(tool);
  for (const tool of createPlatformTools(root)) registerTool(tool);
  for (const tool of createWorkflowTools(root, registry)) registerTool(tool);
  for (const tool of createContextTools(root, registry)) registerTool(tool);
  if (!pi.on) return; // CLI registry construction has no interactive lifecycle.
  const lifecycle = (event: string, fields = {}) => {
    const dir = path.join(root, '.eda-state'); fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, 'agent-hooks.jsonl'), JSON.stringify({ schema_version: 1,
      timestamp_utc: new Date().toISOString(), event, pid: process.pid, ...fields }) + '\n');
  };
  pi.on('session_start', (event: any) => lifecycle('session_start', { reason: event.reason }));
  pi.on('session_shutdown', (event: any) => lifecycle('session_shutdown', { reason: event.reason }));
  pi.on('input', (_event: any, ctx: any) => {
    try { if (readConfig(root).model_api_enabled) return { action: 'continue' }; }
    catch { lifecycle('config_error', { action: 'model_input_blocked' }); }
    lifecycle('model_input_blocked', { reason: 'model_api_enabled=false' });
    ctx.ui?.notify('模型 API 当前停用；使用 eda CLI / MCP 执行本地测试。启用需修改 .eda/config.json。', 'warning');
    return { action: 'handled' };
  });
  pi.on('tool_call', (event: any) => lifecycle('tool_call', { tool: event.toolName, tool_call_id: event.toolCallId, parent_tool_call_id: event.parentToolCallId }));
  pi.on('tool_result', (event: any) => lifecycle('tool_result', { tool: event.toolName, tool_call_id: event.toolCallId, is_error: event.isError }));
  pi.registerCommand('eda-status', { description: 'Show local job states without a model call', handler: async (_args: any, ctx: any) => ctx.ui.notify(JSON.stringify(listRuns(root).slice(0, 10)), 'info') });
}
