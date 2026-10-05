const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function initializeConfig() {
  const dataDir = path.resolve(process.env.MEMORY_DATA_DIR || path.join(__dirname, '..', 'data'));
  fs.mkdirSync(dataDir, { recursive: true });
  process.env.MEMORY_DATA_DIR = dataDir;
  const filename = path.join(dataDir, 'access.json');
  let value = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, 'utf8')) : null;
  if (!value) {
    value = { sourceId: crypto.randomUUID(), adminToken: crypto.randomBytes(32).toString('base64url') };
    fs.writeFileSync(filename, JSON.stringify(value), { mode: 0o600, flag: 'wx' });
  }
  if (!value.sourceId || !value.adminToken) throw new Error('Invalid access configuration; original file preserved');
  if (process.env.MEMORY_ADMIN_TOKEN) {
    if (process.env.MEMORY_ADMIN_TOKEN.length < 16) throw new Error('MEMORY_ADMIN_TOKEN must contain at least 16 characters');
    value.adminToken = process.env.MEMORY_ADMIN_TOKEN;
  }
  return { dataDir, value, save() {
    const tmp = filename + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
    fs.renameSync(tmp, filename);
  } };
}
module.exports = { initializeConfig };
