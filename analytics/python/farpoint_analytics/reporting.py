"""Deterministic attribution and evidence views. No network or identity stitching."""
from __future__ import annotations

from collections import Counter, defaultdict
import ipaddress
import re

from .analysis import iso, json_bytes, ratio, timestamp, touch, valid_refs
from .canonical import InvalidData
from .enrichment import classify_company_observation
from .schema import SCHEMA


def build_reporting_tables(derived, sessions, event_session, cohort, matched, start, end):
    cohort_ids = {s["session_id"] for s in cohort}
    received = defaultdict(list)
    for inquiry in matched:
        received[inquiry["derived_session_id"]].append(inquiry["inquiry_key"])
    converted = set(received) & cohort_ids
    in_window = {s["session_id"]: [r for r in s["events"] if start <= timestamp(r["effective_at"]) < end]
                 for s in cohort}
    stages = {sid: {r["event"]["event_name"] for r in rows} for sid, rows in in_window.items()}

    def summarize(groups):
        result = []
        for key in sorted(groups):
            dimensions, members = groups[key]
            member_ids = sorted(members)
            inquiry_keys = sorted({qid for sid in members for qid in received[sid]})
            result.append({**dimensions, "sessions": len(members), "session_ids": member_ids,
                           "received_inquiries": len(inquiry_keys), "inquiry_keys": inquiry_keys,
                           "session_conversion": ratio(len(members & converted), len(members)),
                           "stage_reach": {name: sum(name in stages[sid] for sid in members)
                                           for name in SCHEMA["event_name"]}})
        return result

    def grouped(dimensions_for_session):
        groups = {}
        for session in cohort:
            for dimensions in dimensions_for_session(session):
                key = json_bytes(dimensions)
                groups.setdefault(key, (dimensions, set()))[1].add(session["session_id"])
        return summarize(groups)

    def acquisition(t):
        campaign = t["campaign"]
        return {"referrer_category": t["referrer_category"], "source": campaign.get("source"),
                "medium": campaign.get("medium"), "campaign": campaign.get("campaign")}

    def engagement(session, field):
        return [{field: value} for value in sorted({r["event"][field] for r in in_window[session["session_id"]]
                                                   if r["event"].get(field)})]

    session_rows, touches = [], []
    for session in sessions:
        sid = session["session_id"]
        rows = session["events"]
        session_rows.append({k: v for k, v in session.items() if k != "events"} | {
            "in_report_cohort": sid in cohort_ids, "event_ids": [r["event"]["event_id"] for r in rows],
            "observed_page_path": [r["event"]["page_id"] for r in rows if r["event"]["event_name"] == "page_view"],
            "received_inquiry_keys": sorted(received[sid])})
        for index, row in enumerate(rows):
            touches.append({"event_id": row["event"]["event_id"], "session_id": sid,
                            "sequence": row["event"]["sequence"],
                            "browser_id": session["browser_id"], "effective_at": row["effective_at"],
                            "receipt_ids": row["receipt_ids"], "touch": touch(row["event"]),
                            "is_session_entry": index == 0, "in_report_window": start <= timestamp(row["effective_at"]) < end})
    event_rows = [{**row, "derived_session_id": event_session.get(row["event"]["event_id"])}
                  for row in derived["events"]]
    event_rows.sort(key=lambda r: (timestamp(r["effective_at"]), r["event"]["sequence"], r["event"]["event_id"]))
    return {"tables": {"validated_event_occurrences": derived["validated_event_occurrences"],
                       "events": event_rows, "sessions": sorted(session_rows, key=lambda s: s["session_id"]),
                       "campaign_touches": sorted(touches, key=lambda t: (t["session_id"], t["effective_at"], t["sequence"], t["event_id"]))},
            "attribution": {
                "rule": "cohort sessions; observed engagement in window; received inquiries as of cutoff; association not causation",
                "nonexclusive_dimensions": ["product_engagement", "application_engagement", "reference_engagement"],
                "session_entry": grouped(lambda s: [acquisition(s["entry_touch"])]),
                "first_observed_browser_touch": grouped(lambda s: [acquisition(s["first_observed_browser_touch"])]),
                "landing_page": grouped(lambda s: [{"page_id": s["entry_touch"]["page_id"]}]),
                "product_engagement": grouped(lambda s: engagement(s, "product_id")),
                "application_engagement": grouped(lambda s: engagement(s, "application_id")),
                "reference_engagement": grouped(lambda s: engagement(s, "reference_id"))}}


