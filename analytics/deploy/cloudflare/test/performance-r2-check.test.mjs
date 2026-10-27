import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {verifyPerformanceReceiptBatch} from './performance-r2-check.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const scope={accountId:'3b015a79038b3504bc9e39279981bd97',bucket:'farpoint-lead-candidate-20261026'};
const evidence=[];
function fixture(count=1){
  const body=JSON.stringify({schema_version:1,tracker_version:'1.0.0',events:Array.from({length:count},()=>({synthetic:true}))});
  const id='synthetic-'+randomUUID(),key='receipts/2026/10/27/'+id+'.json';
  const record={receipt_schema_version:1,receipt_id:id,body_bytes:Buffer.byteLength(body),body_base64:Buffer.from(body).toString('base64'),receipt_body_sha256:hash(body),source_ip:{status:'verified',address:'192.0.2.88'}};
  const raw=JSON.stringify(record);const row={key,receipt_id:id,object_sha256:hash(raw),object_bytes:Buffer.byteLength(raw),ack_body_sha256:hash(body),original_body_sha256:hash(body),original_body_bytes:Buffer.byteLength(body)};
  evidence.push({row,raw});return{row,raw,record};
}
test('authenticated batch compares exact outer and inner integrity without returning source IP or body',async()=>{
  const f=fixture();const calls=[];const cloudflare={async request(request){calls.push(request);return{success:true,status:200,result:f.record};}};
  const result=await verifyPerformanceReceiptBatch({...scope,cloudflare,rows:[f.row]});assert.equal(result.all_integrity_checks_pass,true);assert.equal(result.all_original_bodies_match,true);assert.equal(result.results[0].event_count,1);assert.equal(result.results[0].all_events_synthetic,true);assert(!JSON.stringify(result).includes('192.0.2.88'));assert(!JSON.stringify(result).includes(f.record.body_base64));assert.equal(calls[0].method,'GET');assert(calls[0].path.endsWith(f.row.key));
});
test('modified object, wrong ACK and unavailable objects fail without provider error reflection',async()=>{
  for(const variant of ['modified','wrong-ack','unavailable']){
    const f=fixture();const cloudflare={async request(){if(variant==='unavailable')throw new Error('PRIVATE_ADDRESS_192.0.2.89');return{success:true,status:200,result:variant==='modified'?{...f.record,extra:'changed'}:f.record};}};
    const row=variant==='wrong-ack'?{...f.row,ack_body_sha256:'a'.repeat(64)}:f.row;
    const result=await verifyPerformanceReceiptBatch({...scope,cloudflare,rows:[row]});assert.equal(result.all_integrity_checks_pass,false);assert(!JSON.stringify(result).includes('PRIVATE_ADDRESS'));
  }
});
test('actual received prefix is distinguished from original sent body; unsupported event count remains intact',async()=>{
  const f=fixture(51);const result=await verifyPerformanceReceiptBatch({...scope,cloudflare:{async request(){return{success:true,status:200,result:f.raw};}},rows:[{...f.row,original_body_sha256:'b'.repeat(64),original_body_bytes:f.row.original_body_bytes+1}]});
  assert.equal(result.all_integrity_checks_pass,true);assert.equal(result.all_original_bodies_match,false);assert.equal(result.results[0].event_count,51);assert.equal(result.results[0].envelope_count_and_version_supported,false);
});
test('scope and batch limits reject arbitrary objects before reading',async()=>{
  const f=fixture();let calls=0;const cloudflare={async request(){calls++;}};
  for(const rows of [[],Array(41).fill(f.row),[{...f.row,key:'secrets/owner.json'}],[{...f.row,object_sha256:'bad'}]])await assert.rejects(verifyPerformanceReceiptBatch({...scope,cloudflare,rows}));
  assert.equal(calls,0);
});
test.after(async()=>{const dir=process.env.FARPOINT_TEST_EVIDENCE_DIR||resolve('analytics/deploy/cloudflare/test/evidence');await mkdir(dir,{recursive:true});await writeFile(resolve(dir,'performance-r2-check-fixtures-'+randomUUID()+'.json'),JSON.stringify({synthetic_only:true,evidence},null,2),{flag:'wx'});});
