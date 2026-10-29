"""Pure deterministic transformations. Every output is new; inputs are untouched."""
from __future__ import annotations

import base64
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import json
import re

from .canonical import InvalidData, canonical_bytes, logical_hash, sha256, strict_loads
from .schema import SCHEMA, validate_envelope, validate_event

RULE_VERSION = "farpoint-analysis-1.1.1"
UTC = timezone.utc
MAIL_KINDS = {"new_inquiry", "follow_up", "automated", "noise", "unresolved"}


def valid_refs(value):
    return isinstance(value, list) and bool(value) and all(isinstance(ref, str) and bool(ref) for ref in value)


def timestamp(value):
    if not isinstance(value, str):
        raise InvalidData("missing_timestamp")
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if result.tzinfo is None:
            raise ValueError()
        return result.astimezone(UTC)
    except (ValueError, OverflowError):
        raise InvalidData("invalid_timestamp") from None


def iso(value):
    return value.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def json_bytes(value):
    """Stable raw-record JSON; unlike event encoding this permits ordinary JSON numbers."""
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                      allow_nan=False).encode("utf-8")


def capture_content_hash(message):
    # Labels/capture timestamps are observations, not message content revisions.
    fields = ("mailbox", "message_id", "received_at", "body", "headers", "attachments")
    return sha256(json_bytes({key: message.get(key) for key in fields}))


def validate_config(config):
    start, end, cutoff = (timestamp(config[key]) for key in ("window_start", "window_end", "observation_cutoff"))
    if not start < end or cutoff < start:
        raise InvalidData("invalid_report_window")
    mode = config.get("mode", "production")
    if mode not in {"production", "isolated_fixture"}:
        raise InvalidData("invalid_analysis_mode")
    eligible = config.get("fixture_eligible_event_ids", [])
    if eligible and mode != "isolated_fixture":
        raise InvalidData("fixture_eligibility_forbidden_in_production")
    if config.get("session_gap_seconds", 1800) != 1800:
        raise InvalidData("unsupported_session_rule_version")
    return start, end, cutoff


