// Read-only identity diagnostics. No collector/storage request and no credential output.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {verifyStore01GithubOidc,STORE01_ISSUER,STORE01_JWKS,STORE01_REPOSITORY,STORE01_REF,STORE01_WORKFLOW} from './store-rollback-oidc.mjs';
const [runUuid,evidenceDirectory]=process.argv.slice(2);
if(!/^[a-f0-9-]{36}$/.test(runUuid||'')||!evidenceDirectory)throw Error('fixed_run_and_evidence_directory_required');
const root=resolve(evidenceDirectory);await mkdir(root,{recursive:true});
const save=(name,value)=>writeFile(resolve(root,name),JSON.stringify(value,null,2),{flag:'wx',mode:0o600});
const result={scope:'OIDC identity read-only diagnosis; no collector POST or storage operation',created_at:new Date().toISOString(),github_run_id:process.env.GITHUB_RUN_ID,workflow_commit:process.env.GITHUB_SHA,raw_token_retained:false,raw_claim_values_retained:false};
try{
  const url=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if(url.protocol!=='https:'||!url.hostname.endsWith('.actions.githubusercontent.com')||url.username||url.password)throw Error('token_endpoint_not_official');
  url.searchParams.set('audience','urn:farpoint:store01:'+runUuid);
  const response=await fetch(url,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(20000)});
  result.token_http_ok=response.ok;if(!response.ok)throw Error('token_request_failed');
  const {value:jwt}=await response.json();if(typeof jwt!=='string'||jwt.length>16384||jwt.split('.').length!==3)throw Error('invalid_token_shape');
  const [first,second]=jwt.split('.'),header=JSON.parse(Buffer.from(first,'base64url').toString('utf8')),claims=JSON.parse(Buffer.from(second,'base64url').toString('utf8'));
  const config={FARPOINT_STORE01_OIDC_ENABLED:'1',FARPOINT_STORE01_OIDC_REPOSITORY_ID:'1367815671',FARPOINT_STORE01_OIDC_OWNER_ID:'328540327',FARPOINT_STORE01_OIDC_RUN_ID:process.env.GITHUB_RUN_ID,FARPOINT_STORE01_OIDC_WORKFLOW_SHA:process.env.GITHUB_SHA};
  const expected={iss:STORE01_ISSUER,aud:'urn:farpoint:store01:'+runUuid,repository:STORE01_REPOSITORY,repository_owner:'FarpointEnergy',repository_id:config.FARPOINT_STORE01_OIDC_REPOSITORY_ID,repository_owner_id:config.FARPOINT_STORE01_OIDC_OWNER_ID,ref:STORE01_REF,ref_type:'branch',workflow_ref:STORE01_WORKFLOW,workflow_sha:process.env.GITHUB_SHA,sha:process.env.GITHUB_SHA,run_id:process.env.GITHUB_RUN_ID,run_attempt:'1',event_name:'push',runner_environment:'github-hosted'};
  result.claim_equalities=Object.fromEntries(Object.entries(expected).map(([key,value])=>[key,{present:Object.hasOwn(claims,key),is_string:typeof claims[key]==='string',matches:claims[key]===value}]));
  result.header={keys:Object.keys(header).sort(),alg_RS256:header.alg==='RS256',typ_JWT:header.typ==='JWT',kid_nonempty_string:typeof header.kid==='string'&&header.kid.length>0};
  result.optional_claims=Object.fromEntries(['head_ref','base_ref','environment','job_workflow_ref','job_workflow_sha'].map(key=>[key,{present:Object.hasOwn(claims,key),empty_string:claims[key]==='',is_null:claims[key]===null}]));
  result.job_workflow_matches={ref:claims.job_workflow_ref===STORE01_WORKFLOW,sha:claims.job_workflow_sha===process.env.GITHUB_SHA};
  result.subject_matches={legacy:claims.sub==='repo:'+STORE01_REPOSITORY+':ref:'+STORE01_REF,immutable:claims.sub==='repo:FarpointEnergy@328540327/farpointenergy.com@1367815671:ref:'+STORE01_REF};
  const at=Math.floor(Date.now()/1000);result.time={all_safe_integers:['iat','nbf','exp'].every(k=>Number.isSafeInteger(claims[k])),lifetime_seconds:Number.isSafeInteger(claims.exp)&&Number.isSafeInteger(claims.iat)?claims.exp-claims.iat:null,age_seconds:Number.isSafeInteger(claims.iat)?at-claims.iat:null,not_before_delta_seconds:Number.isSafeInteger(claims.nbf)?claims.nbf-at:null,not_expired:Number.isSafeInteger(claims.exp)&&claims.exp>at,jti_present:typeof claims.jti==='string'&&claims.jti.length>0};
  await save('safe-claim-comparisons.json',result);
  // Separate fixed public JWKS fetch allows diagnostics even when scope fails early.
  const jwksResponse=await fetch(STORE01_JWKS,{method:'GET',redirect:'error',signal:AbortSignal.timeout(20000)});const jwks=await jwksResponse.json();const matches=Array.isArray(jwks.keys)?jwks.keys.filter(k=>k.kid===header.kid):[];
  result.jwks={http_ok:jwksResponse.ok,key_count:Array.isArray(jwks.keys)?jwks.keys.length:null,matching_key_count:matches.length,key_categories:matches.map(k=>({rsa:k.kty==='RSA',use_sig:k.use==='sig',alg_RS256:k.alg==='RS256',standard_exponent:k.e==='AQAB',modulus_bytes:typeof k.n==='string'?Buffer.from(k.n,'base64url').length:null}))};
  result.unchanged_local_verifier_passed=await verifyStore01GithubOidc(new Request('https://identity-check.example.invalid',{headers:{Authorization:'Bearer '+jwt}}),config,{id:runUuid,day:new Date().toISOString().slice(0,10)});
  result.no_collector_requests=true;await save('safe-diagnostic-result.json',result);console.log('Safe read-only OIDC comparisons retained; no collector request.');
}catch(error){await save('diagnostic-failure.json',{status:'FAIL',reason:['token_endpoint_not_official','token_request_failed','invalid_token_shape'].includes(error.message)?error.message:'diagnostic_operation_failed_no_credentials_logged',no_collector_requests:true});throw Error('oidc_diagnostic_failed_see_safe_evidence');}
