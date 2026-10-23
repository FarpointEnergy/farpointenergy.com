from __future__ import annotations

import argparse
from datetime import datetime
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid

from farpoint_analytics import __main__ as cli
from farpoint_analytics.analysis import json_bytes
from farpoint_analytics.archive import create_archive, create_only, local_window_utc, read_verified_archive, restore_archive, verify_archive
from farpoint_analytics.canonical import InvalidData, sha256
from fixtures.golden import golden

EVIDENCE = Path(__file__).parent / ".evidence"


def new_root():
    EVIDENCE.mkdir(exist_ok=True)
    # Deliberately retained: no TemporaryDirectory cleanup or deletion.
    return Path(tempfile.mkdtemp(prefix="archive-test-", dir=EVIDENCE))


def corrupt_copy(source, destination, *, change_file=None, omit_file=None, alter_manifest=None):
    destination.mkdir()
    for source_file in source.rglob("*"):
        if not source_file.is_file():
            continue
        name = source_file.relative_to(source).as_posix()
        if name == omit_file:
            continue
        data = source_file.read_bytes()
        if name == change_file:
            data += b"SYNTHETIC_CORRUPTION"
        if name == "manifest.json" and alter_manifest:
            manifest = json.loads(data)
            alter_manifest(manifest)
            data = json_bytes(manifest)
        create_only(destination / name, data)


