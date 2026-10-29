import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createCloudflareCollectorAdapter,cloudflareToolValue} from '../cloudflare-adapter.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const accountId='0'.repeat(32),bucketName='synthetic-farpoint-private';
const key=n=>`receipts/2026/10/26/synthetic-record-${String(n).padStart(8,'0')}.json`;
const fixtures=[];
function fixture(options={}){
  const source=new Map([[key(0),JSON.stringify({synthetic:true,payload:'café 🧪'.repeat(1800)})],[key(1),'{}'],[key(2),'']]);
  const evidence=new Map(),calls=[],toolCalls=[];fixtures.push({source,evidence,calls});
  const provider=async request=>{
    calls.push(request);
    assert.equal(request.method,'GET','adapter may issue only GET');
    assert(!('body' in request));
    const base=`/accounts/${accountId}/r2/buckets/${bucketName}/objects`;
    if(request.path===base){
      const args=request.query;assert(args.per_page<=40);
      const all=[...source.keys()].filter(x=>x.startsWith(args.prefix)&&(!args.start_after||x>args.start_after)).sort();
      const position=args.cursor?Number(args.cursor.split(':').at(-1)):0;
      const count=Math.min(options.providerPage??2,args.per_page);
      const selected=all.slice(position,position+count),truncated=position+count<all.length;
      const result={success:true,status:200,result:selected.map(k=>({key:k,size:Buffer.byteLength(source.get(k)),custom_metadata:{sha256:digest(source.get(k))}})),result_info:{is_truncated:truncated,...(truncated?{cursor:args.prefix+':'+(position+count)}:{})}};
      return options.changeProvider?options.changeProvider(result,request):result;
    }
    assert(request.path.startsWith(base+'/'));
    const k=request.path.slice(base.length+1);
    assert(k.includes('/'),'literal key slashes must remain in object path');
    assert(!k.includes('%2F'));
    const result={success:true,status:200,result:source.get(k)};
    return options.changeProvider?options.changeProvider(result,request):result;
  };
  const tools={mcp__codex_apps__farpoint_cloudflare_execute:async args=>{
    toolCalls.push(args);
    assert.equal(args.account_id,accountId);
    if(options.throwConnector)throw Error('synthetic credential error never leaked');
    const func=new Function('cloudflare','TextEncoder','crypto',`return (${args.code});`)({request:provider},TextEncoder,crypto);
    const value=await func();
    const raw={content:[{type:'text',text:JSON.stringify(value)}],structuredContent:null,isError:false};
    return options.changeEnvelope?options.changeEnvelope(raw,value,args):raw;
  }};
  const recordEvidence=async(name,bytes)=>{assert(!evidence.has(name));evidence.set(name,bytes);};
  const adapter=createCloudflareCollectorAdapter({tools,accountId,bucketName,recordEvidence,batchSmallObjects:options.batchSmallObjects??false,now:()=> '2026-10-27T03:00:00.000Z'});
  return{adapter,source,evidence,calls,toolCalls,tools,recordEvidence};
}

test('opt-in small-object batch preserves exact Unicode and empty bodies with fewer tool calls',async()=>{
  const f=fixture({batchSmallObjects:true,providerPage:40});f.source.clear();
  for(let n=0;n<10;n++)f.source.set(key(n),n?JSON.stringify({n,payload:'café 🧪'}):'');
  const page=await f.adapter.list({namespace:'receipts'});
  for(const item of page.items){const part=await f.adapter.chunk({key:item.key});assert.equal(part.object_complete,true);assert.deepEqual(Buffer.from(part.body_base64,'base64'),Buffer.from(f.source.get(item.key)));}
  assert.equal(f.toolCalls.length,3,'one list plus two bounded batch calls');
  assert.equal(f.calls.filter(x=>!x.query).length,10,'every listed object still receives an authenticated GET');
  const batches=[...f.evidence.values()].map(b=>JSON.parse(Buffer.from(b))).filter(x=>x.operation==='batch');
  assert.deepEqual(batches.map(x=>x.args.keys.length),[8,2]);
  assert(batches.every(x=>x.response.content[0].text.length<=60000));
});

