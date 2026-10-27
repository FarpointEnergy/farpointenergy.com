import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import vm from 'node:vm';
import {buildPreview,HTML_FILES,PREVIEW_ORIGIN,PREPARED_PATH,STATIC_FILES} from './build-preview-worker.mjs';

const built = await buildPreview();
const worker = (await import('data:text/javascript;base64,'+Buffer.from(built.source).toString('base64'))).default;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const buckets=[];
class Bucket {
  objects = new Map(); fail = false; attempts=[];
  constructor(){buckets.push(this);}
  async put(key,bytes,options) {
    assert.deepEqual(options.onlyIf,{etagDoesNotMatch:'*'});
    this.attempts.push({key,body_base64:Buffer.from(bytes).toString('base64'),sha256:digest(bytes),options,failed:this.fail});
    if(this.fail) throw new Error('synthetic-provider-detail');
    if(this.objects.has(key))return null;
    this.objects.set(key,{bytes:Buffer.from(bytes),options});return {etag:randomUUID()};
  }
  async get(){throw new Error('Public read prohibited');}
  async list(){throw new Error('Public list prohibited');}
  async head(){throw new Error('Public head prohibited');}
}
function request(path,method='GET',headers={},body){return new Request(PREVIEW_ORIGIN+path,{method,headers,...(body===undefined?{}:{body})});}
const textAsset = name => Buffer.from(built.assets['/'+name].base64,'base64').toString();

