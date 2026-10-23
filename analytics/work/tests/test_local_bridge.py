import base64
from email.message import EmailMessage
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
import uuid

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT/'analytics/python'))
spec = importlib.util.spec_from_file_location('bridge', ROOT/'analytics/work/local_bridge.py')
bridge = importlib.util.module_from_spec(spec); spec.loader.exec_module(bridge)


class BridgeTests(unittest.TestCase):
    def test_original_mail_and_duplicate_headers_and_attachment_hash_preserved(self):
        message = EmailMessage(); message['From']='synthetic@example.test'; message['To']='quotes@farpointenergy.com'
        message['Received']='synthetic-hop-one'; message['Received']='synthetic-hop-two'; message.set_content('A test requirement.\n')
        attachment=b'\x00\xffsynthetic attachment'; message.add_attachment(attachment,maintype='application',subtype='octet-stream',filename='requirements.bin')
        raw=message.as_bytes(); result=bridge.normalize_mail({'raw_base64':base64.b64encode(raw).decode(),'connector':{'synthetic':True},'message_id':'m','mailbox':'synthetic@example.test','captured_at':'2026-10-23T20:00:00Z','internal_date':'1792785600000'})
        self.assertTrue(result['complete']); self.assertEqual(result['capture']['rfc2822_sha256'],hashlib.sha256(raw).hexdigest())
        self.assertEqual(len([h for h in result['capture']['headers'] if h['name']=='Received']),2)
        self.assertEqual(result['capture']['attachments'][0]['sha256'],hashlib.sha256(attachment).hexdigest())
        self.assertEqual(base64.b64decode(result['artifacts'][0]['base64']),raw)

    def test_create_only_collision_preserves_original(self):
        root=Path(__file__).parent/'.evidence'/str(uuid.uuid4()); root.mkdir(parents=True)
        path=bridge.safe_write(root,'original.bin',b'original')
        with self.assertRaises(FileExistsError):bridge.safe_write(root,'original.bin',b'replacement')
        self.assertEqual(Path(path).read_bytes(),b'original')

    def test_encoded_path_traversal_and_symlink_rejected(self):
        root=Path(__file__).parent/'.evidence'/str(uuid.uuid4()); root.mkdir(parents=True)
        with self.assertRaises(ValueError):bridge.safe_write(root,'../bad',b'bad')
        (root/'redirect').symlink_to(root,target_is_directory=True)
        with self.assertRaises(ValueError):bridge.safe_write(root,'redirect/bad',b'bad')

    def test_arbitrary_remote_reference_not_downloaded(self):
        with self.assertRaisesRegex(ValueError,'unsupported_reference_host'):
            bridge.reference_bytes({'file_uri':'https://attacker.example/raw'})

    def test_analysis_archives_frozen_source_and_timezone(self):
        root=Path(__file__).parent/'.evidence'/str(uuid.uuid4()); root.mkdir(parents=True)
        result=bridge.analyze({'code_commit':'a'*40,'objects':[],'captures':[],'classifications':[],'config':{'window_start':'2026-10-23T00:00:00Z','window_end':'2026-10-24T00:00:00Z','observation_cutoff':'2026-10-23T20:00:00Z','source_completeness':{'collector':True,'mail':True,'classifications':True}}},root)
        self.assertEqual(result['report']['status'],'complete')
        names={a['name'] for a in result['artifacts']}; self.assertIn('replay/work-source/pipeline.mjs',names); self.assertIn('replay/timezone/America_New_York.tzif',names)
        self.assertIn('inputs/company_observations.json',names)


if __name__=='__main__':unittest.main()
