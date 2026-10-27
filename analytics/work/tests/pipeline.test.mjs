import test from 'node:test';
import assert from 'node:assert/strict';
import {runLeadPipeline,verifyRemoteRun,evaluateWatchdog,workHash,workJSON,WorkFailure,renderLeadReport} from '../pipeline.mjs';
import {createNativeAdapters,createFrozenClassifier,workToolValue} from '../native-adapters.mjs';

const at='2026-10-23T20:00:00.000Z';
const config={job:{id:'synthetic-archive',version:'1',scope_id:'synthetic-rfq',kind:'archive'},window_start:'2026-10-23T00:00:00.000Z',window_end:'2026-10-24T00:00:00.000Z'};
const b64=data=>Buffer.from(data).toString('base64');
async function fixture(options={}){
  const local=new Map(),remote=new Map(),remoteNames=new Map(),source=new Map();let id=0;
  for(let i=0;i<7;i++){const key=`receipts/2026/10/23/synthetic-record-${String(i).padStart(8,'0')}.json`;source.set(key,workJSON({synthetic:true,padding:i===6?'x'.repeat(18000):String(i)}));}
  const collector={
    list:async({namespace,cursor,limit})=>{
      if(options.budget&&limit>2)throw new WorkFailure('page_budget_exceeded_retry_smaller_limit');
      const keys=[...source.keys()].filter(k=>k.startsWith(namespace+'/')).sort();const p=cursor?Number(cursor):0,selected=keys.slice(p,p+2);
      return {export_format_version:1,namespace,items:await Promise.all(selected.map(async key=>({key,size:source.get(key).length,sha256:await workHash(source.get(key))}))),enumeration_complete:p+2>=keys.length,next_cursor:p+2<keys.length?(options.loop?'2':String(p+2)):null,transactional_snapshot:false};
    },
    chunk:async({key,offset,max_bytes})=>{const bytes=source.get(key),part=bytes.slice(offset,offset+max_bytes);return {export_format_version:1,key,encoding:'base64',offset,bytes:part.length,object_size:bytes.length,object_sha256:await workHash(bytes),body_base64:b64(options.badChunk&&offset?part.map(x=>x^1):part),next_offset:offset+part.length,object_complete:offset+part.length===bytes.length};}
  };
  const journal={create:async(path,bytes)=>{assert(!local.has(path),'no local replacement');local.set(path,bytes.slice());}};
  const drive={assertPrivate:async()=>({verified:true,owner_only:!options.shared,evidence_refs:['synthetic:privacy']}),create:async(name,bytes)=>{const key=`drive-${++id}`;remote.set(key,bytes.slice());remoteNames.set(key,name);if(options.ambiguous&&name.endsWith('remote-manifest.json'))throw Error('ambiguous synthetic upload');return{id:key,url:`https://drive.example/${key}`};},read:async key=>{let bytes=remote.get(key);if(options.corruptUpload&&remoteNames.get(key)?.endsWith('remote-manifest.json'))bytes=bytes.slice(0,-1);return bytes?.slice();}};
  const capture={observation_id:'test-observation',mailbox:'synthetic@example.test',message_id:'message-1',received_at:at,captured_at:at,body:'synthetic',headers:[],attachments:[],message_content_sha256:'0'.repeat(64)};
  const mail={list:async()=>({message_ids:options.withMail?['message-1']:[],next_cursor:null,enumeration_complete:true}),capture:async()=>({complete:!options.badMail,capture,artifacts:[{name:'message.eml',bytes:workJSON({synthetic:'mail'})}]})};
  const classify=createFrozenClassifier({});
  const analyze=async ({config:cfg})=>({report:{status:Object.values(cfg.source_completeness).every(x=>x===true)?'complete':'incomplete',...config,observation_cutoff:at,traffic:{sessions:0},mail_counts:{received_inquiries:0},stage_reach:{},warnings:[]},artifacts:[{name:'source.json',bytes:workJSON({synthetic:true})}]});
  const args={runId:'synthetic-run-0001',config,collector,mail,classify,analyze,journal,drive,now:()=>at};
  return {args,local,remote,remoteNames,source};
}

