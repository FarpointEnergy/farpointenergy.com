"""Optional, offline DB-IP company context. Disabled unless explicitly configured.

The authorization artifact records a decision made outside this module; it does
not authenticate an approver or establish that a purchase/licence is valid.
Inputs and full matched records belong in the private, permanent run archive.
No address is sent to a provider. A network association never verifies employment.
"""
from __future__ import annotations

from collections import Counter
import copy
import importlib
import io
import ipaddress
from pathlib import Path
import re
import sys
import tarfile

from .analysis import derive_events, iso, json_bytes, timestamp, valid_refs
from .archive import create_only, safe_relative
from .canonical import InvalidData, sha256, strict_loads
from .enrichment import classify_company_observation

DBIP_RULE_VERSION = "farpoint-dbip-company/1.0.0"
READER_VERSION = "3.2.0"
READER_SDIST_SHA256 = "d28e0073fd1dd637c8b95947bc864b5625eca9f8f2db1538145e33b2a1cd4b92"
READER_SDIST_BYTES = 531318
READER_FILES = ("__init__.py", "const.py", "decoder.py", "errors.py", "file.py", "reader.py", "types.py")
SCOPE = "Possible company from a network allocation; not verified visitor employment."


def _require(condition, reason):
    if not condition:
        raise InvalidData(reason)


def _label(value):
    return (isinstance(value, str) and bool(value.strip()) and len(value) <= 512
            and not any(ord(char) < 32 or ord(char) == 127 for char in value))


def classify_dbip_record(record, *, contradictory_evidence=False):
    """Conservative DB-IP traits rule; never substitute ISP or ASN for company.

    The documented public-DNS example has Corporate + hosting + anycast and
    therefore remains unknown. Unknown/malformed classifications fail closed.
    This rule alone does not establish source-IP or licence provenance.
    """
    result = {"company": None, "network_category": "unknown", "employer": None,
              "identity_category": "unknown", "contradictory_evidence": bool(contradictory_evidence),
              "lookup_reason": "provider_record_unrecognized", "caveat": SCOPE}
    if contradictory_evidence is not False:
        result["lookup_reason"] = "contradictory_company_evidence"
        return result
    if not isinstance(record, dict) or not isinstance(record.get("traits"), dict):
        return result
    traits = record["traits"]
    usage, connection = traits.get("user_type"), traits.get("connection_type")
    exclusions = {"hosting": "hosting", "residential": "isp", "cellular": "mobile"}
    if isinstance(usage, str) and usage in exclusions:
        result.update(network_category=exclusions[usage], lookup_reason="noncorporate_usage")
        return result
    if connection in ("Dialup", "Cable/DSL", "Cellular"):
        result.update(network_category="mobile" if connection == "Cellular" else "isp",
                      lookup_reason="noncorporate_connection")
        return result
    if traits.get("is_anycast") is True:
        result.update(network_category="shared", lookup_reason="anycast_network")
        return result
    # DB-IP ISP records do not promise these extra fields; if supplied, never
    # discard a contrary flag from a richer edition or an archived provider record.
    for flag in ("is_anonymous", "is_anonymous_vpn", "is_hosting_provider", "is_public_proxy",
                 "is_residential_proxy", "is_tor_exit_node", "is_proxy", "is_vpn", "is_relay"):
        if flag in traits and traits[flag] is not False:
            result.update(network_category="shared", lookup_reason="shared_or_unrecognized_risk_flag")
            return result
    if (usage != "business" or connection != "Corporate" or traits.get("is_anycast") is not False):
        result["lookup_reason"] = "corporate_classification_incomplete"
        return result
    company = traits.get("organization")
    if not _label(company):
        result["lookup_reason"] = "organization_missing_or_invalid"
        return result
    company = company.strip()
    isp = traits.get("isp")
    if _label(isp) and company.casefold() == isp.strip().casefold():
        result.update(network_category="isp", lookup_reason="organization_is_isp")
        return result
    result.update(company=company, network_category="corporate",
                  identity_category="possible_corporate_match", lookup_reason="possible_company_not_verified_employer")
    return result


def _artifact(spec, artifacts, name):
    _require(isinstance(spec, dict), "dbip_" + name + "_binding_missing")
    path = spec.get("artifact")
    _require(isinstance(path, str), "dbip_artifact_path_invalid")
    safe_relative(path)
    data = artifacts.get(path)
    _require(isinstance(data, bytes) and type(spec.get("bytes")) is int
             and len(data) == spec["bytes"] and sha256(data) == spec.get("sha256"),
             "dbip_" + name + "_integrity_failure")
    _require(len(data) > 0, "dbip_empty_artifact")
    return data


