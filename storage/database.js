const Datastore = require('@seald-io/nedb');
const path = require('node:path');
const embeddings = require('../memory-core/embeddings');
const { createMemoryGateway } = require('../memory-core/memoryGateway');
const { createMemoryJournal } = require('../memory-core/memoryJournal');
const dataDir = process.env.MEMORY_DATA_DIR;
if (!dataDir) throw new Error('Initialize the data directory before loading storage');
const db = new Datastore({ filename: path.join(dataDir, 'memories.db'), autoload: true });
const settingsDb = new Datastore({ filename: path.join(dataDir, 'settings.db'), autoload: true });
settingsDb.ensureIndex({ fieldName: 'key', unique: true });
function format(doc) {
  if (!doc) return null;
  return {
    id: doc._id,
    title: doc.title,
    content: doc.content,
    category: doc.category,
    layer: doc.layer || 'longterm',
    tags: doc.tags || [],
    source: doc.source,
    author: doc.author || null,
    mood: doc.mood || null,
    importance: doc.importance !== undefined ? doc.importance : 5,
    v2: doc.v2 || {},
    organizationStale: Boolean(doc.organizationStale),
    expires_at: doc.expires_at || null,
    is_deleted: doc.is_deleted || false,
    deleted_at: doc.deleted_at || null,
    created_at: doc.created_at,
    updated_at: doc.updated_at
  };
}
function affectedCount(result) {
  if (typeof result === 'number') return result;
  if (result && typeof result === 'object') {
    return result.numAffected ?? result.affectedDocuments ?? result.count ?? 0;
  }
  return 0;
}
const memoryDB = { search: require('./search')(db, format), async create({ id, title, content, category = 'general', layer = 'longterm', tags = [], source = 'manual', author = null, mood = null, created_at = null, importance = 5, v2 = {} }) {
    const now = created_at ? new Date(created_at).toISOString() : new Date().toISOString();
    const expires_at = null;
    const doc = await db.insertAsync({
      ...(id ? { _id: id } : {}),
      title, content, category, layer, tags, source, author, mood,
      importance: Number(importance) || 5,
      v2: v2 && typeof v2 === 'object' ? v2 : {},
      expires_at, created_at: now, updated_at: now
    });
    const memory = format(doc);
    this._embedSoon(memory);
    return memory;
  },
_embedSoon(memory) {
    setImmediate(async () => {
      try {
        const settings = await this.getSettings();
        await embeddings.embedMemory(memory, settings);
      } catch (e) {
        console.warn('Embedding unavailable; memory remains saved.');
      }
    });
  },
async getById(id) {
    const doc = await db.findOneAsync({ _id: id });
    return format(doc);
  },
async update(id, { title, content, category, layer, tags, source, author, mood, created_at, importance, v2 }) {
    const current = await this.getById(id);
    if (!current) return null;

    const newLayer = layer !== undefined ? layer : current.layer;
    const expires_at = null;
    const set = {
      title: title ?? current.title,
      content: content ?? current.content,
      category: category ?? current.category,
      layer: newLayer,
      tags: tags !== undefined ? tags : current.tags,
      source: source !== undefined ? source : current.source,
      author: author !== undefined ? author : current.author,
      mood: mood !== undefined ? mood : current.mood,
      importance: importance !== undefined ? Number(importance) || 5 : current.importance,
      v2: v2 !== undefined ? (v2 && typeof v2 === 'object' ? v2 : {}) : (current.v2 || {}),
      expires_at,
      created_at: current.created_at,
      updated_at: new Date(Math.max(Date.now(), (Date.parse(current.updated_at) || 0) + 1)).toISOString()
    };

    await db.updateAsync({ _id: id }, { $set: set });
    const updated = await this.getById(id);
    this._embedSoon(updated);
    return updated;
  },
async delete(id) {
    const now = new Date().toISOString();
    const n = await db.updateAsync({ _id: id }, { $set: { is_deleted: true, deleted_at: now } });
    return affectedCount(n) > 0;
  },
async restore(id) {
    const n = await db.updateAsync({ _id: id }, { $set: { is_deleted: false, deleted_at: null } });
    return affectedCount(n) > 0;
  },
async permanentDelete(id) {
    const n = await db.removeAsync({ _id: id }, {});
    embeddings.removeEmbedding(id).catch(() => {});
    return affectedCount(n) > 0;
  },
async getTrash() {
    const docs = await db.findAsync({ is_deleted: true }).sort({ deleted_at: -1 });
    return docs.map(format);
  },
async getSettings() {
    const docs = await settingsDb.findAsync({});
    const result = {};
    docs.forEach(d => { result[d.key] = d.value; });
    return result;
  },
async setSetting(key, value) {
    const existing = await settingsDb.findOneAsync({ key });
    if (existing) {
      await settingsDb.updateAsync({ key }, { $set: { value } });
    } else {
      await settingsDb.insertAsync({ key, value });
    }
  },
async setSettings(obj) {
    for (const [key, value] of Object.entries(obj)) {
      await this.setSetting(key, value);
    }
  } };
module.exports = createMemoryGateway(memoryDB, {
 activityStore: require('../memory-core/organizationStore').organizationStore(),
 journal: createMemoryJournal({ filename: path.join(dataDir, 'memory_audit.db') }),
 chatsDB: require('./chats'),
});
