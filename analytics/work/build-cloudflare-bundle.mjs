import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

const directory=process.argv[2];
if(!directory||!directory.startsWith('/'))throw Error('Absolute artifact directory required');
const names=['portable-runtime.mjs','pipeline.mjs','native-adapters.mjs','host-bridge.mjs','cloudflare-adapter.mjs','archive-closure.mjs','network-stage.mjs'];
const sources=await Promise.all(names.map(name=>readFile(new URL(name,import.meta.url),'utf8')));
const hash=createHash('sha256').update(sources.join('\n')).digest('hex');
const transformed=sources.map(source=>source.replace(/^import .*;\n/gm,'').replace(/^export /gm,''));
const code='"use strict";\n// Generated Cloudflare Work bundle; source SHA256 '+hash+'\n'+transformed[0]+'\nconst {TextEncoder,TextDecoder,crypto,atob,btoa}=createPortableRuntime(entropyBase64);\n'+transformed.slice(1).join('\n')+'\nreturn Object.freeze({WORK_VERSION,WorkFailure,workHash,workJSON,workUnbase64,runLeadPipeline,verifyRemoteRun,evaluateWatchdog,renderLeadReport,workToolValue,createNativeAdapters,createFrozenClassifier,createWorkHostBridge,CLOUDFLARE_ADAPTER_VERSION,cloudflareToolValue,createCloudflareCollectorAdapter,CLOSURE_VERSION,closeWorkArchive,NETWORK_STAGE_VERSION,createNetworkStageHost,createNetworkAnalyzer});\n';
const path=resolve(directory,`work-cloudflare-${hash}.bundle.js`);
await mkdir(directory,{recursive:true});
try{await writeFile(path,code,{flag:'wx'});}catch(error){if(error.code!=='EEXIST'||await readFile(path,'utf8')!==code)throw error;}
console.log(JSON.stringify({source_sha256:hash,bundle_sha256:createHash('sha256').update(code).digest('hex'),bytes:Buffer.byteLength(code),output:path}));
