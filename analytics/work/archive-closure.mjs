/* Complete the durable evidence boundary after the ordinary Work pipeline.
 * All destinations and account values are private caller configuration.
 * Nothing is deleted, replaced, shared, scheduled or sent to customers.
 */
import {WorkFailure,workJSON,workHash,verifyRemoteRun} from './pipeline.mjs';
import {createNativeAdapters,workToolValue} from './native-adapters.mjs';
import {createWorkHostBridge} from './host-bridge.mjs';

export const CLOSURE_VERSION='farpoint-work-closure/1.1.0';
function closureRequire(ok,code){if(!ok)throw new WorkFailure(code);}
function closureRelative(path){return typeof path==='string'&&path.length<500&&!path.startsWith('/')&&!path.includes('\\')&&!path.split('/').some(x=>!x||x==='.'||x==='..');}

/** One repeatable entry point for remote-file verification, complete private
 * source/envelope packaging, downloaded ZIP restoration and numerical replay.
 * A pipeline completion is not a closure completion until this returns verified.
 */
export async function closeWorkArchive({tools,settings,pipelineResult,evidenceRoot,pipelineRelativeRoot,outputRoot,repositoryRoot,sourceCommit,toolingCommit,now=()=>new Date().toISOString(),makeLocal=createWorkHostBridge,makeAdapters=createNativeAdapters,onProgress=()=>{}}){
  closureRequire(pipelineResult?.status==='complete'&&pipelineResult.completion?.id,'pipeline_not_completed');
  closureRequire(closureRelative(pipelineRelativeRoot),'invalid_pipeline_relative_root');
  closureRequire(/^[a-f0-9]{40}$/.test(sourceCommit??'')&&/^[a-f0-9]{40}$/.test(toolingCommit??''),'exact_closure_commits_required');
  closureRequire(typeof evidenceRoot==='string'&&typeof outputRoot==='string'&&evidenceRoot!==outputRoot&&!outputRoot.startsWith(evidenceRoot+'/'),'closure_output_inside_evidence');
  closureRequire(typeof repositoryRoot==='string'&&evidenceRoot!==repositoryRoot&&outputRoot!==repositoryRoot&&!evidenceRoot.startsWith(repositoryRoot+'/')&&!outputRoot.startsWith(repositoryRoot+'/'),'private_evidence_inside_repository');
  const closureId=crypto.randomUUID();
  const evidence=makeLocal({tools,privateRoot:evidenceRoot+'/closure-proof-'+closureId,repositoryRoot});
  const output=makeLocal({tools,privateRoot:outputRoot,repositoryRoot});
  const sourceDrive=makeAdapters({tools,local:evidence,settings}).drive;
  const outputDrive=makeAdapters({tools,local:output,settings}).drive;
  let phase='remote_completion',zipRef=null,closureRef=null;
  try{
    const sourcePrivacy=await sourceDrive.assertPrivate();
    closureRequire(sourcePrivacy.verified===true&&sourcePrivacy.owner_only===true,'private_destination_unverified');
    const completion=pipelineResult.completion;
    const completionBytes=await sourceDrive.read(completion.id);
    closureRequire(completionBytes.length===completion.bytes&&await workHash(completionBytes)===completion.sha256,'pipeline_completion_changed');
    // Reuse the just-downloaded, independently matched completion bytes; the
    // referenced manifest is read through the authenticated adapter here.
    const verified=await verifyRemoteRun({completionId:completion.id,drive:{read:id=>id===completion.id?completionBytes:sourceDrive.read(id)},full:false});
    const manifest=verified.manifest;
    closureRequire(verified.run_id===pipelineResult.run_id,'pipeline_run_mismatch');
    const configRef=manifest.files.find(x=>x.path==='inputs/config.json');
    closureRequire(!!configRef,'pipeline_config_missing');
    const configBytes=await sourceDrive.read(configRef.id);
    closureRequire(configBytes.length===configRef.bytes&&await workHash(configBytes)===configRef.sha256,'pipeline_config_changed');
    const config=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(configBytes));
    closureRequire(config.execution_code_commit===sourceCommit,'pipeline_source_commit_mismatch');
    const packed=manifest.archive_mode==='packed_journal_v1';
    if(packed)closureRequire(manifest.packed_journal.source_commit===sourceCommit&&config.archive_mode==='packed_journal_v1','packed_source_commit_mismatch');
    await evidence.captureClosureSource();
    phase='remote_files';
    const observations=[];
    for(let offset=0;offset<manifest.files.length;offset+=4){
      const group=manifest.files.slice(offset,offset+4);
      const results=await Promise.allSettled(group.map(async file=>{
        let proof;
        if(packed&&file.path===manifest.packed_journal.path){
          proof=await sourceDrive.verifyJournal(file.id,{...file,manifest_sha256:manifest.packed_journal.manifest_sha256,entries:manifest.logical_files,runId:manifest.run_id,sourceCommit});
          closureRequire(proof.entries_verified===true&&proof.manifest_sha256===manifest.packed_journal.manifest_sha256&&proof.record_count===manifest.logical_files.length,'packed_journal_integrity');
        }else proof=await sourceDrive.verifyFile(file.id,file);
        closureRequire(proof.verified===true&&proof.bytes===file.bytes&&proof.sha256===file.sha256,'remote_file_verification_failed');return {source_path:file.path,...proof};
      }));
      let failed=false;
      for(let i=0;i<results.length;i++){
        const result=results[i];
        if(result.status==='fulfilled')observations.push(result.value);
        else{failed=true;observations.push({source_path:group[i].path,id:group[i].id,verified:false,reason:result.reason instanceof WorkFailure?result.reason.code:'remote_file_verification_failed'});}
      }
      await evidence.create('remote-verification/batch-'+offset+'.json',workJSON(observations.slice(-group.length)));
      closureRequire(!failed,'remote_file_verification_failed');
      onProgress({phase:'remote_files',verified:observations.length,total:manifest.files.length});
    }
    const remoteProof={version:CLOSURE_VERSION,run_id:verified.run_id,completion,manifest:JSON.parse(new TextDecoder().decode(completionBytes)).manifest,verified_at:now(),full_content_verification:true,record_count:observations.length,files:observations};
    await evidence.create('remote-verification/completed.json',workJSON(remoteProof));
    const logicalFiles=packed?manifest.logical_files:manifest.files;
    const binding={schema_version:1,run_id:verified.run_id,source_commit:sourceCommit,closure_tooling_commit:toolingCommit,pipeline_completion:{id:completion.id,bytes:completion.bytes,sha256:completion.sha256},pipeline_manifest:remoteProof.manifest,required_source_files:logicalFiles.map(file=>({path:pipelineRelativeRoot+'/run/'+file.path,bytes:file.bytes,sha256:file.sha256})),scope:'All listed pipeline inputs, connector evidence and retained attempts under the configured evidence root; not a transactional source snapshot.'};
    phase='pack';
    const archive=await output.packEvidence({sourceRoot:evidenceRoot,binding});
    closureRequire(archive.status==='packed'&&archive.path?.startsWith(outputRoot+'/'),'invalid_closure_package');
    await output.create('package-descriptor.json',workJSON(archive));
    const uploadPrivacy=await outputDrive.assertPrivate();
    closureRequire(uploadPrivacy.verified===true&&uploadPrivacy.owner_only===true,'private_destination_unverified');
    phase='upload';
    const uploaded=await tools.mcp__codex_apps__google_drive_upload_file({file_uri:archive.path,file_name:verified.run_id+'-evidence-'+closureId+'.zip',mime_type:'application/zip',parent_folder_id:settings.archive_folder_id});
    await output.create('upload-envelope.json',workJSON(uploaded));
    const value=workToolValue(uploaded),id=value.id??value.fileId;
    closureRequire(typeof id==='string'&&id.length>0,'closure_upload_id_missing');
    zipRef={id,bytes:archive.bytes,sha256:archive.sha256};
    phase='download_restore';
    const download=await outputDrive.verifyFile(id,archive);
    zipRef.url=download.url;
    const restored=await output.restoreEvidence({path:download.path,bytes:archive.bytes,sha256:archive.sha256});
    closureRequire(restored.status==='verified_and_restored'&&restored.manifest_sha256===archive.manifest_sha256&&restored.record_count===archive.record_count,'closure_restore_mismatch');
    phase='numerical_replay';
    const replay=await output.replayAnalysis({archive:restored.path+'/'+pipelineRelativeRoot+'/run/analysis',sourceCommit});
    closureRequire(replay.verified===true&&replay.archived_source_used===true,'closure_replay_unverified');
    const record={schema_version:1,kind:'farpoint_work_archive_closure',version:CLOSURE_VERSION,closure_id:closureId,state:'verified',verified_at:now(),run_id:verified.run_id,source_commit:sourceCommit,closure_tooling_commit:toolingCommit,pipeline_completion:completion,pipeline_manifest:remoteProof.manifest,report_authority:manifest.report_authority,full_remote_file_verification:{record_count:observations.length,total_bytes:manifest.total_bytes,logical_record_count:logicalFiles.length,logical_total_bytes:logicalFiles.reduce((n,f)=>n+f.bytes,0)},evidence_archive:{...zipRef,manifest_sha256:archive.manifest_sha256,record_count:archive.record_count,total_source_bytes:archive.total_source_bytes},fresh_restore:{verified:true,manifest_sha256:restored.manifest_sha256,record_count:restored.record_count},numerical_replay:replay,production_readiness:false,scheduled_execution_verified:false,independent_os_runtime_recovery:false};
    const bytes=workJSON(record);
    await output.create('closure-record.json',bytes);
    phase='closure_record';
    const final=await outputDrive.create(verified.run_id+'-closure-'+closureId+'.json',bytes);
    closureRef={...final,bytes:bytes.length,sha256:await workHash(bytes),verified:false};
    const checked=await outputDrive.verifyFile(final.id,closureRef);
    closureRequire(checked.verified===true&&checked.id===final.id&&checked.bytes===closureRef.bytes&&checked.sha256===closureRef.sha256,'closure_record_readback_mismatch');
    closureRef.verified=true;
    return {status:'verified',run_id:verified.run_id,closure:closureRef,archive:zipRef,record_count:observations.length,archive_record_count:archive.record_count,numerical_replay:replay,output_root:outputRoot,production_readiness:false};
  }catch(error){
    const failure={schema_version:1,kind:'farpoint_work_archive_closure',version:CLOSURE_VERSION,state:'failed',phase,reason:error instanceof WorkFailure?error.code:'closure_operation_failed',run_id:pipelineResult.run_id,at:now(),pipeline_completion:pipelineResult.completion,created_archive:zipRef,created_closure:closureRef,created_file:error?.created_file??null,upload_outcome_unknown:phase==='upload'&&!zipRef,production_readiness:false};
    try{await output.create('closure-failure-'+crypto.randomUUID()+'.json',workJSON(failure));}catch{}
    return {status:'failed',...failure,output_root:outputRoot};
  }
}
