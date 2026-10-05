const OWNER_LIBRARIES = Object.freeze({});
const BOARDS = {
 world: { label: '共享世界观', layer: 'world', lifecycle: 'active', visibility: 'work' },
 pulse: { label: '日常碎片', layer: 'pulse', lifecycle: 'inbox', visibility: 'private' },
 private: { label: '私人记忆', layer: 'private', lifecycle: 'active', visibility: 'private', requiresOwner: true },
 ops: { label: '工程经验', layer: 'ops', lifecycle: 'active', visibility: 'work' },
};
const BOARD_BY_LAYER = Object.fromEntries(Object.entries(BOARDS).map(([key, value]) => [value.layer, key]));
const V3_BOARD_IDS = Object.keys(BOARDS);
const LEGACY_BOARD_IDS = [];
function classifyMemory(input = {}) {
  const text = searchableText(input);
  const explicitBoard = normalizeBoard(input.board || input.v2?.board);
  const explicitLayer = input.layer || input.v2?.layer;
  const type = input.type || input.v2?.type || inferTypeFromText(text, explicitBoard, explicitLayer);
  const board = explicitBoard || boardFromLayer(explicitLayer) || inferBoard({ ...input, type }, text);
  const boardDef = BOARDS[board] || BOARDS.pulse;
  const scope = input.scope || input.v2?.scope || inferScopeFromText(text, board, type);
  const lifecycle = input.lifecycle || input.v2?.lifecycle || inferLifecycle(text, board, type);
  const visibility = input.visibility || input.v2?.visibility || inferVisibility(text, board, scope);
  const unresolved = Boolean(input.unresolved ?? input.v2?.unresolved ?? inferUnresolved(text, board));
  const importance = normalizeImportance(input.importance, board, type, unresolved);
  const confidence = normalizeConfidence(input.confidence, input.v2?.confidence, input.explicit);
  const ownerLibrary = normalizeOwnerLibrary(
    input.ownerLibrary || input.owner || input.v2?.ownerLibrary || input.v2?.owner
  );
  const voiceAs = normalizeVoiceAs(input.voiceAs || input.v2?.voiceAs || input.perspective);
  const tags = mergeTags(input.tags, input.v2?.tags, [board, type, scope, ownerLibrary].filter(Boolean));

  const needsOwner = Boolean(boardDef.requiresOwner);
  const missingOwner = needsOwner && !ownerLibrary;

  return {
    board,
    boardLabel: boardDef.label,
    layer: boardDef.layer,
    type,
    scope,
    lifecycle,
    visibility,
    importance,
    confidence,
    unresolved,
    ownerLibrary: ownerLibrary || '',
    voiceAs: voiceAs || '',
    tags,
    reviewRequired: shouldReview({
      ...input,
      type,
      board,
      visibility,
      unresolved,
      confidence,
      ownerLibrary,
      missingOwner,
    }),
    reason: reasonFor(board, type, lifecycle, ownerLibrary, voiceAs),
  };
}

function searchableText(input = {}) {
  return [
    input.title,
    input.content,
    input.summary,
    input.category,
    input.layer,
    input.type,
    input.scope,
    input.ownerLibrary,
    input.owner,
    input.voiceAs,
    ...(Array.isArray(input.tags) ? input.tags : []),
  ].filter(Boolean).join(' ').toLowerCase();
}

function normalizeBoard(board) {
  const key = String(board || '').trim().toLowerCase();
  return ({ world:'world', '共享世界观':'world', pulse:'pulse', '日常碎片':'pulse', private:'private', '私人记忆':'private', diary:'private', journal:'private', ops:'ops', '工程经验':'ops' })[key] || '';
}

const LEGACY_LAYER_ALIASES = { journal: "private" };

function boardFromLayer(layer) {
  if (!layer) return '';
  const key = String(layer).toLowerCase();
  return BOARD_BY_LAYER[key] || LEGACY_LAYER_ALIASES[key] || '';
}

