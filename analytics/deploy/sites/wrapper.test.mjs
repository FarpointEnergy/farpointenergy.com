import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url);
const core=await readFile(new URL('../../collector/core.mjs',root),'utf8');
const wrapper=await readFile(new URL('wrapper.mjs',root),'utf8');
const worker=(await import('data:text/javascript;base64,'+Buffer.from("const BUILD_SOURCE_VERSION='synthetic-local-wrapper-test';\n"+core+'\n'+wrapper).toString('base64'))).default;
const stores=[];
class Bucket{
  constructor(broken=false){this.objects=new Map();this.broken=broken;stores.push(this);}
  async put(key,bytes,options){if(this.objects.has(key)&&options.onlyIf?.etagDoesNotMatch==='*'&&!this.broken)return null;const value={bytes:new Uint8Array(bytes),customMetadata:options.customMetadata,etag:crypto.randomUUID()};this.objects.set(key,value);return{etag:value.etag};}
  async head(key){const v=this.objects.get(key);return v?{size:v.bytes.length,customMetadata:v.customMetadata,etag:v.etag}:null;}
  async get(key,options){const v=this.objects.get(key);if(!v||v.etag!==options.onlyIf.etagMatches)return null;const b=v.bytes.slice(options.range.offset,options.range.offset+options.range.length);return{body:true,arrayBuffer:async()=>b.buffer};}
  async list(){return{objects:[],truncated:false};}
}
function req(rpc,owner=true){return new Request('https://candidate.invalid/mcp',{method:'POST',headers:{'Content-Type':'application/json',...(owner?{'oai-authenticated-user-id':'synthetic-owner'}:{})},body:JSON.stringify(rpc)});}
const rpc=(name)=>({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{}}});
function env(bucket){return{BUCKET:bucket,PRIVATE_CANDIDATE_BOOTSTRAP:'1',GATEWAY_IDENTITY_VERIFIED:'0'};}
test('malformed discovery IDs preserve core errors and do not throw',async()=>{for(const id of [{},'x'.repeat(200)]){const r=await worker.fetch(req({jsonrpc:'2.0',id,method:'tools/list'}),env(new Bucket()));assert.equal(r.status,400);}});
test('bootstrap requires authenticated candidate context and never enrolls owner',async()=>{const e=env(new Bucket());assert.equal((await worker.fetch(req(rpc('bootstrap_owner_identity'),false),e)).status,403);const answer=await(await worker.fetch(req(rpc('bootstrap_owner_identity')),e)).json();assert.equal(JSON.parse(answer.result.content[0].text).owner_enrolled,false);assert.equal((await worker.fetch(req(rpc('list_records')),e)).status,403);assert.equal(e.OWNER_USER_ID,undefined);});
test('bootstrap is absent when disabled',async()=>{const e={BUCKET:new Bucket()};const answer=await(await worker.fetch(req({jsonrpc:'2.0',id:1,method:'tools/list'}),e)).json();assert.equal(answer.result.tools.some(t=>t.name.startsWith('candidate_')||t.name.startsWith('bootstrap_')),false);});
test('synthetic hosted-probe algorithm preserves three records and verifies readback',async()=>{const b=new Bucket();const answer=await(await worker.fetch(req(rpc('candidate_storage_check')),env(b))).json();const result=JSON.parse(answer.result.content[0].text);assert.equal(result.status,'PASS');assert.equal(result.receipts.length,3);assert.equal(b.objects.size,3);assert.equal(result.retention_lock_verified,false);for(const item of result.receipts)assert.equal(createHash('sha256').update(b.objects.get(item.key).bytes).digest('hex'),item.sha256);});
test('a broken conditional adapter fails with originals preserved and stage evidence',async()=>{const b=new Bucket(true);const answer=await(await worker.fetch(req(rpc('candidate_storage_check')),env(b))).json();const result=JSON.parse(answer.result.content[0].text);assert.equal(result.status,'FAIL');assert.equal(result.stage,'conditional_collision');assert.equal(b.objects.size,3);for(const item of result.retained_receipts.slice(0,2))assert.equal(createHash('sha256').update(b.objects.get(item.key).bytes).digest('hex'),item.sha256);});
test.after(async()=>{
  const directory=new URL('../../evidence/build-2026-10-23/',root);
  await mkdir(directory,{recursive:true});
  const out=new URL('wrapper-stores-'+crypto.randomUUID()+'.json',directory);
  const objects=stores.map(b=>[...b.objects].map(([key,v])=>({
    key,
    body_base64:Buffer.from(v.bytes).toString('base64'),
    sha256:createHash('sha256').update(v.bytes).digest('hex')
  })));
  await writeFile(out,JSON.stringify({test_scope:'local_candidate_wrapper_only',objects},null,2),{flag:'wx'});
  console.log('Synthetic stores retained: '+fileURLToPath(out));
});
