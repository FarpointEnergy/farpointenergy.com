// Concatenate after collector/core.mjs and before wrapper.mjs only for an
// explicitly enabled synthetic IP-provenance test. This is not an exporter.
export const SYNTHETIC_IP_PROBE_PATH = '/__synthetic/ip-proof';
export const SYNTHETIC_IP_PROBE_MAX_BYTES = 4096;
const IP_PROBE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer'
};
const IP_PROBE_HEADER_NAMES = [
  'cf-connecting-ip', 'cf-connecting-ipv6', 'cf-worker',
  'cf-connecting-o2o', 'x-forwarded-for', 'x-real-ip', 'true-client-ip'
];
const IP_PROBE_HTML = String.raw`<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>Farpoint synthetic network test</title>
<style>body{font:17px system-ui;max-width:44rem;margin:5vh auto;padding:24px;color:#12323b}label{display:block;margin:18px 0}input,select{box-sizing:border-box;display:block;width:100%;padding:10px;margin-top:6px;font:inherit}button{padding:12px 20px;font:inherit;cursor:pointer}button:disabled{cursor:wait}p,output,details{line-height:1.6}output{display:block;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:20px}details{margin-top:28px;border-top:1px solid #d3dce0;padding-top:16px}small{display:block;line-height:1.6}</style>
<h1>Farpoint synthetic network test</h1>
<p>This one-time test helps check whether Farpoint can reliably record a visitor's network address. It stores a synthetic request and limited network observations privately. It does not submit an RFQ, identify an employer or enable visitor tracking.</p>
<p>Choose the connection you are using, then select <strong>Run and save network test</strong>. Only after that click, this page asks ipify's IPv4, IPv6 and dual-stack services for the network addresses they see and saves those observations with Farpoint. The services receive your network address; no credentials or customer information are sent.</p>
<p>Run once on Wi-Fi, then switch this device to cellular or a phone hotspot and run again. An unavailable IPv6 connection is recorded as a test limitation. Different services can see different routes, so a saved test does not by itself verify an IP address.</p>
<label for="network-label">Current connection<select id="network-label"><option value="unspecified">Current connection (unspecified)</option value="wifi">Wi-Fi</option><option value="cellular">Cellular or phone hotspot</option><option value="other">Other connection</option></select></label>
<button id="automatic-probe" type="button">Run and save network test</button>
<small>No network checks run before you click. Results remain unverified test assertions until reviewed.</small>
<details><summary>Manual test with an independently observed address</summary>
<p>Use this option if you already independently observed the public egress IP for this browser. These entries are saved as unverified test assertions. Do not enter credentials or customer information.</p>
<form id="probe" method="post"><label for="test-id">Synthetic test identifier<input id="test-id" name="test_id" required maxlength="100" autocomplete="off" placeholder="browser-network-01"></label><label for="expected-ip">Independently observed public egress IP<input id="expected-ip" name="expected_ip" required maxlength="45" autocomplete="off" placeholder="IPv4 or IPv6 address"></label><button type="submit">Save synthetic network test</button></form></details>
<output id="result" aria-live="polite"></output>
<div id="evidence-controls" hidden><p>The exact observations stay in this page until it closes. If saving is unconfirmed, retry the same observations or download them before leaving. The download may contain your network addresses; keep it private.</p><button id="retry-save" type="button" hidden>Retry saving the same observations</button> <button id="download-evidence" type="button">Download collected test evidence</button></div>
<script>
const f=document.getElementById('probe'),o=document.getElementById('result'),automatic=document.getElementById('automatic-probe'),manual=f.querySelector('button'),retry=document.getElementById('retry-save'),download=document.getElementById('download-evidence');
const diagnostics=Object.freeze([
  {id:'ipify_ipv4',label:'IPv4',url:'https://api.ipify.org?format=json',family:4},
  {id:'ipify_ipv6',label:'IPv6',url:'https://api6.ipify.org?format=json',family:6},
  {id:'ipify_dual_stack',label:'Dual-stack',url:'https://api64.ipify.org?format=json',family:0}
]);
const diagnosticCodes=new Set(['http_error','body_too_large','invalid_response','invalid_ip','unexpected_ip_family','timeout','network_error']);
const attempts=[],saveOutcomes=[];let busy=false,pendingSave=null;
function setBusy(value){busy=value;automatic.disabled=value;manual.disabled=value;retry.disabled=value;document.getElementById('network-label').disabled=value;}
function ipFamily(value){
  if(typeof value!=='string'||value.length>45)return null;
  if(/^(?:\d{1,3}\.){3}\d{1,3}$/.test(value)&&value.split('.').every(part=>Number(part)<=255&&!/^0\d/.test(part)))return 4;
  if(value.includes(':')&&/^[0-9a-fA-F:.]+$/.test(value)){try{new URL('https://['+value+']/');return 6;}catch{}}
  return null;
}
function diagnosticError(code){const error=new Error(code);error.diagnosticCode=code;return error;}
async function readDiagnostic(response){
  if(!response.body||!response.body.getReader)throw diagnosticError('invalid_response');
  const reader=response.body.getReader(),chunks=[];let bytes=0;
  try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>256){await reader.cancel();throw diagnosticError('body_too_large');}chunks.push(part.value);}}
  finally{reader.releaseLock();}
  const joined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.byteLength;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));}catch{throw diagnosticError('invalid_response');}
}
async function observeDiagnostic(service){
  const controller=new AbortController(),started=Date.now();let timedOut=false,status=null;
  const timer=setTimeout(()=>{timedOut=true;controller.abort();},8000);
  try{
    const response=await fetch(service.url,{method:'GET',mode:'cors',credentials:'omit',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',signal:controller.signal});
    status=response.status;if(!response.ok)throw diagnosticError('http_error');
    const value=await readDiagnostic(response),family=ipFamily(value&&value.ip);
    if(!family)throw diagnosticError('invalid_ip');
    if(service.family&&family!==service.family)throw diagnosticError('unexpected_ip_family');
    return {service:service.id,status:'observed',ip:value.ip,family,http_status:status,error_code:null,elapsed_ms:Math.min(60000,Math.max(0,Date.now()-started))};
  }catch(error){
    const code=timedOut?'timeout':diagnosticCodes.has(error&&error.diagnosticCode)?error.diagnosticCode:'network_error';
    return {service:service.id,status:'failed',ip:null,family:null,http_status:status,error_code:code,elapsed_ms:Math.min(60000,Math.max(0,Date.now()-started))};
  }finally{clearTimeout(timer);}
}
async function saveEvidence(payload,prefix){
  const body=JSON.stringify(payload);
  if(new TextEncoder().encode(body).length>4096)throw new Error('bounded_test_payload_exceeded');
  const attempt=Object.freeze({index:attempts.length,created_at:new Date().toISOString(),body,prefix});
  attempts.push(attempt);document.getElementById('evidence-controls').hidden=false;
  return saveAttempt(attempt);
}
async function saveAttempt(attempt){
  const {body,prefix}=attempt;pendingSave=attempt;retry.hidden=true;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try{
    const response=await fetch(location.pathname,{method:'POST',credentials:'omit',cache:'no-store',redirect:'error',headers:{'Content-Type':'application/json'},body,signal:controller.signal});
    const value=await response.json();
    const retained=response.status===202&&value.status==='retained'&&value.terminal===true&&value.ip_provenance_verified===false&&typeof value.proof_key==='string'&&/^ip-proof\/\d{4}\/\d{2}\/\d{2}\/[A-Za-z0-9_-]{8,100}\.json$/.test(value.proof_key)&&typeof value.proof_sha256==='string'&&/^[a-f0-9]{64}$/.test(value.proof_sha256);
    saveOutcomes.push(Object.freeze({attempt_index:attempt.index,received_at:new Date().toISOString(),http_status:response.status,status:retained?'retained':'acknowledgement_unconfirmed',proof_key:retained?value.proof_key:null,proof_sha256:retained?value.proof_sha256:null}));
    if(retained)pendingSave=null;
    o.textContent=prefix+(retained?'Synthetic evidence retained.\nProof: '+value.proof_key+'\nSHA-256: '+value.proof_sha256+'\nIP provenance is not yet verified.':'Test was not confirmed as retained. Please keep this page and report the status: '+response.status);
  }catch{saveOutcomes.push(Object.freeze({attempt_index:attempt.index,received_at:new Date().toISOString(),http_status:null,status:'save_network_or_response_error',proof_key:null,proof_sha256:null}));o.textContent=prefix+'The save request failed or its receipt was not confirmed. No successful test is claimed. Retry the same observations or download the evidence below; a retry creates a separate record.';}
  finally{clearTimeout(timer);retry.hidden=!pendingSave;}
}
retry.addEventListener('click',async()=>{if(busy||!pendingSave)return;setBusy(true);const attempt=pendingSave;o.textContent=attempt.prefix+'Retrying the same saved observations…';try{await saveAttempt(attempt);}finally{setBusy(false);}});
download.addEventListener('click',()=>{
  if(!attempts.length)return;
  const snapshot={format:'farpoint-synthetic-network-evidence/1',ip_provenance_verified:false,downloaded_at:new Date().toISOString(),attempts:[...attempts],save_outcomes:[...saveOutcomes]};
  const url=URL.createObjectURL(new Blob([JSON.stringify(snapshot,null,2)],{type:'application/json'})),link=document.createElement('a');
  link.href=url;link.download='farpoint-network-test-'+Date.now()+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
});
automatic.addEventListener('click',async()=>{
  if(busy)return;setBusy(true);o.textContent='Checking IPv4, IPv6 and dual-stack routes…';
  const input=document.getElementById('network-label').value,network=['wifi','cellular','other'].includes(input)?input:'unspecified';
  let prefix='';
  try{
    const observations=await Promise.all(diagnostics.map(observeDiagnostic));
    prefix=observations.map((result,index)=>diagnostics[index].label+': '+(result.status==='observed'?'address observed (unverified)':result.error_code+(result.http_status?' (HTTP '+result.http_status+')':''))).join('\n')+'\n\n';
    o.textContent=prefix+'Saving synthetic evidence…';
    await saveEvidence({synthetic:true,test_id:'browser-'+network+'-'+Date.now()+'-'+crypto.randomUUID().slice(0,8),expected_ip:null,network_label:network,diagnostic_assertions_status:'untrusted_client_assertions',diagnostic_observations:observations},prefix);
  }catch{o.textContent=prefix+'The test could not finish. No saved test is confirmed. Keep this page and report this status.';}
  finally{setBusy(false);}
});
f.addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;setBusy(true);o.textContent='Saving synthetic evidence…';
  try{await saveEvidence({synthetic:true,test_id:document.getElementById('test-id').value,expected_ip:document.getElementById('expected-ip').value},'');}
  catch{o.textContent='The test could not finish. No saved test is confirmed.';}
  finally{setBusy(false);}
});
</script></html>`;

