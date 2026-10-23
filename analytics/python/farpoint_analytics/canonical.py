"""Canonical event encoding v1. No schema or business decisions live here."""
from __future__ import annotations

from decimal import Decimal, DecimalException
import hashlib
import json
from typing import Any

MAX_SAFE_INTEGER = 9007199254740991


class InvalidData(ValueError):
    """Safe categorical error; never include untrusted input in its message."""


def _pairs(items):
    result = {}
    for key, value in items:
        if key in result:
            raise InvalidData("duplicate_json_key")
        result[key] = value
    return result


def _bad_constant(_value):
    raise InvalidData("nonstandard_number")


def strict_loads(data: bytes | str) -> Any:
    try:
        text = data.decode("utf-8", errors="strict") if isinstance(data, bytes) else data
        return json.loads(text, object_pairs_hook=_pairs, parse_float=Decimal,
                          parse_constant=_bad_constant)
    except InvalidData:
        raise
    except (UnicodeError, ValueError, RecursionError, TypeError, DecimalException):
        raise InvalidData("malformed_json_or_utf8") from None


def normalize(value: Any) -> Any:
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, str):
        try:
            value.encode("utf-8", errors="strict")
        except UnicodeError:
            raise InvalidData("unpaired_surrogate") from None
        return value
    if isinstance(value, int):
        if abs(value) > MAX_SAFE_INTEGER:
            raise InvalidData("unsafe_integer")
        return value
    if isinstance(value, (float, Decimal)):
        try:
            number = Decimal(str(value))
            if not number.is_finite():
                raise InvalidData("nonintegral_number")
            # Check magnitude BEFORE int(): a tiny hostile JSON exponent must
            # never request an enormous integer allocation.
            if number.copy_abs() > MAX_SAFE_INTEGER:
                raise InvalidData("unsafe_integer")
            if number != number.to_integral_value():
                raise InvalidData("nonintegral_number")
            integer = int(number)
        except (ValueError, OverflowError, DecimalException):
            raise InvalidData("invalid_number") from None
        return integer
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, dict):
        if any(not isinstance(key, str) or not key.isascii() for key in value):
            raise InvalidData("non_ascii_schema_key")
        return {key: normalize(value[key]) for key in sorted(value)}
    raise InvalidData("unsupported_type")


def canonical_bytes(value: Any) -> bytes:
    try:
        return json.dumps(normalize(value), ensure_ascii=False, sort_keys=True,
                          separators=(",", ":"), allow_nan=False).encode("utf-8")
    except (RecursionError, UnicodeError):
        raise InvalidData("invalid_structure") from None


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def logical_hash(value: Any) -> str:
    return sha256(canonical_bytes(value))
