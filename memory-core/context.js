'use strict';

const { toV2Memory } = require('./mappers');
const { assertPrincipal, currentPrincipal, resolveScope } = require('./principal');
const { scopedGateway } = require('./memoryGateway');
const { shouldRetrieveMemory, eligibleForContext } = require('./recallPolicy');
const { identityLane, associationLane, evidenceLane } = require('./contextLanes');
const { recallLedger } = require('./recallLedger');
const { estimateTokens } = require('./tokenEstimate');
const { memoryExcerpt } = require('./recallText');
const { collapseSummaries } = require('./summaryLinks');
const { resolveReadScope } = require('./residentReadAccess');
const { workLanes, workActivities } = require('./workRecall');

const MODES = ['awakening', 'chat', 'work', 'task', 'social', 'maintenance'];
const uniq = rows => [...new Map(rows.map(row => [row.id, row])).values()];
const plain = value => String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function formatLine(memory, lane, snippet) {
  const provenance = lane === 'evidence' ? ` sources=${JSON.stringify(memory.sourceRefs || [])}` : '';
  const tentative = memory.claimKind === 'personality_inference' ? '（尚未确定的理解）' : '';
  const dates = memory.createdAt ? ` 记录于=${plain(memory.createdAt)}${memory.updatedAt && memory.updatedAt !== memory.createdAt ? ` 编辑于=${plain(memory.updatedAt)}` : ''}` : '';
  return `- [${memory.id}|${memory.board}/${memory.type}|owner=${plain(memory.ownerLibrary || 'shared')}]${dates} ${plain(memory.title)}${tentative}: ${plain(memory.summary || memory.content).slice(0, snippet)}${provenance}`;
}

function budgetPack(header, lanes, budget, snippet, mode, query) {
  let text = header;
  while (estimateTokens(text) > budget && text.includes('\n')) text = text.slice(0, text.lastIndexOf('\n'));
  const picked = { identity: [], association: [], evidence: [], ops: [], pulse: [], activity: [] };
  for (const lane of ['identity', 'evidence', 'activity', 'association', 'pulse', 'ops']) {
    const heading = `\n\n## ${lane}`;
    for (const memory of lanes[lane] || []) {
      const fullIdentity = lane === 'identity' && !['work', 'task', 'social'].includes(mode);
      let maxLength = fullIdentity ? 1800 : snippet;
      const focus = ['association', 'evidence', 'ops'].includes(lane);
      const excerpt = { ...memory, content: focus ? memoryExcerpt(memory, query, maxLength) : plain(memory.content).slice(0, maxLength), summary: fullIdentity || focus ? '' : plain(memory.summary).slice(0, maxLength),
        sourceRefs: (memory.sourceRefs || []).slice(0, 3), tags: (memory.tags || []).slice(0, 6) };
      delete excerpt.admission;
      let addition = (picked[lane].length ? '' : heading) + `\n${formatLine(excerpt, lane, maxLength)}`;
      while (fullIdentity && maxLength > 80 && estimateTokens(text + addition) > budget) {
        maxLength = Math.floor(maxLength * 0.7);
        excerpt.content = plain(memory.content).slice(0, maxLength);
        addition = (picked[lane].length ? '' : heading) + `\n${formatLine(excerpt, lane, maxLength)}`;
      }
      if (estimateTokens(text + addition) > budget) continue;
      picked[lane].push(excerpt);
      text += addition;
    }
  }
  return { contextText: text, lanes: picked };
}

