"""Bounded exclusive writes and explicit recovery of every verified prefix."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import unittest
from unittest.mock import patch
import uuid

spec=importlib.util.spec_from_file_location('local_batch_bridge',Path(__file__).parents[1]/'local_bridge.py')
bridge=importlib.util.module_from_spec(spec);spec.loader.exec_module(bridge)


class LocalBatchTests(unittest.TestCase):
    def setUp(self):
        self.root=Path(os.environ.get('FARPOINT_EVIDENCE_TEST_ROOT',Path(__file__).parent/'.evidence'))/str(uuid.uuid4())
        self.root.mkdir(parents=True)

    def rows(self,payloads):
        return [{'path':name,'base64':base64.b64encode(data).decode()} for name,data in payloads]

    def test_exact64_and256KiB_binary_boundary_preserves_exact_request(self):
        payloads=[('run/'+str(i)+'.bin',bytes([i])*4096) for i in range(64)]
        rows=self.rows(payloads);raw=(json.dumps({'files':rows,'op':'create_many'},indent=1)+'\n').encode()
        result=bridge.create_many(self.root,rows,raw)
        self.assertTrue(result['complete']);self.assertEqual(len(result['verified_entries']),64)
        self.assertEqual(Path(result['request_path']).read_bytes(),raw)
        for (name,data),proof in zip(payloads,result['verified_entries']):
            self.assertEqual((self.root/name).read_bytes(),data);self.assertEqual(proof['sha256'],hashlib.sha256(data).hexdigest())

    def test_count_and_decoded_byte_limits_fail_before_target_writes(self):
        cases=[self.rows([(str(i),b'x') for i in range(65)]),self.rows([('large',b'x'*(256*1024+1))])]
        for rows in cases:
            with self.assertRaisesRegex(ValueError,'local_batch_.*_limit'):bridge.create_many(self.root,rows)
        self.assertEqual(list(self.root.iterdir()),[])

    def test_duplicate_and_unsafe_paths_preflight_all_targets(self):
        for bad in ('good','../escape','/absolute','nested/../bad'):
            result=bridge.create_many(self.root,self.rows([('good',b'first'),(bad,b'second')]))
            self.assertFalse(result['complete']);self.assertEqual(result['verified_entries'],[])
            self.assertTrue(Path(result['request_path']).is_file());self.assertFalse((self.root/'good').exists())

    def test_collision_keeps_old_file_verified_prefix_and_full_request(self):
        (self.root/'exists').write_bytes(b'original')
        result=bridge.create_many(self.root,self.rows([('first',b'new'),('exists',b'cannot replace'),('last',b'not yet')]))
        self.assertFalse(result['complete']);self.assertEqual(result['reason'],'FileExistsError')
        self.assertEqual([x['relative_path'] for x in result['verified_entries']],['first'])
        self.assertEqual((self.root/'exists').read_bytes(),b'original');self.assertEqual((self.root/'first').read_bytes(),b'new')
        self.assertFalse((self.root/'last').exists());self.assertTrue(Path(result['failure_path']).is_file())
        captured=json.loads(Path(result['request_path']).read_bytes());self.assertEqual(len(captured['files']),3)

    def test_failure_receipt_error_never_loses_structured_prefix(self):
        (self.root/'exists').write_bytes(b'old');original=bridge.safe_write
        def fail_receipt(root,name,data):
            if name.endswith('/failure.json'):raise ValueError('readback_mismatch')
            return original(root,name,data)
        with patch.object(bridge,'safe_write',side_effect=fail_receipt):
            result=bridge.create_many(self.root,self.rows([('first',b'new'),('exists',b'other')]))
        self.assertFalse(result['complete']);self.assertTrue(result['failure_record_unavailable'])
        self.assertEqual([x['relative_path'] for x in result['verified_entries']],['first'])
        self.assertTrue(Path(result['request_path']).exists())

    def test_mid_write_failure_retains_input_and_earlier_verified_bytes(self):
        original=bridge.safe_write
        def fail_second(root,name,data):
            if name=='second':raise OSError('synthetic I/O failure')
            return original(root,name,data)
        with patch.object(bridge,'safe_write',side_effect=fail_second):
            result=bridge.create_many(self.root,self.rows([('first',b'\x00\xff'),('second',b'unchanged input')]))
        self.assertFalse(result['complete']);self.assertEqual(result['failed_index'],1)
        self.assertEqual((self.root/'first').read_bytes(),b'\x00\xff')
        self.assertEqual(len(json.loads(Path(result['request_path']).read_text())['files']),2)

    def test_readback_failure_cannot_acknowledge_unverified_target(self):
        original=bridge.safe_write
        def bad_readback(root,name,data):
            value=original(root,name,data)
            if name=='second':raise ValueError('readback_mismatch')
            return value
        with patch.object(bridge,'safe_write',side_effect=bad_readback):
            result=bridge.create_many(self.root,self.rows([('first',b'a'),('second',b'b')]))
        self.assertFalse(result['complete']);self.assertEqual(result['reason'],'readback_mismatch')
        self.assertEqual(len(result['verified_entries']),1);self.assertEqual((self.root/'second').read_bytes(),b'b')

    def test_symlink_parent_cannot_redirect_batch_targets(self):
        target=self.root/'outside';target.mkdir();(self.root/'link').symlink_to(target,target_is_directory=True)
        result=bridge.create_many(self.root,self.rows([('prefix',b'a'),('link/would-write',b'b')]))
        self.assertFalse(result['complete']);self.assertEqual(result['reason'],'symlink_path');self.assertFalse((target/'would-write').exists())
        self.assertEqual(result['verified_entries'][0]['relative_path'],'prefix')


if __name__=='__main__':unittest.main()
