import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

// Synthetic identities are strictly local fixtures; no network requests are made.
const root=new URL('./',import.meta.url);
const core=await readFile(new URL('../../collector/core.mjs',root),'utf8');
const wrapper=await readFile(new URL('wrapper.mjs',root),'utf8');
const sourceVersion='synthetic-local-owner-binding-test';
const worker=(await import('data:text/javascript;base64,'+Buffer.from(`const BUILD_SOURCE_VERSION=${JSON.stringify(sourceVersion)};\n`+core+'\n'+wrapper).toString('base64'))).default;
const owner='synthetic-private-owner-value';
const tool='candidate_owner_binding_check';
const rpc=(name=tool)=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}});
function request(body=rpc(),identity=owner){
  return new Request('https://candidate.invalid/mcp',{method:'POST',headers:{'Content-Type':'application/json',...(identity===null?{}:{'oai-authenticated-user-id':identity})},body:JSON.stringify(body)});
}
function fixture(overrides={}){
  const calls=[];
  const bucket=Object.fromEntries(['put','get','head','list','delete'].map(name=>[name,async()=>{calls.push(name);throw new Error('unexpected_storage_access');}]));
  const env={BUCKET:bucket,PRIVATE_CANDIDATE_BOOTSTRAP:'1',GATEWAY_IDENTITY_VERIFIED:'0',OWNER_USER_ID:owner,...overrides};
  return {env,calls};
}
async function check(body=rpc(),identity=owner,overrides={}){
  const {env,calls}=fixture(overrides),before={...env};
  const response=await worker.fetch(request(body,identity),env);
  const serialized=await response.text(),answer=JSON.parse(serialized);
  assert.deepEqual(calls,[],'diagnostic must not access R2');
  assert.deepEqual(env,before,'diagnostic must not mutate environment');
  assert.equal(serialized.includes(owner),false,'owner identity must not appear in output');
  return {response,answer,serialized,env};
}

test('matching owner receives only safe diagnostic fields while ordinary export stays gated',async()=>{
  const {response,answer,env}=await check();
  assert.equal(response.status,200);
  assert.equal(answer.result.isError,false);
  assert.deepEqual(JSON.parse(answer.result.content[0].text),{scope:'authenticated_owner_binding_only',identity_present:true,owner_secret_configured:true,identity_matches_owner:true,gateway_identity_verified:false,private_owner_export_enabled:false,ordinary_export_gate_enabled:false,source_version:sourceVersion});
  assert.match(response.headers.get('Cache-Control'),/no-store/);
  for(const name of ['list_records','read_record_chunk']){
    const ordinary=await worker.fetch(request(rpc(name)),env);
    assert.equal(ordinary.status,403);
    assert.equal((await ordinary.json()).error.message,'Owner authorization required');
  }
});

test('missing, wrong and malformed identities fail closed without storage I/O',async()=>{
  for(const identity of [null,'synthetic-other-person','synthetic-owner,another','x'.repeat(201),'synthetic owner','']){
    const {response,answer,serialized}=await check(rpc(),identity);
    assert.equal(response.status,403);
    assert.equal(answer.result.isError,true);
    assert.equal(answer.result.content.length,1);
    if(identity)assert.equal(serialized.includes(identity),false);
  }
});

test('missing or malformed owner configuration fails closed',async()=>{
  for(const secret of [undefined,null,'',42,{},'synthetic owner','synthetic,owner','x'.repeat(201)]){
    const {response,answer}=await check(rpc(),owner,{OWNER_USER_ID:secret});
    assert.equal(response.status,403);
    assert.equal(answer.result.content[0].text,'Owner binding verification failed');
  }
});

test('arguments must be an explicitly empty object and extra params are rejected',async()=>{
  for(const args of [undefined,null,[],['x'],'',0,false,{unexpected:true},{__proto__:null,constructor:true}]){
    const body=rpc();body.params.arguments=args;
    const {response,answer}=await check(body);
    assert.equal(response.status,200);
    assert.equal(answer.result.isError,true);
    assert.equal(answer.result.content[0].text,'invalid_arguments');
  }
  const body=rpc();body.params.extra='ignored-is-not-allowed';
  const {answer}=await check(body);
  assert.equal(answer.result.content[0].text,'invalid_arguments');
});

