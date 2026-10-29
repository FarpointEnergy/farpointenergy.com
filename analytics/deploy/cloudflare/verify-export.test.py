"""Readback-verifier fault cases; all fixture copies remain on disk."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import unittest
import uuid

spec = importlib.util.spec_from_file_location('farpoint_verify_export', Path(__file__).with_name('verify-export.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def encoded(value):
    return json.dumps(value, separators=(',', ':')).encode()


def digest(value):
    return hashlib.sha256(value).hexdigest()


def b64(value):
    return base64.b64encode(value).decode()


def original_files():
    files, inventory, requests = {}, [], []
    body = b'\xff synthetic raw submission\n'
    for index, name in enumerate(['json', 'duplicate'], 1):
        receipt_id = f'synthetic-receipt-{index:04}'
        key = f'receipts/2026/10/26/{receipt_id}.json'
        record = {'receipt_id': receipt_id, 'body_base64': b64(body), 'body_bytes': len(body), 'receipt_body_sha256': digest(body)}
        raw = encoded(record)
        files['export/objects/' + key] = raw
        inventory.append({'key': key, 'local_path': 'objects/' + key, 'size': len(raw), 'sha256': digest(raw)})
        response = {'status': 'retained', 'receipt_id': receipt_id, 'receipt_body_sha256': digest(body)}
        requests.append((name, body, 202, response))
    key = 'rejections/2026/10/26/synthetic-rejection-0001.json'
    raw = encoded({'body_preserved': False, 'reason': 'unsupported_content_type'})
    files['export/objects/' + key] = raw
    inventory.append({'key': key, 'local_path': 'objects/' + key, 'size': len(raw), 'sha256': digest(raw)})
    requests.append(('unsupported-type', b'synthetic rejected bytes', 415, {'status': 'rejected', 'reason': 'unsupported_content_type', 'rejection_metadata_recorded': True}))
    for index, (name, sent, status, response) in enumerate(requests, 1):
        response_bytes = encoded(response)
        files[f'http/{index:02}-{name}.json'] = encoded({'name': name, 'passed': True, 'status': status, 'request_body_base64': b64(sent), 'request_body_sha256': digest(sent), 'response_body_base64': b64(response_bytes), 'response_body_sha256': digest(response_bytes), 'response_json': response})
    files['export/inventory.json'] = encoded(inventory)
    files['baseline.json'] = encoded([{'items': inventory}])
    return files


class ExportVerificationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        output = os.environ.get('FARPOINT_TEST_EVIDENCE_DIR')
        cls.root = (Path(output) if output else Path(__file__).parent / 'evidence') / ('verify-export-fixtures-' + str(uuid.uuid4()))
        cls.root.mkdir(parents=True, exist_ok=False)
        cls.files = original_files()
        cls.persist('original', cls.files)

    @classmethod
    def persist(cls, name, files):
        root = cls.root / name
        for relative, body in files.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            with path.open('xb') as handle:
                handle.write(body)
        return root

    def check_case(self, mutate=None):
        files = dict(self.files)
        if mutate:
            mutate(files)
        root = self.persist(self._testMethodName, files)
        return module.verify(root / 'http', root / 'export', root / 'baseline.json')

    def test_exact_bytes_duplicate_attempts_and_rejection_pass(self):
        result = self.check_case()
        self.assertEqual(result['status'], 'PASS')
        self.assertEqual(result['accepted_http_receipts_exact'], 2)
        self.assertEqual(result['prior_listed_objects_unchanged'], 3)
        self.assertTrue(result['duplicate_receipts_distinct'])

    def test_changed_exported_object_fails(self):
        def mutate(files):
            key = next(k for k in files if k.startswith('export/objects/receipts/'))
            files[key] += b' '
        with self.assertRaisesRegex(ValueError, 'exported_object_integrity_mismatch'):
            self.check_case(mutate)

    def test_missing_object_fails_without_deleting_original(self):
        def mutate(files):
            files.pop(next(k for k in files if k.startswith('export/objects/receipts/')))
        with self.assertRaises(FileNotFoundError):
            self.check_case(mutate)

    def test_changed_archived_request_body_fails(self):
        def mutate(files):
            value = json.loads(files['http/01-json.json'])
            value['request_body_base64'] = b64(b'different body')
            files['http/01-json.json'] = encoded(value)
        with self.assertRaisesRegex(ValueError, 'archived_http_request_hash_mismatch'):
            self.check_case(mutate)

    def test_detached_response_json_cannot_override_hashed_response(self):
        def mutate(files):
            value = json.loads(files['http/01-json.json'])
            value['response_json']['receipt_id'] = 'synthetic-receipt-0002'
            files['http/01-json.json'] = encoded(value)
        with self.assertRaisesRegex(ValueError, 'archived_http_response_json_mismatch'):
            self.check_case(mutate)

    def test_duplicate_inventory_key_fails(self):
        def mutate(files):
            value = json.loads(files['export/inventory.json'])
            value.append(value[0])
            files['export/inventory.json'] = encoded(value)
        with self.assertRaisesRegex(ValueError, 'duplicate_or_mismatched_local_path'):
            self.check_case(mutate)

    def test_changed_prior_object_metadata_fails(self):
        def mutate(files):
            value = json.loads(files['baseline.json'])
            value[0]['items'][0]['sha256'] = 'f' * 64
            files['baseline.json'] = encoded(value)
        with self.assertRaisesRegex(ValueError, 'prior_object_changed_or_missing'):
            self.check_case(mutate)

    def test_rehashed_outer_receipt_cannot_hide_different_inner_submitted_bytes(self):
        def mutate(files):
            inventory = json.loads(files['export/inventory.json'])
            item = inventory[0]
            path = 'export/' + item['local_path']
            record = json.loads(files[path])
            record['body_base64'] = b64(b'changed')
            record['body_bytes'] = len(b'changed')
            record['receipt_body_sha256'] = digest(b'changed')
            files[path] = encoded(record)
            item['size'], item['sha256'] = len(files[path]), digest(files[path])
            files['export/inventory.json'] = encoded(inventory)
            files['baseline.json'] = encoded([{'items': inventory}])
        with self.assertRaisesRegex(ValueError, 'http_to_receipt_bytes_mismatch'):
            self.check_case(mutate)

    @classmethod
    def tearDownClass(cls):
        print('Synthetic verifier fixtures retained:', cls.root)


if __name__ == '__main__':
    unittest.main()