def _load_reader(sdist, runtime_directory):
    """Load only the hash-pinned pure-Python sources; never execute setup.py.

    Each preparation directory is create-only. An already imported reader is
    accepted only when every loaded module and package source matches the pin.
    """
    expected = {}
    with tarfile.open(fileobj=io.BytesIO(sdist), mode="r:gz") as package:
        for name in READER_FILES:
            member = package.getmember("maxminddb-3.2.0/maxminddb/" + name)
            _require(member.isfile() and member.size < 2 * 1024 * 1024, "dbip_reader_archive_invalid")
            expected[name] = package.extractfile(member).read()
        metadata = package.extractfile("maxminddb-3.2.0/PKG-INFO").read()
    root = Path(runtime_directory)
    _require(root.is_absolute() and not any(p.is_symlink() for p in (root, *root.parents)),
             "dbip_reader_runtime_path_invalid")
    root.mkdir(parents=True, exist_ok=False, mode=0o700)
    for name, data in expected.items():
        create_only(root / "maxminddb" / name, data)
    create_only(root / "maxminddb-3.2.0.dist-info/METADATA", metadata)
    loaded = sys.modules.get("maxminddb")
    if loaded is not None:
        loaded_root = Path(loaded.__file__).parent
        for name, data in expected.items():
            _require((loaded_root / name).is_file() and (loaded_root / name).read_bytes() == data,
                     "dbip_reader_import_conflict")
        for name, module in list(sys.modules.items()):
            if name.startswith("maxminddb.") and module is not None:
                source = getattr(module, "__file__", None)
                _require(source is not None and Path(source).name in expected
                         and Path(source).read_bytes() == expected[Path(source).name], "dbip_reader_import_conflict")
    else:
        sys.path.insert(0, str(root))
        try:
            loaded = importlib.import_module("maxminddb")
        finally:
            sys.path.remove(str(root))
    _require(loaded.__version__ == READER_VERSION, "dbip_reader_version_mismatch")
    # MODE_FD forces the pinned pure Python implementation and an immutable
    # verified in-memory database buffer, not an arbitrary native extension.
    from maxminddb.reader import Reader
    return Reader, loaded.MODE_FD, {name: sha256(data) for name, data in expected.items()}


class DBIPCompanyDataset:
    def __init__(self, config, artifacts, *, runtime_directory):
        self.enabled = isinstance(config, dict) and config.get("enabled") is True
        self.reader = None
        self.binding = None
        if not self.enabled:
            return
        _require(isinstance(artifacts, dict), "dbip_artifacts_missing")
        self.config = copy.deepcopy(config)
        dataset = _artifact(config.get("dataset"), artifacts, "dataset")
        licence = _artifact(config.get("license"), artifacts, "license")
        approval_raw = _artifact(config.get("approval"), artifacts, "approval")
        reader = _artifact(config.get("reader"), artifacts, "reader")
        reader_spec, data_spec = config["reader"], config["dataset"]
        _require(reader_spec.get("version") == READER_VERSION and len(reader) == READER_SDIST_BYTES
                 and sha256(reader) == READER_SDIST_SHA256, "dbip_reader_pin_mismatch")
        _require(_label(data_spec.get("edition")) and _label(data_spec.get("database_type"))
                 and type(data_spec.get("build_epoch")) is int and data_spec["build_epoch"] > 0,
                 "dbip_dataset_version_missing")
        approval = strict_loads(approval_raw)
        expected = {"provider": "DB-IP", "product": "ip-to-isp", "purpose": "farpoint_private_company_context",
                    "dataset_sha256": sha256(dataset), "dataset_edition": data_spec["edition"],
                    "license_sha256": sha256(licence), "reader_sha256": READER_SDIST_SHA256,
                    "approved": True, "retention_approved": True, "offline_replay_approved": True}
        _require(isinstance(approval, dict) and all(approval.get(k) == v for k, v in expected.items())
                 and all(approval.get(k) is True for k in ("approved", "retention_approved", "offline_replay_approved")),
                 "dbip_authorization_binding_invalid")
        Reader, mode, source_hashes = _load_reader(reader, runtime_directory)
        try:
            self.reader = Reader(io.BytesIO(dataset), mode=mode)
            metadata = self.reader.metadata()
            _require(metadata.database_type == data_spec["database_type"]
                     and metadata.build_epoch == data_spec["build_epoch"]
                     and metadata.binary_format_major_version == 2
                     and metadata.ip_version in (4, 6), "dbip_dataset_metadata_mismatch")
            self.metadata = {name: copy.deepcopy(getattr(metadata, name)) for name in
                             ("database_type", "build_epoch", "ip_version", "binary_format_major_version",
                              "binary_format_minor_version", "node_count", "record_size", "languages", "description")}
        except Exception:
            if self.reader is not None:
                self.reader.close()
            raise InvalidData("dbip_dataset_open_or_metadata_failure") from None
        self.sha256 = sha256(dataset)
        self.binding = {"dataset_sha256": self.sha256, "dataset_edition": data_spec["edition"],
                        "license_sha256": sha256(licence), "approval_sha256": sha256(approval_raw),
                        "reader_sdist_sha256": READER_SDIST_SHA256, "reader_version": READER_VERSION,
                        "reader_source_hashes": source_hashes, "metadata": self.metadata,
                        "authorization_scope": "hash-bound operator-supplied approval; not authenticated by this module"}

    def close(self):
        if self.reader is not None:
            self.reader.close()

    def lookup(self, address, *, provenance_verified, contradictory_evidence=False):
        result = {"company": None, "network_category": "unknown", "employer": None,
                  "identity_category": "unknown", "status": "unavailable", "provider_record": None,
                  "contradictory_evidence": bool(contradictory_evidence), "caveat": SCOPE}
        if not self.enabled:
            return {**result, "lookup_reason": "provider_disabled"}
        if provenance_verified is not True:
            return {**result, "lookup_reason": "source_ip_unverified"}
        try:
            _require(isinstance(address, str), "dbip_invalid_address")
            address = ipaddress.ip_address(address)
        except (ValueError, InvalidData):
            return {**result, "lookup_reason": "source_ip_invalid"}
        if address.version == 6 and self.metadata["ip_version"] == 4:
            return {**result, "lookup_reason": "dataset_address_family_unavailable"}
        try:
            record, prefix = self.reader.get_with_prefix_len(str(address))
        except Exception:
            # Preserve the database artifact; a broken lookup must not be a
            # healthy zero or silently disappear from completeness accounting.
            return {**result, "status": "error", "lookup_reason": "provider_lookup_error"}
        if record is None:
            return {**result, "lookup_reason": "company_unknown"}
        classification = classify_dbip_record(record, contradictory_evidence=contradictory_evidence)
        return {**result, **classification, "status": "ok", "provider_record": copy.deepcopy(record),
                "matched_network": str(ipaddress.ip_network((address, prefix), strict=False)),
                "provider_record_sha256": sha256(json_bytes(record))}