test('small-object batches enforce raw byte budget and use legacy chunks for large records',async()=>{
  const f=fixture({batchSmallObjects:true,providerPage:40});f.source.clear();
  for(let n=0;n<6;n++)f.source.set(key(n),'x'.repeat(8192));f.source.set(key(6),'y'.repeat(9000));
  const page=await f.adapter.list({namespace:'receipts'});
  for(const item of page.items){let at=0;do{const p=await f.adapter.chunk({key:item.key,offset:at});at=p.next_offset;}while(at<item.size);}
  const evidence=[...f.evidence.values()].map(b=>JSON.parse(Buffer.from(b)));
  assert.deepEqual(evidence.filter(x=>x.operation==='batch').map(x=>x.args.keys.length),[3,3]);
  assert.equal(evidence.filter(x=>x.operation==='chunk').length,2);
  assert(evidence.every(x=>(x.response?.content?.[0]?.text?.length??0)<=60000));
});

test('batch provider failure preserves siblings and fails the affected record without retry',async()=>{
  const f=fixture({batchSmallObjects:true,providerPage:40,changeProvider:(v,r)=>{if(r.path.endsWith('/'+key(1)))throw Error('private failed provider text');return v;}});
  f.source.clear();for(let n=0;n<3;n++)f.source.set(key(n),'{}');
  await f.adapter.list({namespace:'receipts'});
  assert.equal((await f.adapter.chunk({key:key(0)})).object_complete,true);
  const calls=f.toolCalls.length;
  await assert.rejects(()=>f.adapter.chunk({key:key(1)}),/cloudflare_object_read_failed/);
  assert.equal((await f.adapter.chunk({key:key(2)})).object_complete,true);
  assert.equal(f.toolCalls.length,calls,'failed record is not silently retried');
  const retained=Buffer.concat([...f.evidence.values()]).toString();assert(!retained.includes('private failed provider text'));
  const batch=JSON.parse(JSON.parse(Buffer.from([...f.evidence.values()].at(-1))).response.content[0].text);
  assert.equal(batch.items.length,3);assert(batch.items[0].chunk.body_base64);assert(batch.items[2].chunk.body_base64);
});

test('malformed, reordered or truncated batch results fail after retaining raw envelope',async()=>{
  for(const mutate of [v=>v.items.reverse(),v=>v.items.pop(),v=>v.items[0].key=key(2),v=>v.extra=true,v=>v.items[0].extra=true]){
    const f=fixture({batchSmallObjects:true,providerPage:40,changeEnvelope:(raw,v)=>{if(v.adapter_format==='farpoint_cf_batch_v1'){mutate(v);raw.content[0].text=JSON.stringify(v);}return raw;}});
    f.source.set(key(0),'{}');await f.adapter.list({namespace:'receipts'});
    await assert.rejects(()=>f.adapter.chunk({key:key(0)}),/invalid_cloudflare_batch/);
    assert.equal(f.evidence.size,2,'both listing and exact failed batch response retained');
  }
});

test('batch validates listed object hashes and individual chunk bytes independently',async()=>{
  for(const kind of ['changed_object','corrupt_chunk','wrong_reconstruction']){
    const f=fixture({batchSmallObjects:true,providerPage:40,
      changeProvider:(v,r)=>{if(kind==='changed_object'&&!r.query&&r.path.endsWith('/'+key(1)))v.result='changed';return v;},
      changeEnvelope:(raw,v)=>{if(v.adapter_format==='farpoint_cf_batch_v1'){
        if(kind==='corrupt_chunk')v.items[1].chunk.body_base64=Buffer.from('xx').toString('base64');
        if(kind==='wrong_reconstruction')v.items[1].chunk.reconstruction_method='unchecked_normalization';
        raw.content[0].text=JSON.stringify(v);
      }return raw;}});
    f.source.set(key(0),'{}');await f.adapter.list({namespace:'receipts'});
    await f.adapter.chunk({key:key(0)});
    await assert.rejects(()=>f.adapter.chunk({key:key(1)}));
    assert.equal(f.toolCalls.length,2);
  }
});

