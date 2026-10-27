import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {runLeadPipeline,verifyRemoteRun,evaluateWatchdog,workJSON,workHash,workUnbase64,WorkFailure} from '../pipeline.mjs';
import {createNativeAdapters} from '../native-adapters.mjs';
import {closeWorkArchive} from '../archive-closure.mjs';

const repository=resolve(new URL('../../../',import.meta.url).pathname);
const at='2026-10-27T12:00:00.000Z',commit='a'.repeat(40);
const evidence=process.env.FARPOINT_TEST_EVIDENCE_DIR??'/workspace/scratch/farpoint-packed-tests';
const decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
const config={archive_mode:'packed_journal_v1',execution_code_commit:commit,mode:'production',
  job:{id:'synthetic-packed',version:'1',scope_id:'synthetic',kind:'report'},
  window_start:'2026-10-26T00:00:00.000Z',window_end:at};

async function fixture(fault=null){
  const root=join(evidence,crypto.randomUUID()),remote=new Map(),names=new Map();let next=0;
  await mkdir(root,{recursive:true});await mkdir(join(root,'remote'));
  const settings={archive_folder_id:'synthetic-folder',owner_email:'owner@example.test',mail_query:'in:anywhere synthetic',mailbox:'owner@example.test'};
  const createLocal=({privateRoot})=>{
    function rpc(request){
      const result=spawnSync('python3',[join(repository,'analytics/work/local_bridge.py'),'--root',privateRoot,'--repository',repository],{input:JSON.stringify(request)+'\n',encoding:'utf8',maxBuffer:20*1024*1024});
      const response=JSON.parse(result.stdout.split('\n').slice(1).join('\n').trim());
      if(response.status!=='ok')throw new WorkFailure(response.reason??'private_bridge_failed');return response;
    }
    return {
      create:async(path,bytes)=>{const p=join(privateRoot,path);await mkdir(resolve(p,'..'),{recursive:true});await writeFile(p,bytes,{flag:'wx'});return p;},
      packJournal:async({runId,sourceCommit,entries})=>rpc({op:'pack_journal',run_id:runId,source_commit:sourceCommit,entries}).archive,
      verifyJournal:async args=>rpc({op:'verify_journal',...args,run_id:args.runId,source_commit:args.sourceCommit}).verification,
      readFileReference:async response=>new Uint8Array(await readFile(response.privatePath)),
      verifyFileReference:async({response,expectedBytes,expectedSha256})=>{
        const bytes=new Uint8Array(await readFile(response.privatePath));
        if(bytes.length!==expectedBytes||await workHash(bytes)!==expectedSha256)throw new WorkFailure('drive_readback_mismatch');
        const path=join(privateRoot,'verified-downloads',crypto.randomUUID()+'.bin');await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,bytes,{flag:'wx'});
        return {verified:true,path,bytes:bytes.length,sha256:await workHash(bytes)};
      },
      analyze:async({objects,captures,classifications,config,readLocal})=>{
        if(fault==='analysis')throw new WorkFailure('synthetic_analysis_failed');
        const v=rpc({op:'analyze',objects:objects.map(x=>({...x,base64:Buffer.from(readLocal(x.local_path)).toString('base64')})),captures,classifications,config,code_commit:commit,company_observations:[]});
        return {report:v.report,artifacts:v.artifacts.map(x=>({name:x.name,bytes:workUnbase64(x.base64)}))};
      },
      captureClosureSource:async()=>rpc({op:'capture_closure_source'}),
      packEvidence:async({sourceRoot,binding})=>rpc({op:'pack_evidence',source_root:sourceRoot,binding}).archive,
      restoreEvidence:async args=>rpc({op:'restore_evidence',...args}).restoration,
      replayAnalysis:async({archive,sourceCommit})=>rpc({op:'replay_analysis',archive,source_commit:sourceCommit})
    };
  };
  const tools={
    mcp__codex_apps__google_drive_get_file_metadata:async({fileId})=>{if(fault==='metadata'&&names.get(fileId)?.includes('journal'))throw new WorkFailure('synthetic_metadata_failed');return {structuredContent:{id:fileId,parent_ids:['synthetic-folder'],url:'https://synthetic.test/'+fileId,shared:false,permissions:[{type:'user',role:'owner',emailAddress:settings.owner_email}]}};},
    mcp__codex_apps__google_drive_upload_file:async({file_uri,file_name})=>{
      if(fault==='drive'&&file_name.includes('journal'))throw new WorkFailure('synthetic_drive_unavailable');
      const id='synthetic-'+(++next),path=join(root,'remote',id);await copyFile(file_uri,path);remote.set(id,path);names.set(id,file_name);
      return {structuredContent:{id,url:'https://synthetic.test/'+id}};
    },
    mcp__codex_apps__google_drive_fetch:async({url})=>({privatePath:remote.get(url.split('/').at(-1))})
  };
  const source=new Map();
  for(let i=0;i<3;i++){
    const body=workJSON({schema_version:1,tracker_version:'1.0.0',events:[{schema_version:1,event_id:'syn_packed_'+i,event_name:'page_view',page_id:'home',sequence:i,tracker_version:'1.0.0',synthetic:true}]});
    source.set(`receipts/2026/10/27/synthetic-packed-${i}.json`,workJSON({receipt_id:'synthetic-packed-'+i,received_at:at,body_base64:Buffer.from(body).toString('base64'),body_bytes:body.length,receipt_body_sha256:await workHash(body)}));
  }
  const collector={list:async({namespace})=>({export_format_version:1,namespace,items:await Promise.all([...source].filter(([key])=>key.startsWith(namespace+'/')).map(async([key,b])=>({key,size:b.length,sha256:await workHash(b)}))),enumeration_complete:true,next_cursor:null,transactional_snapshot:false}),chunk:async({key,offset})=>{const b=source.get(key);return {export_format_version:1,key,encoding:'base64',offset,bytes:b.length,object_size:b.length,object_sha256:await workHash(b),body_base64:Buffer.from(b).toString('base64'),next_offset:b.length,object_complete:true};}};
  const local=createLocal({privateRoot:join(root,'evidence/pipeline')});
  const adapters=createNativeAdapters({tools,local,settings,analyze:input=>local.analyze(input),classify:async()=>({complete:true,observations:[],evidence_refs:['synthetic:no-mail']})});
  const args={runId:'synthetic-packed-'+crypto.randomUUID(),config,...adapters,collector,mail:{list:async()=>({message_ids:[],enumeration_complete:true,next_cursor:null})},now:()=>at};
  return {root,remote,names,source,args,local,tools,settings,createLocal};
}

