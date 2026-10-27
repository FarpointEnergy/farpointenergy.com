/* Isolated browser acceptance fixture. No external collector or RFQ is called. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createServer as createHttpsServer} from 'node:https';
import {appendFile, mkdir, mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
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
  return {directory,origin,endpoint,requests,providerRequests,errors,observe,save,attach,
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
