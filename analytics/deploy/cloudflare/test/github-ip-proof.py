#!/usr/bin/env python3
"""One-shot synthetic IPv4 observation from a GitHub-hosted runner.

Only the allowlisted safe_summary is written to stdout. Raw diagnostics are
included in the <=4 KiB POST retained privately by the existing probe. A saved
record is not itself a provenance pass: an authenticated reviewer must compare
its observations with the collector-side candidate and independent network.
Raw diagnostics are durably archived only after a valid probe receipt. A failed
save on an ephemeral runner leaves their archival unconfirmed. Response bodies
and stderr are bounded; any truncation fails the acceptance result.
"""
import base64
import hashlib
import ipaddress
import json
import os
import re
import subprocess
import sys
import uuid
from datetime import datetime, timezone

COLLECTOR = 'https://farpoint-lead-collector-candidate.farpointenergy.workers.dev/__synthetic/ip-proof'
DIAGNOSTICS = (
    ('ipify_ipv4', 'https://api.ipify.org?format=json'),
    ('cloudflare_trace_ipv4', 'https://www.cloudflare.com/cdn-cgi/trace'),
)
ALLOWED_URLS = frozenset([COLLECTOR, *(url for _, url in DIAGNOSTICS)])
STATUS_MARKER = b'\nFARPOINT_HTTP_STATUS:'
PROXY_NAMES = ('HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy')


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def compact_json(value):
    return json.dumps(value, separators=(',', ':'), ensure_ascii=True).encode()


def curl_request(url, body=None, run=subprocess.run):
    if url not in ALLOWED_URLS or (body is not None and url != COLLECTOR):
        raise ValueError('request_not_allowlisted')
    command = ['curl', '--disable', '--ipv4', '--proto', '=https', '--silent',
               '--connect-timeout', '8', '--max-time', '20', '--max-redirs', '0',
               '--max-filesize', '1024' if body is not None else '512',
               '--write-out', '\nFARPOINT_HTTP_STATUS:%{http_code}']
    if body is not None:
        if len(body) > 4096:
            raise ValueError('request_body_too_large')
        command += ['--request', 'POST', '--header', 'Content-Type: application/json', '--data-binary', '@-']
    command.append(url)
    try:
        completed = run(command, input=body, capture_output=True, timeout=25, check=False)
        output, stderr, code = completed.stdout, completed.stderr, completed.returncode
    except subprocess.TimeoutExpired as error:
        output, stderr, code = error.stdout or b'', error.stderr or b'', 124
    except OSError:
        return {'body': b'', 'stderr': b'', 'http_status': 0, 'curl_exit_code': 127}
    response, marker, status = output.rpartition(STATUS_MARKER)
    if not marker or not re.fullmatch(rb'[0-9]{3}', status):
        response, status = output, b'000'
    return {'body': response, 'stderr': stderr, 'http_status': int(status), 'curl_exit_code': code}


def diagnostic_record(service, result):
    body, stderr = result['body'], result['stderr']
    observed = None
    if result['curl_exit_code'] == 0 and result['http_status'] == 200:
        try:
            if service == 'ipify_ipv4':
                value = json.loads(body)['ip']
            else:
                value = dict(line.split('=', 1) for line in body.decode('utf-8').splitlines() if '=' in line)['ip']
            address = ipaddress.ip_address(value)
            if address.version == 4:
                observed = str(address)
        except (ValueError, TypeError, KeyError, UnicodeError):
            pass
    return {
        'service': service, 'requested_family': 4, 'status': 'observed' if observed else 'failed',
        'observed_ip': observed, 'http_status': result['http_status'], 'curl_exit_code': result['curl_exit_code'],
        'body_base64': base64.b64encode(body[:512]).decode(), 'body_bytes': len(body),
        'body_sha256': sha256(body), 'body_truncated': len(body) > 512,
        'stderr_base64': base64.b64encode(stderr[:128]).decode(), 'stderr_bytes': len(stderr),
        'stderr_sha256': sha256(stderr), 'stderr_truncated': len(stderr) > 128,
    }


