/* Mandatory offline network-context stage for the Work analysis callback.
 * Dataset and proof artifacts are private, hash-pinned configuration. No IP is
 * sent to a lookup service; network ownership never establishes employment. */
import {WorkFailure,workJSON,workHash,workUnbase64} from './pipeline.mjs';
import {createNativeAdapters,workToolValue} from './native-adapters.mjs';

export const NETWORK_STAGE_VERSION='farpoint-work-network-stage/1.0.2';
function networkRequire(value,code){if(!value)throw new WorkFailure(code);}
function networkPath(value){networkRequire(typeof value==='string'&&/^\/[A-Za-z0-9_./-]+$/.test(value)&&value.split('/').slice(1).every(x=>x&&x!=='.'&&x!=='..'),'invalid_network_stage_path');return value;}
function networkPrivateRoot(privateRoot,repositoryRoot){networkPath(privateRoot);networkPath(repositoryRoot);networkRequire(privateRoot!==repositoryRoot&&!privateRoot.startsWith(repositoryRoot+'/'),'private_network_stage_inside_repository');}
function networkArtifact(value){return value&&typeof value.id==='string'&&value.id.length>0&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[a-f0-9]{64}$/.test(value.sha256??'');}

// A tag is not a blanket approval for every historical or future collector.
// Bind the reviewed direct-edge path to its exact source versions and private
// acquisition scope. Unverified receipt fields are never rewritten or promoted.
function networkSourceScope(config,settings,artifacts){
  const tag='cloudflare_direct_edge_v1',required=config?.verified_ip_provenances?.[tag];
  if(required===undefined)return null;
  const scope=config.verified_ip_source_scope,refs=artifacts.map(x=>x.ref);
  networkRequire(scope?.schema_version===1&&scope.provenance===tag&&
    typeof scope.hostname==='string'&&/^[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]$/.test(scope.hostname)&&
    scope.hostname===settings.cloudflare_verified_ip_hostname&&
    typeof scope.cloudflare_account_id==='string'&&/^[a-f0-9]{32}$/.test(scope.cloudflare_account_id)&&
    scope.cloudflare_account_id===settings.cloudflare_account_id&&
    typeof scope.cloudflare_bucket_name==='string'&&/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(scope.cloudflare_bucket_name)&&
    scope.cloudflare_bucket_name===settings.cloudflare_bucket_name&&
    Array.isArray(scope.collector_versions)&&scope.collector_versions.length>0&&
    new Set(scope.collector_versions).size===scope.collector_versions.length&&
    scope.collector_versions.every(x=>typeof x==='string'&&/^farpoint-cloudflare-collector\/1\.0\.0\+[a-f0-9]{64}$/.test(x))&&
    Array.isArray(required)&&required.length>0&&new Set(required).size===required.length&&
    required.every(x=>typeof x==='string'&&refs.includes(x))&&
    Array.isArray(scope.evidence_refs)&&scope.evidence_refs.length===required.length&&
    new Set(scope.evidence_refs).size===scope.evidence_refs.length&&scope.evidence_refs.every(x=>required.includes(x)),
    'network_source_scope_unverified');
  return scope;
}

function networkScopeReceipt(bytes,scope){
  if(!scope)return false;
  let receipt;try{receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new WorkFailure('network_source_scope_invalid_receipt');}
  const source=receipt?.source_ip;
  if(source?.status!=='verified'||source.provenance!==scope.provenance)return false;
  networkRequire(scope.collector_versions.includes(receipt.collector_version),'network_source_version_unreviewed');
  return true;
}

/** Small hidden-stdin RPC. Full dataset/archive bytes never cross this bridge. */
export function createNetworkStageHost({tools,privateRoot,repositoryRoot}){
  networkPrivateRoot(privateRoot,repositoryRoot);
  async function one(request){
    const process=await tools.exec_command({cmd:`python3 ${repositoryRoot}/analytics/work/network_stage.py --root ${privateRoot} --repository ${repositoryRoot}`,tty:true,yield_time_ms:1000,max_output_tokens:1000});
    networkRequire(process.session_id&&process.output.includes('READY'),'network_stage_start_failed');
    let result=await tools.write_stdin({session_id:process.session_id,chars:JSON.stringify({...request,stream_results:true})+'\n',yield_time_ms:1000,max_output_tokens:25000});
    let output=result.output;while(result.session_id){result=await tools.write_stdin({session_id:result.session_id,chars:'',yield_time_ms:1000,max_output_tokens:25000});output+=result.output;}
    let value;try{value=JSON.parse(output.trim());}catch{throw new WorkFailure('network_stage_output_invalid');}
    networkRequire(value.status==='ok',typeof value.reason==='string'&&/^[a-z_]+$/.test(value.reason)?value.reason:'network_stage_failed');
    return value;
  }
  async function invoke(request){
    const initial=await one(request),stream=initial.result_stream;
    if(!stream)return initial;
    networkRequire(/^bridge-results\/[a-f0-9-]{36}\.json$/.test(stream.path??'')&&stream.encoding==='utf-8-json'&&Number.isSafeInteger(stream.bytes)&&stream.bytes>16384&&stream.bytes<=256*1024*1024&&/^[a-f0-9]{64}$/.test(stream.sha256??''),'invalid_network_stage_stream');
    const bytes=new Uint8Array(stream.bytes);
    for(let offset=0;offset<bytes.length;){
      const part=await one({op:'read_result',path:stream.path,offset,max_bytes:8192});
      const chunk=workUnbase64(part.base64);
      networkRequire(part.path===stream.path&&part.offset===offset&&part.total_bytes===stream.bytes&&part.bytes===chunk.length&&chunk.length===Math.min(8192,stream.bytes-offset)&&await workHash(chunk)===part.sha256,'network_stage_chunk_mismatch');
      bytes.set(chunk,offset);offset+=chunk.length;
    }
    networkRequire(await workHash(bytes)===stream.sha256,'network_stage_stream_hash_mismatch');
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new WorkFailure('network_stage_output_invalid');}
    networkRequire(value.status==='ok'&&!value.result_stream,'invalid_network_stage_stream_response');return value;
  }
  return {run:request=>invoke({op:'run',...request}),verify:request=>invoke({op:'verify',...request})};
}

