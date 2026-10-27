import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeTrace,TRACE_CATEGORIES} from './performance-trace.mjs';

const main=(pid=1,tid=10)=>({ph:'M',name:'thread_name',pid,tid,args:{name:'CrRendererMain'}});
const task=(ts,dur,extra={})=>({ph:'X',name:'RunTask',cat:'disabled-by-default-devtools.timeline',pid:1,tid:10,ts,dur,...extra});
const call=(ts,dur,url='https://example.test/tracker.js?v=abc',extra={})=>({ph:'X',name:'FunctionCall',pid:1,tid:10,ts,dur,args:{data:{url,functionName:'record',lineNumber:91,columnNumber:1}},...extra});
const profile=(ts=0,extra={})=>({ph:'P',name:'Profile',pid:1,tid:10,ts,id:'0x1',args:{data:{startTime:999999999}},...extra});
const chunk=(nodes,samples,timeDeltas,extra={})=>({ph:'P',name:'ProfileChunk',pid:1,tid:99,ts:900000,id:'0x1',args:{data:{cpuProfile:{nodes,samples},timeDeltas}},...extra});
const node=(id,url,parent)=>({id,callFrame:{url,functionName:id===1?'(root)':'flush',lineNumber:10,columnNumber:2,scriptId:'1'},...(parent===undefined?{}:{parent})});
const names=result=>result.issues.map(issue=>issue.code);
const unrelatedLongTrace=sampleTimes=>[main(),task(0,90000),call(100,80000,'https://example.test/unrelated.js'),task(100000,12000),call(101000,1000),profile(),chunk([node(1,'unrelated.js')],sampleTimes.map(()=>1),sampleTimes.map((time,index)=>time-(sampleTimes[index-1]||0)))];

test('current trace attributes enclosing task, not only its small tracker call',()=>{
  const result=analyzeTrace({traceEvents:[main(),task(100,60000),call(1000,1000)]});
  assert.equal(result.assessment,'FAIL');assert.equal(result.maxTrackerTaskMs,60);
  assert.equal(result.trackerLongTasks.length,1);
  assert.equal(result.trackerTasks[0].trackerEvidence[0].eventIndex,2);
  assert.equal(result.trackerTasks[0].trackerEvidence[0].frames[0].url,'https://example.test/tracker.js?v=abc');
});

test('unrelated long task remains visible but does not fail tracker cost',()=>{
  const result=analyzeTrace(unrelatedLongTrace(Array.from({length:89},(_,index)=>(index+1)*1000)),{requireCpuSamples:true});
  assert.equal(result.assessment,'PASS');assert.equal(result.maxMainTaskMs,90);
  assert.equal(result.maxTrackerTaskMs,12);assert.equal(result.mainTasks.length,2);
  assert.equal(result.mainTasks[0].sampledCoverage.sufficient,true);
  assert.equal(result.mainTasks[0].sampledCoverage.maxGapMs,1);
  assert.equal(result.mainTasks[0].sampledCoverage.samples[88].chunkEventIndex,6);
  assert.equal(result.mainTasks[0].sampledCoverage.samples[88].sampleIndex,88);
  assert.equal(result.mainTasks[0].sampledCoverage.samples[88].ts,89000);
});

test('one unrelated sample cannot exclude the remaining 89 ms of a long task',()=>{
  const result=analyzeTrace(unrelatedLongTrace([1000]),{requireCpuSamples:true});
  assert.equal(result.assessment,'UNKNOWN');assert(names(result).includes('insufficient_long_task_sample_coverage'));
  assert.equal(result.coverage.mappedCpuSamples,1);
  assert.equal(result.mainTasks[0].sampledCoverage.maxGapMs,89);
  assert.deepEqual(result.mainTasks[0].sampledCoverage.largestGap,{startUs:1000,endUs:90000,durationMs:89});
});

test('sampled exclusions require bounded gaps at task start, middle and end',()=>{
  const dense=Array.from({length:89},(_,index)=>(index+1)*1000);
  const cases=[dense.filter(time=>time>=6000),dense.filter(time=>time<=40000||time>=46000),dense.filter(time=>time<=84000)];
  for(const times of cases){
    const result=analyzeTrace(unrelatedLongTrace(times),{requireCpuSamples:true});
    assert.equal(result.assessment,'UNKNOWN');assert.equal(result.mainTasks[0].sampledCoverage.maxGapMs,6);
    assert.equal(result.mainTasks[0].sampledCoverage.sufficient,false);
  }
});

