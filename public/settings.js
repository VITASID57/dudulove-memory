import { $, state, api, escape as h, action, modal, toast, residentName } from './ui.js';

const connection = (id, label, data) => `<h3>${label}</h3><label>兼容 OpenAI 的 API 基址<input name="${id}Url" type="url" value="${h(data.apiUrl)}" placeholder="https://api.example/v1"></label><label>模型名称<input name="${id}Model" value="${h(data.model)}"></label><label>API 密钥${data.hasKey ? '（已保存，留空保持）' : ''}<input name="${id}Key" type="password" autocomplete="new-password"></label>`;

export async function openSettings() {
  const residentId = state.resident || 'shared';
  const [org, embed] = await Promise.all([api(`/organization/config?residentId=${encodeURIComponent(residentId)}`), api('/settings/embedding')]);
  modal('模型与整理设置', `<form id="settings-form"><p class="section-note">整理模型负责摘要；向量模型用于语义搜索。配置后相关内容会发送给所填写的 API 服务，按服务商规则计费。</p><h3>周期整理 · ${h(residentName(state.resident))}</h3><label class="check"><input name="auto" type="checkbox" ${org.config.autoEnabled ? 'checked' : ''}>为当前资料范围每天自动整理一次</label><p class="muted">由整理模型分别整理每个身份的资料。默认关闭，积累至少 3 条新碎片后处理，并更新近期简报；原文持续保留。</p><details><summary>整理模型</summary>${connection('org', '资料整理与简报', org.model || {})}</details><details><summary>向量模型</summary>${connection('emb', '语义搜索', embed)}<p class="muted">索引覆盖 ${embed.status.embedded} / ${embed.status.total} 条。未配置或暂时失败时，关键词搜索仍可用。</p></details><button class="primary" type="submit">保存设置</button></form><details><summary>已有记忆的向量索引</summary><button id="rebuild-index">补齐索引</button><p class="muted">使用已保存的模型配置，资料多时需要一些时间。</p></details><details><summary>连接资料管理客户端</summary><p class="muted">管理连接可查看全部资料并修改授权，请交给自己信任的管理客户端。Agent 使用「身份与连接」中的专属口令。</p><button id="management-connection">查看管理连接</button><div id="management-details"></div></details>`);
  action($('#settings-form'), async () => {
    const form = $('#settings-form');
    for (const [prefix, path] of [['org', '/organization/model'], ['emb', '/settings/embedding']]) {
      await api(path, { apiUrl: form.elements[`${prefix}Url`].value, model: form.elements[`${prefix}Model`].value, apiKey: form.elements[`${prefix}Key`].value }, 'PATCH');
    }
    await api('/organization/config', { residentId, autoEnabled: form.elements.auto.checked }, 'PATCH');
    toast('设置已保存'); await openSettings();
  }, 'submit');
  action($('#rebuild-index'), async () => { await api('/settings/embedding/rebuild', {}); toast('索引检查已完成'); await openSettings(); });
  action($('#management-connection'), () => {
    const text = `HTTP API：${location.origin}/api/v2\n客户端接口：${location.origin}/v1\n命名空间：default\nAuthorization: Bearer ${state.token}`;
    $('#management-details').innerHTML = `<pre>${h(text)}</pre><button id="copy-management">复制管理连接</button>`;
    action($('#copy-management'), async () => { await navigator.clipboard.writeText(text); toast('已复制'); });
  });
}

export async function openBriefingSettings() {
  const residentId = state.resident;
  const { config } = await api(`/organization/config?residentId=${encodeURIComponent(residentId)}`);
  modal('简报设置', `<form id="briefing-form"><h3>${h(residentName(residentId))}</h3><label>时间范围<select name="days">${[3, 7, 30].map(n => `<option value="${n}" ${n === config.days ? 'selected' : ''}>最近 ${n} 天</option>`).join('')}</select></label><label class="check"><input name="chats" type="checkbox" ${config.includeChats ? 'checked' : ''}>包含在本库保存的聊天材料</label>${Object.entries({ events: '最近事件', user: '用户近况', unfinished: '未完事项', resident: '本人经历' }).map(([id, label]) => `<label class="check"><input name="focus" value="${id}" type="checkbox" ${config.focus.includes(id) ? 'checked' : ''}>${label}</label>`).join('')}<label>额外关注<input name="instruction" maxlength="500" value="${h(config.instruction)}"></label><button class="primary" type="submit">保存简报设置</button></form>`);
  action($('#briefing-form'), async () => {
    const form = $('#briefing-form');
    await api('/organization/config', { residentId, days: Number(form.elements.days.value), includeChats: form.elements.chats.checked, focus: [...form.querySelectorAll('[name=focus]:checked')].map(el => el.value), instruction: form.elements.instruction.value }, 'PATCH');
    toast('简报设置已保存');
  }, 'submit');
}
