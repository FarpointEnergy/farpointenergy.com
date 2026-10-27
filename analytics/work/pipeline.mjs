/* Versioned Work orchestration. No SDK, network, storage, timer or credentials.
 * The host supplies the named capabilities; production adapters fail closed.
 * Every invocation is a full rescan into a NEW run. A retry never edits a run.
 */
export const WORK_VERSION = 'farpoint-work/1.0.1';
// Patch releases share the archive schema; completion and manifest must still agree.
const READABLE_WORK_VERSIONS = new Set(['farpoint-work/1.0.0', WORK_VERSION]);
const workEncoder = new TextEncoder();
const workDecoder = new TextDecoder('utf-8', {fatal:true});
const workHex = /^[a-f0-9]{64}$/;
const workKey = /^(receipts|rejections)\/\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9_-]{8,100}\.json$/;
export class WorkFailure extends Error { constructor(code){super(code);this.code=code;} }
function workRequire(ok,code){if(!ok)throw new WorkFailure(code);}
function workBytes(value){return value instanceof Uint8Array?value:workEncoder.encode(value);}
export async function workHash(value){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',workBytes(value)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export function workJSON(value){return workEncoder.encode(JSON.stringify(value));}
export function workUnbase64(value){workRequire(typeof value==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),'invalid_base64');return Uint8Array.from(atob(value),x=>x.charCodeAt(0));}
function workCode(error){return error instanceof WorkFailure?error.code:'adapter_failure';}
function workSafePath(path){workRequire(typeof path==='string'&&path.length<600&&!path.startsWith('/')&&!path.includes('\\')&&!path.split('/').some(x=>!x||x==='.'||x==='..'),'unsafe_path');return path;}
function workIso(value){const d=new Date(value);workRequire(typeof value==='string'&&Number.isFinite(d.getTime())&&/Z$|[+-]\d\d:\d\d$/.test(value),'invalid_time');return d.toISOString();}
function workJob(value){workRequire(value&&['id','version','scope_id'].every(k=>typeof value[k]==='string'&&/^[A-Za-z0-9_.-]{1,128}$/.test(value[k]))&&['archive','report'].includes(value.kind)&&Object.keys(value).length===4,'invalid_job_identity');return {id:value.id,version:value.version,scope_id:value.scope_id,kind:value.kind};}

/** collector.{list,chunk} are authenticated tool callbacks, not HTTP headers.
 * journal.create(path,bytes) must be create-only and confirm byte readback.
 * drive.{assertPrivate,create,read} operate on exact IDs, never replace-by-name.
 * mail.{list,capture}, classify and analyze are separate trusted adapters.
 */
