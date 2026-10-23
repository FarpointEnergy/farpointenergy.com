import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createCollector,R2CreateOnlyStore,MAX_BODY_BYTES,MAX_EXPORT_CHUNK_BYTES,sha256} from '../../collector/core.mjs';

const enc=new TextEncoder(),dec=new TextDecoder();
const ORIGIN='https://farpointenergy.com',OWNER='synthetic-owner-identity',SECRET='synthetic-only-cursor-signing-secret-at-least-32-characters';
const FIXED='2026-10-23T12:00:00.000Z';
const allStores=[];

class MemoryR2 {
  constructor(){allStores.push(this);}
  records=new Map();operations=[];failWrites=false;failReads=false;truncateRead=false;badList=false;changedGet=false;maximumPage=1000;
  async put(key,value,options) {
    this.operations.push({operation:'put',key,options});
    assert.deepEqual(options.onlyIf,{etagDoesNotMatch:'*'},'every write must be conditional');
    if(this.failWrites)throw new Error('synthetic-storage-secret-do-not-echo');
    if(this.records.has(key))return null;
    const bytes=new Uint8Array(value).slice();
    const entry={bytes,key,size:bytes.length,etag:`etag-${this.records.size}`,customMetadata:options.customMetadata};
    this.records.set(key,entry);return {...entry};
  }
  async head(key){this.operations.push({operation:'head',key});if(this.failReads)throw new Error('synthetic-private-storage-error');const entry=this.records.get(key);return entry?{...entry}:null;}
  async get(key,options) {
    this.operations.push({operation:'get',key,options});if(this.failReads)throw new Error('synthetic-private-storage-error');
    const entry=this.records.get(key);if(!entry)return null;if(this.changedGet)return {...entry,body:undefined};
    assert.deepEqual(options.onlyIf,{etagMatches:entry.etag});
    const {offset,length}=options.range;const bytes=entry.bytes.slice(offset,offset+length-(this.truncateRead?1:0));
    return {...entry,body:new ReadableStream(),arrayBuffer:async()=>bytes.buffer};
  }
  async list(options) {
    this.operations.push({operation:'list',options});if(this.failReads)throw new Error('synthetic-private-storage-error');
    if(this.badList)return {objects:[],truncated:true};
    const keys=[...this.records.keys()].filter(k=>k.startsWith(options.prefix)&&(!options.cursor||k>options.cursor)).sort();
    const count=Math.min(options.limit,this.maximumPage),part=keys.slice(0,count),truncated=keys.length>count;
    return {objects:part.map(k=>({...this.records.get(k)})),truncated,...(truncated?{cursor:part.at(-1)}:{})};
  }
}
after(async()=>{
  const directory=new URL('./evidence/',import.meta.url);await mkdir(directory,{recursive:true});
  const snapshot={fixture_version:'collector-F1',scope:'local_synthetic_only',generated_at:new Date().toISOString(),stores:await Promise.all(allStores.map(async(store,index)=>({store_index:index,records:await Promise.all([...store.records.entries()].map(async([key,record])=>({key,object_sha256:await sha256(record.bytes),object_base64:Buffer.from(record.bytes).toString('base64')})))})))};
  await writeFile(new URL(`synthetic-store-snapshot-${randomUUID()}.json`,directory),JSON.stringify(snapshot),{flag:'wx'});
});
function setup(overrides={}) {
  const bucket=overrides.bucket||new MemoryR2();let next=0;
  const config={store:new R2CreateOnlyStore(bucket),now:()=>new Date(FIXED),newId:()=>`synthetic-${String(++next).padStart(6,'0')}`,...overrides};delete config.bucket;
  return {bucket,collector:createCollector(config),config};
}
function ingestRequest(body='{}',headers={},method='POST') {return new Request('https://candidate.example/v1/events',{method,headers:{Origin:ORIGIN,'Content-Type':'application/json',...headers},...(method==='POST'?{body,duplex:'half'}:{})});}
function callRequest(name,args={},identity=OWNER,extraHeaders={}) {return new Request('https://candidate.example/mcp',{method:'POST',headers:{'Content-Type':'application/json',...(identity?{'oai-authenticated-user-id':identity}:{}),...extraHeaders},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})});}
async function call(collector,name,args={},identity=OWNER,extraHeaders={}){const response=await collector.fetch(callRequest(name,args,identity,extraHeaders));return {response,rpc:await response.json()};}
function authorized(overrides={}){return setup({ownerIdentity:OWNER,verifiedGatewayIdentity:true,cursorHmacKey:SECRET,...overrides});}
function receipts(bucket){return [...bucket.records.entries()].filter(([k])=>k.includes('/receipts/')||k.startsWith('receipts/')).map(([key,value])=>({key,...JSON.parse(dec.decode(value.bytes))}));}
async function collect(collector,body,headers={}){const response=await collector.fetch(ingestRequest(body,headers));return {response,ack:await response.json()};}
async function seed(collector,n=1){for(let i=0;i<n;i++)assert.equal((await collect(collector,JSON.stringify({schema_version:1,events:[{event_id:`synthetic-event-${i}`}]}))).response.status,202);}
async function allPages(collector,limit=3){let cursor=null;const items=[];do{const {rpc}=await call(collector,'list_records',{namespace:'receipts',limit,cursor});assert.equal(rpc.result.isError,false);const page=rpc.result.structuredContent;items.push(...page.items);cursor=page.next_cursor;assert.equal(page.enumeration_complete,cursor===null);assert.equal(page.transactional_snapshot,false);}while(cursor);return items;}

