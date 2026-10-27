import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createCompanyAnalyzer} from '../company-stage.mjs';
import {WorkFailure,workJSON,workHash} from '../pipeline.mjs';
const workBase64=bytes=>Buffer.from(bytes).toString('base64');

const evidenceParent=process.env.FARPOINT_PRIVATE_TEST_EVIDENCE||resolve('..','farpoint-company-stage-tests');
await mkdir(evidenceParent,{recursive:true});
const evidenceRoot=await mkdtemp(resolve(evidenceParent,'orchestration-'));
const retained=[];

async function fixture(overrides={}){
  const events=[],files=new Map(),originals=new Map(),privateRoot='/private/synthetic-company',commit='a'.repeat(40);
  const provider={enabled:true};
  for(const key of ['dataset','license','approval','reader']){const raw=workJSON({synthetic_only:true,key});provider[key]={id:'synthetic-'+key,artifact:key+'.bin',bytes:raw.length,sha256:await workHash(raw)};}
  const required=['analytics/python/farpoint_analytics/dbip_company.py','analytics/python/farpoint_analytics/dbip_cli.py','analytics/work/company_stage.py','analytics/work/company-stage.mjs','analytics/work/network_stage.py'];
  const sources=required.map(path=>({path,bytes:10,sha256:'b'.repeat(64)}));
  const network={provider:'IPtoASN',kind:'network',employer:null,observation_id:'synthetic-prior-network'};
  const objects=[];
  for(let i=0;i<(overrides.count??1);i++){const raw=workJSON({synthetic:true,receipt_id:'synthetic-'+i});originals.set('original-'+i,raw);objects.push({namespace:'receipts',local_path:'original-'+i,size:raw.length,sha256:await workHash(raw)});}
  const input={objects,captures:[],classifications:[],companyObservations:[network],config:{execution_code_commit:commit,company_provider:structuredClone(provider),company_source_bindings:structuredClone(sources),...(overrides.batched?{local_write_mode:'bounded_batches_v1'}:{})},readLocal:path=>originals.get(path)};
  let analyzed=null,runRequest=null,uploadCalls=0,stageRoot=null;
  const create=async(path,bytes)=>{assert(!files.has(path));files.set(path,bytes.slice());return privateRoot+'/'+path;};
  const local={create,createMany:async rows=>{events.push({op:'batch',count:rows.length,bytes:rows.reduce((n,x)=>n+x.bytes.length,0)});return Promise.all(rows.map(x=>create(x.path,x.bytes)));},analyze:async value=>{events.push({op:'analysis'});analyzed=value;return {report:{synthetic:true},artifacts:[]};}};
  const observations=[{provider:'DB-IP',kind:'company',employer:null,identity_category:'possible_corporate_match',status:'ok',company:'SYNTHETIC Power Plant',observation_id:'synthetic-company',provider_record:{synthetic:true,retained:'exact-full-record'}}];
  const bytes=workJSON(observations),hash=await workHash(bytes);
  const archive={path:'set-by-host',bytes:123,sha256:'c'.repeat(64),manifest_sha256:'d'.repeat(64)};
  const drive={assertPrivate:async()=>{events.push({op:'privacy'});return {verified:true,owner_only:true};},verifyFile:async(id,spec)=>{events.push({op:'readback',id});return {verified:true,id,path:'/private/download-'+id,bytes:spec.bytes,sha256:spec.sha256,url:'https://example.invalid/'+id};},createFile:async(name,spec)=>{events.push({op:'upload'});uploadCalls++;assert.equal(spec.path,archive.path);return {id:'synthetic-output',url:'https://example.invalid/synthetic-output'};}};
  const host={run:async request=>{events.push({op:'run'});runRequest=request;return {result:{status:'complete',archive,observations_base64:workBase64(bytes),observations_sha256:hash,summary:{verified_employers:0}}};},verify:async request=>{events.push({op:'replay'});assert.equal(request.expected_manifest_sha256,archive.manifest_sha256);return {result:{status:'verified',observations_match:true,observations_sha256:hash}};}};
  const settings={archive_folder_id:'synthetic-private-folder',owner_email:'owner@example.invalid'};
  const args={tools:{},local,settings,privateRoot,repositoryRoot:'/repository/synthetic',codeCommit:commit,providerConfig:provider,sourceBindings:sources,makeAdapters:()=>({drive}),makeHost:options=>{stageRoot=options.privateRoot;archive.path=stageRoot+'/stage.zip';return host;}};
  const entry={scope:'Synthetic local orchestration; all connectors and host responses mocked',events,files,originals};retained.push(entry);
  return {args,input,provider,sources,local,drive,host,archive,observations,files,events,hash,get analyzed(){return analyzed;},get runRequest(){return runRequest;},get uploadCalls(){return uploadCalls;},get stageRoot(){return stageRoot;}};
}

