'use strict';

const { listActivities } = require('./activities');

const pending = row => row.lifecycle === 'open_loop' || row.unresolved;
const priority = row => (pending(row) ? 4 : 0) + (['project', 'tool'].includes(row.type) ? 2 : 0);
const newest = row => Date.parse(row.updatedAt || row.createdAt) || 0;
const unique = rows => [...new Map(rows.map(row => [row.id, row])).values()];

async function workLanes(read, { query, limit, projectId, mode }) {
  const own = options => read({ ...options, ownOnly: true, projectId });
  const rules = await own({ layer: 'private', semantic: false, workRecall: 'rules', limit: 40 });
  const identity = rules.filter(row => ['identity', 'boundary', 'preference'].includes(row.type))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.importance - a.importance).slice(0, 4);
  const [related, ops] = query ? await Promise.all([
    Promise.all(['private', 'pulse', 'world'].map(layer => read({ layer, q: query, projectId, limit: limit * 2 }))).then(rows => rows.flat()),
    read({ layer: 'ops', q: query, projectId, limit: 4 }),
  ]) : [[], []];
  // Open loops are recorded facts, not tasks inferred from casual conversation.
  const open = mode === 'social' ? [] : (await own({ layer: 'private', semantic: false, workRecall: 'open', limit: 20 }))
    .sort((a, b) => newest(b) - newest(a)).slice(0, 4);
  const seen = new Set(identity.map(row => row.id));
  const association = unique([...open, ...related]).filter(row => !seen.has(row.id))
    .sort((a, b) => priority(b) - priority(a) || newest(b) - newest(a)).slice(0, limit);
  return { identity, association, ops };
}

async function workActivities(principal, store) {
  const { items } = await listActivities({ limit: 100, excludeMemoryChanges: true }, principal, store);
  const external = items.filter(row => !/^memory[.:]/.test(row.action));
  return external.sort((a, b) => Number(['running', 'unknown'].includes(b.status)) - Number(['running', 'unknown'].includes(a.status)) || b.sequence - a.sequence)
    .slice(0, 6).map(row => ({ id: row._id, board: 'activity', type: 'event', ownerLibrary: row.residentId,
      title: row.title, content: `状态=${row.status}；行动=${row.action}；来源=${row.source}；行动编号=${row.actionId}；发生于=${row.happenedAt}；${row.detail}${row.note ? `；备注=${row.note}` : ''}`,
      createdAt: row.createdAt, updatedAt: row.updatedAt, status: row.status, actionId: row.actionId }));
}

module.exports = { workLanes, workActivities };
