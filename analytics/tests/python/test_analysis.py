from __future__ import annotations

import copy
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import json
from pathlib import Path
import unittest

from farpoint_analytics.analysis import analyze, capture_content_hash, derive_events, derive_sessions, json_bytes, reconcile_mail
from farpoint_analytics.canonical import InvalidData, canonical_bytes, logical_hash, sha256, strict_loads
from farpoint_analytics.enrichment import IPToASN, classify_company_observation
from farpoint_analytics.schema import validate_event
from fixtures.golden import event, golden, mail, receipt


def config_for(events):
    return {"mode": "isolated_fixture", "fixture_eligible_event_ids": [e["event_id"] for e in events],
            "window_start": "2026-10-19T00:00:00Z", "window_end": "2026-10-20T00:00:00Z",
            "observation_cutoff": "2026-10-20T01:00:00Z", "source_completeness": {"collector": True, "mail": True, "classifications": True}}


def report(fixture):
    return analyze(fixture["receipts"], fixture["messages"], fixture["classifications"], fixture["config"])


class CanonicalTests(unittest.TestCase):
    def test_HASH_01_shared_cross_language_fixture(self):
        vectors = json.loads((Path(__file__).parent / "fixtures/canonical-vectors-v1.json").read_text())
        for vector in vectors["valid"]:
            actual = canonical_bytes(strict_loads(vector["input_json"]))
            self.assertEqual(actual, vector["expected_canonical_utf8"].encode())
            self.assertEqual(sha256(actual), vector["expected_sha256"])
        for raw in vectors["invalid_json"]:
            with self.assertRaises(InvalidData):
                strict_loads(raw)
        for raw in vectors["invalid_canonical_json"]:
            with self.assertRaises(InvalidData):
                canonical_bytes(strict_loads(raw))

    def test_HASH_01_independent_canonical_bytes(self):
        vectors = [
            (b'{"z":2,"a":1}', b'{"a":1,"z":2}'),
            (b'{"a":[3,1,2]}', b'{"a":[3,1,2]}'),
            (b'{"a":true,"b":null}', b'{"a":true,"b":null}'),
            (b'{"a":1.0,"b":-0,"c":1e2}', b'{"a":1,"b":0,"c":100}'),
            (b'{"s":"quote\\\" slash\\\\ newline\\n control\\u0001"}', b'{"s":"quote\\\" slash\\\\ newline\\n control\\u0001"}'),
            ('{"s":"é"}'.encode(), '{"s":"é"}'.encode()),
            ('{"s":"é"}'.encode(), '{"s":"é"}'.encode())]
        for raw, expected in vectors:
            with self.subTest(raw=raw):
                self.assertEqual(canonical_bytes(strict_loads(raw)), expected)
                self.assertEqual(logical_hash(strict_loads(raw)), sha256(expected))
        self.assertNotEqual(logical_hash({}), logical_hash({"a": None}))
        self.assertNotEqual(logical_hash({"s": "é"}), logical_hash({"s": "é"}))

    def test_HASH_02_invalid_values_and_hostile_exponents(self):
        for raw in [b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}', b'\xff', b'[] garbage']:
            with self.subTest(raw=raw), self.assertRaises(InvalidData):
                strict_loads(raw)
        for value in [{"x": "\ud800"}, {"x": 9007199254740992}, {"x": Decimal("1e999999999")},
                      {"x": Decimal("0.1")}, {"x": float("nan")}, {"é": 1}]:
            with self.subTest(kind=type(value["x"]).__name__ if "x" in value else "key"), self.assertRaises(InvalidData):
                canonical_bytes(value)
        with self.assertRaises(InvalidData):
            validate_event({**event(), "unregistered_private_value": "SYNTHETIC_SENTINEL"})


