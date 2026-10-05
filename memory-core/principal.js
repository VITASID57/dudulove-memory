'use strict';

const { AsyncLocalStorage } = require('node:async_hooks');
const { OWNER_LIBRARIES } = require('./classifier');
const { inferPrivateMemoryOwner } = require('./privateAccess');

const execution = new AsyncLocalStorage();
const issued = new WeakSet();
const RESIDENT_IDS = Object.freeze(Object.keys(OWNER_LIBRARIES));

function fail(message, statusCode = 403) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = statusCode === 400 ? -32602 : -32003;
  throw error;
}

function residentId(value, allowEmpty = true) {
  if ((value === undefined || value === null || value === '') && allowEmpty) return '';
  if (typeof value !== 'string') fail('Invalid residentId', 400);
  const id = value.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(id)) fail('Invalid residentId', 400);
  return id;
}

// Only server adapters construct principals. Never deserialize one from model arguments.
function createPrincipal({ residentId: id = '', role = 'resident', actor = 'resident', surface = 'unknown', capabilities = [] } = {}) {
  if (!['resident', 'admin', 'maintenance', 'migration'].includes(role)) fail('Invalid principal role', 400);
  const principal = Object.freeze({ residentId: residentId(id), role, actor, surface, capabilities: Object.freeze([...capabilities]) });
  issued.add(principal);
  return principal;
}

const SHARED_PRINCIPAL = createPrincipal();
function assertPrincipal(principal = SHARED_PRINCIPAL) {
  if (!issued.has(principal)) fail('Untrusted resident principal');
  return principal;
}
function currentPrincipal() { return execution.getStore() || SHARED_PRINCIPAL; }
function runAs(principal, callback) { return execution.run(assertPrincipal(principal), callback); }
function isAdmin(principal) { return assertPrincipal(principal).role === 'admin'; }

function principalForMember(member, surface = 'client') {
  return createPrincipal({ residentId: inferPrivateMemoryOwner(member), actor: `member:${member?._id || member?.person_id || 'unbound'}`, surface });
}

function resolveScope(principal, input = {}) {
  principal = assertPrincipal(principal);
  let id = principal.residentId;
  let override = null;
  if (isAdmin(principal) && !input.override) {
    const requested = input.residentId || input.ownerLibrary || input.owner || input.v2?.ownerLibrary || input.v2?.owner;
    if (requested) id = residentId(requested, false);
  }
  if (input.override) {
    if (!isAdmin(principal) && !principal.capabilities.includes('resident:override')) fail('Resident override is not permitted');
    if (!String(input.override.reason || '').trim()) fail('Override reason is required', 400);
    id = residentId(input.override.residentId, false);
    override = { residentId: id, reason: String(input.override.reason).trim() };
  }
  for (const value of [input.residentId, input.ownerLibrary, input.owner, input.v2?.ownerLibrary, input.v2?.owner]) {
    if (value === undefined || value === null || value === '') continue;
    if (residentId(value, false) !== id) fail('Requested owner does not match authenticated Resident');
  }
  return { residentId: id, override };
}

module.exports = { RESIDENT_IDS, SHARED_PRINCIPAL, createPrincipal, assertPrincipal, currentPrincipal, runAs, isAdmin, principalForMember, resolveScope, residentId, fail };
