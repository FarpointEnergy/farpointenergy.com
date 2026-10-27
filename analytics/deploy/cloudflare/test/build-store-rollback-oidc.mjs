import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
const [basePath,destination]=process.argv.slice(2);
if(!isAbsolute(basePath||'')||!isAbsolute(destination||''))throw Error('Absolute base and private output paths required');
const here=dirname(fileURLToPath(import.meta.url)),base=await readFile(basePath,'utf8');
const original=await readFile(resolve(here,'store-rollback-probe.mjs'),'utf8'),oidc=await readFile(resolve(here,'store-rollback-oidc.mjs'),'utf8');
const hash=x=>createHash('sha256').update(x).digest('hex');
const oldGate="typeof token!=='string'||token.length<32||request.headers.get('authorization')!=='Bearer '+token";
if(original.split(oldGate).length!==2)throw Error('Reviewed helper auth anchor changed');
const helper=original.replace('    if(url.pathname!==path)return null;',"    const authOnly=url.pathname===path+'/auth';\n    if(url.pathname!==path&&!authOnly)return null;")
  .replace('    const token=env.FARPOINT_STORE01_TOKEN;','    const authTrace={};')
  .replace("request.method!=='POST'","(authOnly?request.method!=='GET':request.method!=='POST')")
  .replace(oldGate,'!(await verifyStore01GithubOidc(request,env,run,{trace:authTrace}))')
  .replace("return response({error:'not_found'},404);","return response({error:'not_found',auth_check:authTrace},404);\n    if(authOnly)return response({status:'verified',auth_check:authTrace,no_storage_access:true});");
const id=randomUUID(),day=new Date().toISOString().slice(0,10),origin='https://farpoint-lead-collector-candidate.farpointenergy.workers.dev';
const run={id,day,origin,ids:['store01-'+id+'-a','store01-'+id+'-b'],bodies:[JSON.stringify({schema_version:1,synthetic:true,acceptance_case:'STORE-01',run_id:id,kind:'seed'}),JSON.stringify({schema_version:999,synthetic:true,acceptance_case:'RELEASE-02',run_id:id,kind:'future_schema_forward_data',payload:'Synthetic future schema remains exact after compatible code restoration.'})]};
const marker='    const probe = await createSyntheticIpProbe({sourceVersion: BUILD_SOURCE_VERSION})(request, env);';
if(base.split(marker).length!==2||base.split('export default {').length!==2)throw Error('Base wrapper changed');
const baseVersion=(base.match(/^const BUILD_SOURCE_VERSION = (.+);$/m)||[])[1];if(!baseVersion)throw Error('Missing source identity');
const sourceHash=hash(base+'\0'+original+'\0'+oidc+'\0'+JSON.stringify(run)),version='farpoint-store-rollback-oidc/1.0.0+'+sourceHash;
const source=base.replace(/^const BUILD_SOURCE_VERSION = .+;$/m,'const BUILD_SOURCE_VERSION = '+JSON.stringify(version)+';').replace('export default {',oidc+'\n'+helper+'\nconst STORE01_RUN = '+JSON.stringify(run)+';\nexport default {').replace(marker,'    const storeProof = await createStoreRollbackProbe({run:STORE01_RUN,sourceVersion:BUILD_SOURCE_VERSION,createCollector,R2CreateOnlyStore,sha256})(request,env);\n    if(storeProof)return storeProof;\n'+marker);
const manifest={created_at:new Date().toISOString(),scope:'Candidate-only one-run GitHub OIDC identity; fixed synthetic collision; no deployment by builder',base_worker_sha256:hash(base),base_source_version:JSON.parse(baseVersion),original_helper_sha256:hash(original),oidc_source_sha256:hash(oidc),worker_sha256:hash(source),worker_bytes:Buffer.byteLength(source),source_version:version,run,expected_body_sha256:run.bodies.map(hash),required_environment:{FARPOINT_STORE01_ENABLED:'1',FARPOINT_STORE01_OIDC_ENABLED:'1',FARPOINT_STORE01_OIDC_REPOSITORY_ID:'exact numeric GitHub repository ID',FARPOINT_STORE01_OIDC_OWNER_ID:'exact numeric GitHub owner ID',FARPOINT_STORE01_OIDC_RUN_ID:'exact dispatched GitHub run ID',FARPOINT_STORE01_OIDC_WORKFLOW_SHA:'exact reviewed40hex workflow/source commit'},audience:'urn:farpoint:store01:'+id,successful_new_object_limit:2,conditional_put_attempts_on_success:3,public_export_enabled:false,no_static_secret:true};
await mkdir(destination,{recursive:true});const output=resolve(destination,'store-rollback-oidc-'+sourceHash+'.mjs'),manifestPath=output.replace(/\.mjs$/,'.manifest.json');
await writeFile(output,source,{flag:'wx'});await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({output,manifest:manifestPath,worker_sha256:manifest.worker_sha256,worker_bytes:manifest.worker_bytes,run_id:id,run_day:day,audience:manifest.audience}));
