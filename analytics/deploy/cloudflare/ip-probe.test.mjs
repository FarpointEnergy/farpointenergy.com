import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,createHash} from 'node:crypto';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const core=await readFile(new URL('../../collector/core.mjs',import.meta.url),'utf8');
const source=await readFile(new URL('./ip-probe.mjs',import.meta.url),'utf8');
const api=await import('data:text/javascript;base64,'+Buffer.from(core+'\n'+source).toString('base64'));
const host='synthetic-probe.example.invalid',path=api.SYNTHETIC_IP_PROBE_PATH;
const enabled={CLOUDFLARE_SYNTHETIC_IP_PROBE:'1',CLOUDFLARE_SYNTHETIC_IP_PROBE_HOSTNAME:host};
const stores=[];
class Store {
  records=new Map(); calls=[]; fail=false; wait=null;
  constructor(){stores.push(this);}
  async create(key,bytes){this.calls.push(key);if(this.wait)await this.wait;if(this.fail)throw new Error('sensitive-provider-detail');if(this.records.has(key))return{created:false};this.records.set(key,new Uint8Array(bytes));return{created:true};}
}
function req({method='POST',body='{"synthetic":true,"test_id":"network-01","expected_ip":"203.0.113.5"}',headers={},hostname=host,pathname=path,cf=true}={}){
  const r=new Request('https://'+hostname+pathname,{method,headers:{'Content-Type':'application/json',...headers},...(['GET','HEAD'].includes(method)?{}:{body})});
  if(cf)Object.defineProperty(r,'cf',{value:{colo:'SYN',asn:0}});return r;
}
function handler(store=new Store(),options={}){return{store,run:api.createSyntheticIpProbe({store,now:()=>new Date('2026-10-27T03:00:00Z'),...options})};}
function first(store){return JSON.parse(Buffer.from(store.records.values().next().value).toString());}

