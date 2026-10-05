'use strict';
const path = require('node:path');
const fs = require('node:fs');
const Datastore = require('@seald-io/nedb');
const stores = new Map();

function createOrganizationStore(filename) {
  if (filename) fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Datastore(filename ? { filename, autoload: true } : { inMemoryOnly: true });
  const queues = new Map();
  const store = {
    get: id => db.findOneAsync({ _id: id }),
    list: (query = {}) => db.findAsync(query).sort({ sequence: -1, updatedAt: -1 }),
    async put(id, value) {
      await db.updateAsync({ _id: id }, { ...value, _id: id }, { upsert: true });
      return { ...value, _id: id };
    },
    async lock(key, fn) {
      const next = (queues.get(key) || Promise.resolve()).catch(() => {}).then(fn);
      queues.set(key, next);
      try { return await next; } finally { if (queues.get(key) === next) queues.delete(key); }
    },
    nextSequence() {
      return store.lock('sequence', async () => {
        const value = ((await store.get('sequence'))?.value || 0) + 1;
        await store.put('sequence', { kind: 'sequence', value });
        return value;
      });
    },
  };
  return store;
}
function organizationStore() {
  const filename = path.join(process.env.MEMORY_DATA_DIR || path.resolve('data'), 'memory_organization.db');
  if (!stores.has(filename)) stores.set(filename, createOrganizationStore(filename));
  return stores.get(filename);
}
module.exports = { createOrganizationStore, organizationStore };
