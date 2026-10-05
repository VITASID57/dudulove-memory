'use strict';
const { currentPrincipal, resolveScope, isAdmin, fail, createPrincipal } = require('./principal');
const { listResidents } = require('./residents');
const { organizationStore } = require('./organizationStore');

const DEFAULTS = Object.freeze({ autoEnabled: false, days: 7, includeChats: false,
  focus: ['events', 'user', 'unfinished', 'resident'], instruction: '', minFragments: 3 });
async function organizationScope(db, input = {}, principal = currentPrincipal()) {
  if (input.residentId === 'shared') {
    if (!isAdmin(principal) && !principal.capabilities.includes('organization:shared')) fail('共享整理仅由管理端设置');
    return { id: 'shared', principal: createPrincipal({ role: 'maintenance', actor: principal.actor, surface: principal.surface, capabilities: ['organization:shared'] }) };
  }
  const id = resolveScope(principal, input).residentId;
  if (!id) fail('请先选择身份', 400);
  if (!(await listResidents(db)).some(row => row.id === id)) fail('找不到这个身份', 404);
  return { id, principal: createPrincipal({ residentId: id, role: 'maintenance', actor: principal.actor, surface: principal.surface }) };
}
async function getOrganizationConfig(id, store = organizationStore()) {
  return { ...DEFAULTS, ...(await store.get(`config:${id}`))?.config };
}
async function saveOrganizationConfig(id, patch, store = organizationStore()) {
  return store.lock(`config:${id}`, async () => {
    const config = await getOrganizationConfig(id, store);
    for (const key of ['autoEnabled', 'includeChats']) if (patch[key] !== undefined) {
      if (typeof patch[key] !== 'boolean') fail(`${key} 必须为开关`, 400);
      config[key] = patch[key];
    }
    if (patch.days !== undefined) {
      if (![3, 7, 30].includes(Number(patch.days))) fail('范围请选择 3、7 或 30 天', 400);
      config.days = Number(patch.days);
    }
    if (patch.focus !== undefined) {
      if (!Array.isArray(patch.focus) || patch.focus.some(item => !DEFAULTS.focus.includes(item))) fail('简报关注项无效', 400);
      config.focus = [...new Set(patch.focus)];
    }
    if (patch.instruction !== undefined) config.instruction = String(patch.instruction).trim().slice(0, 500);
    await store.put(`config:${id}`, { kind: 'config', residentId: id, config, updatedAt: new Date().toISOString() });
    return config;
  });
}
module.exports = { DEFAULTS, organizationScope, getOrganizationConfig, saveOrganizationConfig };
