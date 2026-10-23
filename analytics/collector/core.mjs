/* Farpoint collector v1. No delete, update, or background persistence paths. */
export const COLLECTOR_VERSION = 'farpoint-collector/1.0.0';
export const MAX_BODY_BYTES = 32 * 1024;
export const MAX_EXPORT_CHUNK_BYTES = 8192;
const encoder = new TextEncoder();
const SAFE_ID = /^[a-zA-Z0-9_-]{8,100}$/;
const RECORD_KEY = /^(receipts|rejections)\/\d{4}\/\d{2}\/\d{2}\/[a-zA-Z0-9_-]{8,100}\.json$/;
const PRIVATE_HEADERS = {'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','Vary':'oai-authenticated-user-id, Origin','X-Content-Type-Options':'nosniff'};

export async function sha256(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2,'0')).join('');
}
export function base64(bytes) {
  let binary = ''; for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binary);
}
function unbase64(value) { return Uint8Array.from(atob(value), c=>c.charCodeAt(0)); }
function base64url(bytes) { return base64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function unbase64url(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('invalid_cursor');
  return unbase64(value.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(value.length/4)*4,'='));
}
function json(value,status=200,headers={}) {
  return new Response(JSON.stringify(value), {status,headers:{'Content-Type':'application/json; charset=utf-8',...PRIVATE_HEADERS,...headers}});
}
function integer(v,min,max) { return Number.isSafeInteger(v) && v>=min && v<=max; }
function onlyKeys(o,keys) { return o && typeof o==='object' && !Array.isArray(o) && Object.keys(o).every(k=>keys.includes(k)); }
function contentType(request) { return (request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase(); }

export async function readBoundedBody(request, limit) {
  if (!request.body) return new Uint8Array();
  const reader=request.body.getReader(), chunks=[]; let size=0;
  try {
    for (;;) {
      const {done,value}=await reader.read(); if(done) break;
      size+=value.byteLength;
      if(size>limit) { await reader.cancel().catch(()=>{}); const e=new Error('body_too_large'); e.code='body_too_large'; throw e; }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result=new Uint8Array(size); let offset=0;
  for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.byteLength;}
  return result;
}

/** Thin capability-limited adapter. Native R2 binding is never returned to a caller. */
export class R2CreateOnlyStore {
  constructor(bucket) { if(!bucket)throw new Error('bucket_required'); this.bucket=bucket; }
  async create(key,bytes) {
    const hash=await sha256(bytes);
    try {
      const object=await this.bucket.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType:'application/json'},customMetadata:{sha256:hash}});
      return object ? {created:true,sha256:hash,etag:object.etag} : {created:false};
    } catch(error) {
      if(error?.status===412 || error?.statusCode===412 || error?.code==='PreconditionFailed') return {created:false};
      throw error;
    }
  }
  async list(prefix,cursor,limit) {
    const page=await this.bucket.list({prefix,limit,...(cursor?{cursor}:{}),include:['customMetadata']});
    if(!Array.isArray(page.objects) || typeof page.truncated!=='boolean' || (page.truncated && !page.cursor))throw new Error('invalid_storage_page');
    return {items:page.objects.map(o=>({key:o.key,size:o.size,sha256:o.customMetadata?.sha256??null})),truncated:page.truncated,cursor:page.truncated?page.cursor:null};
  }
  async readChunk(key,offset,length) {
    const head=await this.bucket.head(key);
    if(!head)return null;
    if(!Number.isSafeInteger(head.size) || head.size<0 || !/^[a-f0-9]{64}$/.test(head.customMetadata?.sha256||''))throw new Error('invalid_object_metadata');
    if(offset>head.size){const error=new Error('invalid_offset');error.code='invalid_offset';throw error;}
    if(offset===head.size)return {bytes:new Uint8Array(),size:head.size,sha256:head.customMetadata.sha256};
    const expected=Math.min(length,head.size-offset);
    const object=await this.bucket.get(key,{range:{offset,length:expected},onlyIf:{etagMatches:head.etag}});
    if(!object?.body)throw new Error('object_changed_or_unavailable');
    const bytes=new Uint8Array(await object.arrayBuffer());
    if(bytes.length!==expected)throw new Error('incomplete_storage_read');
    return {bytes,size:head.size,sha256:head.customMetadata.sha256};
  }
}

/**
 * Only set verifiedGatewayIdentity after actual hosted anti-spoof verification.
 * Only a wrapper with proven transport provenance may provide verifiedSourceIp.
 * Both default closed. A hosting bypass credential never grants owner identity.
 */