test('fresh scan discards prior prefetched bytes and sees a changed provider object',async()=>{
  let changed=false;const f=fixture({batchSmallObjects:true,providerPage:40,changeProvider:(v,r)=>{if(changed&&!r.query&&r.path.endsWith('/'+key(1)))v.result='changed-after-first-scan';return v;}});
  f.source.set(key(0),'{}');await f.adapter.list({namespace:'receipts'});await f.adapter.chunk({key:key(0)});
  changed=true;await f.adapter.list({namespace:'receipts'});
  await assert.rejects(()=>f.adapter.chunk({key:key(1)}),/cloudflare_object_integrity_mismatch/);
  assert.equal(f.toolCalls.length,4,'new scan makes a new provider read');
});

test('prefetch only reads records listed in the current scan and requested namespace',async()=>{
  const f=fixture({batchSmallObjects:true,providerPage:40});f.source.set(key(0),'{}');
  const rejection='rejections/2026/10/26/synthetic-rejection-00000000.json';f.source.set(rejection,'{}');
  await f.adapter.list({namespace:'receipts'});await f.adapter.list({namespace:'rejections'});
  await f.adapter.list({namespace:'receipts',limit:1});
  await f.adapter.chunk({key:key(0)});
  assert.deepEqual(f.calls.filter(x=>!x.query).map(x=>x.path.split('/objects/')[1]),[key(0)]);
});

test('explicit old-inventory read outside the current scan cannot seed a prefetch batch',async()=>{
  const f=fixture({batchSmallObjects:true,providerPage:40});f.source.set(key(0),'{}');
  await f.adapter.list({namespace:'receipts'});
  await f.adapter.list({namespace:'receipts',limit:1});
  await f.adapter.chunk({key:key(1)});
  const retained=[...f.evidence.values()].map(b=>JSON.parse(Buffer.from(b)));
  assert.equal(retained.at(-1).operation,'chunk','existing explicit-read behavior uses only the legacy single record');
  assert.equal(retained.filter(x=>x.operation==='batch').length,0);
  assert.deepEqual(f.calls.filter(x=>!x.query).map(x=>x.path.split('/objects/')[1]),[key(1)]);
});

test('batch response persistence failure cannot return or cache acquired bytes',async()=>{
  const f=fixture({providerPage:40});f.source.set(key(0),'{}');let count=0;
  const adapter=createCloudflareCollectorAdapter({tools:f.tools,accountId,bucketName,batchSmallObjects:true,recordEvidence:async(name,bytes)=>{if(++count>1)throw Error('synthetic evidence sink failure');await f.recordEvidence(name,bytes);}});
  await adapter.list({namespace:'receipts'});
  await assert.rejects(()=>adapter.chunk({key:key(0)}),/synthetic evidence sink failure/);
  assert.equal(f.evidence.size,1);
});

test('complete multi-page export reconstructs Unicode, chunk boundaries and empty objects',async()=>{
  const f=fixture();let cursor=null;const listed=[];
  do{const page=await f.adapter.list({namespace:'receipts',cursor,limit:40});listed.push(...page.items);cursor=page.next_cursor;}while(cursor);
  assert.equal(listed.length,3);
  for(const item of listed){const parts=[];let offset=0;
    do{const part=await f.adapter.chunk({key:item.key,offset,max_bytes:8192});parts.push(Buffer.from(part.body_base64,'base64'));offset=part.next_offset;assert.equal(part.object_complete,offset===item.size);}while(offset<item.size);
    const body=Buffer.concat(parts);assert.deepEqual(body,Buffer.from(f.source.get(item.key)));assert.equal(digest(body),item.sha256);
  }
  assert(f.evidence.size>5);
  assert.equal((await f.adapter.listRecords({namespace:'rejections'})).enumeration_complete,true);
});

test('provider short page with continuation is not interpreted as completion',async()=>{
  const f=fixture({providerPage:1});const page=await f.adapter.list({namespace:'receipts',limit:40});
  assert.equal(page.items.length,1);assert.equal(page.enumeration_complete,false);assert(page.next_cursor);
});