test('sampling quality uses the explicit 5 ms bound and rejects a larger gap',()=>{
  const times=Array.from({length:17},(_,index)=>(index+1)*5000);
  const allowed=analyzeTrace(unrelatedLongTrace(times));
  assert.equal(allowed.assessment,'PASS');assert.equal(allowed.maxSampleGapMs,5);
  assert.equal(allowed.mainTasks[0].sampledCoverage.maxGapMs,5);
  assert.equal(analyzeTrace(unrelatedLongTrace(times),{maxSampleGapMs:4}).assessment,'UNKNOWN');
  const gap=[...times];gap[0]=5000.1;
  assert.equal(analyzeTrace(unrelatedLongTrace(gap)).assessment,'UNKNOWN');
});

test('duplicate samples and unmapped native stacks do not fill temporal coverage',()=>{
  const duplicates=analyzeTrace(unrelatedLongTrace(Array(90).fill(1000)));
  assert.equal(duplicates.assessment,'UNKNOWN');assert.equal(duplicates.mainTasks[0].mappedCpuSampleCount,90);
  assert.equal(duplicates.mainTasks[0].sampledCoverage.uniqueSampleTimestamps,1);
  const events=unrelatedLongTrace([]);
  events[6]=chunk([node(1,'unrelated.js'),node(2,'')],Array.from({length:89},(_,i)=>i===0?1:2),Array(89).fill(1000));
  const unmapped=analyzeTrace(events);
  assert.equal(unmapped.assessment,'UNKNOWN');assert.equal(unmapped.mainTasks[0].mappedCpuSampleCount,1);
  assert.equal(unmapped.mainTasks[0].sampledCoverage.maxGapMs,89);
});

test('non-string CPU frame URLs cannot manufacture dense mapped coverage',()=>{
  for(const url of [1,true,{},[],null]){
    const events=unrelatedLongTrace(Array.from({length:89},(_,index)=>(index+1)*1000));
    events[6].args.data.cpuProfile.nodes[0].callFrame.url=url;
    const result=analyzeTrace(events,{requireCpuSamples:true});
    assert.equal(result.assessment,'UNKNOWN');assert(names(result).includes('invalid_profile_node'));
    assert.equal(result.coverage.mappedCpuSamples,0);
    assert.equal(result.mainTasks[0].sampledCoverage.sufficient,false);
  }
});

test('CPU call frames must be objects while absent URLs remain valid unmapped samples',()=>{
  for(const callFrame of [[],null,1,'tracker.js']){
    const result=analyzeTrace([main(),task(0,1000),call(1,10),profile(),chunk([{id:1,callFrame}],[1],[100])]);
    assert.equal(result.assessment,'UNKNOWN');assert(names(result).includes('invalid_profile_node'));
  }
  const result=analyzeTrace([main(),task(0,1000),call(1,10),profile(),chunk([{id:1,callFrame:{functionName:'(native)'}}],[1],[100])]);
  assert.equal(result.assessment,'PASS');assert.equal(result.coverage.cpuSamples,1);
  assert.equal(result.coverage.mappedCpuSamples,0);
});

test('50 ms is allowed and any measurable amount above it fails',()=>{
  assert.equal(analyzeTrace([main(),task(0,50000),call(1,5)]).assessment,'PASS');
  assert.equal(analyzeTrace([main(),task(0,50000.1),call(1,5)]).assessment,'FAIL');
});

test('only CrRendererMain threads count, including multiple renderer processes',()=>{
  const events=[main(),{ph:'M',name:'thread_name',pid:2,tid:10,args:{name:'WorkerThread'}},
    task(0,1000),call(10,100),task(0,100000,{pid:2}),call(10,100,'tracker.js',{pid:2}),
    main(3,20),task(2000,60000,{pid:3,tid:20}),call(2100,10,'tracker.js',{pid:3,tid:20})];
  const result=analyzeTrace(events);
  assert.equal(result.assessment,'FAIL');assert.equal(result.mainTasks.length,2);
  assert.equal(result.trackerLongTasks[0].pid,3);assert.equal(result.coverage.mainThreads.length,2);
});

