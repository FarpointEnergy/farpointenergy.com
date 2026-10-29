"""Restore already hash-verified frozen invocation into NEW private paths.
No connector, network, schedules or external writes. Print only safe descriptors.
"""
import argparse,base64,datetime,hashlib,json,os,secrets,subprocess,zipfile,uuid
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--prepared-root',required=True);p.add_argument('--run-root',required=True);p.add_argument('--manifest-sha256',required=True);p.add_argument('--driver-sha256',required=True);p.add_argument('--period',required=True,choices=['daily','weekly']);a=p.parse_args()
prepared=Path(a.prepared_root);root=Path(a.run_root)
def sha(b):return hashlib.sha256(b).hexdigest()
def write(p,b):
 p.parent.mkdir(parents=True,exist_ok=True)
 with p.open('xb') as f:f.write(b);f.flush();os.fsync(f.fileno())
 assert p.read_bytes()==b
mb=(prepared/'execution-manifest.json').read_bytes();db=(prepared/'execute-report.js').read_bytes()
assert sha(mb)==a.manifest_sha256 and sha(db)==a.driver_sha256
m=json.loads(mb);assert m['source_commit']==m['source_archive_git_comment'];assert len(m['source_commit'])==40
# Preflight all supplied bytes before creating an invocation.
blobs={}
for name,d in m['files'].items():
 rel=Path(d['path']);assert not rel.is_absolute() and '..' not in rel.parts
 b=(prepared/rel).read_bytes();assert len(b)==d['bytes'] and sha(b)==d['sha256'];blobs[name]=b
source_zip=prepared/m['files']['reviewed-source.zip']['path']
with zipfile.ZipFile(source_zip) as z:
 assert z.comment.decode()==m['source_commit']
 for i in z.infolist():
  rel=Path(i.filename);assert not rel.is_absolute() and '..' not in rel.parts and '\\' not in i.filename
  assert ((i.external_attr>>16)&0o170000)!=0o120000
root.mkdir(parents=True,exist_ok=False); evidence=root/'evidence'; repository=root/'source'
write(evidence/'execution-manifest.json',mb);write(evidence/'execute-report.js',db);write(evidence/'bootstrap.py',Path(__file__).read_bytes())
for name,b in blobs.items():write(evidence/m['files'][name]['path'],b)
with zipfile.ZipFile(source_zip) as z:
 for i in z.infolist():
  if i.is_dir():(repository/i.filename).mkdir(parents=True,exist_ok=True)
  else:write(repository/i.filename,z.read(i.filename))
built=json.loads(subprocess.check_output(['node',str(repository/'analytics/work/build-cloudflare-bundle.mjs'),str(root/'rebuilt-bundle')],text=True))
assert Path(built['output']).read_bytes()==blobs['work-cloudflare.bundle.js']
verification={'status':'verified','source_commit':m['source_commit'],'source_archive_sha256':m['files']['reviewed-source.zip']['sha256'],'input_files_verified':len(blobs),'bundle_sha256':built['bundle_sha256'],'portable_runtime_sha256':sha(blobs['portable-runtime.mjs']),'bundle_regenerated_identically':True,'manifest_sha256':sha(mb),'driver_sha256':sha(db)}
schedule_scope={};exec(compile(blobs['scheduled-window.py'],'scheduled-window.py','exec'),schedule_scope)
window=schedule_scope['completed_window'](a.period,datetime.datetime.now(datetime.timezone.utc),blobs['America-New_York.tzif'])
window_bytes=(json.dumps(window,sort_keys=True,indent=2)+'\n').encode()
write(evidence/'scheduled-window.json',window_bytes)
verification['scheduled_window_sha256']=sha(window_bytes)
verification['scheduled_period']=a.period
write(evidence/'bootstrap-verification.json',(json.dumps(verification,sort_keys=True,indent=2)+'\n').encode())
inputs={'manifestSource':mb.decode(),'manifestSha256':sha(mb),'driverSource':db.decode(),'driverSha256':sha(db),'bundleSource':blobs['work-cloudflare.bundle.js'].decode(),'portableRuntimeSource':blobs['portable-runtime.mjs'].decode(),'entropyBase64':base64.b64encode(secrets.token_bytes(64)).decode(),'sourceCommit':m['source_commit'],'smallInputFiles':{k:base64.b64encode(v).decode() for k,v in blobs.items() if k!='reviewed-source.zip'},'privateRoot':str(evidence/'pipeline'),'evidenceRoot':str(evidence),'repositoryRoot':str(repository),'outputRoot':str(root/'closure'),'runId':'scheduled-report-'+uuid.uuid4().hex,'bootstrapVerification':verification}
inputs['scheduledWindowSource']=window_bytes.decode()
write(root/'runtime-inputs.json',(json.dumps(inputs,separators=(',',':'))+'\n').encode());os.chmod(root/'runtime-inputs.json',0o600)
print(json.dumps({'status':'prepared_not_executed','run_root':str(root),'runtime_inputs_path':str(root/'runtime-inputs.json'),'verification':verification}))
