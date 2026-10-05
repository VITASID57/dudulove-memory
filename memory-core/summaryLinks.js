'use strict';
const crypto = require('node:crypto');
const { scopeOwner, canReadMemory } = require('./recallPolicy');
function sourceRevision(row) {
  return crypto.createHash('sha256').update(JSON.stringify([
    row.title, row.content, row.raw_content, row.messages, row.v2?.lifecycle,
    row.is_deleted, scopeOwner(row), row.residentId, row.updated_at || row.updatedAt,
  ])).digest('hex');
}
async function summaryCurrent(row, db, chatsDB) {
  const meta = row.v2?.organization;
  if (!meta) return true;
  if (meta.detached === true) return true;
  for (const source of meta.sources || []) {
    let original;
    try { original = source.kind === 'memory' ? await db.getById(source.id) : await chatsDB?.getById?.(source.id); }
    catch (e) { if ([403, 404].includes(e.statusCode)) return false; throw e; }
    if (!original || original.is_deleted || sourceRevision(original) !== source.revision) return false;
    if (source.kind === 'memory' && !canReadMemory(original, { residentId: scopeOwner(row) })) return false;
    if (source.kind === 'conversation' && original.residentId !== scopeOwner(row)) return false;
  }
  return true;
}
function collapseSummaries(rows) {
  const covered = new Set(rows.filter(row => row.v2?.organization && !row.organizationStale)
    .flatMap(row => row.v2.organization.sources || []).filter(ref => ref.kind === 'memory').map(ref => ref.id));
  return rows.filter(row => !covered.has(row.id));
}
module.exports = { sourceRevision, summaryCurrent, collapseSummaries };
