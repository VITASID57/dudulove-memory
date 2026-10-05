'use strict';

const { residentProfile, listResidents } = require('./residents');
const { resolveScope, residentId, isAdmin, fail } = require('./principal');

// Read grants are loaded for each operation, including on existing MCP sessions.
// Mutation paths continue to use resolveScope and never receive these grants.
async function resolveReadScope(db, principal, input = {}) {
  const profile = await residentProfile(db, principal.residentId);
  const admin = isAdmin(principal);
  const scope = resolveScope(principal, admin ? input : { residentId: input.residentId, override: input.override });
  let readableResidentIds = [];
  if (!admin && principal.role === 'resident' && !input.ownOnly && profile.readAccess.mode !== 'self') {
    const access = profile.readAccess;
    const known = (await listResidents(db)).map(row => row.id);
    readableResidentIds = access.mode === 'all' ? known : access.mode === 'selected' ? known.filter(id => access.residentIds.includes(id)) : [];
  }
  const allResidents = admin && !scope.override && !input.residentId && !input.ownerLibrary && !input.owner && !input.readPolicy && !input.ownOnly;
  const requested = [input.ownerLibrary, input.owner, input.v2?.ownerLibrary, input.v2?.owner].filter(value => value !== undefined && value !== null && value !== '').map(value => residentId(value, false));
  if (new Set(requested).size > 1) fail('Conflicting memory owner filters', 400);
  const ownerFilter = requested[0] || '';
  if (ownerFilter && !admin && ownerFilter !== scope.residentId && !readableResidentIds.includes(ownerFilter)) fail('Memory is outside Resident read scope');
  return { ...scope, allResidents, readableResidentIds, ownerFilter, recallProfile: profile.recallProfile };
}

module.exports = { resolveReadScope };