function ipProbeJson(value, status) {
  return new Response(JSON.stringify(value), {status, headers:{...IP_PROBE_HEADERS,'Content-Type':'application/json; charset=utf-8'}});
}
function ipProbeAssertion(value, maxLength) {
  return typeof value === 'string' && value.length <= maxLength ? value : null;
}

/**
 * Returns null for unrelated paths. On the probe path, disabled/incorrect-host
 * requests return 404 without touching storage. Expected IPs supplied by callers
 * never establish provenance. Records do not contain source_ip.status=verified.
 * Only selected normalized Headers values are retained (not raw wire headers).
 */
export function createSyntheticIpProbe({store, now=()=>new Date(), newId=()=>crypto.randomUUID(), sourceVersion='synthetic-ip-probe/1.0.0'}={}) {
  return async function syntheticIpProbe(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== SYNTHETIC_IP_PROBE_PATH) return null;
    if (env.CLOUDFLARE_SYNTHETIC_IP_PROBE !== '1' || typeof env.CLOUDFLARE_SYNTHETIC_IP_PROBE_HOSTNAME !== 'string' || !env.CLOUDFLARE_SYNTHETIC_IP_PROBE_HOSTNAME || url.hostname !== env.CLOUDFLARE_SYNTHETIC_IP_PROBE_HOSTNAME) return ipProbeJson({error:'not_found'},404);
    if (request.method === 'GET') return new Response(IP_PROBE_HTML, {headers:{...IP_PROBE_HEADERS,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self' https://api.ipify.org https://api6.ipify.org https://api64.ipify.org; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
    async function reject(reason,status) {
      let recorded=false;
      try {
        const clock=now();
        if (!(clock instanceof Date)||!Number.isFinite(clock.getTime())) throw new Error('invalid_clock');
        const received=clock.toISOString(),storage=store||new R2CreateOnlyStore(env.BUCKET);
        for(let attempt=0;attempt<8;attempt++) {
          const id=newId();
          if(typeof id!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw new Error('invalid_generated_id');
          const record={proof_schema_version:1,proof_kind:'transport_rejection',synthetic_only:true,proof_id:id,received_at:received,source_version:sourceVersion,hostname:url.hostname,reason,method:['POST','OPTIONS','GET','PUT','DELETE','PATCH','HEAD'].includes(request.method)?request.method:'other',body_preserved:false,ip_provenance_verified:false};
          const written=await storage.create('ip-proof/'+received.slice(0,10).replaceAll('-','/')+'/'+id+'.json',new TextEncoder().encode(JSON.stringify(record)));
          if(written?.created===true){recorded=true;break;}
          if(written?.created!==false)break;
        }
      } catch {}
      return ipProbeJson({error:reason,rejection_metadata_recorded:recorded},status);
    }
    if (request.method !== 'POST') return reject('method_not_allowed',405);
    const origin=request.headers.get('origin');
    if (origin !== null && origin !== url.origin) return reject('origin_not_allowed',403);
    if ((request.headers.get('content-encoding')||'identity').trim().toLowerCase() !== 'identity') return reject('unsupported_content_encoding',415);
    if ((request.headers.get('content-type')||'').split(';')[0].trim().toLowerCase() !== 'application/json') return reject('unsupported_content_type',415);
    let body;
    try { body=await readBoundedBody(request,SYNTHETIC_IP_PROBE_MAX_BYTES); }
    catch(error) { return reject(error?.code==='body_too_large'?'body_too_large':'body_read_failed',error?.code==='body_too_large'?413:400); }
    // Parsing is optional diagnostic interpretation; admitted bytes survive even
    // malformed UTF-8/JSON. The supplied values are never authoritative.
    let input=null, parseStatus='unparsed';
    try { input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)); parseStatus='parsed'; } catch { parseStatus='invalid_json_or_utf8'; }
    const selectedHeaders={};
    for (const name of IP_PROBE_HEADER_NAMES) {
      const value=request.headers.get(name);
      if (value !== null) selectedHeaders[name]={value:value.slice(0,1024),truncated:value.length>1024};
    }
    try {
      const clock=now();
      if (!(clock instanceof Date) || !Number.isFinite(clock.getTime())) throw new Error('invalid_clock');
      const received=clock.toISOString(), bodyHash=await sha256(body);
      const record={
        proof_schema_version:1, proof_kind:'ip_observation', synthetic_only:true, received_at:received,
        source_version:sourceVersion, hostname:url.hostname,
        body_bytes:body.length, body_sha256:bodyHash, body_base64:base64(body),
        body_parse_status:parseStatus,
        expected:{status:'untrusted_client_assertion',test_id:ipProbeAssertion(input?.test_id,100),network_ip:ipProbeAssertion(input?.expected_ip,45)},
        observation:{status:'unverified',cf_request_metadata_present:!!request.cf&&typeof request.cf==='object'&&!Array.isArray(request.cf),selected_normalized_request_headers:selectedHeaders},
        ip_provenance_verified:false
      };
      const storage=store||new R2CreateOnlyStore(env.BUCKET);
      for (let attempt=0;attempt<8;attempt++) {
        const id=newId();
        if (typeof id!=='string'||!/^[A-Za-z0-9_-]{8,100}$/.test(id)) throw new Error('invalid_generated_id');
        const key='ip-proof/'+received.slice(0,10).replaceAll('-','/')+'/'+id+'.json';
        const bytes=new TextEncoder().encode(JSON.stringify({...record,proof_id:id}));
        const written=await storage.create(key,bytes);
        if (written?.created===true) return ipProbeJson({status:'retained',terminal:true,proof_id:id,proof_key:key,proof_sha256:await sha256(bytes),ip_provenance_verified:false},202);
        if (written?.created!==false) throw new Error('unconfirmed_storage_write');
      }
      throw new Error('collision_exhausted');
    } catch { return ipProbeJson({status:'retry',reason:'durability_unconfirmed'},503); }
  };
}