function normalizeOwnerLibrary(value) {
  if (!value) return '';
  const raw = String(value).trim().toLowerCase();
  if (!raw) return '';
  for (const entry of Object.values(OWNER_LIBRARIES)) {
    if (entry.aliases.some(alias => String(alias).toLowerCase() === raw)) {
      return entry.id;
    }
  }
  return /^[a-z][a-z0-9_-]{0,63}$/.test(raw) ? raw : '';
}

function normalizeVoiceAs(value) {
  if (value === undefined || value === null) return '';
  const text = String(value).trim();
  return text.slice(0, 80);
}

function ownerLabel(ownerLibrary) {
  return OWNER_LIBRARIES[ownerLibrary]?.label || ownerLibrary || '';
}

function inferBoard(input, text) {
  const type = input.type;

  // templates: diary templates stay diary-adjacent; default ops/system templates -> ops
  if (type === 'template') {
    if (/(日记|日报|每日|窗口总结|阶段总结|wrapup|reflection|summary|diary|daily)/i.test(text)) {
      return 'private';
    }
    return 'ops';
  }

  if (/(密码|银行卡|身份证|token|api[_\s-]?key|secret|ssh|私钥)/i.test(text)) {
    // still classify, but prefer private/ops never shared pulse for secrets — ops for eng secrets cues, else private
    if (/(deploy|pm2|nginx|server|部署|服务器|命令|接口)/i.test(text)) return 'ops';
    return 'private';
  }

  if (/(codex|claude code|\bcc\b|mcp|api|server|deploy|deployment|pm2|nginx|ssh|git|node|next|react|数据库|服务端|服务器|部署|报错|命令|代码|架构|接口|工具|踩坑|运维)/i.test(text)) {
    return 'ops';
  }

  if (/(开窗必读|核心身份|关系契约|边界|禁忌|隐私规则|称呼约定|人格锚点|必须记住|private library)/i.test(text)
    || ['identity', 'relationship', 'boundary'].includes(type)) {
    // exclusive relationship material defaults to private; explicit world text goes world
    if (/(共享|全员|住户|世界观|公开设定|大家知道)/i.test(text)) return 'world';
    return 'private';
  }

  if (/(总结|日记|日报|周报|月报|复盘|窗口总结|阶段总结|wrapup|reflection|summary)/i.test(text)
    || type === 'reflection') {
    return 'private';
  }

  if (/(世界观|人设公开|共同经历|大事件|编年|住户介绍|shared world|全员应知)/i.test(text)) {
    return 'world';
  }

  if (/(博客|随笔|絮絮叨|自我表达|长文|essay|blog)/i.test(text)) {
    // 长文暂无单独柜：进私人库或日记，默认 private
    return 'private';
  }

  if (['project', 'tool'].includes(type)) return 'ops';
  if (type === 'creative') return 'private';
  if (type === 'preference' && /(全员|共享|大家)/i.test(text)) return 'world';

  // short-lived daily scraps
  return 'pulse';
}

function inferTypeFromText(text, board, layer) {
  if (/(模板|模版|格式范本|撰写规则|template)/i.test(text)) return 'template';
  if (/(边界|禁忌|隐私|安全规则|不允许|必须确认|boundary)/i.test(text)) return 'boundary';
  if (/(身份|人格|我们是谁|persona|identity)/i.test(text)) return 'identity';
  if (/(关系|称呼|恋人|伴侣|relationship)/i.test(text)) return 'relationship';
  if (/(偏好|喜欢|讨厌|雷点|作息|习惯|preference)/i.test(text)) return 'preference';
  if (/(心情|情绪|难过|开心|害怕|焦虑|安慰|emotion)/i.test(text)) return 'emotion';
  if (/(codex|claude code|\bcc\b|部署|代码|接口|数据库|服务器|project)/i.test(text)) return 'project';
  if (/(工具|命令|脚本|mcp|api|tool)/i.test(text)) return 'tool';
  if (/(总结|日记|复盘|reflection|summary)/i.test(text)) return 'reflection';
  if (/(博客|随笔|絮絮叨|长文|灵感|创作|世界观|人设|剧情|essay|blog|writing|draft|longform|creative)/i.test(text)) return 'creative';
  if (/(发生|今天|昨天|纪念|event)/i.test(text)) return 'event';
  if (board === 'world' || layer === 'world' || layer === 'shared-world') return 'identity';
  if (board === 'ops' || layer === 'ops' || layer === 'tools') return 'project';
  if (board === 'diary' || layer === 'journal' || layer === 'daily' || board === 'broadcast') return 'reflection';
  if (board === 'private' || layer === 'private' || layer === 'core' || board === 'core') return 'relationship';
  if (board === 'pulse' || layer === 'pulse' || layer === 'diary' || board === 'fragments') return 'misc';
  return 'misc';
}