def derive_events(receipts, config, resolutions=()):
    """Validate exact receipt bytes, independently validate events, then deduplicate."""
    _, _, cutoff = validate_config(config)
    valid, quarantined, receipt_results, integrity_errors = [], [], [], []
    receipt_ids = set()
    for receipt in receipts:
        if not isinstance(receipt, dict):
            integrity_errors.append({"receipt_id": None, "reason": "receipt_not_object"})
            continue
        rid = receipt.get("receipt_id")
        try:
            received = timestamp(receipt.get("received_at"))
            if received > cutoff:
                continue
            if not isinstance(rid, str) or not rid or rid in receipt_ids:
                raise InvalidData("duplicate_or_missing_receipt_id")
            receipt_ids.add(rid)
            raw = base64.b64decode(receipt["body_base64"], validate=True)
            if sha256(raw) != receipt.get("receipt_body_sha256"):
                raise InvalidData("receipt_hash_mismatch")
            if "body_bytes" in receipt and receipt["body_bytes"] != len(raw):
                raise InvalidData("receipt_length_mismatch")
        except (InvalidData, ValueError, TypeError, KeyError) as exc:
            error = str(exc) if isinstance(exc, InvalidData) else "invalid_receipt_encoding"
            integrity_errors.append({"receipt_id": rid, "reason": error})
            continue
        result = {"receipt_id": rid, "status": "valid", "valid_events": 0, "invalid_events": 0}
        try:
            if len(raw) > SCHEMA["max_body_bytes"]:
                raise InvalidData("admission_contract_violation")
            events = validate_envelope(strict_loads(raw))
        except InvalidData as exc:
            result.update(status="quarantined", reason=str(exc))
            receipt_results.append(result)
            continue
        for index, event in enumerate(events):
            try:
                normalized = validate_event(event, config.get("campaign_registry"))
                valid.append({"event": normalized, "payload_sha256": logical_hash(normalized),
                              "receipt_id": rid, "received_at": iso(received), "index": index})
                result["valid_events"] += 1
            except InvalidData as exc:
                quarantined.append({"receipt_id": rid, "event_index": index, "reason": str(exc)})
                result["invalid_events"] += 1
        if result["invalid_events"]:
            result["status"] = "mixed" if result["valid_events"] else "quarantined_events"
        receipt_results.append(result)

    grouped = defaultdict(list)
    for occurrence in valid:
        grouped[occurrence["event"]["event_id"]].append(occurrence)
    trusted, conflicts, excluded = [], [], []
    resolution_map = defaultdict(list)
    invalid_resolutions = []
    for resolution in resolutions:
        try:
            if (not isinstance(resolution, dict) or not isinstance(resolution.get("resolution_id"), str)
                    or not isinstance(resolution.get("event_id"), str)
                    or not isinstance(resolution.get("selected_payload_sha256"), str)
                    or not re.fullmatch(r"[0-9a-f]{64}", resolution["selected_payload_sha256"])
                    or not valid_refs(resolution.get("evidence_refs"))):
                raise InvalidData("invalid_resolution_shape")
            if timestamp(resolution["observed_at"]) <= cutoff:
                resolution_map[resolution["event_id"]].append(resolution)
        except (KeyError, InvalidData):
            invalid_resolutions.append({"reason": "invalid_resolution"})
    duplicate_occurrences = 0
    for event_id in sorted(grouped):
        occurrences = grouped[event_id]
        variants = {x["payload_sha256"] for x in occurrences}
        duplicate_occurrences += len(occurrences) - len(variants)
        selected = None
        if len(variants) > 1:
            candidate_resolutions = resolution_map[event_id]
            if candidate_resolutions:
                latest_time = max(timestamp(r["observed_at"]) for r in candidate_resolutions)
                selections = {r.get("selected_payload_sha256") for r in candidate_resolutions
                              if timestamp(r["observed_at"]) == latest_time}
                if len(selections) == 1 and next(iter(selections)) in variants:
                    selected = next(iter(selections))
            conflicts.append({"event_id": event_id, "payload_hashes": sorted(variants),
                              "status": "resolved" if selected else "unresolved"})
            if not selected:
                excluded.append({"event_id": event_id, "reason": "conflicted_identifier"})
                continue
        else:
            selected = next(iter(variants))
        matches = [x for x in occurrences if x["payload_sha256"] == selected]
        first = min(matches, key=lambda x: (timestamp(x["received_at"]), x["receipt_id"], x["index"]))
        event = first["event"]
        reason = "bot" if event.get("bot") else None
        if event.get("synthetic") and not (config.get("mode") == "isolated_fixture" and
                                          event_id in config.get("fixture_eligible_event_ids", [])):
            reason = "synthetic"
        if reason:
            excluded.append({"event_id": event_id, "reason": reason})
            continue
        received = timestamp(first["received_at"])
        anomaly = None
        try:
            occurred = timestamp(event.get("client_timestamp"))
            if occurred > received + timedelta(minutes=5):
                raise InvalidData("future_client_timestamp")
        except InvalidData as exc:
            occurred, anomaly = received, str(exc)
        trusted.append({"event": event, "payload_sha256": selected,
                        "first_received_at": iso(received), "effective_at": iso(occurred),
                        "time_anomaly": anomaly,
                        "receipt_ids": sorted({x["receipt_id"] for x in matches})})
    return {"events": trusted, "validated_event_occurrences": sorted(valid, key=lambda x: (x["receipt_id"], x["index"])),
            "receipt_results": receipt_results,
            "quarantined_events": quarantined, "integrity_errors": integrity_errors,
            "conflicts": conflicts, "exclusions": excluded, "invalid_resolutions": invalid_resolutions,
            "counts": {"raw_receipts": len(receipt_results) + len(integrity_errors),
                       "valid_event_occurrences": len(valid), "unique_valid_event_ids": len(grouped),
                       "duplicate_occurrences": duplicate_occurrences,
                       "conflicted_event_ids": len(conflicts), "trusted_events": len(trusted),
                       "quarantined_events": len(quarantined),
                       "quarantined_receipts": sum(x["status"] == "quarantined" for x in receipt_results)}}


