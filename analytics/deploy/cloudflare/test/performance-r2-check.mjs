// Run through the authenticated Cloudflare tool only. No credentials, raw
// object bodies or network addresses are returned. Root supplies metadata from
// a separately completed authenticated listing and the preserved CI ACK list.
export async function verifyPerformanceReceiptBatch({cloudflare,accountId,bucket,rows}) {
  if(!cloudflare||typeof cloudflare.request!=='function'||!/^[a-f0-9]{32}$/.test(accountId)||bucket!=='farpoint-lead-candidate-20261026'||!Array.isArray(rows)||rows.length<1||rows.length>40)throw new Error('invalid_batch_scope');
  const hash=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join('');
  const results=[];
  for(let offset=0;offset<rows.length;offset+=5){
    results.push(...await Promise.all(rows.slice(offset,offset+5).map(async row=>{
      if(!row||typeof row.key!=='string'||!/^receipts\/\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9_-]{8,100}\.json$/.test(row.key)||typeof row.receipt_id!=='string'||!row.key.endsWith('/'+row.receipt_id+'.json')||!/^[a-f0-9]{64}$/.test(row.object_sha256||'')||!Number.isSafeInteger(row.object_bytes)||row.object_bytes<1||!/^[a-f0-9]{64}$/.test(row.ack_body_sha256||'')||!/^[a-f0-9]{64}$/.test(row.original_body_sha256||'')||!Number.isSafeInteger(row.original_body_bytes)||row.original_body_bytes<0)throw new Error('invalid_expected_row');
      try{
        const response=await cloudflare.request({method:'GET',path:'/accounts/'+accountId+'/r2/buckets/'+bucket+'/objects/'+row.key});
        if(response.success!==true||response.status!==200)throw new Error('read_failed');
        const raw=typeof response.result==='string'?response.result:JSON.stringify(response.result),object=new TextEncoder().encode(raw),record=JSON.parse(raw);
        const bytes=Uint8Array.from(atob(record.body_base64),x=>x.charCodeAt(0)),bodyHash=await hash(bytes),objectHash=await hash(object);
        let eventCount=null,allSynthetic=null,schemaSupported=null;
        try{const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));eventCount=Array.isArray(input.events)?input.events.length:null;allSynthetic=eventCount!==null&&input.events.every(x=>x&&x.synthetic===true);schemaSupported=input.schema_version===1&&eventCount!==null&&eventCount<=50;}catch{}
        const safe={key:row.key,receipt_id:row.receipt_id,object_bytes:object.length,object_sha256:objectHash,object_matches_listing:object.length===row.object_bytes&&objectHash===row.object_sha256,
          inner_body_integrity:record.body_bytes===bytes.length&&record.receipt_body_sha256===bodyHash,receipt_id_matches:record.receipt_id===row.receipt_id,body_matches_ack:bodyHash===row.ack_body_sha256,
          body_matches_original:bodyHash===row.original_body_sha256&&bytes.length===row.original_body_bytes,body_bytes:bytes.length,body_sha256:bodyHash,event_count:eventCount,all_events_synthetic:allSynthetic,
          envelope_count_and_version_supported:schemaSupported,source_ip_status:record.source_ip?.status==='verified'?'verified':'unavailable'};
        safe.integrity_passed=safe.object_matches_listing&&safe.inner_body_integrity&&safe.receipt_id_matches&&safe.body_matches_ack;
        return safe;
      }catch{return{key:row.key,receipt_id:row.receipt_id,integrity_passed:false,error:'authenticated_read_or_integrity_check_failed'};}
    })));
  }
  return {scope:'candidate_performance_receipt_integrity',rows:results.length,all_integrity_checks_pass:results.every(x=>x.integrity_passed),all_original_bodies_match:results.every(x=>x.body_matches_original),raw_bodies_or_network_addresses_returned:false,results};
}
