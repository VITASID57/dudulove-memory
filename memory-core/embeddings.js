'use strict';
// ── 向量引擎：SiliconFlow/OpenAI 兼容 embeddings + 本地余弦检索 ──
// 向量存独立的 embeddings.db（按记忆 id 一条），不污染 memories.db。
// 长文按句切片分别向量化（避免"整篇压一条向量、查什么都半相关"），检索时取分片最高分。

const Datastore = require('@seald-io/nedb');
const path = require('path');
const { stripHtml, contentHash, chunkText, normalize, dot } = require('./embeddingText');

const embDb = new Datastore({
  filename: path.join(process.env.MEMORY_DATA_DIR || path.resolve('data'), 'embeddings.db'),
  autoload: true
});

const DEFAULT_API_URL = '';
const DEFAULT_MODEL = '';
const SIM_FLOOR_DEFAULT = 0.4; // 低于此相似度不算语义命中
const VEC_TOP_DEFAULT = 30;    // 向量路最多召回条数

// 内存缓存：id → { hash, model, chunks: number[][] }，检索时全内存算余弦
let cache = null;
let cachePromise = null;

// 回填状态（给 /api/embedding/status 用）
const state = {
  running: false,
  total: 0,
  done: 0,
  lastError: null,
  lastRunAt: null,
};

// 查询向量的小缓存，避免同一关键词反复打 API
const queryCache = new Map();
const QUERY_CACHE_MAX = 50;

function getConfig(settings = {}) {
  return {
    apiUrl: String(settings.embedding_api_url || DEFAULT_API_URL).trim().replace(/\/+$/, ''),
    apiKey: String(settings.embedding_api_key || '').trim(),
    model: String(settings.embedding_model || DEFAULT_MODEL).trim(),
    simFloor: Number(settings.embedding_sim_floor) > 0 ? Number(settings.embedding_sim_floor) : SIM_FLOOR_DEFAULT,
  };
}

function isConfigured(settings) {
  const config = getConfig(settings);
  return Boolean(config.apiKey && config.apiUrl && config.model);
}

// 向量空间签名：同名模型在不同服务商可能是不同的向量空间，
// 签名进内容指纹后，换服务商/换模型都会让旧向量自动判过期、等待重建
function vectorSpace(cfg) {
  return cfg.apiUrl + ' ' + cfg.model;
}

async function embedTexts(settings, texts, { timeoutMs = 20000 } = {}) {
  const { apiUrl, apiKey, model } = getConfig(settings);
  if (!isConfigured(settings)) throw new Error('请在向量设置填写 API 地址、模型和密钥');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(apiUrl + '/embeddings', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, input: texts }),
      signal: ctrl.signal,
    });
    if (!resp.ok) {
      throw new Error(`embedding API HTTP ${resp.status}`);
    }
    const data = await resp.json();
    if (!Array.isArray(data.data)) throw new Error('embedding API 返回格式异常');
    const out = new Array(texts.length);
    for (const item of data.data) {
      if (!Number.isInteger(item.index) || item.index < 0 || item.index >= texts.length ||
        !Array.isArray(item.embedding) || !item.embedding.length || !item.embedding.every(Number.isFinite)) throw new Error('embedding API 返回向量无效');
      out[item.index] = normalize(item.embedding);
    }
    if (Array.from(out).some(v => !v)) throw new Error('embedding API 返回向量数量不足');
    return out;
  } finally {
    clearTimeout(timer);
  }
}

async function loadCache() {
  if (cache) return cache;
  if (!cachePromise) {
    cachePromise = (async () => {
      const docs = await embDb.findAsync({});
      cache = new Map(docs.map(d => [d._id, { hash: d.hash, model: d.model, chunks: d.chunks }]));
      return cache;
    })();
  }
  return cachePromise;
}

async function saveEmbedding(id, model, hash, chunks) {
  const doc = { _id: id, model, hash, chunks, updated_at: new Date().toISOString() };
  await embDb.updateAsync({ _id: id }, doc, { upsert: true });
  (await loadCache()).set(id, { hash, model, chunks });
}

async function removeEmbedding(id) {
  await embDb.removeAsync({ _id: id }, {});
  if (cache) cache.delete(id);
}

// 向量记录是否可用：模型+内容指纹匹配，且分片都是等长非空、全有限数值的数组
//（防截断/损坏/NaN→null 污染）。getStatus 统计、ensureAll 排队、embedMemory 跳过判断、
// rankBySimilarity 召回共用这一个口径，保证"被搜索拒收的向量"一定会被重建补上。
// 深度数值扫描较贵，结果记忆在缓存条目上（_valid），每条向量只扫一次
function isEmbeddingValid(emb, model, hash) {
  if (!emb || emb.model !== model || emb.hash !== hash) return false;
  if (!Array.isArray(emb.chunks) || !emb.chunks.length) return false;
  if (emb._valid === undefined) {
    const dim = Array.isArray(emb.chunks[0]) ? emb.chunks[0].length : 0;
    emb._valid = dim > 0 && emb.chunks.every(c =>
      Array.isArray(c) && c.length === dim && c.every(Number.isFinite)
    );
  }
  return emb._valid;
}

// 单条记忆向量化（create/update 钩子用；未配置时静默跳过）
// force=true 时无视现有向量强制重算（强制全量重算用）
async function embedMemory(memory, settings, { force = false } = {}) {
  if (!memory || !memory.id || !isConfigured(settings)) return false;
  const cfg = getConfig(settings);
  const hash = contentHash(vectorSpace(cfg), memory.title || '', stripHtml(memory.content || ''));
  const existing = (await loadCache()).get(memory.id);
  if (!force && isEmbeddingValid(existing, cfg.model, hash)) return false;
  const chunks = chunkText(memory.title, memory.content);
  if (!chunks.length) return false;
  const vectors = await embedTexts(settings, chunks);
  await saveEmbedding(memory.id, cfg.model, hash, vectors);
  return true;
}

