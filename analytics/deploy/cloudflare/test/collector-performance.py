#!/usr/bin/env python3
"""Bounded, one-shot candidate acceptance test; never run before root GO.

600 normal + 500 burst + 8 boundary POST attempts maximum. No automatic retry,
redirect, proxy bypass, identity header, RFQ, deletion or production activation.
Raw request/response evidence is encrypted before GitHub artifact transfer.
"""
import base64
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import threading
import time
import uuid

HOST = 'https://farpoint-lead-collector-candidate.farpointenergy.workers.dev'
INTAKE = HOST + '/v1/events'
QUOTE = 'https://farpointenergy.com/quote.html'
ORIGIN = 'https://farpointenergy.com'
ALLOWED_GET = frozenset((HOST + '/health', HOST + '/__synthetic/ip-proof', QUOTE))
MAX_POSTS = 1108
PUBLIC_CERT_SHA256 = 'e94ab9d2a11a56ef985ad896cdca582eb00af2dcc1d5fa4120e5d7bb545f42f2'
PROXY_NAMES = ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=True, separators=(',', ':'), sort_keys=True).encode()


def new_json(path, value):
    new_bytes(path, encode(value))


def new_bytes(path, data):
    with Path(path).open('xb') as output:
        output.write(data)


def batch(run, case, count=1):
    return encode({'schema_version': 1, 'tracker_version': '1.0.0', 'events': [
        {'schema_version': 1, 'event_id': f'syn_perf_{run}_{case}_{index}', 'sequence': index,
         'event_name': 'page_view', 'page_id': 'home', 'tracker_version': '1.0.0',
         'synthetic': True, 'storage_status': 'memory_only'} for index in range(count)]})


def plan(run):
    cases = []
    for phase, count in [('normal', 600), ('burst', 500)]:
        for index in range(count):
            name = f'{phase}-{index:04d}'
            cases.append({'id': name, 'phase': phase, 'index': index, 'body': batch(run, name), 'headers': []})
    body = batch(run, 'size-32767')
    boundary = [
        ('size-32767', body + b' ' * (32767 - len(body)), []),
        *[(f'events-{count}', batch(run, f'events-{count}', count), []) for count in (49, 50, 51)],
        ('absent-length-chunked', batch(run, 'absent-length-chunked'), ['Content-Length:', 'Transfer-Encoding: chunked']),
        # A single closed connection and non-executable JSON/whitespace only.
        # Edge/framing normalization is classified separately after readback.
        ('false-length-one', batch(run, 'false-length-one'), ['Content-Length: 1']),
        ('chunked-over-limit', batch(run, 'chunked-over-limit') + b' ' * (32769 - len(batch(run, 'chunked-over-limit'))), ['Content-Length:', 'Transfer-Encoding: chunked']),
        ('gzip-unsupported', gzip.compress(batch(run, 'gzip-unsupported'), mtime=0), ['Content-Encoding: gzip']),
    ]
    for index, (name, body, headers) in enumerate(boundary):
        cases.append({'id': name, 'phase': 'boundary', 'index': index, 'body': body, 'headers': headers})
    assert len(cases) == MAX_POSTS
    return cases


class Pacer:
    """Client attempt admissions obey both planned slots and a rolling RPS cap."""
    def __init__(self, rate, duration, start, clock=time.monotonic, sleeper=time.sleep):
        self.rate, self.duration, self.start = rate, duration, start
        self.clock, self.sleeper = clock, sleeper
        self.lock, self.started = threading.Lock(), deque()

    def admit(self, index, stop):
        planned = self.start + index / self.rate
        while not stop.is_set():
            with self.lock:
                now = self.clock()
                if now >= self.start + self.duration:
                    return None
                while self.started and now - self.started[0] >= 1:
                    self.started.popleft()
                wait = max(0, planned - now)
                if len(self.started) >= self.rate:
                    wait = max(wait, self.started[0] + 1 - now)
                if wait <= 0:
                    self.started.append(now)
                    return now - self.start
            self.sleeper(min(max(wait, 0.0001), 0.1))
        return None


