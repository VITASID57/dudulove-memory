const embeddings = require('../memory-core/embeddings');
const { queryTerms, lexicalScore } = require('../memory-core/recallText');
const { filterCandidates } = require('../memory-core/recallPolicy');
module.exports = (db, format) => async function search({ q, category, layer, tags, source, date, limit = 50, offset = 0, semantic, residentScope, readPolicy, identityOnly, candidateFilter } = {}) {
    const warnings = [];
    const passages = new Map();
    const query = { is_deleted: { $ne: true } };
    if (category) query.category = category;
    if (source) query.source = source;
    if (layer) query.layer = layer;

    let docs = await db.findAsync(query).sort({ created_at: -1 });
    docs = filterCandidates(docs, residentScope, readPolicy);
    if (candidateFilter) docs = await candidateFilter(docs);
    if (identityOnly) docs = docs.filter(doc => doc.v2?.lifecycle === 'core' || doc.v2?.identityRole);

    // 结构化筛选先做，让关键词路和向量路都尊重同一批候选
    if (tags && tags.length > 0) {
      docs = docs.filter(d => tags.every(t => (d.tags || []).includes(t)));
    }
    if (date) {
      docs = docs.filter(d => d.created_at && d.created_at.startsWith(date));
    }

    if (q && q.trim()) {
      const terms = queryTerms(q);
      // ── 关键词路：字面命中 + 加权排序（匹配60% + 重要度25% + 新鲜度15%）──
      const nowMs = Date.now();
      const kwRanked = docs.map(d => {
        const coverage = lexicalScore([d.title, d.content, d.category, ...(d.tags || [])].join(' '), terms);
        const titleMatch = lexicalScore(d.title, terms);
        const matchScore = coverage * 0.8 + titleMatch * 0.2;
        const imp = (d.importance !== undefined ? d.importance : 5) / 10;
        const ageDays = Math.max(0, (nowMs - new Date(d.created_at).getTime()) / 86400000);
        const fresh = Math.max(0, 1 - ageDays / 365);
        return { doc: d, matched: coverage > 0, score: matchScore * 0.6 + imp * 0.25 + fresh * 0.15 };
      }).filter(hit => hit.matched).sort((a, b) => b.score - a.score).map(x => x.doc);

      // Missing semantic service never blocks keyword recall; callers receive its status.
      let vecRanked = [];
      if (semantic !== false) {
        try {
          const settings = await this.getSettings();
          if (embeddings.isConfigured(settings)) {
            vecRanked = (await embeddings.rankBySimilarity(q.trim(), docs, settings)).map(hit => {
              if (hit.excerpt) passages.set(hit.doc._id, hit.excerpt);
              return hit.doc;
            });
          } else {
            warnings.push('语义检索尚未配置，当前按关键词查找；空结果不代表记忆不存在。');
          }
        } catch (e) {
          warnings.push('语义检索暂时不可用，当前按关键词查找；空结果不代表记忆不存在。');
          console.warn('[search] semantic recall unavailable; keyword fallback');
        }
      }

      if (!vecRanked.length) {
        docs = kwRanked;
      } else {
        // ── RRF 排名融合：两路的排名对得齐，分数量纲不用对齐 ──
        const K = 60;
        const rrf = new Map();
        kwRanked.forEach((d, i) => rrf.set(d._id, (rrf.get(d._id) || 0) + 1 / (K + i + 1)));
        vecRanked.forEach((d, i) => rrf.set(d._id, (rrf.get(d._id) || 0) + 1 / (K + i + 1)));
        const byId = new Map(docs.map(d => [d._id, d]));
        docs = [...rrf.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([id]) => byId.get(id))
          .filter(Boolean);
      }
    }

    const items = docs.slice(offset, offset + limit).map(doc => ({ ...format(doc),
      ...(passages.has(doc._id) ? { retrievalExcerpt: passages.get(doc._id) } : {}) }));
    // Keep the legacy array contract; modern adapters propagate this request-local metadata.
    Object.defineProperty(items, 'warnings', { value: warnings });
    return items;
  };
