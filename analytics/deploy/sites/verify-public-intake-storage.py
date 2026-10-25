"""Verify captured synthetic HTTP bodies against authenticated exported objects.

Read-only inputs; writes a new report only. No network requests or deletions.
Run using ordinary Python (assertions enabled), never python -O.
"""
import argparse
import base64
from collections import Counter
import hashlib
import json
from pathlib import Path


def verify(http_root, export_path, baseline_path):
    def digest(value):
        return hashlib.sha256(value).hexdigest()

    objects = json.loads(Path(export_path).read_bytes())
    baseline = json.loads(Path(baseline_path).read_bytes())['expected_original_records']
    requests = [json.loads(path.read_bytes()) for path in sorted(Path(http_root).glob('[0-9][0-9]-*.json'))]
    expected = {item['response_json']['receipt_id']: item for item in requests if item.get('status') == 202}
    assert len(expected) == 6
    indexed = {}
    for item in objects:
        raw = bytes(item['object_bytes'])
        assert len(raw) == item['size'] and digest(raw) == item['sha256']
        assert item['key'] not in indexed
        indexed[item['key']] = item
    for original in baseline:
        item = indexed[original['key']]
        assert item['size'] == original['bytes'] and item['sha256'] == original['sha256']
    seen = set()
    rejections = []
    for item in objects:
        record = json.loads(bytes(item['object_bytes']))
        if item['key'].startswith('receipts/'):
            if record['receipt_id'] not in expected:
                assert item['key'] in {original['key'] for original in baseline}
                continue
            request = expected[record['receipt_id']]
            body = base64.b64decode(record['body_base64'], validate=True)
            sent = base64.b64decode(request['request_body_base64'], validate=True)
            assert body == sent
            assert record['body_bytes'] == len(sent)
            assert record['receipt_body_sha256'] == digest(sent) == request['response_json']['receipt_body_sha256']
            assert record['source_ip'] == {'status': 'unavailable', 'provenance': 'unverified', 'address': None}
            seen.add(record['receipt_id'])
        else:
            assert item['key'].startswith('rejections/')
            assert record['body_preserved'] is False
            rejections.append(record['reason'])
    assert seen == set(expected)
    assert Counter(rejections) == Counter({'origin_not_allowed': 2, 'unsupported_content_type': 1, 'body_too_large': 1})
    assert len(objects) == 13 and len(baseline) == 3
    pair = [item for item in requests if item['name'] in {'json', 'duplicate'}]
    assert len(pair) == 2
    assert pair[0]['response_json']['receipt_id'] != pair[1]['response_json']['receipt_id']
    assert pair[0]['request_body_sha256'] == pair[1]['request_body_sha256']
    return {'status': 'PASS', 'scope': 'captured_http_to_authenticated_object_bytes',
            'total_objects_verified': len(objects), 'object_bytes_verified': sum(item['size'] for item in objects),
            'original_objects_unchanged': 3, 'new_receipts_exact': 6, 'rejections_verified': 4,
            'duplicate_receipts_distinct': True, 'unexpected_objects': 0,
            'source_ip': 'unavailable_unverified_null_in_all_new_receipts',
            'retention_policy_verified': False, 'browser_cors_verified': False,
            'public_gateway_identity_verified': False, 'production_ready': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--http-root', required=True)
    parser.add_argument('--export', required=True)
    parser.add_argument('--baseline', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = verify(args.http_root, args.export, args.baseline)
    with Path(args.output).open('x') as handle:
        json.dump(result, handle, indent=2)
    print(json.dumps(result))
