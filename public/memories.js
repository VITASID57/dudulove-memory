import { $, state, api, escape as h, action, modal, close, date, residentName, empty, boards, boardOptions, toast } from './ui.js';
let query = '', board = '', trash = false, offset = 0, request = 0;
export async function renderMemories() {
  const version = ++request;
  $('#content').innerHTML = `<div class="toolbar"><input id="query" placeholder="想起什么，就搜什么…" aria-label="搜索记忆" value="${h(query)}"><select id="board" aria-label="分类"><option value="">全部分类</option>${boardOptions(board)}</select><button id="search">搜索</button><button id="organize">整理</button><button id="trash">${trash?'返回记忆':'回收站'}</button><button id="new" class="primary">＋ 记一笔</button></div><div id="results" class="muted">正在打开记忆…</div>`;
  action($('#search'), async () => { query=$('#query').value;board=$('#board').value;offset=0;await renderMemories(); });
  $('#query').addEventListener('keydown', e => { if (e.key==='Enter') $('#search').click(); });
  action($('#trash'), async () => {trash=!trash;offset=0;await renderMemories();});
  action($('#new'), () => editor(null));
  action($('#organize'), async () => (await import('./organizer.js')).openOrganizer());
  const result = trash ? await api(`/trash${state.resident?'?ownerLibrary='+encodeURIComponent(state.resident):''}`)
    : await api('/memories/search', { query, board: board || undefined, ownerLibrary: state.resident || undefined, offset, limit:30 });
  if (version !== request || state.tab !== 'memories') return;
  const items = result.items;
  $('#results').innerHTML = `<p class="muted">${trash?'回收站':`共 ${result.total} 条记忆`}${state.resident?' · '+h(residentName(state.resident)):''}</p>`+(result.warnings || []).map(w=>`<p class="section-note">${h(w)}</p>`).join('')+
    (items.length ? `<div class="cards">${items.map(m => `<article class="card"><span class="badge">${h(boards[m.board]||m.board)}</span><span class="meta">${h(residentName(m.ownerLibrary))}</span><h3>${h(m.title)}</h3><p>${h(m.content.slice(0,180))}${m.content.length>180?'…':''}</p><div class="meta">记录于 ${date(m.createdAt)}${m.updatedAt!==m.createdAt?' · 已编辑':''}${m.organizationStale?' · 原文有更新，小结待更新':''}</div><div class="actions"><button data-open="${h(m.id)}">${trash?'查看':'查看 / 编辑'}</button>${trash?`<button data-restore="${h(m.id)}">恢复</button>`:''}</div></article>`).join('')}</div>` : empty(trash?'回收站是空的':'这里还没有匹配的记忆','随手记一笔，或换个词再找找。'));
  for (const button of document.querySelectorAll('[data-open]')) action(button, () => editor(items.find(m=>m.id===button.dataset.open)));
  for (const button of document.querySelectorAll('[data-restore]')) action(button, async () => {await api(`/memories/${button.dataset.restore}/restore`,{});toast('已恢复');await renderMemories();});
  if (!trash && result.total>30) {
    $('#results').insertAdjacentHTML('beforeend', `<div class="pagination"><button id="prev" ${offset===0?'disabled':''}>上一页</button><span>${Math.floor(offset/30)+1} / ${Math.ceil(result.total/30)}</span><button id="next" ${offset+30>=result.total?'disabled':''}>下一页</button></div>`);
    action($('#prev'),async()=>{offset=Math.max(0,offset-30);await renderMemories();}); action($('#next'),async()=>{offset+=30;await renderMemories();});
  }
}
export function resetMemoryPage() { offset=0; }
async function editor(memory) {
  const editing=Boolean(memory), owner=memory ? memory.ownerLibrary : state.resident, current=memory?.board || (owner?'pulse':'world');
  modal(editing?'一条记忆':'记下这一刻', `<form id="memory-form"><label>标题<input name="title" required maxlength="200" value="${h(memory?.title)}"></label><div class="form-grid"><label>分类<select name="board" ${editing?'disabled':''}>${boardOptions(current)}</select></label><label>归属<select name="owner" ${editing?'disabled':''}><option value="">共享</option>${state.residents.map(r=>`<option value="${h(r.id)}" ${r.id===owner?'selected':''}>${h(r.label)}</option>`).join('')}</select></label></div><label>内容<textarea name="content" rows="10" required>${h(memory?.content)}</textarea></label><p class="muted">世界观和工程经验共享；日常碎片可共享，也可归属于某位身份。长期记忆需要归属。</p>${editing?`<p class="meta">最初记录：${date(memory.createdAt)}<br>最近编辑：${date(memory.updatedAt)}</p>`:''}<div class="actions">${trash?'':`<button class="primary" type="submit">保存记忆</button>`}${editing?'<button id="history" type="button">编辑历史</button>':''}${editing&&!trash?'<button id="delete" type="button" class="danger">移入回收站</button>':''}</div></form>`);
  action($('#memory-form'), async () => {
    const form=$('#memory-form'), data={title:form.elements.title.value,content:form.elements.content.value};
    if (!editing) { data.board=form.elements.board.value; if (['private','pulse'].includes(data.board)) data.ownerLibrary=form.elements.owner.value; if (!data.ownerLibrary) data.shared=true; }
    else data.expectedUpdatedAt=memory.updatedAt;
    await api(editing?`/memories/${memory.id}`:'/memories',data,editing?'PATCH':'POST');close();toast(editing?'已保存编辑，最初记录时间保留':'记忆已保存');await renderMemories();
  },'submit');
  if ($('#delete')) action($('#delete'),async()=>{await api(`/memories/${memory.id}`,{},'DELETE');close();toast('已移入回收站，可以恢复');await renderMemories();});
  if ($('#history')) action($('#history'),async()=>{
    const result=await api(`/memories/${memory.id}/history`);
    const labels = { create: '首次记录', edit: '编辑', delete: '移入回收站', restore: '恢复' };
    modal('编辑历史',result.items.map(row=>`<div class="source"><p class="muted">${h(labels[row.operation] || '更新')} · ${date(row.timestamp)}</p>${row.before?`<h3>修改前 · ${h(row.before.title)}</h3><pre>${h(row.before.content)}</pre>`:''}${row.after?`<h3>记录内容 · ${h(row.after.title)}</h3><pre>${h(row.after.content)}</pre>`:''}</div>`).join('')||empty('还没有历史','后续编辑会保留记录。'));
  });
}