export async function runLeadPipeline({runId,config,collector,mail,classify,analyze,journal,drive,now=()=>new Date().toISOString(),limits={}}){
  workRequire(/^[A-Za-z0-9_-]{8,100}$/.test(runId||''),'invalid_run_id');
  const job=workJob(config?.job),windowStart=workIso(config.window_start),windowEnd=workIso(config.window_end);
  workRequire(windowStart<windowEnd,'invalid_report_window');
  const cap={pages:10000,objects:100000,objectBytes:1024*1024,totalBytes:256*1024*1024,...limits};
  for(const x of Object.values(cap))workRequire(Number.isSafeInteger(x)&&x>0,'invalid_limit');
  const startedAt=workIso(now()), files=new Map(), failures=[], sources={collector:false,mail:false,classifications:false};
  let seq=0,totalBytes=0,phase='destination',remoteStarted=null;const createdIds=new Set(),uploadedPaths=new Set(),remoteObservations=[];
  const record=async(path,bytes)=>{workSafePath(path);workRequire(!files.has(path),'duplicate_local_path');bytes=workBytes(bytes);const hash=await workHash(bytes);await journal.create(path,bytes);files.set(path,{path,bytes:bytes.length,sha256:hash,data:bytes});return {path,bytes:bytes.length,sha256:hash};};
  const observe=async(kind,value)=>record(`observations/${String(seq++).padStart(6,'0')}-${kind}.json`,workJSON(value));
  const fail=async(stage,error)=>{const item={stage,reason:workCode(error),at:workIso(now())};failures.push(item);await observe('failure',item);};
  const createRemote=async(name,data,path=name)=>{
    const observation={name:`${runId}-${name}`,path,bytes:data.length,sha256:await workHash(data),id:null,url:null,verified:false,state:'requested'};
    remoteObservations.push(observation);
    try{
      const result=await drive.create(observation.name,data);
      if(typeof result?.id==='string'&&result.id)observation.id=result.id;
      if(typeof result?.url==='string')observation.url=result.url;
      workRequire(observation.id&&observation.url,'invalid_drive_create');
      workRequire(!createdIds.has(result.id),'duplicate_remote_file_id');createdIds.add(result.id);
      observation.state='created_unverified';
      if(typeof drive.verifyFile==='function'){
        // The native bridge downloads and hashes the full file, retaining those
        // exact bytes privately without streaming a second copy through V8.
        const readback=await drive.verifyFile(result.id,{bytes:data.length,sha256:observation.sha256});
        workRequire(readback?.verified===true&&readback.id===result.id&&readback.bytes===data.length&&readback.sha256===observation.sha256,'drive_readback_mismatch');
      }else{
        const readback=await drive.read(result.id);
        workRequire(readback instanceof Uint8Array&&readback.length===data.length&&await workHash(readback)===observation.sha256,'drive_readback_mismatch');
      }
      observation.verified=true;observation.state='verified';
      return {id:result.id,url:result.url,bytes:data.length,sha256:observation.sha256};
    }catch(error){if(!observation.id&&typeof error?.created_file?.id==='string'&&error.created_file.id){observation.id=error.created_file.id;observation.url=typeof error.created_file.url==='string'?error.created_file.url:null;}observation.state=observation.id?'created_unverified':'create_outcome_unknown';observation.reason=workCode(error);throw error;}
  };
  try {
    const privacy=await drive.assertPrivate();
    workRequire(privacy?.verified===true&&privacy?.owner_only===true&&Array.isArray(privacy.evidence_refs)&&privacy.evidence_refs.length>0,'private_destination_unverified');
    await observe('destination',privacy);
    const started={schema_version:1,run_id:runId,state:'started',started_at:startedAt,work_version:WORK_VERSION};
    await record('started.json',workJSON(started));
    remoteStarted=await createRemote('started.json',workJSON(started));
    phase='collector';
    const objects=[];
    let collectorComplete=true;
    for(const namespace of ['receipts','rejections']){
      let cursor=null,limit=40,pages=0;const cursors=new Set(),keys=new Map();
      try {
        for(;;){
          workRequire(++pages<=cap.pages,'collector_page_limit');
          let page;
          try{page=await collector.list({namespace,cursor,limit});}
          catch(error){if(error?.code==='page_budget_exceeded_retry_smaller_limit'&&limit>1){limit=Math.max(1,Math.floor(limit/2));await observe('page-budget',{namespace,limit,cursor,at:workIso(now())});continue;}throw error;}
          await observe('collector-page',{namespace,request:{cursor,limit},response:page});
          workRequire(page?.export_format_version===1&&page.namespace===namespace&&Array.isArray(page.items)&&typeof page.enumeration_complete==='boolean'&&page.transactional_snapshot===false,'invalid_collector_page');
          workRequire(page.enumeration_complete?page.next_cursor===null:typeof page.next_cursor==='string'&&!!page.next_cursor,'invalid_collector_continuation');
          for(const item of page.items){
            workRequire(workKey.test(item?.key||'')&&item.key.startsWith(namespace+'/')&&Number.isSafeInteger(item.size)&&item.size>=0&&item.size<=cap.objectBytes&&workHex.test(item.sha256||''),'invalid_collector_item');
            const prior=keys.get(item.key);
            if(prior){workRequire(prior.sha256===item.sha256&&prior.size===item.size,'conflicting_source_object');continue;}
            workRequire(objects.length<cap.objects&&totalBytes+item.size<=cap.totalBytes,'collector_capacity_limit');
            const chunks=[];let offset=0;
            do {
              const part=await collector.chunk({key:item.key,offset,max_bytes:8192});
              await observe('collector-chunk',{request:{key:item.key,offset,max_bytes:8192},response:part});
              workRequire(part?.export_format_version===1&&part.key===item.key&&part.encoding==='base64'&&part.offset===offset&&part.object_size===item.size&&part.object_sha256===item.sha256,'inconsistent_chunk_metadata');
              const bytes=workUnbase64(part.body_base64);
              workRequire(bytes.length===part.bytes&&bytes.length===Math.min(8192,item.size-offset)&&part.next_offset===offset+bytes.length&&part.object_complete===(part.next_offset===item.size),'invalid_chunk_progress');
              chunks.push(bytes);offset=part.next_offset;
            }while(offset<item.size);
            const bytes=new Uint8Array(item.size);let p=0;for(const chunk of chunks){bytes.set(chunk,p);p+=chunk.length;}
            workRequire(await workHash(bytes)===item.sha256,'collector_object_hash_mismatch');
            await record(`raw/collector/${item.key}`,bytes);keys.set(item.key,{sha256:item.sha256,size:item.size});totalBytes+=bytes.length;
            objects.push({...item,namespace,local_path:`raw/collector/${item.key}`});
          }
          if(page.enumeration_complete)break;
          workRequire(!cursors.has(page.next_cursor)&&page.next_cursor!==cursor,'repeated_collector_cursor');cursors.add(page.next_cursor);cursor=page.next_cursor;
        }
        await observe('source-complete',{namespace,objects:keys.size,scan_started_at:startedAt,scan_finished_at:workIso(now()),transactional_snapshot:false});
      }catch(error){collectorComplete=false;await fail(namespace,error);}
    }
    sources.collector=collectorComplete;
    phase='mail';
    const captures=[];let mailComplete=true,mailCursor=null,mailPages=0;
    const mailTokens=new Set(),messageIds=new Set();
    try {
      for(;;){
        workRequire(++mailPages<=cap.pages,'mail_page_limit');
        const page=await mail.list({cursor:mailCursor});await observe('mail-page',{request:{cursor:mailCursor},response:page});
        workRequire(page&&Array.isArray(page.message_ids)&&typeof page.enumeration_complete==='boolean','invalid_mail_page');
        workRequire(page.enumeration_complete?page.next_cursor===null:typeof page.next_cursor==='string'&&!!page.next_cursor,'invalid_mail_continuation');
        for(const id of page.message_ids){
          workRequire(typeof id==='string'&&id.length>0&&id.length<=200,'invalid_message_id');if(messageIds.has(id))continue;
          workRequire(messageIds.size<cap.objects,'mail_capacity_limit');messageIds.add(id);
          try{
            const capture=await mail.capture(id);await observe('mail-capture',{message_id:id,response:capture});
            workRequire(Array.isArray(capture?.artifacts),'incomplete_mail_capture');
            // Preserve obtained raw bytes even when normalization is invalid.
            for(const artifact of capture.artifacts){workRequire(artifact.bytes instanceof Uint8Array,'invalid_mail_artifact');await record(`raw/mail/${id}/${workSafePath(artifact.name)}`,artifact.bytes);}
            workRequire(capture?.capture?.message_id===id&&capture.complete===true,'incomplete_mail_capture');
            captures.push(capture.capture);
          }catch(error){mailComplete=false;await fail('mail-message',error);}
        }
        if(page.enumeration_complete)break;
        workRequire(!mailTokens.has(page.next_cursor)&&page.next_cursor!==mailCursor,'repeated_mail_cursor');mailTokens.add(page.next_cursor);mailCursor=page.next_cursor;
      }
    }catch(error){mailComplete=false;await fail('mail-enumeration',error);}
    sources.mail=mailComplete;
    phase='classification';
    let classifications=[],unreviewedMessages=[];
    try{
      const result=await classify({captures,run_id:runId,observed_at:workIso(now())});
      await observe('classifications',result);
      workRequire(result?.complete===true&&Array.isArray(result.observations)&&Array.isArray(result.evidence_refs)&&result.evidence_refs.length>0,'classification_evidence_incomplete');
      const classified=new Set(result.observations.map(x=>`${x.mailbox}\0${x.message_id}`));
      workRequire(captures.every(x=>classified.has(`${x.mailbox}\0${x.message_id}`)),'unclassified_messages');
      workRequire(Array.isArray(result.unreviewed_message_ids??[]),'invalid_classification_review_state');
      classifications=result.observations;unreviewedMessages=result.unreviewed_message_ids??[];sources.classifications=true;
    }catch(error){await fail('classifications',error);}
    phase='analysis';
    const frozenConfig={...config,observation_cutoff:workIso(now()),source_completeness:sources};
    await record('inputs/config.json',workJSON(frozenConfig));
    await record('inputs/messages.json',workJSON(captures));
    await record('inputs/classifications.json',workJSON(classifications));
    await record('inputs/collector-inventory.json',workJSON({scan_started_at:startedAt,scan_finished_at:workIso(now()),objects,transactional_snapshot:false}));
    const analyzed=await analyze({objects,captures,classifications,config:frozenConfig,readLocal:path=>files.get(path)?.data});
    workRequire(analyzed?.report&&Array.isArray(analyzed.artifacts),'invalid_analysis_result');
    for(const artifact of analyzed.artifacts){workRequire(artifact.bytes instanceof Uint8Array,'invalid_analysis_artifact');await record(`analysis/${workSafePath(artifact.name)}`,artifact.bytes);}
    const authority=unreviewedMessages.length?'needs_review':analyzed.report.mail_unresolved?.length?'qualified':'complete_for_observed_evidence';
    const health={collector_enumeration_complete:sources.collector,mail_enumeration_complete:sources.mail,classification_complete:sources.classifications,report_authority:authority,unreviewed_message_ids:unreviewedMessages,canary:config.canary_observation??{status:'unverified'},prior_archive:config.prior_archive_observation??{status:'unverified'},failures};
    await record('report/report.json',workJSON({...analyzed.report,report_authority:authority,unreviewed_message_ids:unreviewedMessages,work_report:{version:WORK_VERSION,job,source_completeness:sources}}));
    await record('report/report.md',workEncoder.encode(renderLeadReport(analyzed.report,health)));
    phase='archive';
    const frozen=[...files.values()];const remoteFiles=[];
    for(const file of frozen){const ref=await createRemote(file.path.replaceAll('/','--'),file.data,file.path);remoteFiles.push({path:file.path,...ref});uploadedPaths.add(file.path);}
    const complete=failures.length===0&&Object.values(sources).every(x=>x===true)&&analyzed.report.status==='complete';
    const manifest={schema_version:1,run_id:runId,work_version:WORK_VERSION,job,window_start:windowStart,window_end:windowEnd,started_at:startedAt,finished_at:workIso(now()),observation_cutoff:frozenConfig.observation_cutoff,source_completeness:sources,report_status:analyzed.report.status,report_authority:authority,unreviewed_message_ids:unreviewedMessages,source_snapshot_claim:'exact listed inputs; not a transactional source snapshot',files:remoteFiles,record_count:remoteFiles.length,total_bytes:remoteFiles.reduce((s,x)=>s+x.bytes,0),failures};
    const manifestBytes=workJSON(manifest);await record('remote-manifest.json',manifestBytes);const manifestRef=await createRemote('remote-manifest.json',manifestBytes);
    const completion={schema_version:1,run_id:runId,work_version:WORK_VERSION,job,window_start:windowStart,window_end:windowEnd,state:complete?'completed':'partial',verified_at:workIso(now()),manifest:manifestRef,record_count:manifest.record_count,total_bytes:manifest.total_bytes,source_completeness:sources,report_status:analyzed.report.status,report_authority:authority};
    await record(complete?'remote-completed.json':'remote-partial.json',workJSON(completion));const finalRef=await createRemote(complete?'completed.json':'partial.json',workJSON(completion));
    return {status:complete?'complete':'partial',run_id:runId,manifest:manifestRef,completion:finalRef,report_status:analyzed.report.status,report_authority:authority,unreviewed_message_ids:unreviewedMessages,failures};
  }catch(error){
    const failure={schema_version:1,run_id:runId,state:'failed',phase,reason:workCode(error),at:workIso(now()),started_record:remoteStarted,remote_observations:remoteObservations.map(x=>({...x}))};
    try{await record(`failure-${seq++}.json`,workJSON(failure));}catch{}
    let remoteFailure=null;
    if(remoteObservations.length){
      // A broken parser/report must not prevent archival of bytes already read.
      // If Drive itself is failing, stop after its first recovery failure.
      const recovered=[];
      for(const file of [...files.values()]){if(uploadedPaths.has(file.path))continue;try{const ref=await createRemote('partial-'+file.path.replaceAll('/','--'),file.data,file.path);recovered.push({path:file.path,...ref});uploadedPaths.add(file.path);}catch{break;}}
      const finalFailure={...failure,recovered_files:recovered,remote_observations:remoteObservations.map(x=>({...x})),retained_partial_files:remoteObservations.filter(x=>x.id).map(x=>({...x})),ambiguous_remote_creates:remoteObservations.filter(x=>!x.id).map(x=>({...x})),unarchived_local_files:[...files.keys()].filter(x=>!uploadedPaths.has(x))};
      try{await record(`failure-recovery-${seq++}.json`,workJSON(finalFailure));}catch{}
      try{remoteFailure=await createRemote(`failure-${seq++}.json`,workJSON(finalFailure));}catch{}
    }
    return {status:'failed',run_id:runId,reason:failure.reason,phase,failure_record:remoteFailure,completed:false};
  }
}

