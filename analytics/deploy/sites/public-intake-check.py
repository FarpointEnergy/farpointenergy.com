"""Bounded synthetic HTTP intake checks; caller must manage the Site audience.

Requires explicit authorization for the public window. Never supplies identity,
cookies, service-access credentials, or forwarding headers. All request/response
body bytes within the response evidence limit, plus selected headers, are saved
create-only; this is not a complete wire capture. Does not enable tracking or
call RFQ/storage probes. --verify-evidence checks retained files without HTTP.
"""
import argparse
import base64
import hashlib
import json
import pathlib
import re
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone


EXPECTED_CHECKS = {
    'health': (200,), 'preflight': (204,),
    'json': (202,), 'duplicate': (202,), 'text-plain': (202,),
    'malformed-json': (202,), 'invalid-utf8': (202,), 'max-body': (202,),
    'unsupported-type': (415,), 'foreign-origin': (403,),
    'missing-origin': (403,), 'oversize': (413,),
    'anonymous-export': (401, 403), 'disabled-bootstrap': (401, 403),
}
REJECTION_REASONS = {
    'unsupported-type': 'unsupported_content_type',
    'foreign-origin': 'origin_not_allowed',
    'missing-origin': 'origin_not_allowed', 'oversize': 'body_too_large',
}
ORIGIN = 'https://farpointenergy.com'


def verify_evidence(items):
    """Independently check recorded bytes; do not trust prior passed/JSON fields."""
    checks, receipt_ids, bodies = [], [], {}
    names = [item.get('name') for item in items]
    complete = len(names) == len(EXPECTED_CHECKS) and set(names) == set(EXPECTED_CHECKS)
    for item in items:
        name = item.get('name')
        errors = []
        def require(condition, message):
            if not condition:
                errors.append(message)
        require(name in EXPECTED_CHECKS, 'unexpected_check')
        require(item.get('status') in EXPECTED_CHECKS.get(name, ()), 'unexpected_status')
        response_json = None
        try:
            request_bytes = base64.b64decode(item['request_body_base64'], validate=True)
            response_bytes = base64.b64decode(item['response_body_base64'], validate=True)
            bodies[name] = request_bytes
            require(hashlib.sha256(request_bytes).hexdigest() == item.get('request_body_sha256'), 'request_hash_mismatch')
            require(hashlib.sha256(response_bytes).hexdigest() == item.get('response_body_sha256'), 'response_hash_mismatch')
            try:
                response_json = json.loads(response_bytes)
            except (ValueError, UnicodeDecodeError):
                pass
        except (KeyError, ValueError, TypeError):
            errors.append('missing_or_invalid_body_evidence')
        headers = {key.lower(): value for key, value in item.get('response_headers', {}).items()}
        request_headers = {key.lower(): value for key, value in item.get('request_headers', {}).items()}
        require(not any(key in request_headers for key in ['authorization', 'cookie', 'oai-sites-authorization', 'oai-authenticated-user-id']), 'identity_or_access_credential_present')
        if name == 'health':
            require(response_json == {'status': 'available'}, 'health_body_mismatch')
        if name == 'preflight':
            require(headers.get('access-control-allow-origin') == ORIGIN, 'preflight_origin_mismatch')
            require(headers.get('access-control-allow-methods') == 'POST', 'preflight_method_mismatch')
            require(headers.get('access-control-allow-headers', '').lower() == 'content-type', 'preflight_headers_mismatch')
        if name in EXPECTED_CHECKS and EXPECTED_CHECKS[name] == (202,):
            ack = response_json if isinstance(response_json, dict) else {}
            receipt_id = ack.get('receipt_id')
            valid_id = isinstance(receipt_id, str) and re.fullmatch(r'[A-Za-z0-9_-]{8,100}', receipt_id) is not None
            require(valid_id, 'missing_or_invalid_receipt_id')
            if valid_id:
                receipt_ids.append(receipt_id)
            require(ack.get('status') == 'retained' and ack.get('terminal') is True, 'nonterminal_or_unretained_ack')
            require(ack.get('receipt_body_sha256') == item.get('request_body_sha256'), 'ack_body_hash_mismatch')
            require(ack.get('analytical_status') == 'not_evaluated', 'analytical_status_mismatch')
        if name in REJECTION_REASONS:
            require(response_json == {'status': 'rejected', 'reason': REJECTION_REASONS[name], 'rejection_metadata_recorded': True}, 'rejection_response_mismatch')
        if name in {'foreign-origin', 'missing-origin'}:
            require('access-control-allow-origin' not in headers, 'disallowed_origin_received_cors')
        elif name not in {'health', 'anonymous-export', 'disabled-bootstrap'}:
            require(headers.get('access-control-allow-origin') == ORIGIN, 'allowed_origin_cors_mismatch')
        require('no-store' in headers.get('cache-control', '').lower(), 'missing_no_store')
        check = {'name': name, 'status': item.get('status'), 'passed': not errors, 'errors': errors}
        if name in {'anonymous-export', 'disabled-bootstrap'}:
            check['scope'] = 'edge_access_denied_application_handler_unverified' if item.get('status') == 401 else 'http_access_denied_application_handler_unverified'
        checks.append(check)
    duplicate_bodies_match = bodies.get('json') is not None and bodies.get('json') == bodies.get('duplicate') == bodies.get('text-plain')
    fixture_bodies_match = bodies.get('malformed-json') == b'{' and bodies.get('invalid-utf8') == bytes([255, 254, 195, 40]) and bodies.get('max-body') == b'a' * 32768 and bodies.get('oversize') == b'a' * 32769
    unique_ids = len(receipt_ids) == 6 and len(set(receipt_ids)) == 6
    return {
        'scope': 'anonymous_synthetic_http_evidence_only',
        'verified_at': datetime.now(timezone.utc).isoformat(),
        'expected_check_count': len(EXPECTED_CHECKS), 'observed_check_count': len(items),
        'complete_check_set': complete, 'all_http_checks_passed': complete and all(check['passed'] for check in checks) and duplicate_bodies_match and fixture_bodies_match and unique_ids,
        'six_distinct_valid_receipt_ids': unique_ids, 'duplicate_request_bytes_match': duplicate_bodies_match,
        'boundary_and_malformed_fixture_bytes_match': fixture_bodies_match,
        'original_ip_provenance_verified': False, 'storage_readback_verified': False,
        'browser_cors_enforcement_verified': False, 'application_owner_guard_verified': False,
        'bootstrap_handler_disabled_verified': False,
        'checks': checks,
    }


