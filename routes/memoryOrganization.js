'use strict';
const express = require('express');
const { isAdmin, fail } = require('../memory-core/principal');
const { organizationStore } = require('../memory-core/organizationStore');
const { organizationScope, getOrganizationConfig, saveOrganizationConfig } = require('../memory-core/organizationConfig');
const { fragmentSources, memoryRows, memorySource, readConversation, conversationSource } = require('../memory-core/organizationSources');
const { prepareOrganization, saveOrganization, undoOrganization } = require('../memory-core/organizationDrafts');
const { runOrganization } = require('../memory-core/organizationTasks');
const { getRecentBriefing, acknowledgeBriefing } = require('../memory-core/recentBriefing');
const { listActivities, recordActivity, annotateActivity } = require('../memory-core/activities');
const { scopedGateway } = require('../memory-core/memoryGateway');
const { scopeOwner } = require('../memory-core/recallPolicy');

module.exports = function memoryOrganization(memoryDB, chatsDB) {
  const router = express.Router();
  const handle = fn => async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try { res.json(await fn({ ...req.query, ...req.body }, req.residentPrincipal)); }
    catch (e) { res.status(e.statusCode || 500).json({ error: e.statusCode ? e.message : '操作失败，原资料保留' }); }
  };
  router.get('/config', handle(async (input, principal) => {
    const scope = await organizationScope(memoryDB, input, principal), settings = await memoryDB.getSettings();
    return { config: await getOrganizationConfig(scope.id), timer: await organizationStore().get(`timer:${scope.id}`),
      canManageModel: isAdmin(principal), model: isAdmin(principal) ? {
        apiUrl: settings.scheduler_api_url || '', model: settings.scheduler_model || '', hasKey: Boolean(settings.scheduler_api_key),
      } : undefined };
  }));
  router.patch('/config', handle(async (input, principal) => {
    const scope = await organizationScope(memoryDB, input, principal);
    return { config: await saveOrganizationConfig(scope.id, input) };
  }));
  router.patch('/model', handle(async (input, principal) => {
    if (!isAdmin(principal)) fail('模型连接由管理端设置');
    const patch = {};
    if (input.apiUrl !== undefined) {
      const url = String(input.apiUrl).trim();
      if (url && !/^https?:\/\//i.test(url)) fail('请填写有效的 API 地址', 400);
      patch.scheduler_api_url = url;
    }
    if (input.model !== undefined) patch.scheduler_model = String(input.model).trim().slice(0, 200);
    if (input.apiKey) patch.scheduler_api_key = String(input.apiKey).trim();
    await memoryDB.setSettings(patch);
    return { ok: true };
  }));
  router.get('/sources', handle(async (input, principal) => {
    const scope = await organizationScope(memoryDB, input, principal);
    const rows = input.all === 'true' ? (await memoryRows(memoryDB, scope)).filter(row => !row.v2?.organization &&
      scopeOwner(row) === (scope.id === 'shared' ? '' : scope.id)).map(memorySource) : await fragmentSources(memoryDB, scope, chatsDB);
    const chats = scope.id !== 'shared' && chatsDB?.search ? await chatsDB.search({ residentId: scope.id, limit: 100 }) : { items: [] };
    return { items: rows.slice(0, 200), total: rows.length, candidateIds: (await fragmentSources(memoryDB, scope, chatsDB)).map(row => row.id),
      conversations: chats.items.map(row => ({ id: row.id, title: row.title, date: row.date })) };
  }));
  router.get('/source', handle(async (input, principal) => {
    const scope = await organizationScope(memoryDB, input, principal);
    if (input.kind === 'conversation') return conversationSource(await readConversation(chatsDB, input.id, scope.id));
    const row = await scopedGateway(memoryDB, scope.principal).getById(input.id);
    if (!row || row.is_deleted) fail('原文已删除或不可用', 404);
    return memorySource(row);
  }));
  router.get('/history', handle(async (input, principal) => {
    const scope = await organizationScope(memoryDB, input, principal);
    const db = scopedGateway(memoryDB, isAdmin(principal) ? principal : scope.principal);
    const drafts = (await organizationStore().list({ kind: 'draft', residentId: scope.id, status: 'saved' })).slice(0, 50);
    const items = [];
    for (const draft of drafts) {
      const memories = (await Promise.all(draft.saved.map(id => db.getById(id)))).filter(row => row && !row.is_deleted);
      if (memories.length) items.push({ id: draft._id, createdAt: draft.createdAt, memories,
        sources: draft.sources.map(({ content, ...row }) => row) });
    }
    return { items };
  }));
  router.post('/preview', handle((input, principal) => prepareOrganization(memoryDB, chatsDB, input, principal)));
  router.post('/save', handle((input, principal) => saveOrganization(memoryDB, chatsDB, input, principal)));
  router.post('/undo', handle((input, principal) => undoOrganization(memoryDB, input, principal)));
  router.post('/run', handle((input, principal) => runOrganization(memoryDB, chatsDB, input, principal)));
  router.post('/briefing', handle((input, principal) => getRecentBriefing(memoryDB, chatsDB, input, principal)));
  router.post('/briefing/ack', handle((input, principal) => acknowledgeBriefing(memoryDB, input, principal)));
  router.get('/activities', handle((input, principal) => listActivities(input, principal)));
  router.post('/activities', handle((input, principal) => recordActivity(input, principal)));
  router.patch('/activities', handle((input, principal) => annotateActivity(input, principal)));
  return router;
};
