from __future__ import annotations

import json
from pathlib import Path
import re

from .canonical import InvalidData, canonical_bytes, normalize

SCHEMA = json.loads(Path(__file__).with_name("schema-v1.json").read_text())
IDENTIFIER = re.compile(r"^[A-Za-z0-9_-]{1,128}$")
VERSION = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")


def validate_event(event, registry=None):
    """Return a new normalized event or raise a categorical validation error."""
    if not isinstance(event, dict):
        raise InvalidData("event_not_object")
    if set(SCHEMA["required"]) - event.keys():
        raise InvalidData("missing_required_event_key")
    if event.keys() - set(SCHEMA["required"] + SCHEMA["optional"]):
        raise InvalidData("unknown_event_key")
    # Events are shallow: only campaign may contain an object, with string
    # values. Reject nested hostile structures before recursive normalization.
    if any(isinstance(value, (dict, list)) for key, value in event.items() if key != "campaign"):
        raise InvalidData("invalid_structure")
    if "campaign" in event:
        campaign = event["campaign"]
        if not isinstance(campaign, dict) or campaign.keys() - {"source", "medium", "campaign"}:
            raise InvalidData("invalid_campaign_keys")
        if any(not isinstance(value, str) for value in campaign.values()):
            raise InvalidData("unregistered_campaign_value")
    try:
        result = normalize(event)
    except RecursionError:
        raise InvalidData("invalid_structure") from None
    if type(result["schema_version"]) is not int or result["schema_version"] != 1:
        raise InvalidData("unsupported_event_schema")
    if not isinstance(result["event_id"], str) or not IDENTIFIER.fullmatch(result["event_id"]):
        raise InvalidData("invalid_event_id")
    if type(result["sequence"]) is not int or result["sequence"] < 0:
        raise InvalidData("invalid_sequence")
    if not isinstance(result["tracker_version"], str) or not VERSION.fullmatch(result["tracker_version"]):
        raise InvalidData("invalid_tracker_version")
    for key in ("browser_id", "session_id", "inquiry_id"):
        if key in result and result[key] is not None:
            if not isinstance(result[key], str) or not IDENTIFIER.fullmatch(result[key]):
                raise InvalidData("invalid_identifier")
    timestamp = result.get("client_timestamp")
    if timestamp is not None and (not isinstance(timestamp, str) or len(timestamp) > 64):
        raise InvalidData("invalid_timestamp_type")
    for key in ("event_name", "page_id", "product_id", "application_id", "reference_id",
                "referrer_category", "error_category", "location_code", "storage_status"):
        if key in result and result[key] not in SCHEMA[key]:
            raise InvalidData("unregistered_enum_value")
    for key in ("synthetic", "bot"):
        if key in result and type(result[key]) is not bool:
            raise InvalidData("invalid_boolean")
    if "campaign" in result:
        campaign = result["campaign"]
        registry = registry if registry is not None else SCHEMA["campaign_registry"]
        if not isinstance(campaign, dict) or campaign.keys() - {"source", "medium", "campaign"}:
            raise InvalidData("invalid_campaign_keys")
        for key, value in campaign.items():
            if not isinstance(value, str) or value not in set(registry.get(key, [])) | {"unknown_campaign"}:
                raise InvalidData("unregistered_campaign_value")
    canonical_bytes(result)
    return result


def validate_envelope(value):
    if not isinstance(value, dict) or set(value) != {"schema_version", "tracker_version", "events"}:
        raise InvalidData("invalid_envelope")
    if type(value["schema_version"]) is not int or value["schema_version"] != 1:
        raise InvalidData("unsupported_schema")
    if not isinstance(value["tracker_version"], str) or not VERSION.fullmatch(value["tracker_version"]):
        raise InvalidData("invalid_tracker_version")
    if not isinstance(value["events"], list) or len(value["events"]) > SCHEMA["max_batch_events"]:
        raise InvalidData("invalid_event_count")
    return value["events"]
