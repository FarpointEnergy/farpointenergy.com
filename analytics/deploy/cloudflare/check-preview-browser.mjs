/* Preview browser integration. All FormSubmit traffic is intercepted; no RFQ is sent. */
import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile,appendFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {buildPreview,PREVIEW_ORIGIN,PREPARED_PATH} from './build-preview-worker.mjs';
const require=createRequire(import.meta.url);
let playwright;
try {playwright=require('playwright');}
catch {playwright=require(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/unavailable','playwright'));}
const destination=process.argv[2];
if(!destination?.startsWith('/'))throw new Error('Absolute evidence root required');
const evidence=resolve(destination,'preview-browser-'+new Date().toISOString().replaceAll(':','-')+'-'+randomUUID());
await mkdir(evidence,{recursive:true});
const built=await buildPreview();
const worker=(await import('data:text/javascript;base64,'+Buffer.from(built.source).toString('base64'))).default;
const digest=x=>createHash('sha256').update(x).digest('hex');
const byteEvidence=value=>{const body=Buffer.from(value);return {body_base64:body.toString('base64'),body_bytes:body.length,sha256:digest(body)};};
const sourceFiles={};
for(const name of Object.keys(built.manifest.source_files))sourceFiles[name]=digest(await readFile(new URL('../../../'+name,import.meta.url)));
const report={scope:'local browser execution of generated synthetic review Worker; FormSubmit fully mocked; no real RFQ or external collector requests',real_inbox_delivery_verified:false,cloudflare_deployment_verified:false,worker_sha256:built.manifest.worker_sha256,engines:[]};
async function bounded(promise,ms,label){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' timed out')),ms);})]);}
  finally{clearTimeout(timer);}
}
const expectedKeys=['Name','Company','email','Requirement or specification link','Transformer category','Application','Power-transformer reference configuration','Quantity','Rating value','Rating unit','Primary voltage value','Primary voltage unit','Secondary voltage value','Secondary voltage unit','Required delivery to site','Target energization','Project location','Project or package reference','Phone','Additional information','Source','Campaign','Farpoint inquiry ID','Farpoint browser ID','Farpoint session ID','Farpoint campaign source','Farpoint campaign medium','Farpoint campaign code'].sort();
const expectedBusinessKeys=expectedKeys.filter(key=>!key.startsWith('Farpoint ')&&!['Source','Campaign'].includes(key));
class Bucket {
  records=[];
  constructor(observe){this.observe=observe;}
  async put(key,bytes,options){
    const record={key,...byteEvidence(bytes),options,etag:randomUUID()};
    await this.observe('bucket_put_attempt',record);
    assert.deepEqual(options.onlyIf,{etagDoesNotMatch:'*'});
    this.records.push(record);
    await this.observe('bucket_put_created',{key,sha256:record.sha256,etag:record.etag});
    return {etag:record.etag};
  }
}

