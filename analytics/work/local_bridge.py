"""One bounded operation via hidden stdin. No credentials; no replace/delete.

Private output contains capture/report data. The Work caller must not print it.
"""
from __future__ import annotations
import argparse, base64, hashlib, io, json, os, pathlib, re, sys, termios, uuid
from datetime import datetime, timezone
from email import policy
from email.parser import BytesParser
from urllib.parse import urlparse
from urllib.request import urlopen


def encoded(data):
    return base64.b64encode(data).decode('ascii')


def safe_write(root, name, data):
    p = pathlib.PurePosixPath(name)
    if p.is_absolute() or '\\' in name or any(x in ('', '.', '..') for x in name.split('/')):
        raise ValueError('unsafe_path')
    target = root / p
    target.parent.mkdir(parents=True, exist_ok=True)
    if any(x.is_symlink() for x in [target, *target.parents]):
        raise ValueError('symlink_path')
    fd = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(fd, 'wb') as stream:
        stream.write(data); stream.flush(); os.fsync(stream.fileno())
    if target.read_bytes() != data:
        raise ValueError('readback_mismatch')
    return str(target)


def transport_response(root, request, value):
    """Keep tool stdout bounded; large results are immutable private byte files."""
    data = json.dumps(value, ensure_ascii=False).encode('utf-8')
    if request.get('stream_results') is not True or len(data) <= 16384:
        return data.decode('utf-8')
    name = 'bridge-results/' + str(uuid.uuid4()) + '.json'
    safe_write(root, name, data)
    return json.dumps({'status': 'ok', 'result_stream': {
        'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
        'encoding': 'utf-8-json'}})


def read_result_chunk(root, request):
    name = request.get('path')
    if not isinstance(name, str) or not re.fullmatch(r'bridge-results/[a-f0-9-]{36}\.json', name):
        raise ValueError('invalid_result_stream_path')
    offset, maximum = request.get('offset'), request.get('max_bytes')
    if (type(offset) is not int or offset < 0 or type(maximum) is not int
            or not 1 <= maximum <= 8192):
        raise ValueError('invalid_result_chunk_bounds')
    path = root / name
    if any(p.is_symlink() for p in [path, *path.parents]):
        raise ValueError('symlink_result_stream')
    size = path.stat().st_size
    if offset >= size:
        raise ValueError('invalid_result_chunk_offset')
    with path.open('rb') as stream:
        stream.seek(offset); data = stream.read(maximum)
    return {'path': name, 'offset': offset, 'bytes': len(data), 'total_bytes': size,
            'base64': encoded(data), 'sha256': hashlib.sha256(data).hexdigest()}


def reference_bytes(response):
    if not isinstance(response, dict):
        raise ValueError('invalid_reference')
    # Only authenticated top-level connector file references, never text previews.
    container = response.get('structuredContent') or response
    path = response.get('workspace_path') or container.get('workspace_path')
    uri = response.get('file_uri') or container.get('file_uri')
    if not path and isinstance(uri, dict):
        path = uri.get('workspace_path') or uri.get('path')
        uri = uri.get('download_url') or uri.get('url') or uri.get('uri')
    if path:
        p = pathlib.Path(path)
        if not p.is_absolute() or not str(p).startswith('/workspace/') or p.is_symlink():
            raise ValueError('invalid_materialized_reference')
        return p.read_bytes()
    if isinstance(uri, str) and uri.startswith('https://'):
        parsed = urlparse(uri)
        allowed = ('.blob.core.windows.net', '.oaiusercontent.com', '.amazonaws.com')
        if not parsed.hostname or not parsed.hostname.endswith(allowed):
            raise ValueError('unsupported_reference_host')
        with urlopen(uri, timeout=60) as stream:
            final = urlparse(stream.geturl())
            if final.scheme != 'https' or not final.hostname.endswith(allowed):
                raise ValueError('unsupported_reference_redirect')
            return stream.read()
    raise ValueError('connector_file_not_materialized')


