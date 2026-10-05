import { addIdentity, manageIdentity } from './identities.js';
import { $, state, api, escape as h, action, modal, close, toast } from './ui.js';
import { renderMemories, resetMemoryPage } from './memories.js';
import { renderActivities, renderBriefing } from './organizer.js';
import { openSettings } from './settings.js';
async function render() {
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('selected',b.dataset.tab===state.tab));
  try { await ({memories:renderMemories,activities:renderActivities,briefing:renderBriefing})[state.tab](); }
  catch(e){$('#content').textContent=e.message;toast(e.message);}
}
async function residents() {
  const data=await api('/residents');state.residents=data.items;
  $('#resident').innerHTML='<option value="">全部资料</option>'+data.items.map(r=>`<option value="${h(r.id)}">${h(r.label)}</option>`).join('');
  $('#resident').value=state.resident;
}
async function enter() {
  await residents();$('#login').hidden=true;$('#workspace').hidden=false;await render();
}
action($('#close-dialog'),close);
document.addEventListener('memory-changed',()=>{if(state.tab==='memories')render();});
action($('#settings'),openSettings);
action($('#logout'),async()=>{state.token='';sessionStorage.removeItem('memory-token');location.reload();});
for(const button of document.querySelectorAll('[data-tab]'))action(button,async()=>{state.tab=button.dataset.tab;await render();});
action($('#resident'),async()=>{state.resident=$('#resident').value;resetMemoryPage();await render();},'change');
action($('#add-resident'),()=>addIdentity(async()=>{await residents();await render();}));
action($('#resident-tools'),()=>manageIdentity(async()=>{await residents();await render();}));
async function boot() {
  if(state.token){try{await enter();return;}catch{state.token='';sessionStorage.removeItem('memory-token');}}
  const setup=await api('/api/setup');$('#login').hidden=false;
  $('#login-hint').textContent=setup.ready?'用管理密码打开自己的记忆空间。':'首次使用：设置一个管理密码，接下来就能添加身份。';
  action($('#login-form'),async()=>{const data=await api(setup.ready?'/api/auth':'/api/setup',{password:$('#login-form').elements.password.value});state.token=data.token;sessionStorage.setItem('memory-token',data.token);$('#login-form').reset();await enter();},'submit');
}
boot().catch(error=>toast(error.message));
