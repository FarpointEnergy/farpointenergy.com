import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createCollector,R2CreateOnlyStore} from '../../collector/core.mjs';

// Local synthetic fixtures only. No hosted requests or filesystem writes.
const root=new URL('./',import.meta.url);
const core=await readFile(new URL('../../collector/core.mjs',root),'utf8');
const wrapper=await readFile(new URL('wrapper.mjs',root),'utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from("const BUILD_SOURCE_VERSION='synthetic-private-export-test';\n"+core+'\n'+wrapper).toString('base64'))).default;
const OWNER='synthetic-private-owner';
const SECRET='synthetic-cursor-key-at-least-32-bytes';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const cases=[['list_records',{namespace:'receipts',limit:1}],['read_record_chunk',{key:'receipts/2026/10/24/synthetic-0001.json',offset:0,max_bytes:97}]];

class ReadOnlyBucket {
  constructor(){
    this.calls=[];
    this.records=new Map(Array.from({length:3},(_,index)=>{
      const key=`receipts/2026/10/24/synthetic-000${index+1}.json`;
      const bytes=Buffer.from(JSON.stringify({synthetic:true,index,payload:'synthetic café '.repeat(35+index)}));
      return[key,{key,bytes,size:bytes.length,etag:`synthetic-etag-${index}`,customMetadata:{sha256:hash(bytes)}}];
    }));
  }
  async put(){this.calls.push('put');throw new Error('writes forbidden');}
  async delete(){this.calls.push('delete');throw new Error('deletes forbidden');}
  async list(options){
    this.calls.push('list');
    const records=[...this.records.values()].filter(r=>r.key.startsWith(options.prefix));
    const start=options.cursor?Number(options.cursor.slice('synthetic-position-'.length)):0;
    const page=records.slice(start,start+options.limit),next=start+page.length,truncated=next<records.length;
    return{objects:page.map(({bytes,...metadata})=>metadata),truncated,...(truncated?{cursor:`synthetic-position-${next}`}:{})};
  }
  async head(key){this.calls.push('head');const r=this.records.get(key);if(!r)return null;const {bytes,...metadata}=r;return metadata;}
  async get(key,options){
    this.calls.push('get');
    const r=this.records.get(key);if(!r)return null;
    assert.deepEqual(options.onlyIf,{etagMatches:r.etag});
    const {offset,length}=options.range,bytes=Uint8Array.from(r.bytes.subarray(offset,offset+length));
    return{body:true,arrayBuffer:async()=>bytes.buffer};
  }
}
function fixture(overrides={}){
  const bucket=new ReadOnlyBucket();
  return{bucket,env:{BUCKET:bucket,OWNER_USER_ID:OWNER,CURSOR_HMAC_KEY:SECRET,PRIVATE_CANDIDATE_BOOTSTRAP:'1',PRIVATE_OWNER_EXPORT_ENABLED:'1',GATEWAY_IDENTITY_VERIFIED:'0',...overrides}};
}
function request(name,args,identity=OWNER,{path='/mcp',method='POST',extraHeaders={},paramsMeta,paramsExtra={}}={}){
  return new Request('https://candidate.invalid'+path,{method,headers:{'Content-Type':'application/json',...(identity===null?{}:{'oai-authenticated-user-id':identity}),...extraHeaders},...(['GET','HEAD'].includes(method)?{}:{body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args,...paramsExtra,...(paramsMeta===undefined?{}:{_meta:paramsMeta})}})})});
}
async function call(target,env,name,args,identity=OWNER,options={}){
  const response=await target.fetch(request(name,args,identity,options),env);
  return{response,answer:await response.json()};
}
function cacheProtected(response){assert.match(response.headers.get('Cache-Control'),/private/);assert.match(response.headers.get('Cache-Control'),/no-store/);assert(response.headers.get('Vary').split(',').map(value=>value.trim().toLowerCase()).includes('oai-authenticated-user-id'));}

