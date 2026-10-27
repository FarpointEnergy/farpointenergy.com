/* Local browser integration checks. External form submissions are always intercepted.
 * Requires Playwright plus its browser engines. Missing engines remain BLOCKED.
 * Evidence is append-only and defaults outside the repository.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile, mkdir, writeFile, appendFile} from 'node:fs/promises';
import {resolve, dirname, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash, randomUUID} from 'node:crypto';

const require=createRequire(import.meta.url);
const root=dirname(fileURLToPath(import.meta.url));
const runId=new Date().toISOString().replaceAll(':','-')+'-'+randomUUID();
const evidence=resolve(process.env.FARPOINT_BROWSER_EVIDENCE||resolve(root,'..','farpoint-browser-evidence'),runId);
await mkdir(evidence,{recursive:true});
let playwright;
try {playwright=require('playwright');}
catch {playwright=require(resolve(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||'/unavailable','playwright'));}
const contentTypes={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png'};
const server=createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    const file=resolve(root,'.'+(path==='/'?'/index.html':decodeURIComponent(path)));
    if(!file.startsWith(root+'/')){res.writeHead(403);res.end();return;}
    res.writeHead(200,{'Content-Type':contentTypes[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});
    res.end(await readFile(file));
  }catch {res.writeHead(404);res.end();}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
const origin='http://127.0.0.1:'+server.address().port;
const collector='https://collector.example.test/v1/events';
const report={run_id:runId,scope:'local browser integration; external RFQ and collector mocked',real_inbox_delivery_verified:false,live_collection_verified:false,font_mode:'external fonts blocked; system fallback',engines:[]};
const sentinel='SYNTHETIC-PRIVATE-FORM-'+randomUUID();

async function scenario(browser,name,mobile=false){
  const ctx=await browser.newContext({serviceWorkers:'block',...(mobile?{...playwright.devices['iPhone 13'],viewport:{width:390,height:844}}:{viewport:{width:1366,height:900}})});
  const payloads=[],batches=[],errors=[];
  let observationSequence=0;
  const observationPath=resolve(evidence,name+'-observations.jsonl');
  async function observe(kind,data){
    const record={sequence:observationSequence++,observed_at:new Date().toISOString(),kind,...data};
    await appendFile(observationPath,JSON.stringify(record)+'\n');
  }
  const bytesEvidence=body=>{const bytes=Buffer.from(body);return{body_base64:bytes.toString('base64'),body_bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};};
  let mode='rejected',collectorMode='ack';
  try{
  await observe('scenario_started',{name,mobile,external_requests_intercepted:true});
  await ctx.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin===origin){
      if(url.pathname==='/analytics-config.js'){
        await route.fulfill({contentType:'text/javascript',body:'window.farpointAnalyticsConfig='+JSON.stringify({enabled:true,endpoint:collector,privacy_disclosure_version:'1',synthetic:true,campaign_registry:{source:['browser-test'],medium:['email'],campaign:['qa-test']},referrer_domains:{}})+';'});return;
      }
      await route.continue();return;
    }
    if(req.url()===collector){
      if(req.method()==='OPTIONS') {await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Accept'}});return;}
      const body=req.postData()||'',requestId=randomUUID();batches.push(body);
      await observe('collector_request',{request_id:requestId,...bytesEvidence(req.postDataBuffer()||'')});
      if(collectorMode==='drop'){await observe('collector_response_dropped',{request_id:requestId});await route.abort('failed');return;}
      const ack=JSON.stringify({status:'retained',terminal:true,receipt_id:randomUUID(),receipt_body_sha256:createHash('sha256').update(body).digest('hex'),analytical_status:'not_evaluated'});
      await observe('collector_response',{request_id:requestId,status:202,...bytesEvidence(ack)});
      await route.fulfill({status:202,contentType:'application/json',headers:{'Access-Control-Allow-Origin':origin},body:ack});return;
    }
    if(url.hostname==='formsubmit.co'){
      if(req.method()==='OPTIONS') {await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Accept'}});return;}
      const requestId=randomUUID();
      await observe('form_request',{request_id:requestId,...bytesEvidence(req.postDataBuffer()||'')});
      payloads.push(JSON.parse(req.postData()||'{}'));
      if(mode==='network'){await observe('form_response_dropped',{request_id:requestId});await route.abort('failed');return;}
      const body=mode==='malformed'?'not JSON':JSON.stringify({success:mode==='accepted'}),status=mode==='rejected'?422:200;
      await observe('form_response',{request_id:requestId,status,...bytesEvidence(body)});
      await route.fulfill({status,headers:{'Access-Control-Allow-Origin':origin},contentType:mode==='malformed'?'text/plain':'application/json',body});return;
    }
    // No unrelated external request, email or native provider POST can escape.
    await route.abort('blockedbyclient');
  });
  const page=await ctx.newPage();page.on('pageerror',err=>errors.push(err.message));
  const target=origin+'/quote.html?product=power&reference=FP-MPT-138-50&utm_source=browser-test&utm_medium=email&utm_campaign=qa-test';
  await page.goto(target);await page.waitForFunction(()=>window.farpointTracker?.enabled===true);
  assert.equal(await page.locator('#f-configuration').inputValue(),'FP-MPT-138-50');
  assert.equal(await page.locator('details.optional-fields').evaluate(e=>e.open),false);
  assert.equal(await page.locator('details.optional-fields [required]').count(),0);
  const mail=page.locator('header a[href^="mailto:quotes@farpointenergy.com"]');
  assert.equal(await mail.count(),1);
  assert.equal(await mail.evaluate(e=>Boolean(e.compareDocumentPosition(document.querySelector('#quote-form'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
  const offer=page.locator('header p.sub');
  assert.equal(await offer.textContent(),'Send your specification or project outline. Farpoint will prepare a proposal covering price, scope, proposed delivery and any technical exceptions. Include your required site date if known.');
  assert.equal(await offer.evaluate(e=>Boolean(e.compareDocumentPosition(document.querySelector('#quote-form'))&Node.DOCUMENT_POSITION_FOLLOWING)),true);
  for(const width of [320,390,768,1366]){
    await page.setViewportSize({width,height:900});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true,`page overflow at ${width}`);
  }
  await page.setViewportSize(mobile?{width:390,height:844}:{width:1366,height:900});
  await page.screenshot({path:resolve(evidence,name+'-quote-opening.png'),fullPage:false});
  if(mobile){
    await page.locator('.navbtn').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('.navbtn').getAttribute('aria-expanded'),'true');
    await page.keyboard.press('Escape');assert.equal(await page.locator('.navbtn').getAttribute('aria-expanded'),'false');
    assert.equal(await page.locator('.navbtn').evaluate(e=>document.activeElement===e),true);
  }
  await page.locator('#f-name').fill('Synthetic Browser Test');
  await page.locator('#f-company').fill('Synthetic Farpoint QA');
  await page.locator('#f-email').fill('synthetic@example.test');
  await page.locator('#f-requirement').fill(sentinel);
  await page.locator('details.optional-fields summary').focus();await page.keyboard.press('Enter');
  assert.equal(await page.locator('details.optional-fields').evaluate(e=>e.open),true);
  await page.locator('#f-rating').fill('50');await page.locator('#f-rating-unit').selectOption('MVA');
  await page.locator('#f-primary').fill('138');await page.locator('#f-secondary').fill('34.5');
  await page.locator('#f-quantity').fill('2');await page.locator('#f-reference').fill('SYNTHETIC-BROWSER-QA');
  await page.locator('#f-details').fill('Synthetic detail '+sentinel);
  await page.locator('#f-configuration').selectOption('FP-MPT-115-100');
  assert.equal(await page.locator('#f-rating').inputValue(),'50');
  assert.equal(await page.locator('#f-primary').inputValue(),'138');
  await page.locator('#quote-submit').click();
  await page.locator('#quote-status[data-state="failed"]').waitFor();
  assert.equal(await page.locator('#quote-status a').getAttribute('href'),'mailto:quotes@farpointenergy.com');
  assert.equal(await page.locator('#f-requirement').inputValue(),sentinel);
  assert.equal(await page.locator('#f-name').isEnabled(),true);
  const first=payloads.at(-1);assert.ok(first['Farpoint inquiry ID']);assert.ok(first['Farpoint session ID']);
  assert.equal(first['Power-transformer reference configuration'],'FP-MPT-115-100');
  assert.equal(first['Rating value'],'50');assert.equal(first['Requirement or specification link'],sentinel);
  mode='malformed';await page.locator('#quote-submit').click();await page.locator('#quote-status[data-state="uncertain"]').waitFor();
  assert.equal(payloads.at(-1)['Farpoint inquiry ID'],first['Farpoint inquiry ID']);
  assert.equal(await page.locator('#f-requirement').inputValue(),sentinel);
  assert.equal(await page.locator('#quote-status a').getAttribute('href'),'mailto:quotes@farpointenergy.com');
  await page.screenshot({path:resolve(evidence,name+'-quote-failure.png'),fullPage:true});
  mode='network';await page.locator('#quote-submit').click();await page.locator('#quote-status[data-state="uncertain"]').waitFor();
  assert.equal(payloads.at(-1)['Farpoint inquiry ID'],first['Farpoint inquiry ID']);
  mode='accepted';await page.locator('#quote-submit').click();await page.waitForURL('**/thanks.html');
  assert.equal(await page.locator('#thanks-heading').textContent(),'Your request was submitted.');
  await page.evaluate(()=>window.farpointTracker.flush());
  const events=batches.flatMap(raw=>JSON.parse(raw).events);
  for(const type of ['quotation_view','reference_select','quotation_start','technical_details_open','quotation_attempt','quotation_transport_error','quotation_provider_accepted'])assert.ok(events.some(e=>e.event_name===type),`missing ${type}`);
  assert.equal(batches.some(raw=>raw.includes(sentinel)),false);
  assert.equal(events.filter(e=>e.event_name==='quotation_attempt').every(e=>e.inquiry_id===first['Farpoint inquiry ID']),true);
  // Lost responses retain a real localStorage backlog across reload, then ACK clears.
  collectorMode='drop';await page.goto(origin+'/products.html');await page.waitForFunction(()=>window.farpointTracker.pendingCount()>0);
  const pending=await page.evaluate(()=>Array.from({length:localStorage.length},(_,i)=>localStorage.key(i)).filter(k=>k.startsWith('farpoint-event-v1:')));
  await page.reload();
  assert.equal(await page.evaluate(keys=>keys.every(k=>localStorage.getItem(k)!==null),pending),true);
  collectorMode='ack';await page.evaluate(()=>window.farpointTracker.flush());
  await page.waitForFunction(()=>window.farpointTracker.pendingCount()===0);
  assert.deepEqual(errors,[]);
  const result={scenario:name,status:'PASS',viewport_equivalent:mobile?'iPhone 13 WebKit/Chromium emulation; not real iOS':'desktop',mock_form_attempts:payloads.length,event_types:[...new Set(events.map(e=>e.event_name))],checks:['responsive overflow 320/390/768/1366','offer/email precede form','optional technical accordion','reference retains entered electrical values','rejected/malformed/network errors retain fields and clickable email','stable retry inquiry correlation','explicit success only','no form sentinels in analytics','outbox reload/retry']};
  await observe('scenario_passed',{result});
  return result;
  }catch(err){
    await observe('scenario_failed',{reason:String(err.stack||err)});
    for(const [i,page] of ctx.pages().entries()){
      try{await page.screenshot({path:resolve(evidence,`${name}-failure-${i}.png`),fullPage:true,timeout:5000});}catch{}
    }
    throw err;
  }finally{
    await observe('scenario_finished',{mock_form_attempts:payloads.length,collector_request_count:batches.length,page_errors:errors});
    await ctx.close();
  }
}