test('missing source coverage or missing tracker execution is UNKNOWN, never pass',()=>{
  const noSource=analyzeTrace([main(),task(0,2000)]);
  assert.equal(noSource.assessment,'UNKNOWN');assert.equal(noSource.attributionSupported,false);
  assert(names(noSource).includes('missing_source_attribution'));
  const other=analyzeTrace([main(),task(0,2000),call(1,100,'site.js')]);
  assert.equal(other.assessment,'UNKNOWN');assert.equal(other.trackerObserved,false);
  assert(names(other).includes('tracker_execution_not_observed'));
});

test('baseline can omit tracker while preserving source and task coverage',()=>{
  const result=analyzeTrace([main(),task(0,60000),call(1,100,'site.js')],{expectTracker:false});
  assert.equal(result.assessment,'PASS');assert.equal(result.maxTrackerTaskMs,null);
  assert.equal(result.attributionSupported,true);assert.equal(result.trackerObserved,false);
});

test('resource URL alone is not evidence of script execution',()=>{
  const result=analyzeTrace([main(),task(0,60000),{ph:'I',name:'ResourceSendRequest',pid:1,tid:10,ts:1,args:{data:{url:'tracker.js'}}}]);
  assert.equal(result.assessment,'UNKNOWN');assert.equal(result.trackerObserved,false);
});

test('filename matching ignores query/hash but does not match other names or query strings',()=>{
  for(const url of ['https://example.test/tracker.js?x=1#fragment','/assets/tracker.js','tracker.js'])assert.equal(analyzeTrace([main(),task(0,2000),call(1,10,url)]).assessment,'PASS');
  for(const url of ['https://example.test/not-tracker.js','https://example.test/tracker.js.old','https://example.test/site.js?source=tracker.js'])assert.equal(analyzeTrace([main(),task(0,2000),call(1,10,url)]).assessment,'UNKNOWN');
});

test('nested synchronous stack attributes work, asynchronous causal stack does not',()=>{
  const event={ph:'I',name:'TimerInstall',pid:1,tid:10,ts:100,args:{data:{stackTrace:[{url:'tracker.js',functionName:'schedule'}],parent:{stackTrace:[{url:'other.js'}]}}}};
  assert.equal(analyzeTrace([main(),task(0,60000),event]).assessment,'FAIL');
  const asyncOnly={...event,args:{data:{parent:{stackTrace:[{url:'tracker.js'}]}}}};
  assert.equal(analyzeTrace([main(),task(0,60000),asyncOnly]).assessment,'UNKNOWN');
});

test('CPU sample parent stack attributes nested tracker work inside another script callback',()=>{
  const result=analyzeTrace([main(),task(0,70000),call(100,60000,'inquiry.js'),profile(),
    chunk([node(1,''),node(2,'tracker.js?version=1',1),node(3,'',2)],[3],[2000])],{requireCpuSamples:true});
  assert.equal(result.assessment,'FAIL');assert.equal(result.coverage.trackerCpuSamples,1);
  const evidence=result.trackerTasks[0].trackerEvidence[0];
  assert.equal(evidence.kind,'cpu_sample');assert.equal(evidence.ts,2000);
  assert.equal(evidence.profileEventIndex,3);assert.equal(evidence.chunkEventIndex,4);
  assert.equal(evidence.frames[0].nodeId,2);assert.equal(evidence.tid,10);
});

test('chunked profile uses Profile.ts clock, cumulative deltas and nodes added later',()=>{
  const result=analyzeTrace([main(),task(100000,10000),profile(100000),
    chunk([node(1,'')],[3],[1000]),chunk([node(2,'tracker.js',1),node(3,'',2)],[2],[2000])],{requireCpuSamples:true});
  assert.equal(result.assessment,'PASS');assert.equal(result.coverage.trackerCpuSamples,2);
  assert.deepEqual(result.trackerTasks[0].trackerEvidence.map(e=>e.ts),[101000,103000]);
});

test('CDP children-style node graph supports parent-stack attribution',()=>{
  const nodes=[{...node(1,''),children:[2]},{...node(2,'tracker.js'),children:[3]},node(3,'')];
  const result=analyzeTrace([main(),task(0,1000),profile(),chunk(nodes,[3],[100])]);
  assert.equal(result.assessment,'PASS');assert.equal(result.coverage.trackerCpuSamples,1);
});

