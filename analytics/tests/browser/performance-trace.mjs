/* Pure analysis of Chrome JSON traces; no I/O, browser mutation or telemetry.
 * Task durations are wall-clock envelopes, not tracker self-time. A task is
 * conservatively attributed when a tracker execution event or CPU stack sample
 * lies inside it. CPU sampling is observational and is not a proof that every
 * instruction was observed. Keep the original trace alongside this report.
 *
 * Format references:
 * https://chromedevtools.github.io/devtools-protocol/tot/Tracing/
 * https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/types/TraceEvents.ts
 * https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/trace/handlers/SamplesHandler.ts
 * https://github.com/ChromeDevTools/devtools-frontend/blob/main/front_end/models/cpu_profile/CPUProfileDataModel.ts
 */

export const TRACE_CATEGORIES = Object.freeze([
  'toplevel', 'blink.user_timing', 'devtools.timeline', 'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.stack', 'v8.execute',
  'disabled-by-default-v8.cpu_profiler'
]);

const TASK_NAMES = new Set(['RunTask', 'ThreadControllerImpl::RunTask']);
const EXECUTION_NAMES = new Set(['FunctionCall', 'EvaluateScript', 'EvaluateModule']);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const validThreadIdentity = event => Number.isSafeInteger(event.pid) && event.pid>=0 && Number.isSafeInteger(event.tid) && event.tid>=0;
const validTimestamp = value => finite(value) && value>=0;
const validDuration = event => validTimestamp(event.ts) && finite(event.dur) && event.dur>=0 && finite(event.ts+event.dur);
const threadKey = event => `${event.pid}:${event.tid}`;
const profileKey = event => `${event.pid}:${JSON.stringify(event.id ?? event.id2 ?? null)}`;
const provenance = event => ({eventIndex:event.index, name:event.name, pid:event.pid, tid:event.tid,
  tsUs:event.ts, ...(finite(event.dur)?{durationUs:event.dur}:{}),
  ...(event.endIndex===undefined?{}:{endEventIndex:event.endIndex})});

function sourceMatches(value, basename) {
  if (typeof value !== 'string' || !value) return false;
  try {
    const pathname = new URL(value, 'https://trace.invalid/').pathname;
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)) === basename;
  } catch { return false; }
}

function normalizeEvents(rawEvents, issues) {
  const result = [];
  const stacks = new Map();
  const events = rawEvents.map((event,index)=>({...event,index}));
  // B/E nesting is per thread, with original index breaking equal-time ties.
  for (const event of [...events].sort((a,b)=>(a.ts??0)-(b.ts??0)||a.index-b.index)) {
    if (event.ph==='B') {
      const key=threadKey(event);const stack=stacks.get(key)||[];
      stack.push(event);stacks.set(key,stack);
    } else if (event.ph==='E') {
      const stack=stacks.get(threadKey(event));const begin=stack?.pop();
      if (!begin) continue; // Recording may begin during an unrelated task.
      if ((event.name && event.name!==begin.name) || !finite(begin.ts) || !finite(event.ts) || event.ts<begin.ts) {
        if(TASK_NAMES.has(begin.name)||EXECUTION_NAMES.has(begin.name))issues.push({code:'invalid_begin_end_pair',beginIndex:begin.index,endIndex:event.index,pid:begin.pid,tid:begin.tid});
        continue;
      }
      result.push({...begin,ph:'X',dur:event.ts-begin.ts,endIndex:event.index});
    } else result.push(event);
  }
  for (const stack of stacks.values()) for (const event of stack) {
    if(TASK_NAMES.has(event.name)||EXECUTION_NAMES.has(event.name))issues.push({code:'unfinished_execution_event',eventIndex:event.index,pid:event.pid,tid:event.tid,tsUs:event.ts});
  }
  return result;
}

