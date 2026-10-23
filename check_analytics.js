/* Behavioral tests use synthetic DOM/transport fixtures; no network or browser. */
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const script = fs.readFileSync(`${__dirname}/analytics.js`, 'utf8');
const KEY = 'farpoint-analytics-v1';
const DAY = 86400000;
const initialNow = Date.UTC(2026, 9, 22, 12);
let uuidSequence = 1;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function node(id) {
  return { id, hidden:true, disabled:false, checked:false, value:'', textContent:'', attributes:{}, listeners:{},
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); },
    setAttribute(name, value) { this.attributes[name] = value; },
    focus() { this.focused = true; },
    trigger(name, event = {}) { for (const fn of this.listeners[name] || []) fn(event); }
  };
}
function setup(options = {}) {
  let clock = initialNow;
  const stored = options.sharedStorage?.stored || new Map();
  if (options.state) stored.set(KEY, JSON.stringify(options.state));
  if (options.rawState) stored.set(KEY, options.rawState);
  const ids = Object.fromEntries(['analytics-preferences','analytics-open','analytics-status','analytics-allow','analytics-decline','analytics-close','analytics-exclude','f-inquiry-id'].map(id => [id,node(id)]));
  ids['f-inquiry-id'].value = '99999999-9999-4999-8999-999999999999';
  const form = node('quote-form');
  form.elements = {'Transformer category':{value:'power'},Application:{value:'solar'}};
  const calls = [], beacon = [];
  const location = { pathname:'/quote.html',hostname:'farpointenergy.com',search:'',hash:'',...options.location };
  const config = { enabled:true,endpoint:'https://collector.example.test/v1/events',approvedHosts:['farpointenergy.com','www.farpointenergy.com'],campaigns:{c1:{source:'email',medium:'email'},c2:{source:'social',medium:'social'}},...options.config };
  const win = node('window');
  if (options.sharedStorage) options.sharedStorage.tabs.push(win);
  Object.assign(win, {farpointAnalyticsConfig:config,innerWidth:1280,crypto:options.noCrypto ? undefined : {randomUUID:() => `00000000-0000-4000-8000-${(uuidSequence++).toString().padStart(12,'0')}`}});
  if (!options.noFetch) win.fetch = (url, settings) => { calls.push({url,...settings,payload:JSON.parse(settings.body)}); if (options.throwFetch) throw new Error('Synthetic transport error'); return options.pendingFetch ? new Promise(()=>{}) : Promise.reject(new Error('Synthetic transport rejection')); };
  const navigator = { language:'en-US',globalPrivacyControl:!!options.gpc,doNotTrack:options.dnt || '',sendBeacon:(url, body) => {beacon.push({url,body});return true;} };
  const document = { referrer:options.referrer || '',activeElement:ids['analytics-open'],getElementById(id) { if (id==='quote-form') return options.noForm ? null : form; return ids[id]; }, querySelector() { return options.noReferrerMeta ? {content:'no-referrer'} : null; } };
  const localStorage = { getItem(key) { if (options.storageReadDenied) throw new Error('Synthetic storage denial'); return stored.get(key) || null; }, setItem(key,value) { if (options.storageWriteDenied || localStorage.writeDenied) throw new Error('Synthetic storage denial'); const oldValue = stored.get(key) || null;stored.set(key,value);if (options.sharedStorage && oldValue !== value) for (const tab of options.sharedStorage.tabs) if (tab !== win) options.sharedStorage.queue.push({tab,event:{key,oldValue,newValue:value}}); }, removeItem:key=>{ if (localStorage.removeDenied) throw new Error("Synthetic removal denial"); stored.delete(key); } };
  class Clock extends Date { static now() { return clock; } }
  vm.runInNewContext(script,{window:win,document,location,navigator,localStorage,Date:Clock,URL,URLSearchParams,Uint8Array,Blob,Promise,console});
  return { ids, form, calls, beacon, win, location, stored, navigator, localStorage, choose:choice=>ids[`analytics-${choice}`].trigger('click'), state:()=>JSON.parse(stored.get(KEY)||'null'), advance:ms=>clock+=ms };
}
const consent = (extra={}) => ({version:1,consent:'allow',consentExpires:initialNow+180*DAY,excluded:false,...extra});
const event = t => t.calls.at(-1)?.payload;
(async()=>{
  let t = setup(); assert.equal(t.calls.length,0); assert.equal(t.ids['analytics-preferences'].hidden,false); assert.equal(t.ids['analytics-open'].hidden,false);
  t.form.trigger('focusin');t.form.trigger('input');assert.equal(t.calls.length,0,'Before-consent actions are not sent');
  t.choose('allow');assert.equal(t.calls.length,1);assert.equal(event(t).name,'page_view');assert.equal(t.ids['analytics-preferences'].hidden,true);
  t.form.trigger('input');t.win.farpointAnalytics('rfq_start',{product:'power',application:'solar'});assert.equal(t.calls.filter(c=>c.payload.name==='rfq_start').length,1,'First interaction after late consent counted once');
  t.win.farpointAnalytics('rfq_submit_success',{product:'power',application:'solar',email:'private@example.test'});assert.equal(event(t).inquiryId,t.ids['f-inquiry-id'].value);assert(!JSON.stringify(event(t)).includes('private'));
  t.win.farpointAnalytics('email_click',{product:'power',application:'solar'});assert(!Object.hasOwn(event(t),'inquiryId'));
  const before = t.calls.length;t.choose('decline');t.form.trigger('input');t.win.farpointAnalytics('rfq_submit_success',{});assert.equal(t.calls.length,before);assert.equal(t.state().consent,'deny');assert(!t.state().browserId);assert(!t.state().firstCampaign);
  t.ids['analytics-open'].trigger('click');assert(t.ids['analytics-preferences'].focused);t.ids['analytics-preferences'].trigger('keydown',{key:'Escape'});assert(t.ids['analytics-open'].focused);assert.equal(t.ids['analytics-preferences'].hidden,true);
  for(const options of [{config:{enabled:false}},{config:{endpoint:'http://bad.test/v1/events'}},{config:{endpoint:'https://bad.test/v1/events?token=bad'}},{config:{endpoint:'https://user:pass@bad.test/v1/events'}},{location:{hostname:'preview.example.test'}},{location:{pathname:'/private-customer'}}]) { t=setup({...options,state:consent()});assert.equal(t.calls.length,0);assert.equal(t.win.farpointAnalytics,undefined);assert.equal(t.ids['analytics-open'].hidden,true); }
  for(const options of [{gpc:true},{dnt:'1'}]) { t=setup({...options,state:consent()});assert.equal(t.calls.length,0);assert.equal(t.ids['analytics-allow'].disabled,true);t.choose('allow');assert.equal(t.calls.length,0);assert(!t.state().browserId); }
  for(const options of [{storageReadDenied:true},{storageWriteDenied:true},{noCrypto:true}]) { t=setup(options);t.choose('allow');t.form.trigger('input');assert.equal(t.calls.length,0); }
  for(const rawState of ['{bad','null','[]',JSON.stringify(consent({consentExpires:initialNow-1})),JSON.stringify(consent({privateEmail:'private@example.test'})),JSON.stringify(consent({browserId:'not-a-uuid'}))]) { t=setup({rawState});assert.equal(t.calls.length,0); }
  t=setup({state:consent(),location:{search:'?utm_campaign=c1&utm_source=email&utm_medium=email&email=private@example.test#private',hash:'#private'},referrer:'https://private.customer.example.test/path?email=secret@example.test'});
  assert.equal(event(t).campaignCode,'c1');assert.equal(event(t).source,'email');assert.equal(event(t).referrerHost,'other');assert(!JSON.stringify(t.calls).includes('private'));assert(!JSON.stringify(t.calls).includes('secret'));assert.equal(t.state().firstCampaign,'c1');assert.equal(t.state().lastCampaign,'c1');
  t.form.trigger('input');const sameChoiceState=JSON.stringify(t.state()),sameChoiceCalls=t.calls.length;
  t.ids['analytics-open'].trigger('click');t.choose('allow');t.form.trigger('input');assert.equal(t.calls.length,sameChoiceCalls,'Reaffirmed Allow never replays a page or RFQ start');assert.equal(JSON.stringify(t.state()),sameChoiceState,'Reaffirmed Allow preserves identity, attribution and consent expiry');
  t.location.search='';t.win.farpointAnalytics('email_click',{});assert.equal(event(t).campaignCode,'c1','Direct actions retain recognized attribution');
  t.location.search='?utm_campaign=c2';t.win.farpointAnalytics('email_click',{});assert.equal(event(t).campaignCode,'c2');assert.equal(t.state().firstCampaign,'c1');assert.equal(t.state().lastCampaign,'c2');
  const browser=event(t).browserId,session=event(t).sessionId;t.advance(30*60000);t.win.farpointAnalytics('email_click',{});assert.notEqual(event(t).sessionId,session);assert.equal(event(t).browserId,browser);assert.equal(t.calls.at(-2).payload.name,'page_view','A fresh session includes its current page');
  t.location.search='';t.advance(31*DAY);t.win.farpointAnalytics('email_click',{});assert.notEqual(event(t).browserId,browser);assert.equal(event(t).campaignCode,'');assert.equal(t.state().firstCampaign,'');assert.equal(t.state().lastCampaign,'');
  for(const search of ['?utm_campaign=c1&utm_campaign=c1','?utm_campaign=private-person','?utm_campaign=c1&utm_source=private-person','?utm_campaign=c1&utm_medium=email&utm_medium=email','?campaign=solar&source=email','?utm_source=email&email=secret@example.test']) { t=setup({state:consent(),location:{search}});assert.equal(event(t).campaignCode,'');assert.equal(event(t).source,'');assert(!JSON.stringify(t.calls).includes('private'));assert(!JSON.stringify(t.calls).includes('secret')); }
  for(const [referrer,want] of [['https://www.google.com/search?q=private','google.com'],['https://farpointenergy.com/quote.html?name=private',''],['https://person.linkedin.com/secret','other'],['not a URL','other']]){t=setup({state:consent(),referrer});assert.equal(event(t).referrerHost,want);}
  t=setup({state:consent()});for(const call of t.calls){assert.equal(call.referrerPolicy,'no-referrer');assert.equal(call.credentials,'omit');assert.equal(call.keepalive,true);assert(UUID.test(call.payload.eventId));assert(UUID.test(call.payload.browserId));assert(UUID.test(call.payload.sessionId));assert.equal(Buffer.byteLength(call.body)<4096,true);}
  t.ids['analytics-exclude'].checked=true;t.ids['analytics-exclude'].trigger('change');const excluded=t.calls.length;t.win.farpointAnalytics('email_click',{});assert.equal(t.calls.length,excluded);assert(!t.state().browserId);assert.equal(t.state().excluded,true);
  t=setup({state:consent()});t.localStorage.writeDenied=true;t.localStorage.removeDenied=true;const writeFailure=t.calls.length;t.choose('decline');t.win.farpointAnalytics('email_click',{});assert.equal(t.calls.length,writeFailure,'Withdrawal stops this page even when storage cannot be changed');assert(t.ids['analytics-status'].textContent.includes('off on this page'));
  t=setup({state:consent()});const crossTab=t.calls.length;t.stored.set(KEY,JSON.stringify(consent({consent:'deny'})));t.win.trigger('storage',{key:KEY});t.win.farpointAnalytics('email_click',{});assert.equal(t.calls.length,crossTab);
  const sharedStorage = {stored:new Map(),tabs:[],queue:[],flush(){let count=0;while(this.queue.length){assert(++count<100,'Cross-tab storage processing must terminate without event ping-pong');const {tab,event}=this.queue.shift();tab.trigger('storage',event);}}};
  const tabA=setup({sharedStorage,state:consent()}),tabB=setup({sharedStorage});sharedStorage.flush();
  assert.equal(tabA.calls.length,1);assert.equal(tabB.calls.length,1);
  tabA.advance(1000);tabA.form.trigger('input');sharedStorage.flush();
  assert.equal(tabA.calls.length,2,'One action adds one RFQ start');assert.equal(tabB.calls.length,1,'Another tab must not collect in response to an activity write');
  tabB.advance(1500);tabB.form.trigger('input');sharedStorage.flush();
  tabA.form.trigger('input');sharedStorage.flush();assert.equal(tabA.calls.length,2,'Another tab activity does not reset this tab RFQ-start guard');assert.equal(tabB.calls.length,2);
  tabA.location.search='?utm_campaign=c1';tabA.win.farpointAnalytics('email_click',{});sharedStorage.flush();assert.equal(tabB.calls.length,2,'Attribution writes cannot synthesize other-tab page views');
  const aBeforeAllow=tabA.calls.length,bBeforeAllow=tabB.calls.length;tabA.choose('allow');sharedStorage.flush();tabA.form.trigger('input');tabB.form.trigger('input');assert.equal(tabA.calls.length,aBeforeAllow);assert.equal(tabB.calls.length,bBeforeAllow,'An unchanged Allow choice cannot invalidate another tab guards');
  tabA.choose('decline');sharedStorage.flush();tabB.form.trigger('input');assert.equal(tabB.calls.length,2,'Cross-tab withdrawal stops collection');
  tabA.choose('allow');sharedStorage.flush();assert.equal(tabB.calls.length,2,'Cross-tab consent and identifier changes never themselves send events');
  tabB.form.trigger('input');sharedStorage.flush();assert.deepEqual(tabB.calls.slice(-2).map(c=>c.payload.name),['page_view','rfq_start'],'First subsequent action after cross-tab consent records current page once');
  tabB.form.trigger('input');sharedStorage.flush();assert.equal(tabB.calls.length,4);
  const longCampaign='a'.repeat(41);t=setup({state:consent(),config:{campaigns:{[longCampaign]:{source:'email',medium:'email'}}},location:{search:`?utm_campaign=${longCampaign}`}});assert.equal(event(t).campaignCode,'','Client uses collector 40-character campaign limit');
  t=setup({state:consent(),noForm:true,location:{pathname:'/products.html',hash:'#power'}});assert.deepEqual(t.calls.map(c=>c.payload.name),['page_view','product_path_view']);t.win.farpointAnalytics('product_path_view',{product:'power',application:'unsure'});assert.equal(t.calls.length,2);t.win.trigger('pageshow',{persisted:true});assert.equal(t.calls.length,2);t.location.hash='#distribution';t.win.farpointAnalytics('product_path_view',{product:'distribution'});assert.equal(t.calls.length,3);
  t=setup({state:consent(),noForm:true,location:{pathname:'/thanks.html'}});assert.deepEqual(t.calls.map(c=>c.payload.name),['page_view'],'Thank-you URL does not imply acceptance');
  t=setup({state:consent(),pendingFetch:true});for(let i=0;i<30;i++)t.win.farpointAnalytics('email_click',{});assert.equal(t.calls.length,20,'Outstanding event memory is bounded');
  t=setup({state:consent(),noFetch:true});assert.equal(t.beacon.length,0,'Beacon prohibited without no-referrer policy');t=setup({state:consent(),noFetch:true,noReferrerMeta:true});assert.equal(t.beacon.length,1);
  t=setup({state:consent(),throwFetch:true});assert.doesNotThrow(()=>t.win.farpointAnalytics('email_click',{}));
  // Exercise the real inquiry script with the established synthetic form fixture.
  // Reusing its setup avoids inventing a second model of field freeze/retry behavior.
  const harness = fs.readFileSync(`${__dirname}/check_inquiry.js`, 'utf8').split('(async()=>{')[0]
    .replace('initialValues={}}={})', 'initialValues={}, cryptoTest=false}={})')
    .replace('window:{fetch:native?', 'window:{crypto:cryptoTest?{randomUUID:()=>"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}:undefined,fetch:native?');
  const inquiry = {require,__dirname,console,AbortController,URLSearchParams,setTimeout,clearTimeout};
  vm.runInNewContext(harness + '\nglobalThis.inquirySetup = setup;', inquiry);
  for (const native of [false,true]) {
    const f = inquiry.inquirySetup({native,cryptoTest:true,response:{ok:false,success:false}});
    const id = f.ids['f-inquiry-id'].value;
    assert(UUID.test(id));assert.equal(f.ids['f-inquiry-id'].disabled,false);
    if (!native) { await f.submit();assert.equal(JSON.parse(f.calls[0].options.body)['Website inquiry ID'],id);await f.submit();assert.equal(JSON.parse(f.calls[1].options.body)['Website inquiry ID'],id);assert.equal(f.ids['f-inquiry-id'].value,id); }
    else assert.equal(f.listeners.submit,undefined,'ID generation retains native POST');
  }
  await new Promise(resolve=>setImmediate(resolve));
  console.log('PASS: consent and withdrawal, late-consent starts, excluded/disabled/preview/GPC/DNT, storage/crypto failures, strict campaign/referrer privacy, identifier expiry/session reset, no PII, transport policy and bounded outstanding events, bfcache/product deduplication, and no synthetic acceptance from thanks. Synthetic DOM/transport tests only; browser QA and live delivery remain separate.');
})().catch(error=>{console.error(error);process.exitCode=1;});