test('RAW-01 / ACK-01: exact raw body/hash only after completed storage write',async()=>{
  const {bucket,collector}=setup();const bytes=enc.encode(' {"schema_version":1,"events":[{"label":"synthetic café"}]}\n');
  const {response,ack}=await collect(collector,bytes);
  assert.equal(response.status,202);assert.equal(ack.status,'retained');assert.equal(ack.terminal,true);assert.equal(ack.analytical_status,'not_evaluated');
  assert.equal(bucket.records.size,1);const record=receipts(bucket)[0];
  assert.equal(record.receipt_id,ack.receipt_id);assert.deepEqual(Buffer.from(record.body_base64,'base64'),Buffer.from(bytes));
  assert.equal(record.receipt_body_sha256,await sha256(bytes));assert.equal(ack.receipt_body_sha256,record.receipt_body_sha256);
  assert.equal(record.body_bytes,bytes.length);assert.equal(record.received_at,FIXED);assert.equal(record.source_ip.status,'unavailable');
});

test('RAW-02 / RAW-05 / RAW-06 / ACK-05: malformed and unsupported bytes retained without parsing or echoes',async()=>{
  const {bucket,collector}=setup();const fixtures=[new Uint8Array(),enc.encode('{'),new Uint8Array([0xff,0xfe,0xc3,0x28]),enc.encode('{"events":[],"events":[1]}'),enc.encode('{"schema_version":999,"events":[]}'),enc.encode('{"synthetic_email":"private-sentinel@example.invalid"}'),enc.encode('{"schema_version":1,"events":[{"event_id":"A"},{"unknown":"B"},{"event_id":"C"}]}')];
  for(const bytes of fixtures){const {ack,response}=await collect(collector,bytes);assert.equal(response.status,202);assert.equal(ack.terminal,true);assert.equal(ack.analytical_status,'not_evaluated');assert(!JSON.stringify(ack).includes('private-sentinel'));}
  assert.equal(bucket.records.size,fixtures.length);
  receipts(bucket).forEach((record,i)=>assert.deepEqual(Buffer.from(record.body_base64,'base64'),Buffer.from(fixtures[i])));
});