class ReceiptTests(unittest.TestCase):
    def test_RAW_04_conflicts_and_preservation(self):
        a, b, c = [event("syn_" + x) for x in "ABC"]
        conflict = {**b, "page_id": "about"}
        inputs = [receipt("R1", [a, b]), receipt("R2", [a, b]), receipt("R3", [a, c]),
                  receipt("R4", raw=b"{malformed"), receipt("R5", [conflict]), receipt("R6", [], schema=2)]
        before = json_bytes(inputs)
        result = derive_events(inputs, config_for([a, b, c]))
        self.assertEqual(result["counts"], {"raw_receipts": 6, "valid_event_occurrences": 7,
                         "unique_valid_event_ids": 3, "duplicate_occurrences": 3,
                         "conflicted_event_ids": 1, "trusted_events": 2, "quarantined_events": 0,
                         "quarantined_receipts": 2})
        self.assertEqual({x["event"]["event_id"] for x in result["events"]}, {"syn_A", "syn_C"})
        self.assertEqual(before, json_bytes(inputs))
        resolved = derive_events(inputs, config_for([a, b, c]), [{"resolution_id": "syn_resolution",
                    "event_id": "syn_B", "selected_payload_sha256": logical_hash(b),
                    "observed_at": "2026-10-19T14:30:00Z", "evidence_refs": ["synthetic-review"]}])
        self.assertEqual(resolved["counts"]["trusted_events"], 3)
        self.assertEqual(result["counts"]["trusted_events"], 2)

    def test_RAW_06_supported_mixed_batch_vs_invalid_envelope(self):
        a, b, c = [event("syn_" + x) for x in "ABC"]
        bad_b = {**b, "private": "SYNTHETIC_SENTINEL"}
        raw = receipt("mixed", [a, bad_b, c])
        result = derive_events([raw], config_for([a, b, c]))
        self.assertEqual(result["counts"]["trusted_events"], 2)
        self.assertEqual(result["counts"]["quarantined_events"], 1)
        self.assertEqual(result["receipt_results"][0]["status"], "mixed")
        for invalid in [receipt("unsupported", [a, bad_b, c], schema=2),
                        receipt("duplicate-key", raw=b'{"schema_version":1,"tracker_version":"1","events":[],"events":[]}')]:
            outcome = derive_events([invalid], config_for([a, b, c]))
            self.assertEqual(outcome["counts"]["trusted_events"], 0)
            self.assertEqual(outcome["counts"]["quarantined_receipts"], 1)

    def test_RAW_02_03_bad_bodies_and_event_count(self):
        e = event()
        for index, raw in enumerate([b"", b"{", b'\xff', b'{"a":1,"a":2}', b'{"schema_version":99}', b'SYNTHETIC_PRIVATE_SENTINEL']):
            result = derive_events([receipt("bad" + str(index), raw=raw)], config_for([e]))
            self.assertEqual(result["counts"]["raw_receipts"], 1)
            self.assertEqual(result["counts"]["quarantined_receipts"], 1)
            self.assertNotIn("SYNTHETIC_PRIVATE_SENTINEL", json_bytes(result).decode())
        for count in [49, 50, 51]:
            events = [event("syn_E" + str(i)) for i in range(count)]
            result = derive_events([receipt("count" + str(count), events)], config_for(events))
            self.assertEqual(result["counts"]["trusted_events"], count if count <= 50 else 0)
            self.assertEqual(result["counts"]["raw_receipts"], 1)

    def test_HASH_03_rebatch_and_integrity_failure(self):
        a, b = event("syn_A"), event("syn_B")
        inputs = [receipt("one", [a]), receipt("two", [b, a])]
        result = derive_events(inputs, config_for([a, b]))
        self.assertEqual(result["counts"]["duplicate_occurrences"], 1)
        self.assertNotEqual(inputs[0]["receipt_body_sha256"], inputs[1]["receipt_body_sha256"])
        wrong = {**inputs[0], "receipt_body_sha256": "0" * 64}
        bad = analyze([wrong], [], [], config_for([a]))
        self.assertEqual(bad["status"], "incomplete")
        self.assertEqual(bad["integrity_errors"][0]["reason"], "receipt_hash_mismatch")


class FunnelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.expected = json.loads((Path(__file__).parent / "fixtures/golden-expected.json").read_text())

    def test_GOLD_01_exact_cutoffs_A_B(self):
        for cutoff in ("A", "B"):
            with self.subTest(cutoff=cutoff):
                fixture = golden(cutoff)
                before = json_bytes(fixture)
                actual = report(fixture)
                self.assertEqual(actual["status"], "complete")
                for key in ("receipt_counts", "traffic", "stage_reach"):
                    self.assertEqual(actual[key], self.expected[key])
                for key, expected in self.expected[cutoff].items():
                    self.assertEqual(actual["mail_counts"][key] if key in actual["mail_counts"] else actual[key], expected)
                self.assertEqual(before, json_bytes(fixture))
        actual = report(golden("A"))
        outcomes = {client: row["outcome"] for row in actual["session_outcomes"] for client in row["client_session_ids"]}
        self.assertEqual(outcomes, self.expected["outcomes_A"])
        q1 = next(x for x in actual["matched_inquiries"] if x["inquiry_id"] == "syn_Q1")
        self.assertEqual(q1["first_observed_browser_touch"]["campaign"]["campaign"], "A")
        self.assertEqual(q1["inquiry_session_touch"]["campaign"], {})

    def test_GOLD_02_late_evidence_and_immutable_prior_result(self):
        original = report(golden("A"))
        before = json_bytes(original)
        future = golden("B")
        message, classified = mail("G7", "syn_Q5", "syn_B7", "syn_S8",
                                   captured="2026-10-21T12:01:00Z", received="2026-10-21T12:00:00Z")
        future["messages"].append(message)
        future["classifications"].append(classified)
        future["config"]["observation_cutoff"] = "2026-10-21T13:00:00Z"
        actual = report(future)
        self.assertEqual(actual["mail_counts"]["received_in_window"], 5)
        self.assertEqual(actual["mail_counts"]["cohort_received_inquiries"], 4)
        self.assertEqual(actual["session_conversion"]["numerator"], 4)
        self.assertEqual(json_bytes(original), before)
        self.assertEqual(json_bytes(report(golden("A"))), before)

    def test_GOLD_03_two_inquiries_one_session_and_no_mailto_join(self):
        fixture = golden("A")
        new = event("syn_second_intent", "quotation_attempt", "syn_B1", "syn_S2", "2026-10-19T13:01:00Z", 6, inquiry_id="syn_Q6")
        fixture["receipts"].append(receipt("syn_extra", [new]))
        fixture["config"]["fixture_eligible_event_ids"].append(new["event_id"])
        message, classified = mail("G7", "syn_Q6", "syn_B1", "syn_S2")
        fixture["messages"].append(message)
        fixture["classifications"].append(classified)
        result = report(fixture)
        self.assertEqual(result["mail_counts"]["matched_website_inquiries"], 3)
        self.assertEqual(result["session_conversion"]["numerator"], 2)
        self.assertEqual(result["mail_counts"]["unattributed_inquiries"], 2)

    def test_GOLD_03_conflicting_mail_payload_or_session(self):
        for change in [{"business_payload_sha256": "a" * 64}, {"session_id": "syn_other_session"}]:
            fixture = golden("A")
            fixture["classifications"][1].update(change)
            result = report(fixture)
            self.assertEqual(result["mail_counts"]["conflicted_inquiry_ids"], 1)
            self.assertEqual(result["mail_counts"]["received_inquiries"], 3)
            self.assertEqual(result["session_conversion"]["numerator"], 1)

    def test_unchanged_retry_later_session_uses_frozen_original_context(self):
        fixture = golden("A")
        retry = event("syn_later_retry", "quotation_attempt", "syn_B1", "syn_S9", "2026-10-19T14:00:00Z", 0, inquiry_id="syn_Q1")
        fixture["receipts"].append(receipt("syn_later_receipt", [retry], received_at="2026-10-19T14:00:01Z"))
        fixture["config"]["fixture_eligible_event_ids"].append(retry["event_id"])
        result = report(fixture)
        self.assertEqual(result["traffic"]["sessions"], 9)
        self.assertEqual(result["session_conversion"]["numerator"], 2)
        q1 = next(x for x in result["matched_inquiries"] if x["inquiry_id"] == "syn_Q1")
        original = next(x for x in result["session_outcomes"] if "syn_S2" in x["client_session_ids"])
        self.assertEqual(q1["derived_session_id"], original["session_id"])

    def test_received_retry_is_not_pending_or_lost_again(self):
        for final_event in ("quotation_provider_accepted", "quotation_transport_error"):
            fixture = golden("A")
            retry = event("syn_later_retry", "quotation_attempt", "syn_B1", "syn_S9", "2026-10-19T14:00:00Z", 0, inquiry_id="syn_Q1")
            response = {**retry, "event_id": "syn_retry_response", "event_name": final_event, "sequence": 1,
                        "client_timestamp": "2026-10-19T14:00:01Z"}
            fixture["receipts"].append(receipt("syn_retry", [retry, response], received_at="2026-10-19T14:00:02Z"))
            fixture["config"]["fixture_eligible_event_ids"].extend([retry["event_id"], response["event_id"]])
            result = report(fixture)
            outcome = next(x for x in result["session_outcomes"] if "syn_S9" in x["client_session_ids"])
            self.assertEqual(outcome["outcome"], "retry_of_received_inquiry")
            self.assertEqual(outcome["received_inquiry_retries"], ["syn_Q1"])
            self.assertEqual(result["session_conversion"]["numerator"], 2)
            # A different accepted inquiry in the retry session remains pending.
            pending = {**response, "event_id": "syn_pending", "event_name": "quotation_provider_accepted", "inquiry_id": "syn_Q_new", "sequence": 2}
            fixture["receipts"].append(receipt("syn_pending", [pending], received_at="2026-10-19T14:00:03Z"))
            fixture["config"]["fixture_eligible_event_ids"].append(pending["event_id"])
            outcome = next(x for x in report(fixture)["session_outcomes"] if "syn_S9" in x["client_session_ids"])
            self.assertEqual(outcome["outcome"], "delivery_unverified")
            self.assertEqual(outcome["pending_accepted_inquiry_ids"], ["syn_Q_new"])

    def test_MAIL_05_followup_automated_noise_forged_and_unresolved(self):
        fixture = golden("A")
        kinds = ["follow_up", "automated", "automated", "noise", "new_inquiry", "unresolved"]
        for i, kind in enumerate(kinds):
            message, classified = mail("extra" + str(i), "syn_Q1", kind=kind)
            if i == 4:
                classified["route_evidence"]["status"] = "unverified"
            fixture["messages"].append(message)
            fixture["classifications"].append(classified)
        actual = report(fixture)
        self.assertEqual(actual["mail_counts"]["raw_observations"], 12)
        self.assertEqual(actual["mail_counts"]["received_inquiries"], 4)
        self.assertEqual(actual["mail_counts"]["matched_website_inquiries"], 2)
        self.assertEqual(actual["mail_counts"]["unresolved_candidates"], 2)
        # Thread reuse alone does not suppress a separately evidenced new project.
        message, classified = mail("new_project", route="direct_email")
        message["thread_id"] = "same-thread-as-Q1"
        fixture["messages"].append(message)
        fixture["classifications"].append(classified)
        self.assertEqual(report(fixture)["mail_counts"]["received_inquiries"], 5)

    def test_message_revisions_labels_and_stale_classifications(self):
        fixture = golden("A")
        message = copy.deepcopy(fixture["messages"][0])
        message.update(observation_id="syn_labels", captured_at="2026-10-19T14:20:00Z", labels=["SPAM"])
        fixture["messages"].append(message)
        self.assertEqual(report(fixture)["mail_counts"]["received_inquiries"], 4)
        changed = {**message, "observation_id": "syn_changed", "captured_at": "2026-10-19T14:21:00Z", "body": "SYNTHETIC CHANGED CONTENT"}
        fixture["messages"].append(changed)
        result = report(fixture)
        self.assertEqual(result["mail_counts"]["unresolved_candidates"], 1)
        self.assertEqual(result["mail_counts"]["received_inquiries"], 4)  # G2 still supports unchanged Q1.

    def test_completeness_truthy_values_and_classification_counter(self):
        for source in [{"collector": "failed", "mail": True, "classifications": True}, {"collector": True}, {}]:
            fixture = golden("A")
            fixture["config"]["source_completeness"] = source
            self.assertEqual(report(fixture)["status"], "incomplete")
        fixture = golden("A")
        fixture["classifications"].append({"classification_id": "bad", "classified_at": "bad"})
        result = report(fixture)
        self.assertEqual(result["mail_counts"]["raw_observations"], 6)
        self.assertEqual(result["status"], "incomplete")

    def test_malformed_processing_observations_are_not_lost_or_fatal(self):
        for mutation in [{"route_evidence": "bad"}, {"classification_id": None}, {"evidence_refs": "bad"},
                         {"kind": []}, {"status": {}}, {"inquiry_id": {}}, {"browser_id": []},
                         {"session_id": []}, {"business_payload_sha256": "bad"},
                         {"route_evidence": {"kind": [], "status": "verified", "destination": "quotes@farpointenergy.com", "evidence_refs": ["test"]}}]:
            fixture = golden("A")
            fixture["classifications"][0].update(mutation)
            actual = report(fixture)
            self.assertEqual(actual["status"], "incomplete")
            self.assertEqual(actual["mail_counts"]["raw_observations"], 6)
            self.assertEqual(len(actual["invalid_mail_classifications"]), 1)
        fixture = golden("A")
        actual = analyze(fixture["receipts"], fixture["messages"], fixture["classifications"], fixture["config"],
                         [{"event_id": {}}])
        self.assertEqual(actual["status"], "incomplete")
        self.assertEqual(actual["invalid_event_resolutions"], [{"reason": "invalid_resolution"}])


