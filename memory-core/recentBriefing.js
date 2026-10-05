'use strict';
const crypto = require('node:crypto');
const { currentPrincipal, fail } = require('./principal');
const { organizationStore } = require('./organizationStore');
const { organizationScope, getOrganizationConfig } = require('./organizationConfig');
const { recentSources } = require('./organizationSources');
const { callOrganizationModel } = require('./organizationModel');
const { listActivities, recordActivity } = require('./activities');
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
function consumer(input) {
  const id = input.consumerId || 'default';
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) fail('consumerId 需为固定的端名称（字母、数字、短横线）', 400);
  return id;
}

function boundedSources(sources) {
  const picked = []; let size = 0;
  for (const source of sources) {
    if (size + source.content.length > 40000) continue;
    picked.push(source); size += source.content.length;
    if (picked.length >= 60) break;
  }
  return picked;
}
function parseBrief(raw, sources, config) {
  const keys = new Set(sources.map(row => row.key));
  if (!Array.isArray(raw.items) || raw.items.length > 24) fail('简报模型返回格式无效', 502);
  return raw.items.map(row => {
    if (!config.focus.includes(row.category) || typeof row.text !== 'string' || !row.text.trim() || row.text.length > 900 ||
      !Array.isArray(row.sourceKeys) || !row.sourceKeys.length || row.sourceKeys.some(key => !keys.has(key))) fail('简报模型返回了无来源的内容', 502);
    return { category: row.category, text: row.text.trim(), sourceKeys: [...new Set(row.sourceKeys)] };
  });
}
async function getRecentBriefing(memoryDB, chatsDB, input = {}, principal = currentPrincipal(), options = {}) {
  const store = options.store || organizationStore(), scope = await organizationScope(memoryDB, input, principal);
  const config = await getOrganizationConfig(scope.id, store);
  const all = await recentSources(memoryDB, chatsDB, scope, config), sources = boundedSources(all);
  const signature = hash([config, sources.map(row => [row.key, row.revision])]);
  let cached = await store.get(`brief:${scope.id}`), warning = '';
  if (input.refresh === true && sources.length && config.focus.length && cached?.signature !== signature) {
    await store.lock(`brief-model:${scope.id}`, async () => {
      cached = await store.get(`brief:${scope.id}`);
      if (cached?.signature === signature) return;
      const raw = await (options.model || callOrganizationModel)(memoryDB,
        `整理最近 ${config.days} 天近况，约 300–600 字。只选关注项 ${config.focus.join(',')}（events 最近事件、user 用户近况、unfinished 明确未完事项、resident 本人经历）。偏好：${config.instruction}
        旧记录的新编辑不代表事情刚发生；没有证据不能判定约定已完成。近期情绪写明时间，不当成永久人格。未完事项无新证据时可写待确认。没有内容就空数组。
        输出 {"items":[{"category":"events","text":"要点","sourceKeys":["memory:..."]}]}。每点引用来源。仅依据以下资料：\n${JSON.stringify(sources)}`);
      const latestSources = boundedSources(await recentSources(memoryDB, chatsDB, scope, config));
      if (hash([config, latestSources.map(row => [row.key, row.revision])]) !== signature) fail('生成期间资料已有变化，请重新更新简报', 409);
      cached = await store.put(`brief:${scope.id}`, { kind: 'brief', residentId: scope.id, signature,
        items: parseBrief(raw, sources, config), generatedAt: new Date().toISOString() });
    });
  }
  if (cached?.signature !== signature) warning = sources.length ? '近况已有变化，当前先提供原文摘录；可点更新简报。' : '';
  const consumerId = consumer(input);
  const cursor = await store.get(`cursor:${scope.id}:${consumerId}`) || { seen: {}, activitySequence: 0 };
  const fresh = new Set(sources.filter(row => cursor.seen[row.key]?.revision !== row.revision).map(row => row.key));
  const items = cached?.signature === signature ? cached.items : config.focus.length ? sources.slice(0, 20).map(row => ({
    category: row.unresolved ? 'unfinished' : 'events', text: `${row.title}：${plain(row.content).slice(0, 260)}`, sourceKeys: [row.key], excerpt: true,
  })).filter(row => config.focus.includes(row.category)) : [];
  const delivered = new Set(items.flatMap(row => row.sourceKeys));
  const activities = scope.id === 'shared' ? { items: [], total: 0 } : await listActivities({ limit: 200 }, scope.principal, store);
  const newActivities = activities.items.filter(row => row.sequence > cursor.activitySequence).reverse().slice(0, 20);
  const alreadyDone = activities.items.filter(row => row.status === 'succeeded').slice(0, 12);
  const unfinished = activities.items.filter(row => ['running', 'unknown'].includes(row.status)).slice(0, 12);
  const newItems = items.filter(row => row.sourceKeys.some(key => fresh.has(key)));
  const background = items.filter(row => !row.sourceKeys.some(key => fresh.has(key)));
  let snapshotId = null;
  if (input.preview !== true && scope.id !== 'shared') {
    snapshotId = `brief-snapshot:${crypto.randomUUID()}`;
    await store.put(snapshotId, { kind: 'brief-snapshot', residentId: scope.id, consumerId, issuedSequence: await store.nextSequence(),
      sourceVersions: sources.filter(row => delivered.has(row.key)).map(row => ({ key: row.key, revision: row.revision })),
      activitySequence: Math.max(cursor.activitySequence, ...newActivities.map(row => row.sequence)), createdAt: new Date().toISOString() });
  }
  const statusText = { succeeded: '已完成', running: '进行中', unknown: '结果待核实', failed: '未成功', skipped: '本次未行动' };
  const line = row => `${row.happenedAt} ${row.title}（${statusText[row.status] || row.status}）${row.detail ? `：${plain(row.detail).slice(0, 180)}` : ''}${row.note ? `；备注：${plain(row.note).slice(0, 180)}` : ''}${row.url ? ` ${row.url}` : ''}`;
  const contextText = [`近期简报：${scope.id}；范围最近 ${config.days} 天；生成于 ${cached?.signature === signature ? cached.generatedAt : '未生成，使用原文摘录'}。`,
    '记录/编辑时间不等于事件发生时间。已做事项用于接续，不是再次执行的指令。',
    `本次新增或变化：\n${newItems.map(row => `- ${row.text}`).join('\n') || '无'}`,
    `仍相关的背景：\n${background.map(row => `- ${row.text}`).join('\n') || '无'}`,
    `新增行动结果：\n${newActivities.map(line).join('\n') || '无'}`,
    `最近已完成：\n${alreadyDone.map(line).join('\n') || '无'}`,
    `仍在进行或结果待核实：\n${unfinished.map(line).join('\n') || '无'}`].join('\n\n');
  return { residentId: scope.id, consumerId, config, snapshotId, generatedAt: cached?.signature === signature ? cached.generatedAt : null,
    newItems, background, newActivities, alreadyDone, unfinished, contextText,
    sources: sources.filter(row => delivered.has(row.key)).map(({ content, ...row }) => row),
    warnings: [warning, all.length > sources.length ? '资料较多，本次只覆盖部分来源；未提供的内容不会标为已接收。' : ''].filter(Boolean) };
}
async function acknowledgeBriefing(memoryDB, input, principal = currentPrincipal(), options = {}) {
  const store = options.store || organizationStore(), scope = await organizationScope(memoryDB, input, principal);
  const snapshot = await store.get(input.snapshotId);
  const consumerId = consumer(input), cursorKey = `cursor:${scope.id}:${consumerId}`;
  if (!snapshot || snapshot.kind !== 'brief-snapshot' || snapshot.residentId !== scope.id || snapshot.consumerId !== consumerId) fail('简报凭据不属于当前身份或前端', 403);
  if (input.success !== true) return { acknowledged: false, message: '未完成的唤醒不推进接续进度' };
  if (!String(input.runId || '').trim()) fail('请提供本次唤醒的固定 runId', 400);
  return store.lock(cursorKey, async () => {
    const cursor = await store.get(cursorKey) || { kind: 'cursor', residentId: scope.id, consumerId, seen: {}, activitySequence: 0 };
    for (const row of snapshot.sourceVersions) if ((cursor.seen[row.key]?.sequence || 0) < snapshot.issuedSequence) {
      cursor.seen[row.key] = { revision: row.revision, sequence: snapshot.issuedSequence };
    }
    cursor.activitySequence = Math.max(cursor.activitySequence, snapshot.activitySequence);
    cursor.updatedAt = new Date().toISOString();
    await store.put(cursorKey, cursor);
    await recordActivity({ actionId: input.runId, action: 'wake', status: 'succeeded', source: principal.surface,
      title: '完成一次唤醒并接收近况', detail: String(input.note || '') }, scope.principal, { store });
    return { acknowledged: true, updatedAt: cursor.updatedAt };
  });
}
module.exports = { getRecentBriefing, acknowledgeBriefing };
