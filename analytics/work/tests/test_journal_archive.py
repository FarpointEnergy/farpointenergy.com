"""Journal ZIP verification against an independent frozen file inventory."""
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import unittest
import uuid
import zipfile

spec = importlib.util.spec_from_file_location('journal_archive', Path(__file__).parents[1] / 'evidence_archive.py')
archive = importlib.util.module_from_spec(spec); spec.loader.exec_module(archive)
sha = lambda data: hashlib.sha256(data).hexdigest()


class JournalArchiveTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(os.environ.get('FARPOINT_EVIDENCE_TEST_ROOT', Path(__file__).parent / '.evidence')) / str(uuid.uuid4())
        self.source = self.root / 'source'; self.source.mkdir(parents=True)
        self.payloads = {'empty.bin': b'', 'nested/电力.txt': 'Synthetic — 电力'.encode(), 'binary.bin': b'\x00\xff\x01'}
        self.entries = []
        for name, data in self.payloads.items():
            p = self.source / name; p.parent.mkdir(exist_ok=True); p.write_bytes(data)
            self.entries.append({'path': name, 'bytes': len(data), 'sha256': sha(data)})
        self.commit = 'a' * 40; self.run = 'synthetic-journal'

    def pack(self):
        return archive.pack_journal(self.source, self.root / (str(uuid.uuid4()) + '.zip'), self.run, self.commit, self.entries)

    def verify(self, descriptor, **override):
        args = dict(zip_path=descriptor['path'], expected_sha256=descriptor['sha256'], expected_bytes=descriptor['bytes'],
                    new_destination=self.root / ('restored-' + str(uuid.uuid4())), run_id=self.run,
                    source_commit=self.commit, entries=self.entries, manifest_sha256=descriptor['manifest_sha256'])
        args.update(override)
        return archive.verify_journal(**args)

    def test_exact_inventory_binary_unicode_empty_fresh_restore(self):
        packed = self.pack(); result = self.verify(packed)
        self.assertTrue(result['verified']); self.assertTrue(result['entries_verified'])
        self.assertEqual(result['record_count'], 3)
        self.assertNotIn('pipeline_completion', result['binding'])
        for name, data in self.payloads.items():
            self.assertEqual((Path(result['path']) / name).read_bytes(), data)
        self.assertTrue(Path(packed['path']).exists())

    def test_source_inventory_requires_all_and_only_frozen_paths(self):
        for entries in (self.entries[:-1], self.entries + [{'path':'missing', 'bytes':0, 'sha256':sha(b'')}],
                        self.entries + [self.entries[0]]):
            with self.subTest(entries=len(entries)), self.assertRaises(archive.EvidenceError):
                archive.pack_journal(self.source, self.root / (str(uuid.uuid4())+'.zip'), self.run, self.commit, entries)

    def test_foreign_run_commit_manifest_or_inventory_cannot_pass(self):
        packed = self.pack()
        changed = copy.deepcopy(self.entries); changed[0]['sha256'] = '0' * 64
        for overrides in ({'run_id':'foreign'}, {'source_commit':'b'*40}, {'manifest_sha256':'0'*64},
                          {'entries':changed}, {'entries':self.entries[:-1]}):
            with self.subTest(overrides=list(overrides)), self.assertRaises(archive.EvidenceError): self.verify(packed, **overrides)

    def test_rehashed_zip_with_rewritten_internal_manifest_still_fails_external_inventory(self):
        packed = self.pack()
        with zipfile.ZipFile(packed['path']) as z:
            members = {info.filename:z.read(info) for info in z.infolist()}
        altered = b'NEW'; members['binary.bin'] = altered
        manifest = json.loads(members[archive.MANIFEST_NAME]); binding = manifest['binding']
        for entries in (manifest['entries'], binding['required_source_files']):
            next(e for e in entries if e['path']=='binary.bin').update(bytes=len(altered), sha256=sha(altered))
        bound = archive._json_bytes(binding); members[archive.BINDING_NAME] = bound
        manifest.update(binding_bytes=len(bound), binding_sha256=sha(bound))
        members[archive.MANIFEST_NAME] = archive._json_bytes(manifest)
        path = self.root / 'rehashed.zip'
        with zipfile.ZipFile(path, 'x') as z:
            for name, data in members.items(): z.writestr(archive._zip_info(name), data)
        data = path.read_bytes()
        rehashed = {**packed, 'path':str(path), 'bytes':len(data), 'sha256':sha(data), 'manifest_sha256':sha(members[archive.MANIFEST_NAME])}
        with self.assertRaisesRegex(archive.EvidenceError, 'journal_expected_inventory_mismatch'): self.verify(rehashed)
        self.assertEqual(sha(Path(packed['path']).read_bytes()), packed['sha256'])

    def test_wrong_frozen_bytes_and_symlinks_never_silently_pack(self):
        (self.source/'binary.bin').write_bytes(b'altered')
        with self.assertRaisesRegex(archive.EvidenceError, 'required_source_file_mismatch'): self.pack()
        self.assertTrue(any(self.root.glob('*.zip')), 'partial attempt is retained')
        (self.source/'link').symlink_to(self.source/'empty.bin')
        with self.assertRaisesRegex(archive.EvidenceError, 'symlink_path'): self.pack()

    def test_existing_restore_and_archive_never_replaced(self):
        packed=self.pack(); restored=self.verify(packed)
        with self.assertRaisesRegex(archive.EvidenceError,'restore_destination_exists'):
            self.verify(packed,new_destination=Path(restored['path']))
        with self.assertRaises(FileExistsError):
            archive.pack_journal(self.source,packed['path'],self.run,self.commit,self.entries)

    def test_journal_binding_cannot_claim_a_pipeline_completion(self):
        binding={'schema_version':1,'kind':'farpoint_pipeline_journal','run_id':self.run,'source_commit':self.commit,
                 'required_source_files':self.entries,'pipeline_completion':{'id':'invented','bytes':0,'sha256':sha(b'')}}
        with self.assertRaisesRegex(archive.EvidenceError,'invalid_journal_binding'):
            archive.pack_evidence(self.source,self.root/'invented.zip',binding)


if __name__ == '__main__': unittest.main()
