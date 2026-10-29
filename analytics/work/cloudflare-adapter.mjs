/* Read-only Cloudflare management adapter. Configuration belongs in private
 * Work settings, never in the public repository or generated public evidence.
 * Only fixed GET requests are generated; the connection itself may have broader
 * administrative permissions and is not thereby a read-only credential.
 */
import {WorkFailure,workJSON,workUnbase64,workHash} from './pipeline.mjs';

export const CLOUDFLARE_ADAPTER_VERSION = 'farpoint-work-cloudflare/1.1.0';
const cfRecordKey = /^(receipts|rejections)\/\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9_-]{8,100}\.json$/;
const cfHash = /^[a-f0-9]{64}$/;
const cfObjectLimit = 1024 * 1024;
function cfRequire(ok,code) { if (!ok) throw new WorkFailure(code); }
function cfOnlyKeys(value,keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).every(key=>keys.includes(key)); }
function cfInteger(value,min,max) { return Number.isSafeInteger(value) && value >= min && value <= max; }

/** The authenticated Cloudflare execute tool returns exactly one JSON text
 * block. Never treat an error, truncated text, alternate/nested envelope, or
 * multiple competing representations as a successful provider response. */
export function cloudflareToolValue(raw) {
  cfRequire(raw && raw.isError !== true, 'cloudflare_connector_error');
  cfRequire(raw.structuredContent === undefined || raw.structuredContent === null, 'unsupported_cloudflare_response');
  cfRequire(Array.isArray(raw.content) && raw.content.length === 1 && raw.content[0]?.type === 'text' && typeof raw.content[0].text === 'string', 'unsupported_cloudflare_response');
  cfRequire(raw.content[0].text.length <= 60000, 'cloudflare_response_budget_exceeded');
  try {
    const value = JSON.parse(raw.content[0].text);
    cfRequire(value && typeof value === 'object' && !Array.isArray(value), 'unsupported_cloudflare_response');
    return value;
  } catch (error) {
    if (error instanceof WorkFailure) throw error;
    throw new WorkFailure('invalid_cloudflare_json');
  }
}

function cfListCode(scope, args) {
  return `async () => {
    const scope = ${JSON.stringify(scope)};
    const args = ${JSON.stringify(args)};
    const evidence=[];
    const fail=code=>{throw new Error(code);};
    const read=async query=>{
      const observation={query};evidence.push(observation);
      let response;
      try{response=await cloudflare.request({method:'GET',path:'/accounts/'+scope.accountId+'/r2/buckets/'+scope.bucketName+'/objects',query});observation.response=response;}
      catch{observation.outcome='request_failed';fail('cloudflare_list_request_failed');}
      if(response.success!==true||response.status!==200||!Array.isArray(response.result)||response.result.length>query.per_page)fail('invalid_cloudflare_list_response');
      let previous=query.start_after||args.floor||'';
      for(const item of response.result){if(typeof item.key!=='string'||!item.key.startsWith(args.namespace+'/')||item.key<=previous)fail('invalid_cloudflare_object_order');previous=item.key;}
      const info=response.result_info;
      if(info!==undefined&&info!==null&&(typeof info!=='object'||Array.isArray(info)))fail('invalid_cloudflare_continuation');
      if(info?.is_truncated!==undefined&&typeof info.is_truncated!=='boolean')fail('invalid_cloudflare_continuation');
      if(info?.is_truncated===true&&(typeof info.cursor!=='string'||!info.cursor))fail('invalid_cloudflare_continuation');
      if(info?.is_truncated!==true&&info?.cursor!==undefined&&info.cursor!==null&&info.cursor!=='')fail('invalid_cloudflare_continuation');
      return response;
    };
    try{
      const query={prefix:args.namespace+'/',per_page:args.limit,...(args.provider_cursor?{cursor:args.provider_cursor}:{}),...(args.start_after?{start_after:args.start_after}:{})};
      const response=await read(query);
      const last=response.result.at(-1)?.key||args.floor||'';
      let continuation=null,completionBasis;
      if(response.result_info?.is_truncated===true){continuation={kind:'provider',value:response.result_info.cursor,floor:last};completionBasis='provider_cursor';}
      else if(response.result_info?.is_truncated===false){completionBasis='explicit_provider_end';}
      else if(response.result.length===0){completionBasis='empty_range_end';}
      else{
        // Missing terminal metadata never makes a nonempty page complete. The
        // documented start_after query checks the remaining lexicographic range.
        const probe=await read({prefix:args.namespace+'/',start_after:last,per_page:1});
        if(probe.result.length>0){continuation={kind:'start_after',value:last,floor:last};completionBasis='keyset_probe_has_more';}
        else if(probe.result_info?.is_truncated===true){continuation={kind:'provider',value:probe.result_info.cursor,floor:last};completionBasis='provider_cursor';}
        else{completionBasis='empty_range_end';}
      }
      return {adapter_format:'farpoint_cf_list_v1',namespace:args.namespace,items:response.result.map(item=>({key:item.key,size:item.size,sha256:item.custom_metadata?.sha256??null})),continuation,enumeration_complete:continuation===null,completion_basis:completionBasis,transactional_snapshot:false,scanned_at:new Date().toISOString(),provider_evidence:evidence};
    }catch(error){
      const allowed=['invalid_cloudflare_list_response','invalid_cloudflare_object_order','invalid_cloudflare_continuation'];
      return {adapter_format:'farpoint_cf_list_failure_v1',reason:allowed.includes(error?.message)?error.message:'cloudflare_list_request_failed',provider_evidence:evidence};
    }
  }`;
}