/** Wrap local.analyze. Any missing, corrupt, unarchived or unreplayable network
 * stage fails the analysis callback; it never silently substitutes an empty list.
 * Unsupported/unverified receipt IPs are valid explicit unavailable observations.
 */
export function createNetworkAnalyzer({tools,local,settings,privateRoot,repositoryRoot,codeCommit,datasetArtifact,provenanceArtifacts=[],companyObservations=[],makeHost=createNetworkStageHost,makeAdapters=createNativeAdapters,onProgress=()=>{}}){
  networkPrivateRoot(privateRoot,repositoryRoot);
  networkRequire(/^[a-f0-9]{40}$/.test(codeCommit??''),'exact_network_stage_commit_required');
  networkRequire(networkArtifact(datasetArtifact)&&typeof datasetArtifact.manifest_name==='string'&&typeof datasetArtifact.dataset_member==='string'&&typeof datasetArtifact.provenance_member==='string'&&/^[a-f0-9]{64}$/.test(datasetArtifact.expected_manifest_sha256??''),'invalid_network_dataset_artifact');
  networkRequire(Array.isArray(provenanceArtifacts)&&provenanceArtifacts.every(x=>networkArtifact(x)&&typeof x.ref==='string'&&x.ref.length>0)&&new Set(provenanceArtifacts.map(x=>x.ref)).size===provenanceArtifacts.length,'invalid_network_provenance_artifacts');
  networkRequire(Array.isArray(companyObservations),'invalid_prior_company_observations');
  return async input=>{
    const stageId='network-'+crypto.randomUUID(),prefix='network-stages/'+stageId;
    const host=makeHost({tools,privateRoot:privateRoot+'/'+prefix,repositoryRoot});
    const drive=makeAdapters({tools,local,settings}).drive;
    let phase='settings',archiveRef=null;
    try{
      networkRequire(input?.config?.execution_code_commit===codeCommit,'network_stage_execution_commit_mismatch');
      await local.create(prefix+'/settings.json',workJSON({version:NETWORK_STAGE_VERSION,code_commit:codeCommit,dataset_artifact:datasetArtifact,provenance_artifacts:provenanceArtifacts}));
      const sourceScope=networkSourceScope(input.config,settings,provenanceArtifacts),scopeChecked=[];
      const privacy=await drive.assertPrivate();networkRequire(privacy?.verified===true&&privacy.owner_only===true,'private_network_destination_unverified');
      phase='dataset';onProgress({phase:'network_dataset_restore'});
      const dataset=await drive.verifyFile(datasetArtifact.id,datasetArtifact);
      networkRequire(dataset.verified===true&&dataset.bytes===datasetArtifact.bytes&&dataset.sha256===datasetArtifact.sha256,'network_dataset_readback_mismatch');
      const proofs=[];
      for(const descriptor of provenanceArtifacts){
        const proof=await drive.verifyFile(descriptor.id,descriptor);
        networkRequire(proof.verified===true&&proof.bytes===descriptor.bytes&&proof.sha256===descriptor.sha256,'network_provenance_readback_mismatch');
        proofs.push({path:proof.path,bytes:descriptor.bytes,sha256:descriptor.sha256,ref:descriptor.ref});
      }
      phase='receipts';const receipts=[],batchWrites=input.config.local_write_mode==='bounded_batches_v1';let pending=[],pendingBytes=0;
      if(batchWrites)networkRequire(typeof local.createMany==='function','network_local_batch_capability_missing');
      const flushReceipts=async()=>{
        if(!pending.length)return;
        const group=pending;pending=[];pendingBytes=0;
        const paths=await local.createMany(group.map(x=>({path:x.path,bytes:x.bytes})));
        networkRequire(Array.isArray(paths)&&paths.length===group.length&&paths.every((path,i)=>path===privateRoot+'/'+group[i].path),'network_local_batch_confirmation_mismatch');
        for(let i=0;i<group.length;i++)receipts.push({path:paths[i],bytes:group[i].bytes.length,sha256:group[i].sha256});
      };
      try{
        for(const object of input.objects){
          if(object.namespace!=='receipts')continue;
          const bytes=input.readLocal(object.local_path);
          networkRequire(bytes instanceof Uint8Array&&bytes.length===object.size&&await workHash(bytes)===object.sha256,'network_receipt_integrity_mismatch');
          if(networkScopeReceipt(bytes,sourceScope))scopeChecked.push({path:object.local_path,bytes:object.size,sha256:object.sha256});
          const path=prefix+'/receipts/'+crypto.randomUUID()+'.json';
          if(batchWrites&&bytes.length<=256*1024){
            if(pending.length===64||pendingBytes+bytes.length>256*1024)await flushReceipts();
            pending.push({path,bytes,sha256:object.sha256});pendingBytes+=bytes.length;
          }else{
            if(batchWrites)await flushReceipts();
            const saved=await local.create(path,bytes);receipts.push({path:saved,bytes:bytes.length,sha256:object.sha256});
          }
        }
      }finally{if(batchWrites)await flushReceipts();}
      if(sourceScope)await local.create(prefix+'/source-scope-verification.json',workJSON({schema_version:1,scope:sourceScope,verified_receipts:scopeChecked,original_receipts_modified:false}));
      phase='generation';onProgress({phase:'network_observations',receipts:receipts.length});
      const generated=await host.run({dataset_archive:{...datasetArtifact,path:dataset.path},receipts,config:input.config,run_id:stageId,code_commit:codeCommit,provenance_evidence:proofs});
      networkRequire(generated.result?.status==='complete','network_stage_incomplete');
      const stage=generated.result,archive=stage.archive;
      const observationBytes=workUnbase64(stage.observations_base64);
      networkRequire(/^[a-f0-9]{64}$/.test(stage.observations_sha256??'')&&await workHash(observationBytes)===stage.observations_sha256,'network_stage_observation_bytes_mismatch');
      let observations;try{observations=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(observationBytes));}catch{throw new WorkFailure('invalid_network_stage_observation_bytes');}
      networkRequire(Array.isArray(observations),'invalid_network_stage_observations');
      networkRequire(archive&&typeof archive.path==='string'&&archive.path.startsWith(privateRoot+'/'+prefix+'/')&&Number.isSafeInteger(archive.bytes)&&archive.bytes>0&&/^[a-f0-9]{64}$/.test(archive.sha256??''),'invalid_network_stage_archive');
      networkRequire(observations.every(x=>x.kind==='network'&&x.provider==='IPtoASN'&&x.employer===null&&!x.company&&!x.possible_company),'network_stage_identity_promotion');
      phase='upload';
      const raw=await tools.mcp__codex_apps__google_drive_upload_file({file_uri:archive.path,file_name:stageId+'.zip',mime_type:'application/zip',parent_folder_id:settings.archive_folder_id});
      await local.create(prefix+'/upload-envelope.json',workJSON(raw));
      const value=workToolValue(raw),id=value.id??value.fileId;
      networkRequire(typeof id==='string'&&id.length>0,'network_stage_upload_id_missing');
      archiveRef={id,bytes:archive.bytes,sha256:archive.sha256,manifest_sha256:archive.manifest_sha256};
      phase='readback';const download=await drive.verifyFile(id,archive);
      networkRequire(download.verified===true&&download.bytes===archive.bytes&&download.sha256===archive.sha256,'network_stage_archive_readback_mismatch');
      archiveRef.url=download.url;
      phase='replay';
      const checked=await host.verify({archive:{path:download.path,bytes:archive.bytes,sha256:archive.sha256},expected_manifest_sha256:archive.manifest_sha256});
      networkRequire(checked.result?.status==='verified'&&checked.result.observations_match===true,'network_stage_replay_failed');
      networkRequire(/^[a-f0-9]{64}$/.test(stage.observations_sha256??'')&&checked.result.observations_sha256===stage.observations_sha256,'network_stage_observations_changed');
      const proof={version:NETWORK_STAGE_VERSION,stage_id:stageId,status:'verified',source_commit:codeCommit,dataset_artifact:datasetArtifact,provenance_artifacts:provenanceArtifacts,archive:archiveRef,summary:stage.summary,verification:checked.result,employer_inference:false};
      await local.create(prefix+'/verified.json',workJSON(proof));
      phase='analysis';onProgress({phase:'network_analysis',observations:observations.length});
      const analyzed=await local.analyze({...input,codeCommit,companyObservations:[...companyObservations,...observations]});
      return {...analyzed,artifacts:[...analyzed.artifacts,{name:'network-stage-verification.json',bytes:workJSON(proof)}]};
    }catch(error){
      const reason=error instanceof WorkFailure?error.code:'network_stage_operation_failed';
      try{await local.create(prefix+'/failure-'+crypto.randomUUID()+'.json',workJSON({version:NETWORK_STAGE_VERSION,stage_id:stageId,phase,reason,archive:archiveRef,upload_outcome_unknown:phase==='upload'&&!archiveRef,employer_inference:false}));}catch{}
      throw new WorkFailure(reason);
    }
  };
}