def build_dbip_observations(receipts, config, dataset, *, observed_at, observation_run_id, evidence_refs,
                            contradictory_receipt_ids=()):
    """Join only derived trusted events; retain full records and exact input bindings."""
    _require(isinstance(dataset, DBIPCompanyDataset), "invalid_dbip_dataset")
    if not dataset.enabled:
        return {"status": "disabled", "rule_version": DBIP_RULE_VERSION, "observations": [],
                "omitted": [], "receipt_integrity_errors": [], "scope": SCOPE}
    _require(isinstance(observation_run_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{8,100}", observation_run_id),
             "invalid_dbip_observation_run_id")
    _require(valid_refs(evidence_refs), "dbip_evidence_refs_missing")
    _require(isinstance(contradictory_receipt_ids, (list, tuple, set))
             and all(isinstance(rid, str) for rid in contradictory_receipt_ids), "dbip_conflict_refs_invalid")
    observation_time = timestamp(observed_at)
    _require(observation_time <= timestamp(config["observation_cutoff"]), "dbip_observation_after_cutoff")
    allowed = config.get("verified_ip_provenances", {})
    _require(isinstance(allowed, dict), "invalid_verified_ip_provenances")
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
        _require(timestamp(receipt["received_at"]) <= observation_time, "dbip_observation_precedes_receipt")
        source = receipt.get("source_ip")
        source = source if isinstance(source, dict) else {}
        provenance, address = source.get("provenance"), source.get("address")
        provenance = provenance if isinstance(provenance, str) else None
        proven = source.get("status") == "verified" and provenance in allowed
        try:
            _require(isinstance(address, str), "dbip_invalid_address")
            address = str(ipaddress.ip_address(address))
        except (ValueError, InvalidData):
            address, proven = None, False
        context = dataset.lookup(address, provenance_verified=proven, contradictory_evidence=rid in contradictory_receipt_ids)
        identity = {"run": observation_run_id, "receipt_id": rid, "input_receipt_sha256": sha256(json_bytes(receipt)),
                    "binding": dataset.binding, "observed_at": iso(observation_time), "rule_version": DBIP_RULE_VERSION,
                    "contradictory_evidence": rid in contradictory_receipt_ids}
        row = {**context, "observation_id": "dbip_" + sha256(json_bytes(identity)), "provider": "DB-IP",
               "kind": "company", "rule_version": DBIP_RULE_VERSION, "observed_at": iso(observation_time),
               "receipt_ids": [rid], "event_ids": sorted(by_receipt[rid]), "input_ip": address,
               "ip_provenance_verified": proven, "retention_approved": True,
               "dataset_binding": copy.deepcopy(dataset.binding), "input_receipt_sha256": identity["input_receipt_sha256"],
               "evidence_refs": sorted(set(evidence_refs + allowed.get(provenance, [])))}
        # The existing reporting classifier remains the authority for identity.
        row.update(classify_company_observation(row))
        observations.append(row)
    return {"rule_version": DBIP_RULE_VERSION, "observations": observations, "omitted": omitted,
            "receipt_integrity_errors": derived["integrity_errors"],
            "status": "incomplete" if omitted or derived["integrity_errors"] or any(r["status"] == "error" for r in observations) else "complete",
            "scope": SCOPE}
