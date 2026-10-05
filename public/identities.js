import { $, state, api, escape as h, action, modal, close, toast } from './ui.js';

const profiles = value => `<option value="companion" ${value !== 'work' ? 'selected' : ''}>对话 · 偏好与相关经历</option><option value="work" ${value === 'work' ? 'selected' : ''}>工作 · 规则、项目经验与行动结果</option>`;

export function addIdentity(refresh) {
  modal('添加记忆身份', `<form id="resident-form"><label>名字<input name="label" required maxlength="80" placeholder="例如：工作助手"></label><label>召回方式<select name="profile">${profiles()}</select></label><p class="muted">创建后会生成固定身份 ID。改名或更换客户端，记忆仍跟随这个身份。</p><button class="primary" type="submit">创建</button></form>`);
  action($('#resident-form'), async () => {
    const form = $('#resident-form');
    const row = await api('/residents', { label: form.elements.label.value, recallProfile: form.elements.profile.value });
    state.resident = row.id;
    close(); await refresh(); toast('已创建，可以记录记忆或复制连接');
  }, 'submit');
}

export function manageIdentity(refresh) {
  const row = state.residents.find(r => r.id === state.resident);
  if (!row) throw new Error('先选择一个记忆身份');
  const access = row.readAccess || { mode: 'self', residentIds: [] };
  modal('身份与连接', `<form id="rename-form"><label>名字<input name="label" required maxlength="80" value="${h(row.label)}"></label><p class="meta">固定 ID：${h(row.id)}</p><button type="submit">保存名字</button></form><hr>
    <form id="profile-form"><label>召回方式<select name="profile">${profiles(row.recallProfile)}</select></label><label>可读取的资料<select name="access"><option value="self">本人和共享资料</option><option value="selected">本人、共享及指定身份</option><option value="all">全部身份，包括以后新增的身份</option></select></label>
    <div id="read-targets">${state.residents.filter(r => r.id !== row.id).map(r => `<label class="check"><input type="checkbox" name="target" value="${h(r.id)}" ${access.residentIds.includes(r.id) ? 'checked' : ''}>${h(r.label)}</label>`).join('') || '<p class="muted">添加其他身份后，可在这里逐个授权。</p>'}</div>
    <p class="section-note">读取授权由你管理。修改、删除和整理权限仍限于本人的资料与共享区。保存后，各客户端的后续请求使用最新权限。</p><button type="submit" class="primary">保存召回与授权</button></form><hr>
    <p class="muted">同一个身份的连接可以用于多个客户端；召回与读取权限由本页统一管理。</p><button id="show-connection">查看专属连接</button><div id="connection"></div>`);
  const form = $('#profile-form');
  form.elements.access.value = access.mode;
  const showTargets = () => { $('#read-targets').hidden = form.elements.access.value !== 'selected'; };
  form.elements.access.addEventListener('change', showTargets); showTargets();
  action($('#rename-form'), async () => {
    await api('/residents', { id: row.id, label: $('#rename-form').elements.label.value });
    await refresh(); toast('名字已保存');
  }, 'submit');
  action(form, async () => {
    await api(`/residents/${row.id}/profile`, { recallProfile: form.elements.profile.value,
      readAccess: { mode: form.elements.access.value, residentIds: [...form.querySelectorAll('[name=target]:checked')].map(el => el.value) } }, 'PATCH');
    await refresh(); toast('召回与授权已保存');
  }, 'submit');
  action($('#show-connection'), async () => showConnection(await api(`/residents/${row.id}/connection`, {})));
}

function showConnection(data) {
  const url = location.origin;
  const text = `身份：${data.label}\n固定 ID：${data.residentId}\nHTTP API：${url}/api/v2\nMCP（Streamable HTTP）：${url}/mcp\nAuthorization: Bearer ${data.token}`;
  const config = JSON.stringify({ mcpServers: { memory: { url: `${url}/mcp`, headers: { Authorization: `Bearer ${data.token}` } } } }, null, 2);
  $('#connection').innerHTML = `<p class="section-note">连接口令用于访问这个身份的资料。请交给可信客户端；跨设备时使用服务的 HTTPS 地址。</p><pre>${h(text)}</pre><button id="copy-connection">复制连接说明</button><button id="copy-mcp-url">复制 MCP 专属链接</button><p class="muted">专属链接适合只能填写网址的客户端，内含身份口令，按密码保管。</p><details><summary>MCP 配置示例</summary><pre>${h(config)}</pre><button id="copy-mcp">复制 MCP 配置</button><p class="muted">适用于接受 mcpServers、url 和 headers 的客户端；其他客户端可单独填写上述地址与口令。</p></details>`;
  action($('#copy-connection'), async () => { await navigator.clipboard.writeText(text); toast('已复制'); });
  action($('#copy-mcp'), async () => { await navigator.clipboard.writeText(config); toast('已复制'); });
  action($('#copy-mcp-url'), async () => { await navigator.clipboard.writeText(`${url}/mcp?token=${encodeURIComponent(data.token)}`); toast('已复制 MCP 专属链接'); });
}