test('packed real ZIP + Python analysis + native adapters restore every logical file with four physical payloads',async()=>{
  const f=await fixture();const result=await runLeadPipeline(f.args);assert.equal(result.status,'complete');
  const verified=await verifyRemoteRun({completionId:result.completion.id,drive:f.args.drive});
  assert.equal(verified.record_count,4);assert(verified.logical_record_count>30);
  assert.equal(f.remote.size,7,'started + ZIP +3small files +manifest +completion');
  const m=verified.manifest;assert.equal(m.logical_files.filter(x=>x.path.startsWith('raw/collector/')).length,3);
  const watchdog=await evaluateWatchdog({expectedIntervals:[{...config,start:'2026-10-27T11:59:00.000Z',end:'2026-10-27T12:01:00.000Z'}],completionIds:[result.completion.id],drive:f.args.drive,now:at,canary:{status:'verified'}});assert.equal(watchdog.status,'healthy');
  for(const [key,bytes]of f.source)assert.deepEqual(new Uint8Array(await readFile(join(f.root,'evidence/pipeline/run/raw/collector',key))),bytes);
  const closure=await closeWorkArchive({tools:f.tools,settings:f.settings,pipelineResult:result,evidenceRoot:join(f.root,'evidence'),pipelineRelativeRoot:'pipeline',outputRoot:join(f.root,'closure'),repositoryRoot:repository,sourceCommit:commit,toolingCommit:commit,makeLocal:f.createLocal});
  assert.equal(closure.status,'verified',JSON.stringify(closure));assert.equal(closure.numerical_replay.verified,true);assert.equal(closure.record_count,4);
  await writeFile(join(f.root,'integration-summary.json'),JSON.stringify({scope:'synthetic_local_filesystem_provider_simulation_actual_python_zip_restore_and_replay',result,closure,physical_payload_files:4,logical_files:verified.logical_record_count},null,2),{flag:'wx'});
});