test('disabled wrapper delegates exact input and performs no storage/connector work',async()=>{
  const f=await fixture();const analyzer=createCompanyAnalyzer({local:f.local,providerConfig:null,makeHost:()=>{throw Error('host forbidden');},makeAdapters:()=>{throw Error('connectors forbidden');}});
  const input={config:{},companyObservations:[{provider:'IPtoASN',synthetic:true}]};await analyzer(input);
  assert.equal(f.analyzed,input);assert.equal(f.files.size,0);assert.deepEqual(f.events,[{op:'analysis'}]);
  await assert.rejects(()=>analyzer(f.input),error=>error.code==='enabled_company_provider_not_configured');
});

test('full enabled chain verifies private artifacts/archive/replay before preserving network plus company observations',async()=>{
  const f=await fixture();const rawBefore=Array.from(f.input.readLocal('original-0'));const result=await createCompanyAnalyzer(f.args)(f.input);
  assert.deepEqual(f.events.map(x=>x.op),['privacy','readback','readback','readback','readback','run','upload','readback','replay','analysis']);
  assert.equal(f.analyzed.companyObservations[0],f.input.companyObservations[0]);assert.deepEqual(f.analyzed.companyObservations[1],f.observations[0]);
  assert.equal(f.runRequest.receipts.length,1);assert.equal(f.runRequest.artifacts.length,4);assert.deepEqual(Array.from(f.input.readLocal('original-0')),rawBefore);
  assert.equal(result.artifacts[0].name,'company-stage-verification.json');assert.equal(f.uploadCalls,1);
  const proof=JSON.parse(new TextDecoder().decode(result.artifacts[0].bytes));assert.equal(proof.archive.id,'synthetic-output');assert.equal(proof.verified_employers,0);
});

test('operator constructor inputs are frozen and run config/source/commit must match',async()=>{
  const f=await fixture();const analyzer=createCompanyAnalyzer(f.args);f.provider.dataset.sha256='0'.repeat(64);f.sources[0].sha256='0'.repeat(64);
  await analyzer(f.input);assert(f.analyzed);
  for(const change of [input=>{input.config.execution_code_commit='b'.repeat(40);},input=>{input.config.company_provider.dataset.sha256='e'.repeat(64);},input=>{input.config.company_source_bindings[0].sha256='e'.repeat(64);}]){
    const g=await fixture();change(g.input);await assert.rejects(()=>createCompanyAnalyzer(g.args)(g.input));assert.equal(g.analyzed,null);assert.equal(g.events.length,0);
  }
});

test('unsafe private/source/provider configuration is rejected before execution',async()=>{
  for(const mutate of [args=>{args.privateRoot='/repository/synthetic/private';},args=>{args.providerConfig.reader.artifact='../reader.tar.gz';},args=>{args.sourceBindings=args.sourceBindings.filter(x=>!x.path.endsWith('network_stage.py'));},args=>{args.providerConfig.license.sha256='wrong';}]){const f=await fixture();mutate(f.args);assert.throws(()=>createCompanyAnalyzer(f.args),WorkFailure);assert.equal(f.events.length,0);}
});

test('unverified destination or altered artifact never reaches generation',async()=>{
  for(const kind of ['privacy','artifact']){const f=await fixture();if(kind==='privacy')f.drive.assertPrivate=async()=>({verified:true,owner_only:false});else f.drive.verifyFile=async(id,spec)=>({verified:true,id,path:'/private/input',bytes:spec.bytes,sha256:'f'.repeat(64)});
    await assert.rejects(()=>createCompanyAnalyzer(f.args)(f.input));assert.equal(f.runRequest,null);assert.equal(f.uploadCalls,0);assert.equal(f.analyzed,null);assert([...f.files.keys()].some(x=>x.includes('/failure-')));}
});

