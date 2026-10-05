'use strict';

const { assertPrincipal, resolveScope, fail } = require('./principal');

const grants = new WeakMap();
const refKey = ref => JSON.stringify([ref.kind === 'legacy-memory' ? 'memory' : ref.kind, String(ref.id), ref.messageId || '']);

function cleanRefs(refs = []) {
  if (!Array.isArray(refs) || refs.some(ref => !ref || typeof ref.kind !== 'string' || !ref.kind || typeof ref.id !== 'string' || !ref.id)) {
    fail('sourceRefs require kind and id', 400);
  }
  // Trust flags and receipts are never accepted from a serialized payload.
  return refs.map(ref => Object.fromEntries(['kind', 'id', 'messageId', 'source', 'createdAt', 'board', 'type']
    .filter(key => typeof ref[key] === 'string').map(key => [key, ref[key]])));
}

// Server code calls this only after binding a saved Surface message to its Resident.
// The opaque grant is a separate argument, never part of model-visible input.
function issueGrant(principal, refs, reason, scopeInput = {}, authority) {
  assertPrincipal(principal);
  if (!String(reason || '').trim()) fail('Source attestation requires a reason', 400);
  const grant = Object.freeze({});
  grants.set(grant, { residentId: resolveScope(principal, scopeInput).residentId, actor: principal.actor,
    surface: principal.surface, role: principal.role, refs: cleanRefs(refs), reason, authority });
  return grant;
}

function attestAdapterSources(principal, refs, reason, scopeInput = {}) {
  assertPrincipal(principal);
  if (!['resident', 'admin'].includes(principal.role)) fail('Maintenance must use independent source attestation capability');
  return issueGrant(principal, refs, reason, scopeInput, 'server-adapter');
}

function attestMaintenanceSources(principal, refs, reason, scopeInput = {}) {
  assertPrincipal(principal);
  if (!['maintenance', 'migration'].includes(principal.role) || !principal.capabilities.includes('provenance:attest')) {
    fail('Source attestation requires independent maintenance capability');
  }
  return issueGrant(principal, refs, reason, scopeInput, 'controlled-maintenance');
}

function readSourceGrant(grant, principal, scope) {
  const value = grant && grants.get(grant);
  if (!value) return null;
  return value.residentId === scope.residentId && value.actor === principal.actor &&
    value.surface === principal.surface && value.role === principal.role ? value : null;
}

module.exports = { cleanRefs, refKey, attestAdapterSources, attestMaintenanceSources, readSourceGrant };
