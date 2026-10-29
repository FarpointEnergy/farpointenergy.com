import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {runLeadPipeline, verifyRemoteRun, evaluateWatchdog, workJSON, workHash, WorkFailure} from '../pipeline.mjs';

// Inject failures at real orchestration boundaries, keeping all simulated remote
// objects append-only across the failed attempt and the later full rescan.
// These are fault-injection integration checks, not provider outage claims.
const at='2026-10-27T04:00:00.000Z';
const later='2026-10-27T05:00:00.000Z';
const job={id:'synthetic-operations',version:'1',scope_id:'synthetic-only',kind:'report'};
const config={job,window_start:'2026-10-26T00:00:00.000Z',window_end:'2026-10-27T00:00:00.000Z'};
const expected={...config,start:'2026-10-27T03:59:00.000Z',end:'2026-10-27T04:01:00.000Z'};
const failures={
  expired_authorization:{reason:'synthetic_authorization_expired',stage:'source'},
  drive_outage:{reason:'synthetic_drive_unavailable',stage:'archive'},
  provider_quota:{reason:'synthetic_quota_exhausted',stage:'source'},
  bad_schema:{reason:'invalid_collector_page',stage:'source'},
  python_interrupted:{reason:'synthetic_python_interrupted',stage:'analysis'},
  missing_dependency:{reason:'synthetic_dependency_missing',stage:'analysis'}
};
const decode=bytes=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));

function environment(){
  const remote=new Map(), names=new Map(), attempts=new Map();let next=0;
  const source=new Map(Array.from({length:3},(_,i)=>[
    `receipts/2026/10/${String(24+i)}/synthetic-ops-${i}.json`,
    workJSON({synthetic:true,retained_value:i})
  ]));
  const baseDrive={
    assertPrivate:async()=>({verified:true,owner_only:true,evidence_refs:['synthetic:owner-scope']}),
    create:async(name,bytes)=>{const id=`remote-${++next}`;remote.set(id,bytes.slice());names.set(id,name);return{id,url:`https://example.test/${id}`};},
    read:async id=>remote.get(id)?.slice()
  };
  async function run(runId,{fault=null,now=at}={}){
    const local=new Map();attempts.set(runId,local);
    const collector={
      list:async({namespace,cursor})=>{
        if(fault==='expired_authorization')throw new WorkFailure('synthetic_authorization_expired');
        if(fault==='provider_quota')throw new WorkFailure('synthetic_quota_exhausted');
        if(fault==='bad_schema')return {export_format_version:999};
        assert.equal(cursor,null);
        const rows=[...source].filter(([key])=>key.startsWith(namespace+'/'));
        return {export_format_version:1,namespace,items:await Promise.all(rows.map(async([key,bytes])=>({key,size:bytes.length,sha256:await workHash(bytes)}))),enumeration_complete:true,next_cursor:null,transactional_snapshot:false};
      },
      chunk:async({key,offset,max_bytes})=>{const bytes=source.get(key),part=bytes.slice(offset,offset+max_bytes);return {export_format_version:1,key,encoding:'base64',offset,bytes:part.length,object_size:bytes.length,object_sha256:await workHash(bytes),body_base64:Buffer.from(part).toString('base64'),next_offset:offset+part.length,object_complete:offset+part.length===bytes.length};}
    };
    const drive={...baseDrive,create:async(name,bytes)=>{
      if(fault==='drive_outage'&&!name.endsWith('-started.json'))throw new WorkFailure('synthetic_drive_unavailable');
      return baseDrive.create(name,bytes);
    }};
    const analyze=async({config:cfg})=>{
      if(fault==='python_interrupted')throw new WorkFailure('synthetic_python_interrupted');
      if(fault==='missing_dependency')throw new WorkFailure('synthetic_dependency_missing');
      const complete=Object.values(cfg.source_completeness).every(x=>x===true);
      return {report:{...config,status:complete?'complete':'incomplete',observation_cutoff:now,traffic:{sessions:0},mail_counts:{received_inquiries:0},stage_reach:{},warnings:complete?[]:['Synthetic source failure; zero is not healthy traffic.']},artifacts:[{name:'synthetic-analysis-input.json',bytes:workJSON({source_completeness:cfg.source_completeness})}]};
    };
    const result=await runLeadPipeline({runId,config,collector,drive,analyze,mail:{list:async()=>({message_ids:[],next_cursor:null,enumeration_complete:true})},classify:async()=>({complete:true,observations:[],evidence_refs:['synthetic:no-mail'],review_metadata:{}}),journal:{create:async(path,bytes)=>{assert(!local.has(path),'prior local evidence must remain');local.set(path,bytes.slice());}},now:()=>now});
    return {result,local};
  }
  return {remote,names,source,attempts,run,drive:baseDrive};
}

