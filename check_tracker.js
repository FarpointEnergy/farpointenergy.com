"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const zlib = require("node:zlib");
const createTracker = require("./tracker.js");
const endpoint = "https://collector.example.test/v1/events";
const config = {enabled:true, endpoint, privacy_disclosure_version:"1", campaign_registry:{source:["test-email"],medium:["email"],campaign:["test-A","test-B"]},referrer_domains:{"www.google.com":"search"}};
function store() {
  const data = new Map();
  return {get length(){return data.size},key:i=>Array.from(data.keys())[i]??null,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k),data};
}
function env(options={}) {
  const requests=[],timers=new Map(),listeners={},storage=options.storage||store();let next=1;
  const e={crypto:crypto.webcrypto,localStorage:storage,location:{href:options.url||"https://farpointenergy.com/quote.html"},document:{referrer:options.referrer||"",addEventListener(){},getElementById(){return null}},Date:{now:()=>options.time??1792789200000},AbortController,
    setTimeout:(fn,ms)=>{const id=next++;timers.set(id,{fn,ms});return id},clearTimeout:id=>timers.delete(id),addEventListener:(name,fn)=>listeners[name]=fn,navigator:{sendBeacon:()=>true},
    fetch:async(url,init)=>{requests.push({url,init});return {ok:true,url,redirected:false,type:"cors",json:async()=>({status:"retained",terminal:true,receipt_id:"receipt-synthetic",receipt_body_sha256:crypto.createHash("sha256").update(init.body).digest("hex"),analytical_status:"not_evaluated"})}}};
  Object.assign(e,options.override||{});return {e,requests,timers,listeners,storage};
}
let assertions=0;
function check(fn){fn();assertions++;}
(async()=>{
  // Disabled/invalid configurations do not read storage, enqueue or call a network.
  for (const c of [{enabled:false}, {...config,endpoint:"http://collector.example.test/v1/events"}, {...config,endpoint:endpoint+"?secret=x"}, {...config,privacy_disclosure_version:""}]) {
    const t=env();Object.defineProperty(t.e,"localStorage",{get(){throw Error("must not touch storage")}});const a=createTracker(t.e,c);a.start();a.record("page_view");await a.flush();check(()=>assert.equal(t.requests.length,0));check(()=>assert.equal(a.enabled,false));
  }
  let t=env(),a=createTracker(t.e,config);a.start();check(()=>assert.equal(a.pendingCount(),2));let snap=a.snapshot();check(()=>assert(Object.isFrozen(snap)&&Object.isFrozen(snap.items)));check(()=>assert.deepEqual(JSON.parse(snap.body).events.map(e=>e.event_name),["page_view","quotation_view"]));
  await a.flush();check(()=>assert.equal(a.pendingCount(),0));check(()=>assert.equal(t.requests[0].init.referrerPolicy,"no-referrer"));check(()=>assert.equal(t.requests[0].init.credentials,"omit"));check(()=>assert.equal(t.requests[0].init.redirect,"error"));
  // Native beacon must be CORS-safelisted: application/json would require a
  // credentialed preflight, while the collector accepts no credentialed CORS.
  const beacons=[];
  t=env({override:{navigator:{sendBeacon:(url,body)=>{beacons.push({url,body});return true;}}}});a=createTracker(t.e,config);a.record("page_view");
  const beaconSnapshot=a.snapshot();check(()=>assert.equal(a.beacon(),true));
  check(()=>assert.equal(beacons[0].url,endpoint));check(()=>assert.equal(beacons[0].body.type,"text/plain;charset=utf-8"));
  const beaconBytes=Buffer.from(await beacons[0].body.arrayBuffer());
  check(()=>assert.deepEqual(beaconBytes,Buffer.from(beaconSnapshot.body,"utf8")));
  check(()=>assert.equal(a.pendingCount(),1));await a.flush();
  check(()=>assert.equal(t.requests[0].init.body,beaconSnapshot.body));check(()=>assert.equal(a.pendingCount(),0));
  // ACK-03: out-of-order delivery and new events are scoped to immutable snapshots.
  t=env();a=createTracker(t.e,config);a.record("page_view");a.record("quotation_start");const x=a.snapshot();a.record("quotation_attempt");const y=a.snapshot();await a.send(x);check(()=>assert.equal(a.pendingCount(),1));await a.send(x);check(()=>assert.equal(a.pendingCount(),1));await a.send(y);check(()=>assert.equal(a.pendingCount(),0));
  t=env();a=createTracker(t.e,config);a.record("page_view");const first=a.snapshot();a.record("quotation_start");await a.send(a.snapshot());await a.send(first);check(()=>assert.equal(a.pendingCount(),0));
  // ACK-01/02/04: only a valid acknowledgement from the exact configured endpoint clears.
  for (const behavior of ["throw","status","wrong_hash","missing_receipt","empty_receipt","missing_terminal","not_retained","malformed","wrong_endpoint","redirect","opaque"]) {
    t=env();a=createTracker(t.e,config);a.record("page_view");const original=t.e.fetch;
    t.e.fetch=async(url,init)=>{if(behavior==="throw")throw Error("offline");const r=await original(url,init);const ack=await r.json();if(behavior==="status")r.ok=false;if(behavior==="wrong_hash")ack.receipt_body_sha256="0".repeat(64);if(behavior==="missing_receipt")delete ack.receipt_id;if(behavior==="empty_receipt")ack.receipt_id="";if(behavior==="missing_terminal")delete ack.terminal;if(behavior==="not_retained")ack.status="queued";if(behavior==="wrong_endpoint")r.url="https://untrusted.example/v1/events";if(behavior==="redirect")r.redirected=true;if(behavior==="opaque")r.type="opaque";r.json=async()=>{if(behavior==="malformed")throw SyntaxError("bad");return ack};return r;};
    check(()=>assert.equal(a.pendingCount(),1));check(()=>assert.equal(a.beacon(),true));check(()=>assert.equal(a.pendingCount(),1));check(()=>assert.equal(a.snapshot().body,a.snapshot().body));assert.equal(await a.flush(),false,behavior);check(()=>assert.equal(a.pendingCount(),1));
    t.e.fetch=original;await a.flush();check(()=>assert.equal(a.pendingCount(),0));
  }
  // Terminal retained-invalid is an ACK of raw storage, not a claim of valid analytics.
  t=env();a=createTracker(t.e,config);a.record("page_view");const original=t.e.fetch;t.e.fetch=async(u,o)=>{const r=await original(u,o),ack=await r.json();ack.analytical_status="invalid";r.json=async()=>ack;return r};await a.flush();check(()=>assert.equal(a.pendingCount(),0));
  // BROWSER-01/02: reload and concurrent tabs share immutable event keys, not a queue blob.
  const shared=store();const tab1=env({storage:shared}),tab2=env({storage:shared});const a1=createTracker(tab1.e,config),a2=createTracker(tab2.e,config);a1.record("page_view");const before=a1.snapshot();a2.record("quotation_view");check(()=>assert.equal(a2.pendingCount(),2));await a1.send(before);check(()=>assert.equal(a2.pendingCount(),1));await a2.flush();const reloaded=createTracker(env({storage:shared}).e,config);check(()=>assert.equal(reloaded.pendingCount(),0));
  a1.record("quotation_start");const persisted=a1.snapshot().body;const reload=createTracker(env({storage:shared}).e,config);check(()=>assert.equal(reload.snapshot().body,persisted));
  // BROWSER-03: denied/full storage retains a transient backlog without eviction.
  for(const denied of [true,false]) {
    const s=store();if(!denied)s.setItem("farpoint-event-v1:00000000-0000-4000-8000-000000000000",JSON.stringify({event_id:"00000000-0000-4000-8000-000000000000"}));s.setItem=()=>{throw Error("quota")};if(denied)s.getItem=()=>{throw Error("denied")};t=env({storage:s});a=createTracker(t.e,config);a.record("page_view");check(()=>assert(a.pendingCount()>=1));const events=JSON.parse(a.snapshot().body).events;check(()=>assert(events.some(e=>e.storage_status==="memory_only")));if(!denied)check(()=>assert(s.data.has("farpoint-event-v1:00000000-0000-4000-8000-000000000000")));
  }
  // PRIV: values are constrained, not just URL parameter names. No free text is retained.
  const sentinel="private-person@example.test";
  t=env({url:`https://farpointenergy.com/${sentinel}?utm_source=${sentinel}&campaign=${sentinel}&utm_medium=email&name=${sentinel}#${sentinel}`,referrer:`https://${sentinel.replace("@","-")}/private?email=${sentinel}`});a=createTracker(t.e,config);a.record("script_error",{error_category:sentinel,location_code:sentinel,product_id:sentinel,reference_id:sentinel,form_values:sentinel,message:sentinel});const raw=a.snapshot().body;check(()=>assert(!raw.includes(sentinel)));const event=JSON.parse(raw).events[0];check(()=>assert.equal(event.page_id,"unknown_page"));check(()=>assert.equal(event.campaign.source,"unknown_campaign"));check(()=>assert.equal(event.campaign.campaign,"unknown_campaign"));check(()=>assert.equal(event.campaign.medium,"email"));check(()=>assert.equal(event.referrer_category,"unknown"));check(()=>assert(!Object.hasOwn(event,"error_category")));
  t=env({url:"https://farpointenergy.com/products.html?utm_source=test-email&utm_campaign=test-A&utm_medium=email",referrer:"https://www.google.com/search?q=private"});a=createTracker(t.e,config);a.record("reference_select",{reference_id:"FP-MPT-138-50"});check(()=>assert.equal(JSON.parse(a.snapshot().body).events[0].campaign.campaign,"test-A"));check(()=>assert.equal(JSON.parse(a.snapshot().body).events[0].referrer_category,"search"));
  t=env({url:"https://farpointenergy.com/?source=test-email&source=test-email"});a=createTracker(t.e,config);a.record("page_view");check(()=>assert.equal(JSON.parse(a.snapshot().body).events[0].campaign.source,"unknown_campaign"));
  t=env({url:"https://farpointenergy.com/?utm_source=test-email&utm_campaign=test-A"});a=createTracker(t.e,config);a.record("page_view");
  t.e.location.href="https://farpointenergy.com/quote.html?utm_campaign=test-B";a.record("quotation_view");
  check(()=>assert.equal(a.inquiryContext().campaign.campaign,"test-A","Hidden inquiry attribution is session-entry evidence"));
  check(()=>assert.deepEqual(JSON.parse(a.snapshot().body).events.map(e=>e.campaign.campaign),["test-A","test-B"],"Both campaign touches survive as immutable events"));
  // Browser batches stay below both server limits; no queue cap drops a backlog.
  t=env();a=createTracker(t.e,config);for(let i=0;i<110;i++)a.record("page_view");check(()=>assert.equal(a.pendingCount(),110));check(()=>assert(JSON.parse(a.snapshot().body).events.length<=40));check(()=>assert(Buffer.byteLength(a.snapshot().body)<32768));while(a.pendingCount())await a.flush();check(()=>assert.equal(t.requests.length,3));
  // HASH-01/02: independently specified canonical vectors, no Unicode normalization.
  const vectors=[[{z:1,a:[true,null,"é","e\u0301"]},'{"a":[true,null,"é","é"],"z":1}'],[{n:-0},'{"n":0}'],[{x:'"\\\n\u0001'},'{"x":"\\\"\\\\\\n\\u0001"}'],[{},'{}'],[{x:null},'{"x":null}']];
  for(const [input,expected] of vectors)check(()=>assert.equal(a.canonicalize(input),expected));
  for(const value of [NaN,Infinity,1.5,Number.MAX_SAFE_INTEGER+1,"\ud800","\udfff",undefined])check(()=>assert.throws(()=>a.canonicalize(value)));
  check(()=>assert.notEqual(a.canonicalize("é"),a.canonicalize("e\u0301")));
  const sharedVectors=JSON.parse(fs.readFileSync(require("node:path").join(__dirname,"analytics/tests/python/fixtures/canonical-vectors-v1.json"),"utf8"));
  for(const vector of sharedVectors.valid) {
    const actual=a.canonicalize(JSON.parse(vector.input_json));
    check(()=>assert.equal(actual,vector.expected_canonical_utf8,vector.name));
    check(()=>assert.equal(crypto.createHash("sha256").update(actual,"utf8").digest("hex"),vector.expected_sha256,vector.name));
  }
  for(const value of sharedVectors.invalid_canonical_json)check(()=>assert.throws(()=>a.canonicalize(JSON.parse(value))));
  // The browser creates events from objects; untrusted raw JSON duplicate-key detection
  // is performed by the Python strict decoder before any trusted analytical count.
  const bytes=zlib.gzipSync(fs.readFileSync(require.resolve("./tracker.js"))).length;check(()=>assert(bytes<=15*1024));
  console.log(`PASS: ${assertions} tracker assertions; raw ACK binding, retries, overlapping snapshots, lifecycle persistence, cross-tab isolation, quota fallback without eviction, privacy sentinels, bounded batches, canonical vectors; tracker ${bytes} bytes gzip. Mocked browser/network only; hosted and engine QA still required.`);
})().catch(error=>{console.error(error);process.exitCode=1});
