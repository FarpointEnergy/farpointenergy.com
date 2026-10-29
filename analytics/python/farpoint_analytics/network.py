"""Generate reproducible network context from an archived local dataset.

There are no provider calls, identity guesses, source edits, or storage operations
here. The caller archives exact inputs and this function's returned observations.
"""
from __future__ import annotations

from collections import Counter
import ipaddress
import re

from .analysis import derive_events, iso, json_bytes, timestamp, valid_refs
from .canonical import InvalidData, sha256
from .enrichment import IPToASN

NETWORK_RULE_VERSION = "farpoint-network-context/1.0.0"


def build_network_observations(receipts, config, dataset, *, observed_at,
                               observation_run_id, evidence_refs, retention_approved):
    """One observation per trusted receipt, linked to its actual trusted events.

    A new invocation must have a new run ID. Replaying one invocation with frozen
    inputs returns identical observations. Network ownership never yields an
    employer or a possible-company match.
    """
    if not isinstance(dataset, IPToASN):
        raise InvalidData("invalid_network_dataset")
    if not isinstance(observation_run_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{8,100}", observation_run_id):
        raise InvalidData("invalid_network_observation_run_id")
    if not valid_refs(evidence_refs) or retention_approved is not True:
        raise InvalidData("network_dataset_retention_unapproved")
    observation_time = timestamp(observed_at)
    if observation_time > timestamp(config["observation_cutoff"]):
        raise InvalidData("network_observation_after_cutoff")
    allowed = config.get("verified_ip_provenances", {})
    if not isinstance(allowed, dict):
        raise InvalidData("invalid_verified_ip_provenances")
    allowed = {tag: refs for tag, refs in allowed.items()
               if isinstance(tag, str) and tag != "unverified" and valid_refs(refs)}
    derived = derive_events(receipts, config)
    by_receipt = {}
    for row in derived["events"]:
        for rid in row["receipt_ids"]:
            by_receipt.setdefault(rid, set()).add(row["event"]["event_id"])
    visible = []
    for receipt in receipts:
        try:
            if isinstance(receipt, dict) and timestamp(receipt.get("received_at")) <= timestamp(config["observation_cutoff"]):
                visible.append(receipt)
        except InvalidData:
            continue
    counts = Counter(r.get("receipt_id") for r in visible if isinstance(r.get("receipt_id"), str))
    observations, omitted = [], []
    for receipt in sorted(visible, key=lambda r: str(r.get("receipt_id", ""))):
        rid = receipt.get("receipt_id")
        if not isinstance(rid, str) or rid not in by_receipt:
            continue
        if counts[rid] != 1:
            omitted.append({"receipt_id": rid, "reason": "ambiguous_receipt_identity"})
            continue
        if timestamp(receipt["received_at"]) > observation_time:
            raise InvalidData("network_observation_precedes_receipt")
        source = receipt.get("source_ip", {})
        if not isinstance(source, dict):
            source = {}
        address = source.get("address")
        provenance = source.get("provenance")
        if not isinstance(provenance, str):
            provenance = None
        proven = source.get("status") == "verified" and provenance in allowed
        try:
            if not isinstance(address, str):
                raise ValueError()
            address = str(ipaddress.ip_address(address))
        except ValueError:
            address, proven = None, False
        context = dataset.lookup(address, provenance_verified=proven)
        identity = {"run": observation_run_id, "receipt_id": rid, "dataset_sha256": dataset.sha256,
                    "observed_at": iso(observation_time), "rule_version": NETWORK_RULE_VERSION}
        network = context.get("network_organization")
        observation = {"observation_id": "network_" + sha256(json_bytes(identity)),
                       "provider": "IPtoASN", "kind": "network", "rule_version": NETWORK_RULE_VERSION,
                       "observed_at": iso(observation_time), "status": "ok" if network else "unavailable",
                       "receipt_ids": [rid], "event_ids": sorted(by_receipt[rid]),
                       "input_ip": address, "ip_provenance_verified": proven,
                       "retention_approved": True, "dataset_sha256": dataset.sha256,
                       "network_organization": network, "lookup_reason": context["reason"],
                       "evidence_refs": sorted(set(evidence_refs + allowed.get(provenance, []))),
                       "employer": None}
        if "asn" in context:
            observation.update(asn=context["asn"], country=context["country"])
        observations.append(observation)
    return {"rule_version": NETWORK_RULE_VERSION, "observations": observations,
            "omitted": omitted, "receipt_integrity_errors": derived["integrity_errors"],
            "status": "incomplete" if omitted or derived["integrity_errors"] else "complete",
            "scope": "local network ownership only; no employer identity and no external IP disclosure"}
