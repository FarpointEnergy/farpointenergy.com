/* Remaining browser acceptance gates. Controlled profiles and synthetic RFQs only. */
import assert from 'node:assert/strict';
import {appendFile,mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {gzipSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import {createFixture,repositoryRoot,hash,until,outbox,fillMinimal,rejectAndCheckForm,seedBacklog,fillStorageQuota,minimizeOwnedTestWindow,formSentinel} from './fixture.mjs';
import {analyzeTrace,TRACE_CATEGORIES} from './performance-trace.mjs';

const require=createRequire(import.meta.url);
let playwright;try{playwright=require('playwright');}catch{playwright=require(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/unavailable','playwright'));}
const root=process.argv[2];if(!root?.startsWith('/'))throw Error('Absolute private evidence root required');
const evidence=resolve(root,'browser-acceptance-'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());await mkdir(evidence,{recursive:true});
const engines=(process.env.FARPOINT_ACCEPTANCE_ENGINES||'chromium,webkit,firefox').split(',');
assert(engines.every(name=>['chromium','webkit','firefox'].includes(name)));
const headed=process.env.FARPOINT_ACCEPTANCE_HEADED==='1';
const report={scope:'local browser acceptance; all RFQ traffic intercepted; no deployed collector',headed_under_virtual_display:headed,real_inbox_delivery_verified:false,production_readiness_certified:false,cases:[],performance_profile:{engine:'chromium',viewport:{width:390,height:844},device_scale_factor:3,is_mobile:true,has_touch:true,cpu_slowdown:4,network_latency_ms:150,download_bits_per_second:1600000,upload_bits_per_second:750000,description:'iPhone13 viewport/touch emulation on Linux Chromium with 4x CPU slowdown and controlled 3G-like network; not physical iOS or a calibrated handset'},source_sha256:{}};
for(const name of ['tracker.js','inquiry.js','site.js','style.css','quote.html'])report.source_sha256[name]=hash(await readFile(resolve(repositoryRoot,name)));
const caseDefinitions=[];
function define(name,gate,run,options={}){caseDefinitions.push({name,gate,run,...options});}
async function bounded(promise,timeout,label){
  let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error(label+' timed out')),timeout);})]);}finally{clearTimeout(timer);}
}
const allEvents=fixture=>fixture.events();
const requestHas=(record,id)=>JSON.parse(Buffer.from(record.body_base64,'base64')).events?.some(event=>event.event_id===id);
const waitEnabled=page=>page.waitForFunction(()=>window.farpointTracker?.enabled===true);
const pendingZero=page=>page.waitForFunction(()=>window.farpointTracker.pendingCount()===0,{},{timeout:45000});

define('persistent-offline-background','BROWSER-01',async env=>{
  assert(headed,'Actual foreground/background test requires headed browser under Xvfb');
  const profile=await mkdtemp(resolve(tmpdir(),'farpoint-owned-profile-'));
  const first=await env.session({profile});let page=await first.context.newPage();
  await page.goto(env.fixture.origin+'/quote.html');await waitEnabled(page);await pendingZero(page);
  env.fixture.collectorMode='drop';
  await first.context.setOffline(true);
  assert.equal(await page.evaluate(()=>navigator.onLine),false);
  const offlineId=await page.evaluate(()=>window.farpointTracker.record('quotation_start'));
  assert.equal(await page.evaluate(()=>window.farpointTracker.flush()),false);
  assert(!allEvents(env.fixture).some(event=>event.event_id===offlineId),'Offline request unexpectedly reached receiver');
  const before=await outbox(page);assert(before['farpoint-event-v1:'+offlineId]);await env.fixture.save('offline-outbox-before-close.json',before);
  await env.fixture.save('lifecycle-before-close.json',await page.evaluate(()=>({online:navigator.onLine,events:window.__acceptanceLifecycle})));
  await first.close();
  const reopened=await env.session({profile});page=await reopened.context.newPage();
  await page.goto(env.fixture.origin+'/quote.html');await waitEnabled(page);
  const after=await outbox(page);for(const [key,value] of Object.entries(before))assert.equal(after[key],value,'Close/reopen changed an unacknowledged event');
  await env.fixture.save('outbox-after-real-browser-reopen.json',after);
  assert.equal(await page.evaluate(()=>navigator.onLine),true);
  await page.bringToFront();
  await page.waitForFunction(()=>document.visibilityState==='visible');
  const backgroundId=await page.evaluate(()=>window.farpointTracker.record('technical_details_open',{location_code:'quotation'}));
  const restore=await minimizeOwnedTestWindow(page,env.fixture.observe);
  try{
    await page.waitForFunction(()=>document.visibilityState==='hidden');
    await until(()=>env.fixture.requests.some(record=>record.accept!=='application/json'&&requestHas(record,backgroundId)),'native background beacon received');
  }finally{await restore();}
  await page.waitForFunction(()=>document.visibilityState==='visible');
  env.fixture.collectorMode='ack';await reopened.context.setOffline(true);await reopened.context.setOffline(false);
  await pendingZero(page);
  for(const [key,value] of Object.entries(before))assert(allEvents(env.fixture).some(event=>event.event_id===key.slice('farpoint-event-v1:'.length)&&JSON.stringify(event)===value));
  const lifecycle=await page.evaluate(()=>window.__acceptanceLifecycle);
  assert(lifecycle.some(row=>row.event==='visibilitychange'&&row.visibility==='hidden'));
  assert(lifecycle.some(row=>row.event==='online'));
  await env.fixture.save('actual-lifecycle.json',{offline_event_id:offlineId,background_event_id:backgroundId,events:lifecycle,all_original_event_bytes_preserved:true});
});