test('malformed CPU profiles cannot silently pass on another valid script event',()=>{
  const variants=[
    chunk([node(1,'tracker.js')],[1],[1,2]),
    chunk([node(1,'tracker.js')],[999],[1]),
    chunk([node(1,'tracker.js',2),node(2,'',1)],[1],[1]),
    chunk([node(1,'tracker.js')],[1],[-1])
  ];
  for(const malformed of variants){const result=analyzeTrace([main(),task(0,1000),call(1,10),profile(),malformed]);assert.equal(result.assessment,'UNKNOWN');assert.equal(result.coverage.invalidCpuProfiles,1);}
});

test('requireCpuSamples refuses a trace that only captured script invocations',()=>{
  const result=analyzeTrace([main(),task(0,1000),call(1,10)],{requireCpuSamples:true});
  assert.equal(result.assessment,'UNKNOWN');assert(names(result).includes('missing_mapped_cpu_samples'));
});

test('data loss and missing renderer task metadata are UNKNOWN',()=>{
  const events=[main(),task(0,1000),call(1,10)];
  assert.equal(analyzeTrace({traceEvents:events,dataLossOccurred:true}).assessment,'UNKNOWN');
  assert.equal(analyzeTrace(events,{dataLossOccurred:true}).assessment,'UNKNOWN');
  assert.equal(analyzeTrace([task(0,1000),call(1,10)]).assessment,'UNKNOWN');
  assert.equal(analyzeTrace([main(),call(1,10)]).assessment,'UNKNOWN');
});

test('B/E events retain both raw indexes and nested task wrappers do not double count',()=>{
  const events=[main(),{ph:'B',name:'RunTask',pid:1,tid:10,ts:0},
    {ph:'B',name:'EvaluateScript',pid:1,tid:10,ts:10,args:{data:{url:'tracker.js'}}},
    {ph:'E',pid:1,tid:10,ts:30},{ph:'E',pid:1,tid:10,ts:1000},
    task(0,1000,{name:'ThreadControllerImpl::RunTask'})];
  const result=analyzeTrace(events);
  assert.equal(result.assessment,'PASS');assert.equal(result.mainTasks.length,1);
  assert.equal(result.mainTasks[0].endEventIndex,4);assert.equal(result.trackerTasks[0].trackerEvidence[0].endEventIndex,3);
});

test('unfinished execution, invalid durations and crossing tasks are UNKNOWN',()=>{
  const base=[main(),task(0,1000),call(1,10)];
  assert.equal(analyzeTrace([...base,{ph:'B',name:'FunctionCall',pid:1,tid:10,ts:10,args:{data:{url:'tracker.js'}}}]).assessment,'UNKNOWN');
  assert.equal(analyzeTrace([...base,task(2000,-1)]).assessment,'UNKNOWN');
  assert.equal(analyzeTrace([...base,task(500,1000)]).assessment,'UNKNOWN');
});

test('malformed execution durations are UNKNOWN even alongside valid tracker evidence',()=>{
  for(const name of ['FunctionCall','EvaluateScript','EvaluateModule'])for(const dur of [undefined,-1,NaN,Infinity,-Infinity,'1',null]){
    const malformed=call(20,dur,'tracker.js',{name});
    if(dur===undefined)delete malformed.dur;
    const result=analyzeTrace([main(),task(0,1000),call(1,10),malformed]);
    assert.equal(result.assessment,'UNKNOWN',`${name} duration ${String(dur)}`);
    assert(names(result).includes('invalid_execution_timing'));
    assert.equal(result.coverage.trackerSourceEvents,1);
  }
});

test('invalid main-thread execution timestamps cannot silently disappear',()=>{
  for(const name of ['FunctionCall','EvaluateScript','EvaluateModule'])for(const ts of [undefined,-1,NaN,Infinity,'20',null]){
    const malformed=call(ts,10,'other.js',{name});
    if(ts===undefined)delete malformed.ts;
    const result=analyzeTrace([main(),task(0,1000),call(1,10),malformed]);
    assert.equal(result.assessment,'UNKNOWN',`${name} timestamp ${String(ts)}`);
    assert(names(result).includes('invalid_execution_timing'));
  }
});

