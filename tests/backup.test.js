const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { start, call } = require('./helpers');

test('stopped-service backup restores identity, credentials, edits, grants, receipts and activities', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'memory-backup-test-'));
  const original = path.join(root, 'original'), restored = path.join(root, 'restored');
  let server = await start(original);
  t.after(async () => { await server.stop(); if (path.dirname(root) === os.tmpdir() && path.basename(root).startsWith('memory-backup-test-')) await fs.rm(root, { recursive: true, force: true }); });
  async function ok(route, token, body, method) {
    const r = await call(server.base, route, token, body, method);
    assert.ok(r.status < 300, JSON.stringify(r.data)); return r.data;
  }
  const admin = (await ok('/api/setup', '', { password: 'fictional-backup-password' })).token;
  const owner = await ok('/api/v2/residents', admin, { label: 'Cedar' });
  const helper = await ok('/api/v2/residents', admin, { label: 'Office', recallProfile: 'work', readAccess: { mode: 'selected', residentIds: [owner.id] } });
  const ownerToken = (await ok(`/api/v2/residents/${owner.id}/connection`, admin, {})).token;
  const helperToken = (await ok(`/api/v2/residents/${helper.id}/connection`, admin, {})).token;
  const note = await ok('/api/v2/memories', ownerToken, { title: 'Backup test', content: 'Fictional version one.', board: 'private' });
  const edited = await ok(`/api/v2/memories/${note.id}`, ownerToken, { content: 'Fictional version two.', expectedUpdatedAt: note.updatedAt }, 'PATCH');
  const trash = await ok('/api/v2/memories', ownerToken, { title: 'Trash test', content: 'Recoverable fictional record.', board: 'pulse' });
  await ok(`/api/v2/memories/${trash.id}`, ownerToken, {}, 'DELETE');
  await ok('/api/v2/organization/activities', ownerToken, { actionId: 'backup-receipt', action: 'file_check', status: 'succeeded', title: 'Checked fictional file' });
  const snapshot = await ok('/api/v2/organization/briefing', ownerToken, { consumerId: 'backup-client' });
  await ok('/api/v2/organization/briefing/ack', ownerToken, { consumerId: 'backup-client', snapshotId: snapshot.snapshotId, runId: 'backup-run', success: true });
  const description = await ok('/v1/describe', admin);
  const history = await ok(`/api/v2/memories/${note.id}/history`, ownerToken);
  await server.stop();
  await fs.cp(original, restored, { recursive: true, errorOnExist: true, force: false });
  server = await start(restored);
  assert.equal((await ok('/api/auth', '', { password: 'fictional-backup-password' })).token, admin);
  assert.equal((await ok('/v1/describe', admin)).sourceId, description.sourceId);
  assert.deepEqual((await ok('/api/v2/residents', helperToken)).items[0].readAccess, helper.readAccess);
  assert.equal((await ok(`/api/v2/memories/${note.id}`, helperToken)).content, edited.content);
  assert.equal((await ok(`/api/v2/memories/${note.id}`, ownerToken)).createdAt, note.createdAt);
  assert.deepEqual(await ok(`/api/v2/memories/${note.id}/history`, ownerToken), history);
  assert.ok((await ok('/api/v2/organization/activities', ownerToken)).items.some(row => row.actionId === 'backup-receipt'));
  assert.equal((await ok('/api/v2/organization/briefing', ownerToken, { consumerId: 'backup-client', preview: true })).newItems.length, 0);
  assert.ok((await ok('/api/v2/trash', ownerToken)).items.some(row => row.id === trash.id));
  await ok(`/api/v2/memories/${trash.id}/restore`, ownerToken, {});
  assert.equal((await ok(`/api/v2/memories/${trash.id}`, ownerToken)).id, trash.id);
});
