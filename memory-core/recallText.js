'use strict';

const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
const stopWords = new Set(('的 了 着 过 吗 呢 啊 呀 吧 哦 是 有 在 和 与 或 也 都 就 又 还 很 更 最 ' +
  '我 你 他 她 它 我们 你们 他们 这个 那个 什么 怎么 怎样 是否 能不能 可以 请 帮 帮我 ' +
  '记得 记忆 记住 还记得 上次 之前 当时 一起 一起去 去 说 说过 告诉 找 找到 查一下 ' +
  'the a an is are was were to of and or in on for i you we it do does did can could please remember').split(' '));

function plainText(value) {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function queryTerms(query) {
  const text = plainText(query).toLowerCase().slice(0, 1000);
  const words = [...segmenter.segment(text)].filter(part => part.isWordLike).map(part => part.segment);
  return [...new Set(words.filter(word => !stopWords.has(word)))].slice(0, 48);
}

function lexicalScore(value, terms) {
  const text = plainText(value).toLowerCase();
  if (!text || !terms.length) return 0;
  let matched = 0, total = 0;
  for (const term of terms) {
    const weight = Math.min(term.length, 8);
    total += weight;
    if (text.includes(term)) matched += weight;
  }
  return matched / total;
}

// Return a contiguous stored passage. A matching title must not hide a body hit.
function relevantExcerpt(value, query, maxLength = 420) {
  const text = plainText(value);
  if (text.length <= maxLength) return text;
  const terms = queryTerms(query);
  const lower = text.toLowerCase();
  const starts = new Set([0]);
  const width = Math.max(1, maxLength - 2);
  for (const term of terms) {
    let index = lower.indexOf(term), found = 0;
    while (index >= 0 && found++ < 64) {
      starts.add(Math.max(0, Math.min(text.length - width, index - Math.floor(width / 3))));
      index = lower.indexOf(term, index + term.length);
    }
  }
  let bestStart = 0, bestScore = -1;
  for (const start of starts) {
    const score = lexicalScore(text.slice(start, start + width), terms);
    if (score > bestScore) { bestScore = score; bestStart = start; }
  }
  const end = bestStart + width;
  return `${bestStart ? '…' : ''}${text.slice(bestStart, end)}${end < text.length ? '…' : ''}`;
}

function memoryExcerpt(memory, query, maxLength) {
  const content = memory.content || memory.summary;
  // Semantic hits already identify a source chunk; reuse it for paraphrased queries.
  const passage = lexicalScore(content, queryTerms(query)) > 0 ? content : memory.retrievalExcerpt || content;
  return relevantExcerpt(passage, query, maxLength);
}

module.exports = { plainText, queryTerms, lexicalScore, relevantExcerpt, memoryExcerpt };