test('explicit zero-length execution is valid but malformed source-stack timing is not',()=>{
  assert.equal(analyzeTrace([main(),task(0,1000),call(0,0)]).assessment,'PASS');
  const badStack={ph:'X',name:'TimerFire',pid:1,tid:10,ts:100,args:{data:{stackTrace:[{url:'tracker.js'}]}}};
  assert.equal(analyzeTrace([main(),task(0,1000),call(1,10),badStack]).assessment,'UNKNOWN');
  assert.equal(analyzeTrace([main(),task(0,1000),call(1,10),{...badStack,ph:'I',ts:NaN}]).assessment,'UNKNOWN');
  // A valid other thread's malformed duration is not page execution evidence.
  assert.equal(analyzeTrace([main(),task(0,1000),call(1,10),call(20,-1,'tracker.js',{pid:2,tid:20})]).assessment,'PASS');
});

test('missing or malformed process/thread identity cannot join into a pass',()=>{
  for(const field of ['pid','tid'])for(const value of [undefined,-1,NaN,Infinity,'1',null]){
    const events=[main(),task(0,1000),call(1,10)].map(event=>({...event,[field]:value}));
    if(value===undefined)for(const event of events)delete event[field];
    const result=analyzeTrace(events);
    assert.equal(result.assessment,'UNKNOWN');assert(names(result).includes('invalid_thread_identity'));
  }
  const missingBoth=[main(),task(0,1000),call(1,10)].map(({pid,tid,...rest})=>rest);
  assert.equal(analyzeTrace(missingBoth).assessment,'UNKNOWN');
  const missingTask=task(2000,1000);delete missingTask.tid;
  assert.equal(analyzeTrace([main(),task(0,1000),call(1,10),missingTask]).assessment,'UNKNOWN');
});

test('negative task/profile clocks and overflowing durations are UNKNOWN',()=>{
  const base=[main(),task(0,1000),call(1,10)];
  assert.equal(analyzeTrace([...base,task(-1,1)]).assessment,'UNKNOWN');
  assert.equal(analyzeTrace([...base,task(Number.MAX_VALUE,Number.MAX_VALUE)]).assessment,'UNKNOWN');
  assert.equal(analyzeTrace([...base,call(Number.MAX_VALUE,Number.MAX_VALUE)]).assessment,'UNKNOWN');
  assert.equal(analyzeTrace([...base,profile(-1),chunk([node(1,'tracker.js')],[1],[100])]).assessment,'UNKNOWN');
});

test('tracker samples outside captured tasks do not establish a false complete measurement',()=>{
  const result=analyzeTrace([main(),task(0,1000),call(1,10),profile(),chunk([node(1,'tracker.js')],[1],[2000])]);
  assert.equal(result.assessment,'UNKNOWN');assert(names(result).includes('tracker_sample_without_task'));
});

test('current long task without sampled attribution is UNKNOWN despite another observed tracker task',()=>{
  const result=analyzeTrace([main(),task(0,60000),call(1,55000,'inquiry.js'),task(100000,1000),call(100001,10)]);
  assert.equal(result.assessment,'UNKNOWN');assert(names(result).includes('long_task_without_sampled_attribution'));
});

test('CPU sample exactly on task boundary belongs to next task',()=>{
  const result=analyzeTrace([main(),task(0,50000),task(50000,1000),profile(),chunk([node(1,'tracker.js')],[1],[50000])]);
  assert.equal(result.assessment,'PASS');assert.equal(result.maxTrackerTaskMs,1);
  assert.equal(result.mainTasks[0].trackerAttributed,false);assert.equal(result.mainTasks[1].trackerAttributed,true);
});

test('signed CPU deltas preserve paired sample order and exact chunk provenance',()=>{
  const result=analyzeTrace([main(),task(1000,4000),profile(1000),
    chunk([node(1,'tracker.js')],[1,1],[1000,1000]),chunk([],[1,1],[-500,1200])],{requireCpuSamples:true});
  assert.equal(result.assessment,'PASS');
  const samples=result.trackerTasks[0].trackerEvidence;
  assert.deepEqual(samples.map(x=>x.ts),[2000,2500,3000,3700]);
  assert.deepEqual(samples.map(x=>x.rawDeltaUs),[1000,-500,1000,1200]);
  assert.deepEqual(samples.map(x=>x.profileSampleIndex),[0,2,1,3]);
  assert.deepEqual(samples.map(x=>[x.chunkEventIndex,x.sampleIndex]),[[3,0],[4,0],[3,1],[4,1]]);
  assert.equal(result.coverage.negativeCpuDeltaSamples,1);assert.equal(result.coverage.reorderedCpuProfiles,1);
});