test('private wrapper exports paginate and reconstruct existing objects without writes or environment changes',async()=>{
  const {env,bucket}=fixture(),beforeEnv={...env},before=[...bucket.records].map(([k,r])=>[k,r.bytes.toString('base64')]);
  const items=[];let cursor=null,pageCount=0;
  do{
    const {response,answer}=await call(worker,env,'list_records',{namespace:'receipts',limit:1,cursor});
    cacheProtected(response);assert.equal(response.status,200);assert.equal(answer.result.isError,false);
    const page=answer.result.structuredContent;
    assert.deepEqual(JSON.parse(answer.result.content[0].text),page);
    assert.equal(page.items.length,1);assert.equal(page.transactional_snapshot,false);
    items.push(...page.items);cursor=page.next_cursor;pageCount++;
    assert.equal(page.enumeration_complete,cursor===null);assert(pageCount<=3);
  }while(cursor);
  assert.equal(pageCount,3);assert.equal(items.length,3);
  for(const item of items){
    let offset=0;const chunks=[];
    for(;;){
      const {response,answer}=await call(worker,env,'read_record_chunk',{key:item.key,offset,max_bytes:97});
      cacheProtected(response);assert.equal(answer.result.isError,false);
      const chunk=answer.result.structuredContent,bytes=Buffer.from(chunk.body_base64,'base64');
      assert.equal(chunk.offset,offset);assert.equal(chunk.bytes,bytes.length);assert.equal(chunk.object_size,item.size);assert.equal(chunk.object_sha256,item.sha256);
      assert.equal(chunk.next_offset,offset+bytes.length);chunks.push(bytes);offset=chunk.next_offset;
      if(chunk.object_complete)break;
      assert(bytes.length>0);assert(chunks.length<30);
    }
    const restored=Buffer.concat(chunks);assert(chunks.length>1);assert.equal(restored.length,item.size);assert.equal(hash(restored),item.sha256);assert.deepEqual(restored,bucket.records.get(item.key).bytes);
  }
  assert(bucket.calls.includes('list'));assert(bucket.calls.includes('head'));assert(bucket.calls.includes('get'));
  assert(bucket.calls.every(name=>['list','head','get'].includes(name)));
  assert.deepEqual([...bucket.records].map(([k,r])=>[k,r.bytes.toString('base64')]),before);
  assert.deepEqual(env,beforeEnv);assert.equal(env.GATEWAY_IDENTITY_VERIFIED,'0');
});

test('both export tools deny missing or incorrect private flags and cursor prerequisites before storage I/O',async()=>{
  const overrides=[
    ...[undefined,'0','true',1].map(value=>({PRIVATE_OWNER_EXPORT_ENABLED:value})),
    ...[undefined,'0','true',1].map(value=>({PRIVATE_CANDIDATE_BOOTSTRAP:value})),
    ...[undefined,null,'','x'.repeat(31),'é'.repeat(15),42].map(value=>({CURSOR_HMAC_KEY:value}))
  ];
  for(const config of overrides){
    const {env,bucket}=fixture(config);
    for(const [name,args] of cases){
      const {response,answer}=await call(worker,env,name,args);
      assert.equal(response.status,403);assert.equal(answer.error.message,'Owner authorization required');cacheProtected(response);
    }
    assert.deepEqual(bucket.calls,[]);
  }
  const {env,bucket}=fixture({CURSOR_HMAC_KEY:'é'.repeat(16)});
  assert.equal((await call(worker,env,...cases[0])).answer.result.isError,false,'32 UTF-8 bytes satisfy the same core and wrapper rule');
  assert.deepEqual(bucket.calls,['list']);
});

test('both export tools deny absent, wrong or malformed caller and owner identity without storage I/O',async()=>{
  for(const identity of [null,'synthetic-wrong-owner','synthetic owner','synthetic-owner,another','x'.repeat(201),'']){
    const {env,bucket}=fixture();
    for(const [name,args] of cases){
      const {response}=await call(worker,env,name,args,identity,{extraHeaders:{'OAI-Sites-Authorization':'Bearer synthetic-bypass','oai-authenticated-user-email':'synthetic@example.invalid'}});
      assert.equal(response.status,403);cacheProtected(response);
    }
    assert.deepEqual(bucket.calls,[]);
  }
  for(const configured of [undefined,null,'',42,'synthetic owner','synthetic-owner,another','x'.repeat(201),' '+OWNER]){
    const {env,bucket}=fixture({OWNER_USER_ID:configured});
    for(const [name,args] of cases)assert.equal((await call(worker,env,name,args)).response.status,403);
    assert.deepEqual(bucket.calls,[]);
  }
});

