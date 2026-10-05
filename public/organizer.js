import { CHAT_FILE_LIMIT, parseChatMaterial, decodeChatFile } from './chat-material.js';
import { $, state, api, escape as h, action, modal, close, date, selected, empty, toast, boardOptions } from './ui.js';
export async function openOrganizer() {
  const residentId=state.resident || 'shared';
  const sources=await api(`/organization/sources?residentId=${encodeURIComponent(residentId)}`);
  modal('整理记忆', `<p class="section-note">由整理模型分别整理每个身份的资料。待整理碎片来自当前归属的日常碎片；保存小结后原文仍保留，继续可检索。</p><form id="organize-form"><h3>待整理碎片 · ${sources.total} 条</h3><div>${sources.items.map(s=>`<label class="check source"><input type="checkbox" name="source" value="${h(s.id)}"><span>${h(s.title)} <small>${date(s.createdAt)}</small></span></label>`).join('')||'<p class="muted">目前没有待整理碎片。</p>'}</div>${residentId!=='shared'?'<label>或粘贴一段聊天<textarea name="text" placeholder="可直接粘贴，也可导入 TXT / JSON。导入后先检查内容。"></textarea></label><label>导入文件<input id="import-chat" type="file" accept=".txt,.json,text/plain,application/json"></label>':''}<div class="actions"><button class="primary" type="submit">生成整理预览</button><button id="organization-history" type="button">已保存的小结</button></div></form>`);
  if ($('#import-chat')) action($('#import-chat'),async e=>{
    const file=e.target.files?.[0];if(!file)return;if(file.size>CHAT_FILE_LIMIT)throw new Error('请分成小于 2 MB 的文件导入');
    const text=parseChatMaterial(decodeChatFile(await file.arrayBuffer()),file.name);
    $('#organize-form').elements.text.value=text;toast('已读入，请检查后生成预览');
  },'change');
  action($('#organization-history'),()=>history(residentId));
  action($('#organize-form'),async()=>{
    const memoryIds=[...document.querySelectorAll('[name=source]:checked')].map(e=>e.value);
    const draft=await api('/organization/preview',{residentId,memoryIds,text:$('#organize-form').elements.text?.value || ''});
    preview(draft,residentId);
  },'submit');
}
function preview(draft,residentId) {
  modal('检查整理结果',draft.memories.length?`<form id="draft-form">${draft.memories.map((m,i)=>`<div class="source"><label>标题<input name="title${i}" value="${h(m.title)}" required></label><label>分类<select name="board${i}">${boardOptions(m.board)}</select></label><label>内容<textarea name="content${i}" rows="6" required>${h(m.content)}</textarea></label></div>`).join('')}<p class="muted">可以直接修改这份草稿。原文不会删除，也不会改掉原始记录时间。</p><button class="primary" type="submit">保存这些小结</button></form>`:empty('这批内容没有需要新增的小结','原文保留，随时可以继续存取。'));
  if(!$('#draft-form'))return;
  action($('#draft-form'),async()=>{
    const form=$('#draft-form'),memories=draft.memories.map((m,i)=>({...m,title:form.elements[`title${i}`].value,content:form.elements[`content${i}`].value,board:form.elements[`board${i}`].value}));
    const result=await api('/organization/save',{residentId,draftId:draft.id,memories});close();toast(result.message || `已保存 ${result.created.length} 条小结，原文保留`);
    document.dispatchEvent(new Event('memory-changed'));
  },'submit');
}
async function history(residentId) {
  const data=await api(`/organization/history?residentId=${encodeURIComponent(residentId)}`);
  modal('整理记录',data.items.map(row=>`<div class="source"><p>${h(row.memories.map(m=>m.title).join('、'))}</p><p class="meta">${date(row.createdAt)}</p><button data-undo="${h(row.id)}">撤销这次小结</button></div>`).join('')||empty('还没有整理记录','生成预览并保存后会出现在这里。'));
  for(const button of document.querySelectorAll('[data-undo]'))action(button,async()=>{await api('/organization/undo',{residentId,draftId:button.dataset.undo});toast('已撤销小结，原文保留');await history(residentId);});
}
export async function renderActivities() {
  if(!state.resident){$('#content').innerHTML=empty('活动跟着身份走','在上方选择一个身份，查看它做过什么。');return;}
  const residentId=selected(),data=await api(`/organization/activities?residentId=${encodeURIComponent(residentId)}&limit=200`);
  if(state.tab!=='activities'||residentId!==state.resident)return;
  const labels={succeeded:'已完成',running:'进行中',unknown:'结果待核实',failed:'未成功',skipped:'本次未行动'};
  $('#content').innerHTML=`<p class="section-note">这里记录资料变更，以及客户端上报的行动与结果。</p>`+(data.items.length?`<p class="muted">共 ${data.total} 条活动，显示最近 ${data.items.length} 条。</p><div class="cards">${data.items.map(row=>`<article class="card"><span class="badge">${labels[row.status]||h(row.status)}</span><span class="meta">${date(row.happenedAt)}</span><h3>${h(row.title)}</h3><p>${h(row.detail)}</p>${row.note?`<p>备注：${h(row.note)}</p>`:''}<button data-note="${h(row._id)}">补充备注</button></article>`).join('')}</div>`:empty('还没有活动','从存入第一条记忆开始，慢慢积累。'));
  for(const button of document.querySelectorAll('[data-note]'))action(button,async()=>{
    const row=data.items.find(r=>r._id===button.dataset.note);
    modal('活动备注',`<form id="note-form"><p>${h(row.title)}</p><label>补充说明<textarea name="note">${h(row.note)}</textarea></label><p class="muted">备注单独记录时间，不改原行为结果。</p><button class="primary" type="submit">保存备注</button></form>`);
    action($('#note-form'),async()=>{await api('/organization/activities',{residentId,id:row._id,note:$('#note-form').elements.note.value},'PATCH');close();await renderActivities();},'submit');
  });
}
export async function renderBriefing(refresh=false) {
  if(!state.resident){$('#content').innerHTML=empty('每个身份自己的近况','在上方选择一个身份，看看最近发生了什么。');return;}
  const residentId=selected();$('#content').innerHTML='<p class="muted">正在准备近况…</p>';
  const data=await api('/organization/briefing',{residentId,preview:true,consumerId:'management',refresh});
  if(state.tab!=='briefing'||residentId!==state.resident)return;
  $('#content').innerHTML=`<div class="toolbar"><button id="refresh-brief" class="primary">让整理模型更新简报</button><button id="brief-settings">简报设置</button></div><p class="muted">管理页面只是预览，不会消耗任何前端的未读进度。未配置模型时，可以查看原文摘录。</p>${data.warnings.map(w=>`<p class="section-note">${h(w)}</p>`).join('')}<article class="card readable">${h(data.contextText)}</article>`;
  action($('#refresh-brief'),()=>renderBriefing(true));action($('#brief-settings'),async()=>(await import('./settings.js')).openBriefingSettings());
}
