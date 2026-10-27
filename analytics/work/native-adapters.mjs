/* Native connector names were discovered in Work on 2026-10-23. No OAuth
 * token, account ID, destination ID or customer value belongs in this file. */
import {WorkFailure,workJSON,workUnbase64,workHash} from './pipeline.mjs';

export function workToolValue(result){
  if(result?.isError){const message=result.content?.filter(x=>x.type==='text').map(x=>x.text).join('');throw new WorkFailure(['page_budget_exceeded_retry_smaller_limit','invalid_cursor','export_configuration_unavailable','export_incomplete'].includes(message)?message:'connector_error');}
  if(result?.structuredContent&&typeof result.structuredContent==='object')return result.structuredContent;
  const text=result?.content?.filter(x=>x.type==='text').map(x=>x.text)||[];
  if(text.length===1){try{return JSON.parse(text[0]);}catch{if(['page_budget_exceeded_retry_smaller_limit','invalid_cursor','export_configuration_unavailable','export_incomplete'].includes(text[0]))throw new WorkFailure(text[0]);}}
  throw new WorkFailure('unsupported_connector_response');
}
function nativeEnsure(ok,code){if(!ok)throw new WorkFailure(code);}
function nativeMeta(value){return {id:value.id??value.fileId,url:value.url??value.webViewLink,parents:value.parent_ids??value.parents,permissions:value.permissions,shared:value.shared};}
function nativePrivate(meta,email){const p=meta.permissions;return meta.shared===false&&Array.isArray(p)&&p.length===1&&p[0].type==='user'&&p[0].role==='owner'&&(p[0].emailAddress??p[0].email_address)===email;}
function nativeRaw(value){const raw=value.raw;nativeEnsure(typeof raw==='string'&&raw.length>0&&/^[A-Za-z0-9_-]+={0,2}$/.test(raw),'raw_mail_unavailable');return workUnbase64(raw.replace(/-/g,'+').replace(/_/g,'/').replace(/=+$/,'').padEnd(Math.ceil(raw.replace(/=+$/,'').length/4)*4,'='));}

/** local is the Work host bridge in host-bridge.mjs. classify and analyze are
 * explicit versioned callbacks; no model or message can invoke native tools. */