def declared_contacts(matched, unmatched):
    """Only declarations from independently selected, verified new-inquiry evidence."""
    rows, invalid = [], []
    limits = {"name": 512, "email": 320, "company": 512, "phone": 128}
    for inquiry in sorted([*matched, *unmatched], key=lambda x: x["inquiry_key"]):
        variants = defaultdict(list)
        for observation in inquiry["contact_observations"]:
            contact = observation["declared_contact"]
            if contact is None or contact == {}:
                continue
            if (not isinstance(contact, dict) or set(contact) - set(limits)
                    or any(not isinstance(v, str) or not v.strip() or len(v) > limits[k]
                           for k, v in contact.items())):
                invalid.append({"inquiry_key": inquiry["inquiry_key"],
                                "classification_id": observation["classification_id"],
                                "reason": "invalid_declared_contact"})
                continue
            # Do not normalize or choose one of contradictory declarations.
            variants[json_bytes(contact)].append(observation)
        if not variants:
            continue
        for encoded, observations in sorted(variants.items()):
            rows.append({"inquiry_key": inquiry["inquiry_key"], "inquiry_id": inquiry["inquiry_id"],
                         "received_at": inquiry["received_at"], "route_kind": inquiry["route_kind"],
                         "derived_session_id": inquiry.get("derived_session_id"),
                         "identity_category": "declared_contact_and_company",
                         "status": "conflicting_declarations" if len(variants) > 1 else "declared",
                         "declared_contact": observations[0]["declared_contact"],
                         "evidence": [{k: v for k, v in o.items() if k != "declared_contact"} for o in observations]})
    return {"rows": rows, "invalid": invalid}


