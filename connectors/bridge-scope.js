const { createPrincipal, isAdmin, fail } = require('../memory-core/principal');
const { listResidents } = require('../memory-core/residents');
const { scopedGateway } = require('../memory-core/memoryGateway');
const { toV2Memory } = require('../memory-core/mappers');

function namespace(value) {
  if (value && value !== 'default') fail('本服务只有 default 命名空间；不同用户请独立部署', 400);
}
async function identities(db, principal) {
  return (await listResidents(db)).filter(r => isAdmin(principal) || r.id === principal.residentId)
    .map(r => ({ schemaVersion: 1, id: r.id, displayName: r.label }));
}
async function actorDB(db, req) {
  namespace(req.body?.namespace || req.query.namespace);
  const who = req.residentPrincipal;
  const actor = req.body?.actor || (req.query.actorId ? { kind: req.query.actorKind, id: req.query.actorId } : null);
  if (!actor) return scopedGateway(db, who);
  if (actor.kind === 'user') {
    if (!isAdmin(who)) fail('身份连接不能提升为管理身份');
    return scopedGateway(db, who);
  }
  if (actor.kind !== 'resident' || !(await identities(db, who)).some(r => r.id === actor.id)) fail('当前连接不允许使用这个身份');
  return scopedGateway(db, createPrincipal({ residentId: actor.id, surface: 'client', actor: `resident:${actor.id}` }));
}
async function categories(db, principal, sourceId) {
  const rows = [['world', '共享世界观'], ['pulse', '共享近况'], ['ops', '工程经验']];
  for (const r of await identities(db, principal)) rows.push([`private:${r.id}`, `${r.displayName} · 长期记忆`], [`pulse:${r.id}`, `${r.displayName} · 日常碎片`]);
  return rows.map(([categoryId, name], order) => ({ schemaVersion: 1, sourceId, categoryId, name, order,
    parentCategoryId: null, icon: null, memoryCount: null, kind: 'native' }));
}
async function categoryInput(db, principal, id) {
  if (!(await categories(db, principal, '')).some(c => c.categoryId === id)) fail('分类不存在或不属于当前身份', 403);
  const [board, ownerLibrary] = id.split(':');
  return { board, ...(ownerLibrary ? { ownerLibrary } : { shared: true }) };
}
function categoryOf(row) {
  const m = toV2Memory(row);
  return m.ownerLibrary ? `${m.board}:${m.ownerLibrary}` : m.board;
}
function memory(row, principal) {
  if (!row) fail('找不到记忆', 404);
  const m = toV2Memory(row);
  return { schemaVersion: 1, id: m.id, categoryId: categoryOf(row), title: m.title, content: m.content,
    createdAt: m.createdAt, updatedAt: m.updatedAt, deletedAt: row.is_deleted ? (row.deleted_at || m.updatedAt) : null,
    permissions: { schemaVersion: 1, readActorIds: m.ownerLibrary ? [...new Set([m.ownerLibrary, principal?.residentId].filter(Boolean))] : null,
      writeActorIds: m.ownerLibrary ? [m.ownerLibrary] : null }, metadata: row.v2?.externalMetadata || {} };
}
function metadata(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 20000) fail('metadata 需为小于 20KB 的对象', 400);
  return value;
}
module.exports = { namespace, identities, actorDB, categories, categoryInput, categoryOf, memory, metadata };
