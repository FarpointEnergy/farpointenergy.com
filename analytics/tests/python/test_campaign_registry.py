"""Issued campaign tokens must validate without promoting synthetic traffic."""
from pathlib import Path
import copy
import json
import unittest

from farpoint_analytics.analysis import analyze, json_bytes
from fixtures.golden import event, receipt


class CampaignRegistryTests(unittest.TestCase):
    def setUp(self):
        self.registry = json.loads((Path(__file__).parents[2] / "work/campaign-registry.json").read_bytes())
        self.config = {
            "mode": "production",
            "window_start": "2026-10-19T00:00:00Z",
            "window_end": "2026-10-20T00:00:00Z",
            "observation_cutoff": "2026-10-20T01:00:00Z",
            "source_completeness": {"collector": True, "mail": True, "classifications": True},
            "campaign_registry": self.registry,
        }

    def test_registered_preview_events_are_valid_but_still_excluded(self):
        campaign = {"source": "website", "medium": "referral", "campaign": "power"}
        rows = [receipt("synthetic-registry", [event("syn_registry_" + str(i), campaign=campaign, sequence=i)
                                              for i in range(4)])]
        original = json_bytes(rows)
        prior = copy.deepcopy(self.config)
        prior.pop("campaign_registry")
        self.assertEqual(analyze(rows, [], [], prior)["receipt_counts"]["quarantined_events"], 4)
        result = analyze(rows, [], [], self.config)
        self.assertEqual(result["receipt_counts"]["valid_event_occurrences"], 4)
        self.assertEqual(result["receipt_counts"]["quarantined_events"], 0)
        self.assertEqual(result["receipt_counts"]["trusted_events"], 0)
        self.assertEqual(result["traffic"]["sessions"], 0)
        self.assertEqual(result["mail_counts"]["received_inquiries"], 0)
        self.assertEqual(len(result["event_exclusions"]), 4)
        self.assertEqual({x["reason"] for x in result["event_exclusions"]}, {"synthetic"})
        self.assertEqual(json_bytes(rows), original)

    def test_free_text_never_expands_the_issued_allowlist(self):
        before = json_bytes(self.registry)
        for key in ("source", "medium", "campaign"):
            with self.subTest(key=key):
                campaign = {"source": "website", "medium": "referral", "campaign": "power"}
                campaign[key] = "SYNTHETIC_UNREGISTERED_PRIVATE_TEXT"
                rows = [receipt("synthetic-unregistered", [event(campaign=campaign)])]
                result = analyze(rows, [], [], self.config)
                self.assertEqual(result["receipt_counts"]["valid_event_occurrences"], 0)
                self.assertEqual(result["quarantined_events"][0]["reason"], "unregistered_campaign_value")
                self.assertNotIn("SYNTHETIC_UNREGISTERED_PRIVATE_TEXT", json_bytes(result).decode())
        self.assertEqual(json_bytes(self.registry), before)

    def test_tracker_unknown_sentinel_remains_valid_and_excluded(self):
        campaign = {key: "unknown_campaign" for key in ("source", "medium", "campaign")}
        result = analyze([receipt("synthetic-unknown", [event(campaign=campaign)])], [], [], self.config)
        self.assertEqual(result["receipt_counts"]["valid_event_occurrences"], 1)
        self.assertEqual(result["receipt_counts"]["trusted_events"], 0)
        self.assertEqual(result["event_exclusions"][0]["reason"], "synthetic")


if __name__ == "__main__":
    unittest.main()
