"""Bounded synthetic export check; no network, overwrites or deletions.

Run with PYTHONPATH=analytics/python. All destinations must be new.
The session input is private and must never be committed with this procedure.
"""
import json
from pathlib import Path
import stat
import sys
import zipfile

from farpoint_analytics.archive import (
    create_archive, create_only, restore_archive, safe_relative,
    source_snapshot, verify_archive,
)
from farpoint_analytics.canonical import sha256


def checked_objects(session):
    expected = {x['key']: x for x in session['expected_original_records']}
    objects = session['objects']
    assert len(objects) == len(expected) == 3
    assert len({x['key'] for x in objects}) == len(objects)
    files = {}
    for item in objects:
        raw = bytes(item['object_bytes'])
        original = expected[item['key']]
        assert len(raw) == original['bytes'] == item['size']
        assert sha256(raw) == original['sha256'] == item['sha256']
        files['raw/' + item['key']] = raw
    assert session['enumeration']['counts']['receipts']['enumeration_complete']
    assert session['enumeration']['counts']['rejections']['enumeration_complete']
    assert session['enumeration']['counts']['receipts']['objects'] == 3
    assert session['enumeration']['counts']['rejections']['objects'] == 0
    return files


def pack(session_path, archive_path, zip_path):
    session_bytes = Path(session_path).read_bytes()
    session = json.loads(session_bytes)
    files = checked_objects(session)
    files['evidence/export-session.json'] = session_bytes
    files['evidence/recovery-procedure.py'] = Path(__file__).read_bytes()
    files.update(source_snapshot())
    result = create_archive(archive_path, files, {
        'kind': 'private_synthetic_collector_export',
        'site_source_commit': session['site_provenance']['commit_sha'],
        'limitations': ['not a mailbox or funnel report', 'not an unattended run',
                        'not a complete portable runtime recovery test'],
    }, {'receipts_enumerated': True, 'rejections_enumerated': True})
    verification = verify_archive(archive_path)
    with zipfile.ZipFile(zip_path, 'x', compression=zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(Path(archive_path).rglob('*')):
            if path.is_file():
                bundle.write(path, path.relative_to(archive_path).as_posix())
    data = Path(zip_path).read_bytes()
    return {'status': 'PASS', 'scope': 'local_synthetic_export_archive',
            'archive': result, 'verification': verification,
            'zip_path': str(zip_path), 'zip_bytes': len(data),
            'zip_sha256': sha256(data), 'original_objects': 3}


def restore(download_path, unpack_path, restore_path):
    unpack = Path(unpack_path)
    unpack.mkdir(parents=True, exist_ok=False)
    with zipfile.ZipFile(download_path) as bundle:
        entries = bundle.infolist()
        assert 0 < len(entries) <= 1000
        assert sum(x.file_size for x in entries) <= 10 * 1024 * 1024
        names = set()
        for item in entries:
            safe_relative(item.filename)
            assert item.filename not in names and not item.is_dir()
            assert not stat.S_ISLNK(item.external_attr >> 16)
            names.add(item.filename)
            create_only(unpack / item.filename, bundle.read(item))
    source_check = verify_archive(unpack)
    session = json.loads((unpack / 'evidence/export-session.json').read_bytes())
    expected_files = checked_objects(session)
    result = restore_archive(unpack, restore_path)
    restored_check = verify_archive(restore_path)
    for name, raw in expected_files.items():
        assert (Path(restore_path) / 'restored' / name).read_bytes() == raw
    return {'status': 'PASS', 'scope': 'downloaded_archive_fresh_directory_restore',
            'source_verification': source_check, 'restore': result,
            'restored_verification': restored_check, 'original_objects_verified': 3,
            'original_total_bytes': sum(map(len, expected_files.values())),
            'full_runtime_recovery_verified': False}


if __name__ == '__main__':
    operation, *paths = sys.argv[1:]
    assert len(paths) == 3
    result = pack(*paths) if operation == 'pack' else restore(*paths) if operation == 'restore' else None
    assert result is not None
    print(json.dumps(result))
