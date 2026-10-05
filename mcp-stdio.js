const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
async function main() {
  if (!process.env.MEMORY_API || !process.env.MCP_TOKEN) throw new Error('Set MEMORY_API and the resident MCP_TOKEN');
  const upstream = new Client({ name: 'dudulove-memory-stdio', version: '0.1.0' });
  await upstream.connect(new StreamableHTTPClientTransport(new URL('/mcp', process.env.MEMORY_API), {
    requestInit: { headers: { Authorization: `Bearer ${process.env.MCP_TOKEN}` } },
  }));
  const server = new Server({ name: 'dudulove-memory', version: '0.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => upstream.listTools());
  server.setRequestHandler(CallToolRequestSchema, ({ params }) => upstream.callTool(params));
  await server.connect(new StdioServerTransport());
}
main().catch(() => { console.error('Memory connection failed. Check MEMORY_API and MCP_TOKEN.'); process.exitCode = 1; });