def touch(event):
    return {"page_id": event["page_id"], "campaign": event.get("campaign", {}),
            "referrer_category": event.get("referrer_category", "direct_unknown")}


def derive_sessions(events):
    grouped, unidentified = defaultdict(list), []
    for row in events:
        browser = row["event"].get("browser_id")
        if browser:
            grouped[browser].append(row)
        else:
            unidentified.append(row["event"]["event_id"])
    sessions, first_touches, event_session = [], {}, {}
    for browser in sorted(grouped):
        rows = sorted(grouped[browser], key=lambda r: (timestamp(r["effective_at"]),
                                                     r["event"]["sequence"], r["event"]["event_id"]))
        first_touches[browser] = touch(rows[0]["event"])
        current = None
        previous = None
        for row in rows:
            now = timestamp(row["effective_at"])
            if previous is None or now - previous >= timedelta(minutes=30):
                sid = "derived_" + sha256((browser + ":" + row["event"]["event_id"]).encode())[:24]
                current = {"session_id": sid, "browser_id": browser, "started_at": iso(now),
                           "ended_at": iso(now), "entry_touch": touch(row["event"]),
                           "first_observed_browser_touch": first_touches[browser], "events": [],
                           "client_session_ids": []}
                sessions.append(current)
            current["events"].append(row)
            current["ended_at"] = iso(now)
            client_sid = row["event"].get("session_id")
            if client_sid and client_sid not in current["client_session_ids"]:
                current["client_session_ids"].append(client_sid)
            event_session[row["event"]["event_id"]] = current["session_id"]
            previous = now
    return sessions, event_session, sorted(unidentified)