export function createNativeAdapters({tools,local,settings,classify,analyze,now=()=>new Date().toISOString()}){
  const call=async(name,args)=>{nativeEnsure(typeof tools[name]==='function','required_tool_unavailable');return tools[name](args);};
  const collector={
    list:async args=>workToolValue(await call('mcp__codex_apps__farpoint_lead_collector_list_records',args)),
    chunk:async args=>workToolValue(await call('mcp__codex_apps__farpoint_lead_collector_read_record_chunk',args))
  };
  const drive={
    assertPrivate:async()=>{
      const raw=await call('mcp__codex_apps__google_drive_get_file_metadata',{fileId:settings.archive_folder_id,fields:'id,name,mimeType,parents,permissions,shared,webViewLink'});
      const value=workToolValue(raw),m=nativeMeta(value);await local.create(`adapter-evidence/destination-${crypto.randomUUID()}.json`,workJSON(raw));
      nativeEnsure(m.id===settings.archive_folder_id&&nativePrivate(m,settings.owner_email),'private_destination_unverified');
      return {verified:true,owner_only:true,evidence_refs:[`drive-folder:${m.id}`],observed_at:now(),permission_evidence:{folder_id:m.id,shared:m.shared,permissions:m.permissions}};
    },
    create:async(name,bytes)=>{
      const path=await local.create(`drive-staging/${crypto.randomUUID()}-${name}`,bytes);
      return drive.createFile(name,{path});
    },
    createFile:async(name,{path})=>{
      nativeEnsure(typeof path==='string'&&path.startsWith('/'),'invalid_upload_file_path');
      const raw=await call('mcp__codex_apps__google_drive_upload_file',{file_uri:path,file_name:name,mime_type:'application/octet-stream',parent_folder_id:settings.archive_folder_id});
      const upload=workToolValue(raw);const id=upload.id??upload.fileId;
      nativeEnsure(typeof id==='string'&&id,'drive_id_missing');
      try{
        await local.create(`adapter-evidence/drive-create-${crypto.randomUUID()}.json`,workJSON(raw));
        const meta=nativeMeta(workToolValue(await call('mcp__codex_apps__google_drive_get_file_metadata',{fileId:id,fields:'id,name,mimeType,parents,permissions,shared,webViewLink'})));
        nativeEnsure(meta.id===id&&meta.parents?.includes(settings.archive_folder_id)&&typeof meta.url==='string'&&nativePrivate(meta,settings.owner_email),'drive_destination_mismatch');return {id,url:meta.url};
      }catch(error){const failure=new WorkFailure(error instanceof WorkFailure?error.code:'drive_post_create_verification_failed');failure.created_file={id,url:typeof upload.url==='string'?upload.url:null};throw failure;}
    },
    verifyFile:async(id,{bytes,sha256})=>{
      const metadataRaw=await call('mcp__codex_apps__google_drive_get_file_metadata',{fileId:id,fields:'id,name,mimeType,parents,permissions,shared,webViewLink'});
      const meta=nativeMeta(workToolValue(metadataRaw));
      await local.create(`adapter-evidence/drive-verify-${crypto.randomUUID()}.json`,workJSON(metadataRaw));
      nativeEnsure(meta.id===id&&meta.parents?.includes(settings.archive_folder_id)&&typeof meta.url==='string'&&nativePrivate(meta,settings.owner_email),'drive_read_scope_mismatch');
      const raw=await call('mcp__codex_apps__google_drive_fetch',{url:meta.url,download_raw_file:true,include_base64:false});
      await local.create(`adapter-evidence/drive-fetch-${crypto.randomUUID()}.json`,workJSON(raw));
      nativeEnsure(!raw?.isError,'drive_fetch_failed');
      const proof=await local.verifyFileReference({response:raw,expectedBytes:bytes,expectedSha256:sha256});
      nativeEnsure(proof.verified===true&&proof.bytes===bytes&&proof.sha256===sha256,'drive_readback_mismatch');
      return {id,url:meta.url,...proof};
    },
    verifyJournal:async(id,expected)=>{
      const download=await drive.verifyFile(id,expected);
      const checked=await local.verifyJournal({...expected,path:download.path});
      nativeEnsure(checked.verified===true&&checked.entries_verified===true&&checked.bytes===expected.bytes&&checked.sha256===expected.sha256&&checked.manifest_sha256===expected.manifest_sha256&&checked.record_count===expected.entries.length,'packed_journal_integrity');
      return {...download,...checked,id,url:download.url};
    },
    read:async id=>{
      const meta=nativeMeta(workToolValue(await call('mcp__codex_apps__google_drive_get_file_metadata',{fileId:id,fields:'id,name,mimeType,parents,permissions,shared,webViewLink'})));
      nativeEnsure(meta.id===id&&meta.parents?.includes(settings.archive_folder_id)&&typeof meta.url==='string'&&nativePrivate(meta,settings.owner_email),'drive_read_scope_mismatch');
      const raw=await call('mcp__codex_apps__google_drive_fetch',{url:meta.url,download_raw_file:true,include_base64:false});
      nativeEnsure(!raw?.isError,'drive_fetch_failed');return local.readFileReference(raw);
    }
  };
  const mail={
    list:async({cursor})=>{
      nativeEnsure(typeof settings.mail_query==='string'&&settings.mail_query.includes('in:anywhere'),'mail_query_must_cover_filters');
      const raw=await call('mcp__codex_apps__gmail_search_emails',{link_id:settings.gmail_link_id,query:settings.mail_query,max_results:100,...(cursor?{next_page_token:cursor}:{})});
      const value=workToolValue(raw);await local.create(`adapter-evidence/mail-search-${crypto.randomUUID()}.json`,workJSON(raw));
      // Exact provider payload is normalized only for observed ID-list shapes.
      const ids=Array.isArray(value.emails)?value.emails.map(x=>x.id):null;
      nativeEnsure(Array.isArray(ids)&&ids.every(x=>typeof x==='string'),'unsupported_mail_search_response');
      nativeEnsure(value.next_page_token===null||typeof value.next_page_token==='string','missing_mail_continuation');
      return {message_ids:ids,next_cursor:value.next_page_token,enumeration_complete:value.next_page_token===null,query:settings.mail_query,source_payload:raw};
    },
    capture:async id=>{
      const raw=await call('mcp__codex_apps__gmail_read_email',{link_id:settings.gmail_link_id,message_id:id,format:'raw'});
      const artifacts=[{name:'connector.json',bytes:workJSON(raw)}];
      try{
        const value=workToolValue(raw);nativeEnsure((value.id??value.message_id)===id,'mail_message_mismatch');
        const bytes=nativeRaw(value);artifacts.push({name:'message.eml',bytes});
        // Gmail's raw representation may omit internalDate. Retrieve provider
        // metadata for the same immutable message; never substitute the sender's
        // Date header or an inferred timestamp for inbox receipt time.
        let internalDate=value.internal_date??value.internalDate;
        let metadataArtifact=null;
        if(!/^[0-9]+$/.test(String(internalDate??''))){
          const metadataRaw=await call('mcp__codex_apps__gmail_read_email',{link_id:settings.gmail_link_id,message_id:id,format:'metadata'});
          metadataArtifact={name:'metadata-connector.json',bytes:workJSON(metadataRaw)};
          artifacts.push(metadataArtifact);
          const metadata=workToolValue(metadataRaw);
          nativeEnsure((metadata.id??metadata.message_id)===id,'mail_metadata_message_mismatch');
          const rawThread=value.thread_id??value.threadId,metadataThread=metadata.thread_id??metadata.threadId;
          nativeEnsure(!rawThread||!metadataThread||rawThread===metadataThread,'mail_metadata_thread_mismatch');
          internalDate=metadata.internal_date??metadata.internalDate;
          nativeEnsure(/^[0-9]+$/.test(String(internalDate??'')),'missing_gmail_internal_date');
        }
        // RFC2822 bytes include original MIME attachments and duplicate headers.
        const normalized=await local.normalizeMail({raw:bytes,connector:raw,message_id:id,mailbox:settings.mailbox,captured_at:now(),internal_date:internalDate});
        if(metadataArtifact)normalized.artifacts.push(metadataArtifact);
        return normalized;
      }catch(error){return {complete:false,reason:error instanceof WorkFailure?error.code:'mail_normalization_failed',capture:null,artifacts};}
    }
  };
  return {collector,drive,mail,classify,analyze,journal:{create:(path,bytes)=>local.create(`run/${path}`,bytes),
    createMany:async files=>{
      try{return await local.createMany(files.map(x=>({...x,path:'run/'+x.path})));}
      catch(error){if(Array.isArray(error.created_local_files))error.created_local_files=error.created_local_files.map(x=>({...x,relative_path:x.relative_path.startsWith('run/')?x.relative_path.slice(4):x.relative_path}));throw error;}
    },packJournal:args=>local.packJournal(args)},now};
}

