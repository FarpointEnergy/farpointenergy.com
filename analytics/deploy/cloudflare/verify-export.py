"""Independently verify a private Cloudflare export against archived HTTP bytes.

Only reads existing evidence and creates a new verification report. Never sends
requests, overwrites files, deletes records, or prints record contents/IPs.
"""
import argparse
import base64
from collections import Counter
import hashlib
import json
from pathlib import Path
import re


def require(condition, reason):
    if not condition:
        raise ValueError(reason)


def sha256(value):
    return hashlib.sha256(value).hexdigest()


def verify(http_root, export_root, baseline_inventory=None):
    http_root, export_root = Path(http_root), Path(export_root)
    inventory = json.loads((export_root / 'inventory.json').read_bytes())
    require(isinstance(inventory, list), 'invalid_inventory')
    stored, receipts, rejections = {}, {}, Counter()
    for item in inventory:
        key = item.get('key', '')
        require(re.fullmatch(r'(receipts|rejections)/\d{4}/\d{2}/\d{2}/[A-Za-z0-9_-]{8,100}\.json', key), 'invalid_record_key')
        require(key not in stored and item.get('local_path') == 'objects/' + key, 'duplicate_or_mismatched_local_path')
        raw = (export_root / item['local_path']).read_bytes()
        require(len(raw) == item.get('size') and sha256(raw) == item.get('sha256'), 'exported_object_integrity_mismatch')
        stored[key] = item
        record = json.loads(raw)
        if key.startswith('receipts/'):
            receipt_id = record.get('receipt_id')
            require(key.endswith('/' + str(receipt_id) + '.json') and receipt_id not in receipts, 'receipt_identity_mismatch')
            body = base64.b64decode(record['body_base64'], validate=True)
            require(len(body) == record['body_bytes'] and sha256(body) == record['receipt_body_sha256'], 'inner_receipt_integrity_mismatch')
            receipts[receipt_id] = (record, body)
        else:
            require(record.get('body_preserved') is False, 'rejection_falsely_claims_body_preservation')
            rejections[record['reason']] += 1
    actual_files = {str(path.relative_to(export_root / 'objects')) for path in (export_root / 'objects').rglob('*.json')}
    require(actual_files == set(stored), 'unlisted_or_missing_exported_object')

    original_count = 0
    if baseline_inventory:
        baseline = json.loads(Path(baseline_inventory).read_bytes())
        require(isinstance(baseline, list), 'invalid_baseline')
        originals = [item for entry in baseline for item in (entry['items'] if 'items' in entry else [entry])]
        require(len({item['key'] for item in originals}) == len(originals), 'duplicate_baseline_key')
        for original in originals:
            observed = stored.get(original['key'])
            require(observed and observed['size'] == original['size'] and observed['sha256'] == original['sha256'], 'prior_object_changed_or_missing')
        original_count = len(originals)

    requests = [json.loads(path.read_bytes()) for path in sorted(http_root.glob('[0-9][0-9]-*.json'))]
    require(requests and all(item.get('passed') is True for item in requests), 'http_suite_not_passed')
    accepted, rejection_expectations = {}, Counter()
    for request in requests:
        sent = base64.b64decode(request['request_body_base64'], validate=True)
        response_bytes = base64.b64decode(request['response_body_base64'], validate=True)
        require(sha256(sent) == request['request_body_sha256'], 'archived_http_request_hash_mismatch')
        require(sha256(response_bytes) == request['response_body_sha256'], 'archived_http_response_hash_mismatch')
        response = request.get('response_json')
        if response is not None:
            require(json.loads(response_bytes) == response, 'archived_http_response_json_mismatch')
        if request['status'] == 202:
            receipt_id = response['receipt_id']
            require(receipt_id not in accepted and receipt_id in receipts, 'missing_or_duplicate_http_receipt')
            record, body = receipts[receipt_id]
            require(body == sent and record['receipt_body_sha256'] == response['receipt_body_sha256'], 'http_to_receipt_bytes_mismatch')
            accepted[receipt_id] = request
        elif isinstance(response, dict) and response.get('status') == 'rejected':
            require(response.get('rejection_metadata_recorded') is True, 'http_rejection_not_preserved')
            rejection_expectations[response['reason']] += 1
    require(accepted, 'no_accepted_http_receipts')
    require(all(rejections[reason] >= count for reason, count in rejection_expectations.items()), 'missing_rejection_metadata')
    pair = [request for request in accepted.values() if request['name'] in {'json', 'duplicate'}]
    require(len(pair) == 2 and pair[0]['response_json']['receipt_id'] != pair[1]['response_json']['receipt_id'] and pair[0]['request_body_sha256'] == pair[1]['request_body_sha256'], 'duplicate_attempt_preservation_failed')
    return {
        'status': 'PASS',
        'scope': 'independent_archived_http_to_private_cloudflare_export',
        'total_objects_verified': len(stored),
        'object_bytes_verified': sum(item['size'] for item in stored.values()),
        'prior_listed_objects_unchanged': original_count,
        'accepted_http_receipts_exact': len(accepted),
        'rejection_metadata_records_verified': sum(rejections.values()),
        'rejection_reason_counts': dict(rejections),
        'additional_receipts_verified': len(receipts) - len(accepted),
        'duplicate_receipts_distinct': True,
        'all_inner_receipt_hashes_verified': True,
        'transactional_snapshot': False,
        'original_ip_provenance_certified': False,
        'production_ready': False,
    }


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--http-root', required=True)
    parser.add_argument('--export-root', required=True)
    parser.add_argument('--baseline-inventory')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = verify(args.http_root, args.export_root, args.baseline_inventory)
    with Path(args.output).open('x') as handle:
        json.dump(result, handle, indent=2)
        handle.write('\n')
    print(json.dumps(result))