def company_context(observations, receipts, event_rows, event_session, cohort, config):
    """Link archived observations only to exact receipt/event evidence; never to people.

    Positive inference additionally requires receipt IP metadata with a provenance
    tag explicitly listed in verified_ip_provenances. An observation's own boolean
    is insufficient. No approved provenance is configured by default.
    """
    cutoff = timestamp(config["observation_cutoff"])
    def visible(record, field):
        try:
            return isinstance(record, dict) and timestamp(record.get(field)) <= cutoff
        except InvalidData:
            return False
    by_event = {r["event"]["event_id"]: r for r in event_rows}
    trusted_receipts = {rid for r in event_rows for rid in r["receipt_ids"]}
    receipt_counts = Counter(r.get("receipt_id") for r in receipts if visible(r, "received_at") and isinstance(r.get("receipt_id"), str))
    by_receipt = {r["receipt_id"]: r for r in receipts if visible(r, "received_at")
                  and r.get("receipt_id") in trusted_receipts and receipt_counts[r["receipt_id"]] == 1}
    allowed = config.get("verified_ip_provenances", {})
    if not isinstance(allowed, dict):
        raise InvalidData("invalid_verified_ip_provenances")
    allowed = {tag for tag, refs in allowed.items() if isinstance(tag, str) and tag != "unverified" and valid_refs(refs)}
    rows, invalid, by_session = [], [], defaultdict(list)
    observation_counts = Counter(o.get("observation_id") for o in observations if visible(o, "observed_at") and isinstance(o.get("observation_id"), str))
    for observation in observations:
        oid = observation.get("observation_id") if isinstance(observation, dict) else None
        try:
            if not isinstance(observation, dict):
                raise InvalidData("invalid_company_observation")
            observed_at = timestamp(observation.get("observed_at"))
            if observed_at > cutoff:
                continue
            if (not isinstance(oid, str) or not oid or observation_counts[oid] != 1
                    or any(not isinstance(observation.get(k), str) or not observation[k] for k in ("provider", "rule_version"))
                    or observation.get("kind") not in {"network", "company"}
                    or observation.get("status") not in {"ok", "error", "unavailable"}
                    or not valid_refs(observation.get("evidence_refs"))
                    or not valid_refs(observation.get("receipt_ids"))
                    or not valid_refs(observation.get("event_ids"))):
                raise InvalidData("invalid_company_observation")
            rids, eids = set(observation["receipt_ids"]), set(observation["event_ids"])
            if not rids <= by_receipt.keys() or not eids <= by_event.keys():
                raise InvalidData("unknown_company_evidence_reference")
            if any(not rids.intersection(by_event[e]["receipt_ids"]) for e in eids):
                raise InvalidData("company_event_receipt_mismatch")
            if not rids <= {rid for e in eids for rid in by_event[e]["receipt_ids"]}:
                raise InvalidData("company_receipt_event_mismatch")
            source_ips = [by_receipt[r].get("source_ip", {}) for r in rids]
            proven = bool(source_ips) and all(isinstance(ip, dict) and ip.get("status") == "verified"
                                               and ip.get("provenance") in allowed for ip in source_ips)
            try:
                if not isinstance(observation.get("input_ip"), str):
                    raise ValueError()
                address = ipaddress.ip_address(observation.get("input_ip"))
                proven = proven and all(isinstance(ip.get("address"), str) and ipaddress.ip_address(ip.get("address")) == address for ip in source_ips)
            except ValueError:
                proven = False
            proven = proven and observation.get("ip_provenance_verified") is True
            result = {"identity_category": "unknown", "employer": None,
                      "reason": "company_lookup_unavailable", "company_lookup_status": "unavailable"}
            if observation["status"] == "ok" and observation.get("retention_approved") is True and proven:
                if observation["kind"] == "company":
                    result = {**result, **classify_company_observation(observation)}
                    if result["identity_category"] == "possible_corporate_match":
                        result.update(reason="possible_company_not_verified_employer", company_lookup_status="possible_match")
                    elif observation.get("network_category") in {"isp", "hosting", "mobile", "vpn", "proxy", "relay", "shared"}:
                        result["reason"] = "noncorporate_or_shared_network"
                    elif observation.get("contradictory_evidence"):
                        result["reason"] = "contradictory_company_evidence"
                elif (observation["provider"] == "IPtoASN"
                      and isinstance(observation.get("network_organization"), str)
                      and observation["network_organization"].strip()
                      and re.fullmatch(r"[0-9a-f]{64}", observation.get("dataset_sha256", ""))):
                    result.update(identity_category="inferred_network_organization",
                                  network_organization=observation["network_organization"],
                                  dataset_sha256=observation["dataset_sha256"], reason="network_context_not_employer")
            elif not proven:
                result["reason"] = "unverified_original_ip"
            elif observation["status"] == "error":
                result["reason"] = "provider_error"
            elif observation.get("retention_approved") is not True:
                result["reason"] = "retention_not_approved"
            session_ids = sorted({event_session[e] for e in eids if event_session.get(e)})
            row = {"observation_id": oid, "provider": observation["provider"],
                   "kind": observation["kind"], "status": observation["status"],
                   "observed_at": observed_at.isoformat(timespec="microseconds").replace("+00:00", "Z"),
                   "rule_version": observation["rule_version"],
                   "receipt_ids": sorted(rids), "event_ids": sorted(eids), "session_ids": session_ids,
                   "evidence_refs": observation["evidence_refs"], **result}
            rows.append(row)
            for sid in session_ids:
                by_session[sid].append(row)
        except (InvalidData, ValueError, TypeError):
            invalid.append({"observation_id": oid if isinstance(oid, str) else None,
                            "reason": "invalid_company_observation_or_evidence"})
    session_rows = []
    for session in sorted(cohort, key=lambda s: s["session_id"]):
        linked = by_session[session["session_id"]]
        # Later observations restate a provider's view of the same event without
        # replacing history. Equal-time contradictions are kept for ambiguity.
        latest = {}
        for row in linked:
            for event_id in row["event_ids"]:
                if event_session.get(event_id) != session["session_id"]:
                    continue
                key = (row["provider"], row["kind"], event_id)
                observed_time = timestamp(row["observed_at"])
                latest[key] = max(latest.get(key, observed_time), observed_time)
        active = [r for r in linked if any(event_session.get(eid) == session["session_id"]
                  and timestamp(r["observed_at"]) == latest[(r["provider"], r["kind"], eid)] for eid in r["event_ids"])]
        possible = sorted({r["possible_company"] for r in active if r["identity_category"] == "possible_corporate_match"})
        suppressed = any(r["reason"] in {"noncorporate_or_shared_network", "contradictory_company_evidence"} for r in active)
        networks = sorted({r["network_organization"] for r in active if r["identity_category"] == "inferred_network_organization"})
        single_match = len(possible) == 1 and not suppressed
        session_rows.append({"session_id": session["session_id"], "employer": None,
                             "identity_category": "possible_corporate_match" if single_match else "unknown",
                             "possible_company": possible[0] if single_match else None,
                             "network_organizations": networks,
                             "reason": "noncorporate_or_conflicting_evidence" if suppressed else
                                       "ambiguous_company_observations" if len(possible) > 1 else
                                       "possible_company_not_verified_employer" if possible else "company_lookup_unavailable_or_unknown",
                             "observation_ids": sorted(r["observation_id"] for r in linked),
                             "active_observation_ids": sorted(r["observation_id"] for r in active)})
    matched_count = sum(r["identity_category"] == "possible_corporate_match" for r in session_rows)
    return {"observations": sorted(rows, key=lambda r: (r["observed_at"], r["observation_id"])),
            "session_categories": session_rows, "invalid": invalid,
            "coverage": {"sessions": len(cohort), "with_network_context": sum(bool(r["network_organizations"]) for r in session_rows),
                         "with_possible_company": matched_count, "without_possible_company": len(cohort) - matched_count,
                         "possible_company_share": ratio(matched_count, len(cohort)), "verified_employers": 0},
            "rule": "observations linked by archived receipt/event evidence; network context is not employer identity"}