function cfChunkCode(scope, args = null) {
  return `async (${args === null ? 'args' : ''}) => {
    const scope = ${JSON.stringify(scope)};
    ${args === null ? '' : `const args = ${JSON.stringify(args)};`}
    const response = await cloudflare.request({method:'GET',path:'/accounts/'+scope.accountId+'/r2/buckets/'+scope.bucketName+'/objects/'+args.key});
    const result=response.result;
    const plain=result!==null&&typeof result==='object'&&!Array.isArray(result)&&(Object.getPrototypeOf(result)===Object.prototype||Object.getPrototypeOf(result)===null);
    const resultType=typeof result==='string'?'string':plain?'plain_object':'unsupported';
    const provider={success:response.success===true,status:response.status,result_type:resultType};
    const failure=(reason,details={})=>({adapter_format:'farpoint_cf_chunk_failure_v1',reason,provider_response:provider,...details});
    if(response.success!==true||response.status!==200||resultType==='unsupported')return failure('invalid_cloudflare_object_response');
    const reconstructionMethod=resultType==='string'?'raw_utf8_text':'json_stringify_verified';
    let text;
    try{text=resultType==='string'?result:JSON.stringify(result);}catch{return failure('cloudflare_object_reconstruction_failed');}
    if(typeof text!=='string')return failure('cloudflare_object_reconstruction_failed');
    const bytes=new TextEncoder().encode(text);
    if(bytes.length>${cfObjectLimit}||args.offset>bytes.length)return failure('invalid_cloudflare_object_size',{reconstruction_method:reconstructionMethod,observed_size:bytes.length});
    const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',value)),b=>b.toString(16).padStart(2,'0')).join('');
    const objectHash=await hash(bytes);
    // The REST management client parses application/json objects. Reconstruct
    // only when the independently listed exact byte length AND SHA256 agree.
    // A semantic JSON match is insufficient; no chunk is returned on mismatch.
    if(bytes.length!==args.expected_size||objectHash!==args.expected_sha256)return failure('cloudflare_object_integrity_mismatch',{reconstruction_method:reconstructionMethod,observed_size:bytes.length,observed_sha256:objectHash});
    const part=bytes.slice(args.offset,args.offset+args.max_bytes);
    const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let encoded='';
    for(let i=0;i<part.length;i+=3){const a=part[i],b=part[i+1]??0,c=part[i+2]??0;encoded+=alphabet[a>>>2]+alphabet[((a&3)<<4)|(b>>>4)]+(i+1<part.length?alphabet[((b&15)<<2)|(c>>>6)]:'=')+(i+2<part.length?alphabet[c&63]:'=');}
    return {adapter_format:'farpoint_cf_chunk_v1',key:args.key,encoding:'base64',offset:args.offset,bytes:part.length,object_size:bytes.length,object_sha256:objectHash,chunk_sha256:await hash(part),body_base64:encoded,next_offset:args.offset+part.length,object_complete:args.offset+part.length===bytes.length,reconstruction_method:reconstructionMethod,provider_response:provider};
  }`;
}