define('concurrent-tabs-out-of-order-acks','BROWSER-02',async env=>{
  const {context}=await env.session();const a=await context.newPage(),b=await context.newPage();
  await a.goto(env.fixture.origin+'/quote.html');await b.goto(env.fixture.origin+'/products.html');await waitEnabled(a);await waitEnabled(b);await pendingZero(a);await pendingZero(b);
  env.fixture.collectorMode='hold';
  const idA=await a.evaluate(()=>window.farpointTracker.record('quotation_start'));
  const sendingA=a.evaluate(()=>window.farpointTracker.flush());
  void sendingA.catch(()=>{});env.pending.push(sendingA);
  await until(()=>env.fixture.heldIds().some(id=>requestHas(env.fixture.requests.find(r=>r.request_id===id),idA)),'tab A held send');
  const heldA=env.fixture.heldIds().find(id=>requestHas(env.fixture.requests.find(r=>r.request_id===id),idA));
  const idB=await b.evaluate(()=>window.farpointTracker.record('product_view',{product_id:'power'}));
  const sendingB=b.evaluate(()=>window.farpointTracker.flush());
  void sendingB.catch(()=>{});env.pending.push(sendingB);
  await until(()=>env.fixture.heldIds().some(id=>id!==heldA&&requestHas(env.fixture.requests.find(r=>r.request_id===id),idB)),'tab B held send');
  const heldB=env.fixture.heldIds().find(id=>id!==heldA&&requestHas(env.fixture.requests.find(r=>r.request_id===id),idB));
  const idC=await a.evaluate(()=>window.farpointTracker.record('reference_select',{reference_id:'FP-MPT-138-50'}));
  const [idD,idE]=await Promise.all([a.evaluate(()=>window.farpointTracker.record('technical_details_open',{location_code:'quotation'})),b.evaluate(()=>window.farpointTracker.record('quotation_view'))]);
  const markerIds=[idA,idB,idC,idD,idE],laterIds=[idC,idD,idE];
  const before=await outbox(a);assert.equal(new Set(markerIds).size,5);for(const id of markerIds)assert(before['farpoint-event-v1:'+id]);
  await env.fixture.save('five-pending-events.json',before);
  await env.fixture.release(heldB);await sendingB;
  const afterNewer=await outbox(a);for(const id of laterIds)assert.equal(afterNewer['farpoint-event-v1:'+id],before['farpoint-event-v1:'+id]);
  await env.fixture.release(heldA);await sendingA;
  const afterOlder=await outbox(b);for(const id of laterIds)assert.equal(afterOlder['farpoint-event-v1:'+id],before['farpoint-event-v1:'+id]);
  env.fixture.collectorMode='ack';await a.evaluate(()=>window.farpointTracker.flush());await b.evaluate(()=>window.farpointTracker.flush());
  // Any retry already held by the timer is released explicitly, preserving order evidence.
  for(const id of env.fixture.heldIds())await env.fixture.release(id);
  await pendingZero(a);await pendingZero(b);
  const events=allEvents(env.fixture);for(const id of markerIds)assert(events.some(event=>event.event_id===id));
  await env.fixture.save('out-of-order-reconciliation.json',{event_ids:markerIds,parallel_enqueue_ids:[idD,idE],ack_order:[heldB,heldA],new_events_survived_older_ack:true,unique_marker_count:new Set(events.filter(e=>markerIds.includes(e.event_id)).map(e=>e.event_id)).size,raw_deliveries_including_duplicates:events.filter(e=>markerIds.includes(e.event_id)).length});
});

