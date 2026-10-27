"""Create-only evidence ZIPs and independently verified fresh restoration.

No network calls, deletion, replacement, or execution of archived code. The
caller must finish source writes before packaging. A ZIP is a finite observed
snapshot, not a transactional snapshot or proof of remote source completeness.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import sys
import zipfile

FORMAT = 'farpoint-evidence-zip/1'
MANIFEST_NAME = '__farpoint_evidence_manifest__.json'
BINDING_NAME = '__farpoint_evidence_binding__.json'
RESERVED = {MANIFEST_NAME, BINDING_NAME}
HEX64 = re.compile(r'^[a-f0-9]{64}$')
HEX40 = re.compile(r'^[a-f0-9]{40}$')


class EvidenceError(ValueError):
    """A categorical error safe to include in a diagnostic report."""


def _require(condition, code):
    if not condition:
        raise EvidenceError(code)


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _json_bytes(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False,
                      sort_keys=True, separators=(',', ':')).encode('utf-8')


def _strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            _require(key not in result, 'duplicate_json_key')
            result[key] = value
        return result
    def constant(_):
        raise EvidenceError('nonfinite_json_number')
    try:
        return json.loads(data.decode('utf-8'), object_pairs_hook=pairs,
                          parse_constant=constant)
    except (UnicodeError, json.JSONDecodeError, RecursionError):
        raise EvidenceError('invalid_json') from None


def _absolute(path):
    # Do not resolve symlinks away before checking them.
    return Path(os.path.abspath(os.fspath(path)))


def _no_symlinks(path):
    _require(not any(p.is_symlink() for p in [path, *path.parents]),
             'symlink_path')


def _signature(value):
    return (value.st_dev, value.st_ino, value.st_size,
            value.st_mtime_ns, value.st_ctime_ns)


def _read_regular(path):
    _no_symlinks(path)
    flags = os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    fd = os.open(path, flags)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        _require(stat.S_ISREG(before.st_mode), 'not_regular_file')
        data = stream.read()
        after = os.fstat(stream.fileno())
    _require(_signature(before) == _signature(after)
             and len(data) == before.st_size, 'file_changed_during_read')
    return data, _signature(after)


def _safe_name(name):
    _require(isinstance(name, str) and bool(name) and '\\' not in name
             and not any(ord(c) < 32 or ord(c) == 127 for c in name),
             'unsafe_archive_path')
    p = PurePosixPath(name)
    _require(not p.is_absolute() and not re.match(r'^[A-Za-z]:', name)
             and all(part not in ('', '.', '..') for part in name.split('/')),
             'unsafe_archive_path')
    return p


def _source_name(name):
    p = _safe_name(name)
    _require(p.parts[0] not in RESERVED, 'reserved_archive_path')
    return p


def _collect(root):
    _no_symlinks(root)
    _require(root.is_dir(), 'source_not_directory')
    result = []
    def walk_error(_):
        raise EvidenceError('source_walk_failed')
    for directory, dirs, files in os.walk(root, followlinks=False, onerror=walk_error):
        parent = Path(directory)
        for name in dirs:
            p = parent / name
            _no_symlinks(p)
            _require(stat.S_ISDIR(p.lstat().st_mode), 'unsupported_source_entry')
            _source_name(p.relative_to(root).as_posix())
        for name in files:
            p = parent / name
            _no_symlinks(p)
            _require(stat.S_ISREG(p.lstat().st_mode), 'unsupported_source_entry')
            _source_name(p.relative_to(root).as_posix())
            result.append(p)
    return sorted(result, key=lambda p: p.relative_to(root).as_posix())


def _validate_binding(value):
    _require(isinstance(value, dict) and type(value.get('schema_version')) is int
             and value['schema_version'] == 1, 'invalid_binding')
    _require(isinstance(value.get('run_id'), str)
             and re.fullmatch(r'[A-Za-z0-9_-]{1,128}', value['run_id']),
             'invalid_binding_run_id')
    _require(isinstance(value.get('source_commit'), str)
             and HEX40.fullmatch(value['source_commit']), 'invalid_binding_commit')
    completion = value.get('pipeline_completion')
    _require(isinstance(completion, dict)
             and isinstance(completion.get('id'), str)
             and 1 <= len(completion['id']) <= 256
             and not any(ord(c) < 32 for c in completion['id'])
             and type(completion.get('bytes')) is int and completion['bytes'] >= 0
             and isinstance(completion.get('sha256'), str)
             and HEX64.fullmatch(completion['sha256']), 'invalid_binding_completion')
    required = value.get('required_source_files', [])
    _require(isinstance(required, list), 'invalid_required_source_files')
    seen = set()
    for entry in required:
        _require(isinstance(entry, dict) and set(entry) == {'path', 'bytes', 'sha256'},
                 'invalid_required_source_file')
        _source_name(entry['path'])
        _require(entry['path'] not in seen and type(entry['bytes']) is int
                 and entry['bytes'] >= 0 and isinstance(entry['sha256'], str)
                 and HEX64.fullmatch(entry['sha256']), 'invalid_required_source_file')
        seen.add(entry['path'])
    return value


def _binding(value):
    # A file keeps its exact supplied bytes; a dictionary has one documented
    # canonical encoding. Extra caller metadata remains in the archive.
    if isinstance(value, dict):
        data = _json_bytes(value)
    else:
        data, _ = _read_regular(_absolute(value))
    return _validate_binding(_strict_json(data)), data


def _binding_summary(value):
    completion = value['pipeline_completion']
    return {key: value[key] for key in ('schema_version', 'run_id', 'source_commit')} | {
        'pipeline_completion': {key: completion[key] for key in ('id', 'bytes', 'sha256')}}


def _mkdir_parents(path):
    _no_symlinks(path)
    for directory in reversed([path, *path.parents]):
        if directory.exists():
            _require(directory.is_dir(), 'parent_not_directory')
            continue
        try:
            directory.mkdir(mode=0o700, exist_ok=False)
        except FileExistsError:
            _require(directory.is_dir() and not directory.is_symlink(), 'unsafe_created_parent')
    _no_symlinks(path)


def _new_file(path):
    _mkdir_parents(path.parent)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
    return os.fdopen(os.open(path, flags, 0o600), 'wb')


def _zip_info(name):
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.create_system = 3
    info.external_attr = (stat.S_IFREG | 0o600) << 16
    info.compress_type = zipfile.ZIP_DEFLATED
    return info


def pack_evidence(source_root, output_zip, binding):
    """Package all regular files into a new ZIP outside the source directory."""
    root, output = _absolute(source_root), _absolute(output_zip)
    _no_symlinks(root); _no_symlinks(output)
    _require(not output.is_relative_to(root), 'output_inside_source')
    bound, bound_bytes = _binding(binding)
    paths = _collect(root)
    required = {entry['path']: entry for entry in bound.get('required_source_files', [])}
    _require(required.keys() <= {p.relative_to(root).as_posix() for p in paths},
             'required_source_file_missing')
    entries, signatures = [], {}
    # Output is created exclusively. A failed ZIP is deliberately left in place.
    with _new_file(output) as stream:
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED,
                             allowZip64=True) as archive:
            for path in paths:
                name = path.relative_to(root).as_posix()
                data, signature = _read_regular(path)
                signatures[name] = signature
                entry = {'path': name, 'bytes': len(data), 'sha256': _sha(data)}
                _require(name not in required or entry == required[name],
                         'required_source_file_mismatch')
                entries.append(entry)
                archive.writestr(_zip_info(name), data)
            # Reject ordinary concurrent additions, removals or changed files.
            _require([p.relative_to(root).as_posix() for p in _collect(root)]
                     == [e['path'] for e in entries], 'source_inventory_changed')
            for path in paths:
                name = path.relative_to(root).as_posix()
                _require(_signature(path.lstat()) == signatures[name], 'source_file_changed')
            manifest = {
                'archive_format': FORMAT,
                'created_at': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
                'snapshot_claim': 'Exact listed files; not a transactional source snapshot.',
                'binding': bound, 'binding_bytes': len(bound_bytes), 'binding_sha256': _sha(bound_bytes),
                'record_count': len(entries), 'total_source_bytes': sum(e['bytes'] for e in entries),
                'entries': entries}
            manifest_bytes = _json_bytes(manifest)
            archive.writestr(_zip_info(BINDING_NAME), bound_bytes)
            archive.writestr(_zip_info(MANIFEST_NAME), manifest_bytes)
        stream.flush(); os.fsync(stream.fileno())
    data, _ = _read_regular(output)
    return {'status': 'packed', 'path': str(output), 'bytes': len(data), 'sha256': _sha(data),
            'manifest_sha256': _sha(manifest_bytes), 'record_count': len(entries),
            'total_source_bytes': manifest['total_source_bytes'], 'binding': _binding_summary(bound)}


def _checked_archive(data):
    archive = zipfile.ZipFile(io.BytesIO(data), 'r')
    try:
        infos, names = archive.infolist(), set()
        for info in infos:
            _safe_name(info.filename)
            _require(info.filename == info.orig_filename, 'altered_archive_name')
            _require(info.filename not in names, 'duplicate_archive_entry')
            names.add(info.filename)
            kind = stat.S_IFMT(info.external_attr >> 16)
            _require(not info.is_dir() and kind in (0, stat.S_IFREG), 'unsupported_archive_entry')
            _require(not (info.flag_bits & 1), 'encrypted_archive_unsupported')
        _require(RESERVED <= names, 'missing_archive_manifest')
        manifest_bytes = archive.read(MANIFEST_NAME)
        manifest = _strict_json(manifest_bytes)
        _require(isinstance(manifest, dict) and manifest.get('archive_format') == FORMAT,
                 'unsupported_archive_format')
        bound = _validate_binding(manifest.get('binding'))
        bound_bytes = archive.read(BINDING_NAME)
        _require(type(manifest.get('binding_bytes')) is int
                 and len(bound_bytes) == manifest['binding_bytes']
                 and _sha(bound_bytes) == manifest.get('binding_sha256')
                 and _strict_json(bound_bytes) == bound, 'binding_integrity_failure')
        entries = manifest.get('entries')
        _require(isinstance(entries, list), 'invalid_manifest_entries')
        listed, total = set(), 0
        for entry in entries:
            _require(isinstance(entry, dict) and set(entry) == {'path', 'bytes', 'sha256'}, 'invalid_manifest_entry')
            _source_name(entry['path'])
            _require(entry['path'] not in listed, 'duplicate_manifest_entry')
            listed.add(entry['path'])
            _require(type(entry['bytes']) is int and entry['bytes'] >= 0
                     and isinstance(entry['sha256'], str) and HEX64.fullmatch(entry['sha256']),
                     'invalid_manifest_entry')
            total += entry['bytes']
        _require(type(manifest.get('record_count')) is int and manifest['record_count'] == len(listed)
                 and type(manifest.get('total_source_bytes')) is int
                 and manifest['total_source_bytes'] == total, 'manifest_count_mismatch')
        _require(names == listed | RESERVED, 'archive_entry_set_mismatch')
        entry_map = {entry['path']: entry for entry in entries}
        _require(all(entry_map.get(entry['path']) == entry
                     for entry in bound.get('required_source_files', [])),
                 'required_source_binding_mismatch')
        for name in listed:
            _require(not any(p.as_posix() in listed for p in PurePosixPath(name).parents
                             if p.as_posix() != '.'), 'archive_path_collision')
        return archive, manifest, manifest_bytes, bound_bytes
    except BaseException:
        archive.close()
        raise


def verify_restore(zip_path, expected_sha256, expected_bytes, new_destination):
    """Verify an exact downloaded ZIP and restore to a never-used directory.

    This verifies bytes and binding, not their business meaning or the claim
    that a remote pipeline was complete. No archived code is executed.
    """
    _require(isinstance(expected_sha256, str) and HEX64.fullmatch(expected_sha256)
             and type(expected_bytes) is int and expected_bytes >= 0, 'invalid_expected_archive')
    path, destination = _absolute(zip_path), _absolute(new_destination)
    _no_symlinks(path); _no_symlinks(destination)
    _require(not destination.exists(), 'restore_destination_exists')
    # Restore from the exact buffer hashed here; never reread a possibly changed ZIP.
    data, _ = _read_regular(path)
    _require(len(data) == expected_bytes and _sha(data) == expected_sha256,
             'archive_integrity_failure')
    archive, manifest, manifest_bytes, bound_bytes = _checked_archive(data)
    try:
        _mkdir_parents(destination.parent)
        destination.mkdir(mode=0o700, exist_ok=False)
        entries = manifest['entries']
        for entry in entries:
            info = archive.getinfo(entry['path'])
            _require(info.file_size == entry['bytes'], 'archive_entry_integrity_failure')
            content = archive.read(info)
            _require(len(content) == entry['bytes'] and _sha(content) == entry['sha256'],
                     'archive_entry_integrity_failure')
            target = destination / _safe_name(entry['path'])
            with _new_file(target) as stream:
                stream.write(content); stream.flush(); os.fsync(stream.fileno())
            saved, _ = _read_regular(target)
            _require(saved == content, 'restore_readback_mismatch')
        for name, content in ((BINDING_NAME, bound_bytes), (MANIFEST_NAME, manifest_bytes)):
            with _new_file(destination / name) as stream:
                stream.write(content); stream.flush(); os.fsync(stream.fileno())
        return {'status': 'verified_and_restored', 'path': str(destination),
                'archive_path': str(path), 'bytes': len(data), 'sha256': expected_sha256,
                'manifest_sha256': _sha(manifest_bytes), 'record_count': len(entries),
                'total_source_bytes': manifest['total_source_bytes'],
                'binding': _binding_summary(manifest['binding']),
                'verification': 'Every listed file restored from verified ZIP bytes and read back exactly.'}
    finally:
        archive.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    pack = commands.add_parser('pack')
    pack.add_argument('source_root'); pack.add_argument('output_zip')
    pack.add_argument('--binding', type=Path, required=True)
    restore = commands.add_parser('verify-restore')
    restore.add_argument('zip_path'); restore.add_argument('expected_sha256')
    restore.add_argument('expected_bytes', type=int); restore.add_argument('new_destination')
    args = parser.parse_args()
    try:
        if args.command == 'pack':
            result = pack_evidence(args.source_root, args.output_zip, args.binding)
        else:
            result = verify_restore(args.zip_path, args.expected_sha256,
                                    args.expected_bytes, args.new_destination)
        print(json.dumps(result, ensure_ascii=False))
    except Exception as error:
        code = str(error) if isinstance(error, EvidenceError) else type(error).__name__
        print(json.dumps({'status': 'failed', 'operation': args.command, 'reason': code}))
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
