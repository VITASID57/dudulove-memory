'use strict';
const { scopedGateway } = require('./memoryGateway');
const { scopeOwner, boardOf } = require('./recallPolicy');
const { sourceRevision, summaryCurrent } = require('./summaryLinks');
const { fail } = require('./principal');
const { checkPayload } = require('./admissionPolicy');

function memorySource(row) {
  return { key: `memory:${row.id}`, kind: 'memory', id: row.id, title: row.title,
    content: row.content, createdAt: row.created_at, updatedAt: row.updated_at,
    revision: sourceRevision(row), owner: scopeOwner(row), board: boardOf(row),
    unresolved: Boolean(row.v2?.unresolved), organization: row.v2?.organization };
}
function conversationSource(row) {
  return { key: `conversation:${row.id}`, kind: 'conversation', id: row.id, title: row.title,
    content: row.raw_content || (row.messages || []).map(m => `${m.role || m.speaker || '说话者未注明'}: ${m.content || m.text || ''}`).join('\n'),
    createdAt: row.created_at, updatedAt: row.updated_at, revision: sourceRevision(row), owner: row.residentId };
}
async function readConversation(chatsDB, id, owner) {
  const row = await chatsDB?.getById?.(id);
  if (!row || !row.residentId || row.residentId !== owner) fail('聊天不属于所选身份，或尚未绑定身份', 403);
  return row;
}
async function memoryRows(memoryDB, scope) {
  const db = scopedGateway(memoryDB, scope.principal);
  const rows = await db.search({ semantic: false, limit: 10000 });
  return rows.filter(row => scope.id === 'shared' ? !scopeOwner(row) : scopeOwner(row) === scope.id || !scopeOwner(row))
    .filter(row => !['archived', 'rejected'].includes(row.v2?.lifecycle));
}
async function fragmentSources(memoryDB, scope, chatsDB) {
  const db = scopedGateway(memoryDB, scope.principal);
  const rows = await memoryRows(memoryDB, scope);
  const covered = new Set();
  for (const row of rows) if (row.v2?.organization && await summaryCurrent(row, db, chatsDB)) {
    for (const ref of row.v2.organization.sources || []) if (ref.kind === 'memory') covered.add(`${ref.id}:${ref.revision}`);
  }
  return rows.filter(row => scopeOwner(row) === (scope.id === 'shared' ? '' : scope.id) &&
    ['pulse', 'fragments'].includes(boardOf(row)) && !row.v2?.organization &&
    !covered.has(`${row.id}:${sourceRevision(row)}`)).map(memorySource).reverse();
}
async function selectedSources(memoryDB, chatsDB, scope, input) {
  const db = scopedGateway(memoryDB, scope.principal), sources = [];
  if ((input.memoryIds?.length || 0) + (input.conversationIds?.length || 0) > 80) fail('一次最多整理 80 条，请分批选择', 400);
  for (const id of [...new Set(input.memoryIds || [])]) {
    const row = await db.getById(id);
    if (!row || row.is_deleted) fail('所选记忆已删除，请刷新后重选', 409);
    if (scopeOwner(row) !== (scope.id === 'shared' ? '' : scope.id)) fail('请把本人记忆和共享记忆分开整理', 400);
    if (row.v2?.organization) fail('请选择原始记忆，避免重复压缩已有小结', 400);
    sources.push(memorySource(row));
  }
  for (const id of [...new Set(input.conversationIds || [])]) sources.push(conversationSource(await readConversation(chatsDB, id, scope.id)));
  if (String(input.text || '').trim()) {
    if (scope.id === 'shared') fail('粘贴聊天请先选择对应的身份', 400);
    const content = String(input.text).trim();
    checkPayload({ title: '待整理聊天', content });
    sources.push({ key: 'text:pasted', kind: 'text', id: 'pasted', title: String(input.title || '手动整理的聊天'), content, owner: scope.id });
  }
  if (!sources.length) fail('请勾选记忆、聊天或粘贴一段内容', 400);
  if (sources.reduce((n, s) => n + s.content.length, 0) > 48000) fail('这批原文过长，请分批整理；不会截掉后半段', 413);
  return sources;
}
async function recentSources(memoryDB, chatsDB, scope, config) {
  const cutoff = Date.now() - config.days * 86400000;
  const rows = await memoryRows(memoryDB, scope);
  const memories = rows.filter(row => !row.v2?.organization && ['pulse', 'private', 'diary', 'fragments'].includes(boardOf(row)) &&
    (Date.parse(row.updated_at || row.created_at) >= cutoff || row.v2?.unresolved)).slice(0, 150).map(memorySource);
  const chats = config.includeChats && scope.id !== 'shared' && chatsDB?.search
    ? await chatsDB.search({ residentId: scope.id, dateFrom: new Date(cutoff).toISOString().slice(0, 10), limit: 30 }) : { items: [] };
  for (const chat of chats.items) memories.push(conversationSource(await readConversation(chatsDB, chat.id, scope.id)));
  return memories;
}
module.exports = { memoryRows, memorySource, conversationSource, readConversation, fragmentSources, selectedSources, recentSources };