function collectProfiles(events, mainThreads, issues) {
  const profiles=new Map();
  const ensure=event=>{
    const key=profileKey(event);
    if(!profiles.has(key))profiles.set(key,{key,pid:event.pid,head:null,chunks:[],nodes:new Map()});
    return profiles.get(key);
  };
  for(const event of events) {
    if(event.name==='Profile') {
      const profile=ensure(event);
      if(profile.head)issues.push({code:'duplicate_profile_head',eventIndex:event.index});
      profile.head=event;
    } else if(event.name==='ProfileChunk')ensure(event).chunks.push(event);
  }
  const samples=[];
  let profilesOnMainThread=0,validProfiles=0,invalidProfiles=0,negativeDeltaSamples=0,reorderedProfiles=0;
  for(const profile of profiles.values()) {
    const head=profile.head;
    // The Profile head has the sampled thread; chunks may be emitted elsewhere.
    if(!head) {
      if([...mainThreads.values()].some(thread=>thread.pid===profile.pid))issues.push({code:'orphan_profile_chunks',chunkEventIndexes:profile.chunks.map(chunk=>chunk.index)});
      continue;
    }
    if(!mainThreads.has(threadKey(head)))continue;
    profilesOnMainThread++;
    let invalid=false;
    const problem=(code,detail={})=>{invalid=true;issues.push({code,profileEventIndex:head.index,...detail});};
    if(!validTimestamp(head.ts))problem('invalid_profile_clock');
    if(head.id===undefined&&head.id2===undefined)problem('missing_profile_id');
    const chunks=profile.chunks.sort((a,b)=>a.index-b.index);
    const entries=[];
    for(const chunk of chunks) {
      const data=chunk.args?.data;
      if(!data||typeof data!=='object'||Array.isArray(data)){problem('invalid_profile_chunk_data',{chunkEventIndex:chunk.index});continue;}
      const cpu=data.cpuProfile||{};
      if(typeof cpu!=='object'||Array.isArray(cpu)){problem('invalid_profile_chunk_cpu',{chunkEventIndex:chunk.index});continue;}
      const nodes=cpu.nodes??[];
      if(!Array.isArray(nodes)){problem('invalid_profile_nodes',{chunkEventIndex:chunk.index});continue;}
      for(const node of nodes) {
        if(!node||typeof node!=='object'){problem('invalid_profile_node',{chunkEventIndex:chunk.index});continue;}
        if(!Number.isSafeInteger(node.id)||!node.callFrame||typeof node.callFrame!=='object'||Array.isArray(node.callFrame)||(node.callFrame.url!==undefined&&typeof node.callFrame.url!=='string')) {problem('invalid_profile_node',{chunkEventIndex:chunk.index});continue;}
        const previous=profile.nodes.get(node.id);
        if(previous && (JSON.stringify(previous.callFrame)!==JSON.stringify(node.callFrame)||previous.parent!==node.parent))problem('conflicting_profile_node',{chunkEventIndex:chunk.index,nodeId:node.id});
        profile.nodes.set(node.id,{...node,chunkEventIndex:chunk.index});
      }
      const ids=cpu.samples||[],deltas=data.timeDeltas||[];
      if(!Array.isArray(ids)||!Array.isArray(deltas)||ids.length!==deltas.length) {problem('profile_sample_delta_mismatch',{chunkEventIndex:chunk.index});continue;}
      for(let i=0;i<ids.length;i++)entries.push({nodeId:ids[i],delta:deltas[i],sampleIndex:i,chunkEventIndex:chunk.index});
    }
    // Full CDP-style nodes may specify children instead of each child's parent.
    for(const node of profile.nodes.values()) {
      if(node.children!==undefined&&!Array.isArray(node.children)){problem('invalid_profile_children',{nodeId:node.id});continue;}
      for(const childId of node.children||[]) {
      const child=profile.nodes.get(childId);
      if(child && child.parent===undefined)child.parent=node.id;
      else if(child && child.parent!==node.id)problem('conflicting_profile_parent',{nodeId:childId});
      }
    }
    let timestamp=head.ts;
    const decoded=[];
    for(const [profileSampleIndex,entry] of entries.entries()) {
      // Chrome's CPUProfileDataModel.convertTimeDeltas accumulates signed
      // deltas; sortSamples then reorders timestamp/sample pairs together.
      // Negative deltas represent out-of-order samples. Never clamp them to
      // zero or drop them: either would shift later evidence to another task.
      if(!Number.isSafeInteger(entry.nodeId)||!finite(entry.delta)){problem('invalid_profile_sample',{chunkEventIndex:entry.chunkEventIndex,sampleIndex:entry.sampleIndex});continue;}
      if(entry.delta<0)negativeDeltaSamples++;
      timestamp+=entry.delta;
      if(!validTimestamp(timestamp)||timestamp<head.ts){problem('invalid_profile_sample_clock',{chunkEventIndex:entry.chunkEventIndex,sampleIndex:entry.sampleIndex});continue;}
      let nodeId=entry.nodeId;const seen=new Set(),frames=[];
      while(nodeId!==undefined && nodeId!==null) {
        if(seen.has(nodeId)){problem('cyclic_profile_stack',{nodeId});break;}
        seen.add(nodeId);const node=profile.nodes.get(nodeId);
        if(!node){problem('missing_profile_node',{nodeId});break;}
        frames.push({nodeId,url:node.callFrame.url||'',functionName:node.callFrame.functionName||'',
          lineNumber:node.callFrame.lineNumber??null,columnNumber:node.callFrame.columnNumber??null,
          nodeChunkEventIndex:node.chunkEventIndex});
        nodeId=node.parent;
      }
      decoded.push({kind:'cpu_sample',pid:head.pid,tid:head.tid,ts:timestamp,
        profileEventIndex:head.index,chunkEventIndex:entry.chunkEventIndex,sampleIndex:entry.sampleIndex,
        profileSampleIndex,rawDeltaUs:entry.delta,sampledNodeId:entry.nodeId,frames});
    }
    if(invalid)invalidProfiles++;
    else {
      validProfiles++;
      if(decoded.some((sample,index)=>index>0&&sample.ts<decoded[index-1].ts))reorderedProfiles++;
      decoded.sort((a,b)=>a.ts-b.ts||a.profileSampleIndex-b.profileSampleIndex);
      samples.push(...decoded);
    }
  }
  return {samples,profilesOnMainThread,validProfiles,invalidProfiles,negativeDeltaSamples,reorderedProfiles};
}

