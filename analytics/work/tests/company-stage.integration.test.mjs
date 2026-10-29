/* Cross-language test: real pinned reader, Python stage/replay and analysis.
 * Remote storage is a declared local filesystem simulation; no network calls,
 * purchased data, actual owner approval or production activation occur. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdir,mkdtemp,writeFile,readFile,open} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createCompanyAnalyzer,createCompanyStageHost} from '../company-stage.mjs';
import {createWorkHostBridge} from '../host-bridge.mjs';

const repo=resolve(dirname(fileURLToPath(import.meta.url)),'../../..');
const reader=process.env.FARPOINT_DBIP_READER_SDIST;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function exactWrite(path,bytes){await mkdir(dirname(path),{recursive:true});const f=await open(path,'wx',0o600);try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}assert.deepEqual(await readFile(path),Buffer.from(bytes));return path;}

// Mimic only the exec/hidden-stdin surface. Every command, input and exact
// stdout/stderr is retained under this synthetic test's unique private root.
function localTools(root){
  const active=new Map(),stats={requests:0,result_chunks:0},records=[];
  return {stats,records,
    exec_command:async({cmd})=>{
      const match=/^python3 (\/[A-Za-z0-9_./-]+) --root (\/[A-Za-z0-9_./-]+) --repository (\/[A-Za-z0-9_./-]+)$/.exec(cmd);
      assert(match);assert.equal(match[3],repo);assert([repo+'/analytics/work/company_stage.py',repo+'/analytics/work/local_bridge.py'].includes(match[1]));assert(match[2].startsWith(root+'/'));
      const id=randomUUID(),child=spawn('python3',[match[1],'--root',match[2],'--repository',match[3]],{stdio:['pipe','pipe','pipe']});
      const record={id,command:cmd,stdout:[],stderr:[],input:null};records.push(record);
      const state={child,record,ready:null,finished:null};active.set(id,state);
      state.finished=new Promise((accept,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>accept({code,signal}));});state.finished.catch(()=>{});
      state.ready=new Promise((accept,reject)=>{child.stdout.on('data',bytes=>{record.stdout.push(bytes);if(Buffer.concat(record.stdout).includes('READY\n'))accept();});child.once('error',reject);child.once('close',()=>{if(!Buffer.concat(record.stdout).includes('READY\n'))reject(Error('missing_ready'));});});
      child.stderr.on('data',bytes=>record.stderr.push(bytes));await state.ready;
      return {session_id:id,output:'READY\n'};
    },
    write_stdin:async({session_id,chars})=>{
      const state=active.get(session_id);assert(state);assert.equal(state.record.input,null);assert(chars.endsWith('\n'));
      state.record.input=Buffer.from(chars);const request=JSON.parse(chars);stats.requests++;if(request.op==='read_result')stats.result_chunks++;
      state.child.stdin.end(chars);const done=await state.finished;active.delete(session_id);
      const stdout=Buffer.concat(state.record.stdout),stderr=Buffer.concat(state.record.stderr),prefix=root+'/rpc/'+session_id;
      await exactWrite(prefix+'.request.json',state.record.input);await exactWrite(prefix+'.stdout',stdout);await exactWrite(prefix+'.stderr',stderr);await exactWrite(prefix+'.status.json',Buffer.from(JSON.stringify(done)));
      return {output:stdout.toString().replace(/^READY\r?\n/,''),exit_code:done.code};
    }
  };
}

test('real JS/Python optional chain archives and replays before numerical analysis',{skip:!reader,timeout:120000},async()=>{
  const parent=process.env.FARPOINT_PRIVATE_TEST_EVIDENCE||resolve(repo,'..','farpoint-company-stage-tests');await mkdir(parent,{recursive:true});
  const root=await mkdtemp(resolve(parent,'integration-')),privateRoot=root+'/private';await mkdir(privateRoot);
  const fixtureCode="import sys,json,pathlib;sys.path.insert(0,sys.argv[1]+'/analytics/work/tests');from test_company_stage import request_fixture;p=pathlib.Path(sys.argv[2]);r=request_fixture(p);(p/'fixture.json').write_text(json.dumps(r))";
  const generated=spawnSync('python3',['-c',fixtureCode,repo,root],{env:process.env,encoding:'utf8'});
  await exactWrite(root+'/fixture-generator.stdout',Buffer.from(generated.stdout??''));await exactWrite(root+'/fixture-generator.stderr',Buffer.from(generated.stderr??''));assert.equal(generated.status,0,generated.stderr);
  const fixture=JSON.parse(await readFile(root+'/fixture.json','utf8')),tools=localTools(root),local=createWorkHostBridge({tools,privateRoot,repositoryRoot:repo});
  const simulatedRemote=new Map(),events=[];
  for(const row of fixture.artifacts)simulatedRemote.set(fixture.provider_config[row.key].id,row.path);
  const proof=fixture.provenance_evidence[0];simulatedRemote.set('synthetic-private-proof',proof.path);
  const drive={
    assertPrivate:async()=>{events.push('simulated_owner_private');return {verified:true,owner_only:true};},
    createFile:async(name,{path})=>{const id='synthetic-created-'+randomUUID(),copy=root+'/simulated-remote/'+id;await exactWrite(copy,await readFile(path));simulatedRemote.set(id,copy);events.push('simulated_upload');return {id,url:'https://example.invalid/'+id};},
    verifyFile:async(id,spec)=>{const bytes=await readFile(simulatedRemote.get(id));assert.equal(bytes.length,spec.bytes);assert.equal(hash(bytes),spec.sha256);const copy=await exactWrite(root+'/downloads/'+randomUUID(),bytes);events.push('simulated_download');return {verified:true,id,bytes:bytes.length,sha256:hash(bytes),path:copy};}
  };
  const provider=fixture.provider_config,sources=fixture.source_bindings,provenances=[{id:'synthetic-private-proof',ref:proof.ref,bytes:proof.bytes,sha256:proof.sha256}];
  const objects=fixture.receipts.map((row,i)=>({namespace:'receipts',key:'synthetic/receipt-'+i,local_path:row.path,size:row.bytes,sha256:row.sha256}));
  const original=objects.map(row=>({path:row.local_path,bytes:readFileSync(row.local_path)}));
  let analyzed=null;
  const delegate={...local,analyze:async input=>{events.push('numerical_analysis');analyzed=input;return local.analyze(input);}};
  const analyzer=createCompanyAnalyzer({tools,local:delegate,settings:{archive_folder_id:'synthetic-local-only'},privateRoot,repositoryRoot:repo,codeCommit:fixture.code_commit,providerConfig:provider,sourceBindings:sources,provenanceArtifacts:provenances,makeAdapters:()=>({drive})});
  const input={objects,captures:[],classifications:[],config:{...fixture.config,local_write_mode:'bounded_batches_v1'},companyObservations:[],readLocal:path=>new Uint8Array(readFileSync(path))};
  const result=await analyzer(input);assert.equal(result.report.status,'complete');assert.equal(analyzed.companyObservations.length,1);assert.equal(analyzed.companyObservations[0].identity_category,'possible_corporate_match');assert.equal(analyzed.companyObservations[0].employer,null);
  const verification=JSON.parse(Buffer.from(result.artifacts.find(x=>x.name==='company-stage-verification.json').bytes));assert.equal(verification.status,'verified');assert.equal(verification.verification.observations_match,true);assert.equal(verification.verification.offline_reader_artifact_used,true);assert.equal(verification.verified_employers,0);
  assert(events.indexOf('simulated_upload')<events.lastIndexOf('simulated_download'));assert.equal(events.at(-1),'numerical_analysis');assert(tools.stats.result_chunks>0,'actual bounded RPC chunks were exercised');
  for(const row of original)assert.deepEqual(readFileSync(row.path),row.bytes);
  for(const artifact of result.artifacts)await exactWrite(root+'/analysis-return/'+artifact.name,artifact.bytes);
  await exactWrite(root+'/summary.json',Buffer.from(JSON.stringify({status:'PASS',scope:'Synthetic-only real JS/Python/reader/archive/replay/analysis; filesystem simulated Drive, placeholder fixture commit, no actual remote or purchased-dataset claim',events,company_observations:analyzed.companyObservations.length,verified_employers:0,rpc:tools.stats,archive:verification.archive,report_sha256:hash(Buffer.from(JSON.stringify(result.report))),source_inputs_unchanged:true},null,2)));
  console.log('Company stage integration evidence:',root);
});

test('bounded host rejects changed chunk bytes rather than interpreting truncated output',async()=>{
  const result=Buffer.from(JSON.stringify({status:'ok',result:{synthetic:'é'.repeat(20000)}}));let next=0;
  const tools={exec_command:async()=>({session_id:++next,output:'READY\n'}),write_stdin:async({chars})=>{
    const req=JSON.parse(chars);if(req.op!=='read_result')return {output:JSON.stringify({status:'ok',result_stream:{path:'bridge-results/11111111-1111-4111-8111-111111111111.json',encoding:'utf-8-json',bytes:result.length,sha256:hash(result)}})};
    const bytes=result.subarray(req.offset,req.offset+8192);return {output:JSON.stringify({status:'ok',path:req.path,offset:req.offset,total_bytes:result.length,bytes:bytes.length,base64:bytes.toString('base64'),sha256:'0'.repeat(64)})};
  }};
  await assert.rejects(()=>createCompanyStageHost({tools,privateRoot:'/private/company',repositoryRoot:'/repository/company'}).run({synthetic:true}),error=>error.code==='company_stage_chunk_mismatch');
});

test('generated Work bundle exposes the optional stage without activating it',async()=>{
  const source=await readFile(repo+'/analytics/work/work.bundle.js','utf8');
  const api=new Function('entropyBase64',source)(Buffer.alloc(32,7).toString('base64'));
  assert.equal(typeof api.createCompanyStageHost,'function');assert.equal(typeof api.createCompanyAnalyzer,'function');assert.equal(api.COMPANY_STAGE_VERSION,'farpoint-work-company-stage/1.0.0');
  const input={config:{},companyObservations:[{synthetic:true,provider:'IPtoASN'}]};let actual=null;
  const analyze=api.createCompanyAnalyzer({local:{analyze:async value=>{actual=value;return {unchanged:true};}},makeAdapters:()=>{throw Error('No disabled connector calls');}});
  assert.deepEqual(await analyze(input),{unchanged:true});assert.equal(actual,input);
});