def response_summary(status, body, headers, request_hash):
    safe = {'http_status': status, 'canonical_receipt': False, 'exact_body_ack': False,
            'receipt_id': None, 'receipt_body_sha256': None, 'retry_after_seconds': None}
    match = re.search(rb'(?im)^retry-after:\s*([0-9]{1,6})\s*\r?$', headers)
    if match:
        safe['retry_after_seconds'] = int(match.group(1))
    try:
        value = json.loads(body)
        canonical = (status == 202 and isinstance(value, dict) and value.get('status') == 'retained'
                     and value.get('terminal') is True and value.get('analytical_status') == 'not_evaluated'
                     and isinstance(value.get('receipt_id'), str) and re.fullmatch(r'[A-Za-z0-9_-]{8,100}', value['receipt_id'])
                     and isinstance(value.get('receipt_body_sha256'), str) and re.fullmatch(r'[a-f0-9]{64}', value['receipt_body_sha256']))
        if canonical:
            safe.update(canonical_receipt=True, exact_body_ack=value['receipt_body_sha256'] == request_hash,
                        receipt_id=value['receipt_id'], receipt_body_sha256=value['receipt_body_sha256'])
    except (ValueError, UnicodeError, TypeError):
        pass
    safe['security_block'] = status in (401, 403) or b'error code: 1010' in body.lower()
    safe['explicit_retryable_response'] = status in (429, 503) and safe['retry_after_seconds'] is not None
    return safe