for(const size of [MAX_BODY_BYTES-1,MAX_BODY_BYTES])test(`RAW-03: accepts and retains exactly ${size} body bytes`,async()=>{
  const {bucket,collector}=setup();const bytes=new Uint8Array(size).fill(0x61);const {response}=await collect(collector,bytes,{'Content-Length':'1'});
  assert.equal(response.status,202);assert.equal(receipts(bucket)[0].body_bytes,size);assert.equal(Buffer.from(receipts(bucket)[0].body_base64,'base64').length,size);
});
test('RAW-03: overflow is rejected without falsely retaining truncated bytes',async()=>{
  const {bucket,collector}=setup();const {response,ack}=await collect(collector,new Uint8Array(MAX_BODY_BYTES+1),{'Content-Length':'1'});
  assert.equal(response.status,413);assert.equal(ack.reason,'body_too_large');assert.equal(receipts(bucket).length,0);
  const rejection=JSON.parse(dec.decode([...bucket.records.values()][0].bytes));assert.equal(rejection.body_preserved,false);assert.equal(rejection.reason,'body_too_large');
});
test('RAW-03: chunked absent-length overflow checks received bytes',async()=>{
  const {bucket,collector}=setup();const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(20000));c.enqueue(new Uint8Array(20000));c.close();}});
  assert.equal((await collect(collector,stream)).response.status,413);assert.equal(receipts(bucket).length,0);
});
test('RAW-03: 49/50/51-event batches all preserved; analyst applies event-count boundary later',async()=>{
  const {bucket,collector}=setup();for(const n of [49,50,51])assert.equal((await collect(collector,JSON.stringify({schema_version:1,events:Array.from({length:n},(_,i)=>({event_id:`synthetic-${i}`}))}))).response.status,202);
  assert.deepEqual(receipts(bucket).map(r=>JSON.parse(Buffer.from(r.body_base64,'base64')).events.length),[49,50,51]);
});
test('RAW-03: unsupported compression retained as rejection metadata only',async()=>{
  const {bucket,collector}=setup();const {response}=await collect(collector,'synthetic-secret',{'Content-Encoding':'gzip'});
  assert.equal(response.status,415);assert.equal(receipts(bucket).length,0);assert(!dec.decode([...bucket.records.values()][0].bytes).includes('synthetic-secret'));
});
test('PRIV-02: body stream exception codes cannot echo arbitrary sensitive strings',async()=>{
  const {bucket,collector}=setup();const stream=new ReadableStream({start(c){const e=new Error('synthetic-secret-message');e.code='synthetic-secret-code';c.error(e);}});
  const {response,ack}=await collect(collector,stream);assert.equal(response.status,400);assert.equal(ack.reason,'body_read_failed');
  assert(!JSON.stringify(ack).includes('synthetic-secret'));assert(!dec.decode([...bucket.records.values()][0].bytes).includes('synthetic-secret'));
});
test('ACK-01 / STORE-03: storage failure returns retry and never leaks exception',async()=>{
  const {bucket,collector}=setup();bucket.failWrites=true;const {response,ack}=await collect(collector,'{}');
  assert.equal(response.status,503);assert.equal(ack.status,'retry');assert(!ack.receipt_id);assert(!JSON.stringify(ack).includes('secret'));assert.equal(bucket.records.size,0);
  bucket.failWrites=false;assert.equal((await collect(collector,'{}')).response.status,202);assert.equal(receipts(bucket).length,1);
});
test('ACK-01: ambiguous/unconfirmed adapter return cannot produce accepted acknowledgement',async()=>{
  const store={create:async()=>undefined,list:async()=>{},readChunk:async()=>null};const {collector}=setup({store});assert.equal((await collect(collector,'{}')).response.status,503);
});
test('ACK-01: asynchronous write must resolve before response',async()=>{
  let release;const gate=new Promise(resolve=>{release=resolve});const bucket=new MemoryR2();const original=bucket.put.bind(bucket);bucket.put=async(...args)=>{await gate;return original(...args);};
  const {collector}=setup({bucket});let responded=false;const pending=collect(collector,'{}').then(r=>{responded=true;return r;});
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(responded,false);assert.equal(bucket.records.size,0);release();assert.equal((await pending).response.status,202);assert.equal(bucket.records.size,1);
});
test('ACK-02: lost response/retry leaves both raw receipts and equal body hashes',async()=>{
  const {bucket,collector}=setup();await collector.fetch(ingestRequest('{"synthetic":"same"}'));const later=await collect(collector,'{"synthetic":"same"}');
  assert.equal(later.response.status,202);const records=receipts(bucket);assert.equal(records.length,2);assert.notEqual(records[0].receipt_id,records[1].receipt_id);assert.equal(records[0].receipt_body_sha256,records[1].receipt_body_sha256);
});
test('STORE-01: conditional collision preserves old object and allocates new key',async()=>{
  const {bucket,collector}=setup();await collect(collector,'old');const old=[...bucket.records.values()][0].bytes.slice();
  const ids=['synthetic-000001','synthetic-000002'];const second=createCollector({store:new R2CreateOnlyStore(bucket),now:()=>new Date(FIXED),newId:()=>ids.shift()});
  assert.equal((await collect(second,'new')).response.status,202);assert.equal(bucket.records.size,2);assert.deepEqual([...bucket.records.values()][0].bytes,old);assert.equal(bucket.operations.filter(o=>o.operation==='put').length,3);
});
test('STORE-01: repeated collisions return retry without replacing history',async()=>{
  const {bucket,collector}=setup({newId:()=> 'synthetic-collision'});await collect(collector,'old');const old=[...bucket.records.values()][0].bytes.slice();assert.equal((await collect(collector,'new')).response.status,503);assert.equal(bucket.records.size,1);assert.deepEqual([...bucket.records.values()][0].bytes,old);
});
test('STORE-03 / HIST-02: a new handler instance preserves prior data; no mutation API exists',async()=>{
  const {bucket,collector}=authorized();await seed(collector,2);const next=authorized({bucket}).collector;assert.equal((await allPages(next)).length,2);
  for(const method of ['DELETE','PUT','PATCH']){const response=await next.fetch(new Request('https://candidate.example/receipts/2026/10/23/synthetic-000001.json',{method}));assert.equal(response.status,404);}
  assert.equal(bucket.records.size,2);assert.equal(typeof new R2CreateOnlyStore(bucket).delete,'undefined');
});
test('AUTH-01/02: owner configuration and proven gateway identity are both mandatory',async()=>{
  for(const config of [{},{ownerIdentity:OWNER},{verifiedGatewayIdentity:true},{ownerIdentity:OWNER,verifiedGatewayIdentity:false},{ownerIdentity:OWNER,verifiedGatewayIdentity:'false'},{ownerIdentity:OWNER,verifiedGatewayIdentity:'true'},{ownerIdentity:OWNER,verifiedGatewayIdentity:1}]){
    const {collector}=setup(config);const {response}=await call(collector,'list_records',{namespace:'receipts'});assert.equal(response.status,403);
  }
});
test('AUTH-01/02/03: anonymous, other owner, forged email, duplicate header and bypass token denied locally',async()=>{
  const {collector,bucket}=authorized();await seed(collector);
  for(const [identity,extra] of [[null,{}],['other-owner',{}],[null,{'oai-authenticated-user-email':'owner@example.invalid'}],[`${OWNER}, ${OWNER}`,{}],[null,{'OAI-Sites-Authorization':'Bearer synthetic-bypass-token'}]]){
    const {response,rpc}=await call(collector,'list_records',{namespace:'receipts'},identity,extra);assert.equal(response.status,403);assert(!JSON.stringify(rpc).includes('body_base64'));
  }
  assert.equal(bucket.operations.filter(o=>o.operation==='list').length,0);
});
test('AUTH-01: correctly configured simulated owner may list/read only allowed record namespaces',async()=>{
  const {collector}=authorized();await seed(collector);const items=await allPages(collector);assert.equal(items.length,1);assert.equal((await call(collector,'read_record_chunk',{key:items[0].key})).rpc.result.isError,false);
  for(const namespace of ['','secrets','receipts/../secrets','receipts/2026'])assert.equal((await call(collector,'list_records',{namespace})).rpc.result.isError,true);
});
test('AUTH-03: guessed raw routes, owner arguments and wrong methods cannot read private data',async()=>{
  const {collector}=authorized();await seed(collector);
  assert.equal((await collector.fetch(new Request('https://candidate.example/mcp'))).status,405);
  assert.equal((await collector.fetch(new Request('https://candidate.example/receipts/2026/10/23/synthetic-000001.json'))).status,404);
  assert.equal((await call(collector,'list_records',{namespace:'receipts',owner:OWNER})).rpc.result.isError,true);
});
test('AUTH-04: modified, wrong-scope, expired and different-owner cursors are denied',async()=>{
  let at=new Date(FIXED);const {collector,bucket}=authorized({now:()=>at});await seed(collector,3);
  const first=(await call(collector,'list_records',{namespace:'receipts',limit:1})).rpc.result.structuredContent;assert(first.next_cursor);
  for(const cursor of ['invalid',first.next_cursor.slice(0,-3)+'abc',first.next_cursor+'.extra'])assert.equal((await call(collector,'list_records',{namespace:'receipts',cursor})).rpc.result.isError,true);
  assert.equal((await call(collector,'list_records',{namespace:'rejections',cursor:first.next_cursor})).rpc.result.isError,true);
  const other=authorized({bucket,ownerIdentity:'synthetic-other-owner'}).collector;
  assert.equal((await call(other,'list_records',{namespace:'receipts',cursor:first.next_cursor},'synthetic-other-owner')).rpc.result.isError,true);
  at=new Date(Date.parse(FIXED)+25*60*60*1000);assert.equal((await call(collector,'list_records',{namespace:'receipts',cursor:first.next_cursor})).rpc.result.isError,true);
});
test('AUTH-04: chunk traversal, malformed keys and invalid offsets fail closed',async()=>{
  const {collector}=authorized();await seed(collector);const key=(await allPages(collector))[0].key;
  for(const args of [{key:'../secret'},{key:'receipts/%2e%2e/secret'},{key,offset:-1},{key,offset:0.5},{key,max_bytes:MAX_EXPORT_CHUNK_BYTES+1},{key,offset:Number.MAX_SAFE_INTEGER}])assert.equal((await call(collector,'read_record_chunk',args)).rpc.result.isError,true);
});
test('AUTH-05: all successful and denied data responses are no-store and vary by identity',async()=>{
  const {collector}=authorized();await seed(collector);
  for(const identity of [OWNER,null]){const {response}=await call(collector,'list_records',{namespace:'receipts'},identity);assert.match(response.headers.get('cache-control'),/private, no-store/);assert.match(response.headers.get('vary'),/oai-authenticated-user-id/);}
});
test('AUTH-06: explicit origins and preflight; CORS is not used as read authentication',async()=>{
  const {collector,bucket}=setup();
  for(const origin of ['https://attacker.invalid','null','']){const request=ingestRequest('{}');if(origin)request.headers.set('origin',origin);else request.headers.delete('origin');assert.equal((await collector.fetch(request)).status,403);}
  let response=await collector.fetch(ingestRequest(null,{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'},'OPTIONS'));assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),ORIGIN);
  response=await collector.fetch(ingestRequest(null,{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization'},'OPTIONS'));assert.equal(response.status,403);
  assert.equal((await collect(collector,'{}',{'Content-Type':'text/plain;charset=UTF-8'})).response.status,202);
  assert.equal((await collect(collector,'{}',{'Content-Type':'application/octet-stream'})).response.status,415);assert.equal(receipts(bucket).length,1);
});
test('IP-02/PRIV-01: unproven headers never become an address; sensitive headers never stored',async()=>{
  const {collector,bucket}=setup();await collect(collector,'{}',{'CF-Connecting-IP':'192.0.2.1','X-Forwarded-For':'198.51.100.1','X-Real-IP':'203.0.113.1','Cookie':'synthetic-secret-cookie','Authorization':'Bearer synthetic-secret-auth','Referer':'https://example.invalid/private?email=sentinel@example.invalid'});
  const raw=dec.decode([...bucket.records.values()][0].bytes),record=receipts(bucket)[0];assert.deepEqual(record.source_ip,{status:'unavailable',provenance:'unverified',address:null});
  for(const sentinel of ['192.0.2.1','198.51.100.1','203.0.113.1','synthetic-secret','sentinel@example.invalid'])assert(!raw.includes(sentinel));
});
test('IP adapter failure degrades attribution only; never prevents durable receipt',async()=>{
  const {collector,bucket}=setup({verifiedSourceIp:()=>{throw new Error('unavailable')}});assert.equal((await collect(collector,'{}')).response.status,202);assert.equal(receipts(bucket)[0].source_ip.status,'unavailable');
});
test('EXPORT-01/03: provider short pages and 2P+7 keys across dates export exactly; resume works',async()=>{
  let day=21;const {collector,bucket}=authorized({now:()=>new Date(`2026-10-${day}T12:00:00Z`)});bucket.maximumPage=3;
  for(let i=0;i<13;i++){day=21+Math.floor(i/5);await seed(collector);}
  const items=await allPages(collector,10);assert.equal(items.length,13);assert.equal(new Set(items.map(i=>i.key)).size,13);
  assert.deepEqual(items.map(i=>i.key).sort(),[...bucket.records.keys()].sort());
  for(const item of items)assert.equal(item.sha256,await sha256(bucket.records.get(item.key).bytes));
  const first=(await call(collector,'list_records',{namespace:'receipts',limit:3})).rpc.result.structuredContent;
  const a=(await call(collector,'list_records',{namespace:'receipts',limit:3,cursor:first.next_cursor})).rpc.result.structuredContent;
  const b=(await call(collector,'list_records',{namespace:'receipts',limit:3,cursor:first.next_cursor})).rpc.result.structuredContent;assert.deepEqual(a,b);
});
test('EXPORT-01: response budget fails explicitly; smaller-page rescan loses no objects',async()=>{
  const {collector}=authorized({maxListItems:40,maxListBytes:4096});await seed(collector,47);
  const first=(await call(collector,'list_records',{namespace:'receipts',limit:40})).rpc.result;assert.equal(first.isError,true);assert.equal(first.content[0].text,'page_budget_exceeded_retry_smaller_limit');
  assert.equal((await allPages(collector,8)).length,47);
});
test('EXPORT-02: near-limit receipt reconstructs exact bytes through multiple chunks',async()=>{
  const {collector,bucket}=authorized();await collect(collector,new Uint8Array(MAX_BODY_BYTES).fill(0x78));const item=(await allPages(collector))[0];let offset=0;const chunks=[];
  for(;;){const {rpc}=await call(collector,'read_record_chunk',{key:item.key,offset,max_bytes:1024});assert.equal(rpc.result.isError,false);const c=rpc.result.structuredContent;assert.equal(c.offset,offset);assert.equal(c.object_sha256,item.sha256);const bytes=Buffer.from(c.body_base64,'base64');assert.equal(bytes.length,c.bytes);chunks.push(bytes);offset=c.next_offset;if(c.object_complete)break;}
  const bytes=Buffer.concat(chunks);assert.equal(bytes.length,item.size);assert.equal(await sha256(bytes),item.sha256);assert.deepEqual(bytes,Buffer.from(bucket.records.get(item.key).bytes));assert(chunks.length>40);
});
test('EXPORT-04: later records before prior cursor appear on complete reconciliation',async()=>{
  const {collector,bucket}=authorized();await seed(collector,3);
  const first=(await call(collector,'list_records',{namespace:'receipts',limit:1})).rpc.result.structuredContent;
  const lateWriter=setup({bucket,now:()=>new Date('2026-10-21T12:00:00Z'),newId:()=> 'synthetic-late0001'}).collector;await seed(lateWriter);
  const continuation=(await call(collector,'list_records',{namespace:'receipts',limit:3,cursor:first.next_cursor})).rpc.result.structuredContent;
  assert.equal(continuation.items.length,2);assert.equal(continuation.transactional_snapshot,false);assert.equal((await allPages(collector)).length,4);
});
test('EXPORT-05: storage faults, malformed pages and incomplete chunks never claim completion',async()=>{
  const {collector,bucket}=authorized();await seed(collector);const key=(await allPages(collector))[0].key;
  bucket.failReads=true;assert.equal((await call(collector,'list_records',{namespace:'receipts'})).rpc.result.isError,true);assert.equal((await call(collector,'read_record_chunk',{key})).rpc.result.isError,true);bucket.failReads=false;
  bucket.badList=true;assert.equal((await call(collector,'list_records',{namespace:'receipts'})).rpc.result.isError,true);bucket.badList=false;
  bucket.truncateRead=true;assert.equal((await call(collector,'read_record_chunk',{key})).rpc.result.isError,true);bucket.truncateRead=false;
  bucket.changedGet=true;assert.equal((await call(collector,'read_record_chunk',{key})).rpc.result.isError,true);
});
test('EXPORT-05: empty, oversized and repeated provider cursors never produce unresumable continuation',async()=>{
  const {collector,bucket}=authorized();await seed(collector,3);const first=(await call(collector,'list_records',{namespace:'receipts',limit:1})).rpc.result.structuredContent;
  const original=bucket.list.bind(bucket);
  for(const cursor of ['', 'x'.repeat(2049), '界'.repeat(2048)]){bucket.list=async()=>({objects:[],truncated:true,cursor});assert.equal((await call(collector,'list_records',{namespace:'receipts'})).rpc.result.isError,true);}
  bucket.list=async options=>({objects:[],truncated:true,cursor:options.cursor});assert.equal((await call(collector,'list_records',{namespace:'receipts',cursor:first.next_cursor})).rpc.result.isError,true);bucket.list=original;
});
test('EXPORT-01/02: complete MCP responses fit declared byte budgets including duplicate representations',async()=>{
  const {collector}=authorized({maxListBytes:4096});await seed(collector,8);
  const listResponse=await collector.fetch(callRequest('list_records',{namespace:'receipts',limit:8}));const text=await listResponse.text();assert(enc.encode(text).length<=4096);assert.equal(JSON.parse(text).result.isError,false);
  const near=await collect(collector,new Uint8Array(MAX_BODY_BYTES).fill(0x78));assert.equal(near.response.status,202);
  const items=await allPages(collector,8);const item=items.find(i=>i.key.includes(near.ack.receipt_id));
  const chunkResponse=await collector.fetch(callRequest('read_record_chunk',{key:item.key,max_bytes:MAX_EXPORT_CHUNK_BYTES}));const chunkText=await chunkResponse.text();assert(enc.encode(chunkText).length<=24000);assert.equal(JSON.parse(chunkText).result.isError,false);
});
test('EXPORT-01: escaped JSON-RPC IDs are counted exactly in the full response budget',async()=>{
  const {collector}=authorized({maxListBytes:4096});await seed(collector,20);
  for(let limit=8;limit<=15;limit++){
    const request=new Request('https://candidate.example/mcp',{method:'POST',headers:{'oai-authenticated-user-id':OWNER},body:JSON.stringify({jsonrpc:'2.0',id:'\u0000'.repeat(100),method:'tools/call',params:{name:'list_records',arguments:{namespace:'receipts',limit}}})});
    const response=await collector.fetch(request);const text=await response.text();assert(enc.encode(text).length<=4096);const rpc=JSON.parse(text);assert.equal(rpc.id,'\u0000'.repeat(100));
  }
});
test('MCP discovery exposes only capability schemas before bootstrap; health exposes no identities',async()=>{
  const {collector}=setup();for(const method of ['server/discover','tools/list']){const response=await collector.fetch(new Request('https://candidate.example/mcp',{method:'POST',body:JSON.stringify({jsonrpc:'2.0',id:1,method})}));assert.equal(response.status,200);const value=await response.json();assert(value.result);assert(!JSON.stringify(value).includes(OWNER));}
  const health=await collector.fetch(new Request('https://candidate.example/health'));assert.deepEqual(await health.json(),{status:'available'});
});
