'use strict';

const crypto = require('node:crypto');
const Datastore = require('@seald-io/nedb');

function normalizedHash(value) {
  const text = String(value || '').replace(/<[^>]*>/g, ' ').normalize('NFKC')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/[\s\p{P}\p{S}]+/gu, '').toLowerCase();
  return crypto.createHash('sha256').update(text).digest('hex');
}
function refKeys(refs = []) {
  return refs.filter(ref => ref && typeof ref === 'object' && ref.id)
    .map(ref => JSON.stringify([ref.kind === 'legacy-memory' ? 'memory' : ref.kind || 'source', String(ref.id), ref.messageId || '']));
}
function sameSource(left, right) {
  const a = JSON.parse(left), b = JSON.parse(right);
  return a[0] === b[0] && a[1] === b[1] && (!a[2] || !b[2] || a[2] === b[2]);
}
function createMemoryJournal({ filename } = {}) {
  const db = new Datastore(filename ? { filename, autoload: true } : { inMemoryOnly: true });
  return {
    async append(event) {
      return db.insertAsync({ ...event, timestamp: new Date().toISOString() });
    },
    async list({ memoryId, residentId, kind, limit = 100 } = {}) {
      const query = {};
      if (memoryId) query.memoryId = memoryId;
      if (residentId) query.residentId = residentId;
      if (kind) query.kind = kind;
      return db.findAsync(query).sort({ timestamp: -1 }).limit(Math.min(Number(limit) || 100, 1000));
    },
    async isRejected({ residentId, content, sourceRefs }) {
      const hash = normalizedHash(content);
      const keys = refKeys(sourceRefs);
      const rows = await db.findAsync({ kind: 'rejection', residentId, withdrawn: { $ne: true } });
      return rows.some(row => (content !== undefined && row.normalizedHash === hash) || row.sourceKeys.some(key => keys.some(candidate => sameSource(key, candidate))));
    },
    async attestedSources(memoryId) {
      return db.findAsync({ kind: 'source-attestation', memoryId });
    },
    async clearRejection(memoryId) {
      return db.updateAsync({ kind: 'rejection', memoryId }, { $set: { withdrawn: true } }, { multi: true });
    },
    async reject({ memoryId, residentId, content, sourceRefs, actor, reason, migrationId }) {
      return this.append({ kind: 'rejection', memoryId, residentId, normalizedHash: content === undefined ? null : normalizedHash(content),
        sourceKeys: refKeys(sourceRefs), sourceRefs, actor, reason, migrationId });
    },
  };
}
module.exports = { createMemoryJournal, normalizedHash, refKeys };