class Experiment:
    def __init__(self, directory, run_id, request_run=subprocess.run, clock=time.monotonic):
        self.directory, self.run_id = Path(directory), run_id
        self.directory.mkdir(parents=True, exist_ok=False)
        self.request_run, self.clock = request_run, clock
        self.stop = threading.Event()
        self.results, self.lock = [], threading.Lock()

    def preserve_result(self, value):
        new_json(self.directory / (value['id'] + '.result.json'), value)
        with self.lock:
            self.results.append(value)
        return value

    def perform(self, case, pacer=None, url=INTAKE, method='POST'):
        if method == 'POST' and url != INTAKE or method == 'GET' and url not in ALLOWED_GET:
            raise ValueError('request_not_allowlisted')
        name, payload = case['id'], case['body']
        if not re.fullmatch(r'[a-z0-9-]{1,80}', name):
            raise ValueError('invalid_case_id')
        new_bytes(self.directory / (name + '.request.bin'), payload)
        base = {'id': name, 'phase': case['phase'], 'index': case.get('index'), 'method': method,
                'url': url, 'request_bytes': len(payload), 'request_sha256': digest(payload),
                'request_headers': case['headers'], 'synthetic_only': True}
        admitted = pacer.admit(case['index'], self.stop) if pacer else 0
        base['admission_offset_seconds'] = admitted if pacer else None
        if self.stop.is_set() or admitted is None:
            return self.preserve_result({**base, 'dispatched': False, 'reason': 'stopped_or_profile_deadline'})
        header_path, response_path = self.directory / (name + '.response-headers.bin'), self.directory / (name + '.response.bin')
        assert not header_path.exists() and not response_path.exists()
        command = ['curl', '--disable', '--ipv4', '--http1.1', '--proto', '=https', '--silent', '--show-error',
                   '--connect-timeout', '5', '--max-time', '12', '--max-redirs', '0', '--max-filesize',
                   '524288' if url == QUOTE else '65536', '--header', 'Connection: close',
                   '--dump-header', str(header_path), '--output', str(response_path), '--write-out', '%{json}']
        if method == 'POST':
            command += ['--request', 'POST', '--header', 'Content-Type: application/json', '--header', 'Origin: ' + ORIGIN, '--data-binary', '@-']
        for header in case['headers']:
            if header not in ('Content-Length:', 'Transfer-Encoding: chunked', 'Content-Length: 1', 'Content-Encoding: gzip'):
                raise ValueError('header_not_allowlisted')
            command += ['--header', header]
        command.append(url)
        started_at = datetime.now(timezone.utc).isoformat()
        started = self.clock()
        dispatch_offset = started - pacer.start if pacer else None
        # Admission can precede command preparation or an OS scheduling delay.
        # Recheck immediately before calling the request runner; a late admission
        # must never be counted as an in-window dispatch.
        if self.stop.is_set() or pacer and started >= pacer.start + pacer.duration:
            return self.preserve_result({**base, 'dispatched': False,
                                         'dispatch_check_offset_seconds': dispatch_offset,
                                         'reason': 'stopped_or_deadline_before_dispatch'})
        try:
            completed = self.request_run(command, input=payload if method == 'POST' else None, capture_output=True, timeout=15, check=False)
            stdout, stderr, code = completed.stdout, completed.stderr, completed.returncode
        except subprocess.TimeoutExpired as error:
            stdout, stderr, code = error.stdout or b'', error.stderr or b'', 124
        except OSError:
            stdout, stderr, code = b'', b'', 127
        elapsed = self.clock() - started
        new_bytes(self.directory / (name + '.curl-metadata.bin'), stdout)
        new_bytes(self.directory / (name + '.curl-stderr.bin'), stderr)
        raw = response_path.read_bytes() if response_path.exists() else b''
        headers = header_path.read_bytes() if header_path.exists() else b''
        try:
            status = int(json.loads(stdout).get('http_code', 0))
        except (ValueError, TypeError, AttributeError):
            status = 0
        safe = response_summary(status, raw, headers, digest(payload))
        if safe['security_block'] or status in (429, 503):
            # Respect a capacity/retry signal by ending this bounded attempt.
            # Never retry or change headers to evade a block.
            self.stop.set()
        result = {**base, **safe, 'dispatched': True, 'dispatch_offset_seconds': dispatch_offset,
                  'started_at': started_at, 'finished_at': datetime.now(timezone.utc).isoformat(),
                  'ack_latency_seconds': elapsed, 'curl_exit_code': code,
                  'response_bytes': len(raw), 'response_sha256': digest(raw),
                  'response_headers_sha256': digest(headers), 'stderr_sha256': digest(stderr)}
        if method == 'GET' and url == QUOTE:
            result['quotation_form_markup_present'] = b'<form' in raw and b'quotes@farpointenergy.com' in raw
        return self.preserve_result(result)

    def get(self, name, url):
        return self.perform({'id': name, 'phase': 'availability', 'body': b'', 'headers': []}, url=url, method='GET')

    def profile(self, cases, rate, duration, during=None):
        pacer = Pacer(rate, duration, self.clock() + 0.05, clock=self.clock)
        check = None
        if during:
            def midway():
                time.sleep(duration / 2)
                self.get(during, QUOTE)
            check = threading.Thread(target=midway)
            check.start()
        with ThreadPoolExecutor(max_workers=64) as pool:
            futures = [pool.submit(self.perform, case, pacer) for case in cases]
            for future in futures:
                future.result()
        if check:
            check.join()