test('unlisted keys, path traversal, excess page/chunk limits and scope injection are rejected before tools',async()=>{
  const f=fixture();
  await assert.rejects(()=>f.adapter.chunk({key:key(0)}),/cloudflare_record_not_listed/);
  for(const args of [{namespace:'receipts',limit:41},{namespace:'receipts',bucketName:'other'},{namespace:'../private'},{namespace:'receipts',cursor:'unknown'}])await assert.rejects(()=>f.adapter.list(args));
  for(const args of [{key:'receipts/../../secret'},{key:key(0),max_bytes:8193},{key:key(0),offset:-1}])await assert.rejects(()=>f.adapter.chunk(args));
  assert.equal(f.calls.length,0);
});

test('cursor cannot move between namespaces or repeat without progress',async()=>{
  const f=fixture({changeProvider:(value,request)=>{
    if(request.query?.cursor)value.result_info.cursor=request.query.cursor;
    return value;
  }});
  const first=await f.adapter.list({namespace:'receipts',limit:1});
  await assert.rejects(()=>f.adapter.list({namespace:'rejections',cursor:first.next_cursor}),/invalid_cloudflare_cursor_scope/);
  await assert.rejects(()=>f.adapter.list({namespace:'receipts',cursor:first.next_cursor,limit:1}),/repeated_cloudflare_cursor/);
});

test('longer cursor cycle is detected',async()=>{
  let page=0;const f=fixture({changeProvider:value=>{
    if(Array.isArray(value.result)){value.result_info={is_truncated:true,cursor:['first','second','first'][page++]};value.result=value.result.slice(0,1);}return value;
  }});
  const a=await f.adapter.list({namespace:'receipts'});const b=await f.adapter.list({namespace:'receipts',cursor:a.next_cursor});
  await assert.rejects(()=>f.adapter.list({namespace:'receipts',cursor:b.next_cursor}),/repeated_cloudflare_cursor/);
});

test('malformed continuation facts and truncated connector JSON cannot pass',async()=>{
  const a=fixture({changeProvider:value=>{value.result_info={is_truncated:'false'};return value;}});
  await assert.rejects(()=>a.adapter.list({namespace:'receipts'}),/invalid_cloudflare_continuation/);
  const b=fixture({changeEnvelope:raw=>({...raw,content:[{type:'text',text:raw.content[0].text.slice(0,-2)}]})});
  await assert.rejects(()=>b.adapter.list({namespace:'receipts'}),/invalid_cloudflare_json/);
  assert.equal(b.evidence.size,1,'malformed returned envelope is still retained');
});

test('omitted terminal info requires a successful empty start_after range probe',async()=>{
  const f=fixture({providerPage:40,changeProvider:value=>{delete value.result_info;return value;}});
  const result=await f.adapter.list({namespace:'receipts'});
  assert.equal(result.enumeration_complete,true);assert.equal(result.items.length,3);
  assert.equal(result.completion_basis,'empty_range_end');assert.equal(f.calls.length,2);
  assert.equal(f.calls[1].query.start_after,key(2));assert.equal(f.calls[1].query.per_page,1);
  const raw=JSON.parse(Buffer.from([...f.evidence.values()][0]).toString());
  const returned=JSON.parse(raw.response.content[0].text);assert.equal(returned.provider_evidence.length,2);
});

test('omitted info on false short pages continues by keyset until every object is read',async()=>{
  const f=fixture({providerPage:1,changeProvider:value=>{delete value.result_info;return value;}});
  let cursor=null;const keys=[];let pages=0;
  do{const page=await f.adapter.list({namespace:'receipts',cursor});keys.push(...page.items.map(x=>x.key));cursor=page.next_cursor;if(++pages===1){assert.equal(page.enumeration_complete,false);assert.equal(page.completion_basis,'keyset_probe_has_more');}}while(cursor);
  assert.deepEqual(keys,[key(0),key(1),key(2)]);assert.equal(pages,3);assert.equal(f.calls.length,6);
});