test('analysis failure still uploads a complete partial journal with exact three raw objects',async()=>{
  const f=await fixture('analysis');const result=await runLeadPipeline(f.args);assert.equal(result.reason,'synthetic_analysis_failed');assert.equal(result.phase,'analysis');
  const failure=decode(await f.args.drive.read(result.failure_record.id));assert.equal(failure.recovered_files.length,1);assert.equal(failure.unarchived_local_files.length,0);
  assert(failure.recovered_files[0].path.startsWith('partial-journal-'));assert.equal(failure.recovered_files[0].record_count>3,true);
  assert(![...f.names.values()].some(x=>x.endsWith('-completed.json')));
  for(const [key,bytes]of f.source)assert.deepEqual(new Uint8Array(await readFile(join(f.root,'evidence/pipeline/run/raw/collector',key))),bytes);
  const restores=await readdir(join(f.root,'evidence/pipeline/journal-restores'));assert.equal(restores.length,1);
  for(const [key,bytes]of f.source)assert.deepEqual(new Uint8Array(await readFile(join(f.root,'evidence/pipeline/journal-restores',restores[0],'raw/collector',key))),bytes,'exact partial remote ZIP bytes were restored');
});

test('Drive failure retains local raw bytes and does not fall back to thousands of individual uploads',async()=>{
  const f=await fixture('drive');const result=await runLeadPipeline(f.args);assert.equal(result.reason,'synthetic_drive_unavailable');
  assert.equal([...f.names.values()].filter(x=>x.includes('raw--collector')).length,0);
  const failure=decode(await f.args.drive.read(result.failure_record.id));assert.equal(failure.recovered_files.length,0);assert.equal(failure.unarchived_local_files.filter(x=>x.startsWith('raw/collector/')).length,3);
  assert(failure.ambiguous_remote_creates.some(x=>x.path==='journal.zip'));
});

test('packed verifier rejects unknown mode and disagreement between logical and separate direct files',async()=>{
  const f=await fixture();const result=await runLeadPipeline(f.args);
  const completion=decode(await f.args.drive.read(result.completion.id)),manifest=decode(await f.args.drive.read(completion.manifest.id));
  async function replaceManifest(value){const mb=workJSON(value);await writeFile(f.remote.get(completion.manifest.id),mb);const cb=workJSON({...completion,manifest:{...completion.manifest,bytes:mb.length,sha256:await workHash(mb)}});await writeFile(f.remote.get(result.completion.id),cb);}
  // Deliberate corruption of synthetic provider fixtures only, never evidence.
  await replaceManifest({...manifest,archive_mode:'invented'});await assert.rejects(()=>verifyRemoteRun({completionId:result.completion.id,drive:f.args.drive,full:false}),/remote_archive_mode_mismatch/);
  const bad=structuredClone(manifest);bad.logical_files.find(x=>x.path==='inputs/config.json').sha256='0'.repeat(64);
  await replaceManifest(bad);await assert.rejects(()=>verifyRemoteRun({completionId:result.completion.id,drive:f.args.drive,full:false}),/packed_direct_file_mismatch/);
});

test('ZIP whole-file hash alone cannot pass missing entry verification or advance completion',async()=>{
  const f=await fixture();const verify=f.args.drive.verifyJournal;f.args.drive.verifyJournal=async(...args)=>({...await verify(...args),entries_verified:false});
  const result=await runLeadPipeline(f.args);assert.equal(result.reason,'packed_journal_readback_mismatch');assert.equal(result.status,'failed');
  const failure=decode(await f.args.drive.read(result.failure_record.id));assert(failure.remote_observations.some(x=>x.path==='journal.zip'&&x.id&&!x.verified));
  assert(![...f.names.values()].some(x=>x.endsWith('-completed.json')));
});

test('post-upload metadata failure preserves known ZIP IDs without claiming verification',async()=>{
  const f=await fixture('metadata');const result=await runLeadPipeline(f.args);assert.equal(result.reason,'synthetic_metadata_failed');
  const failure=decode(await f.args.drive.read(result.failure_record.id));
  const known=failure.remote_observations.filter(x=>x.path.includes('journal')&&x.id);
  assert.equal(known.length,2);assert(known.every(x=>!x.verified&&x.state==='created_unverified'));
  for(const row of known)assert(f.remote.has(row.id));
  assert(![...f.names.values()].some(x=>x.endsWith('-completed.json')));
});
