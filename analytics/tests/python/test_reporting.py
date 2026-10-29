from __future__ import annotations

import copy
import argparse
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from farpoint_analytics import __main__ as cli
from farpoint_analytics.analysis import analyze, json_bytes
from farpoint_analytics.archive import create_only
from fixtures.golden import event, golden, receipt


def report(fixture, observations=()):
    return analyze(fixture["receipts"], fixture["messages"], fixture["classifications"],
                   fixture["config"], company_observations=observations)


def observation(fixture, **changes):
    r = fixture["receipts"][0]
    row = report(fixture)["tables"]["events"][0]
    return {"observation_id": "synthetic-network-observation", "provider": "IPtoASN", "kind": "network",
            "observed_at": "2026-10-19T14:20:00Z", "rule_version": "synthetic-network-1",
            "status": "ok", "receipt_ids": [r["receipt_id"]], "event_ids": [row["event"]["event_id"]],
            "evidence_refs": ["synthetic-dataset-artifact"], "input_ip": "192.0.2.1",
            "dataset_sha256": "a" * 64, "network_organization": "SYNTHETIC NETWORK",
            "ip_provenance_verified": True, "retention_approved": True, **changes}


def verified_fixture():
    fixture = golden("A")
    fixture["config"]["verified_ip_provenances"] = {"synthetic-gateway-test": ["synthetic-ip-probe-evidence"]}
    fixture["receipts"][0]["source_ip"] = {
        "status": "verified", "provenance": "synthetic-gateway-test", "address": "192.0.2.1"}
    return fixture


