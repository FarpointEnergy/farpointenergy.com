import test from 'node:test';
import assert from 'node:assert/strict';
import {request as httpsRequest} from 'node:https';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {classifyRequest,createFixture,fillStorageQuota,ownedProcessChain,nativeChromiumArguments,hash,until,repositoryRoot} from './fixture.mjs';

const evidenceRoot=process.env.FARPOINT_ACCEPTANCE_EVIDENCE||resolve(repositoryRoot,'..','farpoint-browser-acceptance-unit-evidence');
await mkdir(evidenceRoot,{recursive:true});
const evidence=await mkdtemp(resolve(evidenceRoot,'fixture-tests-'));console.log('Fixture evidence:',evidence);
function send(endpoint,body,type='application/json'){
  return new Promise((done,reject)=>{
    // This one request targets the loopback fixture's ephemeral certificate.
    const req=httpsRequest(endpoint,{method:'POST',rejectUnauthorized:false,headers:{'Content-Type':type,'Content-Length':Buffer.byteLength(body)}},res=>{
      const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>done({status:res.statusCode,body:Buffer.concat(chunks)}));
    });req.on('error',reject);req.end(body);
  });
}
test('network classifier admits only loopback fixture and exact mocked provider paths',()=>{
  const origin='http://127.0.0.1:1234',endpoint='https://127.0.0.1:4321/v1/events';
  assert.equal(classifyRequest(origin+'/quote.html',origin,endpoint),'local');
  assert.equal(classifyRequest(endpoint,origin,endpoint),'collector');
  for(const path of ['/ajax/quotes@farpointenergy.com','/quotes@farpointenergy.com'])assert.equal(classifyRequest('https://formsubmit.co'+path,origin,endpoint),'mock_provider');
  for(const url of ['https://formsubmit.co.evil.test/ajax/quotes@farpointenergy.com','https://formsubmit.co@evil.test/quotes@farpointenergy.com','https://formsubmit.co/another-inbox@example.test',endpoint+'?changed=1','https://farpointenergy.com/quote.html'])assert.equal(classifyRequest(url,origin,endpoint),'blocked_external');
});
test('real local receiver journals exact bytes before emitting a hash-bound ACK',async()=>{
  const fixture=await createFixture({evidence,name:'ack'});
  try{
    const body=Buffer.from('{"events":[{"event_id":"synthetic","note":"é é"}]}');
    const response=await send(fixture.endpoint,body,'text/plain;charset=UTF-8');assert.equal(response.status,202);
    const ack=JSON.parse(response.body);assert.equal(ack.receipt_body_sha256,hash(body));assert.equal(fixture.requests[0].body_base64,body.toString('base64'));
    assert.equal(fixture.requests[0].acknowledged,true);
    await fixture.save('immutable.json',{value:1});await assert.rejects(fixture.save('immutable.json',{value:2}),{code:'EEXIST'});
    assert.equal(JSON.parse(await readFile(resolve(fixture.directory,'immutable.json'),'utf8')).value,1);
  }finally{await fixture.close();}
  const rows=(await readFile(resolve(fixture.directory,'observations.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(rows.map(r=>r.sequence),rows.map((_,i)=>i));
  assert(rows.findIndex(r=>r.kind==='collector_request')<rows.findIndex(r=>r.kind==='collector_ack'));
});
test('controlled dropped response retains raw request without ACK',async()=>{
  const fixture=await createFixture({evidence,name:'drop'});
  try{
    fixture.collectorMode='drop';const body=Buffer.from('{"events":[]}');
    await assert.rejects(send(fixture.endpoint,body));assert.equal(fixture.requests.length,1);assert.equal(fixture.requests[0].sha256,hash(body));assert.equal(fixture.requests[0].acknowledged,undefined);
  }finally{await fixture.close();}
});
test('held responses can finish out of order without changing request evidence',async()=>{
  const fixture=await createFixture({evidence,name:'out-of-order'});
  try{
    fixture.collectorMode='hold';let firstFinished=false;
    const first=send(fixture.endpoint,'{"events":[{"event_id":"first"}]}').then(value=>{firstFinished=true;return value;});
    await until(()=>fixture.heldIds().length===1,'first held');const firstId=fixture.heldIds()[0];
    const second=send(fixture.endpoint,'{"events":[{"event_id":"second"}]}');await until(()=>fixture.heldIds().length===2,'second held');const secondId=fixture.heldIds().find(id=>id!==firstId);
    await fixture.release(secondId);assert.equal((await second).status,202);assert.equal(firstFinished,false);
    await fixture.release(firstId);assert.equal((await first).status,202);
    assert.deepEqual(fixture.events().map(e=>e.event_id),['first','second']);
  }finally{await fixture.close();}
});
test('closing while a request awaits journaling cannot create a late held response',async()=>{
  let entered,release;
  const enteredGate=new Promise(done=>{entered=done;}),releaseGate=new Promise(done=>{release=done;});
  const fixture=await createFixture({evidence,name:'close-inflight',beforeCollectorDecision:async()=>{entered();await releaseGate;}});
  fixture.collectorMode='hold';const body=Buffer.from('{"events":[{"event_id":"inflight-close"}]}');
  const response=send(fixture.endpoint,body);const rejection=assert.rejects(response);
  await enteredGate;
  const closing=fixture.close();release();
  await closing;await rejection;
  assert.deepEqual(fixture.heldIds(),[]);assert.equal(fixture.requests[0].sha256,hash(body));assert.equal(fixture.requests[0].acknowledged,undefined);
  const rows=(await readFile(resolve(fixture.directory,'observations.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert(rows.some(row=>row.kind==='collector_response_dropped'&&row.reason==='fixture_closing'));
  assert(!rows.some(row=>row.kind==='collector_response_held'||row.kind==='collector_ack'));
});
test('closing drains an existing held response without an ACK or lost request',async()=>{
  const fixture=await createFixture({evidence,name:'close-held'});fixture.collectorMode='hold';
  const body=Buffer.from('{"events":[{"event_id":"held-close"}]}');
  const response=send(fixture.endpoint,body);const rejection=assert.rejects(response);
  await until(()=>fixture.heldIds().length===1,'held before close');await fixture.close();await rejection;
  assert.deepEqual(fixture.heldIds(),[]);assert.equal(fixture.requests[0].sha256,hash(body));assert.equal(fixture.requests[0].acknowledged,undefined);
});
test('malformed mocked provider JSON is journaled exactly before parse failure',async()=>{
  const fixture=await createFixture({evidence,name:'malformed-provider'});let handler,aborted=false;
  await fixture.attach({route:async(_pattern,value)=>{handler=value;}});
  const body=Buffer.from('{"malformed":"é"');
  await handler({
    request:()=>({url:()=> 'https://formsubmit.co/ajax/quotes@farpointenergy.com',method:()=> 'POST',postDataBuffer:()=>body}),
    abort:async()=>{aborted=true;},fulfill:async()=>{assert.fail('Malformed request must not be acknowledged');}
  });
  assert.equal(aborted,true);assert.equal(fixture.providerRequests[0].body_base64,body.toString('base64'));assert.equal(fixture.providerRequests[0].sha256,hash(body));
  await assert.rejects(fixture.close(),/Fixture had unexpected errors/);
  const rows=(await readFile(resolve(fixture.directory,'observations.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert(rows.findIndex(row=>row.kind==='mock_provider_request')<rows.findIndex(row=>row.kind==='route_error'));
  assert(!rows.some(row=>row.kind==='mock_provider_response'));assert.equal(rows.at(-1).kind,'fixture_finished');
});
test('quota filler consumes residual slack without overwriting existing event bytes',()=>{
  const values=new Map([['farpoint-event-v1:existing','{"exact":"original"}']]);
  const capacity=300000,storage={getItem:key=>values.get(key)??null,setItem(key,value){
    assert(!values.has(key),'Every filler key must be new');
    const bytes=[...values].reduce((n,[k,v])=>n+2*(k.length+v.length),0)+2*(key.length+value.length);
    if(bytes>capacity)throw Object.assign(new Error('Test quota exceeded'),{name:'QuotaExceededError'});
    values.set(key,value);
  }};
  const result=fillStorageQuota(storage);assert.equal(result.smallest_new_item_refused,true);
  assert(result.stages[0].exception);assert(result.stages.slice(1).some(stage=>stage.inserted>0),'Must consume slack after a large allocation fails');
  assert.equal(values.get('farpoint-event-v1:existing'),'{"exact":"original"}');
  assert.throws(()=>storage.setItem('farpoint-event-v1:new','{"synthetic_event":"must remain in memory"}'),{name:'QuotaExceededError'});
});
test('quota fixture does not claim full when its bounded allocation budget is exhausted',()=>{
  const values=new Map();const result=fillStorageQuota({getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)});
  assert.equal(result.smallest_new_item_refused,false);assert(result.attempted_utf16_bytes<=32*1024*1024);
});
test('window ownership guard permits only descendants of this runner and rejects malformed ancestry',()=>{
  const parents=new Map([[301,201],[201,101],[900,1],[1,0]]);
  const read=id=>`${id} (test process (nested)) S ${parents.get(id)} 0 0`;
  assert.deepEqual(ownedProcessChain(301,101,read),[301,201,101]);
  assert.throws(()=>ownedProcessChain(900,101,read));
  assert.throws(()=>ownedProcessChain(301,101,()=> 'malformed process record'));
  assert.throws(()=>ownedProcessChain(301,101,id=>`${id} (cycle) S ${id} 0 0`));
});
test('native browser transport stays loopback and trusts only the fixture certificate key',()=>{
  const pin=Buffer.alloc(32).toString('base64'),args=nativeChromiumArguments('/owned/fresh-profile',pin);
  assert(args.includes('--remote-debugging-address=127.0.0.1'));assert(args.includes('--remote-debugging-port=0'));
  assert(args.includes('--ignore-certificate-errors-spki-list='+pin));assert(!args.includes('--ignore-certificate-errors'));
  assert(!args.some(arg=>/focus|occluded|renderer-backgrounding|proxy-server|load-extension/.test(arg)));
  assert.throws(()=>nativeChromiumArguments('relative-profile',pin));assert.throws(()=>nativeChromiumArguments('/owned/fresh-profile','invalid-key'));
});