test('negative delta moves tracker sample back to the true long task instead of clamping or dropping it',()=>{
  const result=analyzeTrace([main(),task(0,50001),task(50001,1000),profile(),
    chunk([node(1,'other.js'),node(2,'tracker.js')],[1,2],[50010,-11])],{requireCpuSamples:true});
  assert.equal(result.assessment,'FAIL');assert.equal(result.maxTrackerTaskMs,50.001);
  assert.equal(result.trackerLongTasks[0].trackerEvidence[0].ts,49999);
  assert.equal(result.trackerLongTasks[0].trackerEvidence[0].rawDeltaUs,-11);
});

test('negative deltas cannot put samples before profile start or rescue malformed clocks',()=>{
  for(const deltas of [[-1],[100,-101],[Infinity],[NaN],['1'],[Number.MAX_VALUE,Number.MAX_VALUE]]){
    const events=[main(),task(1000,1000),call(1010,10),profile(1000),chunk([node(1,'tracker.js')],deltas.map(()=>1),deltas)];
    const result=analyzeTrace(events,{requireCpuSamples:true});
    assert.equal(result.assessment,'UNKNOWN');assert.equal(result.coverage.invalidCpuProfiles,1);
  }
});

test('paired reordering keeps stable equal timestamps and does not fabricate dense coverage',()=>{
  const events=unrelatedLongTrace([1000,2000,1500,1500]);
  const result=analyzeTrace(events,{requireCpuSamples:true});
  assert.equal(result.assessment,'UNKNOWN');assert(names(result).includes('insufficient_long_task_sample_coverage'));
  assert.deepEqual(result.mainTasks[0].sampledCoverage.samples.map(x=>x.profileSampleIndex),[0,2,3,1]);
  assert.equal(result.mainTasks[0].sampledCoverage.uniqueSampleTimestamps,3);
  assert.equal(result.mainTasks[0].sampledCoverage.maxGapMs,88);
});

test('orphan profile chunks and missing profile ID cannot establish complete attribution',()=>{
  const base=[main(),task(0,1000),call(1,10)];
  assert.equal(analyzeTrace([...base,chunk([node(1,'tracker.js')],[1],[100])]).assessment,'UNKNOWN');
  const noId=profile();delete noId.id;const noChunkId=chunk([node(1,'tracker.js')],[1],[100]);delete noChunkId.id;
  assert.equal(analyzeTrace([...base,noId,noChunkId]).assessment,'UNKNOWN');
});

test('malformed profile payload containers are UNKNOWN rather than discarded',()=>{
  const malformed=[{args:{}},{args:{data:{cpuProfile:'bad'}}},{args:{data:{cpuProfile:{nodes:{},samples:[]},timeDeltas:[]}}},
    chunk([{...node(1,'tracker.js'),children:{}}],[1],[100])];
  for(const bad of malformed){const event={...chunk([],[],[]),...bad};assert.equal(analyzeTrace([main(),task(0,1000),call(1,10),profile(),event]).assessment,'UNKNOWN');}
});

const span={start:'farpoint-start-fixture',end:'farpoint-end-fixture'};
const mark=(name,ts,extra={})=>({name,ts,ph:'R',cat:'blink.user_timing',pid:1,tid:10,...extra});
const spanBase=()=>[main(),task(0,1000),call(100,10),mark(span.start,0),mark(span.end,999)];

test('required trace span records ordered start/end marks and their provenance',()=>{
  const result=analyzeTrace(spanBase(),{requiredSpan:span});
  assert.equal(result.assessment,'PASS');assert.equal(result.coverage.requiredSpan.complete,true);
  assert.equal(result.coverage.requiredSpan.durationMs,0.999);
  assert.equal(result.coverage.requiredSpan.startMarkers[0].eventIndex,3);
  assert.equal(result.coverage.requiredSpan.endMarkers[0].eventIndex,4);
});

