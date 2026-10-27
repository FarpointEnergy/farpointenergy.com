"""Synthetic DB-IP-shaped test values; no purchased data or visitor addresses."""
from __future__ import annotations

import copy
import ipaddress


def corporate_record(**traits):
    record = {
        "traits": {
            "organization": "SYNTHETIC Example Manufacturing",
            "isp": "SYNTHETIC Transit Provider",
            "connection_type": "Corporate",
            "user_type": "business",
            "is_anycast": False,
        },
        "synthetic_fixture": True,
    }
    record["traits"].update(copy.deepcopy(traits))
    return record


def google_shape_record():
    """Official sample's risk combination, with wholly synthetic organization."""
    return corporate_record(
        organization="SYNTHETIC Hosting Operator",
        isp="SYNTHETIC Hosting Operator",
        connection_type="Corporate",
        user_type="hosting",
        is_anycast=True,
    )


SYNTHETIC_DATABASE_TYPE = "DBIP-ISP-SYNTHETIC-TEST-ONLY"
SYNTHETIC_BUILD_EPOCH = 1760000000


def _mmdb_header(type_number, size):
    if size < 29:
        code, extra = size, b""
    elif size < 285:
        code, extra = 29, bytes([size - 29])
    elif size < 65821:
        code, extra = 30, (size - 285).to_bytes(2, "big")
    else:
        raise ValueError("Synthetic fixture value is too large")
    if type_number < 8:
        return bytes([(type_number << 5) | code]) + extra
    return bytes([code, type_number - 7]) + extra


def _mmdb_value(value):
    """Small deterministic subset of the documented MMDB v2 value encoding."""
    if isinstance(value, bool):
        return _mmdb_header(14, int(value))
    if isinstance(value, str):
        raw = value.encode("utf-8")
        return _mmdb_header(2, len(raw)) + raw
    if isinstance(value, int) and 0 <= value < 2**32:
        raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
        return _mmdb_header(6, len(raw)) + raw
    if isinstance(value, list):
        return _mmdb_header(11, len(value)) + b"".join(map(_mmdb_value, value))
    if isinstance(value, dict) and all(isinstance(k, str) for k in value):
        return _mmdb_header(7, len(value)) + b"".join(
            _mmdb_value(k) + _mmdb_value(value[k]) for k in sorted(value))
    raise ValueError("Unsupported synthetic MMDB fixture value")


def synthetic_mmdb(records=None, *, database_type=SYNTHETIC_DATABASE_TYPE,
                   build_epoch=SYNTHETIC_BUILD_EPOCH):
    """Create a real tiny MMDB with exact documentation-address leaves only.

    This is a test writer, not a general database implementation. The IPv6 tree
    stores IPv4 beneath 96 zero bits, as the standard reader's IPv4 start-node
    traversal expects. All other branches return no record. No licensed database
    records are embedded or fabricated as a real purchased edition.
    """
    if records is None:
        records = {"192.0.2.1": corporate_record(),
                   "2001:db8::1": corporate_record(organization="SYNTHETIC IPv6 Power Plant")}
    tree, payloads = {}, []
    for address, record in sorted(records.items()):
        ip = ipaddress.ip_address(address)
        allowed = (ip in ipaddress.ip_network("192.0.2.0/24") if ip.version == 4
                   else ip in ipaddress.ip_network("2001:db8::/32"))
        if not allowed:
            raise ValueError("Only documentation addresses belong in this fixture")
        node = tree
        for bit in f"{int(ip):0128b}":
            node = node.setdefault(int(bit), {})
        node["record"] = len(payloads)
        payloads.append(_mmdb_value(record))
    nodes, indexes = [], {}

    def visit(node):
        if "record" in node:
            return
        indexes[id(node)] = len(nodes)
        nodes.append(node)
        for bit in (0, 1):
            if bit in node:
                visit(node[bit])

    visit(tree)
    count = len(nodes)
    offsets, running = [], 16
    for payload in payloads:
        offsets.append(running)
        running += len(payload)
    encoded_nodes = bytearray()
    for node in nodes:
        for bit in (0, 1):
            child = node.get(bit)
            pointer = (count if child is None else
                       count + offsets[child["record"]] if "record" in child else
                       indexes[id(child)])
            encoded_nodes.extend(pointer.to_bytes(3, "big"))
    metadata = {
        "binary_format_major_version": 2, "binary_format_minor_version": 0,
        "build_epoch": build_epoch, "database_type": database_type,
        "description": {"en": "SYNTHETIC TEST ONLY; no commercial DB-IP records"},
        "ip_version": 6, "languages": ["en"], "node_count": count, "record_size": 24,
    }
    return (bytes(encoded_nodes) + b"\x00" * 16 + b"".join(payloads)
            + b"\xab\xcd\xefMaxMind.com" + _mmdb_value(metadata))
