// Executed once by the pinned workflow. Never logs or persists an OIDC credential.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {verifyStore01GithubOidc,STORE01_WORKFLOW} from './store-rollback-oidc.mjs';
const endpoint='https://farpoint-lead-collector-candidate.farpointenergy.workers.dev/__synthetic/store01';
const [runUuid,evidenceDirectory]=process.argv.slice(2);
if(!/^[a-f0-9-]{36}$/.test(runUuid||'')||!evidenceDirectory)throw Error('fixed_run_and_evidence_directory_required');
const root=resolve(evidenceDirectory);await mkdir(root,{recursive:true});
const save=(name,value)=>writeFile(resolve(root,name),typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2),{flag:'wx',mode:0o600});
const evidence={started_at:new Date().toISOString(),github_run_id:process.env.GITHUB_RUN_ID,github_run_attempt:process.env.GITHUB_RUN_ATTEMPT,workflow_commit:process.env.GITHUB_SHA,synthetic_run:runUuid,endpoint,one_post_only:true,wait_seconds:180,credential_omitted:true};
await save('request-plan.json',evidence);
let posted=false;
try{
  if(process.env.GITHUB_RUN_ATTEMPT!=='1'||process.env.GITHUB_EVENT_NAME!=='push'||process.env.GITHUB_REPOSITORY!=='FarpointEnergy/farpointenergy.com'||process.env.GITHUB_REF!=='refs/heads/codex/lead-intelligence-design-v1')throw Error('unexpected_workflow_identity');
  // Owner arms the exact observed GitHub run ID during this fixed bounded window.
  await new Promise(r=>setTimeout(r,180000));
  const authUrl=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  if(authUrl.protocol!=='https:'||!authUrl.hostname.endsWith('.actions.githubusercontent.com')||authUrl.username||authUrl.password)throw Error('invalid_official_token_endpoint');
  authUrl.searchParams.set('audience','urn:farpoint:store01:'+runUuid);
  const tokenResponse=await fetch(authUrl,{headers:{Authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(20000)});
  if(!tokenResponse.ok)throw Error('oidc_request_failed');const payload=await tokenResponse.json();const jwt=payload.value;
  if(typeof jwt!=='string'||jwt.length>16384||jwt.split('.').length!==3)throw Error('invalid_oidc_response');
  const claims=JSON.parse(Buffer.from(jwt.split('.')[1],'base64url').toString('utf8'));
  const config={FARPOINT_STORE01_OIDC_ENABLED:'1',FARPOINT_STORE01_OIDC_REPOSITORY_ID:'1367815671',FARPOINT_STORE01_OIDC_OWNER_ID:'328540327',FARPOINT_STORE01_OIDC_RUN_ID:process.env.GITHUB_RUN_ID,FARPOINT_STORE01_OIDC_WORKFLOW_SHA:process.env.GITHUB_SHA};
  const identity={job_workflow_ref_present:Object.hasOwn(claims,'job_workflow_ref'),job_workflow_sha_present:Object.hasOwn(claims,'job_workflow_sha'),job_workflow_ref_matches_pinned:claims.job_workflow_ref===STORE01_WORKFLOW,job_workflow_sha_matches_pinned:claims.job_workflow_sha===process.env.GITHUB_SHA,raw_claim_values_retained:false,raw_token_retained:false};
  identity.local_verifier_passed=await verifyStore01GithubOidc(new Request('https://identity-check.example.invalid',{headers:{Authorization:'Bearer '+jwt}}),config,{id:runUuid,day:new Date().toISOString().slice(0,10)});
  await save('identity-preflight.json',identity);if(!identity.local_verifier_passed)throw Error('oidc_local_preflight_failed');
  // Exactly one authenticated maintenance request, no retry after any response/loss.
  posted=true;const response=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+jwt,'Content-Type':'application/json'},body:'',redirect:'error',signal:AbortSignal.timeout(30000)});
  const raw=Buffer.from(await response.arrayBuffer());await save('response.bin',raw);
  const receipt={...evidence,finished_at:new Date().toISOString(),http_status:response.status,response_headers:Object.fromEntries(response.headers),body_bytes:raw.length,body_sha256:createHash('sha256').update(raw).digest('hex')};await save('response-metadata.json',receipt);
  const proof=JSON.parse(raw.toString('utf8'));if(response.status!==200||proof.status!=='pass'||proof.run_id!==runUuid||proof.successful_new_objects!==2||proof.rejected_conditional_collisions!==1||proof.old_object_unchanged!==true||proof.unsupported_body_schema_retained!==true)throw Error('maintenance_proof_not_pass');
  await save('result.json',{status:'PASS',one_post_only:true,synthetic_run:runUuid,github_run_id:process.env.GITHUB_RUN_ID});console.log('Synthetic STORE01 authenticated maintenance proof passed.');
}catch(error){await save('failure.json',{status:'FAIL',at:new Date().toISOString(),post_attempted:posted,no_retry:true,reason:['unexpected_workflow_identity','invalid_official_token_endpoint','oidc_request_failed','invalid_oidc_response','oidc_local_preflight_failed','maintenance_proof_not_pass'].includes(error.message)?error.message:'operation_failed_no_credentials_logged'});throw Error('store01_failed_see_retained_safe_evidence');}
