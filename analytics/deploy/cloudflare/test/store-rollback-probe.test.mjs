import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createCollector,R2CreateOnlyStore,sha256} from '../../../collector/core.mjs';
import {createStoreRollbackProbe} from './store-rollback-probe.mjs';
const origin='https://synthetic-store-proof.example.invalid';
const all=[];
class Bucket{
  objects=new Map();calls=[];collisionThrows=false;failAttempt=0;corruptRead=false;
  async put(key,bytes,options){
    const row={operation:'put',key,body_base64:Buffer.from(bytes).toString('base64'),sha256:await sha256(bytes),options};this.calls.push(row);
    assert.deepEqual(options.onlyIf,{etagDoesNotMatch:'*'});
    if(this.calls.length===this.failAttempt){row.failed=true;throw new Error('synthetic provider outage');}
    if(this.objects.has(key)){row.created=false;if(this.collisionThrows)throw Object.assign(new Error('conditional rejection'),{status:412});return null;}
    const entry={bytes:new Uint8Array(bytes),etag:randomUUID(),customMetadata:options.customMetadata};this.objects.set(key,entry);row.created=true;return {etag:entry.etag};
  }
  async head(key){const o=this.objects.get(key);return o?{size:o.bytes.length,etag:o.etag,customMetadata:o.customMetadata}:null;}
  async get(key,options){const o=this.objects.get(key);if(!o)return null;let bytes=o.bytes.slice();if(options?.onlyIf)assert.equal(options.onlyIf.etagMatches,o.etag);if(options?.range)bytes=bytes.slice(options.range.offset,options.range.offset+options.range.length);if(this.corruptRead&&bytes.length)bytes[0]^=1;return {body:{},customMetadata:o.customMetadata,arrayBuffer:async()=>bytes.buffer};}
  async list(){throw new Error('No enumeration required');}
}
function fixture(){const id=randomUUID(),run={id,day:new Date().toISOString().slice(0,10),origin,ids:['store01-'+id+'-a','store01-'+id+'-b'],bodies:[JSON.stringify({synthetic:true,kind:'seed'}),JSON.stringify({schema_version:999,synthetic:true,kind:'future'})]};const bucket=new Bucket(),env={BUCKET:bucket,FARPOINT_STORE01_ENABLED:'1',FARPOINT_STORE01_TOKEN:'synthetic-test-token-at-least-thirty-two-characters'};const proof=createStoreRollbackProbe({run,sourceVersion:'synthetic-store01-test',createCollector,R2CreateOnlyStore,sha256});const f={run,bucket,env,proof,responses:[]};all.push(f);return f;}
async function call(f,{method='POST',path='/__synthetic/store01',host=origin,token=f.env.FARPOINT_STORE01_TOKEN}={}){const r=await f.proof(new Request(host+path,{method,headers:{Authorization:'Bearer '+token}}),f.env);if(!r)return null;const value={status:r.status,body:await r.json()};f.responses.push(value);return value;}
test('actual core forces conditional collision, reallocates, and verifies two preserved objects',async()=>{
 const f=fixture(),result=await call(f);assert.equal(result.status,200);assert.equal(result.body.status,'pass');assert.deepEqual(f.bucket.calls.map(x=>x.created),[true,false,true]);assert.equal(f.bucket.objects.size,2);assert.equal(result.body.seed_before.sha256,result.body.seed_after.sha256);assert.equal(result.body.forward.allocated_ids,2);assert.equal(result.body.forward_after.exact_body_preserved,true);assert.equal(result.body.unsupported_body_schema_retained,true);
});
test('R2 412 conditional failure is recognized and retried under a fresh fixed ID',async()=>{const f=fixture();f.bucket.collisionThrows=true;const r=await call(f);assert.equal(r.body.status,'pass');assert.equal(r.body.observations[1].error_status,412);assert.equal(f.bucket.objects.size,2);});
test('wrong method, host, flag, token and query never touch storage',async()=>{
 const f=fixture();for(const options of [{method:'GET'},{host:'https://wrong.example.invalid'},{token:'wrong'},{path:'/__synthetic/store01?x=1'}])assert.equal((await call(f,options)).status,404);f.env.FARPOINT_STORE01_ENABLED='true';assert.equal((await call(f)).status,404);f.env.FARPOINT_STORE01_ENABLED='1';f.env.FARPOINT_STORE01_TOKEN='short';assert.equal((await call(f)).status,404);assert.equal(f.bucket.calls.length,0);assert.equal(await call(f,{path:'/v1/events'}),null);
});
test('run outside planned UTC day is refused without a write',async()=>{const f=fixture();f.run.day='2000-01-01';assert.equal((await call(f)).body.reason,'run_day_mismatch');assert.equal(f.bucket.calls.length,0);});
test('repeated operation never replaces or adds an object',async()=>{const f=fixture();await call(f);const before=[...f.bucket.objects].map(([k,v])=>[k,Buffer.from(v.bytes).toString('base64')]);const r=await call(f);assert.equal(r.status,409);assert.equal(r.body.reason,'fixed_run_key_already_exists');assert.equal(f.bucket.calls.length,3);assert.deepEqual([...f.bucket.objects].map(([k,v])=>[k,Buffer.from(v.bytes).toString('base64')]),before);});
test('failure while adding forward data preserves seed, retains evidence and never passes',async()=>{const f=fixture();f.bucket.failAttempt=3;const r=await call(f);assert.equal(r.status,503);assert.equal(r.body.status,'failed');assert.equal(r.body.preservation_verified,false);assert.equal(f.bucket.objects.size,1);assert.equal(f.bucket.calls.length,3);assert.equal(f.bucket.calls[2].failed,true);});
test('wrong stored bytes cannot produce a preservation proof',async()=>{const f=fixture();f.bucket.corruptRead=true;const r=await call(f);assert.equal(r.status,503);assert.equal(r.body.status,'failed');assert.equal(r.body.preservation_verified,false);assert.equal(f.bucket.objects.size,1);});
after(async()=>{const path=process.env.FARPOINT_TEST_EVIDENCE_DIR||'/workspace/scratch/eb42d1bc91b8/farpoint-cf-artifacts';if(!isAbsolute(path))throw new Error('Absolute evidence directory required');await mkdir(path,{recursive:true});const output=resolve(path,'store-rollback-unit-'+randomUUID()+'.json');await writeFile(output,JSON.stringify({scope:'synthetic local adapter tests; no deployment or remote writes',fixtures:all.map(f=>({run:f.run,calls:f.bucket.calls,responses:f.responses,objects:[...f.bucket.objects].map(([key,v])=>({key,body_base64:Buffer.from(v.bytes).toString('base64'),metadata:v.customMetadata}))}))},null,2)+'\n',{flag:'wx'});console.log('Retained test evidence: '+output);});
