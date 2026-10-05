'use strict';

const {
  OWNER_LIBRARIES,
  normalizeOwnerLibrary,
  ownerLabel,
} = require('./classifier');

const PRIVATE_OWNER_IDS = Object.freeze(Object.keys(OWNER_LIBRARIES));

function inferPrivateMemoryOwner(member) {
  return normalizeOwnerLibrary(member?.private_memory_owner || member?.privateMemoryOwner || member?.residentId);
}

function canReadPrivateMemory(member) {
  return member?.read_private_memory !== false && Boolean(inferPrivateMemoryOwner(member));
}

function canWritePrivateMemory(member) {
  return Boolean(inferPrivateMemoryOwner(member));
}

function privateMemoryOwnerLabel(member) {
  const owner = inferPrivateMemoryOwner(member);
  return owner ? ownerLabel(owner) : '';
}

function memoryOwnerLibrary(memory) {
  if (!memory || typeof memory !== 'object') return '';
  let metadata = memory.metadata;
  if (typeof metadata === 'string') {
    try { metadata = JSON.parse(metadata); } catch { metadata = {}; }
  }
  if (!metadata || typeof metadata !== 'object') metadata = {};
  return normalizeOwnerLibrary(
    memory.ownerLibrary ||
    memory.owner ||
    memory.v2?.ownerLibrary ||
    memory.v2?.owner ||
    metadata.ownerLibrary ||
    metadata.owner
  );
}

function belongsToPrivateOwner(memory, owner) {
  const normalizedOwner = normalizeOwnerLibrary(owner);
  return Boolean(normalizedOwner) && memoryOwnerLibrary(memory) === normalizedOwner;
}

function privateOwnerOptions() {
  return PRIVATE_OWNER_IDS.map(id => ({ id, label: ownerLabel(id) }));
}

module.exports = {
  PRIVATE_OWNER_IDS,
  inferPrivateMemoryOwner,
  canReadPrivateMemory,
  canWritePrivateMemory,
  privateMemoryOwnerLabel,
  memoryOwnerLibrary,
  belongsToPrivateOwner,
  privateOwnerOptions,
};