define('injected-storage-denial','BROWSER-03',async env=>{
  env.fixture.collectorMode='drop';const {context}=await env.session();
  await context.addInitScript(()=>{Object.defineProperty(window,'localStorage',{get(){throw new DOMException('Synthetic storage denial','SecurityError');}});});
  const page=await context.newPage();await page.goto(env.fixture.origin+'/quote.html');await waitEnabled(page);
  assert.equal(await page.evaluate(()=>{try{void localStorage;return null;}catch(error){return error.name;}}),'SecurityError');
  const snapshot=await page.evaluate(()=>JSON.parse(window.farpointTracker.snapshot().body));
  assert(snapshot.events.every(event=>event.storage_status==='memory_only'&&event.browser_id===null));
  await rejectAndCheckForm(page,env.fixture);assert.equal(env.fixture.providerRequests.length,1);
  await env.fixture.save('denied-storage.json',{injection:'localStorage getter throws DOM SecurityError in this fresh browser context only',events:snapshot.events,form_usable:true,persistence_claimed:false});
  await page.screenshot({path:resolve(env.fixture.directory,'denied-storage-form.png')});
});

define('actual-local-storage-quota','BROWSER-03',async env=>{
  env.fixture.collectorMode='drop';const {context}=await env.session();const page=await context.newPage();await page.goto(env.fixture.origin+'/blank.html');
  const before=await seedBacklog(page,20);await env.fixture.save('pre-quota-unacknowledged-events.json',before);
  const quota=await page.evaluate(fillStorageQuota);
  await env.fixture.save('actual-browser-quota.json',quota);assert.equal(quota.smallest_new_item_refused,true);
  await page.goto(env.fixture.origin+'/quote.html');await waitEnabled(page);
  const id=await page.evaluate(()=>window.farpointTracker.record('quotation_start'));
  const snapshot=await page.evaluate(()=>JSON.parse(window.farpointTracker.snapshot().body));
  assert(snapshot.events.some(event=>event.event_id===id&&event.storage_status==='memory_only'));
  await rejectAndCheckForm(page,env.fixture);
  const after=await outbox(page);for(const [key,value] of Object.entries(before))assert.equal(after[key],value,'Quota pressure evicted an existing event');
  await env.fixture.save('quota-reconciliation.json',{new_event_id:id,new_event_transient:true,existing_event_count:Object.keys(before).length,existing_values_unchanged:true,form_usable:true,queue_count:await page.evaluate(()=>window.farpointTracker.pendingCount())});
  await page.screenshot({path:resolve(env.fixture.directory,'quota-form.png')});
});

define('bounded-long-backlog-and-receipt-growth','PERF-03',async env=>{
  env.fixture.collectorMode='drop';const {context}=await env.session();const page=await context.newPage();await page.goto(env.fixture.origin+'/blank.html');
  const before=await seedBacklog(page,1000);await env.fixture.save('1000-event-input.json',before);
  await page.goto(env.fixture.origin+'/quote.html');await waitEnabled(page);await rejectAndCheckForm(page,env.fixture);
  const after=await outbox(page);for(const [key,value] of Object.entries(before))assert.equal(after[key],value);
  env.fixture.collectorMode='ack';await page.evaluate(()=>window.farpointTracker.flush());await pendingZero(page);
  const delivered=new Map(allEvents(env.fixture).map(event=>[event.event_id,JSON.stringify(event)]));
  for(const [key,value] of Object.entries(before))assert.equal(delivered.get(key.slice('farpoint-event-v1:'.length)),value);
  assert(env.fixture.requests.length>=25);
  await env.fixture.save('backlog-reconciliation.json',{seed_count:1000,all_original_event_bytes_retained:true,receipt_attempt_count:env.fixture.requests.length,unique_delivered_event_count:delivered.size,form_usable_during_backlog:true,remaining_pending:await page.evaluate(()=>window.farpointTracker.pendingCount()),scope:'bounded synthetic local receipt growth; not hosted archive storage capacity'});
});

