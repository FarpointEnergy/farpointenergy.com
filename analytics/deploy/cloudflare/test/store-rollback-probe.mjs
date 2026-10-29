// Fixed, synthetic maintenance operation only. No caller-chosen key/body or export.
export function createStoreRollbackProbe({run,sourceVersion,createCollector,R2CreateOnlyStore,sha256}) {
  const path='/__synthetic/store01';
  const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'};
  const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
  const encoder=new TextEncoder();
  const expectedOrigin='https://farpoint-store01.example.invalid';
  return async(request,env)=>{
    const url=new URL(request.url);
    if(url.pathname!==path)return null;
    const token=env.FARPOINT_STORE01_TOKEN;
    if(url.origin!==run.origin||url.search||request.method!=='POST'||env.FARPOINT_STORE01_ENABLED!=='1'||typeof token!=='string'||token.length<32||request.headers.get('authorization')!=='Bearer '+token)return response({error:'not_found'},404);
    const at=new Date();
    if(at.toISOString().slice(0,10)!==run.day)return response({status:'not_run',reason:'run_day_mismatch'},409);
    const keys=run.ids.map(id=>'receipts/'+run.day.replaceAll('-','/')+'/'+id+'.json');
    const observations=[];
    const proof={case_id:'STORE-01',run_id:run.id,synthetic:true,source_version:sourceVersion,keys,observations};
    try{
      if(await env.BUCKET.head(keys[0])||await env.BUCKET.head(keys[1]))return response({...proof,status:'not_run',reason:'fixed_run_key_already_exists'},409);
      const bucket={
        put:async(key,bytes,options)=>{
          if(!keys.includes(key)||options?.onlyIf?.etagDoesNotMatch!=='*')throw new Error('unexpected_write');
          const item={operation:'conditional_put',key,bytes:bytes.byteLength,sha256:await sha256(bytes),only_if:{etagDoesNotMatch:'*'}};observations.push(item);
          try{const result=await env.BUCKET.put(key,bytes,options);item.created=Boolean(result);return result;}
          catch(error){item.created=false;item.error_status=Number.isInteger(error?.status)?error.status:Number.isInteger(error?.statusCode)?error.statusCode:null;item.precondition_error=error?.code==='PreconditionFailed';throw error;}
        },
        head:(...args)=>env.BUCKET.head(...args),get:(...args)=>env.BUCKET.get(...args),list:(...args)=>env.BUCKET.list(...args)
      };
      const store=new R2CreateOnlyStore(bucket);
      async function collect(body,ids){
        let index=0;
        const collector=createCollector({store,allowedOrigins:[expectedOrigin],collectorVersion:sourceVersion,verifiedSourceIp:null,now:()=>at,newId:()=>{if(index>=ids.length)throw new Error('fixed_ids_exhausted');return ids[index++];}});
        const r=await collector.fetch(new Request(run.origin+'/v1/events',{method:'POST',headers:{Origin:expectedOrigin,'Content-Type':'application/json'},body}));
        return {http_status:r.status,ack:await r.json(),allocated_ids:index};
      }
      async function read(key,body){
        const object=await env.BUCKET.get(key);
        if(!object?.body)throw new Error('stored_object_unavailable');
        const bytes=new Uint8Array(await object.arrayBuffer());
        const hash=await sha256(bytes),record=JSON.parse(new TextDecoder().decode(bytes));
        const bodyBytes=encoder.encode(body),bodyHash=await sha256(bodyBytes);
        if(hash!==object.customMetadata?.sha256||record.body_bytes!==bodyBytes.length||record.receipt_body_sha256!==bodyHash||record.body_base64!==btoa(String.fromCharCode(...bodyBytes))||record.source_ip?.status!=='unavailable')throw new Error('stored_object_mismatch');
        const chunk=await store.readChunk(key,0,8192);
        if(chunk.bytes.length!==bytes.length||chunk.size!==bytes.length||await sha256(chunk.bytes)!==hash)throw new Error('adapter_readback_mismatch');
        return {key,bytes:bytes.length,sha256:hash,body_bytes:bodyBytes.length,body_sha256:bodyHash,exact_body_preserved:true,source_ip_status:'unavailable',adapter_chunk_verified:true};
      }
      proof.seed=await collect(run.bodies[0],[run.ids[0]]);
      if(proof.seed.http_status!==202)throw new Error('seed_not_retained');
      proof.seed_before=await read(keys[0],run.bodies[0]);
      proof.forward=await collect(run.bodies[1],[run.ids[0],run.ids[1]]);
      if(proof.forward.http_status!==202)throw new Error('forward_not_retained');
      proof.seed_after=await read(keys[0],run.bodies[0]);
      proof.forward_after=await read(keys[1],run.bodies[1]);
      if(observations.length!==3||observations[0].created!==true||observations[1].created!==false||observations[2].created!==true||proof.forward.allocated_ids!==2||proof.seed_before.sha256!==proof.seed_after.sha256)throw new Error('collision_or_preservation_not_proven');
      return response({...proof,status:'pass',successful_new_objects:2,rejected_conditional_collisions:1,old_object_unchanged:true,unsupported_body_schema_retained:true});
    }catch(error){return response({...proof,status:'failed',reason:['seed_not_retained','forward_not_retained','stored_object_unavailable','stored_object_mismatch','adapter_readback_mismatch','collision_or_preservation_not_proven'].includes(error.message)?error.message:'test_execution_failed',no_unconditional_writes_attempted:true,preservation_verified:false},503);}
  };
}
