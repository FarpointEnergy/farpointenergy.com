import base64
import contextlib
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch
import uuid

SPEC = importlib.util.spec_from_file_location('github_ip_proof', Path(__file__).with_name('github-ip-proof.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
ENV = {'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted',
       'GITHUB_REPOSITORY': 'FarpointEnergy/farpointenergy.com', 'GITHUB_RUN_ID': '123456789',
       'GITHUB_RUN_ATTEMPT': '1', 'GITHUB_SHA': 'a' * 40}
IP = '192.0.2.60'
STORED_BODIES = []


def result(body, status=200, code=0, stderr=b''):
    return {'body': body, 'http_status': status, 'curl_exit_code': code, 'stderr': stderr}


def acknowledged():
    return result(json.dumps({'status': 'retained', 'terminal': True, 'ip_provenance_verified': False,
                              'proof_key': 'ip-proof/2026/10/27/synthetic-12345678.json',
                              'proof_sha256': 'f' * 64}).encode(), status=202)


class ProbeTests(unittest.TestCase):
    def mock_requests(self, *, second_ip=IP, first=None, second=None, ack=None):
        calls = []

        def request(url, body=None):
            calls.append((url, body))
            if url == MODULE.COLLECTOR:
                STORED_BODIES.append(body)
                return ack if ack is not None else acknowledged()
            if url == MODULE.DIAGNOSTICS[0][1]:
                return first if first is not None else result(json.dumps({'ip': IP}).encode())
            if url == MODULE.DIAGNOSTICS[1][1]:
                return second if second is not None else result(('fl=synthetic\nip=' + second_ip + '\nhttp=http/2\n').encode())
            raise AssertionError('unexpected URL')
        return request, calls

    def test_agreed_ipv4_evidence_is_exact_privately_and_public_summary_contains_no_ip(self):
        request, calls = self.mock_requests()
        safe, code = MODULE.run_probe(ENV, request)
        self.assertEqual(code, 0)
        self.assertEqual([x[0] for x in calls], [*map(lambda x: x[1], MODULE.DIAGNOSTICS), MODULE.COLLECTOR])
        body = calls[-1][1]
        private = json.loads(body)
        self.assertLessEqual(len(body), 4096)
        self.assertEqual(private['expected_ip'], IP)
        self.assertEqual(private['assertion_status'], 'untrusted_client_assertions')
        self.assertEqual(base64.b64decode(private['diagnostics'][0]['body_base64']), json.dumps({'ip': IP}).encode())
        self.assertEqual(safe['submitted_sha256'], hashlib.sha256(body).hexdigest())
        self.assertTrue(safe['retained'])
        self.assertTrue(safe['diagnostics_agree'])
        self.assertFalse(safe['ip_provenance_verified'])
        self.assertNotIn(IP, json.dumps(safe))
        self.assertNotIn('base64', json.dumps(safe))
        self.assertNotIn('body_sha256', json.dumps(safe))
        self.assertTrue(safe['diagnostic_archive_confirmed'])

    def test_disagreement_or_diagnostic_failure_is_saved_but_fails_check(self):
        for options in [{'second_ip': '192.0.2.61'}, {'first': result(b'failure body', status=503)},
                        {'second': result(b'partial response', status=0, code=28, stderr=b'private diagnostic detail')}]:
            with self.subTest(options=options):
                request, calls = self.mock_requests(**options)
                safe, code = MODULE.run_probe(ENV, request)
                self.assertEqual(code, 1)
                self.assertTrue(safe['retained'])
                self.assertFalse(safe['diagnostics_agree'])
                self.assertEqual(len(calls), 3)
                self.assertNotIn('private diagnostic detail', json.dumps(safe))
                self.assertFalse(safe['ip_provenance_verified'])

    def test_proxy_or_wrong_context_is_blocked_without_network_requests(self):
        for delta in [{'HTTPS_PROXY': 'private-proxy-value'}, {'ALL_PROXY': 'private-value'},
                      {'GITHUB_ACTIONS': 'false'}, {'RUNNER_ENVIRONMENT': 'self-hosted'},
                      {'GITHUB_REPOSITORY': 'other/repo'}, {'GITHUB_RUN_ID': 'injected\ncommand'}]:
            with self.subTest(delta=delta):
                request, calls = self.mock_requests()
                safe, code = MODULE.run_probe({**ENV, **delta}, request)
                self.assertEqual(code, 1)
                self.assertEqual(calls, [])
                self.assertNotIn('private-', json.dumps(safe))

    def test_acknowledgement_validation_rejects_invalid_shapes_without_reflection(self):
        for ack in [result(b'private bad response', status=503), result(b'null', status=202),
                    result(b'[]', status=202), result(b'{"status":"retained","proof_key":"192.0.2.80"}', status=202),
                    result(acknowledged()['body'], status=202, code=28)]:
            request, calls = self.mock_requests(ack=ack)
            safe, code = MODULE.run_probe(ENV, request)
            self.assertEqual(code, 1)
            self.assertFalse(safe['retained'])
            self.assertFalse(safe['diagnostic_archive_confirmed'])
            self.assertIsNone(safe['proof_key'])
            self.assertNotIn('private bad response', json.dumps(safe))
            self.assertNotIn('192.0.2.80', json.dumps(safe))

    def test_oversized_diagnostic_prefix_and_hash_are_saved_but_never_pass(self):
        first = result(json.dumps({'ip': IP, 'extra': 'a' * 700}).encode(), stderr=b'z' * 200)
        request, calls = self.mock_requests(first=first)
        safe, code = MODULE.run_probe(ENV, request)
        self.assertEqual(code, 1)
        self.assertTrue(safe['retained'])
        self.assertFalse(safe['diagnostic_archive_confirmed'])
        self.assertLessEqual(len(calls[-1][1]), 4096)
        diagnostic = json.loads(calls[-1][1])['diagnostics'][0]
        self.assertTrue(diagnostic['body_truncated'])
        self.assertTrue(diagnostic['stderr_truncated'])
        self.assertEqual(len(base64.b64decode(diagnostic['body_base64'])), 512)
        self.assertEqual(diagnostic['body_sha256'], hashlib.sha256(first['body']).hexdigest())

    def test_curl_uses_ipv4_tls_fixed_urls_and_stdin_body_without_echo(self):
        captures = []

        def fake_run(command, **kwargs):
            captures.append((command, kwargs))
            return subprocess.CompletedProcess(command, 0, b'{"ip":"192.0.2.80"}' + MODULE.STATUS_MARKER + b'200', b'')
        response = MODULE.curl_request(MODULE.COLLECTOR, b'{"synthetic":true}', run=fake_run)
        command, options = captures[0]
        self.assertIn('--ipv4', command)
        self.assertIn('--silent', command)
        self.assertEqual(command[1], '--disable')
        self.assertIn('=https', command)
        self.assertNotIn('--insecure', command)
        self.assertNotIn('--noproxy', command)
        self.assertNotIn('--location', command)
        self.assertIn('@-', command)
        self.assertEqual(options['input'], b'{"synthetic":true}')
        self.assertTrue(options['capture_output'])
        self.assertEqual(response['http_status'], 200)
        self.assertEqual(response['body'], b'{"ip":"192.0.2.80"}')
        with self.assertRaises(ValueError):
            MODULE.curl_request('https://arbitrary.example.invalid', run=fake_run)
        with self.assertRaises(ValueError):
            MODULE.curl_request(MODULE.DIAGNOSTICS[0][1], b'body', run=fake_run)
        with self.assertRaises(ValueError):
            MODULE.curl_request(MODULE.COLLECTOR, b'x' * 4097, run=fake_run)

    def test_exception_does_not_reach_public_stdout_or_traceback(self):
        output = io.StringIO()
        with patch.object(MODULE, 'run_probe', side_effect=RuntimeError('private IP 192.0.2.99')), contextlib.redirect_stdout(output):
            code = MODULE.main()
        self.assertEqual(code, 1)
        self.assertNotIn('192.0.2.99', output.getvalue())
        self.assertNotIn('Traceback', output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['status'], 'unexpected_test_failure')

    def test_workflow_is_pinned_readonly_and_has_no_secrets_or_artifact_upload(self):
        workflow = Path(__file__).parents[4] / '.github/workflows/synthetic-ip-proof.yml'
        text = workflow.read_text()
        self.assertIn('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1', text)
        self.assertIn('persist-credentials: false', text)
        self.assertIn('contents: read', text)
        self.assertNotIn('${{ secrets.', text)
        self.assertNotIn('uses: actions/upload-artifact', text)
        self.assertNotIn('\n  schedule:', text)
        self.assertNotIn('pull_request_target:', text)


if __name__ == '__main__':
    successful = False
    try:
        successful = unittest.main(exit=False).result.wasSuccessful()
    finally:
        directory = Path(os.environ.get('FARPOINT_TEST_EVIDENCE_DIR', Path(__file__).parent / 'evidence'))
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / ('github-ip-proof-fixtures-' + uuid.uuid4().hex + '.json')
        target.open('x').write(json.dumps({'synthetic_only': True, 'ip_provenance_verified': False,
                                          'submitted_bodies_base64': [base64.b64encode(x).decode() for x in STORED_BODIES]}, indent=2))
        print('Synthetic fixture evidence retained: ' + str(target))
    sys.exit(0 if successful else 1)
