import {WorkFailure,workUnbase64} from './pipeline.mjs';
function bridgeBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
function bridgePath(path){if(typeof path!=='string'||!/^\/[A-Za-z0-9_./-]+$/.test(path)||path.includes('/../'))throw new WorkFailure('invalid_bridge_path');return path;}

/** Functions/Work tool bridge. Private payloads travel through hidden stdin,
 * never command arguments, source files, or printed tool-output summaries. */
export function createWorkHostBridge({tools,privateRoot,repositoryRoot}){
  bridgePath(privateRoot);bridgePath(repositoryRoot);
  async function invoke(request){
    const process=await tools.exec_command({cmd:`python3 ${repositoryRoot}/analytics/work/local_bridge.py --root ${privateRoot} --repository ${repositoryRoot}`,tty:true,yield_time_ms:1000,max_output_tokens:1000});
    if(!process.session_id||!process.output.includes('READY'))throw new WorkFailure('private_bridge_start_failed');
    let result=await tools.write_stdin({session_id:process.session_id,chars:JSON.stringify(request)+'\n',yield_time_ms:1000,max_output_tokens:100000});
    let output=result.output;while(result.session_id){result=await tools.write_stdin({session_id:result.session_id,chars:'',yield_time_ms:1000,max_output_tokens:100000});output+=result.output;}
    let value;try{value=JSON.parse(output.trim());}catch{throw new WorkFailure('private_bridge_output_invalid');}
    if(value.status!=='ok')throw new WorkFailure(value.reason??'private_bridge_failed');return value;
  }
  return {
    create:async(path,bytes)=>(await invoke({op:'create',path,base64:bridgeBase64(bytes)})).path,
    readFileReference:async response=>workUnbase64((await invoke({op:'read_reference',response})).base64),
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
