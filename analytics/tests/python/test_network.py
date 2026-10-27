from __future__ import annotations

import argparse
import copy
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from farpoint_analytics import __main__ as cli
from farpoint_analytics.analysis import analyze, json_bytes
from farpoint_analytics.archive import create_only, verify_archive
from farpoint_analytics.canonical import InvalidData, sha256
from farpoint_analytics.enrichment import IPToASN
from farpoint_analytics.network import build_network_observations
from fixtures.golden import event, receipt


DATASET = b"192.0.2.0\t192.0.2.255\t64500\tZZ\tSYNTHETIC NETWORK\n2001:db8::\t2001:db8::ffff\t64501\tZZ\tSYNTHETIC IPV6\n"


def fixture():
    e = event("synthetic-network-event")
    r = receipt("synthetic-network-receipt", [e])
    r["source_ip"] = {"status": "verified", "provenance": "synthetic-trust", "address": "192.0.2.1"}
    config = {"mode": "isolated_fixture", "fixture_eligible_event_ids": [e["event_id"]],
              "window_start": "2026-10-19T00:00:00Z", "window_end": "2026-10-20T00:00:00Z",
              "observation_cutoff": "2026-10-20T01:00:00Z",
              "verified_ip_provenances": {"synthetic-trust": ["synthetic-provenance-proof"]},
              "source_completeness": {"collector": True, "mail": True, "classifications": True}}
    return [r], config


def generate(receipts, config, **changes):
    options = {"observed_at": "2026-10-19T15:00:00Z", "observation_run_id": "synthetic-network-run",
               "evidence_refs": ["synthetic-dataset-bytes"], "retention_approved": True, **changes}
    return build_network_observations(receipts, config, IPToASN(DATASET, sha256(DATASET)), **options)


class NetworkTests(unittest.TestCase):
    def test_verified_ipv4_ipv6_join_to_exact_event_without_employer_claim(self):
        for ip in ("192.0.2.1", "2001:db8::1"):
            receipts, config = fixture()
            receipts[0]["source_ip"]["address"] = ip
            before = json_bytes([receipts, config])
            generated = generate(receipts, config)
            self.assertEqual(generated["status"], "complete")
            row = generated["observations"][0]
            self.assertEqual(row["receipt_ids"], [receipts[0]["receipt_id"]])
            self.assertEqual(row["event_ids"], config["fixture_eligible_event_ids"])
            self.assertIsNone(row["employer"])
            self.assertTrue(row["network_organization"].startswith("SYNTHETIC"))
            report = analyze(receipts, [], [], config, company_observations=generated["observations"])
            self.assertEqual(report["company_context"]["coverage"]["with_network_context"], 1)
            self.assertEqual(report["company_context"]["coverage"]["with_possible_company"], 0)
            self.assertEqual(report["company_context"]["coverage"]["verified_employers"], 0)
            self.assertEqual(json_bytes([receipts, config]), before)

    def test_unverified_provenance_and_invalid_source_shape_never_lookup(self):
        for source in ({"status": "verified", "provenance": "unverified", "address": "192.0.2.1"},
                       {"status": "verified", "provenance": [], "address": "192.0.2.1"},
                       {"status": "verified", "provenance": "synthetic-trust", "address": []}, None):
            receipts, config = fixture()
            receipts[0]["source_ip"] = source
            row = generate(receipts, config)["observations"][0]
            self.assertEqual(row["status"], "unavailable")
            self.assertFalse(row["ip_provenance_verified"])
            self.assertIsNone(row["network_organization"])

    def test_unknown_network_is_explicit_and_run_replay_is_deterministic(self):
        receipts, config = fixture()
        receipts[0]["source_ip"]["address"] = "198.51.100.1"
        before = generate(receipts, config)
        self.assertEqual(before["observations"][0]["lookup_reason"], "network_unknown")
        self.assertEqual(json_bytes(before), json_bytes(generate(receipts, config)))
        later = generate(receipts, config, observation_run_id="synthetic-second-run")
        self.assertNotEqual(before["observations"][0]["observation_id"], later["observations"][0]["observation_id"])

    def test_as_zero_unrouted_ranges_are_unknown_not_network_organizations(self):
        data = b"192.0.2.0\t192.0.2.255\t0\tNone\tNot routed\n"
        receipts, config = fixture()
        result = build_network_observations(receipts, config, IPToASN(data, sha256(data)),
                                           observed_at="2026-10-19T15:00:00Z",
                                           observation_run_id="synthetic-as0-run",
                                           evidence_refs=["synthetic-as0-dataset"], retention_approved=True)
        row = result["observations"][0]
        self.assertEqual(row["status"], "unavailable")
        self.assertEqual(row["lookup_reason"], "network_unrouted")
        self.assertIsNone(row["network_organization"])
        report = analyze(receipts, [], [], config, company_observations=result["observations"])
        self.assertEqual(report["company_context"]["coverage"]["with_network_context"], 0)

    def test_duplicate_receipt_corruption_produces_incomplete_diagnostic(self):
        receipts, config = fixture()
        receipts.append(copy.deepcopy(receipts[0]))
        result = generate(receipts, config)
        self.assertEqual(result["status"], "incomplete")
        self.assertEqual(result["observations"], [])
        self.assertTrue(result["receipt_integrity_errors"])

    def test_scope_gates_and_dataset_hash_fail_closed(self):
        receipts, config = fixture()
        for options in ({"retention_approved": False}, {"evidence_refs": []},
                        {"observation_run_id": "bad"}, {"observed_at": "2026-10-20T02:00:00Z"},
                        {"observed_at": "2026-10-19T13:00:00Z"}):
            with self.assertRaises(InvalidData):
                generate(receipts, config, **options)
        with self.assertRaises(InvalidData):
            IPToASN(DATASET, "0" * 64)
        receipts, config = fixture()
        config["fixture_eligible_event_ids"] = []
        config["mode"] = "production"
        self.assertEqual(generate(receipts, config)["observations"], [])

    def test_cli_archives_exact_dataset_provenance_inputs_and_refuses_replacement(self):
        evidence = Path(__file__).parent / ".evidence"
        evidence.mkdir(exist_ok=True)
        root = Path(tempfile.mkdtemp(prefix="network-test-", dir=evidence))
        receipts, config = fixture()
        provenance = {"source_url": "https://example.test/synthetic.tsv", "license": "synthetic fixture",
                      "dataset_sha256": sha256(DATASET), "retention_approved": True}
        paths = {}
        for name, data in {"receipts": json_bytes(receipts), "config": json_bytes(config),
                           "dataset_provenance": json_bytes(provenance), "dataset": DATASET}.items():
            path = root / "inputs" / name
            create_only(path, data)
            paths[name] = str(path)
        args = argparse.Namespace(**paths, dataset_sha256=sha256(DATASET), observed_at="2026-10-19T15:00:00Z",
                                  run_id="synthetic-network-cli", code_commit="fixture", output=str(root / "run"))
        with patch("socket.socket", side_effect=AssertionError("network forbidden")):
            result = cli.network_context(args)
        self.assertEqual(result["status"], "complete")
        self.assertEqual(result["observations"], 1)
        self.assertEqual((root / "run/inputs/dataset.tsv").read_bytes(), DATASET)
        self.assertEqual((root / "run/inputs/dataset-provenance.json").read_bytes(), json_bytes(provenance))
        self.assertEqual((root / "run/inputs/receipts.json").read_bytes(), json_bytes(receipts))
        self.assertEqual(verify_archive(root / "run")["status"], "verified")
        with self.assertRaises(FileExistsError):
            cli.network_context(args)
