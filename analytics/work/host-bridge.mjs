import {WorkFailure,workUnbase64,workHash} from './pipeline.mjs';
function bridgeBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
function bridgePath(path){if(typeof path!=='string'||!/^\/[A-Za-z0-9_./-]+$/.test(path)||path.includes('/../'))throw new WorkFailure('invalid_bridge_path');return path;}

/** Functions/Work tool bridge. Private payloads travel through hidden stdin,
 * never command arguments, source files, or printed tool-output summaries. */
export function createWorkHostBridge({tools,privateRoot,repositoryRoot,startupTimeoutMs=30000}){
  bridgePath(privateRoot);bridgePath(repositoryRoot);
  if(!Number.isSafeInteger(startupTimeoutMs)||startupTimeoutMs<1||startupTimeoutMs>60000)throw new WorkFailure('invalid_bridge_startup_timeout');
  async function one(request){
    const launched=await tools.exec_command({cmd:`python3 ${repositoryRoot}/analytics/work/local_bridge.py --root ${privateRoot} --repository ${repositoryRoot}`,tty:true,yield_time_ms:1000,max_output_tokens:1000});
    let sessionId=launched.session_id;
    let startupOutput=launched.output??'';
    const ready=()=>startupOutput.split(/\r?\n/).some(line=>line==='READY');
    if(!sessionId)throw new WorkFailure(ready()?'private_bridge_session_unavailable':'private_bridge_launch_failed');
    const deadline=Date.now()+startupTimeoutMs;
    while(!ready()&&sessionId&&Date.now()<deadline){
      const remaining=Math.max(250,Math.min(1000,deadline-Date.now()));
      const poll=await tools.write_stdin({session_id:sessionId,chars:'',yield_time_ms:remaining,max_output_tokens:1000});
      startupOutput+=poll.output??'';
      sessionId=poll.session_id??null;
    }
    if(!ready()){
      if(!sessionId)throw new WorkFailure('private_bridge_exited_before_ready');
      try{await tools.write_stdin({session_id:sessionId,chars:'\u0003',yield_time_ms:250,max_output_tokens:1000});}catch{/* The bounded startup process may already have exited. */}
      throw new WorkFailure('private_bridge_start_timeout');
    }
    if(!sessionId)throw new WorkFailure('private_bridge_session_unavailable');
    let result=await tools.write_stdin({session_id:sessionId,chars:JSON.stringify({...request,stream_results:true})+'\n',yield_time_ms:1000,max_output_tokens:25000});
    let output=result.output??'';while(result.session_id){result=await tools.write_stdin({session_id:result.session_id,chars:'',yield_time_ms:1000,max_output_tokens:25000});output+=result.output??'';}
    let value;try{value=JSON.parse(output.trim());}catch{throw new WorkFailure('private_bridge_output_invalid');}
    if(value.status!=='ok')throw new WorkFailure(value.reason??'private_bridge_failed');return value;
  }
  async function invoke(request){
    const initial=await one(request),stream=initial.result_stream;
    if(!stream)return initial;
    if(!/^bridge-results\/[a-f0-9-]{36}\.json$/.test(stream.path??'')||stream.encoding!=='utf-8-json'||!Number.isSafeInteger(stream.bytes)||stream.bytes<=16384||stream.bytes>256*1024*1024||!/^[a-f0-9]{64}$/.test(stream.sha256??''))throw new WorkFailure('invalid_bridge_result_stream');
    const bytes=new Uint8Array(stream.bytes);
    for(let offset=0;offset<bytes.length;){
      const part=await one({op:'read_result',path:stream.path,offset,max_bytes:8192});
      const chunk=workUnbase64(part.base64);
      if(part.path!==stream.path||part.offset!==offset||part.total_bytes!==stream.bytes||part.bytes!==chunk.length||chunk.length!==Math.min(8192,stream.bytes-offset)||await workHash(chunk)!==part.sha256)throw new WorkFailure('invalid_bridge_result_chunk');
      bytes.set(chunk,offset);offset+=chunk.length;
    }
    if(await workHash(bytes)!==stream.sha256)throw new WorkFailure('bridge_result_hash_mismatch');
    let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new WorkFailure('private_bridge_output_invalid');}
    if(value.status!=='ok'||value.result_stream)throw new WorkFailure('invalid_bridge_streamed_response');
    return value;
  }
  return {
    create:async(path,bytes)=>(await invoke({op:'create',path,base64:bridgeBase64(bytes)})).path,
    createMany:async files=>{
      if(!Array.isArray(files)||files.length<1||files.length>64||files.some(x=>typeof x.path!=='string'||!(x.bytes instanceof Uint8Array))||files.reduce((n,x)=>n+x.bytes.length,0)>256*1024)throw new WorkFailure('local_batch_limit');
      const expected=await Promise.all(files.map(async x=>({relative_path:x.path,bytes:x.bytes.length,sha256:await workHash(x.bytes)})));
      const batch=(await invoke({op:'create_many',files:files.map(x=>({path:x.path,base64:bridgeBase64(x.bytes)}))})).batch;
      if(!batch||!Array.isArray(batch.verified_entries)||batch.verified_entries.length>files.length)throw new WorkFailure('invalid_local_batch_confirmation');
      for(let i=0;i<batch.verified_entries.length;i++){
        const row=batch.verified_entries[i],want=expected[i];
        if(row.relative_path!==want.relative_path||row.bytes!==want.bytes||row.sha256!==want.sha256||row.path!==privateRoot+'/'+want.relative_path)throw new WorkFailure('invalid_local_batch_confirmation');
      }
      if(batch.complete!==true){
        const error=new WorkFailure('local_batch_failed');error.batch_reason=batch.reason;error.created_local_files=batch.verified_entries;error.batch_evidence={request_path:batch.request_path,failure_path:batch.failure_path,request_sha256:batch.request_sha256};throw error;
      }
      if(batch.verified_entries.length!==files.length)throw new WorkFailure('incomplete_local_batch_confirmation');
      return batch.verified_entries.map(x=>x.path);
    },
    readFileReference:async response=>workUnbase64((await invoke({op:'read_reference',response})).base64),
    verifyFileReference:async({response,expectedBytes,expectedSha256})=>invoke({op:'verify_reference',response,expected_bytes:expectedBytes,expected_sha256:expectedSha256}),
    packEvidence:async({sourceRoot,binding})=>(await invoke({op:'pack_evidence',source_root:bridgePath(sourceRoot),binding})).archive,
    restoreEvidence:async({path,bytes,sha256})=>(await invoke({op:'restore_evidence',path:bridgePath(path),bytes,sha256})).restoration,
    packJournal:async({runId,sourceCommit,entries})=>(await invoke({op:'pack_journal',run_id:runId,source_commit:sourceCommit,entries})).archive,
    verifyJournal:async({path,bytes,sha256,manifest_sha256,runId,sourceCommit,entries})=>(await invoke({op:'verify_journal',path:bridgePath(path),bytes,sha256,manifest_sha256,run_id:runId,source_commit:sourceCommit,entries})).verification,
    replayAnalysis:async({archive,sourceCommit})=>invoke({op:'replay_analysis',archive:bridgePath(archive),source_commit:sourceCommit}),
    captureClosureSource:async()=>invoke({op:'capture_closure_source'}),
    normalizeMail:async({raw,connector,...metadata})=>{
      const value=await invoke({op:'normalize_mail',raw_base64:bridgeBase64(raw),connector,...metadata});
      return {...value.result,artifacts:value.result.artifacts.map(x=>({name:x.name,bytes:workUnbase64(x.base64)}))};
    },
    analyze:async({objects,captures,classifications,config,readLocal,codeCommit,companyObservations=[]})=>{
      const value=await invoke({op:'analyze',objects:objects.map(x=>({...x,base64:bridgeBase64(readLocal(x.local_path))})),captures,classifications,config,code_commit:codeCommit,company_observations:companyObservations});
      return {report:value.report,artifacts:value.artifacts.map(x=>({name:x.name,bytes:workUnbase64(x.base64)}))};
    }
  };
}