def write_verification(path, verification):
    with pathlib.Path(path).open('x') as handle:
        json.dump(verification, handle, indent=2)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def main():
    parser = argparse.ArgumentParser()
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--base-url')
    mode.add_argument('--verify-evidence', help='Read existing captured evidence without network requests')
    parser.add_argument('--output')
    parser.add_argument('--verification-output', help='New JSON file; existing files are never replaced')
    args = parser.parse_args()
    if args.verify_evidence:
        if not args.verification_output or args.output:
            parser.error('--verify-evidence requires --verification-output and disallows --output')
        items = [json.loads(path.read_text()) for path in sorted(pathlib.Path(args.verify_evidence).glob('[0-9][0-9]-*.json'))]
        verification = verify_evidence(items)
        write_verification(args.verification_output, verification)
        print(json.dumps(verification), flush=True)
        raise SystemExit(0 if verification['all_http_checks_passed'] else 1)
    if not args.output or args.verification_output:
        parser.error('--base-url requires --output and disallows --verification-output')
    root = pathlib.Path(args.output)
    root.mkdir(parents=True, exist_ok=False)
    run_id = str(uuid.uuid4())
    opener = urllib.request.build_opener(NoRedirect())
    evidence = []
    origin = 'https://farpointenergy.com'
    body = json.dumps({'schema_version': 1, 'tracker_version': 'synthetic-public-feasibility/1',
                       'events': [], 'synthetic_run_id': run_id}, separators=(',', ':')).encode()

    def request(name, path, method='GET', data=None, headers=None, expected=None):
        item = {'name': name, 'started_at': datetime.now(timezone.utc).isoformat(),
                'path': path, 'method': method, 'request_headers': headers or {},
                'request_body_base64': base64.b64encode(data or b'').decode(),
                'request_body_sha256': hashlib.sha256(data or b'').hexdigest(),
                'expected_status': expected}
        req = urllib.request.Request(args.base_url.rstrip('/') + path, data=data,
                                     headers={'User-Agent': 'Farpoint-Synthetic-Feasibility/1.0', 'Cache-Control': 'no-cache', **(headers or {})}, method=method)
        try:
            try:
                response = opener.open(req, timeout=15)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                raw = response.read(131073)
                if len(raw) > 131072:
                    raise ValueError('response_exceeds_evidence_limit')
                item.update(status=response.status,
                            response_headers={key: value for key, value in response.headers.items()
                                              if key.lower() in {'content-type', 'cache-control', 'vary',
                                                                  'access-control-allow-origin', 'access-control-allow-methods',
                                                                  'access-control-allow-headers', 'x-robots-tag', 'cf-ray'}},
                            response_body_base64=base64.b64encode(raw).decode(),
                            response_body_sha256=hashlib.sha256(raw).hexdigest())
                try:
                    item['response_json'] = json.loads(raw)
                except (ValueError, UnicodeDecodeError):
                    pass
            item['passed'] = item['status'] in (expected if isinstance(expected, list) else [expected])
            if expected == 202:
                ack = item.get('response_json', {})
                item['passed'] = item['passed'] and ack.get('status') == 'retained' and ack.get('terminal') is True and ack.get('receipt_body_sha256') == item['request_body_sha256'] and ack.get('analytical_status') == 'not_evaluated'
        except Exception as error:
            item.update(passed=False, error_type=type(error).__name__)
        evidence.append(item)
        with (root / (str(len(evidence)).zfill(2) + '-' + name + '.json')).open('x') as handle:
            json.dump(item, handle, indent=2)
        print(json.dumps({'name': name, 'status': item.get('status'), 'passed': item['passed']}), flush=True)
        return item

    health = request('health', '/health?synthetic=' + run_id, expected=200)
    if health.get('response_json') == {'status': 'available'} and health['passed']:
        allowed = {'Origin': origin, 'Content-Type': 'application/json'}
        request('preflight', '/v1/events', 'OPTIONS', headers={'Origin': origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type'}, expected=204)
        request('json', '/v1/events', 'POST', body, allowed, 202)
        request('duplicate', '/v1/events', 'POST', body, allowed, 202)
        request('text-plain', '/v1/events', 'POST', body, {'Origin': origin, 'Content-Type': 'text/plain'}, 202)
        request('malformed-json', '/v1/events', 'POST', b'{', allowed, 202)
        request('invalid-utf8', '/v1/events', 'POST', bytes([255, 254, 195, 40]), allowed, 202)
        request('max-body', '/v1/events', 'POST', b'a' * 32768, allowed, 202)
        request('unsupported-type', '/v1/events', 'POST', b'synthetic', {'Origin': origin, 'Content-Type': 'application/octet-stream'}, 415)
        request('foreign-origin', '/v1/events', 'POST', body, {'Origin': 'https://synthetic.invalid', 'Content-Type': 'application/json'}, 403)
        request('missing-origin', '/v1/events', 'POST', body, {'Content-Type': 'application/json'}, 403)
        request('oversize', '/v1/events', 'POST', b'a' * 32769, allowed, 413)
        for name, tool, arguments in [('anonymous-export', 'list_records', {'namespace': 'receipts', 'limit': 1}), ('disabled-bootstrap', 'bootstrap_owner_identity', {})]:
            rpc = json.dumps({'jsonrpc': '2.0', 'id': run_id, 'method': 'tools/call', 'params': {'name': tool, 'arguments': arguments}}).encode()
            request(name, '/mcp', 'POST', rpc, {'Content-Type': 'application/json'}, [401, 403])

    accepted = [item for item in evidence if item.get('status') == 202]
    ids = [item.get('response_json', {}).get('receipt_id') for item in accepted]
    verification = verify_evidence(evidence)
    summary = {'run_id': run_id, 'scope': 'anonymous_synthetic_http_only',
               'requests': len(evidence), 'all_http_checks_passed': verification['all_http_checks_passed'],
               'receipt_count': len(ids), 'distinct_receipt_ids': len(set(ids)),
               'original_ip_provenance_verified': False, 'storage_readback_verified': False,
               'browser_cors_enforcement_verified': False,
               'identity_or_access_credentials_supplied': False,
               'checks': [{key: item[key] for key in ['name', 'status', 'passed'] if key in item} for item in evidence]}
    with (root / 'summary.json').open('x') as handle:
        json.dump(summary, handle, indent=2)
    print(json.dumps(summary), flush=True)
    write_verification(root / 'verified-summary.json', verification)
    print(json.dumps(verification), flush=True)
    raise SystemExit(0 if verification['all_http_checks_passed'] else 1)


if __name__ == '__main__':
    main()
