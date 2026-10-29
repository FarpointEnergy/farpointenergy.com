// Appended to the dependency-free collector core by build-site.mjs.
// Bootstrap tooling is candidate-only, enabled only while the Site is owner-private.
const PRIVATE_PROBE_TOOLS = [
  {name:'bootstrap_owner_identity',description:'Private feasibility candidate only: inspect the authenticated Site-scoped caller identity. Does not enroll or authorize anyone.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'candidate_storage_check',description:'Private synthetic test: retain two new probe receipts, verify an R2 create-only collision and read back both. Never deletes or replaces data.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'candidate_owner_binding_check',description:'Private read-only feasibility diagnostic: compare the authenticated Site caller with the configured owner. Returns safe booleans only; does not verify gateway provenance, enable exports, or access storage.',inputSchema:{type:'object',properties:{},additionalProperties:false}}
];
function candidateReply(id,result,status=200){return new Response(JSON.stringify({jsonrpc:'2.0',id,result}),{status,headers:{'Content-Type':'application/json','Cache-Control':'private, no-store','Vary':'oai-authenticated-user-id','X-Content-Type-Options':'nosniff'}});}
function candidateOwnerBinding(user,env,privateOwnerExportEnabled=false){
  const valid=value=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[,\s]/.test(value);
  const identityPresent=valid(user),ownerConfigured=valid(env.OWNER_USER_ID);
  // Equality is an observation only; this does not establish transport provenance.
  const gatewayVerified=env.GATEWAY_IDENTITY_VERIFIED==='1';
  return{scope:'authenticated_owner_binding_only',identity_present:identityPresent,owner_secret_configured:ownerConfigured,identity_matches_owner:identityPresent&&ownerConfigured&&user===env.OWNER_USER_ID,gateway_identity_verified:gatewayVerified,private_owner_export_enabled:privateOwnerExportEnabled,ordinary_export_gate_enabled:gatewayVerified||privateOwnerExportEnabled,source_version:BUILD_SOURCE_VERSION};
}
async function privateStorageCheck(bucket){
  const storage=new R2CreateOnlyStore(bucket),received=new Date().toISOString(),prefix='receipts/'+received.slice(0,10).replaceAll('-','/')+'/';
  const make=async(label)=>{const id=crypto.randomUUID(),body=new TextEncoder().encode(JSON.stringify({schema_version:1,tracker_version:'candidate-storage-probe/1',events:[],probe:label}));return{id,key:prefix+id+'.json',bytes:new TextEncoder().encode(JSON.stringify({receipt_schema_version:1,receipt_id:id,received_at:received,receipt_body_sha256:await sha256(body),body_base64:base64(body),body_bytes:body.length,content_type:'application/json',origin:'private-candidate-test',collector_version:BUILD_SOURCE_VERSION,transport:{method:'MCP_SYNTHETIC_TEST'},source_ip:{status:'unavailable',provenance:'unverified',address:null}}))};};
  const a=await make('create-only-A'),b=await make('create-only-B');
  const targetKey=prefix+crypto.randomUUID()+'.json',retained=[];let stage='preserve_A';
  const info=async(key,bytes)=>({key,sha256:await sha256(bytes),bytes:bytes.length});
  try{
    const first=await storage.create(a.key,a.bytes);if(!first.created)throw new Error();retained.push(await info(a.key,a.bytes));
    stage='preserve_B';const second=await storage.create(b.key,b.bytes);if(!second.created)throw new Error();retained.push(await info(b.key,b.bytes));
    // Both attempted byte sequences remain in canonical records even if the
    // provider unexpectedly violates its conditional-write promise on this copy.
    stage='create_collision_copy';const target=await storage.create(targetKey,a.bytes);if(!target.created)throw new Error();retained.push(await info(targetKey,a.bytes));
    stage='conditional_collision';const collision=await storage.create(targetKey,b.bytes);if(collision.created)throw new Error();
    stage='readback';for(const item of retained){const actual=await storage.readChunk(item.key,0,8192);if(!actual||actual.bytes.length!==item.bytes||await sha256(actual.bytes)!==item.sha256)throw new Error();}
    return{status:'PASS',scope:'hosted_R2_create_only_collision_and_readback',receipts:retained,retention_lock_verified:false,source_version:BUILD_SOURCE_VERSION};
  }catch{return{status:'FAIL',scope:'hosted_R2_create_only_collision_and_readback',stage,retained_receipts:retained,collision_target_key:targetKey,retention_lock_verified:false,source_version:BUILD_SOURCE_VERSION};}
}
export default {async fetch(request,env){
  const url=new URL(request.url);
  // This separate private-candidate mode never marks the public gateway verified.
  // Disable its flag before any audience change; Sites owns the access policy.
  const privateOwnerExportEnabled=env.PRIVATE_CANDIDATE_BOOTSTRAP==='1'&&env.PRIVATE_OWNER_EXPORT_ENABLED==='1'&&url.pathname==='/mcp'&&request.method==='POST'&&typeof env.CURSOR_HMAC_KEY==='string'&&new TextEncoder().encode(env.CURSOR_HMAC_KEY).length>=32;
  const collector=createCollector({store:new R2CreateOnlyStore(env.BUCKET),ownerIdentity:env.OWNER_USER_ID||null,verifiedGatewayIdentity:env.GATEWAY_IDENTITY_VERIFIED==='1',privateSiteMcpOwnerAccess:privateOwnerExportEnabled,cursorHmacKey:env.CURSOR_HMAC_KEY||null,collectorVersion:BUILD_SOURCE_VERSION});
  if(env.PRIVATE_CANDIDATE_BOOTSTRAP==='1'&&url.pathname==='/mcp'&&request.method==='POST'){
    // A cloned stream's cancel promise waits for its sibling. Request cancellation
    // without awaiting it here; the core then bounds and cancels the original.
    let rpc;try{rpc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readBoundedBody(request.clone(),16384,{awaitCancellation:false})));}catch{return collector.fetch(request);}
    if(!validMcpRequest(rpc))return collector.fetch(request);
    if(rpc.method==='tools/list'){
      const normal=await collector.fetch(request);const value=await normal.clone().json();if(!normal.ok||!Array.isArray(value.result?.tools))return normal;value.result.tools.push(...PRIVATE_PROBE_TOOLS);return candidateReply(value.id,value.result);
    }
    if(rpc?.jsonrpc==='2.0'&&rpc.method==='tools/call'&&PRIVATE_PROBE_TOOLS.some(t=>t.name===rpc.params?.name)){
      const user=request.headers.get('oai-authenticated-user-id');
      if(!user||user.length>200||user.includes(','))return candidateReply(rpc.id??null,{isError:true,content:[{type:'text',text:'Authenticated private candidate session required'}]},403);
      if(!validMcpToolParams(rpc.params))return candidateReply(rpc.id??null,{isError:true,content:[{type:'text',text:'invalid_arguments'}]});
      if(rpc.params.name==='candidate_owner_binding_check'){
        const data=candidateOwnerBinding(user,env,privateOwnerExportEnabled);
        if(!data.identity_matches_owner)return candidateReply(rpc.id??null,{isError:true,content:[{type:'text',text:'Owner binding verification failed'}]},403);
        const args=rpc.params.arguments;
        if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)return candidateReply(rpc.id??null,{isError:true,content:[{type:'text',text:'invalid_arguments'}]});
        return candidateReply(rpc.id??null,{content:[{type:'text',text:JSON.stringify(data)}],isError:false});
      }
      const args=rpc.params.arguments===undefined?{}:rpc.params.arguments;
      if(!args||typeof args!=='object'||Array.isArray(args)||Object.keys(args).length)return candidateReply(rpc.id??null,{isError:true,content:[{type:'text',text:'invalid_arguments'}]});
      try{const data=rpc.params.name==='bootstrap_owner_identity'?{site_scoped_user_id:user,owner_enrolled:false,...candidateOwnerBinding(user,env,privateOwnerExportEnabled)}:await privateStorageCheck(env.BUCKET);return candidateReply(rpc.id??null,{content:[{type:'text',text:JSON.stringify(data)}],isError:false});}
      catch{return candidateReply(rpc.id??null,{isError:true,content:[{type:'text',text:'candidate_probe_failed'}]});}
    }
  }
  if(url.pathname==='/'&&request.method==='GET')return new Response('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Farpoint collector — private candidate</title><style>body{font:17px system-ui;max-width:44rem;margin:12vh auto;padding:24px;color:#12323b}p{line-height:1.6}</style><h1>Farpoint lead collector</h1><p>Private feasibility candidate. Customer tracking is disabled.</p><p>Production release remains gated on verified access, visitor-IP provenance, retention, recovery and scheduled operation.</p></html>',{headers:{'Content-Type':'text/html;charset=utf-8','Cache-Control':'no-store','X-Robots-Tag':'noindex,nofollow'}});
  return collector.fetch(request);
}};
