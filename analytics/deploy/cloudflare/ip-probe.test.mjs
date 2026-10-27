import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID,createHash,webcrypto} from 'node:crypto';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createContext,runInContext} from 'node:vm';

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
async function renderedUi(fetchImpl,timerOptions={}){
  const {run}=handler();const html=await(await run(req({method:'GET'}),{...enabled,...(timerOptions.intakeEnabled?{CLOUDFLARE_SYNTHETIC_INTAKE_PROOF:'1'}:{})})).text();
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const elements={};
  for(const id of ['probe','result','automatic-probe','manual-button','network-label','test-id','expected-ip','evidence-controls','retry-save','download-evidence','intake-probe'])elements[id]={value:'',textContent:'',disabled:false,hidden:true,listeners:{},addEventListener(event,callback){this.listeners[event]=callback;}};
  elements['intake-probe'].dataset={enabled:/id="intake-probe"[^>]*data-enabled="true"/.test(html)?'true':'false'};
  elements.probe.querySelector=()=>elements['manual-button'];
  elements['network-label'].value='wifi';elements['test-id'].value='manual-synthetic';elements['expected-ip'].value='192.0.2.7';
  const downloads=[];class TestURL extends URL{static createObjectURL(blob){downloads.push({blob});return 'blob:synthetic-download';}static revokeObjectURL(){}}
  const context=createContext({document:{getElementById:id=>elements[id],createElement:()=>({click(){downloads.at(-1).clicked=true;}})},location:{pathname:path},fetch:fetchImpl,URL:TestURL,Blob,Uint8Array,TextDecoder,TextEncoder,AbortController,crypto:{randomUUID,subtle:webcrypto.subtle},Date,JSON,Math,setTimeout:timerOptions.setTimeout||((fn,ms)=>setTimeout(fn,ms===1000?1:ms)),clearTimeout});
  runInContext(script,context);
  return {elements,context,downloads};
}
const diagnosticUrls=['https://api.ipify.org?format=json','https://api6.ipify.org?format=json','https://api64.ipify.org?format=json'];
const fakeAck=()=>new Response(JSON.stringify({status:'retained',terminal:true,ip_provenance_verified:false,proof_key:'ip-proof/2026/10/27/synthetic-id.json',proof_sha256:'a'.repeat(64)}),{status:202,headers:{'Content-Type':'application/json'}});

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
  assert.match(html,/No network checks run before you click/);
  assert.match(r.headers.get('content-security-policy'),/connect-src 'self' https:\/\/api\.ipify\.org https:\/\/api6\.ipify\.org https:\/\/api64\.ipify\.org;/);
  const script=html.match(/<script>([\s\S]*?)<\/script>/)?.[1];assert.equal(typeof script,'string');
  assert.doesNotThrow(()=>new Function(script),'rendered inline JavaScript must parse; escaped newlines must remain escaped');
});
test('rendered automatic UI makes no requests before click, uses only fixed diagnostic hosts, and retains exact untrusted assertions',async()=>{
  const calls=[],addresses=['192.0.2.10','2001:db8::10','2001:db8::11'];const {store,run}=handler();
  const ui=await renderedUi(async(url,options)=>{
    calls.push({url,options});
    if(url===path)return run(req({body:options.body,headers:options.headers}),enabled);
    const index=diagnosticUrls.indexOf(url);assert(index>=0,'arbitrary diagnostic URL');
    assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.referrerPolicy,'no-referrer');assert.equal(options.cache,'no-store');assert.equal(options.method,'GET');assert.equal(options.body,undefined);
    return new Response(JSON.stringify({ip:addresses[index],ignored_sensitive_field:'must-not-be-saved'}),{status:200});
  });
  assert.equal(calls.length,0);await ui.elements['automatic-probe'].listeners.click();
  assert.equal(calls.length,4);assert.deepEqual(calls.slice(0,3).map(x=>x.url),diagnosticUrls);assert.equal(calls[3].url,path);assert.equal(calls[3].options.credentials,'omit');
  const sent=JSON.parse(calls[3].options.body),record=first(store),text=ui.elements.result.textContent;
  assert.equal(sent.network_label,'wifi');assert.equal(sent.expected_ip,null);assert.equal(sent.diagnostic_assertions_status,'untrusted_client_assertions');assert.equal(sent.diagnostic_observations.length,3);assert(sent.diagnostic_observations.every(x=>x.status==='observed'));
  assert.deepEqual(sent.diagnostic_observations.map(x=>x.ip),addresses);assert.equal(Buffer.from(record.body_base64,'base64').toString(),calls[3].options.body);assert.equal(record.ip_provenance_verified,false);assert.equal(record.expected.network_ip,null);assert.equal(record.expected.status,'untrusted_client_assertion');
  assert.match(text,/Synthetic evidence retained/);assert.match(text,/IP provenance is not yet verified/);assert(addresses.every(x=>!text.includes(x)));assert(!calls[3].options.body.includes('must-not-be-saved'));assert.equal(ui.elements['automatic-probe'].disabled,false);assert.equal(ui.elements['manual-button'].disabled,false);
});
test('rendered automatic UI preserves diagnostic failure codes and still saves partial evidence without leaking exception details',async()=>{
  const calls=[];
  const ui=await renderedUi(async(url,options)=>{
    calls.push({url,options});if(url===path)return fakeAck();
    if(url===diagnosticUrls[0])throw new Error('private-network-exception');
    if(url===diagnosticUrls[1])return new Response('private-provider-error',{status:503});
    return new Response(JSON.stringify({ip:'192.0.2.12'}),{status:200});
  });
  await ui.elements['automatic-probe'].listeners.click();
  const payload=JSON.parse(calls.at(-1).options.body),observations=payload.diagnostic_observations;
  assert.deepEqual(observations.map(x=>x.error_code),['network_error','http_error',null]);assert.equal(observations[1].http_status,503);assert.equal(observations[0].ip,null);
  assert.match(ui.elements.result.textContent,/IPv4: network_error/);assert.match(ui.elements.result.textContent,/IPv6: http_error \(HTTP 503\)/);assert.match(ui.elements.result.textContent,/Synthetic evidence retained/);assert(!JSON.stringify(payload).includes('private-'));assert(!ui.elements.result.textContent.includes('private-'));
});
test('rendered diagnostics bound replies, validate IP families and preserve timeout evidence',async()=>{
  const cases=[
    {response:()=>new Response('a'.repeat(257)),code:'body_too_large'},
    {response:()=>new Response('{'),code:'invalid_response'},
    {response:()=>new Response(JSON.stringify({ip:'not-an-address'})),code:'invalid_ip'},
    {response:()=>new Response(JSON.stringify({ip:'2001:db8::20'})),code:'unexpected_ip_family'},
  ];
  for(const example of cases){
    let payload;const ui=await renderedUi(async(url,options)=>{if(url===path){payload=JSON.parse(options.body);return fakeAck();}if(url===diagnosticUrls[0])return example.response();return new Response(JSON.stringify({ip:'2001:db8::20'}));});
    await ui.elements['automatic-probe'].listeners.click();assert.equal(payload.diagnostic_observations[0].error_code,example.code);assert.equal(payload.diagnostic_observations[0].ip,null);
  }
  let timeoutPayload;
  const timed=await renderedUi(async(url,options)=>{if(url===path){timeoutPayload=JSON.parse(options.body);return fakeAck();}return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted'))));},{setTimeout:(fn,ms)=>setTimeout(fn,ms===8000?1:ms)});
  await timed.elements['automatic-probe'].listeners.click();assert(timeoutPayload.diagnostic_observations.every(x=>x.error_code==='timeout'));assert.match(timed.elements.result.textContent,/timeout/);assert.match(timed.elements.result.textContent,/Synthetic evidence retained/);
});
test('rendered manual path only posts same-origin and unconfirmed storage never claims success',async()=>{
  const calls=[];const ui=await renderedUi(async(url,options)=>{calls.push({url,options});throw new Error('private-save-error');});
  let prevented=false;await ui.elements.probe.listeners.submit({preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(calls.length,1);assert.equal(calls[0].url,path);assert.deepEqual(JSON.parse(calls[0].options.body),{synthetic:true,test_id:'manual-synthetic',expected_ip:'192.0.2.7'});
  assert.match(ui.elements.result.textContent,/No successful test is claimed/);assert(!ui.elements.result.textContent.includes('private-save-error'));assert(!ui.elements.result.textContent.includes('Synthetic evidence retained'));assert.equal(ui.elements['automatic-probe'].disabled,false);
});
test('rendered UI prevents overlapping runs, sanitizes connection labels and rejects malformed acknowledgements',async()=>{
  let release;const pending=new Promise(resolve=>release=resolve),calls=[];
  const ui=await renderedUi(async(url,options)=>{calls.push({url,options});if(url===path)return new Response(JSON.stringify({status:'retained'}),{status:202});await pending;return new Response(JSON.stringify({ip:url===diagnosticUrls[0]?'192.0.2.50':'2001:db8::50'}));});
  ui.elements['network-label'].value='https://arbitrary.example.invalid';
  const running=ui.elements['automatic-probe'].listeners.click();assert.equal(ui.elements['network-label'].disabled,true);
  await ui.elements['automatic-probe'].listeners.click();await ui.elements.probe.listeners.submit({preventDefault(){}});assert.equal(calls.length,3);
  release();await running;assert.equal(calls.length,4);assert.equal(JSON.parse(calls[3].options.body).network_label,'unspecified');assert(!JSON.stringify(calls).includes('arbitrary.example.invalid'));
  assert.match(ui.elements.result.textContent,/not confirmed as retained/);assert(!ui.elements.result.textContent.includes('Synthetic evidence retained'));assert.equal(ui.elements['network-label'].disabled,false);
});
test('unconfirmed save retains immutable exact bytes for retry and private download without rerunning diagnostics',async()=>{
  const calls=[];let saves=0;
  const ui=await renderedUi(async(url,options)=>{calls.push({url,options});if(url===path){saves++;if(saves===1)throw new Error('temporary save failure');return fakeAck();}return new Response(JSON.stringify({ip:url===diagnosticUrls[0]?'192.0.2.80':'2001:db8::80'}));});
  await ui.elements['automatic-probe'].listeners.click();const original=calls.at(-1).options.body;
  assert.equal(ui.elements['retry-save'].hidden,false);assert.equal(ui.elements['evidence-controls'].hidden,false);assert.equal(ui.downloads.length,0);
  assert.equal(runInContext('Object.isFrozen(attempts[0])',ui.context),true);
  ui.elements['download-evidence'].listeners.click();assert.equal(ui.downloads.length,1);assert.equal(ui.downloads[0].clicked,true);
  const before=JSON.parse(await ui.downloads[0].blob.text());assert.equal(before.attempts[0].body,original);assert.equal(before.save_outcomes[0].status,'save_network_or_response_error');assert.equal(before.ip_provenance_verified,false);
  await ui.elements['retry-save'].listeners.click();assert.equal(calls.length,5);assert.equal(calls.at(-1).url,path);assert.equal(calls.at(-1).options.body,original);assert.equal(ui.elements['retry-save'].hidden,true);assert.match(ui.elements.result.textContent,/Synthetic evidence retained/);
  ui.elements['download-evidence'].listeners.click();const after=JSON.parse(await ui.downloads[1].blob.text());assert.equal(after.attempts.length,1);assert.equal(after.attempts[0].body,original);assert.deepEqual(after.save_outcomes.map(x=>x.status),['save_network_or_response_error','retained']);
  await ui.elements['automatic-probe'].listeners.click();ui.elements['download-evidence'].listeners.click();const third=JSON.parse(await ui.downloads[2].blob.text());assert.equal(third.attempts.length,2);assert.equal(third.attempts[0].body,original);assert.notEqual(third.attempts[1].body,original);
});
test('actual intake UI is default-off and requires a retained fresh diagnostic proof before posting a valid synthetic event',async()=>{
  let count=0;const off=await renderedUi(async()=>{count++;throw new Error('must not request');});await off.elements['intake-probe'].listeners.click();assert.equal(count,0);
  const calls=[];const ui=await renderedUi(async(url,options)=>{
    calls.push({url,options});if(url===path)return fakeAck();
    if(url==='/v1/events')return new Response(JSON.stringify({status:'retained',terminal:true,analytical_status:'not_evaluated',receipt_id:'synthetic-intake-123',receipt_body_sha256:createHash('sha256').update(options.body).digest('hex')}),{status:202});
    assert(diagnosticUrls.includes(url));return new Response(JSON.stringify({ip:url===diagnosticUrls[0]?'192.0.2.90':'2001:db8::90'}));
  },{intakeEnabled:true});
  assert.equal(calls.length,0);await ui.elements['intake-probe'].listeners.click();assert.equal(calls.length,5);assert.equal(calls[3].url,path);assert.equal(calls[4].url,'/v1/events');
  const proof=JSON.parse(calls[3].options.body),batch=JSON.parse(calls[4].options.body),event=batch.events[0];
  assert.deepEqual(Object.keys(batch).sort(),['events','schema_version','tracker_version']);assert.equal(batch.schema_version,1);assert.equal(batch.events.length,1);assert.equal(event.event_id,'syn_'+proof.test_id);assert.equal(event.synthetic,true);assert.equal(event.event_name,'page_view');assert.equal(event.page_id,'home');assert.equal(event.sequence,0);assert.equal(event.storage_status,'memory_only');assert.equal(event.browser_id,undefined);assert.equal(event.session_id,undefined);
  assert.match(ui.elements.result.textContent,/Synthetic intake evidence retained/);assert.match(ui.elements.result.textContent,/Source-IP comparison is still pending/);assert(!ui.elements.result.textContent.includes('192.0.2.90'));
  ui.elements['download-evidence'].listeners.click();const download=JSON.parse(await ui.downloads[0].blob.text());assert.equal(download.attempts[1].target,'/v1/events');assert.equal(download.attempts[1].body,calls[4].options.body);assert.equal(download.save_outcomes[1].receipt_id,'synthetic-intake-123');
});
test('failed diagnostic persistence prevents intake; invalid intake body hash remains unconfirmed and retries exact intake bytes',async()=>{
  const failed=[];const blocked=await renderedUi(async(url,options)=>{failed.push(url);if(url===path)throw new Error('save unavailable');return new Response(JSON.stringify({ip:url===diagnosticUrls[0]?'192.0.2.91':'2001:db8::91'}));},{intakeEnabled:true});
  await blocked.elements['intake-probe'].listeners.click();assert(!failed.includes('/v1/events'));assert.equal(blocked.elements['retry-save'].hidden,false);
  const calls=[];let intakeSaves=0;const ui=await renderedUi(async(url,options)=>{calls.push({url,options});if(url===path)return fakeAck();if(url==='/v1/events'){intakeSaves++;return new Response(JSON.stringify({status:'retained',terminal:true,analytical_status:'not_evaluated',receipt_id:'synthetic-intake-456',receipt_body_sha256:intakeSaves===1?'a'.repeat(64):createHash('sha256').update(options.body).digest('hex')}),{status:202});}return new Response(JSON.stringify({ip:url===diagnosticUrls[0]?'192.0.2.92':'2001:db8::92'}));},{intakeEnabled:true});
  await ui.elements['intake-probe'].listeners.click();const body=calls.at(-1).options.body;assert.match(ui.elements.result.textContent,/not confirmed as retained/);assert.equal(ui.elements['retry-save'].hidden,false);
  await ui.elements['retry-save'].listeners.click();assert.equal(calls.length,6);assert.equal(calls.at(-1).url,'/v1/events');assert.equal(calls.at(-1).options.body,body);assert.match(ui.elements.result.textContent,/Synthetic intake evidence retained/);
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