def normalize_mail(request):
    from farpoint_analytics.analysis import capture_content_hash
    raw = base64.b64decode(request['raw_base64'], validate=True)
    message = BytesParser(policy=policy.default).parsebytes(raw)
    artifacts = [{'name': 'message.eml', 'base64': encoded(raw)},
                 {'name': 'connector.json', 'base64': encoded(json.dumps(request['connector'], ensure_ascii=False).encode())}]
    texts, attachments, defects = [], [], []
    for i, part in enumerate(message.walk()):
        defects.extend(type(x).__name__ for x in part.defects)
        if part.is_multipart():
            continue
        data = part.get_payload(decode=True)
        if data is None:
            raise ValueError('unreadable_mime_part')
        if part.get_content_maintype() == 'text' and part.get_content_disposition() != 'attachment':
            text = data.decode(part.get_content_charset() or 'ascii', errors='strict')
            texts.append(f'--- MIME {i}: {part.get_content_type()} ---\n{text}')
        else:
            name = f'attachment-{i}.bin'
            artifacts.append({'name': name, 'base64': encoded(data)})
            attachments.append({'filename': part.get_filename(), 'mime_type': part.get_content_type(),
                                'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
                                'artifact': name})
    if defects:
        raise ValueError('mime_defects_require_review')
    internal = request.get('internal_date')
    if not isinstance(internal, (str, int)) or not str(internal).isdecimal():
        raise ValueError('missing_gmail_internal_date')
    received = datetime.fromtimestamp(int(internal) / 1000, timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
    capture = {'observation_id': str(uuid.uuid4()), 'mailbox': request['mailbox'], 'message_id': request['message_id'],
               'captured_at': request['captured_at'], 'received_at': received, 'body': '\n'.join(texts),
               'headers': [{'name': name, 'value': value} for name, value in message.raw_items()],
               'attachments': attachments, 'capture_format': 'gmail_rfc2822_bytes_and_decoded_mime',
               'rfc2822_sha256': hashlib.sha256(raw).hexdigest()}
    capture['message_content_sha256'] = capture_content_hash(capture)
    return {'complete': True, 'capture': capture, 'artifacts': artifacts}


def analyze(request, root):
    from farpoint_analytics.analysis import analyze as run_analysis, json_bytes
    from farpoint_analytics.archive import create_archive, runtime_identity, source_snapshot
    from farpoint_analytics.canonical import strict_loads
    commit = request['code_commit']
    if not isinstance(commit, str) or not re.fullmatch('[a-f0-9]{40}', commit):
        raise ValueError('exact_commit_required')
    receipts = []
    for item in request['objects']:
        raw = base64.b64decode(item['base64'], validate=True)
        if len(raw) != item['size'] or hashlib.sha256(raw).hexdigest() != item['sha256']:
            raise ValueError('input_object_hash_mismatch')
        if item['namespace'] == 'receipts':
            receipts.append(strict_loads(raw))
    companies = request.get('company_observations', [])
    report = run_analysis(receipts, request['captures'], request['classifications'], request['config'], company_observations=companies)
    files = {'inputs/receipts.json': json_bytes(receipts), 'inputs/messages.json': json_bytes(request['captures']),
             'inputs/classifications.json': json_bytes(request['classifications']), 'inputs/company_observations.json': json_bytes(companies),
             'inputs/resolutions.json': b'[]', 'inputs/config.json': json_bytes(request['config']),
             'outputs/report.json': json_bytes(report), 'replay/runtime-identity.json': json_bytes(runtime_identity()), **source_snapshot()}
    work_source = pathlib.Path(__file__).parent
    files.update({'replay/work-source/'+p.name:p.read_bytes() for p in sorted(work_source.iterdir())
                  if p.is_file() and p.suffix in ('.py','.mjs','.md')})
    timezone_path = pathlib.Path('/usr/share/zoneinfo/America/New_York')
    if not timezone_path.is_file():
        raise ValueError('timezone_artifact_unavailable')
    files['replay/timezone/America_New_York.tzif'] = timezone_path.read_bytes()
    archive = root / 'analysis-archives' / str(uuid.uuid4())
    create_archive(archive, files, {'kind':'analysis_run','code_commit':commit,'runtime':runtime_identity(),
                                  'replay_artifact_status':'runtime_bundle_requires_independent_offline_verification'},
                   {**request['config']['source_completeness'], 'analysis_integrity':report['status']=='complete'})
    return {'report': report, 'artifacts': [{'name': str(p.relative_to(archive)), 'base64': encoded(p.read_bytes())}
                                         for p in sorted(archive.rglob('*')) if p.is_file()]}


def main():
    parser = argparse.ArgumentParser(); parser.add_argument('--root', required=True); parser.add_argument('--repository', required=True)
    args = parser.parse_args(); root = pathlib.Path(args.root); root.mkdir(parents=True, exist_ok=True)
    sys.path.insert(0, str(pathlib.Path(args.repository) / 'analytics/python'))
    if sys.stdin.isatty():
        settings = termios.tcgetattr(sys.stdin.fileno()); settings[3] &= ~(termios.ECHO | termios.ICANON); termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, settings)
    print('READY', flush=True)
    try:
        request = json.loads(sys.stdin.readline())
        if request['op'] == 'create':
            result = {'path': safe_write(root, request['path'], base64.b64decode(request['base64'], validate=True))}
        elif request['op'] == 'read_reference':
            result = {'base64': encoded(reference_bytes(request['response']))}
        elif request['op'] == 'normalize_mail':
            # Preserve originals before any MIME parser failure.
            prefix = 'mail-observations/' + str(uuid.uuid4())
            safe_write(root, prefix+'/message.eml', base64.b64decode(request['raw_base64'], validate=True))
            safe_write(root, prefix+'/connector.json', json.dumps(request['connector'], ensure_ascii=False).encode())
            result = {'result': normalize_mail(request)}
        elif request['op'] == 'analyze':
            result = analyze(request, root)
        elif request['op'] == 'read_result':
            result = read_result_chunk(root, request)
        else:
            raise ValueError('unsupported_operation')
        print(transport_response(root, request, {'status':'ok', **result}), flush=True)
    except Exception as error:
        safe = str(error) if isinstance(error, ValueError) and re.fullmatch('[a-z_]+', str(error)) else type(error).__name__
        print(json.dumps({'status':'failed','reason':safe}), flush=True)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