test('deterministic content-addressed build covers exactly 17 HTML and explicit static routes',async()=>{
  assert.equal(HTML_FILES.length,17);
  assert.equal(built.manifest.html_count,17);
  assert.equal(digest(built.source),built.manifest.worker_sha256);
  assert.equal((await buildPreview()).source,built.source);
  assert.deepEqual(Object.keys(built.assets).sort(),[...STATIC_FILES,'preview-fixture.js','robots.txt'].map(x=>'/'+x).sort());
  for(const [path,asset] of Object.entries(built.assets)){
    const body=Buffer.from(asset.base64,'base64');
    assert.equal(body.length,asset.bytes);assert.equal(digest(body),asset.sha256);
    assert.equal(built.manifest.assets[path].sha256,asset.sha256);
  }
});
test('every HTML has visible synthetic banner and unambiguous noindex; native form destination preserved',()=>{
  for(const name of HTML_FILES){
    const html=textAsset(name);
    assert.match(html,/Test site — synthetic details only\. Test quotations go to Farpoint inbox\./);
    assert.equal((html.match(/<meta name="robots"/g)||[]).length,1);
    assert.match(html,/<meta name="robots" content="noindex,nofollow,noarchive">/);
    assert.equal(html.includes('src="preview-fixture.js"'),name==='quote.html');
  }
  assert.match(textAsset('quote.html'),/action="https:\/\/formsubmit\.co\/quotes@farpointenergy\.com"/);
  assert.match(textAsset('quote.html'),/data-ajax-action="https:\/\/formsubmit\.co\/ajax\/quotes@farpointenergy\.com"/);
  assert.match(textAsset('quote.html'),/<button id="preview-fill" type="button"/);
});
test('form, tracker, layout and navigation scripts are byte-identical to frozen source',async()=>{
  for(const name of ['inquiry.js','tracker.js','site.js','style.css']){
    const original=await readFile(new URL('../../../'+name,import.meta.url));
    assert.deepEqual(Buffer.from(built.assets['/'+name].base64,'base64'),original);
    assert.equal(built.manifest.assets['/'+name].transformed,false);
  }
});
test('synthetic config enables same-host collection with exact nonambiguous campaign codes',()=>{
  const sandbox={window:{}};vm.runInNewContext(textAsset('analytics-config.js'),sandbox);
  const config=JSON.parse(JSON.stringify(sandbox.window.farpointAnalyticsConfig));
  assert.equal(config.enabled,true);assert.equal(config.synthetic,true);
  assert.equal(config.endpoint,PREVIEW_ORIGIN+'/v1/events');
  assert.equal(config.privacy_disclosure_version,'1');
  assert.deepEqual(config.campaign_registry,{source:['website'],medium:['referral'],campaign:['power']});
  assert.equal(PREPARED_PATH,'/quote.html?source=website&campaign=power&utm_medium=referral');
});
test('privacy is truthful about test collection, hosting, form provider and retained raw bytes',()=>{
  const text=textAsset('privacy.html');
  for(const expected of ['Cloudflare Workers','private Cloudflare R2','marked synthetic','does not assert a verified visitor IP','without a deletion schedule','FormSubmit','Analytics events do not include your form answers'])assert(text.includes(expected));
  assert(!text.includes('does not currently send inquiry analytics'));
  assert(!text.includes('This static website is hosted on GitHub Pages'));
});
test('all allowlisted assets are served with hash and noindex, including HEAD and cache query',async()=>{
  for(const [path,asset] of Object.entries(built.assets)){
    const r=await worker.fetch(request(path+'?v=unchanged'),{});
    assert.equal(r.status,path==='/404.html'?404:200);
    assert.equal(r.headers.get('x-farpoint-asset-sha256'),asset.sha256);
    assert.match(r.headers.get('x-robots-tag'),/noindex/);
    assert.equal(digest(Buffer.from(await r.arrayBuffer())),asset.sha256);
  }
  const head=await worker.fetch(request('/quote.html','HEAD'),{});
  assert.equal(await head.text(),'');assert.equal(Number(head.headers.get('content-length')),built.assets['/quote.html'].bytes);
  assert.equal(await(await worker.fetch(request('/'),{})).text(),textAsset('index.html'));
});
test('unlisted, private, encoded and wrong-host routes expose no files or storage',async()=>{
  for(const path of ['/analytics/collector/core.mjs','/README.md','/receipts/x','/health','/%71uote.html','/mcp/','/preview-wrapper.mjs','//example.invalid/quote.html']){
    assert.equal((await worker.fetch(request(path),{})).status,404);
  }
  assert.equal((await worker.fetch(new Request('https://other.example/quote.html'),{})).status,404);
  assert.equal((await worker.fetch(request('/quote.html','POST',{},'x'),{})).status,405);
});
test('public MCP stays forbidden for every method and forged identity without requiring storage',async()=>{
  const env={OWNER_USER_ID:'fake-owner',GATEWAY_IDENTITY_VERIFIED:'1',PRIVATE_OWNER_EXPORT_ENABLED:'1'};
  for(const method of ['GET','POST','OPTIONS','PUT','DELETE','PATCH','HEAD']){
    const r=await worker.fetch(request('/mcp',method,{'oai-authenticated-user-id':'fake-owner',Authorization:'Bearer fake-token'}),env);
    assert.equal(r.status,403);assert(!(await r.text()).includes('fake-owner'));
  }
});
test('only exact preview Origin can ingest; original production Origin remains unenabled',async()=>{
  const env={BUCKET:new Bucket()};
  for(const origin of ['https://farpointenergy.com','https://www.farpointenergy.com',PREVIEW_ORIGIN+'/', 'null']){
    const r=await worker.fetch(request('/v1/events','POST',{Origin:origin,'Content-Type':'application/json'},'{}'),env);
    assert.equal(r.status,403);assert.equal(r.headers.get('access-control-allow-origin'),null);
  }
  const preflight=await worker.fetch(request('/v1/events','OPTIONS',{Origin:PREVIEW_ORIGIN,'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}),env);
  assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-origin'),PREVIEW_ORIGIN);
  assert.equal(env.BUCKET.objects.size,4);
});
test('receipt bytes and retries are preserved; forged headers and env cannot enable source IP',async()=>{
  const env={BUCKET:new Bucket(),CLOUDFLARE_DIRECT_IP_VERIFIED:'1',CLOUDFLARE_VERIFIED_IP_HOSTNAME:new URL(PREVIEW_ORIGIN).hostname};
  const bytes=Buffer.from([0xff,0x00,0x7b,0x0a]);
  for(let i=0;i<2;i++){
    const r=await worker.fetch(request('/v1/events','POST',{Origin:PREVIEW_ORIGIN,'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.9'},bytes),env);
    assert.equal(r.status,202);assert.equal((await r.json()).receipt_body_sha256,digest(bytes));
  }
  assert.equal(env.BUCKET.objects.size,2);
  for(const {bytes:outer,options} of env.BUCKET.objects.values()){
    assert.equal(digest(outer),options.customMetadata.sha256);
    const record=JSON.parse(outer);
    assert.deepEqual(Buffer.from(record.body_base64,'base64'),bytes);
    assert.deepEqual(record.source_ip,{status:'unavailable',provenance:'unverified',address:null});
  }
});
test('failed retention does not fabricate a successful receipt',async()=>{
  const env={BUCKET:new Bucket()};env.BUCKET.fail=true;
  const r=await worker.fetch(request('/v1/events','POST',{Origin:PREVIEW_ORIGIN,'Content-Type':'application/json'},'{}'),env);
  assert.equal(r.status,503);assert.deepEqual(await r.json(),{status:'retry',reason:'durability_unconfirmed'});
});
function fixtureEnvironment(search){
  const controls={};const listeners={};const events=[];
  for(const match of textAsset('quote.html').matchAll(/<(?:input|textarea|select)\b[^>]*id="([^"]+)"[^>]*>/g)){
    controls[match[1]]={value:'',disabled:false,dispatchEvent:e=>events.push(e.type)};
  }
  controls['quote-form']={getAttribute:()=>null};
  controls['quote-submit']={disabled:false};
  controls['preview-fill']={disabled:false,addEventListener:(name,fn)=>listeners[name]=fn};
  controls['preview-fill-status']={textContent:''};
  const context={document:{getElementById:id=>controls[id]||null},location:{search},URLSearchParams,Date,Event:class{constructor(type){this.type=type;}}};
  vm.runInNewContext(textAsset('preview-fixture.js'),context);
  return {controls,listeners,events};
}
test('helper fills exactly 20 business controls only on click and never submits',()=>{
  const {controls,listeners,events}=fixtureEnvironment('?'+PREPARED_PATH.split('?')[1]);
  assert.equal(controls['f-name'].value,'');assert.equal(events.length,0);
  listeners.click();
  const filled=Object.entries(controls).filter(([id,c])=>id.startsWith('f-')&&c.value);
  assert.equal(filled.length,20);assert.equal(events.length,40);
  assert.equal(controls['f-email'].value,'karan@farpointenergy.com');
  assert.equal(controls['f-configuration'].value,'FP-MPT-138-50');
  assert.equal(controls['f-source'].value,'');assert.equal(controls['f-campaign'].value,'');
  assert.match(controls['preview-fill-status'].textContent,/Nothing has been submitted/);
  assert.match(controls['f-reference'].value,/^FP-SYNTHETIC-REVIEW-/);
});
test('helper refuses unprepared or ambiguous query and in-flight form',()=>{
  for(const search of ['', '?source=website&campaign=power','?source=website&campaign=power&utm_medium=referral&utm_source=website','?source=website&source=website&campaign=power&utm_medium=referral']){
    const {controls,listeners}=fixtureEnvironment(search);
    assert.equal(controls['preview-fill'].disabled,true);assert.equal(listeners.click,undefined);
  }
  const {controls,listeners}=fixtureEnvironment('?'+PREPARED_PATH.split('?')[1]);
  controls['quote-form'].getAttribute=()=> 'true';listeners.click();
  assert.equal(controls['f-name'].value,'');
});
after(async()=>{
  const directory=process.env.FARPOINT_TEST_EVIDENCE_DIR||resolve(dirname(fileURLToPath(import.meta.url)),'../../../../farpoint-cf-artifacts');
  if(!isAbsolute(directory))throw new Error('Absolute test evidence directory required');
  await mkdir(directory,{recursive:true});
  const path=resolve(directory,'preview-unit-fixtures-'+randomUUID()+'.json');
  const evidence={scope:'Synthetic in-memory preview tests; no deployment or actual RFQ',created_at:new Date().toISOString(),manifest:built.manifest,buckets:buckets.map((b,index)=>({index,attempts:b.attempts,stored:[...b.objects].map(([key,v])=>({key,body_base64:v.bytes.toString('base64'),sha256:digest(v.bytes),options:v.options}))}))};
  await writeFile(path,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
  console.log('Preserved preview unit evidence: '+path);
});