/** recordEvidence(name, bytes) must create a NEW private file and retain failed
 * connector responses too. Include these evidence files in the run archive.
 * The caller's account/bucket scope is fixed; tool arguments cannot select it.
 */
export function createCloudflareCollectorAdapter({tools,accountId,bucketName,recordEvidence,batchSmallObjects=false,now=()=>new Date().toISOString()}) {
  cfRequire(typeof accountId === 'string' && /^[a-f0-9]{32}$/.test(accountId), 'invalid_cloudflare_scope');
  cfRequire(typeof bucketName === 'string' && /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName) && !bucketName.includes('..'), 'invalid_cloudflare_scope');
  cfRequire(typeof recordEvidence === 'function', 'cloudflare_evidence_sink_required');
  cfRequire(typeof batchSmallObjects === 'boolean', 'invalid_cloudflare_batch_option');
  cfRequire(typeof tools?.mcp__codex_apps__farpoint_cloudflare_execute === 'function', 'required_tool_unavailable');
  const scope = {accountId,bucketName};
  const inventory = new Map();
  const prefetched = new Map();
  const listedThisScan = new Set();
  const cursors = new Map();
  const seenContinuations = new Map([['receipts',new Set()],['rejections',new Set()]]);
  async function execute(operation,args,code) {
    let raw;
    try { raw = await tools.mcp__codex_apps__farpoint_cloudflare_execute({account_id:accountId,code}); }
    catch {
      await recordEvidence(`cloudflare-${operation}-${crypto.randomUUID()}.json`,workJSON({adapter_version:CLOUDFLARE_ADAPTER_VERSION,operation,args,observed_at:now(),outcome:'connector_exception'}));
      throw new WorkFailure('cloudflare_connector_error');
    }
    await recordEvidence(`cloudflare-${operation}-${crypto.randomUUID()}.json`,workJSON({adapter_version:CLOUDFLARE_ADAPTER_VERSION,operation,args,observed_at:now(),response:raw}));
    return cloudflareToolValue(raw);
  }
  async function listRecords(args={}) {
    cfRequire(cfOnlyKeys(args,['namespace','cursor','limit']) && ['receipts','rejections'].includes(args.namespace), 'invalid_arguments');
    const namespace=args.namespace,limit=args.limit??40,cursor=args.cursor??null;
    cfRequire(cfInteger(limit,1,40) && (cursor===null || (typeof cursor==='string' && cursor.length>0 && cursor.length<=4096)), 'invalid_arguments');
    const state=cursor===null?null:cursors.get(cursor);
    if(cursor!==null)cfRequire(state?.namespace===namespace, 'invalid_cloudflare_cursor_scope');
    else {
      seenContinuations.get(namespace).clear();
      // A new full scan never inherits downloaded bytes from an earlier scan.
      for(const key of prefetched.keys())if(key.startsWith(namespace+'/'))prefetched.delete(key);
      for(const key of listedThisScan)if(key.startsWith(namespace+'/'))listedThisScan.delete(key);
    }
    const request={namespace,limit,floor:state?.floor||'',...(state?.kind==='provider'?{provider_cursor:state.value}:{}),...(state?.kind==='start_after'?{start_after:state.value}:{})};
    const value = await execute('list',{namespace,cursor,limit},cfListCode(scope,request));
    if(value.adapter_format==='farpoint_cf_list_failure_v1')throw new WorkFailure(['invalid_cloudflare_list_response','invalid_cloudflare_object_order','invalid_cloudflare_continuation'].includes(value.reason)?value.reason:'cloudflare_list_request_failed');
    cfRequire(cfOnlyKeys(value,['adapter_format','namespace','items','continuation','enumeration_complete','completion_basis','transactional_snapshot','scanned_at','provider_evidence']) && value.adapter_format==='farpoint_cf_list_v1' && value.namespace===namespace && Array.isArray(value.items) && value.items.length<=limit && typeof value.enumeration_complete==='boolean' && value.transactional_snapshot===false && typeof value.scanned_at==='string' && Number.isFinite(Date.parse(value.scanned_at)), 'invalid_cloudflare_page');
    const continuation=value.continuation;
    cfRequire(value.enumeration_complete?continuation===null:(cfOnlyKeys(continuation,['kind','value','floor'])&&['provider','start_after'].includes(continuation.kind)&&typeof continuation.value==='string'&&continuation.value.length>0&&continuation.value.length<=4096&&typeof continuation.floor==='string'), 'invalid_cloudflare_continuation');
    if(!value.enumeration_complete)cfRequire(!seenContinuations.get(namespace).has(continuation.kind+':'+continuation.value), 'repeated_cloudflare_cursor');
    let previous=request.floor;
    const items=value.items.map(item=>{
      cfRequire(cfOnlyKeys(item,['key','size','sha256']) && cfRecordKey.test(item.key||'') && item.key.startsWith(namespace+'/') && cfInteger(item.size,0,cfObjectLimit) && cfHash.test(item.sha256||''), 'invalid_cloudflare_item');
      cfRequire(item.key>previous,'invalid_cloudflare_object_order');previous=item.key;
      const prior=inventory.get(item.key);
      cfRequire(!prior || prior.sha256===item.sha256 && prior.size===item.size, 'conflicting_cloudflare_object');
      return {key:item.key,size:item.size,sha256:item.sha256};
    });
    cfRequire(new Set(items.map(item=>item.key)).size===items.length,'duplicate_cloudflare_item');
    const evidence=value.provider_evidence;
    cfRequire(Array.isArray(evidence)&&evidence.length>=1&&evidence.length<=2,'invalid_cloudflare_page_evidence');
    const last=evidence.at(-1);
    cfRequire(last?.response?.success===true&&last.response.status===200&&Array.isArray(last.response.result)&&last.query?.prefix===namespace+'/', 'invalid_cloudflare_page_evidence');
    if(value.enumeration_complete){
      cfRequire(value.completion_basis==='explicit_provider_end'?last.response.result_info?.is_truncated===false:value.completion_basis==='empty_range_end'&&last.response.result.length===0&&last.response.result_info?.is_truncated!==true, 'unproven_cloudflare_end');
      if(evidence.length===2)cfRequire(last.query.start_after===previous&&last.query.per_page===1,'invalid_cloudflare_terminal_probe');
    }else{
      cfRequire(continuation.floor===previous,'invalid_cloudflare_continuation');
      if(continuation.kind==='provider')cfRequire(value.completion_basis==='provider_cursor'&&last.response.result_info?.is_truncated===true&&last.response.result_info.cursor===continuation.value,'invalid_cloudflare_continuation');
      else cfRequire(value.completion_basis==='keyset_probe_has_more'&&continuation.value===previous&&last.query.start_after===previous&&last.query.per_page===1&&last.response.result.length>0&&last.response.result[0].key>previous,'invalid_cloudflare_terminal_probe');
    }
    for(const item of items){inventory.set(item.key,item);listedThisScan.add(item.key);}
    let nextCursor=null;
    if(!value.enumeration_complete){nextCursor='cf1-'+crypto.randomUUID();cursors.set(nextCursor,{namespace,...continuation});seenContinuations.get(namespace).add(continuation.kind+':'+continuation.value);}
    return {export_format_version:1,namespace,items,next_cursor:nextCursor,enumeration_complete:value.enumeration_complete,transactional_snapshot:false,scanned_at:value.scanned_at,completion_basis:value.completion_basis};
  }
  async function checkedChunk(value,{key,offset,maxBytes,listed}) {
    if(value.adapter_format==='farpoint_cf_chunk_failure_v1')throw new WorkFailure(['invalid_cloudflare_object_response','cloudflare_object_reconstruction_failed','invalid_cloudflare_object_size','cloudflare_object_integrity_mismatch'].includes(value.reason)?value.reason:'cloudflare_object_read_failed');
    cfRequire(cfOnlyKeys(value,['adapter_format','key','encoding','offset','bytes','object_size','object_sha256','chunk_sha256','body_base64','next_offset','object_complete','reconstruction_method','provider_response']) && value.adapter_format==='farpoint_cf_chunk_v1' && value.key===key && value.encoding==='base64' && value.offset===offset && value.object_size===listed.size && value.object_sha256===listed.sha256 && cfHash.test(value.chunk_sha256||''),'inconsistent_cloudflare_chunk');
    cfRequire(cfOnlyKeys(value.provider_response,['success','status','result_type'])&&value.provider_response.success===true&&value.provider_response.status===200&&((value.reconstruction_method==='raw_utf8_text'&&value.provider_response.result_type==='string')||(value.reconstruction_method==='json_stringify_verified'&&value.provider_response.result_type==='plain_object')),'invalid_cloudflare_reconstruction_evidence');
    const bytes=workUnbase64(value.body_base64);
    cfRequire(bytes.length===Math.min(maxBytes,listed.size-offset) && bytes.length===value.bytes && value.next_offset===offset+bytes.length && value.object_complete===(value.next_offset===listed.size),'invalid_cloudflare_chunk_progress');
    cfRequire(await workHash(bytes)===value.chunk_sha256,'cloudflare_chunk_hash_mismatch');
    return {export_format_version:1,key,encoding:'base64',offset,bytes:bytes.length,object_size:listed.size,object_sha256:listed.sha256,body_base64:value.body_base64,next_offset:value.next_offset,object_complete:value.object_complete,reconstruction_method:value.reconstruction_method,provider_response:value.provider_response};
  }
  async function prefetchSmall(key) {
    const requested=inventory.get(key),namespace=key.split('/')[0];
    const rows=[requested];let total=requested.size;
    for(const item of inventory.values()){
      if(rows.length===24)break;
      if(item.key<=key||!listedThisScan.has(item.key)||!item.key.startsWith(namespace+'/')||item.size>8192||prefetched.has(item.key)||total+item.size>24576)continue;
      rows.push(item);total+=item.size;
    }
    // Each generated operation remains the same fixed authenticated GET and
    // exact size/hash reconstruction. At most four provider reads run together;
    // total raw payload is <=24 KiB, within the existing 60,000-character envelope.
    // The connector trims results at 24,000 characters. Keep each independent
    // response below a conservative 20,000-character estimate and eight rows.
    // Run at most four calls together, each with serial provider GETs.
    const groups=[];let group=[],estimated=100;
    for(const item of rows){
      const estimate=Math.ceil(item.size/3)*4+1024+2*item.key.length;
      if(group.length&&(group.length===8||estimated+estimate>20000)){groups.push(group);group=[];estimated=100;}
      group.push(item);estimated+=estimate;
    }
    if(group.length)groups.push(group);
    const items=[];
    for(let offset=0;offset<groups.length;offset+=4){
      const wave=groups.slice(offset,offset+4);
      const settled=await Promise.allSettled(wave.map(async batch=>{
        const requests=batch.map(item=>({key:item.key,offset:0,max_bytes:8192,expected_size:item.size,expected_sha256:item.sha256}));
        const code=`async()=>{const read=${cfChunkCode(scope)},requests=${JSON.stringify(requests)},items=[];for(const args of requests){try{items.push({key:args.key,chunk:await read(args)});}catch{items.push({key:args.key,chunk:{adapter_format:'farpoint_cf_chunk_failure_v1',reason:'cloudflare_object_read_failed'}});}}return {adapter_format:'farpoint_cf_batch_v1',items};}`;
        const value=await execute('batch',{keys:batch.map(x=>x.key),max_raw_bytes:24576,max_concurrency:1,max_response_estimate:20000},code);
        cfRequire(cfOnlyKeys(value,['adapter_format','items'])&&value.adapter_format==='farpoint_cf_batch_v1'&&Array.isArray(value.items)&&value.items.length===batch.length,'invalid_cloudflare_batch');
        return value.items;
      }));
      const failure=settled.find(x=>x.status==='rejected');
      if(failure)throw failure.reason;
      for(const result of settled)items.push(...result.value);
    }
    const value={adapter_format:'farpoint_cf_batch_v1',items};
    cfRequire(cfOnlyKeys(value,['adapter_format','items'])&&value.adapter_format==='farpoint_cf_batch_v1'&&Array.isArray(value.items)&&value.items.length===rows.length,'invalid_cloudflare_batch');
    for(let i=0;i<rows.length;i++)cfRequire(cfOnlyKeys(value.items[i],['key','chunk'])&&value.items[i].key===rows[i].key&&value.items[i].chunk&&typeof value.items[i].chunk==='object','invalid_cloudflare_batch');
    // The entire response was retained before this validation. Successful
    // siblings and failed records remain observable; failure never triggers a
    // different client, alternate credential or silent individual retry.
    const checked=[];
    for(let i=0;i<rows.length;i++){
      try{checked.push({key:rows[i].key,value:await checkedChunk(value.items[i].chunk,{key:rows[i].key,offset:0,maxBytes:8192,listed:rows[i]})});}
      catch(error){checked.push({key:rows[i].key,error:error instanceof WorkFailure?error.code:'cloudflare_object_read_failed'});}
    }
    for(const item of checked)prefetched.set(item.key,item);
  }
  async function readRecordChunk(args={}) {
    cfRequire(cfOnlyKeys(args,['key','offset','max_bytes']) && cfRecordKey.test(args.key||''), 'invalid_arguments');
    const key=args.key,offset=args.offset??0,maxBytes=args.max_bytes??8192;
    cfRequire(cfInteger(offset,0,cfObjectLimit) && cfInteger(maxBytes,1,8192), 'invalid_arguments');
    const listed=inventory.get(key);
    cfRequire(listed,'cloudflare_record_not_listed');
    cfRequire(offset<=listed.size,'invalid_offset');
    if(batchSmallObjects&&listedThisScan.has(key)&&offset===0&&maxBytes===8192&&listed.size<=8192){
      if(!prefetched.has(key))await prefetchSmall(key);
      const item=prefetched.get(key);prefetched.delete(key);
      cfRequire(item,'cloudflare_batch_record_missing');
      if(item.error)throw new WorkFailure(item.error);
      return item.value;
    }
    const value=await execute('chunk',{key,offset,max_bytes:maxBytes},cfChunkCode(scope,{key,offset,max_bytes:maxBytes,expected_size:listed.size,expected_sha256:listed.sha256}));
    return checkedChunk(value,{key,offset,maxBytes,listed});
  }
  return Object.freeze({list:listRecords,chunk:readRecordChunk,listRecords,readRecordChunk});
}
