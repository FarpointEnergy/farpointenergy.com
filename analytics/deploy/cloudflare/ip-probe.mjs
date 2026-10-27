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
const IP_PROBE_HTML = String.raw`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Farpoint synthetic network test</title><style>body{font:17px system-ui;max-width:44rem;margin:8vh auto;padding:24px;color:#12323b}label{display:block;margin:18px 0}input{box-sizing:border-box;display:block;width:100%;padding:10px;margin-top:6px}button{padding:12px 20px}p,output{line-height:1.6}output{display:block;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:20px}</style><h1>Farpoint synthetic network test</h1><p>This test stores a synthetic request and limited network-header observations privately. It does not submit an RFQ or identify an employer. Only the authenticated account owner can read the saved observations.</p><p>Enter a test identifier and the public egress IP independently observed for this browser. These entries are saved as unverified test assertions. Do not enter credentials or customer information.</p><form id="probe" method="post"><label for="test-id">Synthetic test identifier<input id="test-id" name="test_id" required maxlength="100" autocomplete="off" placeholder="browser-network-01"></label><label for="expected-ip">Independently observed public egress IP<input id="expected-ip" name="expected_ip" required maxlength="45" autocomplete="off" placeholder="IPv4 or IPv6 address"></label><button type="submit">Save synthetic network test</button></form><output id="result" aria-live="polite"></output><script>const f=document.getElementById('probe'),o=document.getElementById('result');f.addEventListener('submit',async e=>{e.preventDefault();const b=f.querySelector('button');b.disabled=true;o.textContent='Saving synthetic evidence…';try{const r=await fetch(location.pathname,{method:'POST',credentials:'omit',cache:'no-store',headers:{'Content-Type':'application/json'},body:JSON.stringify({synthetic:true,test_id:document.getElementById('test-id').value,expected_ip:document.getElementById('expected-ip').value})});const v=await r.json();o.textContent=r.status===202&&v.status==='retained'?'Synthetic evidence retained.\nProof: '+v.proof_key+'\nSHA-256: '+v.proof_sha256+'\nIP provenance is not yet verified.':'Test was not confirmed as retained. Please keep this page and report the status: '+r.status;}catch{o.textContent='The request failed or its receipt was not confirmed. No successful test is claimed.';}finally{b.disabled=false;}});</script></html>`;

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
    if (request.method === 'GET') return new Response(IP_PROBE_HTML, {headers:{...IP_PROBE_HEADERS,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"}});
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