class TimeAndExclusionTests(unittest.TestCase):
    def test_GOLD_04_gap_boundaries_and_order_ties(self):
        for seconds, expected in [(1799, 1), (1800, 2), (1801, 2)]:
            later = (datetime(2026, 10, 19, 12, tzinfo=timezone.utc) + timedelta(seconds=seconds)).isoformat()
            events = [event("syn_A"), event("syn_B", at=later)]
            result = analyze([receipt("R", events)], [], [], config_for(events))
            self.assertEqual(result["traffic"]["sessions"], expected)
        events = [event("syn_Z", sequence=2), event("syn_A", sequence=1), event("syn_B", sequence=1)]
        derived = derive_events([receipt("R", events)], config_for(events))
        sessions, _, _ = derive_sessions(derived["events"])
        self.assertEqual([x["event"]["event_id"] for x in sessions[0]["events"]], ["syn_A", "syn_B", "syn_Z"])

    def test_GOLD_04_time_anomalies_and_late_time(self):
        events = [event("syn_missing", at=None), event("syn_bad", at="bad"),
                  event("syn_future", at="2026-10-19T14:05:00.001Z"),
                  event("syn_at_limit", at="2026-10-19T14:05:00Z"),
                  event("syn_late", at="2026-10-01T12:00:00Z")]
        result = derive_events([receipt("R", events)], config_for(events))
        times = {x["event"]["event_id"]: x for x in result["events"]}
        self.assertEqual(times["syn_future"]["effective_at"], "2026-10-19T14:00:00.000Z")
        self.assertIsNone(times["syn_at_limit"]["time_anomaly"])
        self.assertIsNone(times["syn_late"]["time_anomaly"])
        self.assertEqual(sum(x["time_anomaly"] is not None for x in result["events"]), 3)

    def test_GOLD_04_missing_identity_bot_and_synthetic(self):
        events = [event("syn_eligible"), event("syn_no_browser", browser=None),
                  event("syn_bot", bot=True), event("syn_canary")]
        config = config_for(events[:3])
        result = analyze([receipt("R", events)], [], [], config)
        self.assertEqual(result["traffic"], {"sessions": 1, "browser_identifiers": 1, "unidentified_events": 1})
        self.assertEqual({x["reason"] for x in result["event_exclusions"]}, {"bot", "synthetic"})
        config["mode"] = "production"
        with self.assertRaises(InvalidData):
            analyze([receipt("R", events)], [], [], config)


