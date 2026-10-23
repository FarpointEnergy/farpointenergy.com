"""GOLD-F1 sequences transcribed from the reviewed test-plan oracle."""
import base64
import copy
from datetime import datetime, timedelta, timezone
import hashlib
import json


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode()


def receipt(receipt_id, events=None, raw=None, received_at="2026-10-19T14:00:00Z", schema=1):
    if raw is None:
        raw = encode({"schema_version": schema, "tracker_version": "1.0.0", "events": events})
    return {"receipt_schema_version": 1, "receipt_id": receipt_id, "received_at": received_at,
            "receipt_body_sha256": hashlib.sha256(raw).hexdigest(),
            "body_base64": base64.b64encode(raw).decode(), "body_bytes": len(raw),
            "content_type": "application/json", "origin": "https://farpoint.example",
            "collector_version": "fixture-1", "transport": {"method": "POST", "content_encoding": "identity"},
            "source_ip": {"status": "unavailable", "provenance": "unverified", "address": None}}


def event(event_id="syn_E1", name="page_view", browser="syn_B1", session="syn_S1", at="2026-10-19T12:00:00Z", sequence=0, **extra):
    return {"schema_version": 1, "event_id": event_id, "browser_id": browser, "session_id": session,
            "client_timestamp": at, "sequence": sequence, "event_name": name,
            "page_id": "home", "tracker_version": "1.0.0", "synthetic": True, **extra}


def content_hash(message):
    fields = ("mailbox", "message_id", "received_at", "body", "headers", "attachments")
    return hashlib.sha256(encode({key: message.get(key) for key in fields})).hexdigest()


def mail(mid, qid=None, browser=None, session=None, captured="2026-10-19T14:10:00Z",
         received="2026-10-19T14:03:00Z", route="form", kind="new_inquiry", payload=None):
    message = {"observation_id": "syn_O_" + mid, "mailbox": "synthetic-mailbox",
               "message_id": "syn_" + mid, "captured_at": captured, "received_at": received,
               "body": "SYNTHETIC FIXTURE ONLY " + (qid or mid),
               "headers": {"Delivered-To": "quotes@farpointenergy.com"}, "attachments": []}
    classification = {"classification_id": "syn_C_" + mid, "mailbox": message["mailbox"],
                      "message_id": message["message_id"], "message_content_sha256": content_hash(message),
                      "classified_at": captured, "rule_version": "fixture-mail-1", "kind": kind,
                      "status": "confirmed", "evidence_refs": ["synthetic-route-evidence"],
                      "inquiry_id": qid, "browser_id": browser, "session_id": session,
                      "business_payload_sha256": hashlib.sha256((payload or qid or mid).encode()).hexdigest(),
                      "route_evidence": {"status": "verified", "kind": route,
                                         "destination": "quotes@farpointenergy.com",
                                         "evidence_refs": ["synthetic-delivery-header-evidence"]}}
    return message, classification


def golden(cutoff="A"):
    shorthand = {"page": "page_view", "product": "product_view", "reference": "reference_select",
                 "quote": "quotation_view", "start": "quotation_start", "attempt": "quotation_attempt",
                 "accepted": "quotation_provider_accepted", "validation": "quotation_validation_error",
                 "transport": "quotation_transport_error", "email": "email_click"}
    journeys = [
        ("S1", "B1", ["page", "product", "reference"], None, "email", "A", "2026-10-19T12:00:00Z"),
        ("S2", "B1", ["page", "quote", "start", "attempt", "accepted"], "Q1", None, None, "2026-10-19T13:00:00Z"),
        ("S3", "B2", ["page", "product", "quote", "start", "validation", "attempt", "accepted"], "Q2", "paid", "P", "2026-10-19T12:00:00Z"),
        ("S4", "B3", ["page", "product", "quote", "start", "attempt", "transport"], "Q3", "organic", None, "2026-10-19T12:00:00Z"),
        ("S5", "B4", ["page", "quote", "start", "validation"], None, None, None, "2026-10-19T12:00:00Z"),
        ("S6", "B5", ["page", "product", "email"], None, "referral", None, "2026-10-19T12:00:00Z"),
        ("S7", "B6", ["page"], None, None, None, "2026-10-19T12:00:00Z"),
        # F1 erratum: explicit reload page_view after transport_error supplies
        # the plan's declared sixth event, without changing stage-session counts.
        ("S8", "B7", ["page", "quote", "start", "attempt", "transport", "page"], "Q5", "email", "B", "2026-10-19T12:00:00Z")]
    batches, all_events = [], []
    for sid, bid, names, qid, source, campaign, at in journeys:
        batch = []
        for seq, short in enumerate(names):
            occurred = datetime.fromisoformat(at.replace("Z", "+00:00")) + timedelta(seconds=seq)
            extra = {"referrer_category": "search" if source == "organic" else "referral" if source == "referral" else "direct_unknown"}
            if source in {"email", "paid"}:
                extra["campaign"] = {"source": source, "medium": source, "campaign": campaign}
            if short in {"attempt", "accepted", "transport"} and qid:
                extra["inquiry_id"] = "syn_" + qid
            if short == "reference":
                extra["reference_id"] = "FP-MPT-138-50"
            batch.append(event("syn_" + sid + "_" + str(seq), shorthand[short], "syn_" + bid,
                               "syn_" + sid, occurred.isoformat().replace("+00:00", "Z"), seq, **extra))
        batches.append(batch)
        all_events.extend(batch)
    receipts = [receipt("syn_R" + str(i + 1), batch) for i, batch in enumerate(batches)]
    receipts.extend([receipt("syn_R9", batches[1]), receipt("syn_R10", batches[2][:2]),
                     receipt("syn_R11", raw=b"{invalid"), receipt("syn_R12", [], schema=99)])
    pairs = [mail("G1", "syn_Q1", "syn_B1", "syn_S2"), mail("G2", "syn_Q1", "syn_B1", "syn_S2"),
             mail("G3", "syn_Q3", "syn_B3", "syn_S4"), mail("G4", route="direct_email"), mail("G5")]
    messages = [pairs[0][0], {**copy.deepcopy(pairs[0][0]), "observation_id": "syn_O_G1_second"}, *[x[0] for x in pairs[1:]]]
    classifications = [x[1] for x in pairs]
    if cutoff == "B":
        message, classified = mail("G6", "syn_Q2", "syn_B2", "syn_S3", captured="2026-10-19T15:15:00Z")
        messages.append(message)
        classifications.append(classified)
    config = {"mode": "isolated_fixture", "fixture_eligible_event_ids": [e["event_id"] for e in all_events],
              "window_start": "2026-10-19T00:00:00Z", "window_end": "2026-10-20T00:00:00Z",
              "observation_cutoff": "2026-10-19T15:00:00Z" if cutoff == "A" else "2026-10-19T15:30:00Z",
              "timezone": "America/New_York", "campaign_registry": {"source": ["email", "paid"], "medium": ["email", "paid"], "campaign": ["A", "B", "P"]},
              "source_completeness": {"collector": True, "mail": True, "classifications": True}}
    return {"receipts": receipts, "messages": messages, "classifications": classifications,
            "config": config, "events": all_events}
