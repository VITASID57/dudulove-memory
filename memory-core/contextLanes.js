'use strict';
const { scopeOwner } = require('./recallPolicy');

async function identityLane(read, mode) {
  const rows = (await Promise.all(['world', 'private'].map(layer => read({ layer, identityOnly: true, semantic: false, limit: 20 })))).flat();
  return rows.filter(row => ['active', 'core'].includes(row.lifecycle) &&
    (row.lifecycle === 'core' || ['shared_reality', 'identity', 'relationship', 'self_digest', 'social_boundary'].includes(row.identityRole)) &&
    (row.identityRole || ['identity', 'relationship', 'boundary', 'preference'].includes(row.type)))
    .sort((a, b) => b.importance - a.importance).slice(0, ['work', 'task', 'social'].includes(mode) ? 3 : 6);
}
async function associationLane(read, { query, mode, limit, projectId }) {
  const boards = ['world', 'private', 'pulse'];
  const byBoard = await Promise.all(boards.map(layer => read({ layer, q: query, limit })));
  const association = [];
  for (let i = 0; i < limit; i++) for (const rows of byBoard) if (rows[i]) association.push(rows[i]);
  let ops = [];
  if (['work', 'task', 'maintenance'].includes(mode)) {
    ops = (await read({ layer: 'ops', q: query, limit: 4 })).filter(row => !projectId || !row.projectId || row.projectId === projectId);
  }
  return { association: association.slice(0, limit), ops };
}
async function evidenceLane({ db, chatsDB, rows, residentId, override }) {
  const evidence = [];
  const seen = new Set();
  const prioritized = [...rows].sort((a, b) =>
    Number((b.sourceRefs || []).some(ref => ['memory', 'conversation'].includes(ref.kind))) -
    Number((a.sourceRefs || []).some(ref => ['memory', 'conversation'].includes(ref.kind))));
  for (const row of prioritized) {
    for (const ref of row.sourceRefs || []) {
      if (!ref || !ref.id) continue;
      const key = `${ref.kind}:${ref.id}${ref.messageId ? `:${ref.messageId}` : ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const resolved = await db.resolveEvidence(row, ref, { residentId, override }, chatsDB);
      // An attested locator without a raw-text resolver is not a quotation.
      const source = resolved?.source;
      if (!source) continue;
      evidence.push({ ...row, id: `evidence:${key}`, title: source.title || row.title,
        ownerLibrary: source.residentId || scopeOwner(source) || '',
        summary: '', content: source.content, retrievalExcerpt: undefined, sourceRefs: [{ ...ref, verified: true, createdAt: source.created_at || ref.createdAt }],
        createdAt: source.created_at || ref.createdAt });
      if (evidence.length >= 3) return evidence;
    }
  }
  return evidence;
}
module.exports = { identityLane, associationLane, evidenceLane };
