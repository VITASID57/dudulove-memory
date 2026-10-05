export const $ = selector => document.querySelector(selector);
export const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const state = { token: sessionStorage.getItem('memory-token') || '', residents: [], resident: '', tab: 'memories' };
export async function api(path, body, method) {
  const response = await fetch(path.startsWith('/api/') ? path : `/api/v2${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.message || '操作未完成');
  return data;
}
let timeout;
export function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(timeout); timeout = setTimeout(() => $('#toast').hidden = true, 6000); }
export function action(element, callback, event = 'click') {
  element.addEventListener(event, async e => {
    e.preventDefault(); const button = element.matches('form') ? element.querySelector('button[type=submit],button.primary') : element;
    if (button) button.disabled = true;
    try { await callback(e); } catch (error) { toast(error.message); } finally { if (button) button.disabled = false; }
  });
}
export function modal(title, html) { $('#dialog-title').textContent = title; $('#dialog-content').innerHTML = html; if (!$('#dialog').open) $('#dialog').showModal(); }
export const close = () => $('#dialog').close();
export const date = value => value ? new Date(value).toLocaleString('zh-CN') : '未记录';
export const residentName = id => state.residents.find(r => r.id === id)?.label || (id ? '所选身份' : '共享');
export const empty = (title, text) => `<div class="empty"><strong>${escape(title)}</strong>${escape(text)}</div>`;
export function selected() { if (!state.resident) throw new Error('先选择一个身份，再查看自己的活动或简报'); return state.resident; }
export const boards = { private: '长期记忆', pulse: '日常碎片', world: '共享世界观', ops: '工程经验' };
export const boardOptions = current => Object.entries(boards).map(([id,label]) => `<option value="${id}" ${id===current?'selected':''}>${label}</option>`).join('');
