import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import unittest
from unittest.mock import patch
import uuid
import warnings
import zipfile

SOURCE = Path(__file__).resolve().parents[1] / 'evidence_archive.py'
spec = importlib.util.spec_from_file_location('evidence_archive', SOURCE)
archive = importlib.util.module_from_spec(spec); spec.loader.exec_module(archive)
EVIDENCE = Path(os.environ.get('FARPOINT_EVIDENCE_TEST_ROOT',
                             Path(__file__).parent / '.evidence'))


def sha(data):
    return hashlib.sha256(data).hexdigest()


class EvidenceArchiveTests(unittest.TestCase):
    def setUp(self):
        self.root = EVIDENCE / str(uuid.uuid4())
        self.source = self.root / 'source'
        self.source.mkdir(parents=True, mode=0o700)
        self.binding = {'schema_version': 1, 'run_id': 'synthetic-run',
                        'source_commit': 'a' * 40,
                        'pipeline_completion': {'id': 'synthetic-completion',
                                                'bytes': 123, 'sha256': 'b' * 64}}

    def fixture(self):
        (self.source / 'nested').mkdir()
        (self.source / 'a-empty.bin').write_bytes(b'')
        (self.source / 'nested' / '电力.txt').write_bytes('Synthetic — 电力 🧑🏽‍🚀'.encode())
        (self.source / 'z-payload.bin').write_bytes(b'\x00\xff\x01')
        return archive.pack_evidence(self.source, self.root / 'original.zip', self.binding)

    def modified_zip(self, descriptor, transform):
        with zipfile.ZipFile(descriptor['path']) as original:
            entries = [(item, original.read(item)) for item in original.infolist()]
        entries = transform(entries)
        path = self.root / ('modified-' + str(uuid.uuid4()) + '.zip')
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(path, 'x') as target:
                for info, content in entries:
                    target.writestr(info, content)
        data = path.read_bytes()
        return path, sha(data), len(data)

    def reject_modified(self, descriptor, transform, reason):
        path, digest, size = self.modified_zip(descriptor, transform)
        with self.assertRaisesRegex(archive.EvidenceError, reason):
            archive.verify_restore(path, digest, size, self.root / ('rejected-' + str(uuid.uuid4())))
        self.assertTrue(path.exists())
        self.assertEqual(sha(Path(descriptor['path']).read_bytes()), descriptor['sha256'])

    def test_binary_unicode_empty_files_and_required_hashes_roundtrip(self):
        content = b'\x00\xff\x01'
        self.binding['required_source_files'] = [{'path': 'z-payload.bin', 'bytes': len(content), 'sha256': sha(content)}]
        self.binding['extra_review_metadata'] = {'synthetic': True}
        packed = self.fixture()
        restored = archive.verify_restore(packed['path'], packed['sha256'], packed['bytes'], self.root / 'restored')
        self.assertEqual(restored['record_count'], 3)
        self.assertEqual(restored['manifest_sha256'], packed['manifest_sha256'])
        self.assertEqual(restored['binding']['run_id'], 'synthetic-run')
        for p in self.source.rglob('*'):
            if p.is_file():
                target = Path(restored['path']) / p.relative_to(self.source)
                self.assertEqual(target.read_bytes(), p.read_bytes())
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
        retained = json.loads((Path(restored['path']) / archive.BINDING_NAME).read_text())
        self.assertEqual(retained, self.binding)

    def test_empty_source_and_exact_binding_file_are_supported(self):
        binding_path = self.root / 'binding.json'
        supplied = (json.dumps(self.binding, indent=4) + '\n').encode()
        binding_path.write_bytes(supplied)
        packed = archive.pack_evidence(self.source, self.root / 'empty.zip', binding_path)
        restored = archive.verify_restore(packed['path'], packed['sha256'], packed['bytes'], self.root / 'empty-restored')
        self.assertEqual(restored['record_count'], 0)
        self.assertEqual((Path(restored['path']) / archive.BINDING_NAME).read_bytes(), supplied)

    def test_existing_archive_and_restore_are_never_replaced(self):
        packed = self.fixture(); before = Path(packed['path']).read_bytes()
        with self.assertRaises(FileExistsError):
            archive.pack_evidence(self.source, packed['path'], self.binding)
        self.assertEqual(Path(packed['path']).read_bytes(), before)
        destination = self.root / 'existing'; destination.mkdir()
        (destination / 'keep').write_bytes(b'original')
        with self.assertRaisesRegex(archive.EvidenceError, 'restore_destination_exists'):
            archive.verify_restore(packed['path'], packed['sha256'], packed['bytes'], destination)
        self.assertEqual((destination / 'keep').read_bytes(), b'original')

    def test_output_inside_source_and_reserved_names_are_rejected(self):
        with self.assertRaisesRegex(archive.EvidenceError, 'output_inside_source'):
            archive.pack_evidence(self.source, self.source / 'recursive.zip', self.binding)
        (self.source / archive.MANIFEST_NAME).write_bytes(b'reserved')
        with self.assertRaisesRegex(archive.EvidenceError, 'reserved_archive_path'):
            archive.pack_evidence(self.source, self.root / 'reserved.zip', self.binding)

    def test_source_symlink_file_and_directory_are_rejected(self):
        outside = self.root / 'outside'; outside.mkdir(); (outside / 'raw').write_bytes(b'private')
        for directory_link in (False, True):
            source = self.root / ('symlink-source-' + str(directory_link)); source.mkdir()
            (source / 'link').symlink_to(outside if directory_link else outside / 'raw', target_is_directory=directory_link)
            with self.assertRaisesRegex(archive.EvidenceError, 'symlink_path'):
                archive.pack_evidence(source, self.root / ('bad-' + str(directory_link) + '.zip'), self.binding)

    def test_source_directory_read_error_is_not_silently_skipped(self):
        def denied(*args, **kwargs):
            kwargs['onerror'](PermissionError('synthetic inaccessible directory'))
            return iter(())
        with patch.object(archive.os, 'walk', side_effect=denied):
            with self.assertRaisesRegex(archive.EvidenceError, 'source_walk_failed'):
                archive.pack_evidence(self.source, self.root / 'denied.zip', self.binding)

    def test_whole_zip_corruption_or_wrong_length_fails(self):
        packed = self.fixture(); data = Path(packed['path']).read_bytes()
        changed = self.root / 'corrupt.zip'; changed.write_bytes(data[:-1] + bytes([data[-1] ^ 1]))
        with self.assertRaisesRegex(archive.EvidenceError, 'archive_integrity_failure'):
            archive.verify_restore(changed, packed['sha256'], packed['bytes'], self.root / 'bad-hash')
        with self.assertRaisesRegex(archive.EvidenceError, 'archive_integrity_failure'):
            archive.verify_restore(packed['path'], packed['sha256'], packed['bytes'] + 1, self.root / 'bad-length')

    def test_entry_content_corruption_retains_partial_restore(self):
        packed = self.fixture()
        changed, digest, size = self.modified_zip(packed, lambda entries: [(i, b'bad' if i.filename == 'z-payload.bin' else b) for i, b in entries])
        destination = self.root / 'partial'
        with self.assertRaisesRegex(archive.EvidenceError, 'archive_entry_integrity_failure'):
            archive.verify_restore(changed, digest, size, destination)
        self.assertTrue((destination / 'a-empty.bin').exists())
        self.assertFalse((destination / archive.MANIFEST_NAME).exists())
        self.assertTrue(changed.exists())

    def test_missing_and_extra_entries_fail_closed(self):
        packed = self.fixture()
        self.reject_modified(packed, lambda rows: [(i, b) for i, b in rows if i.filename != 'z-payload.bin'], 'archive_entry_set_mismatch')
        self.reject_modified(packed, lambda rows: rows + [(zipfile.ZipInfo('unlisted.txt'), b'extra')], 'archive_entry_set_mismatch')

    def test_duplicate_zip_entry_rejected(self):
        packed = self.fixture()
        self.reject_modified(packed, lambda rows: rows + [rows[0]], 'duplicate_archive_entry')

    def test_traversal_absolute_and_backslash_entries_rejected(self):
        packed = self.fixture()
        for name in ('../escaped.txt', '/absolute.txt', 'dir\\escaped.txt', 'C:/drive.txt'):
            self.reject_modified(packed, lambda rows, n=name: rows + [(zipfile.ZipInfo(n), b'unsafe')], 'unsafe_archive_path')

    def test_zip_symlink_rejected(self):
        packed = self.fixture()
        symlink = zipfile.ZipInfo('link'); symlink.create_system = 3
        symlink.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.reject_modified(packed, lambda rows: rows + [(symlink, b'outside')], 'unsupported_archive_entry')

    def test_manifest_duplicates_and_binding_mismatch_rejected(self):
        packed = self.fixture()
        def duplicate(rows):
            result = []
            for info, raw in rows:
                if info.filename == archive.MANIFEST_NAME:
                    value = json.loads(raw); value['entries'].append(value['entries'][0]); raw = json.dumps(value).encode()
                result.append((info, raw))
            return result
        self.reject_modified(packed, duplicate, 'duplicate_manifest_entry')
        self.reject_modified(packed, lambda rows: [(i, b'{}' if i.filename == archive.BINDING_NAME else b) for i, b in rows], 'binding_integrity_failure')

    def test_missing_or_mismatched_required_source_preserves_inputs(self):
        self.binding['required_source_files'] = [{'path': 'missing', 'bytes': 1, 'sha256': sha(b'x')}]
        with self.assertRaisesRegex(archive.EvidenceError, 'required_source_file_missing'):
            archive.pack_evidence(self.source, self.root / 'missing.zip', self.binding)
        (self.source / 'missing').write_bytes(b'y')
        with self.assertRaisesRegex(archive.EvidenceError, 'required_source_file_mismatch'):
            archive.pack_evidence(self.source, self.root / 'mismatch.zip', self.binding)
        self.assertEqual((self.source / 'missing').read_bytes(), b'y')
        self.assertTrue((self.root / 'mismatch.zip').exists())


if __name__ == '__main__':
    unittest.main()
