'use strict';
const crypto = require('node:crypto');
const { organizationStore } = require('./organizationStore');
const { currentPrincipal, resolveScope, fail } = require('./principal');
const STATUSES = new Set(['running', 'succeeded', 'failed', 'unknown', 'skipped']);
const short = (value, limit) => String(value || '').trim().slice(0, limit);

function activityOwner(input, principal) {
  const id = resolveScope(principal, input).residentId;
  if (!id) fail('活动记录需要绑定身份', 400);
  return id;
}
async function recordActivity(input, principal = currentPrincipal(), options = {}) {
  const store = options.store || organizationStore();
  const residentId = activityOwner(input, principal);
  const actionId = short(input.actionId, 160), action = short(input.action, 80);
  const source = short(input.source || principal.surface, 80);
  if (!actionId || !action || !STATUSES.has(input.status)) fail('活动需要 actionId、action 和有效 status', 400);
  const id = `activity:${crypto.createHash('sha256').update(JSON.stringify([residentId, source, actionId])).digest('hex')}`;
  return store.lock(id, async () => {
    const before = await store.get(id);
    if (before && before.action !== action) fail('同一个行动编号已经用于其他行为', 409);
    if (before && before.status === input.status && before.title === short(input.title || action, 200) &&
        before.detail === short(input.detail, 2400) && before.url === short(input.url, 1800)) return { ...before, repeated: true };
    if (before && before.status !== 'running' && before.status !== 'unknown') {
      if (input.status === before.status) return { ...before, repeated: true };
      fail('已结束的活动不能改成另一个结果，请记录新的行动', 409);
    }
    const now = new Date().toISOString();
    const happenedAt = input.happenedAt ? new Date(input.happenedAt) : new Date();
    if (!Number.isFinite(happenedAt.getTime()) || happenedAt.getTime() > Date.now() + 300000) fail('活动发生时间无效', 400);
    const url = short(input.url, 1800);
    if (url && !/^https?:\/\//i.test(url)) fail('活动链接必须是网页地址', 400);
    const result = { kind: 'activity', residentId, actionId, action, source, status: input.status,
      title: short(input.title || action, 200), detail: short(input.detail, 2400), url,
      happenedAt: before?.happenedAt || happenedAt.toISOString(), createdAt: before?.createdAt || now, updatedAt: now,
      verified: Boolean(options.verified), sequence: await store.nextSequence(),
      note: before?.note || '', noteUpdatedAt: before?.noteUpdatedAt || '',
      previousStatus: before?.status || '', originId: short(input.originId, 180) };
    return store.put(id, result);
  });
}
async function listActivities(input = {}, principal = currentPrincipal(), store = organizationStore()) {
  const residentId = activityOwner(input, principal);
  let items = await store.list({ kind: 'activity', residentId });
  if (input.excludeMemoryChanges === true) items = items.filter(row => !/^memory[.:]/.test(row.action));
  if (input.afterSequence !== undefined) items = items.filter(row => row.sequence > Number(input.afterSequence));
  if (input.actionId) items = items.filter(row => row.actionId === input.actionId);
  const offset = Math.max(0, Number(input.offset) || 0), limit = Math.max(1, Math.min(200, Number(input.limit) || 50));
  return { items: items.slice(offset, offset + limit), total: items.length };
}
async function annotateActivity(input, principal = currentPrincipal(), store = organizationStore()) {
  const residentId = activityOwner(input, principal);
  return store.lock(input.id, async () => {
    const row = await store.get(input.id);
    if (!row || row.kind !== 'activity' || row.residentId !== residentId) fail('找不到当前身份的活动', 404);
    return store.put(input.id, { ...row, note: short(input.note, 2000), noteUpdatedAt: new Date().toISOString(), sequence: await store.nextSequence() });
  });
}
module.exports = { recordActivity, listActivities, annotateActivity };
