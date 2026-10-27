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