export function createCollector({store,allowedOrigins=['https://farpointenergy.com','https://www.farpointenergy.com'],ownerIdentity=null,verifiedGatewayIdentity=false,cursorHmacKey=null,verifiedSourceIp=null,collectorVersion=COLLECTOR_VERSION,storagePrefix='',now=()=>new Date(),newId=()=>crypto.randomUUID(),maxListItems=40,maxListBytes=16000,cursorLifetimeMs=24*60*60*1000}={}) {
  if(!store || !['create','list','readChunk'].every(k=>typeof store[k]==='function'))throw new Error('store_capabilities_required');
  if(storagePrefix && !/^[a-zA-Z0-9_-]+\/$/.test(storagePrefix))throw new Error('invalid_storage_prefix');
  if(!integer(maxListItems,1,100)||!integer(maxListBytes,4096,24000))throw new Error('invalid_export_limits');
  const origins=new Set(allowedOrigins);
  for(const origin of origins) { const parsed=new URL(origin); if(parsed.origin!==origin||parsed.protocol!=='https:')throw new Error('invalid_allowed_origin'); }
  const current=()=>{const date=now();if(!(date instanceof Date)||!Number.isFinite(date.getTime()))throw new Error('invalid_clock');return date;};
  async function createRecord(kind,record) {
    for(let attempt=0;attempt<8;attempt++) {
      const id=newId(); if(!SAFE_ID.test(id))throw new Error('invalid_generated_id');
      const at=record.received_at;
      const key=`${storagePrefix}${kind}/${at.slice(0,10).replaceAll('-','/')}/${id}.json`;
      const full={...record,[kind==='receipts'?'receipt_id':'rejection_id']:id};
      const bytes=encoder.encode(JSON.stringify(full));
      const written=await store.create(key,bytes);
      if(written?.created===true)return {id,key,record:full};
      if(written?.created!==false)throw new Error('unconfirmed_storage_write');
    }
    throw new Error('key_collision_exhausted');
  }
  async function rejectIngest(request,reason,status,origin) {
    let recorded=false;
    try {await createRecord('rejections',{rejection_schema_version:1,received_at:current().toISOString(),collector_version:collectorVersion,reason,method:['POST','OPTIONS','GET','PUT','DELETE','PATCH'].includes(request.method)?request.method:'other',origin_status:origin?'allowed':request.headers.has('origin')?'unrecognized':'absent',body_preserved:false});recorded=true;}catch{}
    return json({status:'rejected',reason,rejection_metadata_recorded:recorded},status,origin?cors(origin):{});
  }
  function cors(origin){return {'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Expose-Headers':'Content-Type'};}
  async function ingest(request) {
    const origin=origins.has(request.headers.get('origin'))?request.headers.get('origin'):null;
    if(!origin)return rejectIngest(request,'origin_not_allowed',403,null);
    if(request.method==='OPTIONS') {
      const requested=(request.headers.get('access-control-request-headers')||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean);
      if(request.headers.get('access-control-request-method')!=='POST'||requested.some(h=>h!=='content-type'))return rejectIngest(request,'preflight_not_allowed',403,origin);
      return new Response(null,{status:204,headers:{...PRIVATE_HEADERS,...cors(origin),'Access-Control-Allow-Methods':'POST','Access-Control-Allow-Headers':'Content-Type','Access-Control-Max-Age':'600'}});
    }
    if(request.method!=='POST')return rejectIngest(request,'method_not_allowed',405,origin);
    const encoding=(request.headers.get('content-encoding')||'identity').trim().toLowerCase();
    if(encoding!=='identity')return rejectIngest(request,'unsupported_content_encoding',415,origin);
    const type=contentType(request);
    if(!['application/json','text/plain'].includes(type))return rejectIngest(request,'unsupported_content_type',415,origin);
    let bytes;
    try {bytes=await readBoundedBody(request,MAX_BODY_BYTES);}catch(error){return rejectIngest(request,error?.code==='body_too_large'?'body_too_large':'body_read_failed',error?.code==='body_too_large'?413:400,origin);}
    try {
      const received=current().toISOString();
      let sourceIp={status:'unavailable',provenance:'unverified',address:null};
      if(verifiedSourceIp) {
        try {
          const evidence=await verifiedSourceIp(request);
          if(evidence && evidence.status==='verified' && typeof evidence.address==='string' && /^[0-9a-fA-F:.]{2,45}$/.test(evidence.address) && typeof evidence.provenance==='string' && /^[a-zA-Z0-9_/-]{1,100}$/.test(evidence.provenance))sourceIp={status:'verified',provenance:evidence.provenance,address:evidence.address};
        }catch{}
      }
      const hash=await sha256(bytes);
      const saved=await createRecord('receipts',{receipt_schema_version:1,received_at:received,receipt_body_sha256:hash,body_base64:base64(bytes),body_bytes:bytes.length,content_type:type,origin,collector_version:collectorVersion,transport:{method:'POST',content_encoding:'identity'},source_ip:sourceIp});
      return json({status:'retained',terminal:true,receipt_id:saved.id,receipt_body_sha256:hash,analytical_status:'not_evaluated'},202,cors(origin));
    }catch{return json({status:'retry',reason:'durability_unconfirmed'},503,{...cors(origin),'Retry-After':'5'});}
  }
  function owner(request) {
    if(verifiedGatewayIdentity!==true||typeof ownerIdentity!=='string'||!ownerIdentity||ownerIdentity.length>200)return null;
    const id=request.headers.get('oai-authenticated-user-id');
    return id===ownerIdentity && !id.includes(',') ? id : null;
  }
  async function signingKey() {
    if(typeof cursorHmacKey!=='string'||encoder.encode(cursorHmacKey).length<32)throw new Error('export_configuration_unavailable');
    return crypto.subtle.importKey('raw',encoder.encode(cursorHmacKey),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  }
  async function encodeCursor(payload) {
    const body=encoder.encode(JSON.stringify(payload));
    const token=`${base64url(body)}.${base64url(new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(),body)))}`;
    if(token.length>4096)throw new Error('invalid_storage_cursor');
    return token;
  }
  async function decodeCursor(value,identity,namespace) {
    if(typeof value!=='string'||value.length>4096)throw new Error('invalid_cursor');
    const parts=value.split('.');if(parts.length!==2)throw new Error('invalid_cursor');
    const body=unbase64url(parts[0]),sig=unbase64url(parts[1]);
    if(!(await crypto.subtle.verify('HMAC',await signingKey(),sig,body)))throw new Error('invalid_cursor');
    const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
    if(!onlyKeys(data,['v','scope','owner_hash','provider_cursor','issued_at'])||data.v!==1||data.scope!==namespace||data.owner_hash!==await sha256(encoder.encode(identity))||typeof data.provider_cursor!=='string'||data.provider_cursor.length>2048||!integer(data.issued_at,0,Number.MAX_SAFE_INTEGER)||current().getTime()-data.issued_at>cursorLifetimeMs||data.issued_at>current().getTime()+60000)throw new Error('invalid_cursor');
    return data.provider_cursor;
  }
  async function listRecords(args,identity,rpcId) {
    if(!onlyKeys(args,['namespace','cursor','limit'])||!['receipts','rejections'].includes(args.namespace)||!(args.cursor===undefined||args.cursor===null||typeof args.cursor==='string')||!(args.limit===undefined||integer(args.limit,1,maxListItems)))throw new Error('invalid_arguments');
    // Key availability is checked even on page one; do not start an unresumable scan.
    await signingKey();
    const providerCursor=args.cursor?await decodeCursor(args.cursor,identity,args.namespace):undefined;
    const limit=args.limit||maxListItems, prefix=`${storagePrefix}${args.namespace}/`;
    const page=await store.list(prefix,providerCursor,limit);
    if(!Array.isArray(page.items)||page.items.length>limit||typeof page.truncated!=='boolean'||(page.truncated&&(typeof page.cursor!=='string'||!page.cursor||page.cursor.length>2048||page.cursor===providerCursor))||(!page.truncated&&page.cursor))throw new Error('invalid_storage_page');
    const items=page.items.map(item=>{
      const key=item.key.startsWith(storagePrefix)?item.key.slice(storagePrefix.length):'';
      if(!RECORD_KEY.test(key)||!key.startsWith(args.namespace+'/')||!integer(item.size,0,Number.MAX_SAFE_INTEGER)||!/^[a-f0-9]{64}$/.test(item.sha256||''))throw new Error('invalid_storage_page');
      return {key,size:item.size,sha256:item.sha256};
    });
    const cursor=page.truncated?await encodeCursor({v:1,scope:args.namespace,owner_hash:await sha256(encoder.encode(identity)),provider_cursor:page.cursor,issued_at:current().getTime()}):null;
    const output={export_format_version:1,namespace:args.namespace,items,next_cursor:cursor,enumeration_complete:!page.truncated,transactional_snapshot:false,scanned_at:current().toISOString()};
    // Never truncate a page: explicit failure permits retry with a smaller count.
    // Budget the actual MCP response, which contains text and structured copies.
    // Include the exact encoded ID, including any JSON escaping.
    const fullResponse={jsonrpc:'2.0',id:rpcId,result:{content:[{type:'text',text:JSON.stringify(output)}],structuredContent:output,isError:false}};
    if(encoder.encode(JSON.stringify(fullResponse)).length>maxListBytes)throw new Error('page_budget_exceeded_retry_smaller_limit');
    return output;
  }
  async function readRecord(args) {
    if(!onlyKeys(args,['key','offset','max_bytes'])||typeof args.key!=='string'||!RECORD_KEY.test(args.key)||!(args.offset===undefined||integer(args.offset,0,Number.MAX_SAFE_INTEGER))||!(args.max_bytes===undefined||integer(args.max_bytes,1,MAX_EXPORT_CHUNK_BYTES)))throw new Error('invalid_arguments');
    const offset=args.offset||0,maxBytes=args.max_bytes||MAX_EXPORT_CHUNK_BYTES;
    const chunk=await store.readChunk(storagePrefix+args.key,offset,maxBytes);
    if(!chunk)throw new Error('record_unavailable');
    if(!(chunk.bytes instanceof Uint8Array)||chunk.bytes.length>maxBytes||!integer(chunk.size,0,Number.MAX_SAFE_INTEGER)||offset>chunk.size||chunk.bytes.length!==Math.min(maxBytes,chunk.size-offset)||!/^[a-f0-9]{64}$/.test(chunk.sha256||''))throw new Error('incomplete_storage_read');
    return {export_format_version:1,key:args.key,encoding:'base64',offset,bytes:chunk.bytes.length,object_size:chunk.size,object_sha256:chunk.sha256,body_base64:base64(chunk.bytes),next_offset:offset+chunk.bytes.length,object_complete:offset+chunk.bytes.length===chunk.size};
  }
  const definitions=[
    {name:'list_records',description:'Owner-only bounded enumeration of preserved receipts or rejection metadata. Follow every next_cursor; this is not a transactional snapshot or a verified archive.',inputSchema:{type:'object',properties:{namespace:{type:'string',enum:['receipts','rejections']},cursor:{type:['string','null']},limit:{type:'integer',minimum:1,maximum:maxListItems}},required:['namespace'],additionalProperties:false}},
    {name:'read_record_chunk',description:'Owner-only bounded raw record read. Reassemble chunks and verify object_size and SHA-256 before recording archive completion.',inputSchema:{type:'object',properties:{key:{type:'string'},offset:{type:'integer',minimum:0},max_bytes:{type:'integer',minimum:1,maximum:MAX_EXPORT_CHUNK_BYTES}},required:['key'],additionalProperties:false}}
  ];
  async function mcp(request) {
    if(request.method!=='POST')return json({error:'method_not_allowed'},405);
    let rpc;
    try {rpc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBody(request,16384)));}catch{return json({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Invalid request'}},400);}
    if(!onlyKeys(rpc,['jsonrpc','id','method','params'])||rpc.jsonrpc!=='2.0'||!(rpc.id===undefined||rpc.id===null||(typeof rpc.id==='string'&&encoder.encode(rpc.id).length<=100)||Number.isSafeInteger(rpc.id))||typeof rpc.method!=='string')return json({jsonrpc:'2.0',id:null,error:{code:-32600,message:'Invalid request'}},400);
    const id=rpc.id??null,reply=result=>{
      const envelope={jsonrpc:'2.0',id,result};
      if(encoder.encode(JSON.stringify(envelope)).length>24000)return json({jsonrpc:'2.0',id,result:{isError:true,content:[{type:'text',text:'response_budget_exceeded'}]}});
      return json(envelope);
    };
    if(rpc.method==='server/discover')return reply({supportedVersions:['2026-07-28'],capabilities:{tools:{}}});
    if(rpc.method==='tools/list')return reply({tools:definitions});
    if(rpc.method!=='tools/call')return json({jsonrpc:'2.0',id,error:{code:-32601,message:'Method unavailable'}},404);
    const identity=owner(request);if(!identity)return json({jsonrpc:'2.0',id,error:{code:-32001,message:'Owner authorization required'}},403);
    if(!onlyKeys(rpc.params,['name','arguments'])||typeof rpc.params?.name!=='string')return reply({isError:true,content:[{type:'text',text:'invalid_arguments'}]});
    try {
      let value;
      if(rpc.params.name==='list_records')value=await listRecords(rpc.params.arguments??{},identity,id);
      else if(rpc.params.name==='read_record_chunk')value=await readRecord(rpc.params.arguments??{});
      else throw new Error('unknown_tool');
      return reply({content:[{type:'text',text:JSON.stringify(value)}],structuredContent:value,isError:false});
    }catch(error){const safe=new Set(['invalid_arguments','invalid_cursor','invalid_offset','record_unavailable','page_budget_exceeded_retry_smaller_limit','export_configuration_unavailable','unknown_tool']);return reply({isError:true,content:[{type:'text',text:safe.has(error?.message)?error.message:'export_incomplete'}]});}
  }
  return {async fetch(request) {
    const path=new URL(request.url).pathname;
    if(path==='/health'&&request.method==='GET')return json({status:'available'});
    if(path==='/v1/events')return ingest(request);
    if(path==='/mcp')return mcp(request);
    return json({error:'not_found'},404);
  }};
}
