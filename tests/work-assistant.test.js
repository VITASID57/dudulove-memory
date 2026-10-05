const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { fixture, call } = require('./helpers');

test('work identity: live read grants, own actions and project recall across clients', async t => {
  const f = await fixture(); t.after(() => f.close());
  const admin = (await call(f.base, '/api/setup', null, { password: 'fictional-test-password' })).data.token;
  async function ok(path, token = admin, body, method) {
    const result = await call(f.base, path, token, body, method);
    assert.ok(result.status < 300, JSON.stringify(result.data)); return result.data;
  }
  async function person(label, recallProfile = 'companion') {
    const row = await ok('/api/v2/residents', admin, { label, recallProfile });
    return { ...row, token: (await ok(`/api/v2/residents/${row.id}/connection`, admin, {})).token };
  }
  const helper = await person('Work assistant', 'work'), cedar = await person('Cedar'), river = await person('River');
  const note = await ok('/api/v2/memories', cedar.token, { title: 'Invoice instructions', content: 'Use the fictional violet invoice folder.', board: 'private', type: 'project' });
  const own = await ok('/api/v2/memories', helper.token, { title: 'Invoice review', content: 'Review the fictional invoice receipt.', board: 'private', type: 'project', projectId: 'invoices', lifecycle: 'open_loop' });
  await ok('/api/v2/memories', helper.token, { title: 'Garden plan', content: 'A fictional garden invoice.', board: 'private', type: 'project', projectId: 'garden' });
  await ok('/api/v2/memories', helper.token, { title: 'Writing preference', content: 'Use concise lists for work.', board: 'private', type: 'preference' });
  const client = new Client({ name: 'permission-test', version: '1.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(f.base + '/mcp'), { requestInit: { headers: { Authorization: `Bearer ${helper.token}` } } }));
  t.after(() => client.close());
  const grants = readAccess => ok(`/api/v2/residents/${helper.id}/profile`, admin, { readAccess }, 'PATCH');

  await t.test('default isolation and no self-authorization', async () => {
    assert.equal((await call(f.base, `/api/v2/memories/${note.id}`, helper.token)).status, 403);
    assert.equal((await call(f.base, `/api/v2/residents/${helper.id}/profile`, helper.token, { readAccess: { mode: 'all' } }, 'PATCH')).status, 403);
    assert.equal((await ok('/api/v2/residents', helper.token)).items.length, 1);
    assert.ok((await client.callTool({ name: 'get_memory', arguments: { id: note.id } })).isError);
    assert.equal((await call(f.base, '/api/v2/residents', admin, { id: 'shared', label: 'Reserved' })).status, 400);
  });
  await t.test('selected grants apply on the existing MCP connection and HTTP', async () => {
    await grants({ mode: 'selected', residentIds: [cedar.id] });
    assert.equal((await ok(`/api/v2/memories/${note.id}`, helper.token)).id, note.id);
    assert.ok(!(await client.callTool({ name: 'get_memory', arguments: { id: note.id } })).isError);
    const search = await ok('/api/v2/memories/search', helper.token, { query: 'invoice', ownerLibrary: cedar.id });
    assert.deepEqual(search.items.map(row => row.id), [note.id]);
    assert.equal((await call(f.base, '/api/v2/memories/search', helper.token, { ownerLibrary: river.id })).status, 403);
    const bridged = (await ok(`/v1/memories/${note.id}`, helper.token)).memory;
    assert.equal(bridged.id, note.id);
    assert.ok(bridged.permissions.readActorIds.includes(helper.id));
    assert.ok(!bridged.permissions.writeActorIds.includes(helper.id));
  });
  await t.test('read permission cannot become mutation, organization or activity access', async () => {
    for (const [path, body, method] of [
      [`/api/v2/memories/${note.id}`, { content: 'Overwrite' }, 'PATCH'],
      [`/api/v2/memories/${note.id}`, {}, 'DELETE'],
      [`/api/v2/memories/${note.id}/restore`, {}, 'POST'],
      ['/api/v2/memories', { title: 'Impersonation', content: 'Bad', board: 'private', ownerLibrary: cedar.id }, 'POST'],
      [`/v1/memories/${note.id}`, { content: 'Overwrite' }, 'PATCH'],
    ]) assert.equal((await call(f.base, path, helper.token, body, method)).status, 403);
    assert.ok((await call(f.base, '/api/v2/organization/preview', helper.token, { memoryIds: [note.id] })).status >= 400);
    assert.equal((await call(f.base, `/api/v2/organization/activities?residentId=${cedar.id}`, helper.token)).status, 403);
  });
  await t.test('work context includes project notes, source owners and actual actions', async () => {
    await ok('/api/v2/organization/activities', helper.token, { actionId: 'invoice-send-1', action: 'send', title: 'Sent fictional invoice', detail: 'Receipt checked.', status: 'succeeded' });
    const input = { query: 'invoice', projectId: 'invoices', sessionId: 'continuous-task', limitTokens: 3000 };
    for (let i = 0; i < 2; i++) {
      const context = await ok('/api/v2/context/assemble', helper.token, input);
      assert.equal(context.mode, 'work'); assert.equal(context.recallProfile, 'work');
      assert.ok(context.memories.some(row => row.id === own.id));
      assert.ok(context.memories.some(row => row.id === note.id));
      assert.ok(!context.memories.some(row => row.projectId === 'garden'));
      assert.ok(context.lanes.identity.every(row => row.ownerLibrary === helper.id));
      assert.ok(context.activities.some(row => row.actionId === 'invoice-send-1'));
      assert.ok(context.activities.every(row => !row.content.includes('行动=memory.')));
      assert.match(context.contextText, new RegExp(`owner=${cedar.id}`));
      assert.ok(context.estimatedTokens <= context.tokenBudget);
    }
    const small = await ok('/api/v2/context/assemble', helper.token, { ...input, limitTokens: 128 });
    assert.ok(small.estimatedTokens <= 128);
    const social = await ok('/api/v2/context/assemble', helper.token, { ...input, mode: 'social' });
    assert.equal(social.activities.length, 0); assert.equal(social.memories.length, 0);
  });
  await t.test('renames keep grants and selected mode excludes future identities', async () => {
    await ok('/api/v2/residents', admin, { id: helper.id, label: 'Renamed helper' });
    const renamed = (await ok('/api/v2/residents', helper.token)).items[0];
    assert.equal(renamed.recallProfile, 'work'); assert.deepEqual(renamed.readAccess.residentIds, [cedar.id]);
    const future = await person('Meadow');
    const item = await ok('/api/v2/memories', future.token, { board: 'private', title: 'New note', content: 'Fictional future identity note.' });
    assert.equal((await call(f.base, `/api/v2/memories/${item.id}`, helper.token)).status, 403);
    await grants({ mode: 'all' });
    const later = await person('Harbor');
    const newer = await ok('/api/v2/memories', later.token, { board: 'private', title: 'Later note', content: 'A later fictional identity.' });
    assert.equal((await ok(`/api/v2/memories/${newer.id}`, helper.token)).id, newer.id);
  });
  await t.test('revocation applies to the already-connected MCP and all read paths', async () => {
    await grants({ mode: 'self' });
    assert.ok((await client.callTool({ name: 'get_memory', arguments: { id: note.id } })).isError);
    assert.equal((await call(f.base, `/v1/memories/${note.id}`, helper.token)).status, 403);
    assert.equal((await call(f.base, `/api/v2/memories/${note.id}/history`, helper.token)).status, 403);
    const context = await ok('/api/v2/context/assemble', helper.token, { query: 'invoice' });
    assert.ok(!context.memories.some(row => row.id === note.id));
  });
});