class ArchiveTests(unittest.TestCase):
    def test_ARCHIVE_01_local_write_readback_and_no_replace(self):
        root = new_root()
        files = {"raw/one.json": b'{"synthetic":true}', "attachments/synthetic.bin": b"\x00\xfffixture"}
        result = create_archive(root / "archive", files, {"run_id": "synthetic-archive"}, {"collector": True})
        self.assertEqual(result["status"], "complete")
        self.assertEqual(verify_archive(root / "archive")["record_count"], 2)
        before = (root / "archive/raw/one.json").read_bytes()
        with self.assertRaises(FileExistsError):
            create_only(root / "archive/raw/one.json", b"replacement")
        with self.assertRaises(FileExistsError):
            create_archive(root / "archive", {}, {}, {})
        self.assertEqual((root / "archive/raw/one.json").read_bytes(), before)

    def test_ARCHIVE_02_incomplete_source_no_completion(self):
        root = new_root()
        result = create_archive(root / "partial", {"raw/one": b"retained"}, {}, {"collector": False})
        self.assertEqual(result["status"], "partial")
        self.assertTrue((root / "partial/raw/one").exists())
        self.assertFalse((root / "partial/completed.json").exists())
        with self.assertRaisesRegex(InvalidData, "archive_not_completed"):
            verify_archive(root / "partial")

    def test_ARCHIVE_02_failure_preserves_partial_writes(self):
        root = new_root()
        import farpoint_analytics.archive as archive
        original = archive.create_only

        def failing(path, data):
            if Path(path).name == "completed.json":
                raise OSError("synthetic upload failure")
            return original(path, data)

        with patch.object(archive, "create_only", side_effect=failing), self.assertRaises(OSError):
            create_archive(root / "failed", {"raw/one": b"retained"}, {}, {"collector": True})
        self.assertEqual((root / "failed/raw/one").read_bytes(), b"retained")
        self.assertEqual(len(list((root / "failed").glob("failure-*.json"))), 1)
        self.assertFalse((root / "failed/completed.json").exists())

    def test_ARCHIVE_04_additional_corrupt_copies_fail(self):
        root = new_root()
        source = root / "source"
        create_archive(source, {"raw/a": b"original", "attachments/b": b"attachment"}, {}, {"collector": True})
        cases = [({"change_file": "raw/a"}, "archive_entry_integrity_failure"),
                 ({"omit_file": "attachments/b"}, "missing_archive_entry"),
                 ({"alter_manifest": lambda m: m["entries"].append(m["entries"][0])}, "duplicate_manifest_entry"),
                 ({"alter_manifest": lambda m: m.update(record_count=99)}, "archive_count_mismatch")]
        for index, (change, expected) in enumerate(cases):
            target = root / ("corrupt-copy-" + str(index))
            corrupt_copy(source, target, **change)
            with self.assertRaisesRegex(InvalidData, expected):
                verify_archive(target)
        self.assertEqual(verify_archive(source)["record_count"], 2)

    def test_RESTORE_01_separate_verified_destination(self):
        root = new_root()
        create_archive(root / "source", {"raw/a": b"original", "attachments/b": b"\x00\xff"}, {}, {"collector": True})
        source_before = {p.relative_to(root / "source").as_posix(): p.read_bytes() for p in (root / "source").rglob("*") if p.is_file()}
        result = restore_archive(root / "source", root / "restored")
        self.assertEqual(result["status"], "complete")
        self.assertEqual((root / "restored/restored/raw/a").read_bytes(), b"original")
        self.assertEqual((root / "restored/restored/attachments/b").read_bytes(), b"\x00\xff")
        self.assertEqual(source_before, {p.relative_to(root / "source").as_posix(): p.read_bytes() for p in (root / "source").rglob("*") if p.is_file()})
        with self.assertRaises(FileExistsError):
            restore_archive(root / "source", root / "restored")

    def test_RESTORE_01_uses_verified_buffer_not_second_read(self):
        root = new_root()
        create_archive(root / "source", {"raw/a": b"original"}, {}, {"collector": True})
        original_read = Path.read_bytes
        counter = {"reads": 0}

        def racing_read(path):
            if path == root / "source/raw/a":
                counter["reads"] += 1
                if counter["reads"] > 1:
                    return b"SYNTHETIC_CHANGED_SECOND_READ"
            return original_read(path)

        with patch.object(Path, "read_bytes", racing_read):
            restore_archive(root / "source", root / "restored")
        self.assertEqual(counter["reads"], 1)
        self.assertEqual((root / "restored/restored/raw/a").read_bytes(), b"original")

    def test_RESTORE_03_missing_input_blocks_restore(self):
        root = new_root()
        create_archive(root / "source", {"raw/a": b"original"}, {}, {"collector": True})
        corrupt_copy(root / "source", root / "missing", omit_file="raw/a")
        with self.assertRaises(InvalidData):
            restore_archive(root / "missing", root / "recovery")
        self.assertFalse((root / "recovery").exists())

    def test_PRIV_03_path_traversal_rejected_without_execution(self):
        root = new_root()
        for name in ["../escape", "/absolute", "raw/../../escape", "raw\\escape"]:
            with self.subTest(name=name), self.assertRaises(InvalidData):
                create_archive(root / str(uuid.uuid4()), {name: b"untrusted"}, {}, {"collector": True})
        self.assertFalse((root.parent / "escape").exists())

    def test_GOLD_04_archived_timezone_midnight_DST(self):
        # Immutable local test input; production run must archive these exact TZif bytes.
        data = Path("/usr/share/zoneinfo/America/New_York").read_bytes()
        start, end = local_window_utc("2026-03-08", "2026-03-09", data, sha256(data))
        self.assertEqual((start, end), ("2026-03-08T05:00:00.000Z", "2026-03-09T04:00:00.000Z"))
        start, end = local_window_utc("2026-11-01", "2026-11-02", data, sha256(data))
        self.assertEqual((start, end), ("2026-11-01T04:00:00.000Z", "2026-11-02T05:00:00.000Z"))
        with self.assertRaises(InvalidData):
            local_window_utc("2026-03-08", "2026-03-09", data, "0" * 64)

    def test_RESTORE_02_numerical_replay_from_frozen_inputs_no_network(self):
        root = new_root()
        fixture = golden("A")
        paths = {}
        for name in ("receipts", "messages", "classifications", "config"):
            path = root / "input" / (name + ".json")
            create_only(path, json_bytes(fixture[name]))
            paths[name] = str(path)
        args = argparse.Namespace(**paths, resolutions=None, code_commit="fixture-source", output=str(root / "run-A"),
                                  supersedes_run_id=None, runtime_artifact=[])
        with patch("socket.socket", side_effect=AssertionError("network forbidden")):
            result = cli.run(args)
            replayed = cli.replay(argparse.Namespace(archive=str(root / "run-A"), output=str(root / "replay-A")))
        self.assertEqual(result["status"], "complete")
        self.assertFalse(result["runtime_recovery_verified"])
        self.assertEqual(replayed["status"], "complete")
        original = (root / "run-A/outputs/report.json").read_bytes()
        self.assertEqual((root / "replay-A/outputs/replayed-report.json").read_bytes(), original)
        self.assertEqual(json.loads(original)["session_conversion"]["percent"], "25")
        # This proves numerical replay with an available matching Python runtime,
        # not full disaster recovery of a retained portable runtime/OS bundle.


if __name__ == "__main__":
    unittest.main()
