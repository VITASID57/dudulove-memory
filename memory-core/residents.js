'use strict';

const crypto = require('node:crypto');
const { OWNER_LIBRARIES } = require('./classifier');
const { residentId, createPrincipal, fail } = require('./principal');

const KEY = 'memory_residents_json';
const queues = new WeakMap();
async function records(db) {
  const settings = await db.getSettings();
  const saved = settings[KEY];
  const rows = typeof saved === 'string' ? JSON.parse(saved) : saved || [];
  if (!Array.isArray(rows)) fail('身份列表格式错误', 500);
  return rows;
}
function change(db, callback) {
  const next = (queues.get(db) || Promise.resolve()).catch(() => {}).then(async () => {
    const rows = await records(db);
    const result = await callback(rows);
    await db.setSetting(KEY, JSON.stringify(rows));
    return result;
  });
  queues.set(db, next);
  return next;
}
async function listResidents(db) {
  const all = new Map(Object.values(OWNER_LIBRARIES).map(row => [row.id, { id: row.id, label: row.label }]));
  for (const row of await records(db)) all.set(row.id, { id: row.id, label: row.label,
    recallProfile: row.recallProfile || 'companion', readAccess: row.readAccess || { mode: 'self', residentIds: [] } });
  return [...all.values()];
}
async function residentProfile(db, id) {
  const row = db.getSettings ? (await records(db)).find(item => item.id === id) : null;
  return { recallProfile: row?.recallProfile || 'companion', readAccess: row?.readAccess || { mode: 'self', residentIds: [] } };
}
function configureResident(row, input, rows) {
  if (input.recallProfile !== undefined) {
    if (!['companion', 'work'].includes(input.recallProfile)) fail('请选择陪伴或工作召回', 400);
    row.recallProfile = input.recallProfile;
  }
  if (input.readAccess !== undefined) {
    const access = input.readAccess;
    if (!access || !['self', 'selected', 'all'].includes(access.mode)) fail('读取范围无效', 400);
    if (access.residentIds !== undefined && !Array.isArray(access.residentIds)) fail('请选择要授权的身份', 400);
    const ids = [...new Set((access.residentIds || []).map(value => residentId(value, false)))].filter(id => id !== row.id);
    const known = new Set([...Object.keys(OWNER_LIBRARIES), ...rows.map(item => item.id)]);
    if (ids.some(id => !known.has(id))) fail('授权名单含不存在的身份，请刷新后重选', 400);
    row.readAccess = { mode: access.mode, residentIds: access.mode === 'selected' ? ids : [] };
  }
  return row;
}
function saveResident(db, input) {
  const label = String(input.label || '').trim().slice(0, 80);
  if (!label) fail('请填写身份的名字', 400);
  const id = residentId(input.id || `resident-${crypto.randomUUID().slice(0, 12)}`, false);
  if (id === 'shared') fail('shared 是共享区保留名称', 400);
  return change(db, rows => {
    let existing = rows.find(row => row.id === id);
    if (!existing) { existing = { id, label }; rows.push(existing); }
    existing.label = label;
    configureResident(existing, input, rows);
    return { id, label, recallProfile: existing.recallProfile || 'companion', readAccess: existing.readAccess || { mode: 'self', residentIds: [] } };
  });
}
function updateResidentProfile(db, id, input) {
  id = residentId(id, false);
  return change(db, rows => {
    let row = rows.find(item => item.id === id);
    if (!row && OWNER_LIBRARIES[id]) { row = { id, label: OWNER_LIBRARIES[id].label }; rows.push(row); }
    if (!row) fail('找不到这个身份', 404);
    configureResident(row, input, rows);
    return { id, label: row.label, recallProfile: row.recallProfile || 'companion', readAccess: row.readAccess || { mode: 'self', residentIds: [] } };
  });
}
function residentConnection(db, id) {
  id = residentId(id, false);
  return change(db, rows => {
    let row = rows.find(item => item.id === id);
    if (!row && OWNER_LIBRARIES[id]) { row = { id, label: OWNER_LIBRARIES[id].label }; rows.push(row); }
    if (!row) fail('找不到这个身份', 404);
    if (!row.token) row.token = crypto.randomBytes(32).toString('base64url');
    return { residentId: id, label: row.label, token: row.token, apiPath: '/api/v2', mcpPath: '/mcp' };
  });
}
async function residentForToken(db, token, surface) {
  if (!token) return null;
  const supplied = Buffer.from(token);
  const row = (await records(db)).find(item => {
    const saved = Buffer.from(item.token || '');
    return saved.length === supplied.length && saved.length > 0 && crypto.timingSafeEqual(saved, supplied);
  });
  return row ? createPrincipal({ residentId: row.id, actor: `resident:${row.id}`, surface }) : null;
}
module.exports = { listResidents, saveResident, residentConnection, residentForToken, residentProfile, updateResidentProfile };