/**
 * @param {{traceEvents:object[], dataLossOccurred?:boolean}|object[]} trace
 * @param {{trackerBasename?:string,expectTracker?:boolean,limitMs?:number,
 *   dataLossOccurred?:boolean,requireCpuSamples?:boolean,maxSampleGapMs?:number,
 *   requiredSpan?:{start:string,end:string}}} options
 * Baseline runs omit the tracker and set expectTracker:false. UNKNOWN must never
 * be promoted to PASS. requireCpuSamples:true rejects invocation-only coverage.
 * Excluding a current-run long task additionally requires mapped CPU samples
 * with gaps <= maxSampleGapMs (default 5 ms), including its start/end boundaries.
 * This is a declared evidence-quality bound, not proof of every instruction.
 */
export function analyzeTrace(trace, options={}) {
  const {trackerBasename='tracker.js',expectTracker=true,limitMs=50,
    dataLossOccurred=false,requireCpuSamples=false,maxSampleGapMs=5,requiredSpan}=options;
  if(typeof trackerBasename!=='string'||!trackerBasename||trackerBasename.includes('/')||!finite(limitMs)||limitMs<0||!finite(maxSampleGapMs)||maxSampleGapMs<=0)throw new TypeError('Invalid trace analysis options');
  if(requiredSpan!==undefined&&(!requiredSpan||typeof requiredSpan.start!=='string'||!requiredSpan.start||typeof requiredSpan.end!=='string'||!requiredSpan.end||requiredSpan.start===requiredSpan.end))throw new TypeError('Invalid required trace span');
  const rawEvents=Array.isArray(trace)?trace:trace?.traceEvents;
  if(!Array.isArray(rawEvents)||rawEvents.some(e=>!e||typeof e!=='object'||Array.isArray(e)))throw new TypeError('Trace must contain a traceEvents array of objects');
  const issues=[];
  if(dataLossOccurred||trace?.dataLossOccurred===true)issues.push({code:'trace_data_loss'});
  const mainThreads=new Map();
  rawEvents.forEach((event,index)=>{
    const mainMetadata=event.ph==='M'&&event.name==='thread_name'&&event.args?.name==='CrRendererMain';
    const relevantEvent=mainMetadata||TASK_NAMES.has(event.name)||EXECUTION_NAMES.has(event.name)||event.name==='Profile'||event.name==='ProfileChunk'||Array.isArray(event.args?.data?.stackTrace)||(requiredSpan&&(event.name===requiredSpan.start||event.name===requiredSpan.end));
    // Missing identities cannot safely be classified as another thread. In
    // particular, undefined:undefined must not join metadata to task evidence.
    if(relevantEvent&&!validThreadIdentity(event)){issues.push({code:'invalid_thread_identity',eventIndex:index,name:event.name});return;}
    if(mainMetadata)mainThreads.set(threadKey(event),{pid:event.pid,tid:event.tid,metadataEventIndex:index});
  });
  const events=normalizeEvents(rawEvents,issues);
  // A recording boundary on a non-renderer thread does not invalidate page cost.
  let relevantIssues=issues.filter(issue=>issue.pid===undefined||mainThreads.has(`${issue.pid}:${issue.tid}`));
  const mainEvents=events.filter(e=>mainThreads.has(threadKey(e)));
  let requiredSpanCoverage=null;
  if(requiredSpan){
    const marks=name=>events.filter(event=>event.name===name&&typeof event.cat==='string'&&event.cat.split(',').includes('blink.user_timing'));
    const starts=marks(requiredSpan.start),ends=marks(requiredSpan.end);
    requiredSpanCoverage={names:requiredSpan,startMarkers:starts.map(provenance),endMarkers:ends.map(provenance),complete:false};
    if(starts.length!==1||ends.length!==1)relevantIssues.push({code:'missing_or_duplicate_span_marks',startCount:starts.length,endCount:ends.length});
    else {
      const start=starts[0],end=ends[0];
      const validMark=event=>['R','I','i'].includes(event.ph)&&validTimestamp(event.ts)&&validThreadIdentity(event)&&mainThreads.has(threadKey(event));
      if(!validMark(start)||!validMark(end)||threadKey(start)!==threadKey(end)||end.ts<=start.ts)relevantIssues.push({code:'invalid_required_span',startEventIndex:start.index,endEventIndex:end.index});
      else requiredSpanCoverage={...requiredSpanCoverage,complete:true,startUs:start.ts,endUs:end.ts,durationMs:(end.ts-start.ts)/1000};
    }
  }
  const postSpanUnfinishedEvents=[];
  if(requiredSpanCoverage?.complete){
    const end=requiredSpanCoverage.endMarkers[0];
    // Stopping recording can cut a later task. A complete same-thread end mark
    // bounds the requested interaction; retain those later beginnings as
    // diagnostics. An unfinished event at/before the mark remains UNKNOWN.
    // Complete containing tasks are never clipped to the measurement marks.
    relevantIssues=relevantIssues.filter(issue=>{
      if(issue.code==='unfinished_execution_event'&&issue.pid===end.pid&&issue.tid===end.tid&&validTimestamp(issue.tsUs)&&issue.tsUs>requiredSpanCoverage.endUs){postSpanUnfinishedEvents.push(issue);return false;}
      return true;
    });
  }
  const taskCandidates=mainEvents.filter(e=>TASK_NAMES.has(e.name)&&e.ph==='X');
  const tasks=[];
  for(const thread of mainThreads.keys()) {
    let candidates=taskCandidates.filter(e=>threadKey(e)===thread);
    // Current Chrome's RunTask is the actual task. A surrounding controller
    // wrapper would double-count it and may contain unrelated scheduler work.
    if(candidates.some(e=>e.name==='RunTask'))candidates=candidates.filter(e=>e.name==='RunTask');
    const valid=[];
    for(const event of candidates) {
      if(!validDuration(event)){relevantIssues.push({code:'invalid_task_duration',...provenance(event)});continue;}
      valid.push(event);
    }
    valid.sort((a,b)=>a.ts-b.ts||b.dur-a.dur||a.index-b.index);
    let outer=null;
    for(const event of valid) {
      if(outer && event.ts>=outer.ts && event.ts+event.dur<=outer.ts+outer.dur)continue;
      if(outer && event.ts<outer.ts+outer.dur)relevantIssues.push({code:'overlapping_main_tasks',eventIndex:event.index,previousEventIndex:outer.index});
      outer=event;tasks.push({...event,evidence:[],mappedCpuSamples:[]});
    }
  }
  // Sample timestamps are points; half-open task intervals avoid attributing a
  // boundary sample to an already-finished long task instead of the next task.
  const taskAt=(pid,tid,ts,end=ts)=>tasks.find(task=>task.pid===pid&&task.tid===tid&&ts>=task.ts&&ts<task.ts+task.dur&&end<=task.ts+task.dur);
  let sourceEvents=0,trackerSourceEvents=0,uncontainedTrackerEvidence=0;
  for(const event of mainEvents) {
    const data=event.args?.data||{};
    const executionEvent=EXECUTION_NAMES.has(event.name)&&event.ph==='X';
    const hasStack=Array.isArray(data.stackTrace)&&data.stackTrace.length>0;
    if((executionEvent||hasStack)&&(!validTimestamp(event.ts)||(event.ph==='X'&&!validDuration(event)))){
      relevantIssues.push({code:'invalid_execution_timing',...provenance(event)});continue;
    }
    if(!validTimestamp(event.ts))continue;
    const frames=[];
    if(executionEvent&&typeof data.url==='string'&&data.url)frames.push({url:data.url,functionName:data.functionName||'',lineNumber:data.lineNumber??null,columnNumber:data.columnNumber??null,source:'execution_url'});
    // A recorded synchronous stack is useful; do not follow async parent stacks
    // that identify an earlier scheduling cause rather than current execution.
    if(Array.isArray(data.stackTrace))for(const frame of data.stackTrace)if(typeof frame?.url==='string'&&frame.url)frames.push({...frame,source:'synchronous_stack'});
    if(!frames.length)continue;
    sourceEvents++;
    const matching=frames.filter(frame=>sourceMatches(frame.url,trackerBasename));
    if(!matching.length)continue;
    trackerSourceEvents++;
    const task=taskAt(event.pid,event.tid,event.ts,event.ts+(event.ph==='X'?event.dur:0));
    const evidence={kind:'trace_execution',...provenance(event),frames:matching};
    if(task)task.evidence.push(evidence);
    else {uncontainedTrackerEvidence++;relevantIssues.push({code:'tracker_execution_without_task',...provenance(event)});}
  }
  const profileData=collectProfiles(events,mainThreads,relevantIssues);
  let mappedSamples=0,trackerSamples=0;
  for(const sample of profileData.samples) {
    const task=taskAt(sample.pid,sample.tid,sample.ts);
    if(sample.frames.some(frame=>frame.url)){mappedSamples++;if(task)task.mappedCpuSamples.push(sample);}
    const matching=sample.frames.filter(frame=>sourceMatches(frame.url,trackerBasename));
    if(!matching.length)continue;
    trackerSamples++;
    if(task)task.evidence.push({...sample,frames:matching});
    else {uncontainedTrackerEvidence++;relevantIssues.push({code:'tracker_sample_without_task',profileEventIndex:sample.profileEventIndex,chunkEventIndex:sample.chunkEventIndex,sampleIndex:sample.sampleIndex,tsUs:sample.ts});}
  }
  const mainTasks=tasks.map(task=>{
    const sampleTimes=[...new Set(task.mappedCpuSamples.map(sample=>sample.ts))].sort((a,b)=>a-b);
    const points=[task.ts,...sampleTimes,task.ts+task.dur];
    const gaps=points.slice(1).map((end,index)=>({startUs:points[index],endUs:end,durationMs:(end-points[index])/1000}));
    const largestGap=gaps.reduce((largest,gap)=>gap.durationMs>largest.durationMs?gap:largest,gaps[0]);
    return {...provenance(task),durationMs:task.dur/1000,
      trackerAttributed:task.evidence.length>0,trackerEvidence:task.evidence,
      mappedCpuSampleCount:task.mappedCpuSamples.length,
      sampledCoverage:{maxAllowedGapMs:maxSampleGapMs,maxGapMs:largestGap.durationMs,largestGap,
        uniqueSampleTimestamps:sampleTimes.length,
        sufficient:sampleTimes.length>0&&largestGap.durationMs<=maxSampleGapMs,
        samples:task.mappedCpuSamples}};
  }).sort((a,b)=>a.tsUs-b.tsUs||a.eventIndex-b.eventIndex);
  const trackerTasks=mainTasks.filter(task=>task.trackerAttributed);
  const trackerLongTasks=trackerTasks.filter(task=>task.durationMs>limitMs);
  const attributionSupported=mainThreads.size>0&&mainTasks.length>0&&(sourceEvents>0||mappedSamples>0);
  const trackerObserved=trackerSourceEvents>0||trackerSamples>0;
  if(!mainThreads.size)relevantIssues.push({code:'missing_renderer_main_thread_metadata'});
  if(!mainTasks.length)relevantIssues.push({code:'missing_main_thread_tasks'});
  if(!sourceEvents&&!mappedSamples)relevantIssues.push({code:'missing_source_attribution'});
  if(expectTracker&&!trackerObserved)relevantIssues.push({code:'tracker_execution_not_observed'});
  if(requireCpuSamples&&!mappedSamples)relevantIssues.push({code:'missing_mapped_cpu_samples'});
  // A top-level other.js callback can call tracker.js internally. One unrelated
  // sample cannot exclude an entire long task: demand bounded start/interior/end
  // gaps in mapped samples. Even dense sampling remains observational evidence.
  if(expectTracker)for(const task of mainTasks)if(task.durationMs>limitMs&&!task.trackerAttributed&&!task.sampledCoverage.sufficient)relevantIssues.push({code:task.mappedCpuSampleCount?'insufficient_long_task_sample_coverage':'long_task_without_sampled_attribution',eventIndex:task.eventIndex,durationMs:task.durationMs,maxGapMs:task.sampledCoverage.maxGapMs,maxAllowedGapMs:maxSampleGapMs});
  const assessment=relevantIssues.length?'UNKNOWN':trackerLongTasks.length?'FAIL':'PASS';
  return {
    analysisVersion:3,assessment,trackerBasename,expectTracker,limitMs,maxSampleGapMs,
    attributionSupported,trackerObserved,
    attributionMethod:'Conservative enclosing main-thread task, supported by synchronous trace events or sampled CPU stack; not tracker self-time.',
    maxMainTaskMs:mainTasks.length?mainTasks.reduce((maximum,task)=>Math.max(maximum,task.durationMs),0):null,
    maxTrackerTaskMs:trackerTasks.length?trackerTasks.reduce((maximum,task)=>Math.max(maximum,task.durationMs),0):null,
    mainTasks,trackerTasks,trackerLongTasks,
    coverage:{traceEvents:rawEvents.length,mainThreads:[...mainThreads.values()],mainTaskCount:mainTasks.length,
      sourceEvents,trackerSourceEvents,cpuProfiles:profileData.profilesOnMainThread,
      validCpuProfiles:profileData.validProfiles,invalidCpuProfiles:profileData.invalidProfiles,
      negativeCpuDeltaSamples:profileData.negativeDeltaSamples,reorderedCpuProfiles:profileData.reorderedProfiles,
      cpuTimestampNormalization:'Signed cumulative deltas from Profile.ts; paired samples stably ordered by timestamp, with raw delta and original sample positions retained.',
      cpuSamples:profileData.samples.length,mappedCpuSamples:mappedSamples,trackerCpuSamples:trackerSamples,
      uncontainedTrackerEvidence,requireCpuSamples,maxSampleGapMs,requiredSpan:requiredSpanCoverage,postSpanUnfinishedEvents},
    issues:relevantIssues
  };
}