test('disabled candidate gate removes tool discovery and prevents execution',async()=>{
  for(const gate of [undefined,'0','true',1]){
    const overrides={PRIVATE_CANDIDATE_BOOTSTRAP:gate};
    const {answer}=await check({jsonrpc:'2.0',id:1,method:'tools/list'},owner,overrides);
    assert.equal(answer.result.tools.some(t=>t.name===tool),false);
    const {response}=await check(rpc(),owner,overrides);
    assert.equal(response.status,403);
  }
  const {answer}=await check({jsonrpc:'2.0',id:1,method:'tools/list'});
  assert.equal(answer.result.tools.filter(t=>t.name===tool).length,1);
  assert.equal(answer.result.tools.some(t=>t.name==='bootstrap_owner_identity'),true);
  assert.equal(answer.result.tools.some(t=>t.name==='candidate_storage_check'),true);
});

test('malformed RPC envelopes retain core validation instead of executing diagnostic',async()=>{
  const invalid=[null,[],{...rpc(),jsonrpc:'1.0'},{...rpc(),id:{}},{...rpc(),id:'x'.repeat(101)},{...rpc(),id:'é'.repeat(51)},{...rpc(),extra:true},{...rpc(),method:1}];
  for(const body of invalid){
    for(const identity of [owner,null]){
      const {response,answer}=await check(body,identity);
      assert.equal(response.status,400);
      assert.equal(answer.error.code,-32600);
      assert.equal(answer.result,undefined);
    }
  }
});

test('a hosting bypass token or owner config never substitutes for caller identity',async()=>{
  const {env,calls}=fixture({HOSTING_BYPASS_TOKEN:'synthetic-private-hosting-secret'});
  const req=request(rpc(),null);
  req.headers.set('Authorization','Bearer synthetic-private-hosting-secret');
  req.headers.set('OAI-Sites-Authorization','Bearer synthetic-private-hosting-secret');
  const response=await worker.fetch(req,env);
  assert.equal(response.status,403);
  const serialized=await response.text();
  assert.equal(serialized.includes(owner),false);
  assert.equal(serialized.includes(env.HOSTING_BYPASS_TOKEN),false);
  assert.deepEqual(calls,[]);
});

test('safe output omits unrelated secrets and reports gate configuration without changing it',async()=>{
  const overrides={GATEWAY_IDENTITY_VERIFIED:'1',CURSOR_HMAC_KEY:'synthetic-private-cursor-secret',HOSTING_BYPASS_TOKEN:'synthetic-private-hosting-secret',OWNER_EMAIL:'synthetic-owner@example.invalid'};
  const {answer,serialized,env}=await check(rpc(),owner,overrides);
  const data=JSON.parse(answer.result.content[0].text);
  assert.equal(data.gateway_identity_verified,true);
  assert.equal(data.private_owner_export_enabled,false);
  assert.equal(data.ordinary_export_gate_enabled,true);
  assert.equal(env.GATEWAY_IDENTITY_VERIFIED,'1');
  for(const value of [overrides.CURSOR_HMAC_KEY,overrides.HOSTING_BYPASS_TOKEN,overrides.OWNER_EMAIL])assert.equal(serialized.includes(value),false);
  for(const [key,value] of Object.entries(data))assert.equal(typeof value,['scope','source_version'].includes(key)?'string':'boolean');
});

test('existing bootstrap compatibly reports the same safe owner match without enrollment or export authorization',async()=>{
  const {env,calls}=fixture(),before={...env};
  const response=await worker.fetch(request(rpc('bootstrap_owner_identity')),env);
  assert.equal(response.status,200);
  const answer=await response.json(),data=JSON.parse(answer.result.content[0].text);
  assert.equal(answer.result.isError,false);
  assert.equal(data.site_scoped_user_id,owner,'legacy identity field remains available only on bootstrap');
  assert.equal(data.owner_enrolled,false);
  const {site_scoped_user_id,owner_enrolled,...safe}=data;
  const diagnostic=await check();
  assert.deepEqual(safe,JSON.parse(diagnostic.answer.result.content[0].text));
  assert.equal(JSON.stringify(safe).includes(owner),false);
  for(const name of ['list_records','read_record_chunk'])assert.equal((await worker.fetch(request(rpc(name)),env)).status,403);
  assert.deepEqual(env,before);
  assert.deepEqual(calls,[]);
});

