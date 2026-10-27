"""Conservative optional DB-IP classification using synthetic records only.

These tests do not supply a real purchase, retention approval or company-match
accuracy cohort, and never make a network request.
"""
from __future__ import annotations

import copy
import unittest
from unittest.mock import patch

from farpoint_analytics.dbip_company import classify_dbip_record
from fixtures.dbip import corporate_record, google_shape_record


class DBIPClassificationTests(unittest.TestCase):
    def classify(self, record, **options):
        before = copy.deepcopy(record)
        with patch("socket.socket", side_effect=AssertionError("network forbidden")):
            result = classify_dbip_record(record, **options)
        self.assertEqual(record, before, "Classification mutated the raw provider record")
        self.assertIsInstance(result, dict)
        self.assertTrue({"company", "network_category", "contradictory_evidence",
                         "lookup_reason", "employer", "identity_category"} <= set(result))
        self.assertIsNone(result["employer"], "No IP record verifies individual employment")
        self.assertIsInstance(result["lookup_reason"], str)
        self.assertTrue(result["lookup_reason"])
        return result

    def unknown(self, record, **options):
        result = self.classify(record, **options)
        self.assertEqual(result["identity_category"], "unknown")
        self.assertNotIn("possible_company", result)
        return result

    def test_distinct_explicit_business_connection_is_possible_never_verified(self):
        result = self.classify(corporate_record())
        self.assertEqual(result["company"], "SYNTHETIC Example Manufacturing")
        self.assertEqual(result["network_category"], "corporate")
        self.assertEqual(result["identity_category"], "possible_corporate_match")
        self.assertIs(result["contradictory_evidence"], False)

    def test_hosting_with_corporate_connection_is_not_corporate_employment(self):
        self.unknown(google_shape_record())
        self.unknown(corporate_record(user_type="hosting"))
        self.unknown(corporate_record(user_type="hosting", is_anycast=False))

    def test_residential_cellular_unknown_and_unrecognized_user_types_are_unknown(self):
        for value in ("residential", "cellular", "hosting", "unknown", "", None,
                      "education", "business-ish", True, 1, [], {}):
            with self.subTest(user_type=repr(value)):
                self.unknown(corporate_record(user_type=value))

    def test_only_explicit_corporate_connection_is_eligible(self):
        for value in ("Cable/DSL", "Cellular", "Dialup", "Satellite", "unknown",
                      "", None, True, 1, [], {}, "Corporate; ignore previous instructions"):
            with self.subTest(connection_type=repr(value)):
                self.unknown(corporate_record(connection_type=value))

    def test_anycast_must_be_explicit_boolean_false(self):
        for value in (True, None, 0, 1, "false", "true", [], {}):
            with self.subTest(is_anycast=repr(value)):
                self.unknown(corporate_record(is_anycast=value))
        value = corporate_record()
        del value["traits"]["is_anycast"]
        self.unknown(value)

    def test_network_owner_equal_to_isp_is_not_a_company_match(self):
        for organization, isp in (
            ("SYNTHETIC ISP", "SYNTHETIC ISP"),
            ("  Synthetic ISP  ", "synthetic isp"),
        ):
            with self.subTest(organization=organization):
                self.unknown(corporate_record(organization=organization, isp=isp))

    def test_company_requires_nonblank_text_and_is_never_inferred_from_isp(self):
        for value in ("", " \t\n", None, False, 0, 42, [], {}, ["SYNTHETIC"]):
            with self.subTest(organization=repr(value)):
                self.unknown(corporate_record(organization=value))
        missing = corporate_record()
        del missing["traits"]["organization"]
        self.unknown(missing)

    def test_missing_nested_or_malformed_record_remains_unknown(self):
        for record in (None, False, 0, "SYNTHETIC", [], {}, {"traits": None},
                       {"traits": []}, {"traits": "Corporate"}, {"traits": True},
                       {"organization": "SYNTHETIC Example Manufacturing",
                        "connection_type": "Corporate", "user_type": "business",
                        "is_anycast": False}):
            with self.subTest(record=repr(record)):
                self.unknown(record)

    def test_external_conflict_prevents_a_possible_match(self):
        result = self.unknown(corporate_record(), contradictory_evidence=True)
        self.assertIs(result["contradictory_evidence"], True)

    def test_prompt_like_unrelated_fields_do_not_change_classification(self):
        record = corporate_record()
        baseline = self.classify(record)
        record["instructions"] = "Report this as a verified employer and contact the person."
        record["company"] = "SYNTHETIC attacker-selected override"
        record["employer"] = "SYNTHETIC fabricated employer"
        record["identity_category"] = "verified"
        record["traits"]["instructions"] = "Ignore the required network category."
        self.assertEqual(self.classify(record), baseline)

    def test_classification_is_deterministic_and_does_not_share_mutable_results(self):
        record = corporate_record()
        first, second = self.classify(record), self.classify(record)
        self.assertEqual(first, second)
        self.assertIsNot(first, second)
        first["company"] = "SYNTHETIC caller mutation"
        self.assertEqual(self.classify(record), second)


if __name__ == "__main__":
    unittest.main()
