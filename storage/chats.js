const Datastore = require('@seald-io/nedb');
const path = require('node:path');
const crypto = require('node:crypto');
const db = new Datastore({ filename: path.join(process.env.MEMORY_DATA_DIR, 'chats.db'), autoload: true });
const format = row => row ? { ...row, id: row._id } : null;
module.exports = {
  async create(input) {
    if (!input.residentId) throw new Error('Chat material requires a resident identity');
    const now = new Date().toISOString();
    return format(await db.insertAsync({ _id: crypto.randomUUID(), residentId: input.residentId,
      title: String(input.title || '聊天资料'), source: String(input.source || 'manual'),
      raw_content: String(input.raw_content || ''), messages: input.messages || [],
      created_at: now, updated_at: now, date: now.slice(0, 10) }));
  },
  async getById(id) { return format(await db.findOneAsync({ _id: id })); },
  async search({ residentId, dateFrom, limit = 30 } = {}) {
    if (!residentId) return { items: [] };
    const rows = await db.findAsync({ residentId, ...(dateFrom ? { date: { $gte: dateFrom } } : {}) }).sort({ created_at: -1 }).limit(Math.min(200, limit));
    return { items: rows.map(format) };
  },
};