for(const mode of ['javascript-disabled','tracker-blocked','collector-blocked','startup-exception'])define(mode,'BROWSER-04',async env=>{
  const {context}=await env.session({contextOptions:{javaScriptEnabled:mode!=='javascript-disabled'},routeOptions:{blockTracker:mode==='tracker-blocked',blockCollector:mode==='collector-blocked'}});
  const page=await context.newPage();await page.goto(env.fixture.origin+'/quote.html');
  if(mode==='collector-blocked')await waitEnabled(page);
  if(mode==='tracker-blocked')assert(env.fixture.observedCount('tracker_blocked')>0,'Tracker script block must actually occur');
  const email=page.locator('header a[href^="mailto:quotes@farpointenergy.com"]');assert.equal(await email.count(),1);
  assert.equal(new URL(await email.getAttribute('href')).pathname,'quotes@farpointenergy.com');
  await fillMinimal(page);env.fixture.providerMode='accepted';await page.locator('#quote-submit').click();
  if(mode==='javascript-disabled'){
    await page.waitForURL('https://formsubmit.co/quotes@farpointenergy.com');
    assert.equal(await page.locator('h1').textContent(),'Native synthetic POST intercepted');
  }else await page.waitForURL('**/thanks.html');
  assert.equal(env.fixture.providerRequests.length,1);const payload=env.fixture.providerRequests[0].values;
  assert.equal(payload['Requirement or specification link'],formSentinel);
  assert.equal(payload['Name'],'Synthetic Acceptance Test');assert.equal(payload['Company'],'Synthetic Farpoint QA');assert.equal(payload.email,'synthetic@example.test');
  if(mode!=='collector-blocked'){
    assert.equal(payload['Farpoint browser ID'],undefined);assert.equal(payload['Farpoint session ID'],undefined);
  }else{
    await waitEnabled(page);assert.equal(await page.evaluate(()=>window.farpointTracker.flush()),false);
    assert(env.fixture.observedCount('collector_blocked')>0,'Collector request block must actually occur');
    assert.equal(env.fixture.requests.length,0,'Blocked collector must receive no events');
    const queued=await outbox(page);assert(Object.keys(queued).length>0,'Blocked collector must leave a pending outbox');
    const events=Object.values(queued).map(JSON.parse);
    assert(payload['Farpoint browser ID']&&payload['Farpoint session ID'],'Form retains browser/session correlation while collector unavailable');
    assert(events.some(event=>event.event_name==='quotation_provider_accepted'&&event.browser_id===payload['Farpoint browser ID']&&event.session_id===payload['Farpoint session ID']));
    await env.fixture.save('blocked-collector-outbox.json',{events:queued,blocked_requests:env.fixture.observedCount('collector_blocked'),receiver_requests:env.fixture.requests.length,form_browser_id:payload['Farpoint browser ID'],form_session_id:payload['Farpoint session ID']});
  }
  await env.fixture.save('unavailable-coverage.json',{mode,form_transport:mode==='javascript-disabled'?'native HTML POST intercepted':'enhanced fetch intercepted',form_values_preserved:true,browser_session_attribution_present:Boolean(payload['Farpoint browser ID']&&payload['Farpoint session ID']),delivery_verified:false,coverage_interpretation:mode==='collector-blocked'?'locally queued, remote receipt unavailable':'analytics unavailable; never interpreted as zero visits'});
},{trackerMode:mode==='startup-exception'?'startup_exception':'normal',expectedPageErrors:mode==='startup-exception'?['SYNTHETIC_TRACKER_STARTUP_EXCEPTION']:[]});