try{
  const names=(process.env.FARPOINT_BROWSER_ENGINES||'chromium,webkit,firefox').split(',');
  for(const name of names){
    console.log('Checking browser engine:',name);
    let browser;
    try{browser=await playwright[name].launch({headless:true,timeout:20000});}
    catch(err){report.engines.push({engine:name,status:'BLOCKED',reason:String(err.message)});console.log(name,'BLOCKED');continue;}
    try{
      const desktop=await scenario(browser,name+'-desktop');
      const scenarios=[desktop];
      if(name==='webkit'||name==='chromium')scenarios.push(await scenario(browser,name+'-mobile',true));
      report.engines.push({engine:name,version:browser.version(),status:'PASS',scenarios});
    }catch(err){
      const reason=String(err.stack||err);
      const hostBlocked=reason.includes('browserContext.newPage')&&reason.includes('Sandbox: writing /proc/self/uid_map: EPERM');
      report.engines.push({engine:name,version:browser.version(),status:hostBlocked?'BLOCKED':'FAIL',reason});
      if(!hostBlocked){
        for(const [i,ctx] of browser.contexts().entries())for(const [j,page] of ctx.pages().entries()){
          try{await page.screenshot({path:resolve(evidence,`${name}-failure-${i}-${j}.png`),fullPage:true,timeout:5000});}catch{}
        }
      }
    }
    finally{await browser.close();}
  }
}finally{server.closeAllConnections();server.close();}
await writeFile(resolve(evidence,'results.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({evidence,...report},null,2));
process.exitCode=report.engines.some(e=>e.status==='FAIL')?1:report.engines.some(e=>e.status==='BLOCKED')?2:0;
