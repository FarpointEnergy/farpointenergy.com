"""Offline network context only. Never turn a network owner into verified employment."""
from __future__ import annotations

from bisect import bisect_right
import ipaddress

from .canonical import InvalidData, sha256


class IPToASN:
    """Parse a snapshotted public-domain IPtoASN TSV; no network requests."""
    def __init__(self, data: bytes, expected_sha256: str):
        if sha256(data) != expected_sha256:
            raise InvalidData("network_dataset_hash_mismatch")
        self.sha256 = expected_sha256
        self.rows = {4: [], 6: []}
        for line in data.decode("utf-8").splitlines():
            if not line.strip():
                continue
            fields = line.split("\t")
            if len(fields) != 5:
                raise InvalidData("invalid_network_dataset_row")
            start, end, asn, country, name = fields
            # IPtoASN combined files use textual IPs; IPv4-only files may use integer bounds.
            a = ipaddress.ip_address(int(start) if start.isdecimal() else start)
            b = ipaddress.ip_address(int(end) if end.isdecimal() else end)
            if a.version != b.version or int(a) > int(b) or not asn.isdecimal():
                raise InvalidData("invalid_network_range")
            self.rows[a.version].append((int(a), int(b), int(asn), country, name))
        self.starts = {}
        for version in (4, 6):
            self.rows[version].sort()
            if any(b[0] <= a[1] for a, b in zip(self.rows[version], self.rows[version][1:])):
                raise InvalidData("overlapping_network_ranges")
            self.starts[version] = [r[0] for r in self.rows[version]]

    def lookup(self, address, provenance_verified=False):
        result = {"provider": "IPtoASN", "dataset_sha256": self.sha256,
                  "employer": None, "identity_category": "unknown",
                  "company_lookup_status": "unavailable", "network_organization": None}
        if provenance_verified is not True:
            result["reason"] = "unverified_original_ip"
            return result
        try:
            if not isinstance(address, str):
                raise ValueError()
            ip = ipaddress.ip_address(address)
        except ValueError:
            result["reason"] = "invalid_ip"
            return result
        index = bisect_right(self.starts[ip.version], int(ip)) - 1
        if index >= 0 and self.rows[ip.version][index][1] >= int(ip):
            _, _, asn, country, name = self.rows[ip.version][index]
            if asn == 0:
                # IPtoASN represents uncovered/unrouted ranges with AS0. Its
                # "Not routed" description is not a network organization.
                result["reason"] = "network_unrouted"
            else:
                result.update(asn=asn, country=country, network_organization=name,
                              identity_category="inferred_network_organization", reason="network_context_not_employer")
        else:
            result["reason"] = "network_unknown"
        return result


def classify_company_observation(observation):
    """Derived label for an already archived, approved-provider observation."""
    category = observation.get("network_category", "unknown")
    company = observation.get("company")
    if (observation.get("status") != "ok" or observation.get("ip_provenance_verified") is not True
            or observation.get("retention_approved") is not True or category != "corporate"
            or not isinstance(company, str) or not company.strip()
            or observation.get("contradictory_evidence")):
        return {"employer": None, "identity_category": "unknown", "observation_id": observation.get("observation_id")}
    return {"employer": None, "possible_company": company,
            "identity_category": "possible_corporate_match",
            "observation_id": observation.get("observation_id")}
