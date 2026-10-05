const express = require('express');
const cors = require('cors');
const path = require('node:path');
const { authentication, installLogin } = require('./platform/auth');

function createApp(config) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '2mb' }));
  const allowed = String(process.env.MEMORY_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  app.use(cors({ origin(origin, done) { done(null, !origin || allowed.includes(origin)); },
    allowedHeaders: ['Authorization', 'Content-Type', 'MCP-Protocol-Version', 'Mcp-Session-Id', 'X-Memory-Actor-Id'] }));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (req.path.startsWith('/api') || req.path.startsWith('/mcp') || req.path.startsWith('/v1')) res.setHeader('Cache-Control', 'no-store');
    let sameHost = false;
    try { sameHost = new URL(req.headers.origin).host === req.get('host'); } catch { /* No valid origin. */ }
    if (req.headers.origin && !allowed.includes(req.headers.origin) && !sameHost) {
      return res.status(403).json({ error: '此网页来源尚未获准，请在服务端配置 MEMORY_ALLOWED_ORIGINS' });
    }
    next();
  });
  app.get('/health', (_req, res) => res.json({ ok: true, version: '0.1.0' }));
  installLogin(app, config);
  const memoryDB = require('./storage/database'), chatsDB = require('./storage/chats');
  const auth = authentication(config, memoryDB);
  app.use('/api/v2', auth);
  app.use('/api/v2/residents', require('./routes/memoryResidents')(memoryDB));
  app.use('/api/v2/organization', require('./routes/memoryOrganization')(memoryDB, chatsDB));
  app.use('/api/v2', require('./routes/memories')(memoryDB, chatsDB));
  app.use('/api/v2/settings', require('./routes/settings')(memoryDB));
  require('./connectors/mcp').installMcp(app, auth, memoryDB, chatsDB);
  app.use('/v1', auth, require('./connectors/bridge')(memoryDB, config));
  app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny' }));
  app.use((_req, res) => res.status(404).json({ error: 'not found' }));
  app.use((error, _req, res, _next) => res.status(error.status === 413 ? 413 : 400).json({ error: '请求无效或内容过长' }));
  return app;
}
module.exports = { createApp };
