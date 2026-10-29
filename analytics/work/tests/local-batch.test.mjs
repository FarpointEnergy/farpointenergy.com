import test from 'node:test';
import assert from 'node:assert/strict';
import {runLeadPipeline,workJSON,workHash,WorkFailure} from '../pipeline.mjs';

const decode=b=>JSON.parse(new TextDecoder().decode(b));
const at='2026-10-27T12:00:00.000Z';
async function fixture({fault=null,count=24,large=false}={}){
  const local=new Map(),remote=new Map(),names=new Map(),calls=[];let next=0,failed=false;
  const source=new Map(Array.from({length:count},(_,i)=>[`receipts/2026/10/27/synthetic-batch-${String(i).padStart(4,'0')}.json`,large&&i===0?new Uint8Array(20000).fill(65):workJSON({synthetic:true,index:i})]));
  const config={local_write_mode:'bounded_batches_v1',job:{id:'synthetic',version:'1',scope_id:'synthetic',kind:'report'},window_start:'2026-10-26T00:00:00.000Z',window_end:at};
  const journal={create:async(path,bytes)=>{calls.push({kind:'single',paths:[path]});assert(!local.has(path));local.set(path,bytes.slice());},
    createMany:async rows=>{
      assert(rows.length<=64);assert(rows.reduce((n,x)=>n+x.bytes.length,0)<=256*1024);
      calls.push({kind:'batch',paths:rows.map(x=>x.path)});const prefix=[];
      for(const row of rows){
        if(fault==='local-prefix'&&!failed&&row.path.startsWith('raw/collector/')&&prefix.length===1){failed=true;const error=new WorkFailure('local_batch_failed');error.created_local_files=prefix;throw error;}
        assert(!local.has(row.path));local.set(row.path,row.bytes.slice());prefix.push({relative_path:row.path,bytes:row.bytes.length,sha256:await workHash(row.bytes)});
      }
      return rows.map(x=>'/private/run/'+x.path);
    }};
  const collector={list:async({namespace})=>({export_format_version:1,namespace,items:await Promise.all([...source].filter(([k])=>k.startsWith(namespace+'/')).map(async([key,b])=>({key,size:b.length,sha256:await workHash(b)}))),enumeration_complete:true,next_cursor:null,transactional_snapshot:false}),
    chunk:async({key,offset,max_bytes})=>{
      if(fault==='acquisition'&&key.endsWith('0002.json'))throw new WorkFailure('synthetic_acquisition_failed');
      const all=source.get(key),b=all.slice(offset,offset+max_bytes);calls.push({kind:'read',key,offset});
      return {export_format_version:1,key,offset,encoding:'base64',object_size:all.length,object_sha256:await workHash(all),bytes:b.length,body_base64:Buffer.from(fault==='validation'&&key.endsWith('0002.json')?new Uint8Array(b.length).fill(66):b).toString('base64'),next_offset:offset+b.length,object_complete:offset+b.length===all.length};
    }};
  const drive={assertPrivate:async()=>({verified:true,owner_only:true,evidence_refs:['synthetic:scope']}),create:async(name,bytes)=>{const id='remote-'+(++next);remote.set(id,bytes.slice());names.set(id,name);return {id,url:'https://synthetic.test/'+id};},read:async id=>remote.get(id)};
  let analysisInput;
  const analyze=async input=>{analysisInput=input;for(const o of input.objects)assert.deepEqual(local.get(o.local_path),source.get(o.key),'inventory only contains durable exact raw copies');return {report:{status:Object.values(input.config.source_completeness).every(Boolean)?'complete':'incomplete',traffic:{sessions:0},mail_counts:{received_inquiries:0}},artifacts:Array.from({length:70},(_,i)=>({name:'synthetic-'+i+'.json',bytes:workJSON({synthetic:true,index:i})}))};};
  const result=await runLeadPipeline({runId:'synthetic-local-batch-'+crypto.randomUUID(),config,collector,journal,drive,analyze,mail:{list:async()=>({message_ids:[],enumeration_complete:true,next_cursor:null})},classify:async()=>({complete:true,observations:[],evidence_refs:['synthetic:no-mail']}),now:()=>at});
  return {result,source,local,remote,names,calls,analysisInput};
}

test('bounded groups preserve all raw bytes and batch analysis with explicit durability before inventory',async()=>{
  const f=await fixture();assert.equal(f.result.status,'complete');assert.equal(f.analysisInput.objects.length,24);
  const batches=f.calls.filter(x=>x.kind==='batch');assert.equal(batches.filter(x=>x.paths[0].startsWith('raw/collector/')).length,3);
  assert.equal(batches.filter(x=>x.paths[0].startsWith('analysis/')).length,2);
  for(const [key,bytes]of f.source)assert.deepEqual(f.local.get('raw/collector/'+key),bytes);
  for(const batch of batches.filter(x=>x.paths[0].startsWith('raw/collector/'))){
    const index=f.calls.indexOf(batch);assert(f.calls.slice(0,index).some(x=>x.kind==='batch'&&x.paths.every(p=>p.includes('collector-chunk'))),'chunk observations must be durable first');
  }
});

test('acquisition failure flushes original responses and valid raw prefix before declaring source incomplete',async()=>{
  const f=await fixture({fault:'acquisition'});assert.equal(f.result.status,'partial');
  assert(f.result.failures.some(x=>x.reason==='synthetic_acquisition_failed'));
  assert.equal(f.analysisInput.config.source_completeness.collector,false);assert.equal(f.analysisInput.objects.length,2);
  assert.equal([...f.local].filter(([k])=>k.startsWith('raw/collector/')).length,2);
  assert([...f.local].some(([k,b])=>k.includes('collector-acquisition-failure')&&decode(b).reason==='synthetic_acquisition_failed'));
});

test('validation failure retains every acquired response and exact valid prefix without healthy zero',async()=>{
  const f=await fixture({fault:'validation'});assert.equal(f.result.status,'partial');
  assert(f.result.failures.some(x=>x.reason==='collector_object_hash_mismatch'));
  assert.equal([...f.local.keys()].filter(k=>k.includes('collector-chunk')).length,8);
  assert.equal(f.analysisInput.objects.length,2);assert.equal(f.analysisInput.config.source_completeness.collector,false);
});

test('verified prefix of failed local batch remains in archive file map and failure cannot complete',async()=>{
  const f=await fixture({fault:'local-prefix'});assert.equal(f.result.status,'partial');
  assert(f.result.failures.some(x=>x.reason==='local_batch_failed'));
  const raw=[...f.local].filter(([k])=>k.startsWith('raw/collector/'));assert.equal(raw.length,1);
  const manifest=decode(f.remote.get(f.result.manifest.id)),entry=manifest.files.find(x=>x.path===raw[0][0]);assert(entry);
  assert.deepEqual(f.remote.get(entry.id),raw[0][1]);assert.equal(f.analysisInput.objects.length,0);
  assert(![...f.names.values()].some(x=>x.endsWith('-completed.json')));
});

test('large records retain per-chunk path and do not exceed bounded batch limits',async()=>{
  const f=await fixture({large:true,count:10});assert.equal(f.result.status,'complete');
  const key=[...f.source.keys()][0];assert.deepEqual(f.calls.filter(x=>x.kind==='read'&&x.key===key).map(x=>x.offset),[0,8192,16384]);
  assert(f.calls.some(x=>x.kind==='single'&&x.paths[0]==='raw/collector/'+key));
});
