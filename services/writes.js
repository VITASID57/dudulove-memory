const crypto = require('node:crypto');
const { organizationStore } = require('../memory-core/organizationStore');
const { fail, resolveScope } = require('../memory-core/principal');
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function createMemory(db, input) {
  if (!input.requestId) return db.create(input);
  if (typeof input.requestId !== 'string' || input.requestId.length > 160) fail('requestId 无效', 400);
  const principal = db.principal();
  const key = `write:${digest([principal.role, resolveScope(principal, input).residentId, input.requestId])}`;
  const signature = digest(input), store = organizationStore();
  return store.lock(key, async () => {
    const prior = await store.get(key);
    if (prior && prior.signature !== signature) fail('同一个 requestId 不能用于不同内容', 409);
    if (prior?.memoryId) return db.getById(prior.memoryId);
    await store.put(key, { kind: 'write-receipt', signature });
    // Recover a committed write if a process stopped before its receipt was saved.
    const recovered = (await db.search({ semantic: false, limit: 100000 }))
      .find(row => row.v2?.requestReceiptKey === key);
    const result = recovered || await db.create({ ...input, v2: { ...input.v2, requestReceiptKey: key } });
    await store.put(key, { kind: 'write-receipt', signature, memoryId: result.id });
    return result;
  });
}
module.exports = { createMemory };
