/* Integration smoke: actual tracker -> actual collector -> chunks -> Python parser.
 * This is synthetic, local execution. It does not certify a hosted network path.
 */
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,webcrypto} from 'node:crypto';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createCollector,sha256} from '../../collector/core.mjs';

const require=createRequire(import.meta.url),createTracker=require('../../../tracker.js');
const root=fileURLToPath(new URL('../../../',import.meta.url));
const directory=new URL(`./evidence/integration-${randomUUID()}/`,import.meta.url);
await mkdir(directory,{recursive:true});
const bytes=new Map(),encoder=new TextEncoder(),records=[],chunks=[];
const storage={
  async create(key,value){if(bytes.has(key))return{created:false};bytes.set(key,value.slice());return{created:true};},
  async list(prefix,cursor,limit){const keys=[...bytes.keys()].filter(k=>k.startsWith(prefix)&&(!cursor||k>cursor)).sort(),selected=keys.slice(0,limit);return{items:await Promise.all(selected.map(async key=>({key,size:bytes.get(key).length,sha256:await sha256(bytes.get(key))}))),truncated:keys.length>selected.length,cursor:keys.length>selected.length?selected.at(-1):null};},
  async readChunk(key,offset,length){if(!bytes.has(key))return null;const value=bytes.get(key);return{bytes:value.slice(offset,offset+length),size:value.length,sha256:await sha256(value)};}
};
const endpoint='https://synthetic-collector.example/v1/events',origin='https://farpointenergy.com',owner='synthetic-owner',received='2026-10-23T12:00:00.000Z';
let next=0,wrongAck=true,posted=[];
const collector=createCollector({store:storage,newId:()=>`synthetic-cross-${String(++next).padStart(3,'0')}`,now:()=>new Date(received),ownerIdentity:owner,verifiedGatewayIdentity:true,cursorHmacKey:'synthetic-only-cross-language-cursor-key-at-least32'});
const local=new Map(),localStorage={get length(){return local.size;},key:i=>[...local.keys()][i]??null,getItem:k=>local.get(k)??null,setItem:(k,v)=>local.set(k,v),removeItem:k=>local.delete(k)};
const tracker=createTracker({crypto:webcrypto,Date:{now:()=>Date.parse(received)},localStorage,location:{href:origin+'/quote.html'},document:{referrer:'',addEventListener(){}},AbortController,addEventListener(){},fetch:async(url,init)=>{
  posted.push(init.body);
  const response=await collector.fetch(new Request(url,{method:'POST',body:init.body,headers:{...init.headers,Origin:origin}}));
  const data=await response.json();if(wrongAck){data.receipt_body_sha256='0'.repeat(64);wrongAck=false;}
  const browserResponse=new Response(JSON.stringify(data),{status:response.status,headers:response.headers});Object.defineProperty(browserResponse,'url',{value:endpoint});return browserResponse;
}}, {enabled:true,endpoint,privacy_disclosure_version:'1',synthetic:true,campaign_registry:{source:[],medium:[],campaign:[]}});
tracker.start();assert.equal(tracker.pendingCount(),2);
assert.equal(await tracker.flush(),false);assert.equal(tracker.pendingCount(),2);assert.equal(bytes.size,1);
assert.equal(await tracker.flush(),true);assert.equal(tracker.pendingCount(),0);assert.equal(bytes.size,2);assert.equal(posted[0],posted[1]);
const malformed=encoder.encode('{"schema_version":1,"events":[');
assert.equal((await collector.fetch(new Request(endpoint,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:malformed}))).status,202);
async function tool(name,args){const response=await collector.fetch(new Request('https://synthetic-collector.example/mcp',{method:'POST',headers:{'oai-authenticated-user-id':owner},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}));assert.equal(response.status,200);const rpc=await response.json();assert.equal(rpc.result.isError,false);return rpc.result.structuredContent;}
let cursor=null;
do {
  const page=await tool('list_records',{namespace:'receipts',limit:1,cursor});
  for(const item of page.items){let offset=0;const pieces=[];
    for(;;){const frame=await tool('read_record_chunk',{key:item.key,offset,max_bytes:113});chunks.push(frame);assert.equal(frame.offset,offset);assert.equal(frame.object_sha256,item.sha256);pieces.push(Buffer.from(frame.body_base64,'base64'));offset=frame.next_offset;if(frame.object_complete)break;}
    const full=Buffer.concat(pieces);assert.equal(full.length,item.size);assert.equal(await sha256(full),item.sha256);assert.deepEqual(full,Buffer.from(bytes.get(item.key)));records.push(JSON.parse(full));
  }
  cursor=page.next_cursor;
}while(cursor);
assert.equal(records.length,3);
const eventIds=JSON.parse(posted[0]).events.map(e=>e.event_id);
const config={window_start:'2026-10-23T00:00:00Z',window_end:'2026-10-24T00:00:00Z',observation_cutoff:'2026-10-24T00:00:00Z',mode:'isolated_fixture',fixture_eligible_event_ids:eventIds};
await writeFile(new URL('input.json',directory),JSON.stringify({records,config,chunks}),{flag:'wx'});
const sourceFiles=['tracker.js','analytics/collector/core.mjs','analytics/tests/collector/cross-language.mjs','analytics/python/farpoint_analytics/analysis.py','analytics/python/farpoint_analytics/schema.py','analytics/python/farpoint_analytics/canonical.py','analytics/python/farpoint_analytics/schema-v1.json'];
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async file=>[file,await sha256(await readFile(root+file))])));
await writeFile(new URL('source-manifest.json',directory),JSON.stringify(sourceHashes,null,2),{flag:'wx'});
const python=`import json,pathlib,sys\nfrom farpoint_analytics.analysis import derive_events\np=pathlib.Path(sys.argv[1]);f=json.loads((p/'input.json').read_text());r=derive_events(f['records'],f['config'])\nassert r['counts']['raw_receipts']==3,r['counts']\nassert r['counts']['valid_event_occurrences']==4,r['counts']\nassert r['counts']['unique_valid_event_ids']==2,r['counts']\nassert r['counts']['duplicate_occurrences']==2,r['counts']\nassert r['counts']['trusted_events']==2,r['counts']\nassert len(r['integrity_errors'])==0,r['integrity_errors']\nassert [x['event']['event_name'] for x in sorted(r['events'],key=lambda x:x['event']['sequence'])]==['page_view','quotation_view']\nassert sum(x['status']=='quarantined' for x in r['receipt_results'])==1,r['receipt_results']\nwith (p/'python-result.json').open('x') as out:json.dump(r,out,indent=2,sort_keys=True)\nprint(json.dumps({'status':'PASS','counts':r['counts'],'scope':'local tracker-collector-chunk-Python integration'}))\n`;
const child=spawnSync('python3',['-c',python,fileURLToPath(directory)],{cwd:root,env:{...process.env,PYTHONPATH:root+'analytics/python'},encoding:'utf8'});
await writeFile(new URL('execution.json',directory),JSON.stringify({scope:'synthetic_local_only',node:process.version,stdout:child.stdout,stderr:child.stderr,exit_code:child.status,source_sha256:await sha256(encoder.encode(python))},null,2),{flag:'wx'});
assert.equal(child.status,0,child.stderr||child.stdout);
console.log(child.stdout.trim());console.log(`Evidence: ${fileURLToPath(directory)}`);
