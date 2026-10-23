from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, os, subprocess, sys
ROOT=Path.cwd()
OUT=Path(__file__).resolve().parent
now=lambda:datetime.now(timezone.utc).isoformat()
sha=lambda b:hashlib.sha256(b).hexdigest()
def write(name, value):
    with (OUT/name).open('x') as f: json.dump(value,f,indent=2);f.write('\n')
def inventory():
    paths=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard','-z']).decode().split('\0')
    selected=[]
    for name in sorted(set(filter(None,paths))):
        p=Path(name)
        if 'evidence' in p.parts or '.evidence' in p.parts or '__pycache__' in p.parts or name.startswith('docs/technical/') or p.name.startswith('independent-') or not p.is_file():continue
        raw=p.read_bytes();selected.append({'path':name,'bytes':len(raw),'sha256':sha(raw)})
    return selected
before=inventory();write('source-before.json',before)
commands=[('collector',['node','--test','analytics/tests/collector/collector.test.mjs']),('python',['python3','-m','unittest','discover','-s','analytics/tests/python','-v']),('tracker',['node','check_tracker.js']),('inquiry',['node','check_inquiry.js']),('context',['node','check_context.js']),('wrapper',['node','--test','analytics/deploy/sites/wrapper.test.mjs']),('cross-language',['node','analytics/tests/collector/cross-language.mjs']),('work-javascript',['node','--test','analytics/work/tests/pipeline.test.mjs','analytics/work/tests/runtime.test.mjs']),('work-python',['python3','-m','unittest','discover','-s','analytics/work/tests','-v']),('work-bundle-reproducible',['python3','-c',"from pathlib import Path; import subprocess,hashlib; p=Path('analytics/work/work.bundle.js'); original=p.read_bytes(); subprocess.run(['node','analytics/work/build-bundle.mjs'],check=True); first=p.read_bytes(); subprocess.run(['node','analytics/work/build-bundle.mjs'],check=True); second=p.read_bytes(); assert original==first==second,'Bundle regeneration changed bytes'; print('PASS: existing generated Work bundle and two rebuilds match exactly; SHA256='+hashlib.sha256(second).hexdigest())"]),('site',['python3','check_site.py']),('diff-whitespace',['git','diff','--check']),('preview-manifest',['python3','-c',"from pathlib import Path; import json,hashlib,re; d=Path('../farpoint-website-preview/dist'); m=json.loads((d/'review-source-manifest.json').read_text()); s=m['source_sha256']; assert len(s)==26; assert all(hashlib.sha256(Path(n).read_bytes()).hexdigest()==h for n,h in s.items()); assert not json.loads(Path('analytics-config.json').read_text())['enabled']; assert (d/'robots.txt').read_text()=='User-agent: *\\nDisallow: /\\n'; assert 'preventDefault' in (d/'preview-guard.js').read_text(); pages=list(d.glob('*.html')); assert len(pages)==17; assert all('noindex,nofollow' in p.read_text() and 'preview-guard.js' in p.read_text() for p in pages); q=(d/'quote.html').read_text(); assert 'id=\"quote-submit\" disabled' in q; actions=re.findall(r'<form\\b[^>]*\\baction=\"([^\"]*)',q); assert actions and all(a=='#preview-disabled' for a in actions); assert not list(d.glob('*qa*')); print('PASS: 26 preview source assets exactly match current website, 17 pages guarded/noindex, quotation submission disabled, tracking disabled; hosted ACL/browser access is separate evidence')"])]
env=os.environ.copy();env['PYTHONPATH']=str(ROOT/'analytics/python')
runs=[]
for name,cmd in commands:
    start=now();r=subprocess.run(cmd,cwd=ROOT,env=env,capture_output=True)
    for suffix,raw in [('stdout',r.stdout),('stderr',r.stderr)]:
        with (OUT/(name+'.'+suffix+'.txt')).open('xb') as f:f.write(raw)
    record={'test_suite':name,'command':cmd,'started_at':start,'ended_at':now(),'exit_code':r.returncode,'status':'PASS' if r.returncode==0 else 'FAIL','stdout_sha256':sha(r.stdout),'stderr_sha256':sha(r.stderr)}
    write(name+'.json',record);runs.append(record)
    print(name+': '+record['status'],flush=True)
after=inventory();write('source-after.json',after)
record={'record_type':'final_integrated_local_verification','run_id':OUT.name,'source_head':subprocess.check_output(['git','rev-parse','HEAD']).decode().strip(),'implementation_committed':False,'report_timezone':'America/New_York','environment':'local synthetic; no live collector, email submissions or external API requests in this run','node':subprocess.check_output(['node','--version']).decode().strip(),'python':subprocess.check_output(['python3','--version']).decode().strip(),'source_inventory_scope':'git-visible website/configuration/implementation/tests excluding docs, evidence directories and independent review records','source_file_count':len(before),'source_unchanged':before==after,'source_inventory_sha256':sha((OUT/'source-before.json').read_bytes()),'cases_are_not_acceptance_case_count':True,'runs':runs}
write('execution.json',record)
print('EVIDENCE='+str(OUT.relative_to(ROOT)))
print('SOURCE_UNCHANGED='+str(record['source_unchanged']))
sys.exit(0 if all(r['exit_code']==0 for r in runs) and before==after else 1)
