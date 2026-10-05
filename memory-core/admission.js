'use strict';

const crypto = require('node:crypto');
const { prepareAdmission } = require('./admissionPolicy');
const { assertPrincipal, resolveScope, isAdmin, fail } = require('./principal');
const { canReadMemory, scopeOwner } = require('./recallPolicy');
const { normalizedHash } = require('./memoryJournal');
const { cleanRefs } = require('./sourceAuthority');

const queues = new WeakMap();
function serialize(db, callback) {
  const next = (queues.get(db) || Promise.resolve()).catch(() => {}).then(callback);
  queues.set(db, next);
  return next;
}
class MemoryAdmissionService {
  constructor({ db, journal, provenance, migrationStore, activityStore }) { Object.assign(this, { db, journal, provenance, migrationStore, activityStore }); }
  async validate(input, principal, options = {}) {
    assertPrincipal(principal);
    const reason = input.override?.reason || input.reason || options.reason || '';
    let grant = options.grant;
    let classification = await this.provenance.classify(input, principal, { ...options, grant });
    const result = prepareAdmission({ ...input, sourceRefs: classification.refs }, principal,
      { ...options, reason, verifiedRefs: classification.verifiedRefs });
    const { prepared, scope } = result;
    prepared.v2.provenance = classification.provenance;
    if (prepared.v2.promotionEvidence?.sourceRefs) prepared.v2.promotionEvidence = {
      ...prepared.v2.promotionEvidence, sourceRefs: cleanRefs(prepared.v2.promotionEvidence.sourceRefs),
    };
    const owner = scopeOwner(prepared) || 'shared';
    if (await this.journal.isRejected({ residentId: owner, content: prepared.content, sourceRefs: prepared.v2.sourceRefs })) {
      fail('Memory was rejected; matching content/source cannot be re-admitted', 409);
    }
    return { ...result, reason, owner, authorization: classification.authorization };
  }
  create(input, principal, grant) { return serialize(this.db, () => this.createLocked(input, principal, grant)); }
  async createLocked(input, principal, grant) {
    const { prepared, scope, reason, owner, authorization } = await this.validate(input, principal, { grant });
    const existing = await this.db.search({ layer: prepared.layer, residentScope: { residentId: scope.residentId }, limit: Number.MAX_SAFE_INTEGER, semantic: false });
    const duplicate = existing.find(item => scopeOwner(item) === scopeOwner(prepared) && normalizedHash(item.content) === normalizedHash(prepared.content));
    if (duplicate && !(isAdmin(principal) && input.force && reason)) {
      const error = new Error('similar memory found');
      Object.assign(error, { statusCode: 409, duplicate: true, existing: duplicate });
      throw error;
    }
    const id = crypto.randomUUID();
    const operation = prepared.v2.sourceRefs.filter(ref => ref.kind === 'memory').length > 1 ? 'merge' : 'create';
    return this.mutate(operation, id, null, prepared, principal, reason || 'memory admission', input,
      () => this.db.create({ ...prepared, id }), authorization);
  }
  update(id, input, principal, grant) { return serialize(this.db, () => this.updateLocked(id, input, principal, grant)); }
  async updateLocked(id, input, principal, grant) {
    const before = await this.readForMutation(id, principal, input);
    if (!before) return null;
    if (input.expectedUpdatedAt && input.expectedUpdatedAt !== before.updated_at) fail('这条记忆已在其他窗口编辑，请刷新后再保存', 409);
    const merged = { ...before, ...input, v2: { ...before.v2, ...input.v2 } };
    if (input.ownerLibrary !== undefined) merged.v2.ownerLibrary = input.ownerLibrary;
    if (input.shared === true) { merged.ownerLibrary = ''; merged.v2.ownerLibrary = ''; }
    merged.createdAt = before.created_at;
    merged.created_at = before.created_at;
    if (input.content !== undefined && input.summary === undefined && input.v2?.summary === undefined) {
      merged.summary = ''; merged.v2.summary = '';
    }
    if (input.board !== undefined && input.layer === undefined) merged.layer = undefined;
    if (input.type !== undefined && input.category === undefined) merged.category = undefined;
    const { prepared, reason, authorization } = await this.validate(merged, principal, { before, grant });
    let operation = 'edit';
    if (prepared.v2.lifecycle === 'archived') operation = 'archive';
    if (prepared.v2.lifecycle === 'rejected') operation = 'rejection';
    if (['active', 'core'].includes(prepared.v2.lifecycle) && before.v2?.lifecycle === 'inbox') operation = 'promotion';
    if (prepared.v2.lifecycle === 'core' || prepared.v2.identityRole !== before.v2?.identityRole) operation = 'core change';
    if (input.mergeSourceIds?.length) operation = 'merge';
    if (!reason) fail('Memory mutation requires a reason', 400);
    if (operation === 'rejection') await this.tombstone(before, principal, reason, input);
    return this.mutate(operation, id, before, prepared, principal, reason, input, () => this.db.update(id, prepared), authorization);
  }
  async readForMutation(id, principal, input) {
    const scope = resolveScope(principal, input);
    const row = await this.db.getById(id);
    if (!row) return null;
    if (!canReadMemory({ ...row, is_deleted: false }, { ...scope, allResidents: isAdmin(principal) })) fail('Memory is outside Resident scope');
    return row;
  }
  remove(id, principal, input = {}, permanent = false) {
    return serialize(this.db, async () => {
      const before = await this.readForMutation(id, principal, input);
      if (!before) return false;
      const reason = input.override?.reason || input.reason;
      if (!reason) fail('Deletion/rejection requires a reason', 400);
      if (permanent && !isAdmin(principal)) fail('Permanent deletion requires management permission');
      if (input.reject === true) await this.tombstone(before, principal, reason, input);
      return this.mutate(permanent ? 'permanent-delete' : input.reject ? 'rejection' : 'delete', id, before, null, principal, reason, input,
        () => permanent ? this.db.permanentDelete(id) : this.db.delete(id));
    });
  }
  async tombstone(row, principal, reason, input) {
    await this.journal.reject({ memoryId: row.id, residentId: scopeOwner(row) || 'shared', content: row.content,
      sourceRefs: [...(row.v2?.sourceRefs || []), { kind: 'memory', id: row.id }], actor: principal.actor, reason, migrationId: input.migrationId });
  }
  async mutate(operation, id, before, after, principal, reason, input, write, authorization) {
    const transactionId = crypto.randomUUID();
    const event = { kind: 'revision', transactionId, memoryId: id, residentId: scopeOwner(after || before) || 'shared',
      operation, before, after, actor: principal.actor, role: principal.role, reason,
      sourceRefs: after?.v2?.sourceRefs || before?.v2?.sourceRefs || [], migrationId: input.migrationId || '', override: input.override || null };
    await this.journal.append({ ...event, status: 'pending' });
    if (authorization) await this.journal.append({ kind: 'source-attestation', transactionId, memoryId: id, residentId: event.residentId,
      sourceRefs: authorization.refs, actor: principal.actor, role: principal.role, surface: principal.surface,
      authority: authorization.authority, reason: authorization.reason, migrationId: input.migrationId || '' });
    let result;
    try { result = await write(); }
    catch (error) { await this.journal.append({ ...event, status: 'failed' }); throw error; }
    await this.journal.append({ ...event, memoryId: result?.id || id, after: typeof result === 'object' ? result : after, status: 'committed' });
    if (this.activityStore && event.residentId !== 'shared') {
      const { recordActivity } = require('./activities');
      const { createPrincipal } = require('./principal');
      await recordActivity({ actionId: transactionId, action: `memory:${operation}`, source: 'memory-hub', status: 'succeeded',
        title: `${operation} · ${String(after?.title || before?.title || '记忆').slice(0, 150)}`, originId: result?.id || id },
      createPrincipal({ residentId: event.residentId, actor: principal.actor, surface: principal.surface }), { verified: true, store: this.activityStore });
    }
    return result;
  }
}
module.exports = { MemoryAdmissionService, serialize };