test('empty initial namespace without optional metadata is a successful empty range observation',async()=>{
  const f=fixture({changeProvider:value=>{delete value.result_info;return value;}});
  const page=await f.adapter.list({namespace:'rejections'});assert.equal(page.enumeration_complete,true);assert.deepEqual(page.items,[]);assert.equal(f.calls.length,1);
});

test('late higher-key writes found by terminal probe continue and lower-key arrivals appear on rescan',async()=>{
  let added=false;let f;
  f=fixture({providerPage:40,changeProvider:(value,request)=>{
    delete value.result_info;
    if(request.query&&!request.query.start_after&&!added){added=true;f.source.set(key(3),'late-higher-key');}
    return value;
  }});
  const first=await f.adapter.list({namespace:'receipts'});assert.equal(first.enumeration_complete,false);
  const second=await f.adapter.list({namespace:'receipts',cursor:first.next_cursor});assert.deepEqual(second.items.map(x=>x.key),[key(3)]);assert.equal(second.enumeration_complete,true);
  const lower='receipts/2026/10/25/synthetic-late-record.json';f.source.set(lower,'late-earlier-date');
  const rescan=await f.adapter.list({namespace:'receipts'});assert(rescan.items.some(x=>x.key===lower));assert.equal(rescan.transactional_snapshot,false);
});

test('failed terminal probe retains initial page and failed probe request evidence',async()=>{
  const f=fixture({providerPage:40,changeProvider:(value,request)=>{
    if(request.query?.start_after)throw Error('synthetic probe failure');delete value.result_info;return value;
  }});
  await assert.rejects(()=>f.adapter.list({namespace:'receipts'}),/cloudflare_list_request_failed/);
  const retained=JSON.parse(Buffer.from([...f.evidence.values()][0]).toString());
  const result=JSON.parse(retained.response.content[0].text);
  assert.equal(result.provider_evidence.length,2);assert.equal(result.provider_evidence[1].query.start_after,key(2));assert.equal(result.provider_evidence[1].outcome,'request_failed');
  await assert.rejects(()=>f.adapter.chunk({key:key(0)}),/cloudflare_record_not_listed/);
});

test('out-of-order pages and nonadvancing terminal probes never certify completion',async()=>{
  const a=fixture({changeProvider:value=>{value.result.reverse();return value;}});
  await assert.rejects(()=>a.adapter.list({namespace:'receipts'}),/invalid_cloudflare_object_order/);
  const b=fixture({providerPage:40,changeProvider:(value,request)=>{delete value.result_info;if(request.query.start_after)value.result=[{key:request.query.start_after,size:0,custom_metadata:{sha256:digest('')}}];return value;}});
  await assert.rejects(()=>b.adapter.list({namespace:'receipts'}),/invalid_cloudflare_object_order/);
});

test('unexpected envelope shapes, explicit errors and competing representations fail closed',()=>{
  const good={content:[{type:'text',text:'{}'}]};
  for(const raw of [{isError:true,content:[{type:'text',text:'private sentinel'}]},{...good,structuredContent:{}},{content:[{type:'text',text:'{}'},{type:'text',text:'{}'}]},{content:[{type:'image',text:'{}'}]},{content:[{type:'text',text:'```json\n{}\n```'}]},{content:[{type:'text',text:'[]'}]},{content:[{type:'text',text:'x'.repeat(60001)}]}])assert.throws(()=>cloudflareToolValue(raw));
  assert.deepEqual(cloudflareToolValue(good),{});
});

test('unauthorized connector errors are sanitized and diagnostic attempt is retained',async()=>{
  const f=fixture({throwConnector:true});
  await assert.rejects(()=>f.adapter.list({namespace:'receipts'}),error=>error.message==='cloudflare_connector_error');
  assert.equal(f.evidence.size,1);assert(!Buffer.concat([...f.evidence.values()]).toString().includes('credential error'));
});

