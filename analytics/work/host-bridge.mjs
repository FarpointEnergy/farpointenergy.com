import {WorkFailure,workUnbase64,workHash} from './pipeline.mjs';
function bridgeBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
function bridgePath(path){if(typeof path!=='string'||!/^\/[A-Za-z0-9_./-]+$/.test(path)||path.includes('/../'))throw new WorkFailure('invalid_bridge_path');return path;}

/** Functions/Work tool bridge. Private payloads travel through hidden stdin,
 * never command arguments, source files, or printed tool-output summaries. */
export function createWorkHostBridge({tools,privateRoot,repositoryRoot}){
  bridgePath(privateRoot);bridgePath(repositoryRoot);
  async function one(request){
    const process=await tools.exec_command({cmd:`python3 ${repositoryRoot}/analytics/work/local_bridge.py --root ${privateRoot} --repository ${repositoryRoot}`,tty:true,yield_time_ms:1000,max_output_tokens:1000});
    if(!process.session_id||!process.output.includes('READY'))throw new WorkFailure('private_bridge_start_failed');
    let result=await tools.write_stdin({session_id:process.session_id,chars:JSON.stringify({...request,stream_results:true})+'\n',yield_time_ms:1000,max_output_tokens:25000});
    let output=result.output;while(result.session_id){result=await tools.write_stdin({session_id:result.session_id,chars:'',yield_time_ms:1000,max_output_tokens:25000});output+=result.output;}
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
