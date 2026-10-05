const base = (process.env.MEMORY_API || 'http://127.0.0.1:8787').replace(/\/$/, '');
const token = process.env.MEMORY_TOKEN;
if (!token) throw new Error('Set MEMORY_TOKEN to the identity token copied from the management page');
async function request(path, body) {
  const response = await fetch(base + '/api/v2' + path, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${result.error || 'request failed'}`);
  return result;
}
const args = process.argv.slice(2);
const identity = await request('/residents');
console.log('Connected identity:', identity.items.map(row => ({ id: row.id, label: row.label })));
if (args.includes('--save-demo')) {
  const saved = await request('/memories', { title: 'Example notebook', content: 'The fictional project uses a blue notebook.', board: 'pulse' });
  console.log('Saved example memory:', saved.id);
}
const query = args.find(value => !value.startsWith('--')) || 'notebook';
const context = await request('/context/assemble', { query });
console.log(context.contextText);
console.log('Search results:', (await request('/memories/search', { query })).items);
