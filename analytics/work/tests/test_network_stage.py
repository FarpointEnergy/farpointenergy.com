"""Offline synthetic checks; each run keeps all inputs and failure evidence."""
import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import subprocess
import sys
import unittest
import uuid
from unittest.mock import patch
import zipfile


ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "analytics/tests/python"))
from fixtures.golden import event, receipt

spec = importlib.util.spec_from_file_location("network_stage", ROOT / "analytics/work/network_stage.py")
stage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stage)

DATASET = b"192.0.2.0\t192.0.2.255\t64500\tZZ\tSYNTHETIC NETWORK\n2001:db8::\t2001:db8::ffff\t64501\tZZ\tSYNTHETIC IPV6\n"


def digest(data):
    return hashlib.sha256(data).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()


def saved(root, name, data):
    path = root / name
    stage._write(path, data)
    return {"path": str(path), "bytes": len(data), "sha256": digest(data)}


def archive(root, files, *, extra=None, bad_member=None, symlink=None, manifest_changes=None):
    entries = [{"path": name, "bytes": len(data), "sha256": digest(data)} for name, data in files.items()]
    if bad_member is not None:
        entries[bad_member]["sha256"] = "0" * 64
    manifest = {"files": entries, "file_count": len(entries), "total_file_bytes": sum(e["bytes"] for e in entries)}
    if manifest_changes:
        manifest.update(manifest_changes)
    raw = encode(manifest)
    path = root / ("source-" + str(uuid.uuid4()) + ".zip")
    with zipfile.ZipFile(path, "x", compression=zipfile.ZIP_DEFLATED) as z:
        for name, data in files.items():
            if name == symlink:
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                z.writestr(info, data)
            else:
                z.writestr(name, data)
        z.writestr(stage.MANIFEST_NAME, raw)
        if extra:
            z.writestr(extra[0], extra[1])
    return {"path": str(path), **stage._file_info(path), "expected_manifest_sha256": digest(raw)}


def fixture(root, *, source=None, receipts_count=1):
    events = [event(f"synthetic-network-event-{i}") for i in range(receipts_count)]
    rows = [receipt(f"synthetic-network-receipt-{i}", [e]) for i, e in enumerate(events)]
    for r in rows:
        r["source_ip"] = source if source is not None else {
            "status": "verified", "provenance": "synthetic-trust", "address": "192.0.2.1"}
    config = {"mode": "isolated_fixture", "fixture_eligible_event_ids": [e["event_id"] for e in events],
              "window_start": "2026-10-19T00:00:00Z", "window_end": "2026-10-20T00:00:00Z",
              "observation_cutoff": "2026-10-20T01:00:00Z", "execution_code_commit": "a" * 40,
              "verified_ip_provenances": {"synthetic-trust": ["synthetic-independent-proof"]},
              "source_completeness": {"collector": True, "mail": True, "classifications": True}}
    html = b"<html>Synthetic source snapshot</html>"
    license_data = b"<html>Synthetic license snapshot</html>"
    provenance = {"source_url": "https://example.test/synthetic.tsv", "license": "synthetic fixture",
                  "retention_approved": True, "dataset_sha256": digest(DATASET),
                  "source_evidence": [
                      {"path": "source.html", "bytes": len(html), "sha256": digest(html), "complete": True},
                      {"path": "license.html", "bytes": len(license_data), "sha256": digest(license_data), "complete": True}]}
    files = {"dataset/data.tsv": DATASET, "dataset/provenance.json": encode(provenance),
             "dataset/source.html": html, "dataset/license.html": license_data,
             "other/retained-evidence.txt": b"Complete original archive remains retained."}
    ds = {**archive(root, files), "manifest_name": stage.MANIFEST_NAME,
          "dataset_member": "dataset/data.tsv", "provenance_member": "dataset/provenance.json",
          "evidence_members": ["dataset/source.html", "dataset/license.html"]}
    receipts = [saved(root, f"receipt-{i}.json", b" \n" + encode(r) + b"\n") for i, r in enumerate(rows)]
    proof = {**saved(root, "proof.bin", b"Synthetic independent trusted-proxy evidence\x00\xff"),
             "ref": "synthetic-independent-proof"}
    request = {"op": "run", "dataset_archive": ds, "receipts": receipts, "config": config,
               "run_id": "synthetic-stage-" + uuid.uuid4().hex, "code_commit": "a" * 40,
               "provenance_evidence": [proof], "observed_at": "2026-10-19T15:00:00Z"}
    return request, files


