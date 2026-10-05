const crypto = require('node:crypto');
const CHUNK_CHARS = 420, MAX_CHUNKS = 16;
function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function contentHash(model, title, content) {
  return crypto.createHash('md5').update(model + '\0' + title + '\0' + content).digest('hex');
}

function chunkText(title, content) {
  const text = ((title ? title + '\n' : '') + stripHtml(content)).trim();
  if (!text) return [];
  if (text.length <= CHUNK_CHARS) return [text];
  const sentences = text.split(/(?<=[。！？!?；;\n])/);
  const chunks = [];
  let cur = '';
  for (let s of sentences) {
    while (s.length > CHUNK_CHARS) { // 单句超长直接硬切
      if (cur) { chunks.push(cur); cur = ''; }
      chunks.push(s.slice(0, CHUNK_CHARS));
      s = s.slice(CHUNK_CHARS);
    }
    if ((cur + s).length > CHUNK_CHARS && cur) { chunks.push(cur); cur = s; }
    else cur += s;
  }
  if (cur.trim()) chunks.push(cur);
  return chunks.slice(0, MAX_CHUNKS).map(c => c.trim()).filter(Boolean);
}

function normalize(vec) {
  let n = 0;
  for (const v of vec) n += v * v;
  n = Math.sqrt(n) || 1;
  return vec.map(v => Math.round((v / n) * 1e6) / 1e6);
}

function dot(a, b) {
  let s = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) s += a[i] * b[i];
  return s;
}
module.exports = { stripHtml, contentHash, chunkText, normalize, dot };
