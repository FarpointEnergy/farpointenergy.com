import test from 'node:test';
import assert from 'node:assert/strict';
import {workJSON,workHash,WORK_VERSION} from '../pipeline.mjs';
import {closeWorkArchive} from '../archive-closure.mjs';

async function fixture(fault){
  const commit='a'.repeat(40),remote=new Map(),saved=new Map(),calls=[];
  const config=workJSON({execution_code_commit:commit});remote.set('config',config);
  const report=workJSON({synthetic:true});remote.set('report',report);
  const files=await Promise.all([['config','inputs/config.json'],['report','report/report.json']].map(async([id,path])=>({id,path,bytes:remote.get(id).length,sha256:await workHash(remote.get(id))})));
  const job={id:'synthetic',version:'1',scope_id:'synthetic',kind:'archive'};
  const manifest={schema_version:1,run_id:'synthetic-run-0001',work_version:WORK_VERSION,job,window_start:'2026-10-23T00:00:00.000Z',window_end:'2026-10-24T00:00:00.000Z',report_status:'complete',report_authority:'complete_for_observed_evidence',source_completeness:{collector:true,mail:true,classifications:true},files,record_count:files.length,total_bytes:files.reduce((n,f)=>n+f.bytes,0)};
  const mb=workJSON(manifest);remote.set('manifest',mb);
  const completion={...manifest,state:'completed',manifest:{id:'manifest',bytes:mb.length,sha256:await workHash(mb)}};delete completion.files;
  const cb=workJSON(completion);remote.set('completion',cb);
  const result={status:'complete',run_id:manifest.run_id,completion:{id:'completion',bytes:cb.length,sha256:await workHash(cb)}};
  const archive={status:'packed',path:'/closure/evidence.zip',bytes:100,sha256:'b'.repeat(64),manifest_sha256:'c'.repeat(64),record_count:20,total_source_bytes:1000};
  const local={create:async(path,bytes)=>{calls.push('create:'+path);assert(!saved.has(path));saved.set(path,bytes);return '/private/'+path;},captureClosureSource:async()=>({files:[]}),packEvidence:async input=>{calls.push('pack');assert.equal(input.binding.pipeline_completion.id,'completion');assert.equal(input.binding.required_source_files.length,2);return archive;},restoreEvidence:async()=>({status:fault==='restore'?'bad':'verified_and_restored',path:'/closure/restored',manifest_sha256:archive.manifest_sha256,record_count:20}),replayAnalysis:async()=>({verified:fault!=='replay',archived_source_used:true,independent_os_runtime_recovery:false})};
  const drive={assertPrivate:async()=>({verified:fault!=='privacy',owner_only:fault!=='privacy'}),read:async id=>remote.get(id),verifyFile:async(id,expected)=>{calls.push('verify:'+id);if(fault==='file'&&id==='report'||fault==='closure-readback'&&id==='closure')throw Error('synthetic');return {id,url:'https://drive.example/'+id,verified:true,path:'/private/'+id,bytes:expected.bytes,sha256:expected.sha256};},create:async(name,bytes)=>{calls.push('closure_record');remote.set('closure',bytes);return {id:'closure',url:'https://drive.example/closure'};}};
  const tools={mcp__codex_apps__google_drive_upload_file:async()=>{calls.push('upload');return {structuredContent:{id:'zip'}};}};
  return {calls,saved,args:{tools,settings:{archive_folder_id:'synthetic-folder'},pipelineResult:result,evidenceRoot:'/evidence',pipelineRelativeRoot:'synthetic-run-0001',outputRoot:'/closure',repositoryRoot:'/repo',sourceCommit:commit,toolingCommit:'d'.repeat(40),makeLocal:()=>local,makeAdapters:()=>({drive})}};
}
test('closure verifies every remote input, ZIP restoration and replay before a separate completion',async()=>{const f=await fixture();const r=await closeWorkArchive(f.args);assert.equal(r.status,'verified');assert.equal(r.record_count,2);assert(f.calls.indexOf('verify:report')<f.calls.indexOf('pack'));assert(f.calls.indexOf('upload')<f.calls.indexOf('closure_record'));assert.equal(r.production_readiness,false);});
test('unverified private scope prevents packaging or upload',async()=>{const f=await fixture('privacy');const r=await closeWorkArchive(f.args);assert.equal(r.status,'failed');assert.equal(r.reason,'private_destination_unverified');assert(!f.calls.includes('upload'));});
test('remote corruption preserves failure observation and prevents closure completion',async()=>{const f=await fixture('file');const r=await closeWorkArchive(f.args);assert.equal(r.status,'failed');assert(!f.calls.includes('pack'));assert([...f.saved.keys()].some(x=>x.startsWith('remote-verification/batch-')));});
test('restore or replay failure cannot produce a verified closure record',async()=>{for(const fault of ['restore','replay']){const f=await fixture(fault);const r=await closeWorkArchive(f.args);assert.equal(r.status,'failed');assert(!f.calls.includes('closure_record'));assert.equal(r.created_archive.id,'zip');}});
test('source directory cannot contain its own generated ZIP',async()=>{const f=await fixture();await assert.rejects(()=>closeWorkArchive({...f.args,outputRoot:'/evidence/nested'}),/closure_output_inside_evidence/);});
test('closure record readback failure retains its known immutable ID and expected hash',async()=>{const f=await fixture('closure-readback');const r=await closeWorkArchive(f.args);assert.equal(r.status,'failed');assert.equal(r.phase,'closure_record');assert.equal(r.created_closure.id,'closure');assert.equal(r.created_closure.verified,false);assert(r.created_closure.bytes>0);assert.match(r.created_closure.sha256,/^[a-f0-9]{64}$/);});