class NetworkStageTests(unittest.TestCase):
    def setUp(self):
        self.root = ROOT.parent / "farpoint-network-stage-test-evidence" / ("network-stage-" + str(uuid.uuid4()))
        self.root.mkdir(parents=True)

    def assert_failure(self, request, reason):
        with self.assertRaisesRegex(stage.StageFailure, reason) as caught:
            stage.run_stage(request, self.root, ROOT)
        path = Path(caught.exception.failure_directory)
        self.assertTrue((path / "request.json").is_file())
        self.assertTrue(list(path.glob("failure-*.json")))
        return path

    def test_complete_archive_exact_inputs_and_fresh_frozen_source_replay(self):
        request, files = fixture(self.root)
        with patch("socket.socket", side_effect=AssertionError("network forbidden")):
            result = stage.run_stage(request, self.root, ROOT)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["summary"]["with_network_context"], 1)
        self.assertEqual(result["summary"]["verified_employers"], 0)
        row = result["observations"][0]
        self.assertIsNone(row["employer"])
        self.assertTrue(row["network_organization"].startswith("SYNTHETIC"))
        obs_bytes = base64.b64decode(result["observations_base64"], validate=True)
        self.assertEqual(digest(obs_bytes), result["observations_sha256"])
        self.assertEqual(json.loads(obs_bytes), result["observations"])
        run = Path(result["run_directory"])
        self.assertEqual((run / "inputs/receipts/00000000.json").read_bytes(), Path(request["receipts"][0]["path"]).read_bytes())
        self.assertEqual((run / "inputs/original-dataset.zip").read_bytes(), Path(request["dataset_archive"]["path"]).read_bytes())
        self.assertEqual((run / "dataset-members/dataset/license.html").read_bytes(), files["dataset/license.html"])
        verify = {"op": "verify", "archive": result["archive"], "expected_manifest_sha256": result["archive"]["manifest_sha256"]}
        restored = stage.verify_stage(verify, self.root)
        self.assertEqual(restored["status"], "verified")
        self.assertTrue(restored["observations_match"])
        self.assertTrue(restored["archived_source_used"])
        self.assertTrue(restored["python_socket_calls_blocked"])
        self.assertFalse(restored["independent_os_runtime_recovery"])
        self.assertEqual(restored["observations_sha256"], result["observations_sha256"])
        second = stage.verify_stage(verify, self.root)
        self.assertNotEqual(restored["run_directory"], second["run_directory"])
        self.assertTrue((Path(restored["run_directory"]) / "verified.json").is_file())

    def test_ipv6_and_unverified_network_provenance(self):
        for source, known in [({"status": "verified", "provenance": "synthetic-trust", "address": "2001:db8::1"}, True),
                              ({"status": "verified", "provenance": "unverified", "address": "192.0.2.1"}, False)]:
            root = self.root / str(uuid.uuid4()); root.mkdir()
            request, _ = fixture(root, source=source)
            result = stage.run_stage(request, root, ROOT)
            row = result["observations"][0]
            self.assertEqual(bool(row["network_organization"]), known)
            self.assertEqual(row["ip_provenance_verified"], known)
            self.assertIsNone(row["employer"])

    def test_bad_outer_hash_preserves_copied_bytes_and_original(self):
        request, _ = fixture(self.root)
        original = Path(request["dataset_archive"]["path"]).read_bytes()
        request["dataset_archive"]["sha256"] = "0" * 64
        failed = self.assert_failure(request, "input_integrity_mismatch")
        self.assertEqual((failed / "inputs/original-dataset.zip").read_bytes(), original)
        self.assertEqual(Path(request["dataset_archive"]["path"]).read_bytes(), original)

    def test_expected_manifest_hash_is_mandatory_and_checked(self):
        for missing in (False, True):
            root = self.root / str(uuid.uuid4()); root.mkdir()
            request, _ = fixture(root)
            if missing:
                del request["dataset_archive"]["expected_manifest_sha256"]
            else:
                request["dataset_archive"]["expected_manifest_sha256"] = "0" * 64
            self.assert_failure(request, "manifest_hash_required" if missing else "manifest_integrity_mismatch")

    def test_corrupt_unselected_member_fails_every_entry_check(self):
        request, files = fixture(self.root)
        request["dataset_archive"].update(archive(self.root, files, bad_member=4))
        self.assert_failure(request, "archive_member_integrity_mismatch")

    def test_unlisted_zip_entry_rejected(self):
        request, files = fixture(self.root)
        request["dataset_archive"].update(archive(self.root, files, extra=("unlisted.txt", b"unlisted")))
        self.assert_failure(request, "archive_entry_set_mismatch")

    def test_traversal_symlink_and_path_collision_members_rejected(self):
        for key, expected in [("../escape", "unsafe_archive_path"), ("/escape", "unsafe_archive_path"),
                              ("C:/escape", "unsafe_archive_path"), ("dataset\\escape", "unsafe_archive_path"),
                              ("dataset/link", "unsupported_archive_entry"),
                              ("dataset", "archive_path_collision")]:
            root = self.root / str(uuid.uuid4()); root.mkdir()
            request, files = fixture(root)
            files[key] = b"symlink or unsafe path"
            request["dataset_archive"].update(archive(root, files, symlink=key if key == "dataset/link" else None))
            self.assert_failure(request, expected)
        self.assertFalse((self.root / "escape").exists())

    def test_input_symlink_rejected(self):
        request, _ = fixture(self.root)
        link = self.root / "linked-source.zip"
        link.symlink_to(request["dataset_archive"]["path"])
        request["dataset_archive"]["path"] = str(link)
        self.assert_failure(request, "symlink_path")

    def test_source_evidence_hash_binding_and_retention_required(self):
        for change, expected in [("retention", "invalid_dataset_provenance"), ("source", "source_evidence_integrity_mismatch")]:
            root = self.root / str(uuid.uuid4()); root.mkdir()
            request, files = fixture(root)
            provenance = json.loads(files["dataset/provenance.json"])
            if change == "retention":
                provenance["retention_approved"] = False
            else:
                provenance["source_evidence"][0]["sha256"] = "0" * 64
            files["dataset/provenance.json"] = encode(provenance)
            request["dataset_archive"].update(archive(root, files))
            self.assert_failure(request, expected)

    def test_arbitrary_textual_provenance_ref_is_not_sufficient(self):
        request, _ = fixture(self.root)
        request["config"]["verified_ip_provenances"]["synthetic-trust"] = ["unretained-arbitrary-label"]
        failed = self.assert_failure(request, "unretained_provenance_evidence")
        self.assertTrue((failed / "inputs/provenance-evidence/00000000.bin").is_file())

    def test_receipt_integrity_failure_preserves_inputs_and_partial_cli_archive(self):
        request, _ = fixture(self.root)
        receipt_value = json.loads(Path(request["receipts"][0]["path"]).read_bytes())
        receipt_value["receipt_body_sha256"] = "0" * 64
        request["receipts"] = [saved(self.root, "corrupt-receipt.json", encode(receipt_value))]
        failed = self.assert_failure(request, "offline_network_stage_failed")
        self.assertTrue((failed / "network-run/inputs/receipts.json").is_file())
        self.assertFalse((failed / "network-run/completed.json").exists())
        self.assertTrue((failed / "logs/run/stdout.json").is_file())

    def test_receipt_exact_byte_integrity_and_invalid_json_fail_before_analysis(self):
        request, _ = fixture(self.root)
        request["receipts"][0]["sha256"] = "0" * 64
        failed = self.assert_failure(request, "input_integrity_mismatch")
        self.assertTrue((failed / "inputs/receipts/00000000.json").is_file())
        self.assertFalse((failed / "network-run").exists())
        request["receipts"] = [saved(self.root, "bad-receipt.json", b'{"secret":"synthetic",bad')]
        failed = self.assert_failure(request, "invalid_json")
        self.assertEqual((failed / "inputs/receipts/00000000.json").read_bytes(), b'{"secret":"synthetic",bad')

    def test_commit_mismatch_rejected(self):
        request, _ = fixture(self.root)
        request["config"]["execution_code_commit"] = "b" * 40
        self.assert_failure(request, "execution_commit_mismatch")

    def test_verify_rejects_corrupted_download_and_retains_download(self):
        request, _ = fixture(self.root)
        result = stage.run_stage(request, self.root, ROOT)
        altered = {**result["archive"], "sha256": "0" * 64}
        with self.assertRaisesRegex(stage.StageFailure, "input_integrity_mismatch") as caught:
            stage.verify_stage({"op": "verify", "archive": altered,
                                "expected_manifest_sha256": result["archive"]["manifest_sha256"]}, self.root)
        self.assertTrue((Path(caught.exception.failure_directory) / "downloaded-stage.zip").is_file())

    def test_never_overwrites_existing_file(self):
        stage._write(self.root / "original.bin", b"original")
        with self.assertRaises(FileExistsError):
            stage._write(self.root / "original.bin", b"replacement")
        self.assertEqual((self.root / "original.bin").read_bytes(), b"original")

    def test_private_root_inside_repository_rejected_before_any_write(self):
        request, _ = fixture(self.root)
        forbidden = ROOT / "private-stage-must-not-exist" / str(uuid.uuid4())
        with self.assertRaisesRegex(stage.StageFailure, "private_root_inside_repository"):
            stage.run_stage(request, forbidden, ROOT)
        with self.assertRaisesRegex(stage.StageFailure, "private_root_inside_repository"):
            stage.verify_stage({"op": "verify"}, forbidden)
        self.assertFalse(forbidden.exists())
        cmd = [sys.executable, str(ROOT / "analytics/work/network_stage.py"), "--root", str(forbidden), "--repository", str(ROOT)]
        result = subprocess.run(cmd, input='{"op":"verify"}\n', text=True, capture_output=True)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(json.loads(result.stdout.splitlines()[1])["reason"], "private_root_inside_repository")
        self.assertFalse(forbidden.exists())

    def test_transport_bound_chunks_recover_exact_utf8(self):
        value = {"status": "ok", "result": {"observations_base64": "A" * 50000, "label": "电力 🧑🏽‍🚀" * 10000}}
        descriptor = json.loads(stage.transport_response(self.root, {"stream_results": True}, value))["result_stream"]
        chunks, offset = [], 0
        while offset < descriptor["bytes"]:
            part = stage.read_result_chunk(self.root, {"path": descriptor["path"], "offset": offset, "max_bytes": 8192})
            data = base64.b64decode(part["base64"], validate=True)
            self.assertEqual(part["sha256"], digest(data))
            self.assertLess(len(json.dumps(part)), 16384)
            chunks.append(data); offset += len(data)
        raw = b"".join(chunks)
        self.assertEqual(digest(raw), descriptor["sha256"])
        self.assertEqual(json.loads(raw), value)
        for changes in ({"path": "../other"}, {"offset": -1}, {"offset": True}, {"max_bytes": 8193}):
            with self.assertRaises(stage.StageFailure):
                stage.read_result_chunk(self.root, {"path": descriptor["path"], "offset": 0, **changes})

    def test_cli_ready_safe_error_and_run_verify(self):
        request, _ = fixture(self.root)
        cmd = [sys.executable, str(ROOT / "analytics/work/network_stage.py"), "--root", str(self.root), "--repository", str(ROOT)]
        completed = subprocess.run(cmd, input=json.dumps(request) + "\n", text=True, capture_output=True)
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        lines = completed.stdout.splitlines()
        self.assertEqual(lines[0], "READY")
        value = json.loads(lines[1]); self.assertEqual(value["status"], "ok")
        self.assertEqual(value["result"]["status"], "complete")
        completed = subprocess.run(cmd, input='{"op":"bad","private":"SYNTHETIC_SENTINEL"}\n', text=True, capture_output=True)
        self.assertEqual(completed.returncode, 1)
        self.assertNotIn("SYNTHETIC_SENTINEL", completed.stdout + completed.stderr)
        self.assertEqual(json.loads(completed.stdout.splitlines()[1])["reason"], "unsupported_operation")


if __name__ == "__main__":
    unittest.main()
