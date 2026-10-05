'use strict';

const { MemoryAdmissionService, serialize } = require('./admission');
const { createMemoryJournal } = require('./memoryJournal');
const { createPrincipal, currentPrincipal, assertPrincipal, resolveScope, isAdmin, fail } = require('./principal');
const { canReadMemory, scopeOwner } = require('./recallPolicy');
const { createProvenance } = require('./provenance');
const { cleanRefs } = require('./sourceAuthority');
const { resolveReadScope } = require('./residentReadAccess');
const { summaryCurrent } = require('./summaryLinks');

const registered = new WeakMap();
function createMemoryGateway(db, { journal = createMemoryJournal(), chatsDB, migrationStore, activityStore, defaultPrincipal = createPrincipal({ residentId: '', actor: 'legacy-adapter', surface: 'legacy' }) } = {}) {
  const provenance = createProvenance({ db, journal, chatsDB });
  const admission = new MemoryAdmissionService({ db, journal, provenance, migrationStore, activityStore });
  function bind(boundPrincipal) {
    const principal = () => boundPrincipal || (currentPrincipal().residentId || isAdmin(currentPrincipal()) ? currentPrincipal() : defaultPrincipal);
    const gateway = Object.create(null);
    for (const key of Object.keys(db)) if (typeof db[key] === 'function') gateway[key] = db[key].bind(db);
    gateway.asPrincipal = value => bind(assertPrincipal(value));
    gateway.principal = principal;
    gateway.journal = journal;
    gateway.admission = admission;
    gateway.search = async (params = {}) => {
      const who = principal();
      const scope = await resolveReadScope(db, who, params);
      if (scope.override) await journal.append({ kind: 'scope-override', actor: who.actor, role: who.role, residentId: scope.residentId, reason: scope.override.reason, operation: 'search' });
      const reader = provenance.session(scope);
      return db.search({ ...params, residentScope: scope,
        candidateFilter: async rows => {
          const allowed = await Promise.all(rows.map(async row => {
            if (scope.ownerFilter && scopeOwner(row) !== scope.ownerFilter) return false;
            if (scope.recallProfile === 'work' && params.projectId && row.v2?.projectId && row.v2.projectId !== params.projectId) return false;
            if (params.workRecall === 'rules' && !['identity', 'boundary', 'preference'].includes(row.v2?.type || row.category)) return false;
            if (params.workRecall === 'open' && row.v2?.lifecycle !== 'open_loop' && !row.v2?.unresolved) return false;
            if ((!isAdmin(who) || params.readPolicy) && await reader.suppressed(row)) return false;
            if (row.v2?.organization && !await summaryCurrent(row, db, chatsDB)) {
              row.organizationStale = true;
              return isAdmin(who) && !params.readPolicy;
            }
            return true;
          }));
          return rows.filter((_row, index) => allowed[index]);
        },
        readPolicy: params.readPolicy ? { ...params.readPolicy, ...scope } : undefined });
    };
    gateway.getById = async (id, params = {}) => {
      const who = principal();
      const scope = await resolveReadScope(db, who, params);
      if (scope.override) await journal.append({ kind: 'scope-override', actor: who.actor, role: who.role, residentId: scope.residentId, reason: scope.override.reason, operation: 'get', memoryId: id });
      const row = await db.getById(id);
      if (row && !canReadMemory({ ...row, is_deleted: false }, { ...scope, allResidents: isAdmin(who) && !scope.override })) fail('Memory is outside Resident scope');
      if (row?.v2?.organization) row.organizationStale = !await summaryCurrent(row, db, chatsDB);
      return row;
    };
    gateway.create = (input, grant) => admission.create(input, principal(), grant);
    gateway.update = (id, input, grant) => admission.update(id, { reason: 'memory edit through legacy adapter', ...input }, principal(), grant);
    gateway.resolveEvidence = async (row, ref, params = {}, archive) => {
      const scope = await resolveReadScope(db, principal(), params);
      const reader = provenance.session(scope, archive);
      // Always reread the stored row; the caller cannot replace its provenance.
      const stored = await db.getById(row.id);
      if (!stored || await reader.suppressed(stored)) return null;
      return reader.resolve(ref, stored);
    };
    gateway.rejectSource = async (ref, input = {}) => {
      const who = principal();
      if (!isAdmin(who) && !who.capabilities.includes('provenance:reject')) fail('Source rejection requires management permission');
      if (!String(input.reason || '').trim()) fail('Source rejection requires a reason', 400);
      const scope = resolveScope(who, input);
      const sourceRefs = cleanRefs([ref]);
      const resolved = await provenance.session(scope).resolve(sourceRefs[0], { v2: { ownerLibrary: scope.residentId } });
      if (!resolved) fail('Source must resolve before rejection', 400);
      return journal.reject({ residentId: scope.residentId || 'shared', sourceRefs, actor: who.actor, reason: input.reason });
    };
    gateway.delete = (id, input = {}) => admission.remove(id, principal(), { reason: 'explicit memory deletion', ...input });
    gateway.permanentDelete = (id, input = {}) => admission.remove(id, principal(), { reason: 'explicit permanent memory deletion', ...input }, true);
    gateway.findSimilar = async (title, content, layer) => {
      const { normalizedHash } = require('./memoryJournal');
      const rows = await gateway.search({ layer, semantic: false, limit: Number.MAX_SAFE_INTEGER });
      return rows.find(row => normalizedHash(row.content) === normalizedHash(content)) || null;
    };
    gateway.restore = (id, input = {}) => serialize(db, async () => {
      const before = await admission.readForMutation(id, principal(), input);
      if (!before) return false;
      // Undo restores the record's usefulness as well as its visibility.
      return admission.mutate('restore', id, before, { ...before, is_deleted: false }, principal(),
        input.reason || 'restore memory', input, async () => {
          await journal.clearRejection(id);
          await db.update(id, { v2: { ...before.v2, lifecycle: before.v2?.lifecycle === 'rejected' ? 'active' : before.v2?.lifecycle || 'active' } });
          return db.restore(id);
        });
    });
    gateway.getTrash = async () => (await db.getTrash()).filter(row => canReadMemory({ ...row, is_deleted: false }, { residentId: principal().residentId, allResidents: isAdmin(principal()) }));
    gateway.emptyTrash = async () => {
      if (!isAdmin(principal())) fail('Empty trash requires management permission');
      let count = 0;
      for (const row of await db.getTrash()) if (await gateway.permanentDelete(row.id, { override: row.v2?.ownerLibrary ? { residentId: row.v2.ownerLibrary, reason: 'manual empty trash' } : undefined })) count++;
      return count;
    };
    registered.set(gateway, gateway);
    return gateway;
  }
  return bind();
}
function scopedGateway(db, principal) {
  if (!registered.has(db)) {
    if (!db.asPrincipal) {
      if (!registered.has(db)) registered.set(db, createMemoryGateway(db));
      return registered.get(db).asPrincipal(principal);
    }
  }
  return (registered.get(db) || db).asPrincipal(principal);
}
module.exports = { createMemoryGateway, scopedGateway };
