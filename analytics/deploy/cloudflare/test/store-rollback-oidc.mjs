// Narrow one-run GitHub Actions identity. No user identity or hosting-bypass header.
export const STORE01_ISSUER='https://token.actions.githubusercontent.com';
export const STORE01_JWKS=STORE01_ISSUER+'/.well-known/jwks';
export const STORE01_REPOSITORY='FarpointEnergy/farpointenergy.com';
export const STORE01_REF='refs/heads/codex/lead-intelligence-design-v1';
export const STORE01_WORKFLOW=STORE01_REPOSITORY+'/.github/workflows/farpoint-store-rollback.yml@'+STORE01_REF;

function oidcBytes(value){
  if(typeof value!=='string'||!value||!/^[A-Za-z0-9_-]+$/.test(value))throw Error('invalid_encoding');
  const bytes=Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-value.length%4)%4)),c=>c.charCodeAt(0));
  if(btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')!==value)throw Error('noncanonical_encoding');
  return bytes;
}
function oidcObject(value){
  const object=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(oidcBytes(value)));
  if(!object||typeof object!=='object'||Array.isArray(object))throw Error('invalid_object');
  return object;
}
async function oidcBoundedJson(response){
  if(response.status!==200||!response.ok||response.redirected||!response.body)throw Error('jwks_unavailable');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>65536)throw Error('jwks_too_large');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});}
  const all=new Uint8Array(size);let offset=0;for(const c of chunks){all.set(c,offset);offset+=c.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all));
}

export async function verifyStore01GithubOidc(request,env,run,{fetchJwks=(input,init)=>globalThis.fetch(input,init),now=()=>Date.now(),subtle=crypto.subtle,trace}={}){
  const stage=value=>{if(trace)trace.stage=value;};
  try{
    stage('configuration');
    const repositoryId=env.FARPOINT_STORE01_OIDC_REPOSITORY_ID,ownerId=env.FARPOINT_STORE01_OIDC_OWNER_ID;
    const runId=env.FARPOINT_STORE01_OIDC_RUN_ID,commit=env.FARPOINT_STORE01_OIDC_WORKFLOW_SHA;
    if(env.FARPOINT_STORE01_OIDC_ENABLED!=='1'||![repositoryId,ownerId,runId].every(v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v))||typeof commit!=='string'||!/^[a-f0-9]{40}$/.test(commit))return false;
    stage('token_shape');
    const auth=request.headers.get('authorization');if(typeof auth!=='string'||auth.length>16384||!auth.startsWith('Bearer '))return false;
    const token=auth.slice(7),parts=token.split('.');if(parts.length!==3)return false;
    stage('token_decode');
    const header=oidcObject(parts[0]),claims=oidcObject(parts[1]),signature=oidcBytes(parts[2]);
    stage('header');
    if(header.alg!=='RS256'||header.typ!=='JWT'||typeof header.kid!=='string'||header.kid.length>200||Object.keys(header).some(k=>!['alg','typ','kid','x5t','x5t#S256'].includes(k)))return false;
    stage('pinned_claims');
    const expected={iss:STORE01_ISSUER,aud:'urn:farpoint:store01:'+run.id,repository:STORE01_REPOSITORY,repository_owner:'FarpointEnergy',repository_id:repositoryId,repository_owner_id:ownerId,ref:STORE01_REF,ref_type:'branch',workflow_ref:STORE01_WORKFLOW,workflow_sha:commit,sha:commit,run_id:runId,run_attempt:'1',event_name:'push',runner_environment:'github-hosted'};
    if(Object.entries(expected).some(([k,v])=>claims[k]!==v))return false;
    stage('subject_and_workflow');
    const subjects=['repo:'+STORE01_REPOSITORY+':ref:'+STORE01_REF,'repo:FarpointEnergy@'+ownerId+'/farpointenergy.com@'+repositoryId+':ref:'+STORE01_REF];
    const jobWorkflowAbsent=claims.job_workflow_ref===undefined&&claims.job_workflow_sha===undefined;
    const jobWorkflowMatches=claims.job_workflow_ref===STORE01_WORKFLOW&&claims.job_workflow_sha===commit;
    if(!subjects.includes(claims.sub)||claims.environment!==undefined||(!jobWorkflowAbsent&&!jobWorkflowMatches)||claims.head_ref!==''||claims.base_ref!=='')return false;
    stage('time');
    const at=Math.floor(now()/1000);
    if(!['iat','nbf','exp'].every(k=>Number.isSafeInteger(claims[k]))||claims.iat>at+30||claims.nbf>at+30||claims.exp<=at||claims.exp<=claims.iat||claims.exp-claims.iat>600||at-claims.iat>600||claims.nbf>claims.exp||typeof claims.jti!=='string'||!claims.jti||claims.jti.length>200)return false;
    stage('run_day');
    if(new Date(now()).toISOString().slice(0,10)!==run.day)return false;
    stage('jwks_timeout');
    const signal=AbortSignal.timeout(5000);
    stage('jwks_fetch');
    // Workers rejects redirect:'error' at construction. Manual + exact200 check
    // preserves the same no-redirect trust boundary without following Location.
    const response=await fetchJwks(STORE01_JWKS,{method:'GET',redirect:'manual',headers:{Accept:'application/json'},signal});
    if(trace)trace.jwks_http_status=response.status;
    stage('jwks_decode');
    const jwks=await oidcBoundedJson(response);
    stage('jwks_key_selection');
    if(!Array.isArray(jwks.keys)||jwks.keys.length>20)return false;
    const candidates=jwks.keys.filter(k=>k?.kid===header.kid);
    if(candidates.length!==1)return false;
    const key=candidates[0];if(key.kty!=='RSA'||key.alg!=='RS256'||key.use!=='sig'||key.e!=='AQAB'||oidcBytes(key.n).length<256||oidcBytes(key.n).length>512||key.d!==undefined)return false;
    stage('crypto_import');
    const imported=await subtle.importKey('jwk',{kty:key.kty,n:key.n,e:key.e,alg:'RS256',ext:true},{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    stage('signature_verify');
    const valid=await subtle.verify('RSASSA-PKCS1-v1_5',imported,signature,new TextEncoder().encode(parts[0]+'.'+parts[1]));
    if(valid)stage('verified');return valid;
  }catch(error){if(trace)trace.exception_type=['Error','TypeError','SyntaxError','DOMException','AbortError','TimeoutError'].includes(error?.name)?error.name:'other';return false;}
}