class EnrichmentTests(unittest.TestCase):
    def test_ENRICH_01_02_fail_closed_provider_labels(self):
        base = {"observation_id": "syn", "status": "ok", "ip_provenance_verified": True,
                "retention_approved": True, "network_category": "corporate", "company": "Synthetic Company"}
        self.assertEqual(classify_company_observation(base)["identity_category"], "possible_corporate_match")
        self.assertIsNone(classify_company_observation(base)["employer"])
        cases = [{"network_category": x} for x in ["isp", "hosting", "mobile", "vpn", "proxy", "relay", "shared", "unknown", "future_enum"]]
        cases += [{"status": "429"}, {"status": "timeout"}, {"company": {"bad": 1}}, {"company": ""},
                  {"retention_approved": "yes"}, {"ip_provenance_verified": "yes"}, {"contradictory_evidence": True}]
        for case in cases:
            self.assertEqual(classify_company_observation({**base, **case})["identity_category"], "unknown")

    def test_offline_network_context_requires_provenance_and_never_employer(self):
        data = b"192.0.2.0\t192.0.2.255\t64500\tZZ\tSYNTHETIC NETWORK\n2001:db8::\t2001:db8::ffff\t64501\tZZ\tSYNTHETIC V6\n"
        db = IPToASN(data, sha256(data))
        self.assertEqual(db.lookup("192.0.2.1")["reason"], "unverified_original_ip")
        self.assertEqual(db.lookup("192.0.2.1", True)["asn"], 64500)
        self.assertEqual(db.lookup("2001:db8::1", True)["asn"], 64501)
        self.assertIsNone(db.lookup("192.0.2.1", True)["employer"])
        self.assertEqual(db.lookup("192.0.2.1", "yes")["identity_category"], "unknown")
        with self.assertRaises(InvalidData):
            IPToASN(data, "0" * 64)


if __name__ == "__main__":
    unittest.main()