def safe_ack(result):
    try:
        value = json.loads(result['body'])
        valid = (result['curl_exit_code'] == 0 and result['http_status'] == 202
                 and value.get('status') == 'retained' and value.get('terminal') is True
                 and value.get('ip_provenance_verified') is False
                 and isinstance(value.get('proof_key'), str)
                 and re.fullmatch(r'ip-proof/\d{4}/\d{2}/\d{2}/[A-Za-z0-9_-]{8,100}\.json', value['proof_key'])
                 and isinstance(value.get('proof_sha256'), str)
                 and re.fullmatch(r'[a-f0-9]{64}', value['proof_sha256']))
    except (ValueError, TypeError, AttributeError):
        valid = False
    return {'retained': bool(valid), 'http_status': result['http_status'], 'curl_exit_code': result['curl_exit_code'],
            'proof_key': value['proof_key'] if valid else None,
            'proof_sha256': value['proof_sha256'] if valid else None}


def run_probe(environment, request=curl_request):
    safe = {'scope': 'github_hosted_synthetic_ipv4', 'ip_provenance_verified': False,
            'production_flags_changed': False, 'requested_family': 4}
    if environment.get('GITHUB_ACTIONS') != 'true' or environment.get('RUNNER_ENVIRONMENT') != 'github-hosted':
        return {**safe, 'status': 'blocked_not_github_hosted_runner'}, 1
    if environment.get('GITHUB_REPOSITORY') != 'FarpointEnergy/farpointenergy.com':
        return {**safe, 'status': 'blocked_wrong_repository'}, 1
    proxy_present = any(bool(environment.get(name)) for name in PROXY_NAMES)
    if proxy_present:
        return {**safe, 'status': 'blocked_proxy_environment_present', 'proxy_environment_present': True}, 1
    run_id, attempt, source = (environment.get(x, '') for x in ('GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA'))
    if not re.fullmatch(r'\d{1,20}', run_id) or not re.fullmatch(r'\d{1,4}', attempt) or not re.fullmatch(r'[a-f0-9]{40,64}', source):
        return {**safe, 'status': 'blocked_invalid_run_metadata'}, 1
    observations = [diagnostic_record(service, request(url)) for service, url in DIAGNOSTICS]
    agree = all(x['status'] == 'observed' for x in observations) and observations[0]['observed_ip'] == observations[1]['observed_ip']
    payload = {
        'synthetic': True, 'test_id': 'github-ipv4-' + run_id + '-' + attempt + '-' + uuid.uuid4().hex[:8],
        'expected_ip': observations[0]['observed_ip'],
        'assertion_status': 'untrusted_client_assertions', 'diagnostics_agree': agree,
        'runner': {'provider': 'github-hosted', 'requested_family': 4, 'proxy_environment_present': False,
                   'run_id': run_id, 'attempt': attempt, 'source_sha': source},
        'observed_at': datetime.now(timezone.utc).isoformat(), 'diagnostics': observations,
    }
    body = compact_json(payload)
    safe.update({'run_id': run_id, 'attempt': attempt, 'source_sha': source,
                 'proxy_environment_present': False, 'diagnostics_agree': bool(agree),
                 'diagnostics': [{'service': x['service'], 'observed': x['status'] == 'observed',
                                  'family': 4 if x['observed_ip'] else None,
                                  'http_status': x['http_status'], 'curl_exit_code': x['curl_exit_code'],
                                  'body_truncated': x['body_truncated'],
                                  'stderr_truncated': x['stderr_truncated']} for x in observations],
                 'submitted_bytes': len(body), 'submitted_sha256': sha256(body)})
    if len(body) > 4096:
        return {**safe, 'status': 'blocked_payload_size', 'retained': False}, 1
    receipt = safe_ack(request(COLLECTOR, body))
    complete = receipt['retained'] and agree and not any(x['body_truncated'] or x['stderr_truncated'] for x in observations)
    safe.update(receipt)
    safe['diagnostic_archive_confirmed'] = receipt['retained'] and not any(x['body_truncated'] or x['stderr_truncated'] for x in observations)
    safe['status'] = 'synthetic_evidence_retained' if receipt['retained'] else 'storage_not_confirmed'
    return safe, 0 if complete else 1


def main():
    try:
        summary, exit_code = run_probe(os.environ)
    except Exception:
        # Never send exceptions, raw responses, environment or traceback to CI.
        summary, exit_code = {'scope': 'github_hosted_synthetic_ipv4', 'status': 'unexpected_test_failure', 'ip_provenance_verified': False}, 1
    print(json.dumps(summary, sort_keys=True))
    return exit_code


if __name__ == '__main__':
    sys.exit(main())