/** Re-read exact remote bytes. Use full=true for recovery; watchdog checks the
 * completed record + manifest and reports common-platform outages separately. */
export async function verifyRemoteRun({completionId,drive,full=true}){
  const completionBytes=await drive.read(completionId);const c=JSON.parse(workDecoder.decode(completionBytes));
  workRequire(c?.schema_version===1&&c.state==='completed'&&c.report_status==='complete'&&Object.values(c.source_completeness||{}).length>=3&&['collector','mail','classifications'].every(k=>c.source_completeness[k]===true)&&Object.values(c.source_completeness).every(x=>x===true),'not_verified_completion');
  workRequire(c.manifest&&workHex.test(c.manifest.sha256||''),'invalid_manifest_reference');
  const bytes=await drive.read(c.manifest.id);workRequire(bytes.length===c.manifest.bytes&&await workHash(bytes)===c.manifest.sha256,'remote_manifest_integrity');
  const m=JSON.parse(workDecoder.decode(bytes));workRequire(m.run_id===c.run_id&&m.report_status==='complete'&&Array.isArray(m.files)&&m.record_count===m.files.length&&m.record_count===c.record_count&&m.total_bytes===c.total_bytes&&m.total_bytes===m.files.reduce((s,x)=>s+x.bytes,0),'remote_manifest_counts');
  workRequire(JSON.stringify(workJob(c.job))===JSON.stringify(workJob(m.job))&&workIso(c.window_start)===workIso(m.window_start)&&workIso(c.window_end)===workIso(m.window_end)&&c.window_start<c.window_end&&c.report_authority===m.report_authority&&['needs_review','qualified','complete_for_observed_evidence'].includes(m.report_authority)&&c.work_version===m.work_version&&READABLE_WORK_VERSIONS.has(m.work_version)&&['collector','mail','classifications'].every(k=>m.source_completeness?.[k]===true),'remote_manifest_scope_mismatch');
  const ids=new Set(),paths=new Set();for(const f of m.files){workSafePath(f.path);workRequire(typeof f.id==='string'&&!ids.has(f.id)&&!paths.has(f.path)&&Number.isSafeInteger(f.bytes)&&f.bytes>=0&&workHex.test(f.sha256||''),'invalid_manifest_entry');ids.add(f.id);paths.add(f.path);if(full){const b=await drive.read(f.id);workRequire(b.length===f.bytes&&await workHash(b)===f.sha256,'remote_file_integrity');}}
  return {status:'verified',run_id:c.run_id,verified_at:c.verified_at,record_count:m.record_count,full_content_verification:full,manifest:m};
}