def reconcile_mail(messages, classifications, config):
    """Count only independently classified captures, never subject/sender guesses.

    Classifications are separate trusted processing observations referencing exact
    captured content. They must be archived alongside raw messages for replay.
    """
    _, _, cutoff = validate_config(config)
    groups, visible = defaultdict(list), []
    invalid = []
    invalid_classifications = []
    for message in messages:
        if not isinstance(message, dict):
            invalid.append({"observation_id": None, "reason": "invalid_mail_capture"})
            continue
        try:
            if timestamp(message["captured_at"]) > cutoff:
                continue
            timestamp(message["received_at"])
            if not message.get("mailbox") or not message.get("message_id"):
                raise InvalidData("missing_message_identity")
            if (not isinstance(message["mailbox"], str) or not isinstance(message["message_id"], str)
                    or not isinstance(message.get("body"), str)
                    or not isinstance(message.get("headers"), (dict, list))
                    or not isinstance(message.get("attachments"), list)):
                raise InvalidData("invalid_mail_capture_shape")
            capture_content_hash(message)
            visible.append(message)
            groups[(message["mailbox"], message["message_id"])].append(message)
        except (KeyError, InvalidData, TypeError, ValueError):
            invalid.append({"observation_id": message.get("observation_id"), "reason": "invalid_mail_capture"})
    by_message = defaultdict(list)
    for classification in classifications:
        if not isinstance(classification, dict):
            invalid_classifications.append({"classification_id": None, "reason": "invalid_mail_classification"})
            continue
        try:
            for key in ("classification_id", "mailbox", "message_id", "rule_version"):
                if not isinstance(classification.get(key), str) or not classification[key]:
                    raise InvalidData("invalid_classification_shape")
            if (not isinstance(classification.get("kind"), str) or not isinstance(classification.get("status"), str)
                    or not isinstance(classification.get("route_evidence", {}), dict)
                    or not valid_refs(classification.get("evidence_refs"))
                    or not isinstance(classification.get("message_content_sha256"), str)
                    or not re.fullmatch(r"[0-9a-f]{64}", classification["message_content_sha256"])):
                raise InvalidData("invalid_classification_shape")
            for key in ("inquiry_id", "browser_id", "session_id"):
                value = classification.get(key)
                if value is not None and (not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", value)):
                    raise InvalidData("invalid_classification_identifier")
            payload_hash = classification.get("business_payload_sha256")
            if payload_hash is not None and (not isinstance(payload_hash, str) or not re.fullmatch(r"[0-9a-f]{64}", payload_hash)):
                raise InvalidData("invalid_business_payload_hash")
            route = classification.get("route_evidence", {})
            if route and (any(not isinstance(route.get(key), str) for key in ("status", "kind", "destination"))
                          or not valid_refs(route.get("evidence_refs"))):
                raise InvalidData("invalid_route_evidence_shape")
            if timestamp(classification["classified_at"]) <= cutoff:
                by_message[(classification["mailbox"], classification["message_id"])].append(classification)
        except (KeyError, InvalidData):
            invalid_classifications.append({"classification_id": classification.get("classification_id"), "reason": "invalid_mail_classification"})
    decisions, eligible, unresolved = [], [], []
    for key in sorted(groups):
        captures = groups[key]
        latest_time = max(timestamp(x["captured_at"]) for x in captures)
        latest = [x for x in captures if timestamp(x["captured_at"]) == latest_time]
        hashes = {capture_content_hash(x) for x in latest}
        candidates = [c for c in by_message[key] if c.get("message_content_sha256") in hashes]
        selected = None
        if candidates:
            classified_at = max(timestamp(c["classified_at"]) for c in candidates)
            newest = [c for c in candidates if timestamp(c["classified_at"]) == classified_at]
            # Multiple contradictory classifications at the same logical time are unresolved.
            meanings = {json_bytes({k: v for k, v in c.items() if k not in {"classification_id", "classified_at"}}) for c in newest}
            if len(meanings) == 1 and len(hashes) == 1:
                # Equivalent observations may arrive in any export order. Use a
                # stable evidence identifier rather than whichever arrived first.
                selected = min(newest, key=lambda c: c["classification_id"])
        reason = None
        if not selected:
            reason = "unclassified_or_conflicting_capture"
        elif (selected.get("kind") not in MAIL_KINDS or selected.get("status") != "confirmed"
              or not selected.get("rule_version") or not selected.get("evidence_refs")):
            reason = "unsupported_classification_evidence"
        elif selected["kind"] == "unresolved":
            reason = "unresolved_candidate"
        if reason:
            unresolved.append({"mailbox": key[0], "message_id": key[1], "reason": reason})
            decisions.append({"mailbox": key[0], "message_id": key[1], "kind": "unresolved"})
            continue
        decisions.append({"mailbox": key[0], "message_id": key[1], "kind": selected["kind"],
                          "classification_id": selected["classification_id"]})
        if selected["kind"] != "new_inquiry":
            continue
        route = selected.get("route_evidence", {})
        route_ok = (route.get("status") == "verified" and route.get("destination") == "quotes@farpointenergy.com"
                    and bool(route.get("evidence_refs")) and route.get("kind") in {"form", "direct_email"})
        if not route_ok or not selected.get("business_payload_sha256"):
            unresolved.append({"mailbox": key[0], "message_id": key[1], "reason": "unverified_route_or_business_payload"})
            continue
        # A quoted identifier in unrelated/direct email cannot masquerade as form evidence.
        inquiry_id = selected.get("inquiry_id") if route["kind"] == "form" else None
        item = {"mailbox": key[0], "message_id": key[1], "inquiry_id": inquiry_id,
                "browser_id": selected.get("browser_id"), "client_session_id": selected.get("session_id"),
                "business_payload_sha256": selected["business_payload_sha256"],
                "received_at": min(iso(timestamp(x["received_at"])) for x in latest),
                "classification_id": selected["classification_id"], "route_kind": route["kind"],
                "declared_contact": selected.get("declared_contact"),
                "message_content_sha256": selected["message_content_sha256"],
                "evidence_refs": sorted(set(selected["evidence_refs"] + route["evidence_refs"]))}
        eligible.append(item)
    inquiry_groups = defaultdict(list)
    for item in eligible:
        group = "inquiry:" + item["inquiry_id"] if item["inquiry_id"] else "message:" + item["mailbox"] + ":" + item["message_id"]
        inquiry_groups[group].append(item)
    inquiries, conflicts = [], []
    for key in sorted(inquiry_groups):
        items = inquiry_groups[key]
        payloads = {x["business_payload_sha256"] for x in items}
        browsers = {x["browser_id"] for x in items if x["browser_id"]}
        sessions = {x["client_session_id"] for x in items if x["client_session_id"]}
        if len(payloads) > 1 or len(browsers) > 1 or len(sessions) > 1:
            conflicts.append({"inquiry_key": key, "reason": "conflicting_inquiry_evidence",
                              "message_ids": sorted(x["message_id"] for x in items)})
            continue
        first = min(items, key=lambda x: (x["received_at"], x["message_id"]))
        inquiries.append({"inquiry_key": key, "inquiry_id": first["inquiry_id"],
                          "browser_id": next(iter(browsers), None),
                          "client_session_id": next(iter(sessions), None),
                          "received_at": first["received_at"],
                          "message_ids": sorted(x["message_id"] for x in items),
                          "route_kind": first["route_kind"],
                          "contact_observations": [{"declared_contact": x["declared_contact"],
                              "mailbox": x["mailbox"], "message_id": x["message_id"],
                              "message_content_sha256": x["message_content_sha256"],
                              "classification_id": x["classification_id"], "evidence_refs": x["evidence_refs"]}
                              for x in sorted(items, key=lambda x: (x["mailbox"], x["message_id"], x["classification_id"]))]})
    return {"raw_observations": len(visible) + len(invalid), "distinct_messages": len(groups),
            "decisions": decisions, "inquiries": inquiries, "conflicts": conflicts,
            "unresolved": unresolved, "invalid": invalid, "invalid_classifications": invalid_classifications}


def ratio(numerator, denominator):
    return {"numerator": numerator, "denominator": denominator,
            "percent": format(100 * numerator / denominator, ".6g") if denominator else None}


def analyze(receipts, messages, classifications, config, resolutions=(), company_observations=()):
    # Imported after module initialization; reporting uses the same timestamp and
    # canonical report conventions without maintaining a second transformation.
    from .reporting import build_reporting_tables, company_context, declared_contacts
    start, end, cutoff = validate_config(config)
    derived = derive_events(receipts, config, resolutions)
    sessions, event_session, unidentified = derive_sessions(derived["events"])
    mail = reconcile_mail(messages, classifications, config)
    # Session cohort is explicitly defined by session START in the event-time window.
    cohort = [s for s in sessions if start <= timestamp(s["started_at"]) < end]
    cohort_ids = {s["session_id"] for s in cohort}
    session_by_id = {s["session_id"]: s for s in sessions}
    stage_sets, inquiry_events = defaultdict(set), defaultdict(list)
    for row in derived["events"]:
        event = row["event"]
        sid = event_session.get(event["event_id"])
        if sid in cohort_ids and start <= timestamp(row["effective_at"]) < end:
            stage_sets[event["event_name"]].add(sid)
        if event.get("inquiry_id") and event["event_name"] in {"quotation_attempt", "quotation_provider_accepted", "quotation_transport_error"}:
            inquiry_events[event["inquiry_id"]].append((event, sid))
    matched, unmatched, join_conflicts = [], [], []
    for inquiry in mail["inquiries"]:
        events = inquiry_events.get(inquiry["inquiry_id"], []) if inquiry["inquiry_id"] else []
        candidate_sessions = {sid for _, sid in events if sid}
        if not events or not candidate_sessions:
            unmatched.append(inquiry)
            continue
        if len(candidate_sessions) > 1 and inquiry["browser_id"] and inquiry["client_session_id"]:
            # An unchanged retry may happen after a new session starts. Frozen,
            # verified inquiry metadata identifies the original session; the
            # later attempt is retained but does not earn another conversion.
            same_browser = all(session_by_id[s]["browser_id"] == inquiry["browser_id"] for s in candidate_sessions)
            originals = {s for s in candidate_sessions if inquiry["client_session_id"] in session_by_id[s]["client_session_ids"]}
            if same_browser and len(originals) == 1:
                candidate_sessions = originals
        if len(candidate_sessions) != 1:
            join_conflicts.append({"inquiry_key": inquiry["inquiry_key"], "reason": "multiple_website_sessions"})
            unmatched.append(inquiry)
            continue
        sid = next(iter(candidate_sessions))
        session = session_by_id[sid]
        if ((inquiry["browser_id"] and inquiry["browser_id"] != session["browser_id"]) or
            (inquiry["client_session_id"] and inquiry["client_session_id"] not in session["client_session_ids"])):
            join_conflicts.append({"inquiry_key": inquiry["inquiry_key"], "reason": "conflicting_website_identifiers"})
            unmatched.append(inquiry)
            continue
        matched.append({**inquiry, "derived_session_id": sid,
                        "first_observed_browser_touch": session["first_observed_browser_touch"],
                        "inquiry_session_touch": session["entry_touch"]})
    converted = {x["derived_session_id"] for x in matched if x["derived_session_id"] in cohort_ids}
    attempted = stage_sets["quotation_attempt"]
    received_ids = {x["inquiry_id"] for x in matched if x["inquiry_id"]}
    accepted_ids = {row["event"]["inquiry_id"] for row in derived["events"]
                    if row["event"]["event_name"] == "quotation_provider_accepted" and row["event"].get("inquiry_id")
                    and event_session.get(row["event"]["event_id"]) in cohort_ids}
    outcomes = []
    for session in cohort:
        sid = session["session_id"]
        names = {r["event"]["event_name"] for r in session["events"]}
        inquiry_actions = [r["event"] for r in session["events"] if r["event"]["event_name"] in
                           {"quotation_attempt", "quotation_provider_accepted", "quotation_transport_error"}]
        action_ids = {e["inquiry_id"] for e in inquiry_actions if e.get("inquiry_id")}
        accepted_here = [e for e in inquiry_actions if e["event_name"] == "quotation_provider_accepted"]
        pending_accepted = {e["inquiry_id"] for e in accepted_here if e.get("inquiry_id") and e["inquiry_id"] not in received_ids}
        unknown_accepted = any(not e.get("inquiry_id") for e in accepted_here)
        received_retries = action_ids & received_ids
        only_received_retries = bool(received_retries) and not (action_ids - received_ids) and all(e.get("inquiry_id") for e in inquiry_actions)
        if sid in converted:
            outcome = "received_inquiry"
        elif pending_accepted or unknown_accepted:
            outcome = "delivery_unverified"
        elif only_received_retries:
            outcome = "retry_of_received_inquiry"
        elif "quotation_transport_error" in names or "script_error" in names:
            outcome = "observed_error_associated_exit"
        elif "quotation_validation_error" in names:
            outcome = "validation_friction"
        else:
            outcome = "exit_without_observed_error"
        outcomes.append({"session_id": sid, "browser_id": session["browser_id"],
                         "client_session_ids": session["client_session_ids"], "outcome": outcome,
                         "received_inquiry_retries": sorted(received_retries) if sid not in converted else [],
                         "pending_accepted_inquiry_ids": sorted(pending_accepted),
                         "observed_error": bool(names & {"quotation_transport_error", "script_error"})})
    source_complete = config.get("source_completeness", {})
    reporting = build_reporting_tables(derived, sessions, event_session, cohort, matched, start, end)
    contacts = declared_contacts(matched, unmatched)
    companies = company_context(company_observations, receipts, derived["events"], event_session,
                                cohort, config)
    required_sources = {"collector", "mail", "classifications"}
    completeness = (isinstance(source_complete, dict) and required_sources <= source_complete.keys()
                    and all(value is True for value in source_complete.values())
                    and not derived["integrity_errors"] and not derived["invalid_resolutions"]
                    and not mail["invalid"] and not mail["invalid_classifications"]
                    and not contacts["invalid"] and not companies["invalid"])
    warnings = ["Observed browser identifiers are not people.",
                "Exit and error association do not establish loss of interest or causation.",
                "Blocked/offline browsers may be absent; no traffic alone does not prove collector health."]
    if not completeness:
        warnings.append("Inputs incomplete or source completeness unverified; this is a partial diagnostic report.")
    if unidentified:
        warnings.append("Unidentified events excluded from session denominators.")
    if companies["coverage"]["without_possible_company"]:
        warnings.append("Company matching is unavailable or unknown for some sessions; network ownership does not establish an employer.")
    return {"rule_version": RULE_VERSION, "status": "complete" if completeness else "incomplete",
            "window_start": iso(start), "window_end": iso(end), "observation_cutoff": iso(cutoff),
            "timezone": config.get("timezone", "America/New_York"),
            "session_cohort_rule": "session_started_in_window; stages_event_time_in_window; conversions_as_of_cutoff",
            "receipt_counts": derived["counts"],
            "traffic": {"sessions": len(cohort), "browser_identifiers": len({s["browser_id"] for s in cohort}),
                        "unidentified_events": len(unidentified)},
            "stage_reach": {name: len(stage_sets[name]) for name in SCHEMA["event_name"]},
            "mail_counts": {"raw_observations": mail["raw_observations"], "distinct_messages": mail["distinct_messages"],
                            "received_inquiries": len(mail["inquiries"]), "matched_website_inquiries": len(matched),
                            "unattributed_inquiries": len(unmatched), "unresolved_candidates": len(mail["unresolved"]),
                            "conflicted_inquiry_ids": len(mail["conflicts"]),
                            "received_in_window": sum(start <= timestamp(x["received_at"]) < end for x in mail["inquiries"]),
                            "cohort_received_inquiries": sum(x["derived_session_id"] in cohort_ids for x in matched)},
            "session_conversion": ratio(len(converted), len(cohort)),
            "attempt_session_conversion": ratio(len(converted & attempted), len(attempted)),
            "provider_accepted_without_receipt": sorted(accepted_ids - received_ids),
            "session_outcomes": outcomes, "matched_inquiries": matched,
            "unattributed_inquiries": unmatched, "mail_decisions": mail["decisions"],
            "mail_unresolved": mail["unresolved"], "mail_conflicts": mail["conflicts"],
            "join_conflicts": join_conflicts, "time_anomalies": [
                {"event_id": r["event"]["event_id"], "reason": r["time_anomaly"]} for r in derived["events"] if r["time_anomaly"]],
            "receipt_results": derived["receipt_results"], "event_conflicts": derived["conflicts"],
            "event_exclusions": derived["exclusions"], "quarantined_events": derived["quarantined_events"],
            "integrity_errors": derived["integrity_errors"], "invalid_mail_captures": mail["invalid"],
            "invalid_mail_classifications": mail["invalid_classifications"],
            "invalid_event_resolutions": derived["invalid_resolutions"],
            "tables": reporting["tables"], "attribution": reporting["attribution"],
            "declared_contacts": contacts["rows"], "invalid_declared_contacts": contacts["invalid"],
            "company_context": companies, "warnings": warnings}