function inferScopeFromText(_text, board, type) {
  if (type === 'template') return 'system';
  return board === 'ops' ? 'project' : 'relationship';
}

function inferLifecycle(text, board, type) {
  if (board === 'core' || board === 'private' && type === 'identity') return board === 'core' ? 'core' : 'active';
  if (board === 'pulse' || board === 'fragments') return 'inbox';
  if (['world', 'private', 'ops'].includes(board)) return 'active';
  if (type === 'template') return 'active';
  if (/(完成|已完成|done|归档|archive)/i.test(text)) return 'archived';
  if (/(待办|待完成|未完成|继续|追问|open loop|todo)/i.test(text)) return 'open_loop';
  if (type === 'reflection') return 'active';
  if (board === 'world' || board === 'private') return 'active';
  return 'active';
}

function inferVisibility(text, board, scope) {
  if (/(公开|可公开|public)/i.test(text)) return 'public';
  // 五柜共享层：住户内可见，不走外网 social 审核
  if (board === 'ops' || board === 'tools' || board === 'world' || board === 'pulse' || board === 'shared_world' || scope === 'project') {
    return 'work';
  }
  if (/(群聊|对外|social)/i.test(text) || scope === 'social') return 'social';
  return 'private';
}

function inferUnresolved(text, board) {
  if (board === 'incubator' || board === 'pulse') return /(待|未完成|继续|之后|下次|todo|open loop)/i.test(text);
  return /(未解决|还没|待确认|继续聊|追问|open loop|todo)/i.test(text);
}

function normalizeImportance(value, board, type, unresolved) {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.min(5, Math.max(1, Math.round(n)));
  if (board === 'world' || board === 'core' || board === 'private' || ['identity', 'relationship', 'boundary'].includes(type)) return 5;
  if (board === 'diary' || board === 'broadcast' || board === 'ops' || board === 'tools') return 4;
  if (unresolved) return 4;
  return 3;
}

function normalizeConfidence(value, fallback, explicit) {
  const n = Number(value ?? fallback);
  if (Number.isFinite(n) && n > 0) return Math.min(5, Math.max(1, Math.round(n)));
  return explicit ? 5 : 4;
}

function mergeTags(...groups) {
  const tags = new Set();
  for (const group of groups) {
    if (!group) continue;
    const values = Array.isArray(group) ? group : String(group).split(',');
    for (const value of values) {
      const tag = String(value || '').trim();
      if (tag) tags.add(tag);
    }
  }
  return Array.from(tags);
}

function shouldReview({ type, board, visibility, unresolved, confidence, missingOwner }) {
  // 只拦：缺 owner、边界类、明确外网可见、低置信未决
  if (missingOwner) return true;
  if (type === 'boundary') return true;
  if (board === 'core' && confidence < 5) return true; // 旧核心层仍谨慎
  if (visibility === 'public') return true;
  if (unresolved && confidence <= 3) return true;
  return false;
}

function reasonFor(board, type, lifecycle, ownerLibrary, voiceAs) {
  const parts = [
    BOARDS[board]?.label || board,
    type,
    lifecycle,
  ];
  if (ownerLibrary) parts.push(`owner=${ownerLabel(ownerLibrary)}`);
  if (voiceAs) parts.push(`voice=${voiceAs}`);
  return parts.join(' / ');
}

module.exports = {
  BOARDS,
  OWNER_LIBRARIES,
  V3_BOARD_IDS,
  LEGACY_BOARD_IDS,
  classifyMemory,
  normalizeBoard,
  normalizeOwnerLibrary,
  normalizeVoiceAs,
  ownerLabel,
  boardFromLayer,
};
