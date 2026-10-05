const express = require('express');
const { fail } = require('../memory-core/principal');
const { createMemory } = require('../services/writes');
const scope = require('./bridge-scope');
const capabilities = Object.freeze({ schemaVersion: 1, health: true, listCategories: true, search: true, read: true,
  createCategory: false, renameCategory: false, moveCategory: false, createMemory: true, updateMemory: true,
  deleteMemory: true, persistPermissions: false, persistMetadata: true, pagination: true,
  listIdentities: true, validateIdentity: true, restoreMemory: true, exportData: false });

module.exports = (memoryDB, config) => {
  const router = express.Router(), sourceId = config.value.sourceId;
  const handle = fn => async (req, res) => {
    try { scope.namespace(req.body?.namespace || req.query.namespace); res.json(await fn(req)); }
    catch (e) {
      const status = e.statusCode || 500;
      res.status(status).json({ schemaVersion: 1, ok: false, partial: false,
        code: ({400:'INVALID_REQUEST',401:'UNAUTHORIZED',403:'FORBIDDEN',404:'NOT_FOUND',409:'CONFLICT',501:'CAPABILITY_UNSUPPORTED'})[status] || 'INTERNAL_ERROR',
        message: e.statusCode ? e.message : '记忆操作失败，原资料保留' });
    }
  };
  const result = (row, message) => ({ schemaVersion: 1, ok: true, sourceId,
    categoryId: scope.categoryOf(row), memoryId: row.id, code: 'OK', message });
  router.get('/health', handle(async () => ({ schemaVersion: 1, ok: true })));
  router.get('/describe', handle(async req => ({ schemaVersion: 1, sourceId, label: 'DuduLove Memory', capabilities,
    categories: await scope.categories(memoryDB, req.residentPrincipal, sourceId) })));
  router.get('/identities', handle(async req => ({ schemaVersion: 1, identities: await scope.identities(memoryDB, req.residentPrincipal) })));
  router.post('/identities/validate', handle(async req => {
    const identity = (await scope.identities(memoryDB, req.residentPrincipal)).find(r => r.id === req.body.identityId);
    if (!identity) fail('身份不存在或不在当前连接范围内', 403);
    return { schemaVersion: 1, ok: true, identity };
  }));
  router.get('/categories', handle(async req => ({ schemaVersion: 1, categories: await scope.categories(memoryDB, req.residentPrincipal, sourceId) })));
  router.post('/search', handle(async req => {
    const db = await scope.actorDB(memoryDB, req), input = req.body || {};
    const cats = await scope.categories(memoryDB, db.principal(), sourceId);
    if (input.categoryIds != null && (!Array.isArray(input.categoryIds) || input.categoryIds.some(id => !cats.some(c => c.categoryId === id)))) fail('分类不属于当前身份', 403);
    const rows = (await db.search({ q: String(input.query || ''), limit: 100000 }))
      .filter(row => !input.categoryIds || input.categoryIds.includes(scope.categoryOf(row)));
    let offset = 0;
    if (input.cursor) {
      offset = Number(Buffer.from(String(input.cursor), 'base64url').toString());
      if (!Number.isSafeInteger(offset) || offset < 0) fail('分页游标无效', 400);
    }
    const limit = Math.max(1, Math.min(200, Number(input.limit) || 30));
    return { schemaVersion: 1, memories: rows.slice(offset, offset + limit).map(row => ({ schemaVersion: 1,
      id: row.id, memoryId: row.id, title: row.title, content: row.content, sourceId, sourceLabel: 'DuduLove Memory',
      categoryId: scope.categoryOf(row), categoryLabel: cats.find(c => c.categoryId === scope.categoryOf(row))?.name || '',
      score: Number(row.score) || 1, metadata: row.v2?.externalMetadata || {} })),
      nextCursor: offset + limit < rows.length ? Buffer.from(String(offset + limit)).toString('base64url') : null };
  }));
  router.get('/memories/:id', handle(async req => {
    const db = await scope.actorDB(memoryDB, req), row = await db.getById(req.params.id);
    if (!row || row.is_deleted) fail('找不到记忆', 404);
    return { schemaVersion: 1, memory: scope.memory(row, db.principal()) };
  }));
  router.post('/memories', handle(async req => {
    const db = await scope.actorDB(memoryDB, req), input = req.body || {};
    if (input.permissions) fail('此服务通过身份和分类管理权限，不支持自定义权限表', 501);
    const category = await scope.categoryInput(memoryDB, db.principal(), input.categoryId);
    const row = await createMemory(db, { ...category, title: input.title, content: input.content ?? input.body,
      requestId: input.requestId, v2: { externalMetadata: scope.metadata(input.metadata) || {} } });
    return result(row, '已保存');
  }));
  router.patch('/memories/:id', handle(async req => {
    const db = await scope.actorDB(memoryDB, req), before = await db.getById(req.params.id), input = req.body || {};
    if (!before || before.is_deleted) fail('找不到记忆', 404);
    if (input.categoryId && input.categoryId !== scope.categoryOf(before)) fail('暂不支持跨分类移动记忆', 501);
    if (input.permissions) fail('此服务不支持自定义权限表', 501);
    const patch = { expectedUpdatedAt: input.expectedUpdatedAt };
    if (input.title !== undefined) patch.title = input.title;
    if (input.content !== undefined || input.body !== undefined) patch.content = input.content ?? input.body;
    if (input.metadata !== undefined) patch.v2 = { ...before.v2, externalMetadata: scope.metadata(input.metadata) };
    return result(await db.update(req.params.id, patch), '已更新；原记忆时间保留');
  }));
  router.delete('/memories/:id', handle(async req => {
    const db = await scope.actorDB(memoryDB, req), before = await db.getById(req.params.id);
    if (!before) fail('找不到记忆', 404);
    await db.delete(req.params.id); return result(before, '已移入回收站');
  }));
  router.post('/memories/:id/restore', handle(async req => {
    const db = await scope.actorDB(memoryDB, req), before = await db.getById(req.params.id);
    if (!before) fail('找不到记忆', 404);
    await db.restore(req.params.id); return result(before, '已恢复');
  }));
  router.use((_req, res) => res.status(501).json({ schemaVersion: 1, ok: false, partial: false, code: 'CAPABILITY_UNSUPPORTED', message: '暂不支持此能力，请检查 describe' }));
  return router;
};
