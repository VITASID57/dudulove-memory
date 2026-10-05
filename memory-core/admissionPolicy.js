'use strict';

const { toLegacyMemoryInput, MEMORY_TYPES } = require('./mappers');
const { normalizeBoard, boardFromLayer } = require('./classifier');
const { resolveScope, isAdmin, fail } = require('./principal');
const { scopeOwner } = require('./recallPolicy');
const { refKey } = require('./sourceAuthority');

const LIFECYCLES = new Set(['inbox', 'active', 'core', 'open_loop', 'archived', 'rejected']);
const RUNTIME_FIELDS = ['browserTabs', 'cookies', 'cookie', 'oauthToken', 'password', 'paymentData', 'dom', 'taskLog', 'virtualComputerState'];
const INFERENCE = /(?:似乎|可能|推测|猜测|或许|看起来|apparently|seems|might|infer|probably).*(?:喜欢|害怕|性格|人格|一直|习惯|prefer|fear|personality)|(?:根据|based on).*(?:推断|人格|性格|personality)/i;

function checkPayload(input) {
  for (const field of ['title', 'content']) if (input[field] !== undefined && typeof input[field] !== 'string') fail(`${field} 必须是文字`, 400);
  if (input.title?.length > 500 || input.content?.length > 500000) fail('记忆内容过长，请分成几条保存', 400);
  if (input.createdAt && !Number.isFinite(Date.parse(input.createdAt))) fail('原始记录时间无效', 400);
  const meta = input.v2 || {};
  for (const [field, valid] of [['board', normalizeBoard], ['type', value => MEMORY_TYPES.has(value)], ['lifecycle', value => LIFECYCLES.has(value)]]) {
    for (const value of [input[field], meta[field]]) if (value && !valid(value)) fail(`Invalid memory ${field}`, 400);
  }
  if (input.layer && !boardFromLayer(input.layer)) fail('Invalid memory layer', 400);
  if (input.board && input.layer && normalizeBoard(input.board) !== boardFromLayer(input.layer)) fail('Conflicting board and layer', 400);
  if (RUNTIME_FIELDS.some(key => input[key] !== undefined || meta[key] !== undefined) ||
      ['task-runtime', 'credential', 'browser-state'].includes(input.domain || meta.domain)) fail('Runtime and credentials do not belong in long-term memory', 400);
  const text = `${input.title || ''}\n${input.content || ''}`;
  if (/\b(?:api[_ -]?key|password|oauth[_ -]?token|access[_ -]?token|cookie|authorization)\s*[:=]\s*\S{8,}|\bsk-[A-Za-z0-9_-]{16,}|Bearer\s+[A-Za-z0-9._-]{12,}|-----BEGIN .*PRIVATE KEY-----/i.test(text)) {
    fail('Credential payload cannot be admitted', 400);
  }
}

function validPromotion(input, principal, refs) {
  if (input.confirmed === true || input.claimKind === 'self_acknowledgement' || isAdmin(principal)) return true;
  const proof = input.promotionEvidence || input.v2?.promotionEvidence;
  if (proof?.kind === 'self_acknowledgement') return Boolean(principal.residentId);
  if (!proof || !Array.isArray(proof.sourceRefs) || !proof.sourceRefs.length || !refs.length) return false;
  if (!proof.sourceRefs.every(ref => ref && ref.kind !== 'admission' && refs.some(source => refKey(source) === refKey(ref)))) return false;
  if (proof.kind === 'human_confirmation') return isAdmin(principal);
  if (proof.kind === 'self_acknowledgement') return principal.residentId && refs.length > 0;
  if (proof.kind === 'independent_evidence') return new Set(proof.sourceRefs.map(ref => refKey({ ...ref, messageId: '' }))).size >= 2;
  return proof.kind === 'maintenance_evidence' && principal.capabilities.includes('memory:promote');
}

function prepareAdmission(input, principal, { before, reason, verifiedRefs = [] } = {}) {
  checkPayload(input);
  const scope = resolveScope(principal, input);
  const prepared = toLegacyMemoryInput(input);
  const meta = prepared.v2;
  const board = meta.board;
  if (!prepared.title || !String(prepared.content || '').trim()) fail('title and content are required', 400);
  const ownPulse = board === 'pulse' && input.shared !== true && scope.residentId &&
    (before ? Boolean(scopeOwner(before)) : !isAdmin(principal) || Boolean(input.ownerLibrary));
  if (['private', 'diary'].includes(board) || ownPulse) {
    if (!scope.residentId) fail('Resident binding is required for personal memory');
    meta.ownerLibrary = scope.residentId;
  }
  // Legacy writes retain their cabinet but gain an explicit scope for all future reads.
  if (['core', 'broadcast', 'fragments', 'user_notes', 'incubator'].includes(board)) {
    if (!scope.residentId) fail('Resident binding is required for legacy personal memory');
    meta.ownerLibrary = scope.residentId;
  }
  if (before && scopeOwner(before) && scopeOwner(before) !== scope.residentId && !isAdmin(principal)) fail('Mutation owner does not match Resident scope');
  if (board === 'pulse' && input.shared === true) meta.ownerLibrary = '';
  const refs = input.sourceRefs || meta.sourceRefs || [];
  if (!Array.isArray(refs) || refs.some(ref => !ref || typeof ref !== 'object' || !ref.kind || !ref.id)) fail('sourceRefs require kind and id', 400);
  meta.sourceRefs = refs;
  const hasSource = verifiedRefs.length > 0;
  const claimKind = input.claimKind || meta.claimKind || '';
  const inferred = before?.v2?.claimKind === 'personality_inference' || claimKind === 'personality_inference' || INFERENCE.test(`${input.title} ${input.content}`);
  const promoting = before?.v2?.lifecycle === 'inbox' && ['active', 'core'].includes(meta.lifecycle) && before?.v2?.claimKind === 'personality_inference';
  if ((inferred || promoting) && !validPromotion(input, principal, verifiedRefs)) {
    if (['active', 'core'].includes(meta.lifecycle)) meta.lifecycle = 'inbox';
    meta.reviewRequired = true;
    meta.claimKind = 'personality_inference';
  } else {
    meta.claimKind = inferred ? 'self_acknowledgement' : claimKind || (hasSource ? 'sourced_fact' : 'explicit_fact');
    meta.reviewRequired = false;
    if (input.promotionEvidence) meta.promotionEvidence = input.promotionEvidence;
  }
  // Unconfirmed claims never enter the unconditional identity lane.
  if (meta.lifecycle === 'inbox') delete meta.identityRole;
  if (input.identityRole) meta.identityRole = meta.lifecycle === 'inbox' ? undefined : input.identityRole;
  if (input.pinned === true && meta.claimKind !== 'personality_inference') {
    meta.identityRole = meta.identityRole || 'identity';
    if (!['archived', 'core'].includes(meta.lifecycle)) meta.lifecycle = 'active';
  }
  if (input.pinned === false) { delete meta.identityRole; if (meta.lifecycle === 'core') meta.lifecycle = 'active'; }
  if (input.domain) meta.domain = input.domain;
  if (input.projectId) meta.projectId = input.projectId;
  return { prepared, scope };
}
module.exports = { prepareAdmission, checkPayload, LIFECYCLES };
