const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const parser = import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(__dirname, '../public/chat-material.js'))).toString('base64'));

test('chat import keeps authors and dates and selects the active edited branch', async () => {
  const { parseChatMaterial } = await parser;
  const text = parseChatMaterial(JSON.stringify({ messages: [{ role: 'user', timestamp: '2026-01-02', content: 'Hello' }, { role: 'assistant', content: [{ type: 'text', text: 'Welcome' }] }] }), 'chat.json');
  assert.match(text, /2026-01-02.*用户：Hello/); assert.match(text, /助手：Welcome/);
  const branch = { current_node: 'new', mapping: {
    root: { parent: null, message: null },
    old: { parent: 'root', message: { role: 'assistant', content: 'Discarded branch' } },
    new: { parent: 'root', message: { role: 'assistant', content: 'Current branch' } },
  } };
  assert.equal(parseChatMaterial(JSON.stringify(branch), 'chat.json'), '助手：Current branch');
});

test('chat import preserves conversation boundaries and supported encodings', async () => {
  const { parseChatMaterial, decodeChatFile } = await parser;
  const text = parseChatMaterial(JSON.stringify([{ title: 'First', chat_messages: [{ sender: 'human', text: 'Hello' }] }, { title: 'Second', raw_content: 'User: Goodbye' }]), 'chat.json');
  assert.match(text, /First/); assert.match(text, /下一段聊天/); assert.match(text, /Second/);
  const bytes = Buffer.concat([Buffer.from([255, 254]), Buffer.from('测试记录', 'utf16le')]);
  assert.equal(decodeChatFile(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)), '测试记录');
});

test('chat import rejects incomplete attachments, cycles, invalid JSON and overlong text', async () => {
  const { parseChatMaterial } = await parser;
  for (const input of [{ messages: [{ role: 'user', content: [{ type: 'image', url: 'https://example.com/image' }] }] },
    { current_node: 'a', mapping: { a: { parent: 'a' } } }, { something: 'unsupported' }]) {
    assert.throws(() => parseChatMaterial(JSON.stringify(input), 'chat.json'));
  }
  assert.throws(() => parseChatMaterial('{', 'chat.json'));
  assert.throws(() => parseChatMaterial('x'.repeat(48001), 'chat.txt'));
});
