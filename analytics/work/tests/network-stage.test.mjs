import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {workJSON,workHash} from '../pipeline.mjs';
import {createNetworkAnalyzer,createNetworkStageHost} from '../network-stage.mjs';

async function fixture(fault){
  const commit='a'.repeat(40),calls=[],saved=new Map(),body=workJSON({synthetic:true});
  const dataset={id:'dataset-zip',bytes:28709893,sha256:'b'.repeat(64),manifest_name:'ARCHIVE-MANIFEST.json',expected_manifest_sha256:'c'.repeat(64),dataset_member:'data/dataset.tsv',provenance_member:'data/provenance.json'};
  const proofs=[{id:'proof-file',bytes:200,sha256:'d'.repeat(64),ref:'proof:approved'}];
  const observation={kind:'network',provider:'IPtoASN',employer:null,network_organization:'SYNTHETIC NETWORK'};
  const observedBytes=workJSON([fault==='identity'?{...observation,company:'invented'}:observation]),observedHash=await workHash(observedBytes);
  const observationBase64=Buffer.from(fault==='observation-bytes'?workJSON([{...observation,network_organization:'DRIFTED'}]):observedBytes).toString('base64');
  const input={objects:[{namespace:'receipts',local_path:'raw/receipt.json',size:body.length,sha256:await workHash(body)}],readLocal:()=>fault==='receipt'?workJSON({wrong:true}):body,config:{execution_code_commit:commit,verified_ip_provenances:{synthetic:['proof:approved']}}};
  let analyzed=null;
  const local={create:async(path,bytes)=>{assert(!saved.has(path));saved.set(path,bytes);return '/private/'+path;},analyze:async value=>{calls.push('analyze');analyzed=value;return {report:{status:'complete'},artifacts:[]};}};
  const drive={assertPrivate:async()=>({verified:fault!=='privacy',owner_only:fault!=='privacy'}),verifyFile:async(id,expected)=>{calls.push('download:'+id);if(fault==='dataset'&&id==='dataset-zip')throw Error('not_downloadable');return {id,verified:fault!=='readback'||id!=='stage-zip',path:'/private/download/'+id,bytes:expected.bytes,sha256:expected.sha256,url:'https://drive.example/'+id};}};
  const tools={mcp__codex_apps__google_drive_upload_file:async value=>{calls.push('upload');assert.equal(typeof value.file_uri,'string');assert(!value.file_uri.includes('base64'));return {structuredContent:{id:'stage-zip'}};}};
  const makeHost=({privateRoot})=>({run:async request=>{calls.push('run');assert.equal(request.dataset_archive.path,'/private/download/dataset-zip');assert.equal(request.receipts.length,1);assert.equal(request.provenance_evidence[0].ref,'proof:approved');return {result:{status:fault==='incomplete'?'partial':'complete',observations_base64:observationBase64,observations_sha256:observedHash,archive:{path:privateRoot+'/network.zip',bytes:50,sha256:'f'.repeat(64),manifest_sha256:'1'.repeat(64)},summary:{network_context:1,verified_employers:0}}};},verify:async()=>{calls.push('replay');return {result:{status:fault==='replay'?'failed':'verified',observations_match:fault!=='replay',observations_sha256:fault==='observations'?'0'.repeat(64):observedHash}};}});
  const analyze=createNetworkAnalyzer({tools,local,settings:{archive_folder_id:'private-folder'},privateRoot:'/private',repositoryRoot:'/repo',codeCommit:commit,datasetArtifact:dataset,provenanceArtifacts:proofs,makeHost,makeAdapters:()=>({drive})});
  return {analyze,input,calls,saved,get analyzed(){return analyzed;}};
}

test('automatic network stage restores pinned data, freezes observations, verifies archive replay before analysis',async()=>{
  const f=await fixture();const result=await f.analyze(f.input);
  assert.deepEqual(f.calls,['download:dataset-zip','download:proof-file','run','upload','download:stage-zip','replay','analyze']);
  assert.equal(f.analyzed.companyObservations.length,1);assert.equal(f.analyzed.companyObservations[0].employer,null);
  assert.equal(result.artifacts[0].name,'network-stage-verification.json');
  assert([...f.saved.keys()].some(x=>x.endsWith('/verified.json')));
});

test('privacy, dataset, receipt, generation, identity, readback and replay failures cannot silently become empty observations',async()=>{
  for(const fault of ['privacy','dataset','receipt','incomplete','identity','observation-bytes','readback','replay','observations']){
    const f=await fixture(fault);await assert.rejects(()=>f.analyze(f.input));assert(!f.calls.includes('analyze'),fault);
    assert([...f.saved.keys()].some(x=>x.includes('/failure-')),fault);
  }
});

test('network execution source must equal frozen report source commit',async()=>{
  const f=await fixture();f.input.config.execution_code_commit='0'.repeat(40);
  await assert.rejects(()=>f.analyze(f.input),/network_stage_execution_commit_mismatch/);
  assert.equal(f.calls.length,0);
});

test('stage retry appends a new attempt and never replaces an earlier observation',async()=>{
  const f=await fixture();await f.analyze(f.input);await f.analyze(f.input);
  assert.equal([...f.saved.keys()].filter(x=>x.endsWith('/verified.json')).length,2);
});

test('private stage cannot be created inside the versioned repository',()=>{
  assert.throws(()=>createNetworkStageHost({tools:{},privateRoot:'/repo/private',repositoryRoot:'/repo'}),/private_network_stage_inside_repository/);
  assert.throws(()=>createNetworkStageHost({tools:{},privateRoot:'/repo',repositoryRoot:'/repo'}),/private_network_stage_inside_repository/);
  assert.throws(()=>createNetworkStageHost({tools:{},privateRoot:'/repo/../escape',repositoryRoot:'/repo'}),/invalid_network_stage_path/);
  assert.throws(()=>createNetworkStageHost({tools:{},privateRoot:'/repo/./private',repositoryRoot:'/repo'}),/invalid_network_stage_path/);
});

test('network host transports only bounded observation chunks with full integrity checks',async()=>{
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const expected=randomBytes(30000).toString('base64'),bytes=Buffer.from(JSON.stringify({status:'ok',result:{observations:[expected]}}));
  const path='bridge-results/00000000-0000-4000-8000-000000000000.json';let chunks=0;
  const tools={exec_command:async()=>({session_id:1,output:'READY\n'}),write_stdin:async({chars})=>{
    const request=JSON.parse(chars);assert.equal(request.stream_results,true);
    if(request.op==='run')return {output:JSON.stringify({status:'ok',result_stream:{path,bytes:bytes.length,sha256:hash(bytes),encoding:'utf-8-json'}})};
    assert.equal(request.op,'read_result');assert.equal(request.max_bytes,8192);chunks++;
    const part=bytes.subarray(request.offset,request.offset+8192);
    return {output:JSON.stringify({status:'ok',path,offset:request.offset,total_bytes:bytes.length,bytes:part.length,sha256:hash(part),base64:part.toString('base64')})};
  }};
  const host=createNetworkStageHost({tools,privateRoot:'/private/stage',repositoryRoot:'/repo'});
  const result=await host.run({});assert.equal(result.result.observations[0],expected);assert(chunks>4);
});
