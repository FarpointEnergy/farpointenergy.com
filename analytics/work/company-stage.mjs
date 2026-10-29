/* Optional offline company context. No purchase, activation, external IP lookup,
 * or replacement of the mandatory IPtoASN stage. Raw records stay private. */
import {WorkFailure,workJSON,workHash,workUnbase64} from './pipeline.mjs';
import {createNativeAdapters} from './native-adapters.mjs';

export const COMPANY_STAGE_VERSION='farpoint-work-company-stage/1.0.0';
function requireCompany(ok,code){if(!ok)throw new WorkFailure(code);}
function stagePath(value){requireCompany(typeof value==='string'&&/^\/[A-Za-z0-9_./-]+$/.test(value)&&value.split('/').slice(1).every(x=>x&&x!=='.'&&x!=='..'),'invalid_company_stage_path');return value;}
function privatePaths(privateRoot,repositoryRoot){stagePath(privateRoot);stagePath(repositoryRoot);requireCompany(privateRoot!==repositoryRoot&&!privateRoot.startsWith(repositoryRoot+'/'),'private_company_stage_inside_repository');}
function safeName(value){return typeof value==='string'&&/^[A-Za-z0-9_./-]+$/.test(value)&&!value.startsWith('/')&&value.split('/').every(x=>x&&x!=='.'&&x!=='..');}
function artifact(value){return value&&typeof value.id==='string'&&value.id.length>0&&Number.isSafeInteger(value.bytes)&&value.bytes>0&&/^[a-f0-9]{64}$/.test(value.sha256??'');}
function stable(value){
  if(value===null||typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  requireCompany(value&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype,'invalid_company_configuration_value');
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
}

/** Private stdin RPC; large datasets and ZIP bytes never enter tool output. */
export function createCompanyStageHost({tools,privateRoot,repositoryRoot}){
  privatePaths(privateRoot,repositoryRoot);
  async function one(request){
    const process=await tools.exec_command({cmd:`python3 ${repositoryRoot}/analytics/work/company_stage.py --root ${privateRoot} --repository ${repositoryRoot}`,tty:true,yield_time_ms:1000,max_output_tokens:1000});
    requireCompany(process.session_id&&process.output.includes('READY'),'company_stage_start_failed');
    let result=await tools.write_stdin({session_id:process.session_id,chars:JSON.stringify({...request,stream_results:true})+'\n',yield_time_ms:1000,max_output_tokens:25000});
    let output=result.output;
    while(result.session_id){result=await tools.write_stdin({session_id:result.session_id,chars:'',yield_time_ms:1000,max_output_tokens:25000});output+=result.output;}
    let value;try{value=JSON.parse(output.trim());}catch{throw new WorkFailure('company_stage_output_invalid');}
    requireCompany(value.status==='ok',typeof value.reason==='string'&&/^[a-z_]+$/.test(value.reason)?value.reason:'company_stage_failed');
    return value;
  }
  async function invoke(request){
    const initial=await one(request),stream=initial.result_stream;
    if(!stream)return initial;
    requireCompany(/^bridge-results\/[a-f0-9-]{36}\.json$/.test(stream.path??'')&&stream.encoding==='utf-8-json'&&Number.isSafeInteger(stream.bytes)&&stream.bytes>16384&&stream.bytes<=256*1024*1024&&/^[a-f0-9]{64}$/.test(stream.sha256??''),'invalid_company_stage_stream');
    const bytes=new Uint8Array(stream.bytes);
    for(let offset=0;offset<bytes.length;){
      const part=await one({op:'read_result',path:stream.path,offset,max_bytes:8192}),chunk=workUnbase64(part.base64);
      requireCompany(part.path===stream.path&&part.offset===offset&&part.total_bytes===stream.bytes&&part.bytes===chunk.length&&chunk.length===Math.min(8192,stream.bytes-offset)&&await workHash(chunk)===part.sha256,'company_stage_chunk_mismatch');
      bytes.set(chunk,offset);offset+=chunk.length;
    }
    requireCompany(await workHash(bytes)===stream.sha256,'company_stage_stream_hash_mismatch');
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new WorkFailure('company_stage_output_invalid');}
    requireCompany(value.status==='ok'&&!value.result_stream,'invalid_company_stage_stream_response');return value;
  }
  return {run:request=>invoke({op:'run',...request}),verify:request=>invoke({op:'verify',...request})};
}

/** Compose beneath the mandatory network analyzer:
 * createNetworkAnalyzer({...,local:{...local,analyze:createCompanyAnalyzer({...})}})
 * Network observations in input.companyObservations pass through unchanged.
 * Explicitly disabled/unconfigured company stages do no connector or file work.
 */