export async function evaluateWatchdog({expectedIntervals,completionIds,drive,now,canary={status:'unverified'}}){
  const verified=[],errors=[];for(const id of completionIds){try{verified.push(await verifyRemoteRun({completionId:id,drive,full:false}));}catch(error){errors.push({completion_id:id,reason:workCode(error)});}}
  for(const interval of expectedIntervals){workJob(interval.job);workRequire(Date.parse(workIso(interval.start))<Date.parse(workIso(interval.end))&&workIso(interval.window_start)<workIso(interval.window_end),'invalid_watchdog_interval');}
  const matches=(r,interval)=>Date.parse(r.manifest.started_at)>=Date.parse(interval.start)&&Date.parse(r.manifest.started_at)<Date.parse(interval.end)&&JSON.stringify(workJob(r.manifest.job))===JSON.stringify(workJob(interval.job))&&r.manifest.window_start===workIso(interval.window_start)&&r.manifest.window_end===workIso(interval.window_end);
  const missed=expectedIntervals.filter(interval=>!verified.some(r=>matches(r,interval)&&(interval.job.kind!=='report'||r.manifest.report_authority!=='needs_review')));
  const latest=verified.map(r=>r.verified_at).sort().at(-1)??null;
  const historicalPending=verified.filter(r=>r.manifest.report_authority==='needs_review').map(r=>r.run_id);
  const reviewPending=verified.filter(r=>r.manifest.report_authority==='needs_review'&&missed.some(interval=>interval.job.kind==='report'&&matches(r,interval))).map(r=>r.run_id);
  return {rule_version:WORK_VERSION,observed_at:workIso(now),status:missed.length||errors.length||reviewPending.length||canary.status!=='verified'?'warning':'healthy',missed_intervals:missed,unreviewed_report_runs:reviewPending,historical_unreviewed_archive_runs:historicalPending,invalid_completion_records:errors,last_verified_archive_at:latest,archive_lag_seconds:latest?Math.max(0,(Date.parse(now)-Date.parse(latest))/1000):null,canary,warning:'A Work-wide outage can prevent both this check and its notification. Zero traffic is not proof of healthy collection.'};
}