/** Convert reviewed classification observations to a full explicit boundary.
 * Unseen mail is unresolved, never silently treated as a lead or ignored.
 * Hashes are supplied by the Python normalizer (same canonical implementation).
 */
export function createFrozenClassifier({observations=[],evidenceRefs=[],ruleVersion='farpoint-mail-review/1',reviewMetadata=null}){
  if(observations.length)nativeEnsure(reviewMetadata&&typeof reviewMetadata.prompt==='string'&&reviewMetadata.prompt.length>0&&typeof reviewMetadata.model==='object'&&typeof reviewMetadata.reviewed_at==='string'&&typeof reviewMetadata.rule_version==='string'&&typeof reviewMetadata.code_commit==='string'&&/^[a-f0-9]{40}$/.test(reviewMetadata.code_commit),'classification_review_metadata_required');
  nativeEnsure(observations.every(x=>['reviewed','unreviewed'].includes(x.review_state)&&(x.review_state!=='unreviewed'||x.kind==='unresolved')),'classification_review_state_required');
  return async({captures,observed_at})=>{
    const result=[],unreviewed=[];
    for(const capture of captures){
      const known=observations.filter(x=>x.mailbox===capture.mailbox&&x.message_id===capture.message_id&&x.message_content_sha256===capture.message_content_sha256);
      if(known.length)result.push(...known);
      if(!known.some(x=>x.review_state==='reviewed'&&typeof x.classified_at==='string'&&Number.isFinite(Date.parse(x.classified_at))&&new Date(x.classified_at).toISOString()===x.classified_at&&Date.parse(x.classified_at)<=Date.parse(observed_at))){unreviewed.push(capture.message_id);if(!known.length)result.push({review_state:'unreviewed',classification_id:crypto.randomUUID(),mailbox:capture.mailbox,message_id:capture.message_id,message_content_sha256:capture.message_content_sha256,classified_at:observed_at,rule_version:ruleVersion,kind:'unresolved',status:'confirmed',evidence_refs:[`capture:${capture.observation_id}`]});}
    }
    return {complete:true,observations:result,unreviewed_message_ids:unreviewed,review_metadata:reviewMetadata,evidence_refs:evidenceRefs.length?evidenceRefs:['rule:farpoint-mail-review/1; unseen messages explicitly unresolved']};
  };
}
