const {
  BOARDS,
  classifyMemory,
  normalizeBoard,
  normalizeOwnerLibrary,
  normalizeVoiceAs,
  ownerLabel,
} = require('./classifier');
const { normalizeMemoryContent } = require('./contentFormat');
const { memoryOwnerLibrary } = require('./privateAccess');

const MEMORY_TYPES = new Set([
  'identity',
  'relationship',
  'boundary',
  'preference',
  'event',
  'emotion',
  'project',
  'creative',
  'tool',
  'reflection',
  'template',
  'misc',
]);

function normalizeTags(tags) {
  if (Array.isArray(tags)) return tags.filter(Boolean).map(String);
  if (typeof tags === 'string') {
    return tags.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
}

function textOf(memory) {
  return [
    memory.title,
    memory.content,
    memory.category,
    ...(memory.tags || []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function inferType(memory = {}) {
  if (memory.type && MEMORY_TYPES.has(memory.type)) return memory.type;
  if (memory.v2?.type && MEMORY_TYPES.has(memory.v2.type)) return memory.v2.type;
  const category = String(memory.category || '').toLowerCase();
  const layer = String(memory.layer || '').toLowerCase();
  const text = textOf(memory);

  if (category.includes('boundary') || text.includes('边界') || text.includes('禁忌')) return 'boundary';
  if (category.includes('identity') || text.includes('身份') || text.includes('我们是谁')) return 'identity';
  if (category.includes('relationship') || text.includes('关系') || text.includes('称呼')) return 'relationship';
  if (category.includes('preference') || text.includes('偏好') || text.includes('雷点')) return 'preference';
  if (category.includes('emotion') || text.includes('情绪') || text.includes('心情')) return 'emotion';
  if (category.includes('project') || category.includes('deploy') || layer === 'tools') return 'project';
  if (category.includes('tool')) return 'tool';
  if (category.includes('template') || category.includes('模板') || category.includes('模版') || text.includes('template') || text.includes('模板') || text.includes('模版')) return 'template';
  if (category.includes('creative') || layer === 'creative') return 'creative';
  if (category.includes('summary') || category.includes('diary') || layer === 'daily') return 'reflection';
  if (category.includes('event') || layer === 'chat') return 'event';
  if (layer === 'core') return 'relationship';
  if (layer === 'diary') return 'misc';
  return 'misc';
}

function inferScope(memory = {}) { return memory.scope || memory.v2?.scope || (memory.layer === 'ops' ? 'project' : 'relationship'); }

function inferVisibility(memory = {}) {
  if (memory.visibility) return memory.visibility;
  if (memory.v2?.visibility) return memory.v2.visibility;
  const scope = inferScope(memory);
  const type = inferType(memory);
  const category = String(memory.category || '').toLowerCase();
  if (category.includes('public')) return 'public';
  if (scope === 'social') return 'social';
  if (scope === 'project' || type === 'project' || type === 'tool') return 'work';
  return 'private';
}

function legacyLayerForType(type) {
  // V3 defaults: new writes land on new layers when type-only is given
  switch (type) {
    case 'identity':
    case 'relationship':
    case 'boundary':
    case 'preference':
      return 'private';
    case 'project':
    case 'tool':
      return 'ops';
    case 'creative':
      return 'world';
    case 'reflection':
    case 'template':
      return 'private';
    case 'event':
    case 'emotion':
    case 'misc':
    default:
      return 'pulse';
  }
}

function boardLabelFor(board) {
  return BOARDS[board]?.label || '';
}

function toV2Memory(memory) {
  if (!memory) return null;
  const meta = memory.v2 || {};
  const type = inferType(memory);
  const scope = inferScope(memory);
  const ownerLibrary = memoryOwnerLibrary(memory);
  const voiceAs = normalizeVoiceAs(meta.voiceAs || memory.voiceAs);
  return {
    id: memory.id || memory._id,
    type: meta.type || type,
    scope: meta.scope || scope,
    board: meta.board || boardFromLegacy(memory),
    boardLabel: meta.boardLabel || boardLabelFor(meta.board || boardFromLegacy(memory)),
    lifecycle: meta.lifecycle || '',
    identityRole: meta.identityRole || '',
    pinned: Boolean(meta.identityRole || meta.lifecycle === 'core'),
    claimKind: meta.claimKind || '',
    domain: meta.domain || '',
    projectId: meta.projectId || '',
    admission: meta.admission,
    ownerLibrary: ownerLibrary || '',
    ownerLabel: ownerLibrary ? ownerLabel(ownerLibrary) : '',
    voiceAs: voiceAs || '',
    title: memory.title || '',
      content: memory.content || '',
      ...(memory.retrievalExcerpt ? { retrievalExcerpt: memory.retrievalExcerpt } : {}),
    summary: meta.summary || memory.summary || '',
    tags: normalizeTags(memory.tags),
    importance: Math.min(5, Math.max(1, Number(memory.importance) || 3)),
    confidence: Math.min(5, Math.max(1, Number(meta.confidence ?? memory.confidence) || 4)),
    emotionalValence: normalizeNumber(meta.emotionalValence ?? memory.emotionalValence, -1, 1),
    emotionalArousal: normalizeNumber(meta.emotionalArousal ?? memory.emotionalArousal, 0, 1),
    recallWeight: normalizeNumber(meta.recallWeight ?? memory.recallWeight, 0, 10),
    unresolved: Boolean(meta.unresolved ?? memory.unresolved),
    reviewRequired: Boolean(meta.reviewRequired),
    classificationReason: meta.classificationReason || '',
    consolidatedAt: meta.consolidatedAt || '',
    organization: meta.organization || null,
    organizationStale: Boolean(memory.organizationStale),
    consolidatedInto: Array.isArray(meta.consolidatedInto) ? meta.consolidatedInto : [],
    consolidationNote: meta.consolidationNote || '',
    sourceRefs: meta.sourceRefs || memory.sourceRefs || [{
      kind: 'legacy-memory',
      id: memory.id,
      source: memory.source || 'unknown',
      createdAt: memory.created_at,
    }],
    visibility: meta.visibility || inferVisibility(memory),
    legacy: {
      layer: memory.layer,
      category: memory.category,
      source: memory.source,
      author: memory.author,
      mood: memory.mood,
      expires_at: memory.expires_at,
      is_deleted: memory.is_deleted,
    },
    validFrom: meta.validFrom || memory.validFrom,
    validTo: meta.validTo || memory.validTo,
    createdBy: memory.author || memory.source || 'unknown',
    updatedBy: meta.updatedBy || memory.updatedBy || memory.author || memory.source || 'unknown',
    createdAt: memory.created_at,
    updatedAt: memory.updated_at,
    archivedAt: meta.archivedAt || memory.archivedAt,
  };
}

function normalizeNumber(value, min, max) {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

function toLegacyMemoryInput(input = {}) {
  const classification = classifyMemory(input);
  const type = input.type || input.v2?.type || classification.type || inferType(input);
  const board = normalizeBoard(input.board || input.v2?.board) || classification.board || boardFromLegacy(input);
  const boardLabel = input.boardLabel || input.v2?.boardLabel || classification.boardLabel || boardLabelFor(board);
  const layer = input.layer || classification.layer || BOARDS[board]?.layer || legacyLayerForType(type);
  const scope = input.scope || input.v2?.scope || classification.scope || inferScope(input);
  const visibility = input.visibility || input.v2?.visibility || classification.visibility || inferVisibility(input);
  const lifecycle = input.lifecycle || input.v2?.lifecycle || classification.lifecycle || BOARDS[board]?.lifecycle || '';
  const boardNeedsOwner = board === 'private' || board === 'diary' || board === 'pulse';
  // 换柜到非私人/日记时强制清空 owner，避免 PATCH 合并旧 v2 粘住
  let ownerLibrary = '';
  let voiceAs = '';
  if (boardNeedsOwner) {
    ownerLibrary = normalizeOwnerLibrary(
      input.ownerLibrary || input.owner || input.v2?.ownerLibrary || input.v2?.owner || classification.ownerLibrary
    ) || '';
    voiceAs = normalizeVoiceAs(
      input.voiceAs || input.v2?.voiceAs || input.perspective || classification.voiceAs
    ) || '';
  }
  return {
    title: input.title,
    content: normalizeMemoryContent(input.content),
    category: input.category || type,
    layer,
    tags: normalizeTags(input.tags || classification.tags),
    source: input.source || input.createdBy || 'memory-hub-v2',
    author: input.author || input.createdBy || null,
    mood: input.mood || null,
    created_at: input.createdAt || input.created_at || null,
    importance: input.importance || classification.importance || defaultImportance(type),
    v2: {
      ...(input.v2 || {}),
      type,
      scope,
      board,
      boardLabel,
      lifecycle,
      ownerLibrary: ownerLibrary || '',
      voiceAs: voiceAs || '',
      summary: input.summary || input.v2?.summary || '',
      confidence: input.confidence !== undefined ? Number(input.confidence) : (input.v2?.confidence ?? classification.confidence),
      emotionalValence: normalizeNumber(input.emotionalValence ?? input.v2?.emotionalValence, -1, 1),
      emotionalArousal: normalizeNumber(input.emotionalArousal ?? input.v2?.emotionalArousal, 0, 1),
      recallWeight: normalizeNumber(input.recallWeight ?? input.v2?.recallWeight, 0, 10),
      unresolved: Boolean(input.unresolved ?? input.v2?.unresolved ?? classification.unresolved),
      sourceRefs: Array.isArray(input.sourceRefs) ? input.sourceRefs : input.v2?.sourceRefs,
      visibility,
      validFrom: input.validFrom || input.v2?.validFrom,
      validTo: input.validTo || input.v2?.validTo,
      updatedBy: input.updatedBy || input.createdBy || input.v2?.updatedBy,
      archivedAt: input.archivedAt || input.v2?.archivedAt,
      reviewRequired: input.reviewRequired !== undefined
        ? Boolean(input.reviewRequired)
        : (input.v2?.reviewRequired ?? classification.reviewRequired),
      classificationReason: classification.reason,
    },
  };
}

function boardFromLegacy(memory = {}) { return require('./classifier').boardFromLayer(memory.layer); }

function defaultImportance(type) {
  if (['identity', 'relationship', 'boundary'].includes(type)) return 5;
  if (['preference', 'project', 'reflection', 'template'].includes(type)) return 4;
  return 3;
}

function legacySearchForV2(params = {}) {
  const type = params.type;
  const out = {
    q: params.query || params.q || '',
    category: params.category,
    layer: params.layer,
    tags: normalizeTags(params.tags),
    source: params.source,
    date: params.date,
    limit: Number(params.limit) || 20,
    offset: Number(params.offset) || 0,
  };
  if (!out.layer && type) out.layer = legacyLayerForType(type);
  return out;
}


module.exports = { MEMORY_TYPES, normalizeTags, normalizeMemoryContent, inferType, inferScope, inferVisibility, legacyLayerForType, toV2Memory, toLegacyMemoryInput, legacySearchForV2, classifyMemory };
