const { scopedGateway } = require('../memory-core/memoryGateway');
const { toV2Memory } = require('../memory-core/mappers');
const { BOARDS } = require('../memory-core/classifier');
const { assembleResidentContext } = require('../memory-core/context');
const { createMemory } = require('../services/writes');
const { getRecentBriefing, acknowledgeBriefing } = require('../memory-core/recentBriefing');
const { recordActivity, listActivities } = require('../memory-core/activities');
const { prepareOrganization, saveOrganization } = require('../memory-core/organizationDrafts');
const text = { type: 'string' };
const tool = (name, description, properties = {}, required = []) => ({ name, description,
  inputSchema: { type: 'object', properties, required } });
const tools = [
  tool('get_briefing', 'Retrieve relevant memory within the identity and user-granted read scope before replying. Include contextText in the model context.', { query: text, projectId: text, sessionId: text, mode: { enum: ['chat','work','task','awakening'] }, limitTokens: { type: 'integer' } }),
  tool('search_memory', 'Search memories within the authenticated identity.', { query: text, ownerLibrary: text, projectId: text, board: { enum: Object.keys(BOARDS) }, limit: { type: 'integer' } }),
  tool('get_memory', 'Read a complete memory by ID.', { id: text }, ['id']),
  tool('save_memory', 'Save a memory. Use pulse for daily fragments, private for long-term memory. Identity comes from the connection.', { title: text, content: text, board: { enum: Object.keys(BOARDS) }, shared: { type: 'boolean' }, type: text, projectId: text, lifecycle: { enum: ['inbox','active','open_loop','archived'] }, requestId: text }, ['title','content','board']),
  tool('update_memory', 'Edit a memory while preserving its original time. Pass expectedUpdatedAt to detect competing edits.', { id: text, title: text, content: text, lifecycle: { enum: ['inbox','active','open_loop','archived'] }, expectedUpdatedAt: text }, ['id']),
  tool('delete_memory', 'Move a memory to recoverable trash.', { id: text }, ['id']),
  tool('restore_memory', 'Restore a deleted memory.', { id: text }, ['id']),
  tool('get_recent_briefing', 'Get recent changes and actual actions. Preview does not consume delivery progress.', { preview: { type: 'boolean' }, refresh: { type: 'boolean' }, consumerId: text }),
  tool('complete_briefing', 'Acknowledge the delivered snapshot only after a successful run.', { snapshotId: text, runId: text, success: { type: 'boolean' }, consumerId: text }, ['snapshotId','runId','success']),
  tool('record_activity', 'Record an actual action result; this tool does not execute the action.', { actionId: text, action: text, source: text, title: text, detail: text, status: { enum: ['running','succeeded','failed','unknown','skipped'] }, happenedAt: text, url: text }, ['actionId','action','status']),
  tool('list_activities', 'Read this identity’s recorded actions.', { limit: { type: 'integer' }, actionId: text }),
  tool('preview_memory_organization', 'Use the separately configured organizer model to prepare an editable summary.', { memoryIds: { type: 'array', items: text }, text, title: text }),
  tool('save_memory_organization', 'Save a reviewed summary; original material remains available.', { draftId: text }, ['draftId']),
];
async function dispatch(name, input, principal, memoryDB, chatsDB) {
  const db = scopedGateway(memoryDB, principal);
  switch (name) {
    case 'get_briefing': return assembleResidentContext(db, input, principal, { chatsDB });
    case 'search_memory': {
      const rows = await db.search({ ...input, q: input.query, layer: BOARDS[input.board]?.layer, limit: Math.min(200, Math.max(1, Number(input.limit) || 20)) });
      return { items: rows.map(toV2Memory), warnings: rows.warnings || [] };
    }
    case 'get_memory': return toV2Memory(await db.getById(input.id));
    case 'save_memory': return toV2Memory(await createMemory(db, input));
    case 'update_memory': return toV2Memory(await db.update(input.id, input));
    case 'delete_memory': return { ok: await db.delete(input.id) };
    case 'restore_memory': return { ok: await db.restore(input.id) };
    case 'get_recent_briefing': return getRecentBriefing(memoryDB, chatsDB, input, principal);
    case 'complete_briefing': return acknowledgeBriefing(memoryDB, input, principal);
    case 'record_activity': return recordActivity(input, principal);
    case 'list_activities': return listActivities(input, principal);
    case 'preview_memory_organization': return prepareOrganization(memoryDB, chatsDB, input, principal);
    case 'save_memory_organization': return saveOrganization(memoryDB, chatsDB, input, principal);
    default: throw new Error('Unknown memory tool');
  }
}
module.exports = { tools, dispatch };