export function createCompanyAnalyzer({tools,local,settings,privateRoot,repositoryRoot,codeCommit,providerConfig=null,sourceBindings=[],provenanceArtifacts=[],makeHost=createCompanyStageHost,makeAdapters=createNativeAdapters,onProgress=()=>{}}){
  requireCompany(typeof local?.analyze==='function','company_analysis_delegate_missing');
  if(providerConfig?.enabled!==true)return async input=>{
    requireCompany(input?.config?.company_provider?.enabled!==true,'enabled_company_provider_not_configured');
    return local.analyze(input);
  };
  privatePaths(privateRoot,repositoryRoot);
  requireCompany(/^[a-f0-9]{40}$/.test(codeCommit??''),'exact_company_stage_commit_required');
  const keys=['dataset','license','approval','reader'];
  requireCompany(keys.every(key=>artifact(providerConfig[key])&&safeName(providerConfig[key].artifact))&&new Set(keys.map(key=>providerConfig[key].artifact)).size===4,'invalid_company_provider_artifacts');
  requireCompany(Array.isArray(sourceBindings)&&sourceBindings.length>0&&sourceBindings.every(x=>safeName(x.path)&&Number.isSafeInteger(x.bytes)&&x.bytes>=0&&/^[a-f0-9]{64}$/.test(x.sha256??''))&&new Set(sourceBindings.map(x=>x.path)).size===sourceBindings.length,'invalid_company_source_bindings');
  for(const required of ['analytics/python/farpoint_analytics/dbip_company.py','analytics/python/farpoint_analytics/dbip_cli.py','analytics/work/company_stage.py','analytics/work/company-stage.mjs','analytics/work/network_stage.py'])requireCompany(sourceBindings.some(x=>x.path===required),'company_source_binding_missing');
  requireCompany(Array.isArray(provenanceArtifacts)&&provenanceArtifacts.every(x=>artifact(x)&&typeof x.ref==='string'&&x.ref.length>0)&&new Set(provenanceArtifacts.map(x=>x.ref)).size===provenanceArtifacts.length,'invalid_company_provenance_artifacts');
  // Freeze operator configuration now; later caller mutation cannot change the
  // declared dataset/licence/source without an explicit new analyzer instance.
  const provider=JSON.parse(stable(providerConfig)),sources=JSON.parse(stable(sourceBindings)),provenances=JSON.parse(stable(provenanceArtifacts));
  return async input=>{
    const stageId='company-'+crypto.randomUUID(),prefix='company-stages/'+stageId;
    const host=makeHost({tools,privateRoot:privateRoot+'/'+prefix,repositoryRoot});
    const drive=makeAdapters({tools,local,settings}).drive;
    let phase='settings',archiveRef=null,archive=null;
    try{
      requireCompany(input?.config?.execution_code_commit===codeCommit,'company_stage_execution_commit_mismatch');
      requireCompany(stable(input.config.company_provider)===stable(provider)&&stable(input.config.company_source_bindings)===stable(sources),'company_stage_configuration_mismatch');
      requireCompany(Array.isArray(input.companyObservations??[]),'invalid_prior_company_observations');
      await local.create(prefix+'/settings.json',workJSON({version:COMPANY_STAGE_VERSION,code_commit:codeCommit,provider_config:provider,source_bindings:sources,provenance_artifacts:provenances}));
      const privacy=await drive.assertPrivate();requireCompany(privacy?.verified===true&&privacy.owner_only===true,'private_company_destination_unverified');
      phase='artifacts';onProgress({phase:'company_artifact_restore'});
      const artifacts=[];
      for(const key of keys){const spec=provider[key],download=await drive.verifyFile(spec.id,spec);requireCompany(download.verified===true&&download.id===spec.id&&download.bytes===spec.bytes&&download.sha256===spec.sha256,'company_artifact_readback_mismatch');stagePath(download.path);artifacts.push({key,path:download.path,bytes:spec.bytes,sha256:spec.sha256});}
      const proofs=[];
      for(const spec of provenances){const proof=await drive.verifyFile(spec.id,spec);requireCompany(proof.verified===true&&proof.id===spec.id&&proof.bytes===spec.bytes&&proof.sha256===spec.sha256,'company_provenance_readback_mismatch');stagePath(proof.path);proofs.push({path:proof.path,bytes:spec.bytes,sha256:spec.sha256,ref:spec.ref});}
      phase='receipts';const receipts=[];let pending=[],pendingBytes=0;
      const useBatches=input.config.local_write_mode==='bounded_batches_v1';
      if(useBatches)requireCompany(typeof local.createMany==='function','company_local_batch_capability_missing');
      const flush=async()=>{if(!pending.length)return;const group=pending;pending=[];pendingBytes=0;const paths=await local.createMany(group.map(x=>({path:x.path,bytes:x.bytes})));requireCompany(Array.isArray(paths)&&paths.length===group.length&&paths.every((p,i)=>p===privateRoot+'/'+group[i].path),'company_local_batch_confirmation_mismatch');for(let i=0;i<group.length;i++)receipts.push({path:paths[i],bytes:group[i].bytes.length,sha256:group[i].sha256});};
      try{
        for(const object of input.objects){
          if(object.namespace!=='receipts')continue;
          const bytes=input.readLocal(object.local_path);requireCompany(bytes instanceof Uint8Array&&bytes.length===object.size&&await workHash(bytes)===object.sha256,'company_receipt_integrity_mismatch');
          const path=prefix+'/receipts/'+crypto.randomUUID()+'.json';
          if(useBatches&&bytes.length<=256*1024){if(pending.length===64||pendingBytes+bytes.length>256*1024)await flush();pending.push({path,bytes,sha256:object.sha256});pendingBytes+=bytes.length;}
          else{if(useBatches)await flush();const saved=await local.create(path,bytes);requireCompany(saved===privateRoot+'/'+path,'company_local_receipt_path_mismatch');receipts.push({path:saved,bytes:bytes.length,sha256:object.sha256});}
        }
      }finally{if(useBatches)await flush();}
      phase='generation';onProgress({phase:'company_observations',receipts:receipts.length});
      const generated=await host.run({provider_config:provider,artifacts,receipts,config:input.config,run_id:stageId,code_commit:codeCommit,source_bindings:sources,provenance_evidence:proofs,contradictory_receipt_ids:input.config.company_contradictory_receipt_ids??[]});
      requireCompany(generated.result?.status==='complete','company_stage_incomplete');
      const stage=generated.result;archive=stage.archive;
      const observationBytes=workUnbase64(stage.observations_base64);requireCompany(await workHash(observationBytes)===stage.observations_sha256,'company_stage_observation_bytes_mismatch');
      let observations;try{observations=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(observationBytes));}catch{throw new WorkFailure('invalid_company_stage_observations');}
      requireCompany(Array.isArray(observations)&&observations.every(x=>x&&x.kind==='company'&&x.provider==='DB-IP'&&x.employer===null&&['unknown','possible_corporate_match'].includes(x.identity_category)&&['ok','unavailable'].includes(x.status)),'company_stage_identity_or_completeness_violation');
      requireCompany(archive&&typeof archive.path==='string'&&archive.path.startsWith(privateRoot+'/'+prefix+'/')&&Number.isSafeInteger(archive.bytes)&&archive.bytes>0&&/^[a-f0-9]{64}$/.test(archive.sha256??'')&&/^[a-f0-9]{64}$/.test(archive.manifest_sha256??''),'invalid_company_stage_archive');stagePath(archive.path);
      phase='upload';const created=await drive.createFile(stageId+'.zip',{path:archive.path});
      requireCompany(typeof created.id==='string'&&created.id.length>0,'company_stage_upload_id_missing');
      archiveRef={id:created.id,url:created.url??null,bytes:archive.bytes,sha256:archive.sha256,manifest_sha256:archive.manifest_sha256};
      phase='readback';const downloaded=await drive.verifyFile(created.id,archive);
      requireCompany(downloaded.verified===true&&downloaded.id===created.id&&downloaded.bytes===archive.bytes&&downloaded.sha256===archive.sha256,'company_stage_archive_readback_mismatch');
      phase='replay';const checked=await host.verify({archive:{path:downloaded.path,bytes:archive.bytes,sha256:archive.sha256},expected_manifest_sha256:archive.manifest_sha256});
      requireCompany(checked.result?.status==='verified'&&checked.result.observations_match===true&&checked.result.observations_sha256===stage.observations_sha256,'company_stage_replay_failed');
      const proof={version:COMPANY_STAGE_VERSION,stage_id:stageId,status:'verified',source_commit:codeCommit,provider_config:provider,source_bindings:sources,provenance_artifacts:provenances,archive:archiveRef,summary:stage.summary,verification:checked.result,verified_employers:0};
      await local.create(prefix+'/verified.json',workJSON(proof));
      phase='analysis';const analyzed=await local.analyze({...input,codeCommit,companyObservations:[...(input.companyObservations??[]),...observations]});
      return {...analyzed,artifacts:[...analyzed.artifacts,{name:'company-stage-verification.json',bytes:workJSON(proof)}]};
    }catch(error){
      if(!archiveRef&&error?.created_file?.id)archiveRef={...error.created_file,...(archive?{bytes:archive.bytes,sha256:archive.sha256,manifest_sha256:archive.manifest_sha256}:{})};
      const reason=error instanceof WorkFailure?error.code:'company_stage_operation_failed';
      try{await local.create(prefix+'/failure-'+crypto.randomUUID()+'.json',workJSON({version:COMPANY_STAGE_VERSION,stage_id:stageId,phase,reason,archive:archiveRef,upload_outcome_unknown:phase==='upload'&&!archiveRef,verified_employers:0}));}catch{}
      throw new WorkFailure(reason);
    }
  };
}