async function saveEvidence(name,value){
  const root=process.env.FARPOINT_TEST_EVIDENCE_DIR;
  if(!root)return;
  await mkdir(root,{recursive:true});
  await writeFile(join(root,`${name}-${crypto.randomUUID()}.json`),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
}

for(const [fault,expectedFault] of Object.entries(failures)){
  test(`operational ${fault}: retain failed attempt, withhold completion, full-rescan catch-up`,async()=>{
    const f=environment();
    const failed=await f.run(`synthetic-${fault}-failed`,{fault});
    assert.notEqual(failed.result.status,'complete');
    assert(![...f.names.values()].some(n=>n===`synthetic-${fault}-failed-completed.json`));
    assert(failed.local.size>0,'immutable local failure evidence');
    // A generic failure is insufficient: prove that this boundary actually
    // caused the failure, with no unrelated error masking a broken injection.
    const frozenConfig=decode(failed.local.get('inputs/config.json'));
    const rawPaths=[...failed.local.keys()].filter(path=>path.startsWith('raw/collector/'));
    let failureEvidence;
    if(expectedFault.stage==='source'){
      assert.equal(failed.result.status,'partial');
      assert.deepEqual(frozenConfig.source_completeness,{collector:false,mail:true,classifications:true});
      assert.deepEqual(failed.result.failures.map(({stage,reason})=>({stage,reason})),[
        {stage:'receipts',reason:expectedFault.reason},{stage:'rejections',reason:expectedFault.reason}
      ]);
      const report=decode(failed.local.get('report/report.json'));
      assert.equal(report.status,'incomplete');
      assert.equal(report.work_report.source_completeness.collector,false);
      assert.equal(report.traffic.sessions,0);
      assert(report.warnings.some(x=>x.includes('zero is not healthy traffic')));
      const manifest=decode(await f.drive.read(failed.result.manifest.id));
      assert.deepEqual(manifest.source_completeness,frozenConfig.source_completeness);
      assert.deepEqual(manifest.failures,failed.result.failures);
      const partial=decode(await f.drive.read(failed.result.completion.id));
      assert.equal(partial.state,'partial');
      assert.equal(partial.report_status,'incomplete');
      assert.equal(partial.source_completeness.collector,false);
      assert.equal(rawPaths.length,0,'source failed before any bytes were obtained');
      failureEvidence={source_completeness:manifest.source_completeness,failures:manifest.failures,partial};
    }else{
      assert.equal(failed.result.status,'failed');
      assert.equal(failed.result.reason,expectedFault.reason);
      assert.equal(failed.result.phase,expectedFault.stage);
      assert.deepEqual(frozenConfig.source_completeness,{collector:true,mail:true,classifications:true});
      assert.equal(rawPaths.length,3,'all acquired raw objects survive the failed attempt');
      for(const[key,bytes]of f.source)assert.deepEqual(failed.local.get('raw/collector/'+key),bytes);
      const recoveryRows=[...failed.local].filter(([path])=>path.startsWith('failure-recovery-'));
      assert.equal(recoveryRows.length,1);
      failureEvidence=decode(recoveryRows[0][1]);
      assert.equal(failureEvidence.reason,expectedFault.reason);
      assert.equal(failureEvidence.phase,expectedFault.stage);
      if(expectedFault.stage==='analysis'){
        assert(failed.result.failure_record?.id,'Drive remains available for failure evidence');
        assert.deepEqual(decode(await f.drive.read(failed.result.failure_record.id)),failureEvidence);
        assert.equal(failureEvidence.unarchived_local_files.length,0);
        const remoteRaw=failureEvidence.recovered_files.filter(x=>x.path.startsWith('raw/collector/'));
        assert.equal(remoteRaw.length,3,'analysis failure must still archive all raw objects');
        for(const[key,bytes]of f.source){
          const matches=remoteRaw.filter(x=>x.path==='raw/collector/'+key);
          assert.equal(matches.length,1);
          const ref=matches[0];
          assert.equal(ref.bytes,bytes.length);
          assert.equal(ref.sha256,await workHash(bytes));
          assert.deepEqual(await f.drive.read(ref.id),bytes,'partial remote artifact is exact original bytes');
          assert(failureEvidence.remote_observations.some(x=>x.id===ref.id&&x.verified===true));
        }
      }else{
        assert.equal(failed.result.failure_record,null,'Drive outage cannot invent a remote failure receipt');
        assert.equal(failureEvidence.recovered_files.length,0);
        for(const path of rawPaths)assert(failureEvidence.unarchived_local_files.includes(path));
        assert(failureEvidence.ambiguous_remote_creates.some(x=>x.reason===expectedFault.reason));
      }
    }
    const retained=await Promise.all([...f.remote].map(async([id,b])=>({id,sha256:await workHash(b)})));
    const failedCompletionIds=failed.result.completion?.id?[failed.result.completion.id]:[];
    const before=await evaluateWatchdog({expectedIntervals:[expected],completionIds:failedCompletionIds,drive:f.drive,now:later,canary:{status:'unverified'}});
    assert.equal(before.status,'warning');assert.equal(before.missed_intervals.length,1);
    const recovered=await f.run(`synthetic-${fault}-catchup`,{now:later});
    assert.equal(recovered.result.status,'complete');
    const verification=await verifyRemoteRun({completionId:recovered.result.completion.id,drive:f.drive});
    assert.equal(verification.full_content_verification,true);
    for(const[key,bytes]of f.source)assert.deepEqual(recovered.local.get('raw/collector/'+key),bytes);
    for(const row of retained)assert.equal(await workHash(f.remote.get(row.id)),row.sha256,'later recovery must not change old remote evidence');
    const after=await evaluateWatchdog({expectedIntervals:[expected],completionIds:[...failedCompletionIds,recovered.result.completion.id],drive:f.drive,now:later,canary:{status:'verified'}});
    // A later full rescan restores data completeness, but cannot rewrite the
    // fact that the original scheduled interval was missed.
    assert.equal(after.status,'warning');assert.equal(after.missed_intervals.length,1);
    await saveEvidence(`operations-${fault}`,{scope:'synthetic_adapter_fault_injection',fault,expected_categorical_fault:expectedFault,failed:failed.result,failure_evidence:failureEvidence,failed_attempt_retained_raw_objects:rawPaths.length,catchup:recovered.result,before,after,retained_remote_objects:retained,source_objects:f.source.size,verified_full_rescan:true});
  });
}

test('both tasks absent: later check preserves two missed intervals and recovered source completeness',async()=>{
  const f=environment();
  const second={...expected,start:'2026-10-27T04:10:00.000Z',end:'2026-10-27T04:11:00.000Z'};
  const gap=await evaluateWatchdog({expectedIntervals:[expected,second],completionIds:[],drive:f.drive,now:later,canary:{status:'unverified'}});
  assert.equal(gap.missed_intervals.length,2);assert.equal(gap.archive_lag_seconds,null);assert.match(gap.warning,/Work-wide outage/);
  const caught=await f.run('synthetic-common-outage-catchup',{now:later});
  assert.equal(caught.result.status,'complete');
  const recovered=await verifyRemoteRun({completionId:caught.result.completion.id,drive:f.drive});
  assert.deepEqual(recovered.manifest.source_completeness,{collector:true,mail:true,classifications:true});
  const after=await evaluateWatchdog({expectedIntervals:[expected,second],completionIds:[caught.result.completion.id],drive:f.drive,now:later,canary:{status:'verified'}});
  assert.equal(after.missed_intervals.length,2);assert.equal(after.archive_lag_seconds,0);
  await saveEvidence('operations-common-outage',{scope:'synthetic_schedule_state_injection',gap,after,catchup:caught.result,verified_full_rescan:true});
});

test('zero organic traffic cannot make a failed or unverified canary healthy',async()=>{
  const f=environment();const good=await f.run('synthetic-healthy-zero');
  assert.equal(good.result.status,'complete');
  const common={expectedIntervals:[expected],completionIds:[good.result.completion.id],drive:f.drive,now:at};
  const healthy=await evaluateWatchdog({...common,canary:{status:'verified'}});
  const failed=await evaluateWatchdog({...common,canary:{status:'failed'}});
  const unknown=await evaluateWatchdog({...common,canary:{status:'unverified'}});
  assert.equal(healthy.status,'healthy');assert.equal(failed.status,'warning');assert.equal(unknown.status,'warning');
  await saveEvidence('operations-false-zero',{scope:'synthetic_canary_status_injection',healthy,failed,unknown});
});
