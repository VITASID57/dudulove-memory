'use strict';

const { canReadMemory, scopeOwner } = require('./recallPolicy');
const { resolveScope, isAdmin, fail } = require('./principal');
const { cleanRefs, refKey, readSourceGrant } = require('./sourceAuthority');

const memoryRef = ref => ['memory', 'legacy-memory'].includes(ref.kind);
const metaOf = row => row.v2 || row;
const refsOf = row => metaOf(row).sourceRefs || [];

function createProvenance({ db, journal, chatsDB }) {
  function session(scope, archive = chatsDB) {
    const memories = new Map(), attestations = new Map();
    const getMemory = id => {
      if (!memories.has(id)) memories.set(id, Promise.resolve(db.getById(id)));
      return memories.get(id);
    };
    const receipts = id => {
      if (!attestations.has(id)) attestations.set(id, journal.attestedSources ? journal.attestedSources(id) : Promise.resolve([]));
      return attestations.get(id);
    };
    async function rejected(row, refs) {
      const owner = scopeOwner(row) || 'shared';
      for (const residentId of new Set([owner, scope.residentId, 'shared'].filter(Boolean))) {
        if (await journal.isRejected({ residentId, content: residentId === owner ? row.content : undefined, sourceRefs: refs })) return true;
      }
      return false;
    }
    async function suppressed(row, path = new Set()) {
      if (!row || !canReadMemory(row, scope) || metaOf(row).lifecycle === 'rejected') return true;
      const id = row.id || row._id;
      if (path.has(id) || path.size >= 64) return true;
      const next = new Set(path).add(id);
      const refs = refsOf(row);
      if (await rejected(row, [...refs, { kind: 'memory', id }])) return true;
      for (const ref of refs) {
        if (!memoryRef(ref)) continue;
        // The legacy mapper's self pointer is an audit locator, not a dependency.
        if (ref.kind === 'legacy-memory' && ref.id === id) continue;
        const source = await getMemory(ref.id);
        // Shared notes may cite a private note; inaccessible source text stays private,
        // without hiding the independently shared note from its intended readers.
        if (source && canReadMemory(source, scope) && await suppressed(source, next)) return true;
      }
      return false;
    }
    async function resolve(ref, row) {
      const owner = scopeOwner(row) || scope.residentId || 'shared';
      if (await journal.isRejected({ residentId: owner, sourceRefs: [ref] })) return null;
      if (memoryRef(ref)) {
        const source = await getMemory(ref.id);
        if (!source || await suppressed(source)) return null;
        return { trust: 'verified', authority: 'memory-resolver', source };
      }
      if (ref.kind === 'conversation' && archive?.getById) {
        const source = await archive.getById(ref.id);
        if (!source || !scope.residentId || source.residentId !== scope.residentId || source.is_deleted || source.lifecycle === 'rejected') return null;
        const message = ref.messageId ? (source.messages || []).find(item => (item.id || item._id) === ref.messageId) : source.messages?.[0];
        if (!message?.content || message.is_deleted || message.lifecycle === 'rejected') return null;
        return { trust: 'verified', authority: 'conversation-resolver',
          source: { ...source, content: message.content, created_at: message.created_at || source.date } };
      }
      const stored = row?.id ? await receipts(row.id) : [];
      const attested = stored.find(receipt => receipt.residentId === (scopeOwner(row) || 'shared') &&
        receipt.sourceRefs.some(source => refKey(source) === refKey(ref)));
      return attested ? { trust: 'server-attested', authority: attested.authority } : null;
    }
    return { suppressed, resolve, getMemory };
  }

  async function classify(input, principal, { before, grant } = {}) {
    const scope = resolveScope(principal, input);
    const refs = cleanRefs(input.sourceRefs ?? input.v2?.sourceRefs ?? []);
    const reader = session({ ...scope, allResidents: isAdmin(principal) });
    const authorization = readSourceGrant(grant, principal, scope);
    const verifiedRefs = [], sources = [];
    for (const ref of refs) {
      if (memoryRef(ref)) {
        const source = await reader.getMemory(ref.id);
        if (source && !canReadMemory({ ...source, is_deleted: false }, { ...scope, allResidents: isAdmin(principal) })) fail('Source memory is outside Resident scope');
        if (source && !source.is_deleted && await reader.suppressed(source)) fail('Source memory is explicitly rejected', 409);
      }
      const resolved = await reader.resolve(ref, before || { v2: { ownerLibrary: scope.residentId } });
      const attested = authorization?.refs.some(source => refKey(source) === refKey(ref));
      const trust = resolved || (attested ? { trust: 'server-attested', authority: authorization.authority } : null);
      if (trust) verifiedRefs.push(ref);
      sources.push({ ...ref, trust: trust?.trust || 'unverified', authority: trust?.authority || 'caller-metadata' });
    }
    return { refs, verifiedRefs, provenance: { hasSource: verifiedRefs.length > 0, sources }, authorization };
  }
  return { session, classify };
}

module.exports = { createProvenance };