test('default-off and exact-host gates never touch storage',async()=>{
  const {store,run}=handler();
  for(const flag of [undefined,null,true,1,'true','0'])assert.equal((await run(req(),{...enabled,CLOUDFLARE_SYNTHETIC_IP_PROBE:flag})).status,404);
  assert.equal((await run(req({hostname:'other.example.invalid'}),enabled)).status,404);
  assert.equal(await run(req({pathname:'/v1/events'}),enabled),null);
  assert.equal(store.calls.length,0);
});
test('GET provides a static same-origin UI without observations or external scripts',async()=>{
  const {store,run}=handler();const r=await run(req({method:'GET',headers:{'CF-Connecting-IP':'198.51.100.77'}}),enabled);const html=await r.text();
  assert.equal(r.status,200);assert.match(html,/Save synthetic network test/);assert.match(html,/unverified test assertions/);assert(!html.includes('198.51.100.77'));assert(!/src=["']https?:/.test(html));assert.match(r.headers.get('content-security-policy'),/connect-src 'self'/);assert.equal(store.calls.length,0);
  assert.match(html,/<form id="probe" method="post">/);
  const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert.equal(typeof script,'string');
  assert.doesNotThrow(()=>new Function(script),'rendered inline JavaScript must parse; escaped newlines must remain escaped');
});
test('private record retains exact body and selected unverified headers; public ack does not echo them',async()=>{
  const {store,run}=handler();const body=' {"test_id":"network-01", "expected_ip":"203.0.113.5", "synthetic":true}\n';
  const r=await run(req({body,headers:{Origin:'https://'+host,'CF-Connecting-IP':'198.51.100.77','X-Forwarded-For':'192.0.2.8, 203.0.113.9','X-Real-IP':'192.0.2.10',Cookie:'private-cookie',Authorization:'Bearer private-secret','X-Unlisted':'private-unlisted'}}),enabled);
  assert.equal(r.status,202);const text=await r.text(),ack=JSON.parse(text),record=first(store);
  assert(!text.includes('198.51.100.77'));assert(!text.includes('203.0.113.5'));assert(!text.includes('192.0.2.8'));
  assert.deepEqual(Buffer.from(record.body_base64,'base64'),Buffer.from(body));assert.equal(record.observation.status,'unverified');assert.equal(record.ip_provenance_verified,false);assert.equal(record.expected.status,'untrusted_client_assertion');assert.equal(record.source_ip,undefined);
  assert.equal(record.observation.selected_normalized_request_headers['cf-connecting-ip'].value,'198.51.100.77');
  assert(!JSON.stringify(record).includes('private-cookie'));assert(!JSON.stringify(record).includes('private-secret'));assert(!JSON.stringify(record).includes('private-unlisted'));
  const bytes=store.records.get(ack.proof_key);assert.equal(createHash('sha256').update(bytes).digest('hex'),ack.proof_sha256);assert.equal(ack.ip_provenance_verified,false);assert.match(r.headers.get('cache-control'),/private, no-store/);
});
test('malformed admitted bodies remain exact diagnostic records',async()=>{
  for(const body of [new Uint8Array([255,254,195,40]),'{','null','[]']){
    const {store,run}=handler();const r=await run(req({body}),enabled);assert.equal(r.status,202);assert.deepEqual(Buffer.from(first(store).body_base64,'base64'),Buffer.from(body));assert.equal(first(store).expected.network_ip,null);
  }
});
test('4096-byte limit uses received bytes and rejects oversized, compressed and foreign-origin requests',async()=>{
  const {store,run}=handler();assert.equal((await run(req({body:'a'.repeat(4096)}),enabled)).status,202);
  const before=store.calls.length;
  assert.equal((await run(req({body:'a'.repeat(4097),headers:{'Content-Length':'1'}}),enabled)).status,413);
  assert.equal((await run(req({headers:{'Content-Encoding':'gzip'}}),enabled)).status,415);
  assert.equal((await run(req({headers:{Origin:'https://foreign.example.invalid'}}),enabled)).status,403);
  assert.equal((await run(req({headers:{'Content-Type':'text/plain'}}),enabled)).status,415);
  for(const method of ['PUT','DELETE','OPTIONS','HEAD'])assert.equal((await run(req({method}),enabled)).status,405);
  assert.equal(store.calls.length,before+8);
  const rejected=[...store.records.values()].map(bytes=>JSON.parse(Buffer.from(bytes).toString())).filter(r=>r.proof_kind==='transport_rejection');
  assert.equal(rejected.length,8);assert(rejected.every(r=>r.body_preserved===false&&r.body_base64===undefined&&r.observation===undefined&&r.ip_provenance_verified===false));
});
test('repeat requests create distinct records; a collision preserves original bytes and allocates a new key',async()=>{
  const store=new Store(),ids=['same-id-0001','same-id-0001','new-id-00002'];const {run}=handler(store,{newId:()=>ids.shift()});
  const a=await(await run(req({body:'{"expected_ip":"192.0.2.1"}'}),enabled)).json();const original=Buffer.from(store.records.get(a.proof_key));
  const b=await(await run(req({body:'{"expected_ip":"192.0.2.2"}'}),enabled)).json();assert.notEqual(a.proof_key,b.proof_key);assert.deepEqual(Buffer.from(store.records.get(a.proof_key)),original);assert.equal(store.records.size,2);assert.equal(store.calls.length,3);
});
test('acknowledgement waits for persistence and storage errors reveal no provider text',async()=>{
  const {store,run}=handler();let release;store.wait=new Promise(r=>release=r);let settled=false;const pending=run(req(),enabled).then(r=>{settled=true;return r;});await new Promise(r=>setTimeout(r,5));assert.equal(settled,false);release();assert.equal((await pending).status,202);
  store.wait=null;store.fail=true;const r=await run(req(),enabled);assert.equal(r.status,503);assert.deepEqual(await r.json(),{status:'retry',reason:'durability_unconfirmed'});
  const rejected=await run(req({headers:{'Content-Encoding':'gzip'}}),enabled);assert.equal(rejected.status,415);assert.deepEqual(await rejected.json(),{error:'unsupported_content_encoding',rejection_metadata_recorded:false});
});
test('header capture is bounded and missing CF context never implies trust',async()=>{
  const {store,run}=handler();await run(req({cf:false,headers:{'X-Forwarded-For':'a'.repeat(2000)}}),enabled);const record=first(store);assert.equal(record.observation.cf_request_metadata_present,false);assert.equal(record.observation.selected_normalized_request_headers['x-forwarded-for'].value.length,1024);assert.equal(record.observation.selected_normalized_request_headers['x-forwarded-for'].truncated,true);assert.equal(record.ip_provenance_verified,false);
});
test('native R2 adapter is always conditional-create and no delete/read capability is used',async()=>{
  const calls=[],objects=new Map();const bucket={async put(key,bytes,options){calls.push(options);if(objects.has(key))return null;objects.set(key,new Uint8Array(bytes));return{etag:'synthetic'};}};
  const run=api.createSyntheticIpProbe();const r=await run(req(),{...enabled,BUCKET:bucket});assert.equal(r.status,202);assert.equal(objects.size,1);assert.deepEqual(calls[0].onlyIf,{etagDoesNotMatch:'*'});assert.match(calls[0].customMetadata.sha256,/^[0-9a-f]{64}$/);
  // Preserve this native-adapter fixture in the same append-only evidence dump.
  stores.push({records:objects,calls:[]});
});
after(async()=>{
  const override=process.env.FARPOINT_TEST_EVIDENCE_DIR;if(override&&!isAbsolute(override))throw new Error('Absolute evidence directory required');
  const dir=override||fileURLToPath(new URL('./evidence/',import.meta.url));await mkdir(dir,{recursive:true});const target=resolve(dir,'synthetic-ip-probe-'+randomUUID()+'.json');
  await writeFile(target,JSON.stringify({scope:'local_synthetic_ip_probe_only',ip_provenance_verified:false,created_at:new Date().toISOString(),stores:stores.map(s=>[...s.records].map(([key,bytes])=>({key,body_base64:Buffer.from(bytes).toString('base64'),sha256:createHash('sha256').update(bytes).digest('hex')})))},null,2)+'\n',{flag:'wx'});console.log('Synthetic IP probe evidence retained: '+target);
});
