const express = require('express');
const { isAdmin } = require('../memory-core/principal');
const embeddings = require('../memory-core/embeddings');
module.exports = memoryDB => {
  const router = express.Router();
  router.use((req, res, next) => isAdmin(req.residentPrincipal) ? next() : res.status(403).json({ error: '需要管理登录' }));
  router.get('/embedding', async (_req, res) => {
    try {
      const settings = await memoryDB.getSettings();
      res.json({ apiUrl: settings.embedding_api_url || '', model: settings.embedding_model || '', hasKey: Boolean(settings.embedding_api_key),
        status: await embeddings.getStatus(memoryDB, settings) });
    } catch { res.status(500).json({ error: '向量设置暂不可用' }); }
  });
  router.patch('/embedding', async (req, res) => {
    try {
      const patch = {};
      if (req.body.apiUrl !== undefined) {
        const url = String(req.body.apiUrl).trim();
        if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'API 地址无效' });
        patch.embedding_api_url = url;
      }
      if (req.body.model !== undefined) patch.embedding_model = String(req.body.model).trim().slice(0, 200);
      if (req.body.apiKey) patch.embedding_api_key = String(req.body.apiKey).trim();
      await memoryDB.setSettings(patch); res.json({ ok: true });
    } catch { res.status(500).json({ error: '保存设置失败' }); }
  });
  router.post('/embedding/rebuild', async (_req, res) => {
    try { await embeddings.ensureAll(memoryDB, await memoryDB.getSettings()); res.json({ ok: true }); }
    catch { res.status(502).json({ error: '索引暂未完成，记忆正文仍可使用' }); }
  });
  return router;
};
