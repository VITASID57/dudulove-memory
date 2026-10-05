function estimateTokens(value) {
  const text = String(value || '');
  if (!text) return 0;
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g) || []).length;
  const other = Math.max(0, text.length - cjk);
  return cjk + Math.ceil(other / 4);
}
module.exports = { estimateTokens };
