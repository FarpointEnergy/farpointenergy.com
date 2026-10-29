"""Synthetic-only optional company stage; no paid data, remote calls or activation."""
from pathlib import Path
import base64
import copy
import hashlib
import json
import os
import subprocess
import sys
import tempfile
import unittest
import zipfile

REPO=Path(__file__).resolve().parents[3]
sys.path[:0]=[str(REPO/'analytics/work'),str(REPO/'analytics/python'),str(REPO/'analytics/tests/python')]
import company_stage as stage
from fixtures.dbip import synthetic_mmdb
from fixtures.golden import event, receipt
from test_dbip_archive import fixtures

READER=os.environ.get('FARPOINT_DBIP_READER_SDIST')


def write(path,data):
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.open('xb') as f:f.write(data)
    return {'path':str(path),'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}


def root():
    parent=Path(os.environ.get('FARPOINT_COMPANY_STAGE_EVIDENCE',str(REPO.parent/'farpoint-company-stage-tests')))
    parent.mkdir(parents=True,exist_ok=True)
    return Path(tempfile.mkdtemp(prefix='case-',dir=parent))


def source_bindings():
    names=sorted([stage.PACKAGE_PREFIX+p.name for p in (REPO/stage.PACKAGE_PREFIX).iterdir() if p.suffix in ('.py','.json')]+list(stage.WORK_SOURCES))
    return [{'path':p,**stage._file_info(REPO/p)} for p in names]


def request_fixture(directory):
    artifacts,inputs=fixtures();provider=inputs['provider_config']
    for key in stage.PROVIDER_KEYS:provider[key]['id']='synthetic-private-artifact-'+key
    sources=source_bindings();config=inputs['analysis_config'];config.update(execution_code_commit='a'*40,company_provider=copy.deepcopy(provider),company_source_bindings=copy.deepcopy(sources))
    req={'provider_config':provider,'artifacts':[],'receipts':[],'config':config,'run_id':'synthetic-company-stage','code_commit':'a'*40,'source_bindings':sources,'provenance_evidence':[],'observed_at':inputs['observed_at'],'contradictory_receipt_ids':[]}
    for key in stage.PROVIDER_KEYS:
        name=provider[key]['artifact'];req['artifacts'].append({'key':key,**write(directory/'originals'/name,artifacts[name])})
    for index,r in enumerate(inputs['receipts']):req['receipts'].append(write(directory/'originals'/f'receipt-{index}.json',(json.dumps(r,indent=3)+'\n').encode()))
    req['provenance_evidence'].append({'ref':'synthetic-source-proof',**write(directory/'originals/proof.bin',b'SYNTHETIC TEST ONLY IP provenance evidence; not a real provenance certification')})
    return req


class CompanyGuardTests(unittest.TestCase):
    def test_private_root_rejected_inside_repo_before_any_write(self):
        destination=REPO/'never-create-company-stage'
        with self.assertRaises(stage.StageFailure):stage.run_stage({},destination,REPO)
        self.assertFalse(destination.exists())

    def test_bounded_result_transport_preserves_exact_bytes(self):
        directory=root();value={'status':'ok','result':{'data':'SYNTHETIC-'+('é'*20000)}}
        envelope=json.loads(stage.common.transport_response(directory,{'stream_results':True},value));d=envelope['result_stream'];out=b''
        for offset in range(0,d['bytes'],8192):
            part=stage.common.read_result_chunk(directory,{'path':d['path'],'offset':offset,'max_bytes':8192});chunk=base64.b64decode(part['base64']);self.assertEqual(stage._sha(chunk),part['sha256']);out+=chunk
        self.assertEqual(stage._sha(out),d['sha256']);self.assertEqual(json.loads(out),value)
        with self.assertRaises(stage.StageFailure):stage.common.read_result_chunk(directory,{'path':'../outside','offset':0})

    def test_cli_ready_and_generic_failure_do_not_echo_private_request(self):
        directory=root();secret='SYNTHETIC-DO-NOT-ECHO'
        p=subprocess.run([sys.executable,str(REPO/'analytics/work/company_stage.py'),'--root',str(directory),'--repository',str(REPO)],input=json.dumps({'op':'bad','sentinel':secret})+'\n',capture_output=True,text=True,timeout=15)
        write(directory/'stdout.txt',p.stdout.encode());write(directory/'stderr.txt',p.stderr.encode())
        self.assertEqual(p.returncode,1);self.assertTrue(p.stdout.startswith('READY\n'));self.assertNotIn(secret,p.stdout)
        self.assertEqual(json.loads(p.stdout.splitlines()[1])['reason'],'unsupported_operation')


@unittest.skipUnless(READER,'Pinned offline reader source must be supplied; no automatic package download')
class CompanyStageTests(unittest.TestCase):
    def setUp(self):self.root=root();self.request=request_fixture(self.root)
    def run_stage(self,request=None):return stage.run_stage(request or self.request,self.root/'runs',REPO)
    def verify(self,result):return stage.verify_stage({'archive':result['archive'],'expected_manifest_sha256':result['archive']['manifest_sha256']},self.root/'verifications',REPO)
    def test_exact_raw_inputs_source_full_archive_and_offline_replay(self):
        before=[Path(r['path']).read_bytes() for r in self.request['receipts']]
        result=self.run_stage();self.assertEqual(result['status'],'complete');self.assertEqual(result['summary']['possible_company_matches'],1);self.assertEqual(result['summary']['verified_employers'],0)
        raw=base64.b64decode(result['observations_base64']);self.assertEqual(stage._sha(raw),result['observations_sha256']);rows=json.loads(raw);self.assertIsNone(rows[0]['employer']);self.assertIn('provider_record',rows[0])
        run=Path(result['run_directory']);self.assertEqual((run/'inputs/receipts/00000000.json').read_bytes(),before[0])
        for key in stage.PROVIDER_KEYS:
            spec=self.request['provider_config'][key];self.assertEqual(stage._file_info(run/'provider-artifacts'/spec['artifact']),{k:spec[k] for k in ('bytes','sha256')})
        checked=self.verify(result);self.assertEqual(checked['status'],'verified');self.assertTrue(checked['observations_match']);self.assertEqual(checked['observations_sha256'],result['observations_sha256']);self.assertFalse(checked['independent_os_runtime_recovery'])
        with zipfile.ZipFile(result['archive']['path']) as z:self.assertGreater(len(z.namelist()),100)
        self.assertEqual([Path(r['path']).read_bytes() for r in self.request['receipts']],before)
    def test_production_excludes_marked_synthetic_receipts(self):
        self.request['config'].update(mode='production',fixture_eligible_event_ids=[])
        result=self.run_stage();self.assertEqual(json.loads(base64.b64decode(result['observations_base64'])),[]);self.assertEqual(result['summary']['receipts'],1);self.assertEqual(self.verify(result)['status'],'verified')
    def test_unverified_provenance_remains_unknown(self):
        value=json.loads(Path(self.request['receipts'][0]['path']).read_bytes());value['source_ip']['status']='unverified'
        self.request['receipts']=[write(self.root/'originals/unverified.json',stage._json(value))]
        rows=json.loads(base64.b64decode(self.run_stage()['observations_base64']));self.assertEqual(rows[0]['identity_category'],'unknown');self.assertIsNone(rows[0]['provider_record'])
    def test_ipv6_record_conflict_preserves_raw_context_without_company_claim(self):
        e=event('synthetic-company-ipv6-event');r=receipt('synthetic-company-ipv6-receipt',[e]);r['source_ip']={'status':'verified','provenance':'synthetic-trust','address':'2001:db8::1'}
        self.request['receipts'].append(write(self.root/'originals/ipv6-receipt.json',stage._json(r)))
        self.request['config']['fixture_eligible_event_ids'].append(e['event_id']);self.request['contradictory_receipt_ids']=[r['receipt_id']]
        result=self.run_stage();rows=json.loads(base64.b64decode(result['observations_base64']));self.assertEqual(len(rows),2)
        conflict=next(row for row in rows if row['receipt_ids']==[r['receipt_id']]);self.assertEqual(conflict['identity_category'],'unknown');self.assertIsNone(conflict['company']);self.assertIsNone(conflict['employer']);self.assertEqual(conflict['provider_record']['traits']['organization'],'SYNTHETIC IPv6 Power Plant');self.assertEqual(result['summary']['possible_company_matches'],1)
        self.assertEqual(self.verify(result)['observations_sha256'],result['observations_sha256'])
    def test_missing_source_binding_commit_or_configuration_cannot_run(self):
        variants=[]
        bad=copy.deepcopy(self.request);bad['config'].pop('execution_code_commit');variants.append(bad)
        bad=copy.deepcopy(self.request);bad['source_bindings']=[r for r in bad['source_bindings'] if r['path']!='analytics/work/network_stage.py'];bad['config']['company_source_bindings']=copy.deepcopy(bad['source_bindings']);variants.append(bad)
        bad=copy.deepcopy(self.request);bad['provider_config']['enabled']=False;variants.append(bad)
        bad=copy.deepcopy(self.request);bad['config']['company_provider']['dataset']['id']='changed';variants.append(bad)
        for value in variants:
            with self.subTest(),self.assertRaises(stage.StageFailure) as cm:self.run_stage(value)
            self.assertTrue(Path(cm.exception.failure_directory,'request.json').exists());self.assertFalse(Path(cm.exception.failure_directory,'stage-completed.json').exists())
    def test_source_substitution_and_missing_proof_fail_closed(self):
        for kind in ('source','proof'):
            bad=copy.deepcopy(self.request)
            if kind=='source':bad['source_bindings'][0]['sha256']='0'*64;bad['config']['company_source_bindings']=copy.deepcopy(bad['source_bindings'])
            else:bad['provenance_evidence']=[]
            with self.subTest(kind=kind),self.assertRaises(stage.StageFailure) as cm:self.run_stage(bad)
            self.assertFalse(Path(cm.exception.failure_directory,'stage-completed.json').exists())
    def test_all_raw_receipts_retained_before_malformed_parse_failure(self):
        original=self.request['receipts'][0];bad=write(self.root/'originals/malformed.bin',b'{\xffinvalid')
        self.request['receipts']=[bad,original]
        with self.assertRaises(stage.StageFailure) as cm:self.run_stage()
        directory=Path(cm.exception.failure_directory)
        self.assertEqual((directory/'inputs/receipts/00000000.json').read_bytes(),Path(bad['path']).read_bytes());self.assertEqual((directory/'inputs/receipts/00000001.json').read_bytes(),Path(original['path']).read_bytes())
        self.assertFalse((directory/'stage-completed.json').exists())
    def test_invalid_authorization_preserves_inner_partial_archive(self):
        cfg=self.request['provider_config'];approval_path=Path(next(x['path'] for x in self.request['artifacts'] if x['key']=='approval'));value=json.loads(approval_path.read_bytes());value['approved']=False
        d=write(self.root/'originals/rejected-approval.json',stage._json(value));self.request['artifacts']=[{'key':'approval',**d} if x['key']=='approval' else x for x in self.request['artifacts']];cfg['approval'].update({k:d[k] for k in ('bytes','sha256')});self.request['config']['company_provider']=copy.deepcopy(cfg)
        with self.assertRaises(stage.StageFailure) as cm:self.run_stage()
        directory=Path(cm.exception.failure_directory);self.assertTrue((directory/'company-run/outputs/failure.json').exists());self.assertFalse((directory/'company-run/completed.json').exists());self.assertEqual((directory/'company-run/inputs/artifacts'/cfg['approval']['artifact']).read_bytes(),Path(d['path']).read_bytes())
    def test_download_hash_and_rehashed_inner_tampering_are_rejected(self):
        result=self.run_stage();bad=copy.deepcopy(result);bad['archive']['sha256']='0'*64
        with self.assertRaises(stage.StageFailure):self.verify(bad)
        altered=self.root/'altered.zip'
        with zipfile.ZipFile(result['archive']['path']) as z:entries={name:z.read(name) for name in z.namelist()}
        manifest=json.loads(entries[stage.common.MANIFEST_NAME]);target='inputs/receipts/00000000.json';entries[target]+=b' '
        for r in manifest['files']:
            if r['path']==target:r.update(bytes=len(entries[target]),sha256=stage._sha(entries[target]))
        manifest['total_file_bytes']=sum(r['bytes'] for r in manifest['files']);entries[stage.common.MANIFEST_NAME]=stage._json(manifest)
        with zipfile.ZipFile(altered,'x',compression=zipfile.ZIP_DEFLATED) as z:
            for n,b in entries.items():z.writestr(n,b)
        bad={'archive':{'path':str(altered),**stage._file_info(altered),'manifest_sha256':stage._sha(entries[stage.common.MANIFEST_NAME])}}
        with self.assertRaises(stage.StageFailure):self.verify(bad)
    def test_symlink_artifact_or_private_root_rejected_without_following(self):
        link=self.root/'symlink';link.symlink_to(self.request['artifacts'][0]['path']);self.request['artifacts'][0]['path']=str(link)
        with self.assertRaises(stage.StageFailure):self.run_stage()
        outside=self.root/'outside';outside.mkdir();linked=self.root/'linked-root';linked.symlink_to(outside,target_is_directory=True)
        with self.assertRaises(stage.StageFailure):stage.run_stage(self.request,linked,REPO)
        self.assertEqual(list(outside.iterdir()),[])
    def test_rehashed_archive_cannot_add_unbound_frozen_import_module(self):
        result=self.run_stage();altered=self.root/'unbound-source.zip'
        with zipfile.ZipFile(result['archive']['path']) as z:entries={name:z.read(name) for name in z.namelist()}
        manifest=json.loads(entries[stage.common.MANIFEST_NAME]);name='frozen-source/UNBOUND_SYNTHETIC_MODULE.py';data=b'raise RuntimeError("This unbound synthetic source must never execute")\n';entries[name]=data
        manifest['files'].append({'path':name,'bytes':len(data),'sha256':stage._sha(data)});manifest['file_count']+=1;manifest['total_file_bytes']+=len(data);entries[stage.common.MANIFEST_NAME]=stage._json(manifest)
        with zipfile.ZipFile(altered,'x',compression=zipfile.ZIP_DEFLATED) as z:
            for name,data in entries.items():z.writestr(name,data)
        bad={'archive':{'path':str(altered),**stage._file_info(altered),'manifest_sha256':stage._sha(entries[stage.common.MANIFEST_NAME])}}
        with self.assertRaisesRegex(stage.StageFailure,'company_frozen_source_set_mismatch'):self.verify(bad)


if __name__=='__main__':unittest.main()
