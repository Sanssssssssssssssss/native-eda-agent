// Local stdio only: stdout belongs exclusively to the official MCP SDK.
import path from 'node:path';
import fs from 'node:fs';
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
  const server = new McpServer({ name: 'eda-local', version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version });
  for (const tool of registry.values()) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: fromJsonSchema(JSON.parse(JSON.stringify(tool.parameters))) }, async (args, ctx) => {
      try {
        const result = await tool.execute(`mcp-${randomUUID()}`, args, ctx.mcpReq.signal, undefined,
          { edaTraceContext: mcpTraceContext(ctx) });
        return { content: result.content, structuredContent: result.details, ...(result.isError ? {isError:true} : {}) };
      } catch (error) {
        return { content: [{ type: 'text', text: String(error) }], isError: true,
          structuredContent: { error: String(error), receipt: error.receipt || null } };
      }
    });
  }
  return server;
}
serveStdio(createServer);
