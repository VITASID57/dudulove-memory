const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { fixture, call } = require('./helpers');

test('optional provider: organization, source edits, undo and semantic fallback',async t=>{
  const f=await fixture();t.after(()=>f.close());
  let failure=false, calls=0;
  const provider=http.createServer(async(req,res)=>{
    let raw='';for await(const part of req)raw+=part;
    const input=JSON.parse(raw);calls++;
    if(failure){res.writeHead(503);res.end('synthetic-provider-error');return;}
    res.setHeader('Content-Type','application/json');
    if(req.url.endsWith('/embeddings')){
      res.end(JSON.stringify({data:input.input.map((text,index)=>({index,embedding:/tea|warmth/i.test(text)?[1,0]:[0,1]}))}));return;
    }
    const prompt=input.messages[1].content,sources=JSON.parse(prompt.slice(prompt.lastIndexOf('\n')+1));
    const output=prompt.includes('"memories"')?{memories:[{title:'Synthetic summary',content:'A summary of a fictional shared afternoon.',board:'pulse',sourceKeys:sources.map(s=>s.key)}]}
      :{items:[{category:'events',text:'A fictional recent event.',sourceKeys:sources.map(s=>s.key)}]};
    res.end(JSON.stringify({choices:[{message:{content:JSON.stringify(output)}}]}));
  });
  await new Promise(resolve=>provider.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>provider.close(resolve)));
  const base=`http://127.0.0.1:${provider.address().port}/v1`;
  const admin=(await call(f.base,'/api/setup',null,{password:'fictional-test-password'})).data.token;
  const person=(await call(f.base,'/api/v2/residents',admin,{label:'Test Meadow'})).data;
  const other=(await call(f.base,'/api/v2/residents',admin,{label:'Test Harbor'})).data;
  const token=(await call(f.base,`/api/v2/residents/${person.id}/connection`,admin,{})).data.token;
  const otherToken=(await call(f.base,`/api/v2/residents/${other.id}/connection`,admin,{})).data.token;
  async function ok(path,body,method,auth=token){const r=await call(f.base,'/api/v2'+path,auth,body,method);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}
  let original,draft,summary;
  await t.test('plain fragments stay usable before any model is configured',async()=>{
    original=await ok('/memories',{board:'pulse',title:'Afternoon tea',content:'We prepared a little tea in the garden.'});
    assert.equal(calls,0);assert.equal((await ok('/memories/search',{query:'tea'})).items[0].id,original.id);
    const cfg=await ok('/organization/config');assert.equal(cfg.config.autoEnabled,false);assert.equal(cfg.model,undefined);
    assert.equal((await call(f.base,'/api/v2/organization/preview',token,{memoryIds:[original.id]})).status,400);
    assert.ok((await ok('/organization/briefing',{preview:true})).newItems.length);
  });
  await t.test('provider saves a preview and original data stays searchable',async()=>{
    await ok('/organization/model',{apiUrl:base,apiKey:'synthetic-test-key',model:'synthetic-organizer'},'PATCH',admin);
    draft=await ok('/organization/preview',{memoryIds:[original.id]});assert.equal(draft.memories.length,1);
    const result=await ok('/organization/save',{draftId:draft.id});assert.equal(result.created.length,1);summary=result.created[0];
    const repeat=await ok('/organization/save',{draftId:draft.id});assert.equal(repeat.repeated,true);
    assert.ok((await ok('/memories/search',{semantic:false})).items.some(m=>m.id===original.id));
    assert.equal((await ok('/organization/sources')).total,0);
    assert.equal((await call(f.base,'/api/v2/organization/source?kind=memory&id='+original.id,otherToken)).status,403);
    const brief=await ok('/organization/briefing',{preview:true,refresh:true});assert.ok(brief.generatedAt);
  });
  await t.test('changed sources disable only obsolete summaries; ordinary memories remain useful',async()=>{
    await ok(`/memories/${original.id}`,{content:'We prepared mint tea in the garden.'},'PATCH');
    const rows=(await ok('/memories/search',{semantic:false})).items;
    assert.ok(rows.some(m=>m.id===original.id));assert.ok(!rows.some(m=>m.id===summary.id));
    assert.equal((await ok('/organization/sources')).total,1);
    await ok('/organization/undo',{draftId:draft.id});assert.ok((await ok('/trash')).items.some(m=>m.id===summary.id));
  });
  await t.test('pasted chat material is kept with its owner and retrievable after summarizing',async()=>{
    const pasted=await ok('/organization/preview',{text:'User: Shall we visit a fictional lake?\nAssistant: Next Saturday.',title:'Synthetic chat'});
    await ok('/organization/save',{draftId:pasted.id});
    const source=(await ok('/organization/sources')).conversations[0];assert.ok(source.id);
    const material=await ok(`/organization/source?kind=conversation&id=${source.id}`);assert.match(material.content,/fictional lake/);
    assert.equal((await call(f.base,`/api/v2/organization/source?kind=conversation&id=${source.id}`,otherToken)).status,403);
  });
  await t.test('a provider outage cannot delete or invalidate the original',async()=>{
    failure=true;assert.equal((await call(f.base,'/api/v2/organization/preview',token,{memoryIds:[original.id]})).status,502);
    assert.match((await ok(`/memories/${original.id}`)).content,/mint tea/);failure=false;
  });
  await t.test('vector search complements keywords and falls back when provider fails',async()=>{
    await ok('/settings/embedding',{apiUrl:base,apiKey:'synthetic-test-key',model:'synthetic-embedding'},'PATCH',admin);
    await ok('/settings/embedding/rebuild',{},'POST',admin);
    const result=await ok('/memories/search',{query:'warmth'});assert.ok(result.items.some(m=>m.id===original.id));
    failure=true;const fallback=await ok('/memories/search',{query:'garden'});assert.ok(fallback.items.some(m=>m.id===original.id));assert.ok(fallback.warnings.length);
    const settings=await ok('/settings/embedding',undefined,undefined,admin);assert.equal(settings.hasKey,true);assert.ok(!JSON.stringify(settings).includes('synthetic-test-key'));
  });
});
