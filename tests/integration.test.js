const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fixture, call } = require('./helpers');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

test('real service: setup, scoped REST/MCP/Client, histories, receipts and persistence', async t => {
  const f=await fixture();t.after(()=>f.close());
  let admin,a,b,ta,tb,m,sourceId;
  const request=(path,token,body,method)=>call(f.base,path,token,body,method);
  async function ok(path,token,body,method){const r=await request(path,token,body,method);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
  await t.test('empty first boot and protected data',async()=>{
    assert.deepEqual((await request('/api/setup')).data,{ready:false});
    assert.equal((await request('/api/v2/residents')).status,401);
    admin=(await ok('/api/setup',null,{password:'fictional-test-password'})).token;
    assert.equal((await request('/api/setup',null,{password:'other-password'})).status,409);
    assert.equal((await request('/api/auth',null,{password:'wrong'})).status,401);
    assert.equal((await ok('/api/auth',null,{password:'fictional-test-password'})).token,admin);
    assert.deepEqual((await ok('/api/v2/residents',admin)).items,[]);
    assert.deepEqual((await ok('/api/v2/memories/search',admin,{})).items,[]);
    for(const label of ['Test Cedar','Test River']){
      const r=await request('/api/v2/residents',admin,{label});assert.equal(r.status,201);
      if(!a)a=r.data;else b=r.data;
    }
    ta=(await request(`/api/v2/residents/${a.id}/connection`,admin,{})).data.token;
    tb=(await request(`/api/v2/residents/${b.id}/connection`,admin,{})).data.token;
    assert.equal((await request('/api/v2/residents',ta,{label:'forbidden'})).status,403);
  });
  await t.test('every identity owns its notes; sharing is explicit',async()=>{
    m=await ok('/api/v2/memories',ta,{title:'Cedar memory',content:'The cedar lantern was blue.',board:'private'});
    assert.equal(m.ownerLibrary,a.id);
    assert.equal((await request(`/api/v2/memories/${m.id}`,tb)).status,403);
    assert.equal((await request(`/api/v2/memories/${m.id}`,tb,{content:'intrusion'},'PATCH')).status,403);
    assert.equal((await request(`/api/v2/memories/${m.id}`,tb,{},'DELETE')).status,403);
    assert.equal((await request('/api/v2/memories',ta,{title:'spoof',content:'Forbidden spoof',board:'private',ownerLibrary:b.id})).status,403);
    const p=await ok('/api/v2/memories',ta,{title:'Cedar fragment',content:'A little silver bell.',board:'pulse'});
    assert.equal(p.ownerLibrary,a.id);
    const shared=await ok('/api/v2/memories',ta,{title:'Shared weather',content:'A gentle autumn morning.',board:'pulse',shared:true});
    assert.equal(shared.ownerLibrary,'');
    const rows=(await ok('/api/v2/memories/search',tb,{})).items;
    assert.deepEqual(rows.map(r=>r.id),[shared.id]);
    assert.equal((await ok('/api/v2/residents',ta)).items.length,1);
  });
  await t.test('edits preserve timeline and stale writes conflict',async()=>{
    const edited=await ok(`/api/v2/memories/${m.id}`,ta,{title:'Updated cedar',content:'The cedar lantern was green.',expectedUpdatedAt:m.updatedAt,createdAt:'2000-01-01'},'PATCH');
    assert.equal(edited.createdAt,m.createdAt);assert.notEqual(edited.updatedAt,m.updatedAt);
    assert.equal((await request(`/api/v2/memories/${m.id}`,ta,{content:'stale',expectedUpdatedAt:m.updatedAt},'PATCH')).status,409);
    const history=await ok(`/api/v2/memories/${m.id}/history`,ta);assert.ok(history.items.some(r=>r.before?.content===m.content));
    assert.equal(history.items.length,2);assert.ok(history.items.every(r=>r.status==='committed'&&r.timestamp));
    assert.equal((await request(`/api/v2/memories/${m.id}/history`,tb)).status,403);
    await ok(`/api/v2/memories/${m.id}`,ta,{},'DELETE');
    assert.ok(!(await ok('/api/v2/memories/search',ta,{})).items.some(r=>r.id===m.id));
    assert.equal((await request(`/api/v2/memories/${m.id}/restore`,tb,{})).status,403);
    await ok(`/api/v2/memories/${m.id}/restore`,ta,{});
    assert.ok((await ok('/api/v2/memories/search',ta,{})).items.some(r=>r.id===m.id));
  });
  await t.test('model context includes own related notes and rejects an owner override',async()=>{
    const own=await ok('/api/v2/context/assemble',ta,{query:'cedar lantern',mode:'chat'});
    assert.ok(own.contextText.includes('lantern'));assert.equal(own.residentId,a.id);
    const other=await ok('/api/v2/context/assemble',tb,{query:'cedar lantern',mode:'chat'});
    assert.ok(!other.memories.some(row=>row.id===m.id));
    assert.equal((await request('/api/v2/context/assemble',tb,{residentId:a.id,query:'lantern'})).status,403);
  });
  await t.test('idempotent writes survive request retries',async()=>{
    const body={title:'One receipt',content:'Only one record for one request.',board:'pulse',requestId:'retry-test'};
    const [x,y]=await Promise.all([ok('/api/v2/memories',ta,body),ok('/api/v2/memories',ta,body)]);assert.equal(x.id,y.id);
    assert.equal((await request('/api/v2/memories',ta,{...body,content:'changed'})).status,409);
    const z=await ok('/api/v2/memories',tb,body);assert.notEqual(x.id,z.id);
  });
  await t.test('MCP HTTP transport performs real isolated operations',async()=>{
    const client=new Client({name:'transport-test',version:'1.0'});t.after(()=>client.close());
    await client.connect(new StreamableHTTPClientTransport(new URL(f.base+'/mcp'),{requestInit:{headers:{Authorization:`Bearer ${tb}`}}}));
    const list=await client.listTools();assert.ok(list.tools.some(r=>r.name==='save_memory'));
    const saved=await client.callTool({name:'save_memory',arguments:{title:'MCP river',content:'River testing via MCP.',board:'private'}});
    assert.ok(!saved.isError,JSON.stringify(saved));
    const denied=await client.callTool({name:'get_memory',arguments:{id:m.id}});assert.equal(denied.isError,true);
    await client.close();
  });
  await t.test('MCP stdio forwards to same identity',async()=>{
    const client=new Client({name:'stdio-test',version:'1.0'});
    await client.connect(new StdioClientTransport({command:process.execPath,args:[require('node:path').resolve(__dirname,'../mcp-stdio.js')],
      env:{...process.env,MEMORY_API:f.base,MCP_TOKEN:ta},stderr:'pipe'}));
    try{const result=await client.callTool({name:'get_memory',arguments:{id:m.id}});assert.ok(!result.isError,JSON.stringify(result));}
    finally{await client.close();}
  });
  await t.test('URL-only MCP clients use the same fixed identity',async()=>{
    const client=new Client({name:'url-client',version:'1.0'});
    await client.connect(new StreamableHTTPClientTransport(new URL(f.base+'/mcp?token='+encodeURIComponent(ta))));
    try {
      const result=await client.callTool({name:'get_memory',arguments:{id:m.id}});assert.ok(!result.isError);
      const spoof=await client.callTool({name:'search_memory',arguments:{ownerLibrary:b.id}});assert.equal(spoof.isError,true);
    } finally { await client.close(); }
  });
  await t.test('Client discovers immutable existing IDs and enforces the actor on every operation',async()=>{
    const desc=await ok('/v1/describe',admin);sourceId=desc.sourceId;assert.ok(sourceId);assert.equal(desc.capabilities.listIdentities,true);
    assert.equal((await ok('/v1/identities',admin)).identities.length,2);
    assert.deepEqual((await ok('/v1/identities',ta)).identities.map(r=>r.id),[a.id]);
    assert.equal((await request('/v1/identities?namespace=other',ta)).status,400);
    await request('/api/v2/residents',admin,{id:a.id,label:'Renamed Cedar'});
    const validated=await ok('/v1/identities/validate',ta,{identityId:a.id});assert.equal(validated.identity.displayName,'Renamed Cedar');
    assert.equal((await request('/v1/identities/validate',ta,{identityId:b.id})).status,403);
    const actor={kind:'resident',id:a.id,displayName:'Old name'};
    const body={actor,categoryId:`private:${a.id}`,title:'Client entry',body:'A client-written memory.',metadata:{tag:'synthetic'},requestId:'client-retry'};
    const wrote=await ok('/v1/memories',admin,body);const repeat=await ok('/v1/memories',admin,body);assert.equal(wrote.memoryId,repeat.memoryId);
    const row=(await ok(`/v1/memories/${wrote.memoryId}?actorKind=resident&actorId=${a.id}`,admin)).memory;assert.deepEqual(row.metadata,{tag:'synthetic'});
    await ok(`/v1/memories/${wrote.memoryId}`,admin,{actor,body:'Edited client entry.',expectedUpdatedAt:row.updatedAt},'PATCH');
    const after=(await ok(`/v1/memories/${wrote.memoryId}`,ta)).memory;assert.equal(after.createdAt,row.createdAt);assert.notEqual(after.updatedAt,row.updatedAt);
    assert.equal((await request(`/v1/memories/${wrote.memoryId}`,admin,{actor,body:'Stale',expectedUpdatedAt:row.updatedAt},'PATCH')).status,409);
    assert.equal((await request('/v1/search',ta,{actor:{kind:'user',id:'client-user'}})).status,403);
    assert.equal((await request('/v1/search',ta,{actor:{kind:'resident',id:b.id}})).status,403);
    assert.equal((await request(`/v1/memories/${wrote.memoryId}?actorKind=resident&actorId=${b.id}`,admin)).status,403);
    assert.equal((await request(`/v1/memories/${wrote.memoryId}`,tb,{},'DELETE')).status,403);
    await ok(`/v1/memories/${wrote.memoryId}`,ta,{actor},'DELETE');
    assert.equal((await request(`/v1/memories/${wrote.memoryId}`,ta)).status,404);
    await ok(`/v1/memories/${wrote.memoryId}/restore`,ta,{actor});
    const page=await ok('/v1/search',ta,{actor,limit:1});assert.equal(page.memories.length,1);assert.ok(page.nextCursor);
    const next=await ok('/v1/search',ta,{actor,limit:1,cursor:page.nextCursor});assert.notEqual(next.memories[0].id,page.memories[0].id);
  });
  await t.test('briefing receipts are per frontend, preview does not consume, activities are shared by identity',async()=>{
    const first=await ok('/api/v2/organization/briefing',ta,{consumerId:'client'});assert.ok(first.newItems.length);
    await ok('/api/v2/organization/briefing/ack',ta,{consumerId:'client',snapshotId:first.snapshotId,runId:'wake-1',success:true});
    const second=await ok('/api/v2/organization/briefing',ta,{consumerId:'client',preview:true});assert.equal(second.newItems.length,0);assert.equal(second.snapshotId,null);
    assert.ok((await ok('/api/v2/organization/briefing',ta,{consumerId:'other-app',preview:true})).newItems.length);
    assert.equal((await request('/api/v2/organization/briefing/ack',ta,{consumerId:'other-app',snapshotId:first.snapshotId,runId:'wake-2',success:true})).status,403);
    await ok('/api/v2/organization/activities',ta,{actionId:'post-1',action:'post',title:'Synthetic post',status:'unknown'});
    const unknown=await ok('/api/v2/organization/briefing',ta,{preview:true});assert.ok(unknown.unfinished.some(r=>r.actionId==='post-1'));
    await ok('/api/v2/organization/activities',ta,{actionId:'post-1',action:'post',title:'Synthetic post',status:'succeeded'});
    const done=await ok('/api/v2/organization/briefing',ta,{preview:true});assert.ok(done.alreadyDone.some(r=>r.actionId==='post-1'));
    assert.ok(!(await ok('/api/v2/organization/activities',tb)).items.some(r=>r.actionId==='post-1'));
  });
  await t.test('restart keeps identity, source ID, credentials and original memory',async()=>{
    await f.restart();assert.equal((await ok('/v1/describe',admin)).sourceId,sourceId);
    assert.equal((await ok('/api/v2/residents',ta)).items[0].id,a.id);
    assert.equal((await ok(`/api/v2/memories/${m.id}`,ta)).createdAt,m.createdAt);
    assert.ok((await ok('/api/setup')).ready);
  });
});