test('invalid listed hashes, sizes, namespaces and duplicates are rejected',async()=>{
  for(const change of [v=>{v.result[0].custom_metadata.sha256='bad';},v=>{v.result[0].size=-1;},v=>{v.result[0].key='other/record.json';},v=>{v.result[0].size=1024*1024+1;},v=>{v.result=[v.result[0],v.result[0]];}]){
    const f=fixture({changeProvider:value=>{change(value);return value;}});await assert.rejects(()=>f.adapter.list({namespace:'receipts'}));
  }
});

test('object hash is computed independently from actual bytes and checked against listing',async()=>{
  const f=fixture({changeProvider:(value,request)=>{if(!request.query)value.result='changed-object';return value;}});
  await f.adapter.list({namespace:'receipts'});
  await assert.rejects(()=>f.adapter.chunk({key:key(0)}),/cloudflare_object_integrity_mismatch/);
});

test('changed listed object on a later scan fails instead of replacing inventory',async()=>{
  let mutated=false;const f=fixture({changeProvider:value=>{if(mutated&&Array.isArray(value.result))value.result[0].custom_metadata.sha256='f'.repeat(64);return value;}});
  await f.adapter.list({namespace:'receipts'});mutated=true;
  await assert.rejects(()=>f.adapter.list({namespace:'receipts'}),/conflicting_cloudflare_object/);
});

test('corrupted chunk bytes with unchanged metadata fail their independent chunk hash',async()=>{
  const f=fixture({changeEnvelope:(raw,value)=>{
    if(value.adapter_format==='farpoint_cf_chunk_v1'){const bytes=Buffer.from(value.body_base64,'base64');bytes[0]^=1;value.body_base64=bytes.toString('base64');raw.content[0].text=JSON.stringify(value);}return raw;
  }});
  await f.adapter.list({namespace:'receipts'});
  await assert.rejects(()=>f.adapter.chunk({key:key(0)}),/cloudflare_chunk_hash_mismatch/);
});

test('invalid chunk offset, length, completion and encoding fail before returning bytes',async()=>{
  for(const mutate of [v=>v.offset++,v=>v.bytes--,v=>v.next_offset++,v=>v.object_complete=true,v=>v.body_base64='!invalid!',v=>v.key=key(1)]){
    const f=fixture({changeEnvelope:(raw,value)=>{if(value.adapter_format==='farpoint_cf_chunk_v1'){mutate(value);raw.content[0].text=JSON.stringify(value);}return raw;}});
    await f.adapter.list({namespace:'receipts'});await assert.rejects(()=>f.adapter.chunk({key:key(0)}));
  }
});

test('parsed JSON with mismatching reconstructed bytes cannot substitute for the original',async()=>{
  const f=fixture({changeProvider:(value,request)=>{if(!request.query)value.result={synthetic:true};return value;}});
  await f.adapter.list({namespace:'receipts'});
  await assert.rejects(()=>f.adapter.chunk({key:key(0)}),/cloudflare_object_integrity_mismatch/);
});

test('parsed compact Unicode JSON reconstructs only after exact listed size and hash match',async()=>{
  const f=fixture({changeProvider:(value,request)=>{if(!request.query)value.result=JSON.parse(value.result);return value;}});
  const page=await f.adapter.list({namespace:'receipts'});const item=page.items[0];
  const parts=[];let offset=0;
  do{const result=await f.adapter.chunk({key:item.key,offset});parts.push(Buffer.from(result.body_base64,'base64'));offset=result.next_offset;assert.equal(result.reconstruction_method,'json_stringify_verified');assert.deepEqual(result.provider_response,{success:true,status:200,result_type:'plain_object'});}while(offset<item.size);
  const bytes=Buffer.concat(parts);assert.deepEqual(bytes,Buffer.from(f.source.get(item.key)));assert.equal(digest(bytes),item.sha256);
  const captured=JSON.parse(Buffer.from([...f.evidence.values()][1]).toString());
  assert.equal(JSON.parse(captured.response.content[0].text).reconstruction_method,'json_stringify_verified');
});

