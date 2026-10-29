/* Isolated browser acceptance fixture. No external collector or RFQ is called. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {appendFile, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {createHash,randomUUID,X509Certificate} from 'node:crypto';
import {tmpdir} from 'node:os';
import {dirname, extname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const repositoryRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const byteEvidence=value=>{const bytes=Buffer.from(value);return {body_base64:bytes.toString('base64'),body_bytes:bytes.length,sha256:hash(bytes)};};
export const formSentinel='SYNTHETIC-ACCEPTANCE-NO-CUSTOMER-DATA';
export const publicFiles=new Set(['index.html','products.html','applications.html','manufacturing.html','quality.html','delivery.html','quote.html','about.html','privacy.html','thanks.html','404.html','power-transformers.html','distribution-transformers.html','data-centers.html','solar-storage.html','markets.html','contact.html','style.css','site.js','inquiry.js','tracker.js','analytics-config.js','favicon.svg','og-image.png']);
const types={'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp'};
let tlsPromise;
async function tlsOptions(){
  if(!tlsPromise)tlsPromise=(async()=>{
    const directory=await mkdtemp(resolve(tmpdir(),'farpoint-acceptance-tls-'));
    const key=resolve(directory,'key.pem'),cert=resolve(directory,'cert.pem');
    execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=IP:127.0.0.1,DNS:localhost'],{stdio:'pipe'});
    return {key:await readFile(key),cert:await readFile(cert)};
  })();
  return tlsPromise;
}
export async function until(predicate,label,timeout=20000){
  const deadline=Date.now()+timeout;
  while(!await predicate()){
    assert.ok(Date.now()<deadline,'Timed out: '+label);
    await new Promise(done=>setTimeout(done,20));
  }
}
export function classifyRequest(url,origin,endpoint){
  const parsed=new URL(url);
  if(parsed.origin===origin)return 'local';
  if(url===endpoint)return 'collector';
  if(parsed.protocol==='https:'&&parsed.hostname==='formsubmit.co'&&['/ajax/quotes@farpointenergy.com','/quotes@farpointenergy.com'].includes(parsed.pathname))return 'mock_provider';
  return 'blocked_external';
}

export async function createFixture({evidence,name,enabled=true,trackerMode='normal',beforeCollectorDecision=async()=>{}}){
  const directory=resolve(evidence,name);await mkdir(directory,{recursive:true});
  let sequence=0,journal=Promise.resolve(),collectorMode='ack',providerMode='rejected',gateRelease,closing=false,closePromise;
  const gate=new Promise(done=>{gateRelease=done;});
  const errors=[],requests=[],providerRequests=[],holds=new Map(),tasks=new Set(),observationCounts=new Map();
  const observe=(kind,detail={})=>{
    observationCounts.set(kind,(observationCounts.get(kind)||0)+1);
    const row={sequence:sequence++,observed_at:new Date().toISOString(),kind,...detail};
    journal=journal.then(()=>appendFile(resolve(directory,'observations.jsonl'),JSON.stringify(row)+'\n'));
    return journal;
  };
  const save=async(name,value)=>writeFile(resolve(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
  let origin,endpoint;
  const config=()=>({enabled,endpoint,privacy_disclosure_version:'1',synthetic:true,campaign_registry:{source:['browser-acceptance'],medium:['test'],campaign:['acceptance']},referrer_domains:{}});
  const staticServer=createServer((req,res)=>{
    const task=(async()=>{
      const path=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
      const headers={'Cache-Control':'no-store'};
      if(path==='/blank.html'){res.writeHead(200,{...headers,'Content-Type':'text/html'});res.end('<!doctype html><title>Isolated storage setup</title><body>Local synthetic fixture</body>');return;}
      if(path==='/analytics-config.js'){res.writeHead(200,{...headers,'Content-Type':'text/javascript'});res.end('window.farpointAnalyticsConfig='+JSON.stringify(config())+';');return;}
      const relative=path==='/'?'index.html':path.slice(1);
      if(!publicFiles.has(relative)&&!/^assets\/[a-zA-Z0-9_./-]+$/.test(relative)){res.writeHead(404);res.end();return;}
      const file=resolve(repositoryRoot,relative);
      if(!file.startsWith(repositoryRoot+'/')){res.writeHead(403);res.end();return;}
      let bytes=await readFile(file);
      if(relative==='tracker.js'){
        if(trackerMode==='absent')bytes=Buffer.from('/* Baseline: tracker absent. Other site assets are unchanged. */');
        if(trackerMode==='startup_exception')bytes=Buffer.from('throw new Error("SYNTHETIC_TRACKER_STARTUP_EXCEPTION");');
        if(trackerMode==='held')await gate;
      }
      res.writeHead(200,{...headers,'Content-Type':types[extname(file)]||'application/octet-stream'});res.end(bytes);
    })().catch(error=>{if(error.code==='ENOENT'){res.writeHead(404);res.end();}else{errors.push(String(error.stack||error));res.destroy();}});
    tasks.add(task);void task.finally(()=>tasks.delete(task));
  });
  await new Promise(done=>staticServer.listen(0,'127.0.0.1',done));origin='http://127.0.0.1:'+staticServer.address().port;
  const collector=createHttpsServer(await tlsOptions(),(req,res)=>{
    const task=(async()=>{
      res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Accept');
      if(req.url!=='/v1/events'){res.writeHead(404);res.end();return;}
      if(req.method==='OPTIONS'){await observe('collector_preflight',{origin:req.headers.origin||null});res.writeHead(204);res.end();return;}
      const request_id=randomUUID(),chunks=[];
      try{for await(const chunk of req)chunks.push(chunk);}
      catch(error){await observe('collector_incomplete',{request_id,...byteEvidence(Buffer.concat(chunks)),reason:String(error)});throw error;}
      const bytes=Buffer.concat(chunks),record={request_id,method:req.method,accept:req.headers.accept||null,content_type:req.headers['content-type']||null,...byteEvidence(bytes)};
      requests.push(record);await observe('collector_request',record);
      // A test-only scheduling hook makes close-versus-inflight races repeatable.
      await beforeCollectorDecision(record);
      const respond=async()=>{
        const ack=Buffer.from(JSON.stringify({status:'retained',terminal:true,receipt_id:randomUUID(),receipt_body_sha256:record.sha256,analytical_status:'not_evaluated'}));
        await observe('collector_ack',{request_id,status:202,...byteEvidence(ack)});record.acknowledged=true;
        res.writeHead(202,{'Content-Type':'application/json'});res.end(ack);
      };
      if(closing||collectorMode==='drop'){
        await observe('collector_response_dropped',{request_id,reason:closing?'fixture_closing':'controlled_transport_failure'});res.destroy();return;
      }
      if(collectorMode==='hold'){
        let done;const heldDone=new Promise(resolve=>{done=resolve;});
        // Register synchronously before yielding to the journal. close() cannot
        // miss a hold whose request was already admitted before closing began.
        holds.set(request_id,{respond:async()=>{await respond();done();},drop:async()=>{await observe('collector_response_dropped',{request_id,reason:'fixture_teardown'});res.destroy();done();}});
        await observe('collector_response_held',{request_id});
        await heldDone;
        return;
      }
      await respond();
    })().catch(error=>{errors.push(String(error.stack||error));res.destroy();});
    tasks.add(task);void task.finally(()=>tasks.delete(task));
  });
  await new Promise(done=>collector.listen(0,'127.0.0.1',done));endpoint='https://127.0.0.1:'+collector.address().port+'/v1/events';
  await observe('fixture_started',{name,scope:'loopback HTTP website and HTTPS collector; all RFQs mocked',enabled,tracker_mode:trackerMode,origin,endpoint});
  async function attach(context,{blockTracker=false,blockCollector=false}={}){
    await context.route('**/*',async route=>{
      const request=route.request(),url=new URL(request.url()),kind=classifyRequest(request.url(),origin,endpoint);
      try{
        if(kind==='local'){
          if(blockTracker&&url.pathname==='/tracker.js'){await observe('tracker_blocked');await route.abort('blockedbyclient');return;}
          await route.continue();return;
        }
        if(kind==='collector'){
          if(blockCollector){await observe('collector_blocked',{method:request.method()});await route.abort('blockedbyclient');return;}
          await route.continue();return;
        }
        if(kind==='mock_provider'){
          if(request.method()==='OPTIONS'){await route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type, Accept'}});return;}
          assert.equal(request.method(),'POST');const raw=request.postDataBuffer(),request_id=randomUUID();
          if(raw===null){await observe('provider_body_unavailable',{request_id});throw Error('Provider request bytes unavailable');}
          const ajax=url.pathname.startsWith('/ajax/');
          const record={request_id,ajax,...byteEvidence(raw)};providerRequests.push(record);await observe('mock_provider_request',record);
          const values=ajax?JSON.parse(raw.toString('utf8')):Object.fromEntries(new URLSearchParams(raw.toString('utf8')));
          record.values=values;await observe('mock_provider_payload_parsed',{request_id,values});
          const body=Buffer.from(ajax?JSON.stringify({success:providerMode==='accepted'}):'<!doctype html><title>Synthetic interception</title><h1>Native synthetic POST intercepted</h1>');
          await observe('mock_provider_response',{request_id,status:200,...byteEvidence(body)});
          await route.fulfill({status:200,contentType:ajax?'application/json':'text/html',headers:{'Access-Control-Allow-Origin':origin},body});return;
        }
        await observe('external_request_blocked',{url:request.url(),method:request.method()});await route.abort('blockedbyclient');
      }catch(error){errors.push(String(error.stack||error));await observe('route_error',{reason:String(error)});await route.abort('failed').catch(()=>{});}
    });
  }
  const certificateSpki=createHash('sha256').update(new X509Certificate((await tlsOptions()).cert).publicKey.export({type:'spki',format:'der'})).digest('base64');
  return {directory,origin,endpoint,certificateSpki,requests,providerRequests,errors,observe,save,attach,
    observedCount(kind){return observationCounts.get(kind)||0;},
    set collectorMode(value){assert(['ack','drop','hold'].includes(value));collectorMode=value;},
    set providerMode(value){assert(['accepted','rejected'].includes(value));providerMode=value;},
    releaseTracker(){gateRelease();},
    async release(request_id){const held=holds.get(request_id);assert(held,'Missing held request');holds.delete(request_id);await held.respond();},
    heldIds(){return [...holds.keys()];},
    events(){return requests.flatMap(r=>JSON.parse(Buffer.from(r.body_base64,'base64')).events||[]);},
    async close(){
      if(closePromise)return closePromise;
      closing=true;
      closePromise=(async()=>{
        let timer;
        const cleanup=(async()=>{
          gateRelease();for(const [id,held] of holds){holds.delete(id);await held.drop();}
          for(const server of [staticServer,collector]){server.closeAllConnections();await new Promise(done=>server.close(done));}
          await Promise.allSettled([...tasks]);
        })();
        try{await Promise.race([cleanup,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Fixture drain timed out')),10000);})]);}
        catch(error){errors.push(String(error));for(const server of [staticServer,collector]){server.closeAllConnections();server.unref();}}
        finally{clearTimeout(timer);}
        await observe('fixture_finished',{errors});await journal;
        assert.deepEqual(errors,[],'Fixture had unexpected errors');
      })();
      return closePromise;
    }
  };
}

export async function outbox(page){return page.evaluate(()=>Object.fromEntries(Object.keys(localStorage).filter(k=>k.startsWith('farpoint-event-v1:')).sort().map(k=>[k,localStorage.getItem(k)])));}
export async function fillMinimal(page){
  await page.locator('#f-name').fill('Synthetic Acceptance Test');await page.locator('#f-company').fill('Synthetic Farpoint QA');
  await page.locator('#f-email').fill('synthetic@example.test');await page.locator('#f-requirement').fill(formSentinel);
}
export async function rejectAndCheckForm(page,fixture){
  await fillMinimal(page);fixture.providerMode='rejected';await page.locator('#quote-submit').click();
  await page.locator('#quote-status[data-state="failed"]').waitFor();
  assert.equal(await page.locator('#f-requirement').inputValue(),formSentinel);
  assert.equal(await page.locator('#quote-status a').getAttribute('href'),'mailto:quotes@farpointenergy.com');
  assert.equal(await page.locator('#f-name').isEnabled(),true);
}
export async function seedBacklog(page,count){
  return page.evaluate(count=>{
    const browser=crypto.randomUUID(),session=crypto.randomUUID(),at=new Date().toISOString(),records={};
    localStorage.setItem('farpoint-browser-v1',browser);localStorage.setItem('farpoint-session-v1',JSON.stringify({id:session,at:Date.now(),campaign:{}}));
    for(let sequence=0;sequence<count;sequence++){
      const event={schema_version:1,event_id:crypto.randomUUID(),browser_id:browser,session_id:session,client_timestamp:at,sequence,event_name:'page_view',page_id:'quote',tracker_version:'1.0.0',referrer_category:'direct_unknown',storage_status:'persistent',synthetic:true};
      const key='farpoint-event-v1:'+event.event_id;records[key]=JSON.stringify(event);localStorage.setItem(key,records[key]);
    }
    return records;
  },count);
}

// Runs inside a disposable browser context. Uses fresh keys exclusively and
// progressively fills residual slack, rather than confusing a large failed
// allocation with an inability to store one small event.
export function fillStorageQuota(storage=window.localStorage){
  const maximumAttemptedUtf16Bytes=32*1024*1024,stages=[];
  let sequence=0,attemptedBytes=0,acceptedBytes=0,inserted=0,full=false;
  for(const chars of [64*1024,1024,16,1]){
    const stage={chars,attempts:0,inserted:0,first_sequence:sequence,exception:null};
    for(let attempt=0;attempt<512;attempt++){
      const key='synthetic-quota-filler-'+sequence++,value='x'.repeat(chars),bytes=2*(key.length+value.length);
      if(attemptedBytes+bytes>maximumAttemptedUtf16Bytes)break;
      if(storage.getItem(key)!==null)throw Error('Quota fixture refuses to overwrite an existing key');
      attemptedBytes+=bytes;stage.attempts++;
      try{storage.setItem(key,value);inserted++;stage.inserted++;acceptedBytes+=bytes;}
      catch(error){stage.exception={name:error.name,message:error.message};if(error.name!=='QuotaExceededError')throw error;break;}
    }
    stages.push(stage);
    if(chars===1&&stage.exception?.name==='QuotaExceededError')full=true;
  }
  return {inserted,stages,attempted_utf16_bytes:attemptedBytes,accepted_utf16_bytes:acceptedBytes,maximum_attempted_utf16_bytes:maximumAttemptedUtf16Bytes,smallest_new_item_refused:full};
}

export function ownedProcessChain(pid,ancestor=process.pid,readStat=id=>readFileSync('/proc/'+id+'/stat','utf8')){
  const chain=[];
  for(let depth=0;depth<64;depth++){
    assert(Number.isSafeInteger(pid)&&pid>0,'Window PID must be a positive integer');
    assert(!chain.includes(pid),'Process ancestry contains a cycle');chain.push(pid);
    if(pid===ancestor)return chain;
    const text=readStat(pid),tail=text.slice(text.lastIndexOf(')')+2).split(' ');
    assert(text.includes(')')&&tail.length>=2,'Malformed Linux process record');pid=Number(tail[1]);
  }
  throw Error('Window process is not a descendant of this test runner');
}

export async function minimizeOwnedTestWindow(page,observe){
  // These commands run only in the isolated CI Xvfb display. The active window
  // must be this runner's child browser and visibly contain the fixture page.
  const command=args=>execFileSync('xdotool',args,{encoding:'utf8',timeout:5000}).trim();
  await page.bringToFront();await page.waitForFunction(()=>document.hasFocus());
  const windowId=command(['getactivewindow']);assert(/^\d+$/.test(windowId));
  const title=command(['getwindowname',windowId]);await observe('active_window_title_observed',{window_id:windowId,title});
  assert(title.startsWith('Request a quotation — Farpoint Energy'),'Active window is not the fixture quotation page');
  const pid=Number(command(['getwindowpid',windowId])),ancestry=ownedProcessChain(pid);
  const state=()=>execFileSync('xprop',['-id',windowId,'WM_STATE','_NET_WM_STATE'],{encoding:'utf8',timeout:5000}).trim();
  await observe('owned_window_before_minimize',{window_id:windowId,title,pid,ancestry,window_manager_state:state()});
  command(['windowminimize',windowId]);
  await observe('owned_window_minimize_requested',{window_id:windowId,pid,window_manager_state:state()});
  await until(()=>/Iconic|_NET_WM_STATE_HIDDEN/.test(state()),'owned native window reports minimized',5000);
  await observe('owned_window_minimized',{window_id:windowId,pid,window_manager_state:state()});
  return async()=>{
    assert.equal(Number(command(['getwindowpid',windowId])),pid,'Owned test window changed');ownedProcessChain(pid);
    command(['windowmap','--sync',windowId,'windowactivate','--sync',windowId]);
    await observe('owned_window_restored',{window_id:windowId,pid,window_manager_state:state()});
  };
}

export function nativeChromiumArguments(profile,certificateSpki){
  assert(profile.startsWith('/'),'Native browser requires a fresh absolute profile path');
  assert(/^[A-Za-z0-9+/]{43}=$/.test(certificateSpki),'Collector certificate SPKI must be a SHA-256 digest');
  return ['--remote-debugging-address=127.0.0.1','--remote-debugging-port=0','--user-data-dir='+profile,
    '--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-default-apps','--disable-extensions','--disable-component-extensions-with-background-pages',
    '--no-sandbox','--disable-dev-shm-usage','--window-size=1366,900','--ignore-certificate-errors-spki-list='+certificateSpki,'about:blank'];
}

export async function launchNativeChromium(playwright,fixture){
  // A new owned process/profile avoids any pre-existing Playwright focus
  // override. noDefaults is a documented connectOverCDP option. No user
  // browser, driver patch, DOM visibility override or public endpoint is used.
  const profile=await mkdtemp(resolve(tmpdir(),'farpoint-native-owned-profile-'));
  const args=nativeChromiumArguments(profile,fixture.certificateSpki);
  const paths={stdout:resolve(fixture.directory,'native-browser.stdout.txt'),stderr:resolve(fixture.directory,'native-browser.stderr.txt')};
  for(const path of Object.values(paths))await writeFile(path,'',{flag:'wx'});
  let journal=Promise.resolve(),launchError,exitResult,closePromise;
  const child=spawn(playwright.chromium.executablePath(),args,{stdio:['ignore','pipe','pipe']});
  child.once('error',error=>{launchError=error;});
  const exited=new Promise(done=>child.once('close',(code,signal)=>{exitResult={code,signal};done(exitResult);}));
  for(const stream of ['stdout','stderr'])child[stream].on('data',bytes=>{
    journal=journal.then(()=>appendFile(paths[stream],bytes));void journal.catch(()=>{});
  });
  async function closeProcess(){
    if(closePromise)return closePromise;
    closePromise=(async()=>{
      let timer;
      if(!exitResult){child.kill('SIGTERM');
        try{await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Native browser graceful close timed out')),5000);})]);}
        catch{child.kill('SIGKILL');await Promise.race([exited,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Owned native browser did not exit')),5000);})]);}
        finally{clearTimeout(timer);}
      }
      await journal;await fixture.observe('native_browser_closed',{pid:child.pid,exit:exitResult});
    })();return closePromise;
  }
  try{
    await fixture.observe('native_browser_started',{pid:child.pid,executable:playwright.chromium.executablePath(),args,context:'fresh owned profile; noDefaults true; original installed browser/driver bytes'});
    await until(()=>{
      try{return /window id # 0x[1-9a-f]/i.test(execFileSync('xprop',['-root','_NET_SUPPORTING_WM_CHECK'],{encoding:'utf8',timeout:1000}));}catch{return false;}
    },'owned display window manager readiness',5000);
    let port;
    await until(async()=>{
      if(launchError)throw launchError;if(exitResult)throw Error('Native browser exited before CDP became ready');
      try{const text=await readFile(resolve(profile,'DevToolsActivePort'),'utf8');port=Number(text.split('\n')[0]);return Number.isSafeInteger(port)&&port>0&&port<=65535;}catch(error){if(error.code==='ENOENT')return false;throw error;}
    },'owned native Chromium debugging endpoint',20000);
    const browser=await playwright.chromium.connectOverCDP('http://127.0.0.1:'+port,{noDefaults:true,isLocal:true,timeout:15000});
    const contexts=browser.contexts();assert.equal(contexts.length,1,'Fresh native browser must have one default context');
    await fixture.observe('native_default_context_attached',{browser_version:browser.version(),no_defaults:true,pages:contexts[0].pages().map(page=>page.url()),service_worker_urls:contexts[0].serviceWorkers().map(worker=>worker.url())});
    assert.equal(contexts[0].serviceWorkers().length,0,'Fresh profile must not contain a service worker');
    return {browser,context:contexts[0],closeProcess};
  }catch(error){await closeProcess();throw error;}
}
