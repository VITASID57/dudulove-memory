const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { tools, dispatch } = require('./mcp-tools');
function installMcp(app, auth, memoryDB, chatsDB) {
  app.post('/mcp', auth, async (req, res) => {
    const server = new Server({ name: 'dudulove-memory', version: '0.1.0' }, { capabilities: { tools: {} } });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
    server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
      try { return { content: [{ type: 'text', text: JSON.stringify(await dispatch(params.name, params.arguments || {}, req.residentPrincipal, memoryDB, chatsDB)) }] }; }
      catch (error) { return { isError: true, content: [{ type: 'text', text: error.statusCode ? error.message : 'Memory operation failed; check the connection or configuration.' }] }; }
    });
    res.on('close', () => { transport.close(); server.close(); });
    try { await server.connect(transport); await transport.handleRequest(req, res, req.body); }
    catch { if (!res.headersSent) res.status(500).json({ error: 'MCP request failed' }); }
  });
  app.get('/mcp', auth, (_req, res) => res.status(405).end());
  app.delete('/mcp', auth, (_req, res) => res.status(405).end());
}
module.exports = { installMcp };