test('private wrapper authorization is scoped to exact POST /mcp',async()=>{
  for(const options of [{path:'/mcp/'},{path:'/other'},{method:'GET'},{method:'OPTIONS'},{method:'PUT'}]){
    const {env,bucket}=fixture();
    for(const [name,args] of cases){const {response}=await call(worker,env,name,args,OWNER,options);assert([404,405].includes(response.status));}
    assert.deepEqual(bucket.calls,[]);
  }
});

test('private mode uses existing signed cursors and rejects tampering or namespace changes before listing',async()=>{
  const {env,bucket}=fixture();
  const first=(await call(worker,env,'list_records',{namespace:'receipts',limit:1})).answer.result.structuredContent;
  const args={namespace:'receipts',limit:1,cursor:first.next_cursor};
  const second=(await call(worker,env,'list_records',args)).answer.result.structuredContent;
  const replay=(await call(worker,env,'list_records',args)).answer.result.structuredContent;
  assert.deepEqual(second.items,replay.items);
  for(const bad of [{...args,namespace:'rejections'},{...args,cursor:'x'+args.cursor.slice(1)}]){
    const count=bucket.calls.length;
    const {answer}=await call(worker,env,'list_records',bad);
    assert.equal(answer.result.isError,true);assert.equal(answer.result.content[0].text,'invalid_cursor');assert.equal(bucket.calls.length,count);
  }
});

test('diagnostic distinguishes private export opt-in from unverified general gateway',async()=>{
  const {env,bucket}=fixture();
  const {answer}=await call(worker,env,'candidate_owner_binding_check',{});
  const data=JSON.parse(answer.result.content[0].text);
  assert.equal(data.gateway_identity_verified,false);assert.equal(data.private_owner_export_enabled,true);assert.equal(data.ordinary_export_gate_enabled,true);
  assert.equal(data.identity_matches_owner,true);assert.equal(JSON.stringify(data).includes(OWNER),false);assert.equal(JSON.stringify(data).includes(SECRET),false);
  assert.deepEqual(bucket.calls,[]);
  env.PRIVATE_OWNER_EXPORT_ENABLED='0';
  for(const [name,args] of cases)assert.equal((await call(worker,env,name,args)).response.status,403);
  const off=JSON.parse((await call(worker,env,'candidate_owner_binding_check',{})).answer.result.content[0].text);
  assert.equal(off.gateway_identity_verified,false);assert.equal(off.private_owner_export_enabled,false);assert.equal(off.ordinary_export_gate_enabled,false);
  assert.deepEqual(bucket.calls,[]);
});

test('core private authorization requires strict boolean opt-in, configured owner and signing key',async()=>{
  for(const value of [undefined,false,'true',1]){
    const bucket=new ReadOnlyBucket(),collector=createCollector({store:new R2CreateOnlyStore(bucket),ownerIdentity:OWNER,cursorHmacKey:SECRET,privateSiteMcpOwnerAccess:value});
    for(const [name,args] of cases)assert.equal((await call(collector,undefined,name,args)).response.status,403);
    assert.deepEqual(bucket.calls,[]);
  }
  for(const cursorHmacKey of [undefined,'short']){
    const bucket=new ReadOnlyBucket(),collector=createCollector({store:new R2CreateOnlyStore(bucket),ownerIdentity:OWNER,cursorHmacKey,privateSiteMcpOwnerAccess:true});
    for(const [name,args] of cases)assert.equal((await call(collector,undefined,name,args)).response.status,403);
    assert.deepEqual(bucket.calls,[]);
  }
  const bucket=new ReadOnlyBucket(),collector=createCollector({store:new R2CreateOnlyStore(bucket),ownerIdentity:OWNER,cursorHmacKey:SECRET,privateSiteMcpOwnerAccess:true});
  for(const [name,args] of cases)assert.equal((await call(collector,undefined,name,args)).answer.result.isError,false);
  assert(bucket.calls.every(name=>['list','head','get'].includes(name)));
});

