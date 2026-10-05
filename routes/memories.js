const express = require('express');
const { scopedGateway } = require('../memory-core/memoryGateway');
const { toV2Memory } = require('../memory-core/mappers');
const { BOARDS } = require('../memory-core/classifier');
const { assembleResidentContext } = require('../memory-core/context');
const { scopeOwner } = require('../memory-core/recallPolicy');
const { createMemory } = require('../services/writes');
const { fail } = require('../memory-core/principal');

function memories(memoryDB, chatsDB) {
  const router = express.Router();
  const handle = fn => async (req, res) => {
    try { res.json(await fn(scopedGateway(memoryDB, req.residentPrincipal), req)); }
    catch (e) { res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : '记忆操作失败，原资料保留', duplicate: e.duplicate }); }
  };
  router.get('/boards', (_req, res) => res.json({ items: Object.entries(BOARDS).map(([id, data]) => ({ id, label: data.label })) }));
  router.post('/context/assemble', handle((db, req) => assembleResidentContext(db, req.body, req.residentPrincipal, { chatsDB })));
  router.post('/memories/search', handle(async (db, req) => {
    const input = req.body || {};
    if (input.board && !BOARDS[input.board]) fail('分类无效', 400);
    const rows = await db.search({ q: input.query || '', layer: BOARDS[input.board]?.layer, semantic: input.semantic,
      ownerLibrary: input.ownerLibrary, projectId: input.projectId, limit: 100000 });
    let items = rows.map(toV2Memory);
    if (input.ownerLibrary) items = items.filter(row => row.ownerLibrary === input.ownerLibrary);
    if (input.shared === true) items = items.filter(row => !row.ownerLibrary);
    if (input.lifecycle) items = items.filter(row => row.lifecycle === input.lifecycle);
    const total = items.length, offset = Math.max(0, Number(input.offset) || 0), limit = Math.max(1, Math.min(500, Number(input.limit) || 50));
    return { items: items.slice(offset, offset + limit), total, warnings: rows.warnings || [] };
  }));
  router.get('/trash', handle(async (db, req) => {
    const rows = await db.getTrash();
    return { items: rows.filter(row => !req.query.ownerLibrary || scopeOwner(row) === req.query.ownerLibrary).map(toV2Memory) };
  }));
  router.post('/memories', handle(async (db, req) => toV2Memory(await createMemory(db, req.body || {}))));
  router.get('/memories/:id/history', handle(async (db, req) => {
    if (!await db.getById(req.params.id)) { const e = new Error('找不到记忆'); e.statusCode = 404; throw e; }
    const revisions = await db.journal.list({ memoryId: req.params.id, kind: 'revision', limit: 1000 });
    return { items: revisions.filter(row => row.status === 'committed') };
  }));
  router.get('/memories/:id', handle(async (db, req) => {
    const row = await db.getById(req.params.id);
    if (!row) { const e = new Error('找不到记忆'); e.statusCode = 404; throw e; }
    return toV2Memory(row);
  }));
  router.patch('/memories/:id', handle(async (db, req) => {
    const row = await db.update(req.params.id, req.body || {});
    if (!row) fail('找不到记忆', 404);
    return toV2Memory(row);
  }));
  router.delete('/memories/:id', handle(async (db, req) => ({ ok: await db.delete(req.params.id) })));
  router.post('/memories/:id/restore', handle(async (db, req) => ({ ok: await db.restore(req.params.id) })));
  return router;
}
module.exports = memories;
