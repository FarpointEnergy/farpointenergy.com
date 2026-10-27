"""Optional provider tests use a real pinned reader and a synthetic MMDB only.

Set FARPOINT_DBIP_READER_SDIST to the separately retained official source archive.
No package acquisition occurs during tests. Licensed provider data is never used.
"""
from __future__ import annotations

import copy
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from farpoint_analytics.analysis import analyze, json_bytes
from farpoint_analytics.archive import create_only, read_verified_archive
from farpoint_analytics.canonical import InvalidData, sha256
from farpoint_analytics.dbip_company import DBIPCompanyDataset, READER_SDIST_SHA256, build_dbip_observations
from farpoint_analytics.dbip_cli import run_archive, replay_archive
from fixtures.dbip import synthetic_mmdb, corporate_record, SYNTHETIC_DATABASE_TYPE, SYNTHETIC_BUILD_EPOCH
from fixtures.golden import event, receipt


READER_PATH = os.environ.get("FARPOINT_DBIP_READER_SDIST")


def fixtures():
    reader = Path(READER_PATH).read_bytes()
    if sha256(reader) != READER_SDIST_SHA256:
        raise AssertionError("Test reader source artifact does not match official pin")
    data = synthetic_mmdb()
    licence = b"SYNTHETIC TEST ONLY; not a real purchase, licence, owner approval or dataset."
    approval = json_bytes({"provider": "DB-IP", "product": "ip-to-isp", "purpose": "farpoint_private_company_context",
                          "dataset_sha256": sha256(data), "dataset_edition": "SYNTHETIC-ONLY",
                          "license_sha256": sha256(licence), "reader_sha256": sha256(reader),
                          "approved": True, "retention_approved": True, "offline_replay_approved": True,
                          "synthetic_test_only": True})
    artifacts = {"synthetic.mmdb": data, "synthetic-license.txt": licence,
                 "synthetic-approval.json": approval, "maxminddb-3.2.0.tar.gz": reader}
    config = {"enabled": True}
    for key, name in zip(("dataset", "license", "approval", "reader"), artifacts):
        config[key] = {"artifact": name, "bytes": len(artifacts[name]), "sha256": sha256(artifacts[name])}
    config["dataset"].update(edition="SYNTHETIC-ONLY", database_type=SYNTHETIC_DATABASE_TYPE, build_epoch=SYNTHETIC_BUILD_EPOCH)
    config["reader"]["version"] = "3.2.0"
    e = event("synthetic-dbip-event")
    r = receipt("synthetic-dbip-receipt", [e])
    r["source_ip"] = {"status": "verified", "provenance": "synthetic-trust", "address": "192.0.2.1"}
    inputs = {"provider_config": config, "receipts": [r],
              "analysis_config": {"mode": "isolated_fixture", "fixture_eligible_event_ids": [e["event_id"]],
                                  "window_start": "2026-10-19T00:00:00Z", "window_end": "2026-10-20T00:00:00Z",
                                  "observation_cutoff": "2026-10-20T01:00:00Z",
                                  "verified_ip_provenances": {"synthetic-trust": ["synthetic-source-proof"]},
                                  "source_completeness": {"collector": True, "mail": True, "classifications": True}},
              "observed_at": "2026-10-19T15:00:00Z", "observation_run_id": "synthetic-dbip-run",
              "evidence_refs": ["synthetic-dataset", "synthetic-approval", "synthetic-reader"]}
    return artifacts, inputs


def root_directory():
    parent = Path(os.environ.get("FARPOINT_PRIVATE_TEST_EVIDENCE", str(Path(__file__).parent / ".evidence")))
    parent.mkdir(parents=True, exist_ok=True)
    return Path(tempfile.mkdtemp(prefix="dbip-test-", dir=parent))


class DisabledDBIPTests(unittest.TestCase):
    def test_unconfigured_provider_has_no_dependency_or_file_side_effects(self):
        root = root_directory()
        for config in (None, {}, {"enabled": False}, {"enabled": 1}, {"enabled": "true"}):
            dataset = DBIPCompanyDataset(config, None, runtime_directory=root / "unused")
            self.assertFalse(dataset.enabled)
            self.assertEqual(dataset.lookup("192.0.2.1", provenance_verified=True)["lookup_reason"], "provider_disabled")
            result = build_dbip_observations(None, None, dataset, observed_at=None, observation_run_id=None, evidence_refs=None)
            self.assertEqual(result["status"], "disabled")
            self.assertEqual(result["observations"], [])
        self.assertFalse((root / "unused").exists())

    def test_disabled_archive_replay_does_not_claim_reader_was_used(self):
        root = root_directory()
        create_only(root / "request.json", json_bytes({"provider_config": {"enabled": False}}))
        result = run_archive(input_path=root / "request.json", artifact_root=root / "not-required",
                             output=root / "disabled", code_commit="a" * 40)
        self.assertEqual(result["analysis_status"], "disabled")
        replay = replay_archive(source=root / "disabled", destination=root / "replay")
        self.assertEqual(replay["status"], "verified")
        self.assertFalse(replay["offline_reader_artifact_used"])
        self.assertFalse((root / "replay/reader-runtime").exists())