test('bootstrap reports missing or mismatched owner safely without changing its enrollment behavior',async()=>{
  for(const configured of [undefined,'synthetic-different-configured-owner']){
    const {env,calls}=fixture({OWNER_USER_ID:configured}),before={...env};
    const response=await worker.fetch(request(rpc('bootstrap_owner_identity')),env);
    assert.equal(response.status,200);
    const data=JSON.parse((await response.json()).result.content[0].text);
    assert.equal(data.site_scoped_user_id,owner);
    assert.equal(data.owner_enrolled,false);
    assert.equal(data.identity_present,true);
    assert.equal(data.owner_secret_configured,configured!==undefined);
    assert.equal(data.identity_matches_owner,false);
    assert.equal(data.ordinary_export_gate_enabled,false);
    assert.equal(data.source_version,sourceVersion);
    if(configured)assert.equal(JSON.stringify(data).includes(configured),false);
    assert.deepEqual(env,before);
    assert.deepEqual(calls,[]);
  }
});

test('bootstrap still requires authenticated candidate access and never treats a bypass token as identity',async()=>{
  for(const overrides of [{},{PRIVATE_CANDIDATE_BOOTSTRAP:'0'}]){
    const {env,calls}=fixture(overrides),before={...env};
    const req=request(rpc('bootstrap_owner_identity'),null);
    req.headers.set('OAI-Sites-Authorization','Bearer synthetic-private-hosting-secret');
    const response=await worker.fetch(req,env);
    assert.equal(response.status,403);
    const serialized=await response.text();
    assert.equal(serialized.includes(owner),false);
    assert.equal(serialized.includes('synthetic-private-hosting-secret'),false);
    assert.deepEqual(env,before);
    assert.deepEqual(calls,[]);
  }
});

test('owner diagnostic accepts inert official MCP metadata while sharing strict params validation',async()=>{
  const body=rpc();
  body.params._meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'synthetic-local-client',version:'1.0.0'},'io.modelcontextprotocol/clientCapabilities':{},private_sentinel:'synthetic-inert-metadata'};
  const {answer,serialized}=await check(body);
  assert.equal(answer.result.isError,false);assert.equal(JSON.parse(answer.result.content[0].text).identity_matches_owner,true);
  assert.equal(serialized.includes('synthetic-inert-metadata'),false);
  for(const metadata of [null,[],0,false,'unexpected']){
    body.params._meta=metadata;
    assert.equal((await check(body)).answer.result.content[0].text,'invalid_arguments');
  }
});

test('bootstrap accepts transport metadata but private probes reject malformed metadata and argument shapes',async()=>{
  const meta={'io.modelcontextprotocol/protocolVersion':'2026-07-28','io.modelcontextprotocol/clientInfo':{name:'synthetic-local-client',version:'1.0.0'},'io.modelcontextprotocol/clientCapabilities':{}};
  const {env,calls}=fixture(),body=rpc('bootstrap_owner_identity');body.params._meta=meta;
  assert.equal((await (await worker.fetch(request(body),env)).json()).result.isError,false);
  for(const name of ['bootstrap_owner_identity','candidate_storage_check']){
    for(const params of [{name,arguments:{},_meta:[]},{name,arguments:{},_meta:meta,unexpected:true},...[null,[],0,false,''].map(argumentsValue=>({name,arguments:argumentsValue,_meta:meta}))]){
      const response=await worker.fetch(request({...rpc(name),params}),env),answer=await response.json();
      assert.equal(answer.result.content[0].text,'invalid_arguments');
    }
  }
  assert.deepEqual(calls,[]);
});