// 把查询文本向量化（带小缓存）
async function embedQuery(settings, q) {
  const cfg = getConfig(settings);
  const key = vectorSpace(cfg) + '\0' + q; // 缓存按向量空间隔离，换服务商不复用旧查询向量
  if (queryCache.has(key)) return queryCache.get(key);
  const [vec] = await embedTexts(settings, [q], { timeoutMs: 8000 });
  queryCache.set(key, vec);
  if (queryCache.size > QUERY_CACHE_MAX) {
    queryCache.delete(queryCache.keys().next().value);
  }
  return vec;
}

// 向量路召回：在 docs（已过结构化筛选的原始文档）里按语义相似度排序
// 返回 [{ doc, sim }]，已按 sim 降序、过相似度地板、截断 topN
// 失败关闭：模型不符 / 内容指纹不符（记忆改了但向量没更新）/ 维度不符的向量一律不参与排名，
// 宁可漏召回（关键词路兜底），不可召回过期或张冠李戴的记忆
async function rankBySimilarity(q, docs, settings, { topN = VEC_TOP_DEFAULT } = {}) {
  if (!isConfigured(settings) || !docs.length) return [];
  const cfg = getConfig(settings);
  const { model, simFloor } = cfg;
  const [qVec, embMap] = await Promise.all([embedQuery(settings, q), loadCache()]);
  const hits = [];
  for (const doc of docs) {
    const emb = embMap.get(doc._id);
    if (!isEmbeddingValid(emb, model, contentHash(vectorSpace(cfg), doc.title || '', stripHtml(doc.content || '')))) continue;
    let best = -1, bestIndex = -1;
    for (const [index, chunk] of emb.chunks.entries()) {
      if (!Array.isArray(chunk) || chunk.length !== qVec.length) continue;
      const sim = dot(qVec, chunk); // 双方都是单位向量，点积即余弦
      if (sim > best) { best = sim; bestIndex = index; }
    }
    if (best >= simFloor) hits.push({ doc, sim: best, excerpt: chunkText(doc.title, doc.content)[bestIndex] });
  }
  hits.sort((a, b) => b.sim - a.sim);
  return hits.slice(0, topN);
}

// 全量回填：补齐缺失/过期向量，顺手清理孤儿向量。后台跑，进度看 state。
async function ensureAll(memoryDB, { force = false } = {}) {
  if (state.running) return { started: false, reason: 'already running' };
  const settings = await memoryDB.getSettings();
  if (!isConfigured(settings)) return { started: false, reason: 'not configured' };
  const cfg = getConfig(settings);
  const { model } = cfg;

  state.running = true;
  state.lastError = null;
  state.done = 0;
  try {
    const memories = await memoryDB.search({ limit: 10000 });
    const embMap = await loadCache();

    const pending = [];
    for (const m of memories) {
      const hash = contentHash(vectorSpace(cfg), m.title || '', stripHtml(m.content || ''));
      const existing = embMap.get(m.id);
      if (force || !isEmbeddingValid(existing, model, hash)) pending.push(m);
    }
    state.total = pending.length;

    for (const m of pending) {
      try {
        await embedMemory(m, settings, { force });
      } catch (e) {
        state.lastError = '部分索引未完成，请检查模型设置后重试';
      }
      state.done++;
      await new Promise(r => setTimeout(r, 120)); // 温柔一点，别打爆免费档限速
    }

    // 清理孤儿：既不在记忆库也不在垃圾箱的向量
    const trash = await memoryDB.getTrash().catch(() => []);
    const alive = new Set([...memories.map(m => m.id), ...trash.map(m => m.id)]);
    for (const id of [...embMap.keys()]) {
      if (!alive.has(id)) await removeEmbedding(id);
    }

    state.lastRunAt = new Date().toISOString();
    return { started: true, embedded: state.done, total: state.total };
  } catch (e) {
    state.lastError = '索引未完成，记忆正文保留';
    throw e;
  } finally {
    state.running = false;
  }
}

// 覆盖率统计（劳动车间状态卡用）
async function getStatus(memoryDB) {
  const settings = await memoryDB.getSettings();
  const cfg = getConfig(settings);
  const configured = isConfigured(settings);
  let total = 0, embedded = 0;
  if (configured) {
    const memories = await memoryDB.search({ limit: 10000 });
    const embMap = await loadCache();
    total = memories.length;
    for (const m of memories) {
      const existing = embMap.get(m.id);
      if (isEmbeddingValid(existing, cfg.model, contentHash(vectorSpace(cfg), m.title || '', stripHtml(m.content || '')))) embedded++;
    }
  }
  return {
    configured,
    apiUrl: cfg.apiUrl,
    model: cfg.model,
    simFloor: cfg.simFloor,
    total,
    embedded,
    pending: Math.max(0, total - embedded),
    running: state.running,
    progress: state.running ? { done: state.done, total: state.total } : null,
    lastError: state.lastError,
    lastRunAt: state.lastRunAt,
  };
}

module.exports = {
  isConfigured,
  chunkText,
  embedTexts,
  embedMemory,
  embedQuery,
  rankBySimilarity,
  removeEmbedding,
  ensureAll,
  getStatus,
};