class ReportingTests(unittest.TestCase):
    def test_equal_time_equivalent_classification_choice_is_order_independent(self):
        fixture = golden("A")
        fixture["classifications"][0]["declared_contact"] = {"name": "Synthetic Buyer", "company": "SYNTHETIC COMPANY"}
        equivalent = {**fixture["classifications"][0], "classification_id": "AAA_synthetic_equivalent"}
        fixture["classifications"].append(equivalent)
        original = report(fixture)
        fixture["classifications"].reverse()
        self.assertEqual(json_bytes(report(fixture)), json_bytes(original))
        contact = original["declared_contacts"][0]
        self.assertEqual(contact["evidence"][0]["classification_id"], "AAA_synthetic_equivalent")

    def test_submillisecond_company_correction_uses_later_observation(self):
        fixture = verified_fixture()
        older = observation(fixture, provider="synthetic-approved-provider", kind="company", network_category="vpn",
                            company="SYNTHETIC COMPANY", observed_at="2026-10-19T14:20:00.000100Z")
        newer = {**older, "observation_id": "synthetic-newer", "network_category": "corporate",
                 "observed_at": "2026-10-19T14:20:00.000900Z"}
        actual = report(fixture, [older, newer])
        self.assertEqual(actual["company_context"]["coverage"]["with_possible_company"], 1)
        self.assertEqual(len(actual["company_context"]["observations"]), 2)
        row = next(x for x in actual["company_context"]["session_categories"] if x["observation_ids"])
        self.assertEqual(row["active_observation_ids"], ["synthetic-newer"])
        self.assertEqual(json_bytes(actual), json_bytes(report(fixture, [newer, older])))
        self.assertEqual([x["observed_at"] for x in actual["company_context"]["observations"]],
                         ["2026-10-19T14:20:00.000100Z", "2026-10-19T14:20:00.000900Z"])

    def test_company_input_and_expanded_report_are_archived_and_replayed_offline(self):
        evidence = Path(__file__).parent / ".evidence"
        evidence.mkdir(exist_ok=True)
        root = Path(tempfile.mkdtemp(prefix="reporting-test-", dir=evidence))
        fixture = verified_fixture()
        fixture["company_observations"] = [observation(fixture)]
        paths = {}
        for name in ("receipts", "messages", "classifications", "company_observations", "config"):
            path = root / "inputs" / (name + ".json")
            create_only(path, json_bytes(fixture[name]))
            paths[name] = str(path)
        args = argparse.Namespace(**paths, resolutions=None, code_commit="fixture-source", output=str(root / "run"),
                                  supersedes_run_id=None, runtime_artifact=[])
        with patch("socket.socket", side_effect=AssertionError("network forbidden")):
            result = cli.run(args)
            cli.replay(argparse.Namespace(archive=str(root / "run"), output=str(root / "replayed")))
        self.assertEqual(result["status"], "complete")
        self.assertEqual((root / "run/inputs/company_observations.json").read_bytes(), json_bytes(fixture["company_observations"]))
        original = (root / "run/outputs/report.json").read_bytes()
        self.assertEqual((root / "replayed/outputs/replayed-report.json").read_bytes(), original)
        self.assertEqual(json.loads(original)["company_context"]["coverage"]["with_network_context"], 1)

    def test_attribution_separates_first_and_session_touch_with_denominators(self):
        actual = report(golden("A"))
        attribution = actual["attribution"]
        self.assertEqual(sum(x["sessions"] for x in attribution["session_entry"]), 8)
        self.assertEqual(sum(x["received_inquiries"] for x in attribution["session_entry"]), 2)
        first_a = next(x for x in attribution["first_observed_browser_touch"] if x["campaign"] == "A")
        entry_a = next(x for x in attribution["session_entry"] if x["campaign"] == "A")
        self.assertEqual((first_a["sessions"], first_a["session_conversion"]["numerator"]), (2, 1))
        self.assertEqual((entry_a["sessions"], entry_a["session_conversion"]["numerator"]), (1, 0))
        direct = next(x for x in attribution["session_entry"] if x["referrer_category"] == "direct_unknown" and x["campaign"] is None)
        self.assertEqual((direct["sessions"], direct["session_conversion"]["numerator"]), (3, 1))
        self.assertIsNone(direct["source"])
        self.assertEqual(sum(x["sessions"] for x in attribution["landing_page"]), 8)

    def test_engagement_is_nonexclusive_and_counts_session_once_per_dimension(self):
        fixture = golden("A")
        extras = [event("syn_product_1", "product_view", at="2026-10-19T13:00:06Z", session="syn_S2", sequence=6, product_id="power"),
                  event("syn_product_2", "product_view", at="2026-10-19T13:00:07Z", session="syn_S2", sequence=7, product_id="power"),
                  event("syn_product_3", "product_view", at="2026-10-19T13:00:08Z", session="syn_S2", sequence=8, product_id="distribution"),
                  event("syn_ref", "reference_select", at="2026-10-19T13:00:09Z", session="syn_S2", sequence=9, reference_id="FP-MPT-115-50")]
        fixture["receipts"].append(receipt("synthetic-products", extras))
        fixture["config"]["fixture_eligible_event_ids"].extend(e["event_id"] for e in extras)
        actual = report(fixture)
        groups = {x["product_id"]: x for x in actual["attribution"]["product_engagement"]}
        self.assertEqual(groups["power"]["session_conversion"]["numerator"], 1)
        self.assertEqual(groups["distribution"]["session_conversion"], {"numerator": 1, "denominator": 1, "percent": "100"})
        self.assertEqual(len(groups["power"]["session_ids"]), len(set(groups["power"]["session_ids"])))
        self.assertIn("product_engagement", actual["attribution"]["nonexclusive_dimensions"])
        reference = next(x for x in actual["attribution"]["reference_engagement"] if x["reference_id"] == "FP-MPT-115-50")
        self.assertEqual(reference["received_inquiries"], 1)

    def test_auditable_tables_preserve_occurrences_dedupe_and_input_order_independence(self):
        fixture = golden("A")
        actual = report(fixture)
        self.assertEqual(len(actual["tables"]["validated_event_occurrences"]), 42)
        self.assertEqual(len(actual["tables"]["events"]), 35)
        self.assertEqual(len(actual["tables"]["sessions"]), 8)
        self.assertEqual(len(actual["tables"]["campaign_touches"]), 35)
        self.assertTrue(all(x["receipt_ids"] for x in actual["tables"]["events"]))
        reversed_fixture = copy.deepcopy(fixture)
        for key in ("receipts", "messages", "classifications"):
            reversed_fixture[key].reverse()
        self.assertEqual(json_bytes(actual["tables"]), json_bytes(report(reversed_fixture)["tables"]))

    def test_declared_contacts_require_eligible_evidence_and_preserve_conflicts(self):
        fixture = golden("A")
        fixture["classifications"][0]["declared_contact"] = {"name": "Synthetic Buyer", "email": "buyer@example.test", "company": "SYNTHETIC BUYER CO"}
        actual = report(fixture)
        self.assertEqual(len(actual["declared_contacts"]), 1)
        contact = actual["declared_contacts"][0]
        self.assertEqual(contact["status"], "declared")
        self.assertEqual(contact["identity_category"], "declared_contact_and_company")
        self.assertIsNotNone(contact["derived_session_id"])
        self.assertTrue(contact["evidence"][0]["message_content_sha256"])
        fixture["classifications"][1]["declared_contact"] = {"company": "OTHER SYNTHETIC COMPANY"}
        actual = report(fixture)
        self.assertEqual({x["status"] for x in actual["declared_contacts"]}, {"conflicting_declarations"})
        self.assertEqual(actual["mail_counts"]["received_inquiries"], 4)
        fixture["classifications"][0]["kind"] = "noise"
        self.assertEqual(len(report(fixture)["declared_contacts"]), 1)
        fixture["classifications"][1]["declared_contact"] = {"company": ["bad type"]}
        actual = report(fixture)
        self.assertEqual(actual["status"], "incomplete")
        self.assertEqual(len(actual["invalid_declared_contacts"]), 1)
        self.assertEqual(actual["declared_contacts"], [])

    def test_network_lookup_requires_matching_receipt_provenance_not_just_boolean(self):
        fixture = golden("A")
        o = observation(fixture)
        actual = report(fixture, [o])
        self.assertEqual(actual["company_context"]["coverage"]["with_network_context"], 0)
        self.assertEqual(actual["company_context"]["coverage"]["without_possible_company"], 8)
        self.assertEqual(actual["company_context"]["observations"][0]["reason"], "unverified_original_ip")
        fixture = verified_fixture()
        o = observation(fixture)
        before = json_bytes([fixture, o])
        actual = report(fixture, [o])
        self.assertEqual(actual["company_context"]["coverage"]["with_network_context"], 1)
        self.assertEqual(actual["company_context"]["coverage"]["with_possible_company"], 0)
        self.assertEqual(actual["company_context"]["coverage"]["verified_employers"], 0)
        self.assertEqual(json_bytes([fixture, o]), before)
        for change in ({"input_ip": "192.0.2.2"}, {"ip_provenance_verified": "yes"}, {"retention_approved": False}):
            self.assertEqual(report(fixture, [{**o, **change}])["company_context"]["coverage"]["with_network_context"], 0)

    def test_company_corrections_append_and_latest_unsafe_observation_suppresses_match(self):
        fixture = verified_fixture()
        o = observation(fixture, provider="synthetic-approved-provider", kind="company", network_category="corporate", company="SYNTHETIC COMPANY")
        first = report(fixture, [o])
        self.assertEqual(first["company_context"]["coverage"]["with_possible_company"], 1)
        correction = {**o, "observation_id": "synthetic-correction", "observed_at": "2026-10-19T14:21:00Z", "network_category": "vpn"}
        later = report(fixture, [o, correction])
        self.assertEqual(len(later["company_context"]["observations"]), 2)
        self.assertEqual(later["company_context"]["coverage"]["with_possible_company"], 0)
        self.assertEqual(first["company_context"]["coverage"]["with_possible_company"], 1)
        foreign = {**o, "observation_id": "synthetic-other-provider", "provider": "synthetic-other", "company": "OTHER COMPANY"}
        self.assertEqual(report(fixture, [o, foreign])["company_context"]["coverage"]["with_possible_company"], 0)
        future = {**correction, "observed_at": "2026-10-21T00:00:00Z"}
        self.assertEqual(report(fixture, [o, future])["company_context"]["coverage"]["with_possible_company"], 1)
        # Even a future duplicate identifier must not change an earlier cutoff.
        future["observation_id"] = o["observation_id"]
        self.assertEqual(report(fixture, [o, future])["company_context"]["coverage"]["with_possible_company"], 1)

    def test_invalid_company_links_or_duplicate_observation_ids_block_complete_status(self):
        fixture = verified_fixture()
        o = observation(fixture)
        for observations in ([{**o, "event_ids": ["unknown"]}], [{**o, "receipt_ids": ["unknown"]}], [o, o]):
            actual = report(fixture, observations)
            self.assertEqual(actual["status"], "incomplete")
            self.assertEqual(actual["company_context"]["coverage"]["with_network_context"], 0)
            self.assertTrue(actual["company_context"]["invalid"])


if __name__ == "__main__":
    unittest.main()
