const crypto = require('node:crypto');
const { promisify } = require('node:util');
const scrypt = promisify(crypto.scrypt);
const { createPrincipal, runAs } = require('../memory-core/principal');
const { residentForToken } = require('../memory-core/residents');
const equal = (a, b) => {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y);
};

function authentication(config, memoryDB) {
  return async (req, res, next) => {
    try {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '') || (req.path === '/mcp' ? String(req.query.token || '') : '');
      const principal = equal(token, config.value.adminToken)
        ? createPrincipal({ role: 'admin', actor: 'operator', surface: 'api' })
        : await residentForToken(memoryDB, token, 'api');
      if (!principal) return res.status(401).json(req.baseUrl === '/v1'
        ? { schemaVersion: 1, ok: false, code: 'UNAUTHORIZED', partial: false, message: '请提供有效的连接口令' }
        : { error: '请先登录或提供有效的身份连接' });
      req.residentPrincipal = principal;
      return runAs(principal, next);
    } catch { return res.status(500).json({ error: '身份配置暂时无法读取' }); }
  };
}
function installLogin(app, config) {
  let settingUp = false;
  const attempts = new Map();
  const ready = () => Boolean(config.value.passwordHash || process.env.MEMORY_ADMIN_TOKEN);
  app.get('/api/setup', (_req, res) => res.json({ ready: ready() }));
  app.post('/api/setup', async (req, res, next) => {
    if (ready() || settingUp) return res.status(409).json({ error: '管理登录已设置' });
    const password = req.body?.password;
    if (typeof password !== 'string' || password.length < 8 || password.length > 256) return res.status(400).json({ error: '管理密码需为 8–256 个字符' });
    settingUp = true;
    try {
      const salt = crypto.randomBytes(16).toString('hex');
      const hash = (await scrypt(password, salt, 64)).toString('hex');
      Object.assign(config.value, { passwordSalt: salt, passwordHash: hash }); config.save();
      res.json({ token: config.value.adminToken });
    } catch (e) { next(e); } finally { settingUp = false; }
  });
  app.post('/api/auth', async (req, res, next) => {
    const key = req.ip, now = Date.now(), attempt = attempts.get(key) || { count: 0, until: now + 60000 };
    if (attempt.until < now) { attempt.count = 0; attempt.until = now + 60000; }
    if (attempt.count >= 10) return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
    attempt.count++; attempts.set(key, attempt);
    if (attempts.size > 500) for (const [id, item] of attempts) if (item.until < now) attempts.delete(id);
    try {
      const supplied = String(req.body?.password || '');
      if (supplied.length > 256) return res.status(400).json({ error: '输入过长' });
      const hash = config.value.passwordHash ? (await scrypt(supplied, config.value.passwordSalt, 64)).toString('hex') : '';
      if (!equal(hash, config.value.passwordHash) && !equal(supplied, config.value.adminToken)) return res.status(401).json({ error: '管理密码或连接口令不正确' });
      attempts.delete(key); res.json({ token: config.value.adminToken });
    } catch (e) { next(e); }
  });
}
module.exports = { authentication, installLogin };