test('existing explicit general gateway mode remains separate and rejects malformed owner identity',async()=>{
  const {env,bucket}=fixture({PRIVATE_OWNER_EXPORT_ENABLED:'0',PRIVATE_CANDIDATE_BOOTSTRAP:'0',GATEWAY_IDENTITY_VERIFIED:'1'});
  for(const [name,args] of cases)assert.equal((await call(worker,env,name,args)).answer.result.isError,false);
  assert(bucket.calls.every(name=>['list','head','get'].includes(name)));
  const malformed=new ReadOnlyBucket(),collector=createCollector({store:new R2CreateOnlyStore(malformed),ownerIdentity:'synthetic owner',verifiedGatewayIdentity:true,cursorHmacKey:SECRET});
  for(const [name,args] of cases)assert.equal((await call(collector,undefined,name,args,'synthetic owner')).response.status,403);
  assert.deepEqual(malformed.calls,[]);
});

const protocolMeta={
  'io.modelcontextprotocol/protocolVersion':'2026-07-28',
  'io.modelcontextprotocol/clientInfo':{name:'synthetic-local-client',version:'1.0.0'},
  'io.modelcontextprotocol/clientCapabilities':{}
};
test('MCP 2026-07-28 transport metadata is accepted by existing list and chunk tools without changing arguments',async()=>{
  const {env,bucket}=fixture(),beforeEnv={...env},beforeRecords=[...bucket.records].map(([key,value])=>[key,value.bytes.toString('base64')]);
  const meta={...protocolMeta,private_sentinel:'synthetic-inert-metadata',arguments:{namespace:'rejections'},'oai-authenticated-user-id':'synthetic-wrong-owner'};
  for(const [name,args] of cases){
    const {response,answer}=await call(worker,env,name,args,OWNER,{paramsMeta:meta});
    assert.equal(response.status,200);assert.equal(answer.result.isError,false);
    assert.equal(JSON.stringify(answer).includes('synthetic-inert-metadata'),false);
    if(name==='list_records')assert.equal(answer.result.structuredContent.namespace,'receipts');
    else assert.equal(answer.result.structuredContent.key,args.key);
  }
  assert(bucket.calls.every(name=>['list','head','get'].includes(name)));
  assert.deepEqual(env,beforeEnv);assert.deepEqual([...bucket.records].map(([key,value])=>[key,value.bytes.toString('base64')]),beforeRecords);
});

test('malformed metadata, unknown params and metadata inside business arguments fail before storage I/O',async()=>{
  for(const [name,args] of cases){
    for(const paramsMeta of [null,[],['unexpected'],'unexpected',0,false]){
      const {env,bucket}=fixture(),{answer}=await call(worker,env,name,args,OWNER,{paramsMeta});
      assert.equal(answer.result.isError,true);assert.equal(answer.result.content[0].text,'invalid_arguments');assert.deepEqual(bucket.calls,[]);
    }
    for(const options of [{paramsMeta:protocolMeta,paramsExtra:{unexpected:true}},{paramsMeta:protocolMeta,paramsExtra:{name:0}}]){
      const {env,bucket}=fixture(),{answer}=await call(worker,env,name,args,OWNER,options);
      assert.equal(answer.result.content[0].text,'invalid_arguments');assert.deepEqual(bucket.calls,[]);
    }
    const {env,bucket}=fixture(),{answer}=await call(worker,env,name,{...args,_meta:protocolMeta},OWNER,{paramsMeta:protocolMeta});
    assert.equal(answer.result.content[0].text,'invalid_arguments');assert.deepEqual(bucket.calls,[]);
  }
});

test('metadata never substitutes for authenticated identity and remains inside the total request byte limit',{timeout:5000},async()=>{
  for(const [name,args] of cases){
    for(const identity of [null,'synthetic-other-owner']){
      const {env,bucket}=fixture(),{response}=await call(worker,env,name,args,identity,{paramsMeta:{...protocolMeta,'oai-authenticated-user-id':OWNER,OWNER_USER_ID:OWNER}});
      assert.equal(response.status,403);assert.deepEqual(bucket.calls,[]);
    }
    const {env,bucket}=fixture(),{response,answer}=await call(worker,env,name,args,OWNER,{paramsMeta:{...protocolMeta,padding:'x'.repeat(17000)}});
    assert.equal(response.status,400);assert.equal(answer.error.code,-32700);assert.deepEqual(bucket.calls,[]);
  }
});