function workText(value){return String(value??'unavailable').replace(/[\r\n|]/g,' ').replace(/[<>]/g,'');}
export function renderLeadReport(r,health={}){
  const pct=x=>x&&x.denominator?`${x.numerator}/${x.denominator} (${x.percent}%)`:'0 denominator — unavailable';
  const rows=[`# Farpoint lead report`,``,`Source completeness: ${workText(r.status)}. Report authority: ${workText(health.report_authority)}. Window: ${workText(r.window_start)} to ${workText(r.window_end)} (${workText(r.timezone)}). Observation cutoff: ${workText(r.observation_cutoff)}.`,``,`Observed browser identifiers are not people. Website exits do not prove lost interest. Unresolved or unreviewed mail is excluded from confirmed inquiry totals; those totals are qualified until review is complete.`,``,`## Funnel`,``,`Sessions starting in this window: ${r.traffic?.sessions??0}; inquiries received in this window: ${workText(r.mail_counts?.received_in_window)}; received inquiries matched to this session cohort through the observation cutoff: ${workText(r.mail_counts?.cohort_received_inquiries)}.`, `Across all captured history through the cutoff: received inquiries ${r.mail_counts?.received_inquiries??0}; website-matched inquiries ${r.mail_counts?.matched_website_inquiries??0}; unattributed inquiries ${r.mail_counts?.unattributed_inquiries??0}.`,`Session conversion: ${pct(r.session_conversion)}. Attempt-session conversion: ${pct(r.attempt_session_conversion)}.`,``,`| Stage | Distinct sessions |`,`| --- | ---: |`,...Object.entries(r.stage_reach||{}).map(([k,v])=>`| ${workText(k)} | ${v} |`),``,`## Source and campaign attribution`,``,`First observed browser touch and inquiry-session touch remain separate. Unknown channels are retained.`, ''];
  if(r.attribution)rows.push('```json',JSON.stringify(r.attribution,null,2),'```');else rows.push('Attribution tables unavailable; the report is not evidence of a completed attribution implementation.');
  rows.push('','## All observed inquiry history and declared contacts through cutoff','');
  for(const x of r.matched_inquiries||[])rows.push(`- ${workText(x.inquiry_key)} — received ${workText(x.received_at)}; session ${workText(x.derived_session_id)}; evidence message IDs ${workText(x.message_ids?.join(', '))}.`);
  for(const x of r.unattributed_inquiries||[])rows.push(`- ${workText(x.inquiry_key)} — received ${workText(x.received_at)}; website attribution unavailable; evidence message IDs ${workText(x.message_ids?.join(', '))}.`);
  for(const x of r.declared_contacts||[])rows.push(`- Declared contact: ${workText(JSON.stringify(x))}`);
  rows.push('','## Companies','',r.company_context?'```json\n'+JSON.stringify(r.company_context,null,2)+'\n```':'Company matching unavailable; network ownership must not be reported as verified employment.');
  const outcomes={};for(const x of r.session_outcomes||[])outcomes[x.outcome]=(outcomes[x.outcome]||0)+1;
  rows.push('','## Errors and exits','',...Object.entries(outcomes).map(([k,v])=>`- ${workText(k)}: ${v}`),'','Error-associated exits establish association, not causation. Provider acceptance alone does not establish inbox delivery.','', '## Data health and actions','',`Collector enumeration: ${health.collector_enumeration_complete===true?'complete':'unverified/incomplete'}; mail: ${health.mail_enumeration_complete===true?'complete':'unverified/incomplete'}; classification: ${health.classification_complete===true?'complete':'unverified/incomplete'}.`,`Canary: ${workText(health.canary?.status)}. Prior archive: ${workText(health.prior_archive?.status)}.`);
  for(const warning of r.warnings||[])rows.push(`- ${workText(warning)}`);
  if(r.provider_accepted_without_receipt?.length)rows.push(`- Investigate delivery for ${r.provider_accepted_without_receipt.length} accepted inquiry IDs without receipt evidence; see report.json for exact IDs.`);
  if(r.mail_unresolved?.length)rows.push(`- Review ${r.mail_unresolved.length} unresolved mail candidates before treating them as new inquiries.`);
  for(const f of health.failures||[])rows.push(`- Resolve ${workText(f.stage)}: ${workText(f.reason)}.`);
  rows.push('','Exact message/object references, inputs and rule versions are preserved with this report. This report never overwrites an earlier run.','');return rows.join('\n');
}
