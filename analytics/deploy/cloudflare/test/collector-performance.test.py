import base64
import contextlib
import gzip
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import unittest
from unittest.mock import patch
import uuid

SPEC = importlib.util.spec_from_file_location('collector_performance', Path(__file__).with_name('collector-performance.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
EVIDENCE = Path(os.environ.get('FARPOINT_TEST_EVIDENCE_DIR', Path(__file__).parent / 'evidence')) / ('perf-fixtures-' + uuid.uuid4().hex)
EVIDENCE.mkdir(parents=True, exist_ok=False)
sys.path.insert(0, str(Path(__file__).parents[3] / 'python'))
from farpoint_analytics.schema import validate_envelope, validate_event
from farpoint_analytics.canonical import InvalidData


class Clock:
    value = 0
    def now(self):
        return self.value
    def sleep(self, seconds):
        self.value += seconds


class PerformanceTests(unittest.TestCase):
    def test_fixed_plan_is_1108_synthetic_only_original_bodies_with_boundary_sizes(self):
        cases = MODULE.plan('123456-1')
        self.assertEqual(len(cases), 1108)
        self.assertEqual(len({x['id'] for x in cases}), 1108)
        self.assertEqual(sum(x['phase'] == 'normal' for x in cases), 600)
        self.assertEqual(sum(x['phase'] == 'burst' for x in cases), 500)
        by_id = {x['id']: x for x in cases}
        self.assertEqual(len(by_id['size-32767']['body']), 32767)
        self.assertEqual(len(by_id['chunked-over-limit']['body']), 32769)
        self.assertEqual(by_id['false-length-one']['headers'], ['Content-Length: 1'])
        self.assertIn('Transfer-Encoding: chunked', by_id['absent-length-chunked']['headers'])
        for case in cases:
            body = gzip.decompress(case['body']) if case['id'] == 'gzip-unsupported' else case['body']
            envelope = json.loads(body)
            if case['id'] == 'events-51':
                with self.assertRaises(InvalidData):
                    validate_envelope(envelope)
            else:
                validate_envelope(envelope)
            for event in envelope['events']:
                validate_event(event)
                self.assertIs(event['synthetic'], True)
                self.assertEqual(event['event_name'], 'page_view')
                self.assertNotIn('browser_id', event)
        MODULE.new_json(EVIDENCE / 'planned-inputs.json', [{**x, 'body': base64.b64encode(x['body']).decode()} for x in cases])

    def test_pacer_limits_rolling_rate_without_catchup_or_late_dispatch(self):
        for rate, duration, count in [(10, 60, 600), (50, 10, 500)]:
            clock = Clock()
            limiter = MODULE.Pacer(rate, duration, 0, clock.now, clock.sleep)
            starts = [limiter.admit(index, threading.Event()) for index in range(count)]
            self.assertTrue(all(x is not None and x < duration for x in starts))
            for start in starts:
                self.assertLessEqual(sum(start <= item < start + 1 - 1e-9 for item in starts), rate)
            clock.value = duration
            self.assertIsNone(limiter.admit(count, threading.Event()))
        stopped = threading.Event();stopped.set()
        self.assertIsNone(MODULE.Pacer(10, 60, 0).admit(0, stopped))

    def test_post_admission_delay_is_checked_before_dispatch_and_original_is_preserved(self):
        clock, calls = Clock(), []
        experiment = MODULE.Experiment(EVIDENCE / 'late-dispatch', '123-1', lambda *a, **k: calls.append(a), clock.now)
        pacer = MODULE.Pacer(10, 60, 0, clock.now, clock.sleep)
        def admitted_then_delayed(index, stop):
            clock.value = 60.01
            return 59.9
        case = MODULE.plan('123-1')[0]
        with patch.object(pacer, 'admit', side_effect=admitted_then_delayed):
            result = experiment.perform(case, pacer)
        self.assertFalse(result['dispatched'])
        self.assertEqual(result['admission_offset_seconds'], 59.9)
        self.assertEqual(result['dispatch_check_offset_seconds'], 60.01)
        self.assertEqual(result['reason'], 'stopped_or_deadline_before_dispatch')
        self.assertEqual(calls, [])
        self.assertEqual((experiment.directory / (case['id'] + '.request.bin')).read_bytes(), case['body'])
        summary = MODULE.summarize(experiment.results)['profiles']['normal']
        self.assertEqual(summary['dispatched'], 0)
        self.assertEqual(summary['exact_acknowledgements'], 0)

    def test_dispatch_timing_is_distinct_from_admission_and_jitter_is_not_rounded_away(self):
        clock = Clock()
        def curl(command, **kwargs):
            clock.value += .1
            MODULE.new_bytes(Path(command[command.index('--output') + 1]), MODULE.encode({
                'status': 'retained', 'terminal': True, 'analytical_status': 'not_evaluated',
                'receipt_id': 'timing-receipt-123', 'receipt_body_sha256': MODULE.digest(kwargs['input'])}))
            return subprocess.CompletedProcess(command, 0, b'{"http_code":202}', b'')
        experiment = MODULE.Experiment(EVIDENCE / 'dispatch-timing', '123-1', curl, clock.now)
        pacer = MODULE.Pacer(10, 60, 0, clock.now, clock.sleep)
        def admitted_then_delayed(index, stop):
            clock.value = .7
            return .2
        with patch.object(pacer, 'admit', side_effect=admitted_then_delayed):
            result = experiment.perform(MODULE.plan('123-1')[0], pacer)
        self.assertEqual(result['admission_offset_seconds'], .2)
        self.assertEqual(result['dispatch_offset_seconds'], .7)
        self.assertNotIn('start_offset_seconds', result)
        summary = MODULE.summarize(experiment.results)['profiles']['normal']
        self.assertEqual(summary['first_dispatch_offset_seconds'], .7)
        self.assertEqual(summary['dispatch_measurement'], 'client_pre_request_call_not_wire_arrival')
        self.assertEqual(MODULE.rolling_second_max([0, .5, 1]), 2)
        self.assertEqual(MODULE.rolling_second_max([0, .5, .99999999]), 3)

    def test_canonical_ack_requires_actual_body_hash_and_errors_are_not_reflected(self):
        h = 'a' * 64
        raw = MODULE.encode({'status': 'retained', 'terminal': True, 'analytical_status': 'not_evaluated', 'receipt_id': 'synthetic-12345', 'receipt_body_sha256': h, 'unexpected_private_text': '192.0.2.8'})
        good = MODULE.response_summary(202, raw, b'', h)
        self.assertTrue(good['canonical_receipt'])
        self.assertTrue(good['exact_body_ack'])
        self.assertNotIn('192.0.2.8', json.dumps(good))
        self.assertFalse(MODULE.response_summary(202, raw, b'', 'b' * 64)['exact_body_ack'])
        self.assertFalse(MODULE.response_summary(202, b'{"status":"retained"}', b'', h)['canonical_receipt'])
        rejected = MODULE.response_summary(503, b'private error 192.0.2.9', b'Retry-After: 5\r\n', h)
        self.assertTrue(rejected['explicit_retryable_response'])
        self.assertNotIn('192.0.2.9', json.dumps(rejected))

    def test_request_preserves_original_and_raw_response_privately_no_header_disguise(self):
        observed = []
        def curl(command, **kwargs):
            observed.append(command)
            MODULE.new_bytes(Path(command[command.index('--dump-header') + 1]), b'HTTP/1.1 202 Accepted\r\nX-Private-Test: 192.0.2.11\r\n\r\n')
            ack = MODULE.encode({'status': 'retained', 'terminal': True, 'analytical_status': 'not_evaluated', 'receipt_id': 'synthetic-receipt-123', 'receipt_body_sha256': MODULE.digest(kwargs['input'])})
            MODULE.new_bytes(Path(command[command.index('--output') + 1]), ack)
            return subprocess.CompletedProcess(command, 0, b'{"http_code":202,"local_ip":"192.0.2.12"}', b'')
        directory = EVIDENCE / 'request-success'
        experiment = MODULE.Experiment(directory, '123-1', curl)
        case = MODULE.plan('123-1')[0]
        result = experiment.perform(case)
        self.assertTrue(result['exact_body_ack'])
        self.assertEqual((directory / (case['id'] + '.request.bin')).read_bytes(), case['body'])
        self.assertNotIn('192.0.2.', json.dumps(result))
        command = observed[0]
        self.assertEqual(command[1], '--disable')
        self.assertIn('--ipv4', command)
        self.assertNotIn('--retry', command)
        self.assertNotIn('--insecure', command)
        self.assertNotIn('--location', command)
        self.assertNotIn('--noproxy', command)
        self.assertNotIn('--user-agent', command)
        self.assertTrue(any(x == 'Origin: https://farpointenergy.com' for x in command))
        self.assertFalse(any('Authorization:' in x or 'oai-' in x or 'CF-Connecting-IP:' in x for x in command))
        with self.assertRaises(ValueError):
            experiment.perform({**case, 'id': 'wrong-url'}, url='https://formsubmit.co/anything')

    def test_security_block_stops_future_requests_and_preserves_blocked_originals(self):
        calls = []
        def curl(command, **kwargs):
            calls.append(command)
            MODULE.new_bytes(Path(command[command.index('--dump-header') + 1]), b'HTTP/1.1 403 Forbidden\r\n\r\n')
            MODULE.new_bytes(Path(command[command.index('--output') + 1]), b'error code: 1010\nprivate address 192.0.2.14')
            return subprocess.CompletedProcess(command, 0, b'{"http_code":403}', b'')
        experiment = MODULE.Experiment(EVIDENCE / 'security-block', '123-1', curl)
        first, second = MODULE.plan('123-1')[:2]
        a, b = experiment.perform(first), experiment.perform(second)
        self.assertTrue(a['security_block'])
        self.assertFalse(b['dispatched'])
        self.assertEqual(len(calls), 1)
        self.assertEqual((experiment.directory / (second['id'] + '.request.bin')).read_bytes(), second['body'])
        self.assertNotIn('192.0.2.14', json.dumps(MODULE.summarize(experiment.results)))

    def test_plaintext_is_not_in_transfer_directory_and_encryption_has_fixed_recipient(self):
        source = EVIDENCE / 'sealing-private';source.mkdir()
        MODULE.new_bytes(source / 'raw-response.bin', b'PRIVATE_FIXTURE_SENTINEL_192.0.2.15')
        transfer = EVIDENCE / 'sealing-transfer'
        cert = Path(__file__).with_name('performance-recipient-public.pem')
        MODULE.seal(source, transfer, cert)
        self.assertEqual({x.name for x in transfer.iterdir()}, {'private-evidence.cms', 'encrypted-evidence-manifest.json'})
        encrypted = (transfer / 'private-evidence.cms').read_bytes()
        self.assertNotIn(b'PRIVATE_FIXTURE_SENTINEL', encrypted)
        manifest = json.loads((transfer / 'encrypted-evidence-manifest.json').read_text())
        self.assertEqual(MODULE.digest(encrypted), manifest['ciphertext_sha256'])
        self.assertNotIn(b'PRIVATE KEY', cert.read_bytes())
        self.assertTrue(source.exists())

    def test_no_go_no_network_and_no_plaintext_exception_output(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = MODULE.main({})
        self.assertEqual(code, 1)
        self.assertEqual(json.loads(output.getvalue())['status'], 'held_no_explicit_go')

    def test_main_cannot_pass_interrupted_or_undispatched_boundary_after_successful_profiles(self):
        original = MODULE.Experiment
        for mode, expected_exit, interrupted, complete in [
            ('complete', 0, False, True),
            ('interrupt-before-boundary', 1, True, False),
            ('skip-boundary', 1, False, False),
            ('interrupt-after-last-result', 1, True, True),
        ]:
            with self.subTest(mode=mode):
                class OfflineExperiment(original):
                    def get(self, name, url):
                        row = {'id': name, 'phase': 'availability', 'http_status': 404 if 'probe' in name else 200,
                               'quotation_form_markup_present': True}
                        self.results.append(row)
                        return row
                    def profile(self, cases, rate, duration, during=None):
                        for case in cases:
                            self.results.append({'id': case['id'], 'phase': case['phase'], 'index': case['index'],
                                'dispatched': True, 'canonical_receipt': True, 'exact_body_ack': True, 'curl_exit_code': 0,
                                'ack_latency_seconds': .01, 'admission_offset_seconds': case['index'] / rate,
                                'dispatch_offset_seconds': case['index'] / rate, 'explicit_retryable_response': False,
                                'security_block': False})
                        if during:
                            self.get(during, MODULE.QUOTE)
                    def perform(self, case, **kwargs):
                        if mode == 'interrupt-before-boundary':
                            raise RuntimeError('private interruption sentinel 192.0.2.22')
                        self.results.append({'id': case['id'], 'phase': 'boundary', 'dispatched': mode != 'skip-boundary',
                                             'http_status': 202 if mode != 'skip-boundary' else None,
                                             'curl_exit_code': 0 if mode != 'skip-boundary' else None})
                        if mode == 'interrupt-after-last-result' and case['id'] == 'gzip-unsupported':
                            raise RuntimeError('private late interruption sentinel 192.0.2.23')
                root = EVIDENCE / ('main-' + mode)
                env = {'FARPOINT_PERF_GO': 'reviewed-1108-candidate-posts', 'GITHUB_ACTIONS': 'true',
                       'RUNNER_ENVIRONMENT': 'github-hosted', 'GITHUB_REPOSITORY': 'FarpointEnergy/farpointenergy.com',
                       'GITHUB_RUN_ID': '123456', 'GITHUB_RUN_ATTEMPT': '1', 'RUNNER_TEMP': str(root)}
                output = io.StringIO()
                def fake_seal(directory, transfer, certificate):
                    transfer.mkdir(parents=True, exist_ok=False)
                with patch.object(MODULE, 'Experiment', OfflineExperiment), patch.object(MODULE, 'seal', side_effect=fake_seal), contextlib.redirect_stdout(output):
                    exit_code = MODULE.main(env)
                self.assertEqual(exit_code, expected_exit)
                summary = json.loads(output.getvalue())
                self.assertEqual(summary['test_interrupted'], interrupted)
                self.assertEqual(summary['all_boundary_attempts_completed'], complete)
                self.assertEqual(summary['profiles']['normal']['exact_acknowledgements'], 600)
                self.assertEqual(summary['profiles']['burst']['exact_acknowledgements'], 500)
                self.assertNotIn('192.0.2.', output.getvalue())

    def test_percentiles_are_nearest_rank_and_first_request_does_not_claim_forced_cold_start(self):
        self.assertEqual(MODULE.percentile(list(range(1, 101)), .95), 95)
        self.assertEqual(MODULE.percentile(list(range(1, 101)), .99), 99)
        summary = MODULE.summarize([])
        self.assertFalse(summary['profiles']['normal']['cold_start_controlled'])
        self.assertTrue(summary['storage_reconciliation_pending'])

    def test_capacity_response_stops_dispatch_instead_of_ignoring_retry_after(self):
        calls = []
        def curl(command, **kwargs):
            calls.append(command)
            MODULE.new_bytes(Path(command[command.index('--dump-header') + 1]), b'HTTP/1.1 503 Unavailable\r\nRetry-After: 5\r\n\r\n')
            MODULE.new_bytes(Path(command[command.index('--output') + 1]), b'{"status":"retry","reason":"durability_unconfirmed"}')
            return subprocess.CompletedProcess(command, 0, b'{"http_code":503}', b'')
        experiment = MODULE.Experiment(EVIDENCE / 'capacity-stop', '123-1', curl)
        a, b = MODULE.plan('123-1')[:2]
        first, second = experiment.perform(a), experiment.perform(b)
        self.assertTrue(first['explicit_retryable_response'])
        self.assertFalse(second['dispatched'])
        self.assertEqual(len(calls), 1)

    def test_workflow_requires_explicit_live_go_and_uploads_only_transfer_directory(self):
        text = (Path(__file__).parents[4] / '.github/workflows/collector-performance.yml').read_text()
        self.assertIn('[farpoint-perf-go]', text)
        self.assertIn('default: false', text)
        self.assertIn('path: ${{ runner.temp }}/farpoint-performance-transfer/', text)
        self.assertNotIn('path: ${{ runner.temp }}/farpoint-performance-', text.replace('path: ${{ runner.temp }}/farpoint-performance-transfer/', ''))
        self.assertNotIn('secrets.', text)
        self.assertNotIn('schedule:', text)
        self.assertIn('overwrite: false', text)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            code = MODULE.main({'FARPOINT_PERF_GO': 'reviewed-1108-candidate-posts', 'GITHUB_ACTIONS': 'true', 'RUNNER_ENVIRONMENT': 'github-hosted', 'GITHUB_REPOSITORY': 'FarpointEnergy/farpointenergy.com', 'HTTPS_PROXY': 'private-proxy-must-not-print'})
        self.assertEqual(code, 1)
        self.assertNotIn('private-proxy-must-not-print', output.getvalue())
        self.assertEqual(json.loads(output.getvalue())['status'], 'blocked_proxy_environment_present')


if __name__ == '__main__':
    result = unittest.main(exit=False)
    print('Append-only synthetic test evidence: ' + str(EVIDENCE))
    sys.exit(0 if result.result.wasSuccessful() else 1)