async function tabTo(page,selector,observe,key='Tab'){
  const path=[];
  for(let step=0;step<100;step++){
    path.push(await page.evaluate(()=>({id:document.activeElement?.id,tag:document.activeElement?.tagName,document_has_focus:document.hasFocus()})));
    if(await page.locator(selector).evaluate(element=>document.activeElement===element)){
      const focus=await page.locator(selector).evaluate(element=>({id:element.id,tag:element.tagName,outline_style:getComputedStyle(element).outlineStyle,outline_width:getComputedStyle(element).outlineWidth}));
      await observe('keyboard_focus',{selector,navigation_key:key,steps:step,...focus});assert.notEqual(focus.outline_style,'none');assert(parseFloat(focus.outline_width)>0);return;
    }
    await page.keyboard.press(key);
  }
  await observe('keyboard_unreachable',{selector,navigation_key:key,focus_path:path});
  throw Error('Keyboard could not reach '+selector);
}
define('keyboard-path-and-reduced-motion','UX-02',async env=>{
  const {context}=await env.session({contextOptions:{viewport:{width:390,height:844},reducedMotion:'reduce'}});
  const page=await context.newPage();await page.goto(env.fixture.origin+'/index.html');
  await tabTo(page,'.navbtn',env.fixture.observe);await page.keyboard.press('Enter');assert.equal(await page.locator('.navbtn').getAttribute('aria-expanded'),'true');
  await tabTo(page,'#site-menu a[href*="quote.html"]',env.fixture.observe);await page.keyboard.press('Enter');await page.waitForURL('**/quote.html*');
  assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
  assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
  await tabTo(page,'#f-configuration',env.fixture.observe);await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');
  assert.match(await page.locator('#f-configuration').inputValue(),/^FP-MPT-/);
  await tabTo(page,'#quote-submit',env.fixture.observe);await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'f-name');
  assert.equal(await page.locator('#f-name').getAttribute('aria-invalid'),'true');
  const described=await page.locator('#f-name').getAttribute('aria-describedby');assert(described?.split(/\s+/).includes('f-name-error'));
  assert((await page.locator('#f-name-error').textContent()).trim());
  for(const [selector,value] of [['#f-name','Synthetic Keyboard'],['#f-company','Synthetic QA'],['#f-email','synthetic@example.test'],['#f-requirement',formSentinel]]){
    await tabTo(page,selector,env.fixture.observe);await page.keyboard.insertText(value);
  }
  await tabTo(page,'details.optional-fields summary',env.fixture.observe);await page.keyboard.press('Enter');assert.equal(await page.locator('details.optional-fields').evaluate(e=>e.open),true);
  await tabTo(page,'#f-rating',env.fixture.observe);await page.keyboard.insertText('50');
  await tabTo(page,'#quote-submit',env.fixture.observe);await page.keyboard.press('Enter');await page.locator('#quote-status[data-state="failed"]').waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'quote-status');
  assert.equal(await page.locator('#quote-status').getAttribute('role'),'status');
  await tabTo(page,'#quote-status a',env.fixture.observe);assert.equal(await page.locator('#quote-status a').getAttribute('href'),'mailto:quotes@farpointenergy.com');
  assert.equal(await page.locator('#f-requirement').inputValue(),formSentinel);
  const labels=await page.locator('#quote-form input:not([type="hidden"]),#quote-form select,#quote-form textarea').evaluateAll(elements=>elements.filter(e=>e.getClientRects().length).map(e=>{
    const labelText=[...(e.labels||[])].map(label=>label.textContent.trim()).filter(Boolean).join(' ');
    const ariaLabel=(e.getAttribute('aria-label')||'').trim(),ids=(e.getAttribute('aria-labelledby')||'').trim().split(/\s+/).filter(Boolean);
    const referenced=ids.map(id=>document.getElementById(id)),labelledBy=ids.length&&referenced.every(Boolean)?referenced.map(node=>node.textContent.trim()).filter(Boolean).join(' '):'';
    return {id:e.id,name:labelledBy||ariaLabel||labelText,source:labelledBy?'aria-labelledby':ariaLabel?'aria-label':labelText?'associated-label':null,labelledby_ids:ids};
  }));
  assert(labels.every(item=>item.name.length>0));await env.fixture.save('keyboard-labels.json',labels);
  await page.screenshot({path:resolve(env.fixture.directory,'keyboard-error.png'),fullPage:true});
  env.fixture.providerMode='accepted';await tabTo(page,'#quote-submit',env.fixture.observe,'Shift+Tab');await page.keyboard.press('Enter');await page.waitForURL('**/thanks.html');
  assert.equal(await page.locator('#thanks-heading').textContent(),'Your request was submitted.');
  await tabTo(page,'a[data-spec-email]',env.fixture.observe);assert((await page.locator('a[data-spec-email]').getAttribute('href')).startsWith('mailto:quotes@farpointenergy.com'));
  assert.equal(await page.evaluate(()=>document.getAnimations().length),0);
  await page.emulateMedia({reducedMotion:'no-preference'});assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'smooth');
  await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).scrollBehavior),'auto');
  await env.fixture.save('keyboard-summary.json',{navigation:'keyboard Tab/Shift+Tab/Enter/ArrowDown and text input only; no mouse or locator.focus()',form_validation_errors_associated:true,error_status_receives_focus:true,success_reached:true,reduced_motion_scroll:'auto',normal_scroll:'smooth',form_attempts:env.fixture.providerRequests.length});
});

