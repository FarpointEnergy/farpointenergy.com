import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {createWorkHostBridge} from '../host-bridge.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(fault){
  const expected=randomBytes(100000),bytes=Buffer.from(JSON.stringify({status:'ok',base64:expected.toString('base64')}));
  const path='bridge-results/00000000-0000-4000-8000-000000000000.json';let reads=0;
  const tools={exec_command:async()=>({session_id:1,output:'READY\n'}),write_stdin:async({chars})=>{
    const q=JSON.parse(chars);assert.equal(q.stream_results,true);
    if(q.op==='read_reference')return {output:JSON.stringify({status:'ok',result_stream:{path,bytes:bytes.length,sha256:fault==='object'?'0'.repeat(64):hash(bytes),encoding:'utf-8-json'}})};
    assert.equal(q.op,'read_result');reads++;const part=bytes.subarray(q.offset,q.offset+q.max_bytes);
    return {output:JSON.stringify({status:'ok',path,offset:q.offset,total_bytes:bytes.length,bytes:part.length,base64:part.toString('base64'),sha256:fault==='chunk'?'0'.repeat(64):hash(part)})};
  }};
  return {bridge:createWorkHostBridge({tools,privateRoot:'/private/test',repositoryRoot:'/repo'}),expected,get reads(){return reads;}};
}
test('host reconstructs large private response from bounded independently hashed chunks',async()=>{const f=fixture();assert.deepEqual(await f.bridge.readFileReference({}),new Uint8Array(f.expected));assert(f.reads>10);});
test('host rejects mismatching private response chunk without accepting data',async()=>{await assert.rejects(()=>fixture('chunk').bridge.readFileReference({}),/invalid_bridge_result_chunk/);});
test('host rejects mismatching full private response hash after complete transport',async()=>{await assert.rejects(()=>fixture('object').bridge.readFileReference({}),/bridge_result_hash_mismatch/);});

test('createMany checks every returned byte proof and preserves a failed verified prefix',async()=>{
  const files=[{path:'first',bytes:new Uint8Array([0,255])},{path:'second',bytes:new Uint8Array([2])}];let failure=false,bad=false,calls=0;
  const tools={exec_command:async()=>({session_id:1,output:'READY\n'}),write_stdin:async({chars})=>{
    calls++;const q=JSON.parse(chars);assert.equal(q.op,'create_many');
    const entries=q.files.map(x=>{const bytes=Buffer.from(x.base64,'base64');return {relative_path:x.path,path:'/private/test/'+x.path,bytes:bytes.length,sha256:hash(bytes)};});
    if(bad)entries[0].sha256='0'.repeat(64);
    return {output:JSON.stringify({status:'ok',batch:{complete:!failure,verified_entries:failure?entries.slice(0,1):entries,reason:'FileExistsError',request_path:'/private/test/request',request_sha256:'a'.repeat(64)}})};
  }};
  const bridge=createWorkHostBridge({tools,privateRoot:'/private/test',repositoryRoot:'/repo'});
  assert.deepEqual(await bridge.createMany(files),['/private/test/first','/private/test/second']);
  failure=true;await assert.rejects(()=>bridge.createMany(files),error=>error.code==='local_batch_failed'&&error.created_local_files.length===1&&error.created_local_files[0].relative_path==='first'&&error.batch_evidence.request_path==='/private/test/request');
  failure=false;bad=true;await assert.rejects(()=>bridge.createMany(files),/invalid_local_batch_confirmation/);
  const before=calls;await assert.rejects(()=>bridge.createMany(Array.from({length:65},()=>files[0])),/local_batch_limit/);await assert.rejects(()=>bridge.createMany([{path:'large',bytes:new Uint8Array(256*1024+1)}]),/local_batch_limit/);assert.equal(calls,before);
});


test('host waits for a live private bridge to finish starting before sending the request',async()=>{
  let polls=0,requestCount=0;
  const tools={exec_command:async()=>({session_id:7,output:'starting\n'}),write_stdin:async({session_id,chars})=>{
    assert.equal(session_id,7);
    if(chars===''){polls++;return polls===1?{session_id:7,output:'loading\n'}:{session_id:7,output:'READY\n'};}
    requestCount++;
    const q=JSON.parse(chars);assert.equal(q.op,'create');assert.equal(q.stream_results,true);
    return {output:JSON.stringify({status:'ok',path:'/private/test/event.json'}),exit_code:0};
  }};
  const bridge=createWorkHostBridge({tools,privateRoot:'/private/test',repositoryRoot:'/repo'});
  assert.equal(await bridge.create('event.json',new Uint8Array([1,2,3])),'/private/test/event.json');
  assert.equal(polls,2);assert.equal(requestCount,1);
});

test('host does not send a request when the bridge exits before readiness',async()=>{
  let requestCount=0;
  const tools={exec_command:async()=>({session_id:8,output:''}),write_stdin:async({chars})=>{
    if(chars==='')return {output:'ModuleNotFoundError\n',exit_code:1};
    if(chars.startsWith('{'))requestCount++;return {output:'{}',exit_code:0};
  }};
  const bridge=createWorkHostBridge({tools,privateRoot:'/private/test',repositoryRoot:'/repo',startupTimeoutMs:100});
  await assert.rejects(()=>bridge.create('event.json',new Uint8Array([1])),/private_bridge_exited_before_ready/);
  assert.equal(requestCount,0);
});

test('host fails closed after a bounded readiness timeout',async()=>{
  let requestCount=0;
  const tools={exec_command:async()=>({session_id:9,output:''}),write_stdin:async({chars})=>{
    if(chars==='')return {session_id:9,output:''};
    if(chars.startsWith('{'))requestCount++;return {output:'{}',exit_code:0};
  }};
  const bridge=createWorkHostBridge({tools,privateRoot:'/private/test',repositoryRoot:'/repo',startupTimeoutMs:1});
  await assert.rejects(()=>bridge.create('event.json',new Uint8Array([1])),/private_bridge_start_timeout/);
  assert.equal(requestCount,0);
});


test('host reports a missing process session without sending a request',async()=>{
  let requestCount=0;
  const tools={exec_command:async()=>({output:'python3 unavailable\\n',exit_code:127}),write_stdin:async()=>{
    requestCount++;return {output:'{}',exit_code:0};
  }};
  const bridge=createWorkHostBridge({tools,privateRoot:'/private/test',repositoryRoot:'/repo'});
  await assert.rejects(()=>bridge.create('event.json',new Uint8Array([1])),/private_bridge_launch_failed/);
  assert.equal(requestCount,0);
});