@unittest.skipUnless(READER_PATH, "Provide pinned offline reader source artifact; no implicit network install")
class DBIPArtifactTests(unittest.TestCase):
    def setUp(self):
        self.root = root_directory()
        self.artifacts, self.inputs = fixtures()
        self.config = self.inputs["provider_config"]

    def dataset(self, config=None, artifacts=None, name="reader"):
        dataset = DBIPCompanyDataset(config or self.config, artifacts or self.artifacts, runtime_directory=self.root / name)
        self.addCleanup(dataset.close)
        return dataset

    def generate(self, dataset, inputs=None, **changes):
        inputs = inputs or self.inputs
        options = {key: inputs[key] for key in ("observed_at", "observation_run_id", "evidence_refs")}
        options.update(changes)
        return build_dbip_observations(inputs["receipts"], inputs["analysis_config"], dataset, **options)

    def test_real_pinned_decoder_reads_exact_synthetic_ipv4_and_ipv6(self):
        with patch("socket.socket", side_effect=AssertionError("network forbidden")):
            dataset = self.dataset()
            for ip, company in (("192.0.2.1", "SYNTHETIC Example Manufacturing"),
                                ("2001:db8::1", "SYNTHETIC IPv6 Power Plant")):
                row = dataset.lookup(ip, provenance_verified=True)
                self.assertEqual(row["company"], company)
                self.assertEqual(row["identity_category"], "possible_corporate_match")
                self.assertEqual(row["provider_record_sha256"], sha256(json_bytes(row["provider_record"])))
                self.assertIsNone(row["employer"])
            self.assertEqual(dataset.lookup("192.0.2.2", provenance_verified=True)["lookup_reason"], "company_unknown")
        self.assertEqual(dataset.binding["reader_sdist_sha256"], READER_SDIST_SHA256)
        self.assertEqual(len(dataset.binding["reader_source_hashes"]), 7)

    def test_all_artifact_tampering_and_unapproved_retention_fail_before_reader(self):
        for name in self.artifacts:
            artifacts = dict(self.artifacts)
            artifacts[name] += b"changed"
            with self.subTest(artifact=name), self.assertRaises(InvalidData):
                self.dataset(artifacts=artifacts, name="unused")
            self.assertFalse((self.root / "unused").exists())
        import json
        for key, value in (("approved", False), ("approved", 1), ("retention_approved", False),
                           ("offline_replay_approved", False), ("dataset_sha256", "0" * 64),
                           ("license_sha256", "0" * 64), ("reader_sha256", "0" * 64), ("dataset_edition", "other")):
            artifacts, config = dict(self.artifacts), copy.deepcopy(self.config)
            approval = json.loads(artifacts[config["approval"]["artifact"]])
            approval[key] = value
            artifacts[config["approval"]["artifact"]] = raw = json_bytes(approval)
            config["approval"].update(bytes=len(raw), sha256=sha256(raw))
            with self.subTest(binding=key, value=value), self.assertRaises(InvalidData):
                self.dataset(config, artifacts, name="unused")
            self.assertFalse((self.root / "unused").exists())

    def test_reader_and_metadata_bindings_cannot_be_substituted(self):
        config = copy.deepcopy(self.config)
        config["reader"]["version"] = "3.1.0"
        with self.assertRaises(InvalidData):
            self.dataset(config, name="unused")
        for key, value in (("database_type", "other"), ("build_epoch", SYNTHETIC_BUILD_EPOCH + 1)):
            config = copy.deepcopy(self.config)
            config["dataset"][key] = value
            with self.subTest(key=key), self.assertRaises(InvalidData):
                self.dataset(config, name="metadata-" + key)

    def test_unverified_or_invalid_address_cannot_reach_reader(self):
        dataset = self.dataset()
        with patch.object(dataset.reader, "get_with_prefix_len", side_effect=AssertionError("lookup forbidden")):
            self.assertEqual(dataset.lookup("192.0.2.1", provenance_verified=False)["lookup_reason"], "source_ip_unverified")
            self.assertEqual(dataset.lookup("invalid", provenance_verified=True)["lookup_reason"], "source_ip_invalid")
            inputs = copy.deepcopy(self.inputs)
            inputs["receipts"][0]["source_ip"]["provenance"] = "not-approved"
            row = self.generate(dataset, inputs)["observations"][0]
            self.assertFalse(row["ip_provenance_verified"])
            self.assertEqual(row["status"], "unavailable")
            self.assertIsNone(row["company"])

    def test_report_join_determinism_full_record_and_synthetic_exclusion(self):
        dataset = self.dataset()
        frozen = json_bytes(self.inputs)
        result = self.generate(dataset)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(json_bytes(result), json_bytes(self.generate(dataset)))
        row = result["observations"][0]
        self.assertEqual(row["provider_record"], corporate_record())
        self.assertEqual(row["input_receipt_sha256"], sha256(json_bytes(self.inputs["receipts"][0])))
        self.assertNotEqual(row["observation_id"], self.generate(dataset, observation_run_id="another-synthetic-run")["observations"][0]["observation_id"])
        report = analyze(self.inputs["receipts"], [], [], self.inputs["analysis_config"], company_observations=result["observations"])
        self.assertEqual(report["company_context"]["coverage"]["with_possible_company"], 1)
        self.assertEqual(report["company_context"]["coverage"]["verified_employers"], 0)
        changed = copy.deepcopy(self.inputs)
        changed["analysis_config"]["mode"] = "production"
        changed["analysis_config"]["fixture_eligible_event_ids"] = []
        self.assertEqual(self.generate(dataset, changed)["observations"], [])
        self.assertEqual(frozen, json_bytes(self.inputs))

    def test_conflicting_evidence_and_lookup_error_cannot_create_healthy_match(self):
        dataset = self.dataset()
        row = self.generate(dataset, contradictory_receipt_ids=[self.inputs["receipts"][0]["receipt_id"]])["observations"][0]
        self.assertEqual(row["identity_category"], "unknown")
        self.assertIsNone(row["company"])
        self.assertEqual(row["provider_record"], corporate_record())
        for error in (RuntimeError("synthetic reader corruption"), ValueError("synthetic reader closed"),
                      UnicodeDecodeError("utf-8", b"\xff", 0, 1, "synthetic corrupt record")):
            with self.subTest(error=type(error).__name__), patch.object(dataset.reader, "get_with_prefix_len", side_effect=error):
                result = self.generate(dataset)
                self.assertEqual(result["status"], "incomplete")
                self.assertEqual(result["observations"][0]["status"], "error")
                self.assertIsNone(result["observations"][0]["company"])

    def test_known_ipv4_dataset_excludes_ipv6_before_any_lookup(self):
        dataset = self.dataset()
        # The metadata shape is independently verified by the constructor;
        # change the synthetic object here only to isolate the branch guard.
        dataset.metadata["ip_version"] = 4
        with patch.object(dataset.reader, "get_with_prefix_len", side_effect=AssertionError("lookup forbidden")):
            result = dataset.lookup("2001:db8::1", provenance_verified=True)
        self.assertEqual(result["status"], "unavailable")
        self.assertEqual(result["lookup_reason"], "dataset_address_family_unavailable")

    def test_create_only_archive_and_archived_source_replay_with_no_network(self):
        for name, data in self.artifacts.items():
            create_only(self.root / "artifacts" / name, data)
        create_only(self.root / "request.json", json_bytes(self.inputs))
        args = dict(input_path=self.root / "request.json", artifact_root=self.root / "artifacts",
                    output=self.root / "run", code_commit="a" * 40)
        with patch("socket.socket", side_effect=AssertionError("network forbidden")):
            result = run_archive(**args)
        self.assertEqual(result["status"], "complete")
        verified = read_verified_archive(self.root / "run")
        for name, data in self.artifacts.items():
            self.assertEqual(verified["files"]["inputs/artifacts/" + name], data)
        replay = replay_archive(source=self.root / "run", destination=self.root / "fresh-replay")
        self.assertEqual(replay["status"], "verified")
        self.assertEqual((self.root / "fresh-replay/replayed-observations.json").read_bytes(), verified["files"]["outputs/company-observations.json"])
        with self.assertRaises(FileExistsError):
            run_archive(**args)
        with self.assertRaises(FileExistsError):
            replay_archive(source=self.root / "run", destination=self.root / "fresh-replay")

    def test_rejected_approval_preserves_all_original_inputs_without_completion(self):
        inputs = copy.deepcopy(self.inputs)
        inputs["provider_config"]["approval"]["sha256"] = "0" * 64
        for name, data in self.artifacts.items():
            create_only(self.root / "artifacts" / name, data)
        create_only(self.root / "request.json", json_bytes(inputs))
        result = run_archive(input_path=self.root / "request.json", artifact_root=self.root / "artifacts",
                             output=self.root / "failed", code_commit="a" * 40)
        self.assertEqual(result["status"], "partial")
        self.assertEqual(result["failure"], "dbip_approval_integrity_failure")
        self.assertFalse((self.root / "failed/completed.json").exists())
        archive = read_verified_archive(self.root / "failed", require_completion=False)
        for name, data in self.artifacts.items():
            self.assertEqual(archive["files"]["inputs/artifacts/" + name], data)


if __name__ == "__main__":
    unittest.main()