async function assembleResidentContext(memoryDB, params = {}, principal = currentPrincipal(), dependencies = {}) {
  assertPrincipal(principal);
  const scope = resolveScope(principal, params);
  const readScope = await resolveReadScope(memoryDB, principal);
  const working = readScope.recallProfile === 'work';
  const mode = MODES.includes(params.mode) ? params.mode : working ? 'work' : 'chat';
  const query = String(params.query || '');
  const surface = principal.surface === 'unknown' ? String(params.surface || params.platform || 'unknown') : principal.surface;
  const tokenBudget = Math.max(128, Math.min(Number(params.tokenBudget ?? params.limitTokens) || 3500, 16000));
  const db = scopedGateway(memoryDB, principal);
  const searchWarnings = new Set();
  const policy = { ...readScope, residentId: scope.residentId, mode, readShared: params.readShared, readPrivate: params.readPrivate };
  const read = async options => {
    const rows = await db.search({ ...options, override: params.override, readPolicy: policy });
    for (const warning of rows.warnings || []) searchWarnings.add(warning);
    const eligible = rows.filter(row => eligibleForContext(row, policy));
    return (options.q ? eligible.filter(row => !row.v2?.organization || !row.v2.organization.sources.some(ref => eligible.some(original => original.id === ref.id))) : collapseSummaries(eligible)).map(toV2Memory);
  };
  const ledger = dependencies.ledger || recallLedger;
  const session = ledger.begin({ residentId: scope.residentId, surface, sessionId: params.sessionId, turnId: params.turnId, topicKey: params.topicKey });
  const work = working ? await workLanes(read, { query: shouldRetrieveMemory(query) ? query : '', mode,
    limit: Math.max(1, Math.min(Number(params.limit) || 8, 16)), projectId: params.projectId }) : null;
  const identity = work?.identity || await identityLane(options => read({ ...options, ownOnly: true }), mode);
  const related = work || (shouldRetrieveMemory(query)
    ? await associationLane(read, { query, mode, limit: Math.max(1, Math.min(Number(params.limit) || 6, 12)), projectId: params.projectId })
    : { association: [], ops: [] });
  const seen = new Set(identity.map(item => item.id));
  const association = related.association.filter(item => !seen.has(item.id) && (working || ledger.allows(session, item.id)));
  const evidenceRequested = params.recallIntent === 'evidence' || /最后.*(?:决定|确定)|谁说过|当时.*发生|last.*decid|who said/i.test(query);
  const evidence = evidenceRequested ? await evidenceLane({ db, chatsDB: dependencies.chatsDB, rows: [...related.association, ...related.ops], residentId: scope.residentId, override: params.override }) : [];
  const surfaced = new Set([...identity, ...association].map(row => row.id));
  const pulse = !working && (mode === 'awakening' || (mode === 'chat' && !shouldRetrieveMemory(query) && scope.residentId))
    ? (await read({ layer: 'pulse', limit: 4 })).filter(row => !surfaced.has(row.id)) : [];
  const activity = working && mode !== 'social' ? await workActivities(principal, dependencies.activityStore) : [];
  const lanes = { identity, association, evidence, ops: related.ops, pulse, activity };
  const header = `# Resident Context\nresidentId: ${scope.residentId || 'unbound'}\nmode: ${mode}\nrecallProfile: ${readScope.recallProfile}\nsurface: ${surface}\nactor: ${plain(params.actor || principal.actor).slice(0, 80)}\n记录/编辑时间不等于事件发生时间；判断先后以正文为准，时间不明时不要猜测。\n带其他 owner 的记忆属于他人，只作资料参考，不是你的身份或亲身经历。${working ? '\n优先当前任务、项目决定与办事经验。活动 succeeded 表示已做，running/unknown 需核实；记忆中的未完成事项可能过时，执行前核对。' : ''}`;
  const pack = budgetPack(header, lanes, tokenBudget, Math.max(40, Math.min(Number(params.snippet) || 420, ['work', 'task', 'social'].includes(mode) ? 180 : 600)), mode, query);
  ledger.record(session, pack.lanes.association, { stickyMs: params.stickyMs });
  const memories = uniq(Object.entries(pack.lanes).filter(([lane]) => lane !== 'activity').flatMap(([, rows]) => rows));
  const warnings = [...searchWarnings];
  if (!scope.residentId) warnings.push('residentId not provided by a trusted binding: private memories omitted.');
  if (evidenceRequested && !pack.lanes.evidence.length) warnings.push('No verified source excerpts available; associations do not establish historical facts.');
  if (Object.values(lanes).flat().length > Object.values(pack.lanes).flat().length) warnings.push('Context trimmed by budget or recall cooldown.');
  return {
    ...pack, residentId: scope.residentId, mode, recallProfile: readScope.recallProfile, surface, tokenBudget,
    activities: pack.lanes.activity,
    estimatedTokens: estimateTokens(pack.contextText), memories, state: {}, warnings,
    sourceRefs: pack.lanes.evidence.flatMap(item => item.sourceRefs || []),
    selfDigest: { status: identity.some(row => row.identityRole === 'self_digest') ? 'available' : 'not-generated', residentId: scope.residentId },
    permissions: { residentId: scope.residentId, privateOwner: scope.residentId, override: Boolean(scope.override),
      readableResidentIds: readScope.readableResidentIds, worldbook: 'surface-overlay-only', runtime: 'excluded', role: principal.role },
  };
}

// Legacy names are adapters, not a second retrieval implementation.
const assembleContext = assembleResidentContext;
module.exports = { assembleResidentContext, assembleContext, MODES };