async function scenario(engine,mobile){
  const name=engine+(mobile?'-mobile':'-desktop');
  const browser=await playwright[engine].launch({headless:true,timeout:15000});
  let context;
  try {context=await bounded(browser.newContext({serviceWorkers:'block',...(mobile?{...(engine==='firefox'?{}:playwright.devices['iPhone 13']),viewport:{width:390,height:844}}:{viewport:{width:1366,height:900}})}),15000,'browser context creation');}
  catch(error){await bounded(browser.close(),5000,'browser cleanup').catch(()=>{});throw error;}
  context.setDefaultTimeout(15000);context.setDefaultNavigationTimeout(15000);
  let observationSequence=0,journal=Promise.resolve();
  const observe=(kind,detail)=>{
    const record={sequence:observationSequence++,observed_at:new Date().toISOString(),kind,...detail};
    journal=journal.then(()=>appendFile(resolve(evidence,name+'-observations.jsonl'),JSON.stringify(record)+'\n'));
    return journal;
  };
  const checkpoint=async stage=>{await appendFile(resolve(evidence,name+'-steps.jsonl'),JSON.stringify({at:new Date().toISOString(),stage})+'\n');console.log(name+': '+stage);};
  const bucket=new Bucket(observe);const payloads=[];const denied=[];const errors=[];const routeErrors=[];let providerMode='rejected';
  await context.route('**/*',async route=>{
    const req=route.request();const url=new URL(req.url());
    const requestId=randomUUID();
    try{
      const method=req.method(),headers=await req.allHeaders(),raw=req.postDataBuffer();
      const needsBody=!['GET','HEAD','OPTIONS'].includes(method);
      await observe('intercepted_request',{request_id:requestId,url:req.url(),method,headers,body_status:raw!==null?'available':needsBody?'body_unavailable':'not_applicable',...(raw===null?{}:byteEvidence(raw))});
      if(needsBody&&raw===null){
        // WebKit can omit intercepted sendBeacon bytes. Never invent an empty
        // admitted body or ACK. The main HTTPS suite proves native delivery.
        await observe('request_aborted',{request_id:requestId,reason:'body_unavailable',collector_receipt_created:false});
        await route.abort('failed');return;
      }
      async function respond(status,responseHeaders,body,kind){
        await observe('intercepted_response',{request_id:requestId,response_kind:kind,status,headers:responseHeaders,...byteEvidence(body)});
        await route.fulfill({status,headers:responseHeaders,body:Buffer.from(body)});
        await observe('response_fulfilled',{request_id:requestId,status});
      }
      if(url.origin===PREVIEW_ORIGIN){
        const response=await worker.fetch(new Request(req.url(),{method,headers,...(needsBody?{body:raw}: {})}),{BUCKET:bucket});
        await respond(response.status,Object.fromEntries(response.headers),Buffer.from(await response.arrayBuffer()),url.pathname==='/v1/events'?'collector':'static');return;
      }
      if(req.url()==='https://formsubmit.co/ajax/quotes@farpointenergy.com'){
        if(method==='OPTIONS'){
          await respond(204,{'Access-Control-Allow-Origin':PREVIEW_ORIGIN,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'content-type, accept'},Buffer.alloc(0),'mock_provider_preflight');return;
        }
        assert.equal(method,'POST');
        payloads.push(JSON.parse(raw.toString('utf8')));
        await respond(200,{'Content-Type':'application/json','Access-Control-Allow-Origin':PREVIEW_ORIGIN},Buffer.from(JSON.stringify({success:providerMode==='accepted'?'true':'false',message:'Synthetic intercepted response only'})),'mock_provider');return;
      }
      denied.push({origin:url.origin,method});
      await observe('request_aborted',{request_id:requestId,reason:'unrelated_external_request'});
      await route.abort('blockedbyclient');
    }catch(error){
      routeErrors.push(error.message);
      await observe('route_error',{request_id:requestId,error:error.message});
      await route.abort('failed').catch(()=>{});
    }
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  const result={engine,mobile,viewport:mobile?'390x844':'1366x900'};
  try{
    await checkpoint('navigate');
    await page.goto(PREVIEW_ORIGIN+PREPARED_PATH);
    await checkpoint('page_loaded');
    await page.waitForFunction(()=>window.farpointTracker?.enabled===true);
    await checkpoint('tracker_enabled');
    assert.equal(payloads.length,0);
    assert.equal(await page.inputValue('#f-name'),'');
    assert.equal(await page.inputValue('#f-source'),'website');
    assert.equal(await page.inputValue('#f-campaign'),'power');
    assert.equal(await page.locator('details.optional-fields').getAttribute('open'),null);
    await page.locator('#preview-fill').click();
    await checkpoint('fixture_filled');
    assert.equal(payloads.length,0);
    assert.match(await page.locator('#preview-fill-status').textContent(),/Nothing has been submitted/);
    assert.equal(await page.inputValue('#f-email'),'karan@farpointenergy.com');
    assert.equal(await page.inputValue('#f-product'),'power');
    assert.equal(await page.inputValue('#f-configuration'),'FP-MPT-138-50');
    assert.equal(await page.locator('details.optional-fields').getAttribute('open'),null);
    const snapshot=await page.evaluate(()=>Object.fromEntries([...new FormData(document.getElementById('quote-form'))].filter(([key])=>!key.startsWith('_')&&!key.startsWith('Farpoint '))));
    await observe('filled_form_snapshot',{values:snapshot,...byteEvidence(JSON.stringify(snapshot))});
    const businessKeys=Object.keys(snapshot).filter(key=>!['Source','Campaign'].includes(key)).sort();
    assert.deepEqual(businessKeys,expectedBusinessKeys);
    for(const key of expectedBusinessKeys)assert.equal(typeof snapshot[key]==='string'&&snapshot[key].trim().length>0,true,'Empty business field: '+key);
    assert.equal(snapshot.Source,'website');assert.equal(snapshot.Campaign,'power');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:resolve(evidence,name+'-filled.png'),fullPage:true});
    await page.locator('#quote-submit').click();
    await checkpoint('mock_reject_requested');
    await page.waitForFunction(()=>document.getElementById('quote-status')?.dataset.state==='failed');
    assert.equal(payloads.length,1);
    const payload=payloads[0];
    assert.deepEqual(Object.keys(payload).filter(x=>!x.startsWith('_')).sort(),expectedKeys);
    for(const [key,value] of Object.entries(snapshot))assert.equal(payload[key],value,'Submitted value changed: '+key);
    assert.equal(payload.Source,'website');assert.equal(payload.Campaign,'power');
    assert.equal(payload['Farpoint campaign source'],'website');assert.equal(payload['Farpoint campaign medium'],'referral');assert.equal(payload['Farpoint campaign code'],'power');
    for(const key of ['Farpoint inquiry ID','Farpoint browser ID','Farpoint session ID'])assert.match(payload[key],/^[0-9a-f-]{36}$/i);
    assert.match(payload['Project or package reference'],/^FP-SYNTHETIC-REVIEW-/);
    const retainedSnapshot=await page.evaluate(()=>Object.fromEntries([...new FormData(document.getElementById('quote-form'))].filter(([key])=>!key.startsWith('_')&&!key.startsWith('Farpoint '))));
    await observe('failed_form_retained_snapshot',{values:retainedSnapshot,...byteEvidence(JSON.stringify(retainedSnapshot))});
    assert.deepEqual(retainedSnapshot,snapshot);
    assert.match(await page.locator('#quote-status').textContent(),/quotes@farpointenergy\.com/);
    assert.equal(await page.locator('#quote-status a').getAttribute('href'),'mailto:quotes@farpointenergy.com');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:resolve(evidence,name+'-provider-rejected.png'),fullPage:true});
    providerMode='accepted';
    await checkpoint('mock_accept_requested');
    await page.locator('#quote-submit').click();
    await page.waitForURL(PREVIEW_ORIGIN+'/thanks.html');
    assert.equal(payloads.length,2);assert.deepEqual(payloads[1],payload);
    assert.equal(await page.locator('#thanks-heading').textContent(),'Your request was submitted.');
    await page.waitForFunction(()=>window.farpointTracker?.enabled===true);
    await page.evaluate(()=>window.farpointTracker.flush());
    await page.waitForFunction(()=>window.farpointTracker.pendingCount()===0);
    assert.equal(errors.length,0);
    assert.deepEqual(routeErrors,[]);
    const events=bucket.records.flatMap(r=>{const receipt=JSON.parse(Buffer.from(r.body_base64,'base64'));return JSON.parse(Buffer.from(receipt.body_base64,'base64')).events||[];});
    assert(events.length>0);
    assert(events.every(e=>e.synthetic===true));
    assert(!JSON.stringify(events).includes('karan@farpointenergy.com'));
    assert(!JSON.stringify(events).includes('SYNTHETIC WEBSITE TEST'));
    const names=new Set(events.map(e=>e.event_name));
    for(const event of events)assert.equal(typeof event.event_name,'string');
    for(const expected of ['quotation_attempt','quotation_provider_accepted'])assert(names.has(expected),expected+' not retained');
    assert(bucket.records.every(r=>JSON.parse(Buffer.from(r.body_base64,'base64')).source_ip.status==='unavailable'));
    result.passed=true;result.mocked_provider_attempts=payloads.length;result.final_nonprovider_fields=Object.keys(payload).filter(x=>!x.startsWith('_')).length;result.synthetic_event_count=events.length;result.local_receipt_count=bucket.records.length;result.horizontal_overflow=false;result.page_errors=errors;
  }catch(error){result.passed=false;result.error=error.message;result.diagnostic=await page.evaluate(()=>({readyState:document.readyState,trackerPresent:Boolean(window.farpointTracker),trackerEnabled:window.farpointTracker?.enabled,config:window.farpointAnalyticsConfig,bodyText:document.body.innerText.slice(0,500)})).catch(()=>({unavailable:true}));throw error;}
  finally{
    await observe('scenario_result',{result});
    await writeFile(resolve(evidence,name+'-before-close.json'),JSON.stringify({result,payloads,receipts:bucket.records,blocked_external_requests:denied,page_errors:errors,route_errors:routeErrors},null,2)+'\n',{flag:'wx'});
    const cleanupErrors=[];
    await bounded(context.close(),5000,'context cleanup').catch(error=>cleanupErrors.push(error.message));
    await bounded(browser.close(),5000,'browser cleanup').catch(error=>cleanupErrors.push(error.message));
    await journal;
    const terminalErrors=[...cleanupErrors,...routeErrors.map(error=>'route: '+error),...errors.map(error=>'page: '+error)];
    if(terminalErrors.length){
      result.passed=false;
      result.teardown_errors=terminalErrors;
      result.error=result.error||terminalErrors.join('; ');
    }
    await writeFile(resolve(evidence,name+'-evidence.json'),JSON.stringify({result,payloads,receipts:bucket.records,blocked_external_requests:denied,page_errors:errors,route_errors:routeErrors,cleanup_errors:cleanupErrors},null,2)+'\n',{flag:'wx'});
    report.engines.push(result);
    if(terminalErrors.length)throw new Error(result.error);
  }
}
try{
  const requested=process.env.FARPOINT_PREVIEW_ENGINES;
  if(requested){
    for(const engine of requested.split(',')){
      if(!['chromium','webkit','firefox'].includes(engine))throw new Error('Unknown preview test engine');
      await scenario(engine,false);await scenario(engine,true);
    }
  }else{
    await scenario('chromium',false);await scenario('webkit',true);
  }
  for(const [name,expected] of Object.entries(sourceFiles))assert.equal(digest(await readFile(new URL('../../../'+name,import.meta.url))),expected,'Source asset changed: '+name);
  report.passed=true;
}catch(error){report.passed=false;report.error=error.message;process.exitCode=1;}
finally{
  await writeFile(resolve(evidence,'summary.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({evidence,...report}));
}