test('noncanonical JSON, duplicate keys, escaped Unicode and large-number normalization fail exact reconstruction',async()=>{
  for(const original of [' {"a":1}\n','{"a":1.0}','{"a":1,"a":2}','{"s":"\\u00e9"}','{"large":9007199254740993}','{"2":"two","1":"one"}']){
    const f=fixture({changeProvider:(value,request)=>{if(!request.query)value.result=JSON.parse(value.result);return value;}});f.source.set(key(0),original);
    await f.adapter.list({namespace:'receipts'});
    await assert.rejects(()=>f.adapter.chunk({key:key(0)}),/cloudflare_object_integrity_mismatch/);
    const last=JSON.parse(Buffer.from([...f.evidence.values()].at(-1)).toString());
    const failure=JSON.parse(last.response.content[0].text);
    assert.equal(failure.adapter_format,'farpoint_cf_chunk_failure_v1');assert.equal(failure.body_base64,undefined);assert.equal(failure.reconstruction_method,'json_stringify_verified');assert(failure.observed_sha256);
  }
});

test('unsupported parsed result types and failed JSON serialization return no chunks',async()=>{
  for(const typed of [null,[],42,true,new Date('2026-10-26T00:00:00Z'),new String('bad')]){
    const f=fixture({changeProvider:(value,request)=>{if(!request.query)value.result=typed;return value;}});
    await f.adapter.list({namespace:'receipts'});await assert.rejects(()=>f.adapter.chunk({key:key(0)}),/invalid_cloudflare_object_response/);
  }
  const cycle={};cycle.self=cycle;
  const f=fixture({changeProvider:(value,request)=>{if(!request.query)value.result=cycle;return value;}});
  await f.adapter.list({namespace:'receipts'});await assert.rejects(()=>f.adapter.chunk({key:key(0)}),/cloudflare_object_reconstruction_failed/);
});

test('raw-text path also checks exact listed hash before returning a chunk',async()=>{
  const f=fixture();await f.adapter.list({namespace:'receipts'});const value=await f.adapter.chunk({key:key(0)});
  assert.equal(value.reconstruction_method,'raw_utf8_text');assert.deepEqual(value.provider_response,{success:true,status:200,result_type:'string'});
});

test('reconstruction metadata cannot be omitted or claim a conflicting provider type',async()=>{
  for(const mutate of [value=>{delete value.reconstruction_method;},value=>{value.provider_response.result_type='plain_object';},value=>{value.provider_response.status=403;}]){
    const f=fixture({changeEnvelope:(raw,value)=>{if(value.adapter_format==='farpoint_cf_chunk_v1'){mutate(value);raw.content[0].text=JSON.stringify(value);}return raw;}});
    await f.adapter.list({namespace:'receipts'});await assert.rejects(()=>f.adapter.chunk({key:key(0)}),/invalid_cloudflare_reconstruction_evidence/);
  }
});

test('evidence sink failure prevents a successful read and inventory advancement',async()=>{
  const f=fixture();const adapter=createCloudflareCollectorAdapter({tools:f.tools,accountId,bucketName,recordEvidence:async()=>{throw Error('synthetic evidence storage failure');}});
  await assert.rejects(()=>adapter.list({namespace:'receipts'}),/evidence storage failure/);
  await assert.rejects(()=>adapter.chunk({key:key(0)}),/cloudflare_record_not_listed/);
});

after(async()=>{
  const override=process.env.FARPOINT_TEST_EVIDENCE_DIR;
  if(override&&!isAbsolute(override))throw Error('Absolute evidence directory required');
  const directory=override||fileURLToPath(new URL('./evidence/',import.meta.url));await mkdir(directory,{recursive:true});
  const path=resolve(directory,'cloudflare-work-adapter-'+randomUUID()+'.json');
  const evidence=fixtures.map(f=>({synthetic_source:[...f.source].map(([key,text])=>({key,body_base64:Buffer.from(text).toString('base64'),sha256:digest(text)})),responses:[...f.evidence].map(([name,bytes])=>({name,body_base64:Buffer.from(bytes).toString('base64')})),calls:f.calls}));
  await writeFile(path,JSON.stringify({scope:'local_synthetic_read_only_cloudflare_adapter',evidence}),{flag:'wx'});console.log('Synthetic evidence retained: '+path);
});