def percentile(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


def rolling_second_max(offsets):
    """Observed count in any half-open one-second window; no jitter rounding."""
    ordered = sorted(x for x in offsets if x is not None)
    left, maximum = 0, 0
    for right, current in enumerate(ordered):
        while current - ordered[left] >= 1:
            left += 1
        maximum = max(maximum, right - left + 1)
    return maximum


def summarize(results, interrupted=False):
    profiles = {}
    for phase, target in [('normal', 600), ('burst', 500)]:
        rows = [x for x in results if x['phase'] == phase]
        sent = [x for x in rows if x.get('dispatched')]
        accepted = [x for x in sent if x['canonical_receipt'] and x['exact_body_ack'] and x['curl_exit_code'] == 0]
        latency = [x['ack_latency_seconds'] for x in accepted]
        admissions = [x.get('admission_offset_seconds') for x in rows]
        dispatches = [x['dispatch_offset_seconds'] for x in sent if x.get('dispatch_offset_seconds') is not None]
        span = max(dispatches) - min(dispatches) if dispatches else None
        profiles[phase] = {'planned': target, 'dispatched': len(sent), 'exact_acknowledgements': len(accepted),
                           'p95_ack_seconds': percentile(latency, .95), 'p99_ack_seconds': percentile(latency, .99),
                           'first_request_latency_seconds': next((x['ack_latency_seconds'] for x in sent if x['index'] == 0), None),
                           'cold_start_controlled': False,
                           'first_dispatch_offset_seconds': min(dispatches, default=None),
                           'last_dispatch_offset_seconds': max(dispatches, default=None),
                           'observed_dispatch_span_seconds': span,
                           'observed_mean_dispatch_interval_rate': (len(dispatches) - 1) / span if span else None,
                           'observed_max_rolling_second_admissions': rolling_second_max(admissions),
                           'observed_max_rolling_second_dispatches': rolling_second_max(dispatches),
                           'dispatch_measurement': 'client_pre_request_call_not_wire_arrival',
                           'explicit_retryable_responses': sum(x['explicit_retryable_response'] for x in sent),
                           'security_blocks': sum(x['security_block'] for x in sent),
                           'storage_reconciliation_pending': True}
    return {'scope': 'bounded_candidate_performance_and_raw_boundaries', 'maximum_post_attempts': MAX_POSTS,
            'profiles': profiles, 'boundary_results': [{k: x.get(k) for k in ('id', 'dispatched', 'reason', 'http_status', 'curl_exit_code', 'canonical_receipt', 'exact_body_ack', 'receipt_id', 'receipt_body_sha256')} for x in results if x['phase'] == 'boundary'],
            'availability': [{k: x.get(k) for k in ('id', 'http_status', 'quotation_form_markup_present')} for x in results if x['phase'] == 'availability'],
            'test_interrupted': interrupted, 'production_readiness_certified': False, 'storage_reconciliation_pending': True,
            'boundary_platform_handling_requires_readback': True}


def seal(directory, transfer, certificate, runner=subprocess.run):
    """Only ciphertext and allowlisted summaries enter the upload directory."""
    directory, transfer, certificate = Path(directory), Path(transfer), Path(certificate)
    if digest(certificate.read_bytes()) != PUBLIC_CERT_SHA256:
        raise ValueError('unexpected_recipient_certificate')
    transfer.mkdir(parents=True, exist_ok=False)
    tar_path = directory.parent / (directory.name + '.tar')
    with tarfile.open(tar_path, 'x') as archive:
        archive.add(directory, arcname=directory.name, recursive=True)
    output = transfer / 'private-evidence.cms'
    result = runner(['openssl', 'cms', '-encrypt', '-binary', '-aes-256-gcm', '-in', str(tar_path), '-out', str(output), '-outform', 'DER',
                     '-recip', str(certificate), '-keyopt', 'rsa_padding_mode:oaep', '-keyopt', 'rsa_oaep_md:sha256'], capture_output=True, timeout=60, check=False)
    if result.returncode != 0 or not output.exists():
        raise RuntimeError('evidence_encryption_failed')
    new_json(transfer / 'encrypted-evidence-manifest.json', {'encryption': 'CMS AES-256-GCM / RSA-OAEP SHA-256',
             'recipient_certificate_sha256': PUBLIC_CERT_SHA256, 'ciphertext_sha256': digest(output.read_bytes()),
             'ciphertext_bytes': output.stat().st_size, 'plaintext_tar_sha256': digest(tar_path.read_bytes()),
             'plaintext_tar_bytes': tar_path.stat().st_size, 'archive_is_transfer_buffer_not_durable_archive': True})


def main(environment=os.environ):
    if environment.get('FARPOINT_PERF_GO') != 'reviewed-1108-candidate-posts':
        print('{"status":"held_no_explicit_go"}')
        return 1
    if environment.get('GITHUB_ACTIONS') != 'true' or environment.get('RUNNER_ENVIRONMENT') != 'github-hosted' or environment.get('GITHUB_REPOSITORY') != 'FarpointEnergy/farpointenergy.com':
        print('{"status":"blocked_not_approved_github_runner"}')
        return 1
    if any(environment.get(name) for name in PROXY_NAMES):
        print('{"status":"blocked_proxy_environment_present"}')
        return 1
    run = environment.get('GITHUB_RUN_ID', '') + '-' + environment.get('GITHUB_RUN_ATTEMPT', '')
    if not re.fullmatch(r'\d{1,20}-\d{1,4}', run):
        print('{"status":"blocked_run_metadata"}')
        return 1
    base = Path(environment['RUNNER_TEMP']) / ('farpoint-performance-' + run + '-' + uuid.uuid4().hex[:8])
    experiment = Experiment(base / 'private-evidence', run)
    certificate = Path(__file__).with_name('performance-recipient-public.pem')
    interrupted = False
    try:
        cases = plan(run)
        new_bytes(experiment.directory / 'runtime-source.py', Path(__file__).read_bytes())
        new_json(experiment.directory / 'input-plan.json', {'source_sha': environment.get('GITHUB_SHA'), 'planned_at': datetime.now(timezone.utc).isoformat(),
                 'run_id': run, 'proxy_environment_present': False, 'cases': [{**x, 'body': base64.b64encode(x['body']).decode()} for x in cases]})
        health = experiment.get('safety-health', HOST + '/health')
        probe = experiment.get('safety-probe-disabled', HOST + '/__synthetic/ip-proof')
        if health['http_status'] != 200 or probe['http_status'] != 404:
            raise RuntimeError('candidate_safety_precondition_failed')
        experiment.get('quote-before', QUOTE)
        experiment.profile([x for x in cases if x['phase'] == 'normal'], 10, 60)
        experiment.profile([x for x in cases if x['phase'] == 'burst'], 50, 10, during='quote-during-burst')
        experiment.get('quote-after', QUOTE)
        for case in [x for x in cases if x['phase'] == 'boundary']:
            experiment.perform(case)
    except Exception:
        interrupted = True
        new_json(experiment.directory / 'failure.json', {'status': 'test_interrupted', 'captured_at': datetime.now(timezone.utc).isoformat()})
    summary = summarize(experiment.results, interrupted=interrupted)
    expected_boundary_ids = {x['id'] for x in plan(run) if x['phase'] == 'boundary'}
    boundary_results = summary['boundary_results']
    summary['all_boundary_attempts_completed'] = (len(boundary_results) == len(expected_boundary_ids)
        and {x['id'] for x in boundary_results} == expected_boundary_ids
        and all(x['dispatched'] and x['http_status'] is not None and x['curl_exit_code'] is not None for x in boundary_results))
    new_json(experiment.directory / 'safe-summary.json', summary)
    try:
        transfer = Path(environment['RUNNER_TEMP']) / 'farpoint-performance-transfer'
        seal(experiment.directory, transfer, certificate)
        new_json(transfer / 'safe-summary.json', summary)
        new_json(transfer / 'safe-ack-inventory.json', [{k: row.get(k) for k in ('id', 'phase', 'request_sha256', 'request_bytes', 'dispatched', 'http_status', 'canonical_receipt', 'exact_body_ack', 'receipt_id', 'receipt_body_sha256', 'ack_latency_seconds')} for row in experiment.results])
    except Exception:
        print('{"status":"encryption_or_transfer_preparation_failed","private_data_not_published":true}')
        return 1
    print(json.dumps(summary, sort_keys=True))
    normal, burst = summary['profiles']['normal'], summary['profiles']['burst']
    availability = {x['id']: x for x in summary['availability']}
    availability_ok = all(availability.get(name, {}).get('http_status') == 200 and availability[name].get('quotation_form_markup_present') for name in ('quote-before', 'quote-during-burst', 'quote-after'))
    good = (not summary['test_interrupted'] and summary['all_boundary_attempts_completed']
            and normal['exact_acknowledgements'] == 600 and normal['p95_ack_seconds'] <= 1 and normal['p99_ack_seconds'] <= 3
            and burst['dispatched'] == 500 and burst['exact_acknowledgements'] + burst['explicit_retryable_responses'] == 500 and availability_ok)
    return 0 if good else 1


if __name__ == '__main__':
    sys.exit(main())
