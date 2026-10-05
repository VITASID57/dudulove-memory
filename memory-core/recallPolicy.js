'use strict';

const { memoryOwnerLibrary } = require('./privateAccess');
const { boardFromLayer } = require('./classifier');

const PERSONAL_LEGACY = new Set(['core', 'broadcast', 'fragments', 'user_notes', 'incubator']);
const LOW_INFORMATION = /^(?:哈+|嘿+|嘻+|嗯+|唔+|哦+|好+|行+|可以|你好|您好|嗨|hello|hi|爱你|想你|晚安|早安|在吗|宝宝|宝贝|老公|老婆|亲爱的|普通日常|么么哒|抱抱|[.。!！?？~～…]+)$/i;

function shouldRetrieveMemory(query) {
  const text = String(query || '').replace(/[\s！!。.,，?？~～]+$/g, '').trim();
  return Boolean(text) && !LOW_INFORMATION.test(text);
}
function boardOf(memory) { return memory.board || memory.v2?.board || boardFromLayer(memory.layer || memory.legacy?.layer); }
function scopeOwner(memory) {
  const owner = memoryOwnerLibrary(memory);
  if (owner) return owner;
  return '';
}
function canReadMemory(memory, scope = {}) {
  if (!memory || memory.is_deleted || memory.legacy?.is_deleted) return false;
  const board = boardOf(memory);
  const owner = scopeOwner(memory);
  if (scope.allResidents) return true;
  if (owner) return owner === scope.residentId || Boolean(scope.readableResidentIds?.includes(owner));
  // Unbound private rows and unknown owner values are never treated as shared.
  if (['private', 'diary'].includes(board)) return false;
  const claimed = memory.ownerLibrary || memory.owner || memory.v2?.ownerLibrary || memory.v2?.owner;
  if (claimed) return false;
  return ['world', 'pulse', 'ops', 'tools', 'shared_world'].includes(board);
}
function eligibleForContext(memory, policy = {}) {
  const board = boardOf(memory);
  const meta = memory.v2 || memory;
  if (!canReadMemory(memory, policy)) return false;
  if (['archived', 'rejected'].includes(meta.lifecycle)) return false;
  // Inbox means unsorted, not unusable. Tentative interpretations remain labelled at recall.
  if (meta.validTo && new Date(meta.validTo).getTime() <= Date.now()) return false;
  if (memory.expires_at && new Date(memory.expires_at).getTime() <= Date.now()) return false;
  if (board !== 'world' && (meta.worldbook || meta.domain === 'worldbook' || meta.domain === 'client-runtime')) return false;
  if (policy.readPrivate === false && scopeOwner(memory)) return false;
  if (policy.readShared === false && !scopeOwner(memory)) return false;
  if (policy.mode === 'social' && !['social', 'public'].includes(meta.visibility)) return false;
  if (policy.recallProfile !== 'work' && ['work', 'task'].includes(policy.mode) && board === 'private' &&
      !['identity', 'boundary', 'preference', 'relationship'].includes(meta.type || memory.category)) return false;
  return true;
}
function filterCandidates(docs, scope, policy) {
  return docs.filter(doc => (!scope || canReadMemory(doc, scope)) && (!policy || eligibleForContext(doc, policy)));
}

module.exports = { shouldRetrieveMemory, boardOf, scopeOwner, canReadMemory, eligibleForContext, filterCandidates };
