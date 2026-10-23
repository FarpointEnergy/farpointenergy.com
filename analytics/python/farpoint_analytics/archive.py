"""Create-only archive packages and independent verification/recovery.

These helpers operate on bytes already exported by trusted adapters. They do not
claim that a local package is a verified Drive backup or a transactional export.
"""
from __future__ import annotations

from datetime import datetime, timezone
import io
import os
from pathlib import Path, PurePosixPath
import platform
import sys
import uuid
from zoneinfo import ZoneInfo

from .analysis import iso, json_bytes
from .canonical import InvalidData, sha256, strict_loads


def now():
    return iso(datetime.now(timezone.utc))


def safe_relative(name):
    path = PurePosixPath(name)
    if (not isinstance(name, str) or not name or path.is_absolute() or "\\" in name
            or any(p in {"..", ".", ""} for p in name.split("/"))):
        raise InvalidData("unsafe_archive_path")
    return path


def create_only(path: Path, data: bytes):
    """O_EXCL prevents replacement; fsync precedes success; no delete-on-failure."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    for parent in (path.parent, *path.parents):
        if parent.is_symlink():
            raise InvalidData("symlink_archive_parent")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    try:
        with os.fdopen(fd, "wb", closefd=False) as handle:
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        os.close(fd)
    if path.read_bytes() != data:
        raise InvalidData("archive_readback_mismatch")


def inventory(files):
    return [{"path": name, "bytes": len(data), "sha256": sha256(data)}
            for name, data in sorted(files.items())]


def create_archive(destination, files, metadata, source_completeness):
    """Make a NEW directory; partial artifacts are deliberately retained on failure."""
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False)
    run_id = metadata.get("run_id") or str(uuid.uuid4())
    started = {"schema_version": 1, "run_id": run_id, "state": "started", "created_at": now()}
    create_only(destination / "started.json", json_bytes(started))
    try:
        entries = inventory(files)
        for entry in entries:
            safe_relative(entry["path"])
            if entry["path"].split("/")[0] in {"started.json", "manifest.json", "verification.json", "completed.json"}:
                raise InvalidData("reserved_archive_path")
        for entry in entries:
            create_only(destination / entry["path"], files[entry["path"]])
        manifest = {"schema_version": 1, "run_id": run_id, "created_at": now(),
                    "record_count": len(entries), "total_bytes": sum(x["bytes"] for x in entries),
                    "entries": entries, "metadata": metadata,
                    "source_completeness": source_completeness,
                    "snapshot_claim": "exact listed inputs; not a transactional source snapshot"}
        manifest_bytes = json_bytes(manifest)
        create_only(destination / "manifest.json", manifest_bytes)
        result = verify_archive(destination, require_completion=False)
        create_only(destination / "verification.json", json_bytes({"run_id": run_id, "verified_at": now(), **result}))
        complete = bool(source_completeness) and all(v is True for v in source_completeness.values())
        if complete:
            completion = {"schema_version": 1, "run_id": run_id, "state": "completed",
                          "verified_at": now(), "manifest_sha256": sha256(manifest_bytes),
                          "record_count": len(entries), "total_bytes": manifest["total_bytes"]}
            create_only(destination / "completed.json", json_bytes(completion))
            verify_archive(destination)
        return {"run_id": run_id, "directory": str(destination), "status": "complete" if complete else "partial",
                "manifest_sha256": sha256(manifest_bytes), "record_count": len(entries)}
    except Exception as exc:
        # Categorical failure only; preserve uncertain/partial writes and all original bytes.
        failure = {"run_id": run_id, "state": "failed", "created_at": now(),
                   "reason": str(exc) if isinstance(exc, InvalidData) else type(exc).__name__}
        try:
            create_only(destination / ("failure-" + str(uuid.uuid4()) + ".json"), json_bytes(failure))
        except OSError:
            pass
        raise


def read_verified_archive(directory, require_completion=True):
    directory = Path(directory)
    if directory.is_symlink():
        raise InvalidData("symlink_archive")
    manifest_bytes = (directory / "manifest.json").read_bytes()
    manifest = strict_loads(manifest_bytes)
    if manifest.get("schema_version") != 1 or not isinstance(manifest.get("entries"), list):
        raise InvalidData("unsupported_archive_schema")
    names, total, files = set(), 0, {}
    for entry in manifest["entries"]:
        name = entry["path"]
        safe_relative(name)
        if name in names:
            raise InvalidData("duplicate_manifest_entry")
        names.add(name)
        path = directory / name
        if any(parent.is_symlink() for parent in [path, *path.parents]):
            raise InvalidData("symlink_archive_entry")
        if not path.is_file():
            raise InvalidData("missing_archive_entry")
        data = path.read_bytes()
        if len(data) != entry["bytes"] or sha256(data) != entry["sha256"]:
            raise InvalidData("archive_entry_integrity_failure")
        files[name] = data
        total += len(data)
    if len(names) != manifest.get("record_count") or total != manifest.get("total_bytes"):
        raise InvalidData("archive_count_mismatch")
    if require_completion:
        try:
            completion = strict_loads((directory / "completed.json").read_bytes())
        except FileNotFoundError:
            raise InvalidData("archive_not_completed") from None
        if (completion.get("state") != "completed" or completion.get("run_id") != manifest.get("run_id")
                or completion.get("manifest_sha256") != sha256(manifest_bytes)
                or completion.get("record_count") != len(names) or completion.get("total_bytes") != total
                or not manifest.get("source_completeness")
                or not all(v is True for v in manifest["source_completeness"].values())):
            raise InvalidData("invalid_completion_record")
    return {"verification": {"status": "verified", "record_count": len(names), "total_bytes": total,
                             "manifest_sha256": sha256(manifest_bytes)},
            "manifest": manifest, "manifest_bytes": manifest_bytes, "files": files}


def verify_archive(directory, require_completion=True):
    return read_verified_archive(directory, require_completion)["verification"]


def restore_archive(source, destination):
    """Restore into a new destination. Original remains untouched and readable."""
    source, destination = Path(source), Path(destination)
    snapshot = read_verified_archive(source)
    verified, manifest = snapshot["verification"], snapshot["manifest"]
    # Copy the buffers that were hash-verified, not a second racy filesystem read.
    files = {"restored/" + name: data for name, data in snapshot["files"].items()}
    return create_archive(destination, files, {"restored_from_run_id": manifest["run_id"],
                                              "restored_from_manifest_sha256": verified["manifest_sha256"]},
                          {"verified_source_archive": True})


def source_snapshot():
    package = Path(__file__).parent
    return {"replay/source/farpoint_analytics/" + path.name: path.read_bytes()
            for path in sorted(package.iterdir()) if path.is_file() and path.suffix in {".py", ".json"}}


def runtime_identity():
    return {"python_version": platform.python_version(), "implementation": platform.python_implementation(),
            "platform": platform.platform(), "machine": platform.machine(),
            "executable_sha256": sha256(Path(sys.executable).read_bytes()),
            "external_dependencies": [],
            "offline_runtime_artifacts_verified": False}


def local_window_utc(start_date, end_date, timezone_bytes, expected_sha256):
    """Use archived TZif bytes rather than the machine's mutable timezone database."""
    if sha256(timezone_bytes) != expected_sha256:
        raise InvalidData("timezone_artifact_hash_mismatch")
    zone = ZoneInfo.from_file(io.BytesIO(timezone_bytes), key="America/New_York")
    start = datetime.fromisoformat(start_date).replace(tzinfo=zone)
    end = datetime.fromisoformat(end_date).replace(tzinfo=zone)
    if start.time() != datetime.min.time() or end.time() != datetime.min.time() or start >= end:
        raise InvalidData("invalid_local_date_window")
    return iso(start), iso(end)
