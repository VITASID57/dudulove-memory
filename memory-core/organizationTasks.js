'use strict';
const { createPrincipal, currentPrincipal } = require('./principal');
const { organizationStore } = require('./organizationStore');
const { organizationScope, getOrganizationConfig } = require('./organizationConfig');
const { fragmentSources } = require('./organizationSources');
const { prepareOrganization, saveOrganization } = require('./organizationDrafts');
const { getRecentBriefing } = require('./recentBriefing');

async function runOrganization(memoryDB, chatsDB, input = {}, principal = currentPrincipal(), options = {}) {
  const store = options.store || organizationStore(), scope = await organizationScope(memoryDB, input, principal);
  return store.lock(`organize:${scope.id}`, async () => {
    const config = await getOrganizationConfig(scope.id, store);
    const candidates = await fragmentSources(memoryDB, scope, chatsDB);
    const sources = []; let size = 0;
    for (const source of candidates) {
      if (source.content.length + size > 48000) continue;
      sources.push(source); size += source.content.length;
      if (sources.length >= 30) break;
    }
    if (sources.length < config.minFragments) return { created: [], counts: { created: 0 }, message: `待整理碎片 ${candidates.length} 条，积累到 ${config.minFragments} 条再自动整理` };
    const signature = sources.map(row => `${row.id}:${row.revision}`).join('|');
    const last = await store.get(`last-empty:${scope.id}`);
    if (last?.signature === signature) return { created: [], counts: { created: 0 }, message: '这批内容已检查，没有需要新增的小结' };
    const draft = await prepareOrganization(memoryDB, chatsDB, { residentId: scope.id, memoryIds: sources.map(row => row.id) }, principal, options);
    if (!draft.memories.length) {
      await store.put(`last-empty:${scope.id}`, { kind: 'empty-batch', residentId: scope.id, signature });
      return { created: [], counts: { created: 0 }, message: '没有需要新增的小结，原文保留' };
    }
    const result = await saveOrganization(memoryDB, chatsDB, { residentId: scope.id, draftId: draft.id }, principal, options);
    if (!result.created.length) await store.put(`last-empty:${scope.id}`, { kind: 'empty-batch', residentId: scope.id, signature });
    return result;
  });
}
async function tickOrganization(memoryDB, chatsDB, options = {}) {
  const store = options.store || organizationStore();
  const configs = await store.list({ kind: 'config', 'config.autoEnabled': true });
  const results = [];
  for (const row of configs) {
    await store.lock(`timer:${row.residentId}`, async () => {
      const key = `timer:${row.residentId}`, previous = await store.get(key);
      if (previous && Date.now() - Date.parse(previous.attemptedAt) < 86400000) return;
      const principal = createPrincipal({ role: 'admin', residentId: row.residentId === 'shared' ? '' : row.residentId, actor: 'organizer', surface: 'scheduler' });
      const state = { kind: 'timer', residentId: row.residentId, attemptedAt: new Date().toISOString() };
      await store.put(key, { ...state, status: 'running' });
      try {
        const result = await runOrganization(memoryDB, chatsDB, { residentId: row.residentId }, principal, options);
        await getRecentBriefing(memoryDB, chatsDB, { residentId: row.residentId, refresh: true, preview: true }, principal, options);
        await store.put(key, { ...state, status: 'succeeded', message: result.message || `新增 ${result.created.length} 条小结` });
        results.push({ residentId: row.residentId, result });
      } catch (error) {
        await store.put(key, { ...state, status: 'failed', message: error.message });
        results.push({ residentId: row.residentId, error: error.message });
      }
    });
  }
  return results;
}
module.exports = { runOrganization, tickOrganization };