test('full rescan crosses pages and chunk limits; remote completion verifies every byte',async()=>{
  const f=await fixture({budget:true});const r=await runLeadPipeline(f.args);assert.equal(r.status,'complete');
  const v=await verifyRemoteRun({completionId:r.completion.id,drive:f.args.drive});assert.equal(v.full_content_verification,true);
  assert.equal([...f.local.keys()].filter(x=>x.startsWith('raw/collector/receipts/')).length,7);
  for(const [key,bytes]of f.source)assert.deepEqual(f.local.get('raw/collector/'+key),bytes);
  assert.equal(v.manifest.source_snapshot_claim,'exact listed inputs; not a transactional source snapshot');
});
test('repeated cursor produces partial diagnostics; no completed record',async()=>{
  const f=await fixture({loop:true});const r=await runLeadPipeline(f.args);assert.equal(r.status,'partial');assert(r.failures.some(x=>x.reason==='repeated_collector_cursor'));assert(![...f.remoteNames.values()].some(x=>x.endsWith('-completed.json')));
});
test('corrupt chunk cannot enter verified source inventory',async()=>{
  const f=await fixture({badChunk:true});const r=await runLeadPipeline(f.args);assert.equal(r.status,'partial');assert(r.failures.some(x=>x.reason==='collector_object_hash_mismatch'));assert.equal([...f.local.keys()].filter(x=>x.startsWith('raw/collector/')).length,6);
});
test('bad mail retains available original artifact and is incomplete',async()=>{
  const f=await fixture({withMail:true,badMail:true});const r=await runLeadPipeline(f.args);assert.equal(r.status,'partial');assert(f.local.has('raw/mail/message-1/message.eml'));assert(r.failures.some(x=>x.stage==='mail-message'));
});
test('unclassified captured mail is explicitly unresolved, not a lead',async()=>{
  const f=await fixture({withMail:true});const r=await runLeadPipeline(f.args);assert.equal(r.report_authority,'needs_review');assert.equal(r.status,'complete');const rows=JSON.parse(new TextDecoder().decode(f.local.get('inputs/classifications.json')));assert.equal(rows.length,1);assert.equal(rows[0].kind,'unresolved');assert.equal(rows[0].status,'confirmed');
});
test('shared destination stops before creating remote data',async()=>{
  const f=await fixture({shared:true});const r=await runLeadPipeline(f.args);assert.equal(r.status,'failed');assert.equal(r.reason,'private_destination_unverified');assert.equal(f.remote.size,0);
});
test('ambiguous upload preserves created objects and cannot advance completion',async()=>{
  const f=await fixture({ambiguous:true});const r=await runLeadPipeline(f.args);assert.equal(r.status,'failed');assert(f.remote.size>2);assert([...f.remoteNames.values()].some(x=>x.endsWith('-remote-manifest.json')));assert(![...f.remoteNames.values()].some(x=>x.endsWith('-completed.json')));
});
test('remote readback corruption prevents completion',async()=>{
  const f=await fixture({corruptUpload:true});const r=await runLeadPipeline(f.args);assert.equal(r.status,'failed');assert.equal(r.reason,'drive_readback_mismatch');assert(![...f.remoteNames.values()].some(x=>x.endsWith('-completed.json')));
});
test('native whole-download integrity proof replaces bulk transport without skipping readback',async()=>{
  const f=await fixture();let downloads=0;
  f.args.drive.verifyFile=async(id,expected)=>{const bytes=await f.args.drive.read(id);downloads++;return {id,verified:true,bytes:bytes.length,sha256:await workHash(bytes)};};
  const r=await runLeadPipeline(f.args);assert.equal(r.status,'complete');assert.equal(downloads,f.remote.size);
});
test('native download proof with wrong bytes cannot produce a completed run',async()=>{
  const f=await fixture();f.args.drive.verifyFile=async(id,expected)=>({id,verified:true,bytes:expected.bytes+1,sha256:expected.sha256});
  const r=await runLeadPipeline(f.args);assert.equal(r.status,'failed');assert.equal(r.reason,'drive_readback_mismatch');assert(![...f.remoteNames.values()].some(x=>x.endsWith('-completed.json')));
});
test('later remote byte change fails independent recovery verification',async()=>{
  const f=await fixture();const r=await runLeadPipeline(f.args);const v=await verifyRemoteRun({completionId:r.completion.id,drive:f.args.drive});f.remote.set(v.manifest.files[0].id,workJSON({altered:true}));await assert.rejects(()=>verifyRemoteRun({completionId:r.completion.id,drive:f.args.drive}),/remote_file_integrity/);
});
test('watchdog ignores partial completion and exposes missed intervals/common-mode limit',async()=>{
  const f=await fixture({loop:true});const r=await runLeadPipeline(f.args);const h=await evaluateWatchdog({expectedIntervals:[{...config,start:'2026-10-23T19:00:00Z',end:'2026-10-23T21:00:00Z'}],completionIds:[r.completion.id],drive:f.args.drive,now:'2026-10-23T21:15:00Z'});assert.equal(h.status,'warning');assert.equal(h.missed_intervals.length,1);assert.equal(h.invalid_completion_records.length,1);assert.match(h.warning,/Work-wide outage/);
});
test('native mail parser failure preserves both connector and raw RFC2822 evidence',async()=>{
  const raw=b64(workJSON({malformed:'mail'})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const adapters=createNativeAdapters({tools:{mcp__codex_apps__gmail_read_email:async()=>({structuredContent:{id:'m',raw,internalDate:'1'}})},local:{normalizeMail:async()=>{throw Error('bad MIME');}},settings:{mailbox:'synthetic@example.test'},classify:()=>{},analyze:()=>{}});
  const capture=await adapters.mail.capture('m');assert.equal(capture.complete,false);assert.deepEqual(capture.artifacts.map(x=>x.name),['connector.json','message.eml']);
});
test('native raw mail supplements missing receipt date with same-message provider metadata',async()=>{
  const raw=b64(workJSON({synthetic:'mail'})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const calls=[];let normalization;
  const adapters=createNativeAdapters({tools:{mcp__codex_apps__gmail_read_email:async args=>{calls.push(args);return {structuredContent:args.format==='raw'?{id:'m',thread_id:'t',raw,internal_date:null}:{id:'m',thread_id:'t',internal_date:'1792631929000'}};}},local:{normalizeMail:async args=>{normalization=args;return {complete:true,capture:{message_id:'m'},artifacts:[]};}},settings:{mailbox:'synthetic@example.test',gmail_link_id:'synthetic-link'}});
  const capture=await adapters.mail.capture('m');assert.equal(capture.complete,true);
  assert.deepEqual(calls.map(x=>x.format),['raw','metadata']);assert.equal(normalization.internal_date,'1792631929000');
  assert.deepEqual(capture.artifacts.map(x=>x.name),['metadata-connector.json']);
});
test('wrong-message receipt metadata fails closed while raw bytes and metadata survive',async()=>{
  const raw=b64(workJSON({synthetic:'mail'})).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
  const adapters=createNativeAdapters({tools:{mcp__codex_apps__gmail_read_email:async args=>({structuredContent:args.format==='raw'?{id:'m',thread_id:'t',raw}:{id:'other',thread_id:'t',internal_date:'1792631929000'}})},local:{normalizeMail:async()=>{throw Error('must not normalize');}},settings:{mailbox:'synthetic@example.test'}});
  const capture=await adapters.mail.capture('m');assert.equal(capture.complete,false);assert.equal(capture.reason,'mail_metadata_message_mismatch');assert.deepEqual(capture.artifacts.map(x=>x.name),['connector.json','message.eml','metadata-connector.json']);
});
test('tool-level export errors cannot become successful pagination',()=>{assert.throws(()=>workToolValue({isError:true,content:[{type:'text',text:'secret provider detail'}]}),/connector_error/);});
test('report makes missing attribution and unavailable employer explicit',()=>{const s=renderLeadReport({status:'incomplete',warnings:[]});assert.match(s,/Attribution tables unavailable/);assert.match(s,/Company matching unavailable/);assert.match(s,/does not establish inbox delivery/);});
test('report separates daily receipt and session-cohort counts from historical inquiry totals',()=>{
  const s=renderLeadReport({traffic:{sessions:3},mail_counts:{received_in_window:2,cohort_received_inquiries:1,received_inquiries:101,matched_website_inquiries:82,unattributed_inquiries:19}});
  assert.match(s,/Sessions starting in this window: 3; inquiries received in this window: 2; received inquiries matched to this session cohort through the observation cutoff: 1/);
  assert.match(s,/Across all captured history through the cutoff: received inquiries 101; website-matched inquiries 82; unattributed inquiries 19/);
});
test('schema-compatible historical Work archive verifies but unknown or mixed versions fail',async()=>{
  const f=await fixture();const r=await runLeadPipeline(f.args);
  const c=JSON.parse(new TextDecoder().decode(f.remote.get(r.completion.id)));
  const m=JSON.parse(new TextDecoder().decode(f.remote.get(c.manifest.id)));
  async function replaceSyntheticVersions(completionVersion,manifestVersion){
    c.work_version=completionVersion;m.work_version=manifestVersion;
    const mb=workJSON(m);f.remote.set(c.manifest.id,mb);c.manifest.bytes=mb.length;c.manifest.sha256=await workHash(mb);f.remote.set(r.completion.id,workJSON(c));
  }
  // In-memory fault fixtures only; no stored evidence or remote files are changed.
  await replaceSyntheticVersions('farpoint-work/1.0.0','farpoint-work/1.0.0');
  assert.equal((await verifyRemoteRun({completionId:r.completion.id,drive:f.args.drive})).status,'verified');
  await replaceSyntheticVersions('farpoint-work/1.0.0','farpoint-work/1.0.1');
  await assert.rejects(()=>verifyRemoteRun({completionId:r.completion.id,drive:f.args.drive}),/remote_manifest_scope_mismatch/);
  await replaceSyntheticVersions('farpoint-work/9.9.9','farpoint-work/9.9.9');
  await assert.rejects(()=>verifyRemoteRun({completionId:r.completion.id,drive:f.args.drive}),/remote_manifest_scope_mismatch/);
});
test('analysis failure still archives acquired raw data without issuing completion',async()=>{const f=await fixture();f.args.analyze=async()=>{throw Error('synthetic analysis failure');};const r=await runLeadPipeline(f.args);assert.equal(r.status,'failed');assert([...f.remoteNames.values()].some(x=>x.includes('partial-raw--collector--receipts')));assert(![...f.remoteNames.values()].some(x=>x.endsWith('-completed.json')));});
test('native read refuses a newly shared file even in the right archive folder',async()=>{const adapters=createNativeAdapters({tools:{mcp__codex_apps__google_drive_get_file_metadata:async()=>({structuredContent:{id:'f',parent_ids:['folder'],url:'https://drive.example/f',shared:true,permissions:[{type:'user',role:'owner',emailAddress:'owner@example.test'}]}})},local:{},settings:{archive_folder_id:'folder',owner_email:'owner@example.test'}});await assert.rejects(()=>adapters.drive.read('f'),/drive_read_scope_mismatch/);});
test('watchdog rejects a current run with a stale reporting window or wrong job identity',async()=>{const f=await fixture();const r=await runLeadPipeline(f.args);for(const expected of [{...config,window_start:'2026-10-22T00:00:00Z',window_end:'2026-10-23T00:00:00Z'},{...config,job:{...config.job,id:'different-job'}}]){const h=await evaluateWatchdog({expectedIntervals:[{...expected,start:'2026-10-23T19:00:00Z',end:'2026-10-23T21:00:00Z'}],completionIds:[r.completion.id],drive:f.args.drive,now:'2026-10-23T21:15:00Z',canary:{status:'verified'}});assert.equal(h.missed_intervals.length,1);assert.equal(h.status,'warning');}});
test('duplicate listed object with changed size makes source incomplete',async()=>{const f=await fixture();const old=f.args.collector.list;let first;f.args.collector.list=async args=>{const p=await old(args);if(args.namespace==='receipts'){if(!first)first=p.items[0];else if(p.items.length)p.items.push({...first,size:first.size+1});}return p;};const r=await runLeadPipeline(f.args);assert.equal(r.status,'partial');assert(r.failures.some(x=>x.reason==='conflicting_source_object'));});
test('unreviewed report run cannot satisfy an expected report job',async()=>{const f=await fixture({withMail:true});f.args.config={...config,job:{...config.job,id:'synthetic-weekly-report',kind:'report'}};const r=await runLeadPipeline(f.args);assert.equal(r.status,'complete');assert.equal(r.report_authority,'needs_review');const h=await evaluateWatchdog({expectedIntervals:[{...f.args.config,start:'2026-10-23T19:00:00Z',end:'2026-10-23T21:00:00Z'}],completionIds:[r.completion.id],drive:f.args.drive,now:'2026-10-23T21:15:00Z',canary:{status:'verified'}});assert.equal(h.missed_intervals.length,1);assert.deepEqual(h.unreviewed_report_runs,[r.run_id]);});
test('frozen classifier refuses reviewed observations without archived review metadata',()=>{assert.throws(()=>createFrozenClassifier({observations:[{message_id:'m'}]}),/classification_review_metadata_required/);});

test('report JSON carries authority for direct consumers',async()=>{const f=await fixture({withMail:true});await runLeadPipeline(f.args);const report=JSON.parse(new TextDecoder().decode(f.local.get('report/report.json')));assert.equal(report.report_authority,'needs_review');assert.deepEqual(report.unreviewed_message_ids,['message-1']);assert.deepEqual(report.work_report.job,config.job);});
test('reviewed rerun satisfies report interval without erasing earlier pending history',async()=>{
  const f=await fixture({withMail:true});f.args.config={...config,job:{...config.job,id:'synthetic-report',kind:'report'}};
  const first=await runLeadPipeline(f.args);
  const local2=new Map();f.args.journal={create:async(p,b)=>{assert(!local2.has(p));local2.set(p,b.slice());}};
  f.args.runId='synthetic-run-0002';f.args.classify=async({captures})=>({complete:true,evidence_refs:['synthetic:review'],unreviewed_message_ids:[],observations:captures.map(x=>({...x,kind:'noise',status:'confirmed'}))});
  const second=await runLeadPipeline(f.args);
  const h=await evaluateWatchdog({expectedIntervals:[{...f.args.config,start:'2026-10-23T19:00:00Z',end:'2026-10-23T21:00:00Z'}],completionIds:[first.completion.id,second.completion.id],drive:f.args.drive,now:'2026-10-23T21:15:00Z',canary:{status:'verified'}});
  assert.equal(h.status,'healthy');assert.deepEqual(h.unreviewed_report_runs,[]);assert.deepEqual(h.historical_unreviewed_archive_runs,[first.run_id]);
});
test('mid-archive failure records all known IDs and readback failure without inventing verification',async()=>{
  const f=await fixture();const read=f.args.drive.read;let targetId=null,failed=false;
  f.args.drive.read=async id=>{if(!failed&&f.remoteNames.get(id)?.endsWith('raw--collector--receipts--2026--10--23--synthetic-record-00000001.json')){targetId=id;failed=true;throw Error('synthetic readback unavailable');}return read(id);};
  const r=await runLeadPipeline(f.args);assert.equal(r.status,'failed');const evidence=JSON.parse(new TextDecoder().decode(f.remote.get(r.failure_record.id)));
  const failedRef=evidence.remote_observations.find(x=>x.id===targetId);assert.equal(failedRef.verified,false);assert.equal(failedRef.state,'created_unverified');assert.match(failedRef.path,/00000001/);
  const prior=[...f.remote.keys()].filter(id=>Number(id.slice(6))<Number(targetId.slice(6)));for(const id of prior)assert(evidence.remote_observations.some(x=>x.id===id&&x.verified===true));
  assert(evidence.remote_observations.some(x=>x.path===failedRef.path&&x.id!==targetId&&x.verified===true));
});
test('ambiguous create outcome is retained explicitly for remote inventory recovery',async()=>{const f=await fixture({ambiguous:true});const r=await runLeadPipeline(f.args);const evidence=JSON.parse(new TextDecoder().decode(f.remote.get(r.failure_record.id)));assert(evidence.ambiguous_remote_creates.some(x=>x.name.endsWith('remote-manifest.json')&&x.id===null&&x.state==='create_outcome_unknown'));});

test('native upload ID survives post-create metadata failure and enters pipeline failure evidence',async()=>{
  const local=[];const a=createNativeAdapters({tools:{mcp__codex_apps__google_drive_upload_file:async()=>({structuredContent:{id:'uploaded-known-id',url:'https://drive.example/uploaded-known-id'}}),mcp__codex_apps__google_drive_get_file_metadata:async()=>{throw Error('synthetic metadata failure');}},local:{create:async(p,b)=>{local.push(p);return p;}},settings:{archive_folder_id:'folder',owner_email:'owner@example.test'}});
  let failure;try{await a.drive.create('synthetic.json',workJSON({synthetic:true}));}catch(e){failure=e;}
  assert.equal(failure.created_file.id,'uploaded-known-id');assert(local.some(p=>p.startsWith('adapter-evidence/drive-create-')));
  const f=await fixture();const create=f.args.drive.create;let first=true;f.args.drive.create=async(...args)=>{if(first){first=false;throw failure;}return create(...args);};
  const result=await runLeadPipeline(f.args);assert.equal(result.status,'failed');const evidence=JSON.parse(new TextDecoder().decode(f.remote.get(result.failure_record.id)));assert(evidence.remote_observations.some(x=>x.id==='uploaded-known-id'&&!x.verified));
});

test('reusing byte-verified automatic defaults does not silently become classification review',async()=>{
  const capture={mailbox:'synthetic@example.test',message_id:'m',message_content_sha256:'0'.repeat(64),observation_id:'synthetic-capture'};
  const first=await createFrozenClassifier({})({captures:[capture],observed_at:at});assert.equal(first.observations[0].review_state,'unreviewed');
  const metadata={prompt:'synthetic review prompt',model:{id:'synthetic-model'},reviewed_at:at,rule_version:'synthetic-rule',code_commit:'0'.repeat(40)};
  const second=await createFrozenClassifier({observations:first.observations,reviewMetadata:metadata})({captures:[capture],observed_at:at});assert.deepEqual(second.unreviewed_message_ids,['m']);assert.equal(second.observations[0].classification_id,first.observations[0].classification_id);
  const reviewed={...first.observations[0],classification_id:'new-explicit-review',review_state:'reviewed',classified_at:'2026-10-23T20:01:00.000Z'};
  const third=await createFrozenClassifier({observations:[...second.observations,reviewed],reviewMetadata:metadata})({captures:[capture],observed_at:at});assert.deepEqual(third.unreviewed_message_ids,['m']);assert.equal(third.observations.length,2);
  const fourth=await createFrozenClassifier({observations:third.observations,reviewMetadata:metadata})({captures:[capture],observed_at:'2026-10-23T20:02:00Z'});assert.deepEqual(fourth.unreviewed_message_ids,[]);
});

test('submillisecond future review is archived but cannot clear current pending gate',async()=>{
  const capture={mailbox:'synthetic@example.test',message_id:'m',message_content_sha256:'0'.repeat(64),observation_id:'synthetic-capture'};
  const review={...capture,classification_id:'future-review',classified_at:'2026-10-23T20:00:00.000001Z',review_state:'reviewed',kind:'unresolved'};
  const metadata={prompt:'synthetic',model:{id:'synthetic'},reviewed_at:at,rule_version:'synthetic',code_commit:'0'.repeat(40)};
  const result=await createFrozenClassifier({observations:[review],reviewMetadata:metadata})({captures:[capture],observed_at:at});assert.deepEqual(result.unreviewed_message_ids,['m']);assert.equal(result.observations[0].classified_at,review.classified_at);
});