define('deferred-parser-and-input-nonblocking','PERF-03',async env=>{
  const {context}=await env.session();const page=await context.newPage();
  const navigation=page.goto(env.fixture.origin+'/quote.html',{waitUntil:'domcontentloaded'});
  void navigation.catch(()=>{});env.pending.push(navigation);
  await page.locator('#quote-form').waitFor({state:'visible'});
  assert.equal(await page.evaluate(()=>typeof window.farpointTracker),'undefined');
  assert.equal(await page.locator('script[src^="tracker.js"]').evaluate(element=>element.defer),true);
  await page.locator('#f-name').fill('Synthetic input while tracker load held');
  assert.equal(await page.locator('#f-name').inputValue(),'Synthetic input while tracker load held');
  await env.fixture.save('nonblocking-before-release.json',{tracker_script_held:true,form_visible:true,input_editable:true,ready_state:await page.evaluate(()=>document.readyState)});
  env.fixture.releaseTracker();await navigation;await waitEnabled(page);
},{trackerMode:'held'});

async function traceRun(env,baseline,index){
  const device=playwright.devices['iPhone 13'];
  const {context}=await env.session({contextOptions:{...device,viewport:{width:390,height:844}}});const page=await context.newPage();
  const cdp=await context.newCDPSession(page);
  const spanId=randomUUID(),requiredSpan={start:'farpoint-acceptance-start-'+spanId,end:'farpoint-acceptance-end-'+spanId};
  await context.addInitScript(name=>performance.mark(name),requiredSpan.start);
  await env.fixture.save('trace-required-span.json',requiredSpan);
  await cdp.send('Network.enable');await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:1600000/8,uploadThroughput:750000/8,connectionType:'cellular3g'});
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  let completion;const completed=new Promise(done=>{completion=done;});cdp.once('Tracing.tracingComplete',completion);
  await cdp.send('Tracing.start',{transferMode:'ReturnAsStream',streamFormat:'json',traceConfig:{recordMode:'recordUntilFull',enableSampling:true,includedCategories:TRACE_CATEGORIES}});
  let traceResult,scenarioError;
  try{
    await page.goto(env.fixture.origin+'/quote.html');if(!baseline)await waitEnabled(page);
    await fillMinimal(page);await page.locator('details.optional-fields summary').click();await page.locator('#f-rating').fill('50');
    await page.locator('#f-configuration').selectOption('FP-MPT-138-50');
    await page.locator('#quote-submit').click();await page.locator('#quote-status[data-state="failed"]').waitFor();
    assert.equal(await page.locator('#f-requirement').inputValue(),formSentinel);
    if(!baseline){await page.evaluate(()=>window.farpointTracker.flush());await pendingZero(page);}
    await page.evaluate(name=>performance.mark(name),requiredSpan.end);
    const timing=await page.evaluate(()=>({user_agent:navigator.userAgent,hardware_concurrency:navigator.hardwareConcurrency,device_memory_gib:navigator.deviceMemory??null,navigation:performance.getEntriesByType('navigation').map(e=>e.toJSON()),resources:performance.getEntriesByType('resource').map(e=>e.toJSON()),long_tasks:window.__acceptanceLongTasks,synchronous_xhr:window.__acceptanceSyncXhr,tracker_script_defer:document.querySelector('script[src^="tracker.js"]').defer}));
    assert.equal(timing.tracker_script_defer,true);assert.deepEqual(timing.synchronous_xhr,[]);
    await env.fixture.save('browser-timings.json',timing);
  }catch(error){scenarioError=error;}
  finally{
    if(scenarioError)await env.fixture.save('trace-scenario-error.json',{reason:String(scenarioError.stack||scenarioError)});
    await cdp.send('Tracing.end');const finished=await bounded(completed,15000,'trace completion');
    await env.fixture.save('trace-completion.json',finished);assert(finished.stream,'Trace stream unavailable');
    const tracePath=resolve(env.fixture.directory,'trace.json');await writeFile(tracePath,Buffer.alloc(0),{flag:'wx'});
    let chunksRead=0,bytesRead=0,streamError,closeError;
    try{
      for(;;){
        const chunk=await bounded(cdp.send('IO.read',{handle:finished.stream}),15000,'trace stream read');
        const bytes=Buffer.from(chunk.data,chunk.base64Encoded?'base64':'utf8');
        await appendFile(tracePath,bytes);bytesRead+=bytes.length;
        await appendFile(resolve(env.fixture.directory,'trace-chunks.jsonl'),JSON.stringify({chunk:chunksRead++,bytes:bytes.length,sha256:hash(bytes),eof:chunk.eof===true})+'\n');
        if(chunk.eof)break;
      }
    }catch(error){streamError=error;await env.fixture.save('trace-stream-failure.json',{reason:String(error),chunks_read:chunksRead,bytes_preserved:bytesRead});}
    finally{try{await bounded(cdp.send('IO.close',{handle:finished.stream}),5000,'trace handle cleanup');}catch(error){closeError=error;await env.fixture.save('trace-close-failure.json',{reason:String(error),chunks_read:chunksRead,bytes_preserved:bytesRead});}}
    if(streamError||closeError)throw streamError||closeError;
    const text=await readFile(tracePath,'utf8');
    assert.equal(typeof finished.dataLossOccurred,'boolean','Trace completion must explicitly report dataLossOccurred');
    const trace=JSON.parse(text);traceResult=analyzeTrace(trace,{trackerBasename:'tracker.js',expectTracker:!baseline,limitMs:50,dataLossOccurred:finished.dataLossOccurred===true,requireCpuSamples:!baseline,requiredSpan});
    await env.fixture.save('trace-analysis.json',{baseline,index,profile:report.performance_profile,trace_sha256:hash(text),...traceResult});await cdp.detach();
  }
  if(scenarioError)throw scenarioError;
  assert.equal(traceResult.assessment,'PASS','Trace performance attribution must be supported and below the 50ms task target');
}
for(let index=1;index<=3;index++)for(const baseline of [true,false])define(`mobile-trace-${baseline?'baseline':'current'}-${index}`,'PERF-03',env=>traceRun(env,baseline,index),{engineOnly:'chromium',enabled:!baseline,trackerMode:baseline?'absent':'normal'});