test('receipt integrity failure preserves source and blocks generation/analysis',async()=>{
  const f=await fixture();const before=f.input.readLocal('original-0').slice();f.input.objects[0].sha256='0'.repeat(64);
  await assert.rejects(()=>createCompanyAnalyzer(f.args)(f.input),error=>error.code==='company_receipt_integrity_mismatch');
  assert.deepEqual(f.input.readLocal('original-0'),before);assert.equal(f.runRequest,null);assert.equal(f.analyzed,null);
});

test('incomplete or promoted company identity never uploads or analyzes',async()=>{
  for(const mode of ['incomplete','employer','wrongkind','error']){const f=await fixture();const original=f.host.run;f.host.run=async request=>{const v=await original(request);if(mode==='incomplete')v.result.status='incomplete';else{const rows=structuredClone(f.observations);if(mode==='employer')rows[0].employer='FORBIDDEN';if(mode==='wrongkind')rows[0].kind='network';if(mode==='error')rows[0].status='error';const bytes=workJSON(rows);v.result.observations_base64=workBase64(bytes);v.result.observations_sha256=await workHash(bytes);}return v;};
    await assert.rejects(()=>createCompanyAnalyzer(f.args)(f.input));assert.equal(f.uploadCalls,0);assert.equal(f.analyzed,null);}
});

test('bad archive bytes or replay proof retains known uploaded ID and never analyzes',async()=>{
  for(const mode of ['download','replay']){const f=await fixture();if(mode==='download'){const original=f.drive.verifyFile;f.drive.verifyFile=async(id,spec)=>id==='synthetic-output'?{verified:true,id,bytes:spec.bytes,sha256:'0'.repeat(64)}:original(id,spec);}else f.host.verify=async()=>({result:{status:'verified',observations_match:true,observations_sha256:'0'.repeat(64)}});
    await assert.rejects(()=>createCompanyAnalyzer(f.args)(f.input));assert.equal(f.analyzed,null);const raw=[...f.files].find(([name])=>name.includes('/failure-'))[1];const failure=JSON.parse(new TextDecoder().decode(raw));assert.equal(failure.archive.id,'synthetic-output');assert.equal(failure.upload_outcome_unknown,false);}
});

test('post-create privacy failure retains created remote ID for reconciliation',async()=>{
  const f=await fixture();f.drive.createFile=async()=>{const error=new WorkFailure('drive_destination_mismatch');error.created_file={id:'synthetic-known-created',url:'https://example.invalid/control'};throw error;};
  await assert.rejects(()=>createCompanyAnalyzer(f.args)(f.input));const raw=[...f.files].find(([name])=>name.includes('/failure-'))[1];const failure=JSON.parse(new TextDecoder().decode(raw));assert.equal(failure.archive.id,'synthetic-known-created');assert.equal(failure.upload_outcome_unknown,false);assert.equal(f.analyzed,null);
});

test('receipt staging uses bounded batches with exact path/byte confirmations',async()=>{
  const f=await fixture({count:67,batched:true});await createCompanyAnalyzer(f.args)(f.input);
  const batches=f.events.filter(x=>x.op==='batch');assert.deepEqual(batches.map(x=>x.count),[64,3]);assert(batches.every(x=>x.bytes<=256*1024));assert.equal(f.runRequest.receipts.length,67);
  const g=await fixture({count:2,batched:true});g.local.createMany=async()=>['/wrong'];await assert.rejects(()=>createCompanyAnalyzer(g.args)(g.input),error=>error.code==='company_local_batch_confirmation_mismatch');assert.equal(g.analyzed,null);
});

test.after(async()=>{
  for(let i=0;i<retained.length;i++){const entry=retained[i];const capture=async([path,bytes])=>({path,bytes:bytes.length,sha256:await workHash(bytes),base64:workBase64(bytes)});await writeFile(resolve(evidenceRoot,'fixture-'+i+'.json'),JSON.stringify({scope:entry.scope,events:entry.events,files:await Promise.all([...entry.files].map(capture)),originals:await Promise.all([...entry.originals].map(capture))},null,2),{flag:'wx',mode:0o600});}
  console.log('Company stage fixture evidence:',evidenceRoot);
});
