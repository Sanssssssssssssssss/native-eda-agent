// Local stdio only: stdout belongs exclusively to the official MCP SDK.
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createJiti } from 'jiti';
import { McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { mcpTraceContext } from './trace.mjs';
const root = path.resolve(import.meta.dirname, '..');
process.chdir(root);
const extension = await createJiti(import.meta.url).import('./extension.ts', { default: true });
const registry = new Map();
extension({ registerTool: tool => registry.set(tool.name, tool) });
export function createServer() {
  const server = new McpServer({ name: 'eda-local', version: '0.2.0' });
  for (const tool of registry.values()) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: fromJsonSchema(JSON.parse(JSON.stringify(tool.parameters))) }, async (args, ctx) => {
      try {
        const result = await tool.execute(`mcp-${randomUUID()}`, args, ctx.mcpReq.signal, undefined,
          { edaTraceContext: mcpTraceContext(ctx) });
        return { content: result.content, structuredContent: result.details };
      } catch (error) {
        return { content: [{ type: 'text', text: String(error) }], isError: true,
          structuredContent: { error: String(error), receipt: error.receipt || null } };
      }
    });
  }
  return server;
}
serveStdio(createServer);
