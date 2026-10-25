"""Offline regression checks; preserve every fixture and result in a new directory."""
import argparse
import base64
import copy
import hashlib
import json
import pathlib
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    root = pathlib.Path(args.output)
    root.mkdir(parents=True, exist_ok=False)
    source = pathlib.Path(__file__).with_name('public-intake-check.py')
    namespace = {'__name__': 'public_intake_check_under_test'}
    exec(compile(source.read_text(), str(source), 'exec'), namespace)
    verify = namespace['verify_evidence']
    baseline = [json.loads(path.read_text()) for path in sorted(pathlib.Path(args.evidence).glob('[0-9][0-9]-*.json'))]

    def deny_network(*unused, **kwargs):
        raise AssertionError('Offline verification attempted network access')
    urllib.request.OpenerDirector.open = deny_network

    def change_json(item, value):
        raw = json.dumps(value).encode()
        item['response_body_base64'] = base64.b64encode(raw).decode()
        item['response_body_sha256'] = hashlib.sha256(raw).hexdigest()
        # Deliberately retain old response_json/passed fields: they are untrusted.

    cases = [('complete-captured-evidence', baseline, True)]
    cases.append(('health-alone-is-incomplete', copy.deepcopy(baseline[:1]), False))
    wrong_health = copy.deepcopy(baseline)
    change_json(wrong_health[0], {'status': 'unexpected'})
    cases.append(('wrong-health-body', wrong_health, False))
    wrong_cors = copy.deepcopy(baseline)
    wrong_cors[1]['response_headers']['access-control-allow-origin'] = '*'
    cases.append(('wildcard-cors', wrong_cors, False))
    missing_id = copy.deepcopy(baseline)
    ack = dict(missing_id[2]['response_json'])
    del ack['receipt_id']
    change_json(missing_id[2], ack)
    cases.append(('missing-receipt-id', missing_id, False))
    repeated_id = copy.deepcopy(baseline)
    ack = dict(repeated_id[3]['response_json'])
    ack['receipt_id'] = repeated_id[2]['response_json']['receipt_id']
    change_json(repeated_id[3], ack)
    cases.append(('repeated-receipt-id', repeated_id, False))
    wrong_rejection = copy.deepcopy(baseline)
    change_json(wrong_rejection[8], {'status': 'rejected', 'reason': 'wrong_reason', 'rejection_metadata_recorded': True})
    cases.append(('wrong-rejection-reason', wrong_rejection, False))
    wrong_hash = copy.deepcopy(baseline)
    wrong_hash[2]['request_body_sha256'] = '0' * 64
    cases.append(('request-hash-mismatch', wrong_hash, False))
    wrong_response_hash = copy.deepcopy(baseline)
    wrong_response_hash[2]['response_body_sha256'] = '0' * 64
    cases.append(('response-hash-mismatch', wrong_response_hash, False))
    cached = copy.deepcopy(baseline)
    cached[2]['response_headers']['cache-control'] = 'public, max-age=3600'
    cases.append(('cacheable-private-response', cached, False))
    false_pass = copy.deepcopy(baseline)
    false_pass[2]['status'] = 500
    false_pass[2]['passed'] = True
    cases.append(('ignore-previous-pass-flag', false_pass, False))

    results = []
    for name, fixture, expected in cases:
        actual = verify(fixture)
        with (root / (name + '.json')).open('x') as handle:
            json.dump({'fixture': fixture, 'verification': actual, 'expected_pass': expected}, handle, indent=2)
        results.append({'name': name, 'passed': actual['all_http_checks_passed'] is expected})
    target = root / 'create-only-sentinel.json'
    namespace['write_verification'](target, {'original': True})
    original = target.read_bytes()
    rejected = False
    try:
        namespace['write_verification'](target, {'replacement': True})
    except FileExistsError:
        rejected = True
    results.append({'name': 'existing-evidence-not-replaced', 'passed': rejected and target.read_bytes() == original})
    summary = {'scope': 'offline_evidence_validator_regression', 'tests': len(results),
               'all_passed': all(result['passed'] for result in results), 'results': results}
    with (root / 'summary.json').open('x') as handle:
        json.dump(summary, handle, indent=2)
    print(json.dumps(summary))
    raise SystemExit(0 if summary['all_passed'] else 1)


if __name__ == '__main__':
    main()