test('unfinished later tasks remain visible diagnostics after a completed same-thread span',()=>{
  const events=[...spanBase(),{ph:'B',name:'RunTask',pid:1,tid:10,ts:1100},
    {ph:'B',name:'FunctionCall',pid:1,tid:10,ts:1101,args:{data:{url:'tracker.js'}}}];
  const result=analyzeTrace(events,{requiredSpan:span});
  assert.equal(result.assessment,'PASS');assert.equal(result.issues.length,0);
  assert.deepEqual(result.coverage.postSpanUnfinishedEvents.map(x=>[x.eventIndex,x.tsUs]),[[5,1100],[6,1101]]);
  assert.equal(analyzeTrace(events).assessment,'UNKNOWN');
  assert.equal(analyzeTrace(events,{requiredSpan:span,dataLossOccurred:true}).assessment,'UNKNOWN');
});

test('unfinished tasks at or crossing span end and other main threads remain UNKNOWN',()=>{
  for(const ts of [100,999,-1,NaN,undefined]){
    const events=[...spanBase(),{ph:'B',name:'RunTask',pid:1,tid:10,ts}];
    const result=analyzeTrace(events,{requiredSpan:span});
    assert.equal(result.assessment,'UNKNOWN');assert(names(result).includes('unfinished_execution_event'));
    assert.equal(result.coverage.postSpanUnfinishedEvents.length,0);
  }
  const other=[...spanBase(),main(2,20),{ph:'B',name:'RunTask',pid:2,tid:20,ts:1100}];
  assert.equal(analyzeTrace(other,{requiredSpan:span}).assessment,'UNKNOWN');
  const missingEnd=spanBase().filter(event=>event.name!==span.end);
  assert.equal(analyzeTrace([...missingEnd,{ph:'B',name:'RunTask',pid:1,tid:10,ts:1100}],{requiredSpan:span}).assessment,'UNKNOWN');
});

test('measurement marks never clip complete enclosing long tasks',()=>{
  const result=analyzeTrace([main(),task(0,60000),call(100,1),mark(span.start,10),mark(span.end,200)],{requiredSpan:span});
  assert.equal(result.assessment,'FAIL');assert.equal(result.maxTrackerTaskMs,60);
  assert.equal(result.coverage.requiredSpan.durationMs,0.19);
});

test('missing, duplicate or wrong-category span marks reject truncated capture',()=>{
  const base=spanBase();
  const variants=[base.filter((_,index)=>index!==3),base.filter((_,index)=>index!==4),
    [...base,mark(span.start,1)],[...base,mark(span.end,998)],
    base.map((event,index)=>index===4?{...event,cat:'unrelated'}:event)];
  for(const events of variants){const result=analyzeTrace(events,{requiredSpan:span});assert.equal(result.assessment,'UNKNOWN');assert(names(result).includes('missing_or_duplicate_span_marks'));}
});

test('required span rejects reversed, equal, invalid, non-main and cross-thread marks',()=>{
  const variants=[{ts:-1},{ts:0},{ts:NaN},{ts:Infinity},{ts:undefined},{ph:'X',dur:1},{pid:2,tid:20},{pid:1,tid:undefined}];
  for(const change of variants){
    const events=spanBase().map((event,index)=>index===4?{...event,...change}:event);
    const result=analyzeTrace(events,{requiredSpan:span});
    assert.equal(result.assessment,'UNKNOWN');assert(names(result).includes('invalid_required_span'));
  }
  const crossed=[...spanBase().slice(0,4),main(2,20),mark(span.end,999,{pid:2,tid:20})];
  assert.equal(analyzeTrace(crossed,{requiredSpan:span}).assessment,'UNKNOWN');
});

test('parser validates inputs and exports the required capture categories',()=>{
  assert.throws(()=>analyzeTrace({}),TypeError);assert.throws(()=>analyzeTrace([null]),TypeError);
  assert.throws(()=>analyzeTrace([],{limitMs:-1}),TypeError);
  for(const maxSampleGapMs of [0,-1,NaN,Infinity,'5'])assert.throws(()=>analyzeTrace([],{maxSampleGapMs}),TypeError);
  for(const requiredSpan of [null,{},'bad',{start:'same',end:'same'},{start:'',end:'end'}])assert.throws(()=>analyzeTrace([],{requiredSpan}),TypeError);
  assert(TRACE_CATEGORIES.includes('disabled-by-default-v8.cpu_profiler'));
  assert(TRACE_CATEGORIES.includes('disabled-by-default-devtools.timeline'));
  assert(TRACE_CATEGORIES.includes('blink.user_timing'));
});