async function execute(engine,definition){
  const name=engine+'-'+definition.name;console.log('Checking',name);
  const fixture=await createFixture({evidence,name,enabled:definition.enabled??true,trackerMode:definition.trackerMode||'normal'});
  const sessions=[],pageErrors=[],pending=[];let result={engine,name,gate:definition.gate,status:'RUNNING'},failure;
  async function session({profile,contextOptions={},routeOptions={}}={}){
    const options={serviceWorkers:'block',ignoreHTTPSErrors:true,viewport:{width:1366,height:900},...contextOptions};
    let browser,context;
    try{
      if(profile){context=await playwright[engine].launchPersistentContext(profile,{headless:!headed,timeout:20000,...options});browser=context.browser();}
      else{browser=await playwright[engine].launch({headless:!headed,timeout:20000});context=await bounded(browser.newContext(options),15000,'context creation');}
    }catch(error){if(browser)await bounded(browser.close(),5000,'failed context cleanup').catch(()=>{});throw error;}
    let closed=false;const record={browser,context,async close(){
      if(closed)return;closed=true;const failures=[];
      try{await bounded(context.close(),5000,'context cleanup');}catch(error){failures.push(String(error));}
      if(browser?.isConnected())try{await bounded(browser.close(),5000,'browser cleanup');}catch(error){failures.push(String(error));}
      if(failures.length)throw Error(failures.join('; '));
    }};sessions.push(record);
    context.setDefaultTimeout(15000);context.setDefaultNavigationTimeout(20000);
    context.on('page',page=>page.on('pageerror',error=>{pageErrors.push(error.message);void fixture.observe('page_error',{message:error.message});}));
    await context.addInitScript(()=>{
      window.__acceptanceLifecycle=[];window.__acceptanceLongTasks=[];window.__acceptanceSyncXhr=[];
      for(const event of ['online','offline','pageshow','pagehide'])addEventListener(event,()=>window.__acceptanceLifecycle.push({event,visibility:document.visibilityState,at:performance.now()}));
      document.addEventListener('visibilitychange',()=>window.__acceptanceLifecycle.push({event:'visibilitychange',visibility:document.visibilityState,at:performance.now()}));
      if(window.PerformanceObserver)try{new PerformanceObserver(list=>window.__acceptanceLongTasks.push(...list.getEntries().map(e=>e.toJSON()))).observe({type:'longtask',buffered:true});}catch{}
      const open=XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open=function(method,url,async=true,...rest){if(async===false)window.__acceptanceSyncXhr.push({method,url:String(url)});return open.call(this,method,url,async,...rest);};
    });
    await fixture.attach(context,routeOptions);
    result.browser_version=browser?.version();return record;
  }
  try{await definition.run({engine,fixture,session,pending});result.status='PASS';}
  catch(error){failure=error;result.status=/Executable doesn't exist|Host system is missing|browserType.launch|XServer/.test(String(error))?'BLOCKED':'FAIL';result.reason=String(error.stack||error);await fixture.observe('case_failure',{reason:result.reason});
    for(const [i,s] of sessions.entries())for(const [j,page] of s.context.pages().entries())try{await page.screenshot({path:resolve(fixture.directory,`failure-${i}-${j}.png`),fullPage:true,timeout:5000});}catch{}
  }finally{
    const cleanupErrors=[];for(const s of sessions)try{await s.close();}catch(error){cleanupErrors.push(String(error));}
    try{await fixture.close();}catch(error){cleanupErrors.push(String(error));}
    try{await bounded(Promise.allSettled(pending),5000,'pending browser evaluations drain');}catch(error){cleanupErrors.push(String(error));}
    const expected=definition.expectedPageErrors||[];
    const unexpected=pageErrors.filter(message=>!expected.some(pattern=>message.includes(pattern)));
    if(!failure){for(const pattern of expected)if(!pageErrors.some(message=>message.includes(pattern)))unexpected.push('Expected startup error was not observed: '+pattern);}
    if(unexpected.length||cleanupErrors.length){result.status='FAIL';result.unexpected_page_errors=unexpected;result.cleanup_errors=cleanupErrors;}
    result.page_errors=pageErrors;result.provider_requests=fixture.providerRequests.length;result.collector_requests=fixture.requests.length;
    await fixture.save('result.json',result);report.cases.push(result);console.log(name,result.status);
  }
}
const gzipBytes=gzipSync(await readFile(resolve(repositoryRoot,'tracker.js'))).length;report.tracker_gzip_bytes=gzipBytes;
report.cases.push({name:'tracker-gzip-budget',engine:'source',gate:'PERF-03',status:gzipBytes<=15*1024?'PASS':'FAIL',gzip_bytes:gzipBytes,limit_bytes:15*1024});
for(const engine of engines)for(const definition of caseDefinitions)if(!definition.engineOnly||definition.engineOnly===engine)await execute(engine,definition);
report.status=report.cases.every(item=>item.status==='PASS')?'PASS':'FAIL';
await writeFile(resolve(evidence,'summary.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({evidence,...report},null,2));if(report.status!=='PASS')process.exitCode=1;
