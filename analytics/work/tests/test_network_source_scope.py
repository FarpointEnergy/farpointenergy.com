"""Exact-source scope, unchanged raw bytes, and replay enforcement checks."""
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import test_network_stage as fixtures
from test_network_stage import ROOT, encode, fixture, saved, stage


VERSION = 'farpoint-cloudflare-collector/1.0.0+' + 'a' * 64


def scoped_fixture(root, *, status='verified', version=VERSION, provenance='cloudflare_direct_edge_v1'):
    request, _ = fixture(root)
    receipt = json.loads(Path(request['receipts'][0]['path']).read_bytes())
    receipt['source_ip'] = {'status': status, 'provenance': provenance, 'address': '192.0.2.1'}
    receipt['collector_version'] = version
    request['receipts'] = [saved(root, 'scoped-receipt.json', b' \n' + encode(receipt) + b'\n')]
    request['config']['verified_ip_provenances'] = {'cloudflare_direct_edge_v1': ['synthetic-independent-proof']}
    request['config']['verified_ip_source_scope'] = {
        'schema_version': 1, 'provenance': 'cloudflare_direct_edge_v1',
        'hostname': 'synthetic.example.invalid', 'cloudflare_account_id': 'a' * 32,
        'cloudflare_bucket_name': 'synthetic-bucket', 'collector_versions': [VERSION],
        'evidence_refs': ['synthetic-independent-proof']}
    return request


class NetworkSourceScopeTests(unittest.TestCase):
    setUp = fixtures.NetworkStageTests.setUp
    assert_failure = fixtures.NetworkStageTests.assert_failure

    def test_scoped_lookup_and_fresh_replay_preserve_exact_input(self):
        request = scoped_fixture(self.root)
        path = Path(request['receipts'][0]['path']); original = path.read_bytes()
        result = stage.run_stage(request, self.root, ROOT)
        self.assertEqual(result['observations'][0]['network_organization'], 'SYNTHETIC NETWORK')
        self.assertTrue(result['observations'][0]['ip_provenance_verified'])
        verify = {'op': 'verify', 'archive': result['archive'],
                  'expected_manifest_sha256': result['archive']['manifest_sha256']}
        with patch.object(stage, '_validate_cloudflare_source_scope', wraps=stage._validate_cloudflare_source_scope) as guard:
            replay = stage.verify_stage(verify, self.root, ROOT)
            self.assertGreaterEqual(guard.call_count, 1)
        self.assertEqual(replay['status'], 'verified')
        self.assertEqual(path.read_bytes(), original)

    def test_unknown_verified_version_keeps_failure_and_raw_receipt(self):
        request = scoped_fixture(self.root, version='farpoint-cloudflare-collector/1.0.0+'+'b'*64)
        original = Path(request['receipts'][0]['path']).read_bytes()
        failed = self.assert_failure(request, 'network_source_version_unreviewed')
        self.assertEqual((failed/'inputs/receipts/00000000.json').read_bytes(), original)
        self.assertFalse((failed/'network-run').exists())

    def test_unavailable_source_is_not_retroactively_promoted(self):
        request = scoped_fixture(self.root, status='unavailable', version='legacy-unverified')
        result = stage.run_stage(request, self.root, ROOT)
        self.assertFalse(result['observations'][0]['ip_provenance_verified'])
        self.assertIsNone(result['observations'][0]['network_organization'])

    def test_missing_source_scope_fails_closed(self):
        request = scoped_fixture(self.root)
        del request['config']['verified_ip_source_scope']
        self.assert_failure(request, 'network_source_scope_unverified')

    def test_scope_with_wrong_proof_or_wildcard_version_is_rejected(self):
        request = scoped_fixture(self.root)
        original = copy.deepcopy(request['config']['verified_ip_source_scope'])
        for field, value in [('evidence_refs', ['invented-proof']), ('collector_versions', ['*']),
                             ('collector_versions', [VERSION, VERSION]), ('schema_version', True),
                             ('schema_version', 1.0)]:
            request['config']['verified_ip_source_scope'] = {**original, field: value}
            self.assert_failure(request, 'network_source_scope_unverified')


if __name__ == '__main__':
    unittest.main()
