"""Private, create-only offline network context staging and verified replay.

Large dataset bytes never pass through the JavaScript tool transport. All input
bytes, frozen source, successful outputs, and partial failures remain on disk.
An ASN organization is network context only; this helper never identifies an
employer. Hash verification proves retained bytes, not IP provenance semantics
or independent recovery of the operating system/Python runtime.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import sys
import termios
import uuid
import zipfile


MANIFEST_NAME = "ARCHIVE-MANIFEST.json"
FORMAT = "farpoint-network-stage/1"
HEX64 = re.compile(r"[a-f0-9]{64}\Z")
HEX40 = re.compile(r"[a-f0-9]{40}\Z")
MAX_FILE_BYTES = 1024 ** 3
MAX_ARCHIVE_BYTES = 2 * 1024 ** 3
MAX_ENTRIES = 100000
CHUNK = 1024 * 1024


class StageFailure(ValueError):
    def __init__(self, reason, failure_directory=None):
        super().__init__(reason)
        self.failure_directory = str(failure_directory) if failure_directory else None


def _require(condition, reason):
    if not condition:
        raise StageFailure(reason)


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def _loads(data):
    def pairs(values):
        result = {}
        for key, value in values:
            _require(key not in result, "duplicate_json_key")
            result[key] = value
        return result
    def constant(_):
        raise StageFailure("nonfinite_json_number")
    try:
        return json.loads(data, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError, RecursionError) as error:
        if isinstance(error, StageFailure):
            raise
        raise StageFailure("invalid_json") from None


def _absolute(value):
    _require(isinstance(value, (str, Path)), "invalid_absolute_path")
    path = Path(value)
    _require(path.is_absolute() and ".." not in path.parts, "invalid_absolute_path")
    _no_symlinks(path)
    return path


def _no_symlinks(path):
    _require(not any(p.is_symlink() for p in (path, *path.parents)), "symlink_path")


def _name(value):
    _require(isinstance(value, str) and value and "\\" not in value
             and not any(ord(c) < 32 or ord(c) == 127 for c in value), "unsafe_archive_path")
    path = PurePosixPath(value)
    _require(not path.is_absolute() and not re.match(r"^[A-Za-z]:", value)
             and all(p not in ("", ".", "..") for p in value.split("/")), "unsafe_archive_path")
    return path


def _mkdir(path):
    _no_symlinks(path)
    for parent in reversed((path, *path.parents)):
        if parent.exists():
            _require(parent.is_dir(), "parent_not_directory")
        else:
            parent.mkdir(mode=0o700, exist_ok=False)
    _no_symlinks(path)


def _new_file(path):
    _mkdir(path.parent)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0)
    return os.fdopen(os.open(path, flags, 0o600), "wb")


def _signature(info):
    return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _open_regular(path):
    _no_symlinks(path)
    fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0))
    stream = os.fdopen(fd, "rb")
    try:
        _require(stat.S_ISREG(os.fstat(stream.fileno()).st_mode), "not_regular_file")
    except Exception:
        stream.close()
        raise
    return stream


def _file_info(path):
    digest, size = hashlib.sha256(), 0
    with _open_regular(path) as source:
        before = os.fstat(source.fileno())
        while data := source.read(CHUNK):
            digest.update(data)
            size += len(data)
        after = os.fstat(source.fileno())
    _require(_signature(before) == _signature(after) and size == before.st_size,
             "file_changed_during_read")
    return {"bytes": size, "sha256": digest.hexdigest()}


def _write(path, data):
    with _new_file(path) as target:
        target.write(data)
        target.flush()
        os.fsync(target.fileno())
    _require(_file_info(path) == {"bytes": len(data), "sha256": _sha(data)}, "write_readback_mismatch")
    return path


def _descriptor(value):
    _require(isinstance(value, dict) and type(value.get("bytes")) is int
             and 0 <= value["bytes"] <= MAX_FILE_BYTES
             and isinstance(value.get("sha256"), str) and HEX64.fullmatch(value["sha256"]),
             "invalid_file_descriptor")
    return value


def _copy_expected(descriptor, destination):
    _descriptor(descriptor)
    source_path = _absolute(descriptor.get("path"))
    digest, size = hashlib.sha256(), 0
    with _open_regular(source_path) as source, _new_file(destination) as target:
        before = os.fstat(source.fileno())
        while data := source.read(CHUNK):
            target.write(data)
            digest.update(data)
            size += len(data)
            _require(size <= MAX_FILE_BYTES, "file_size_limit")
        target.flush()
        os.fsync(target.fileno())
        after = os.fstat(source.fileno())
    _require(_signature(before) == _signature(after) and size == before.st_size,
             "file_changed_during_copy")
    actual = {"bytes": size, "sha256": digest.hexdigest()}
    _require(actual == {k: descriptor[k] for k in actual}, "input_integrity_mismatch")
    _require(_file_info(destination) == actual, "copy_readback_mismatch")
    return {"path": str(destination), **actual}


def _manifest_entries(value):
    _require(isinstance(value, dict) and isinstance(value.get("files"), list), "invalid_archive_manifest")
    entries, total = {}, 0
    for row in value["files"]:
        _descriptor(row)
        name = row.get("path")
        _name(name)
        _require(name != MANIFEST_NAME and name not in entries, "duplicate_manifest_entry")
        entries[name] = {k: row[k] for k in ("path", "bytes", "sha256")}
        total += row["bytes"]
    _require(len(entries) <= MAX_ENTRIES and total <= MAX_ARCHIVE_BYTES, "archive_size_limit")
    for key in ("file_count", "record_count"):
        _require(key not in value or type(value[key]) is int and value[key] == len(entries), "manifest_count_mismatch")
    for key in ("total_file_bytes", "total_bytes"):
        _require(key not in value or type(value[key]) is int and value[key] == total, "manifest_count_mismatch")
    for name in entries:
        _require(not any(p.as_posix() in entries for p in PurePosixPath(name).parents), "archive_path_collision")
    return entries


def _verify_zip(path, manifest_hash, selected=None, destination=None, extract_all=False):
    """Hash every ZIP entry; optionally retain selected/all exact members."""
    _require(isinstance(manifest_hash, str) and HEX64.fullmatch(manifest_hash), "manifest_hash_required")
    selected = set(selected or [])
    for name in selected:
        _name(name)
    before = _file_info(path)
    with _open_regular(path) as source, zipfile.ZipFile(source) as archive:
        infos, names, declared_total = {}, set(), 0
        _require(len(archive.infolist()) <= MAX_ENTRIES + 1000, "archive_size_limit")
        for info in archive.infolist():
            name = info.filename[:-1] if info.is_dir() else info.filename
            _name(name)
            _require(info.orig_filename == info.filename and name not in names, "duplicate_archive_entry")
            names.add(name)
            kind = stat.S_IFMT(info.external_attr >> 16)
            _require(kind in ((0, stat.S_IFDIR) if info.is_dir() else (0, stat.S_IFREG)), "unsupported_archive_entry")
            _require(not info.flag_bits & 1, "encrypted_archive_unsupported")
            _require(0 <= info.file_size <= MAX_FILE_BYTES, "archive_size_limit")
            declared_total += info.file_size
            _require(declared_total <= MAX_ARCHIVE_BYTES, "archive_size_limit")
            if not info.is_dir():
                infos[name] = info
        _require(MANIFEST_NAME in infos and infos[MANIFEST_NAME].file_size <= 32 * CHUNK, "missing_archive_manifest")
        manifest_bytes = archive.read(infos[MANIFEST_NAME])
        _require(_sha(manifest_bytes) == manifest_hash, "manifest_integrity_mismatch")
        manifest = _loads(manifest_bytes)
        entries = _manifest_entries(manifest)
        _require(set(infos) == set(entries) | {MANIFEST_NAME}, "archive_entry_set_mismatch")
        _require(selected <= set(entries), "selected_member_missing")
        for name, entry in entries.items():
            info = infos[name]
            _require(info.file_size == entry["bytes"], "archive_member_integrity_mismatch")
            target = None
            try:
                if extract_all or name in selected:
                    _require(destination is not None, "missing_extract_destination")
                    target = _new_file(destination / _name(name))
                digest, count = hashlib.sha256(), 0
                with archive.open(info) as content:
                    while data := content.read(CHUNK):
                        digest.update(data)
                        count += len(data)
                        if target:
                            target.write(data)
                if target:
                    target.flush()
                    os.fsync(target.fileno())
                _require(count == entry["bytes"] and digest.hexdigest() == entry["sha256"],
                         "archive_member_integrity_mismatch")
            finally:
                if target:
                    target.close()
            if extract_all or name in selected:
                _require(_file_info(destination / name) == {k: entry[k] for k in ("bytes", "sha256")},
                         "extract_readback_mismatch")
        if destination is not None:
            _write(destination / MANIFEST_NAME, manifest_bytes)
    _require(_file_info(path) == before, "archive_changed_during_verification")
    return manifest, entries


def _validate_provenance(provenance, dataset_entry, entries, member, evidence_members):
    _require(isinstance(provenance, dict) and provenance.get("retention_approved") is True
             and provenance.get("dataset_sha256") == dataset_entry["sha256"]
             and isinstance(provenance.get("source_url"), str) and provenance["source_url"]
             and isinstance(provenance.get("license"), str) and provenance["license"],
             "invalid_dataset_provenance")
    source_evidence = provenance.get("source_evidence", [])
    _require(isinstance(source_evidence, list), "invalid_source_evidence")
    source_names = set()
    for item in source_evidence:
        _descriptor(item)
        relative = _name(item.get("path"))
        name = (PurePosixPath(member).parent / relative).as_posix()
        _require(item.get("complete") is True and name in entries
                 and all(entries[name][key] == item[key] for key in ("bytes", "sha256")),
                 "source_evidence_integrity_mismatch")
        source_names.add(name)
    _require(not source_evidence or set(evidence_members) <= source_names, "unbound_source_evidence")


def _validate_proof_refs(config, evidence):
    allowed = config.get("verified_ip_provenances", {})
    _require(isinstance(allowed, dict), "invalid_verified_ip_provenances")
    refs = set()
    for item in evidence:
        ref = item.get("ref")
        _require(isinstance(ref, str) and ref.strip() and len(ref) <= 2048
                 and not any(ord(c) < 32 for c in ref) and ref not in refs and item["bytes"] > 0,
                 "invalid_provenance_evidence_ref")
        refs.add(ref)
    for tag, required in allowed.items():
        _require(isinstance(tag, str) and tag and tag != "unverified" and isinstance(required, list)
                 and required and all(isinstance(ref, str) and ref in refs for ref in required),
                 "unretained_provenance_evidence")


def _validate_cloudflare_source_scope(config, receipts):
    """Recheck source-version scope during generation and archived replay.

    The authenticated JS adapter additionally compares account, bucket and host
    against its fixed private acquisition settings. This function never changes
    a receipt or treats an unavailable/unverified source as verified.
    """
    tag = "cloudflare_direct_edge_v1"
    required = config.get("verified_ip_provenances", {}).get(tag)
    if required is None:
        return
    scope = config.get("verified_ip_source_scope")
    _require(isinstance(scope, dict) and type(scope.get("schema_version")) is int and scope["schema_version"] == 1
             and scope.get("provenance") == tag, "network_source_scope_unverified")
    versions, refs = scope.get("collector_versions"), scope.get("evidence_refs")
    _require(isinstance(scope.get("hostname"), str)
             and re.fullmatch(r"[a-z0-9][a-z0-9.-]{1,251}[a-z0-9]", scope["hostname"])
             and isinstance(scope.get("cloudflare_account_id"), str)
             and re.fullmatch(r"[a-f0-9]{32}", scope["cloudflare_account_id"])
             and isinstance(scope.get("cloudflare_bucket_name"), str)
             and re.fullmatch(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", scope["cloudflare_bucket_name"])
             and isinstance(versions, list) and versions
             and all(isinstance(v, str) and re.fullmatch(r"farpoint-cloudflare-collector/1\.0\.0\+[a-f0-9]{64}", v) for v in versions)
             and len(set(versions)) == len(versions)
             and isinstance(required, list) and required and all(isinstance(r, str) for r in required)
             and len(set(required)) == len(required)
             and isinstance(refs, list) and all(isinstance(r, str) for r in refs)
             and len(set(refs)) == len(refs) and set(refs) == set(required),
             "network_source_scope_unverified")
    for receipt in receipts:
        source = receipt.get("source_ip") if isinstance(receipt, dict) else None
        if isinstance(source, dict) and source.get("status") == "verified" and source.get("provenance") == tag:
            _require(receipt.get("collector_version") in versions, "network_source_version_unreviewed")


OFFLINE_RUNNER = r'''import argparse, json, pathlib, socket, sys
sys.dont_write_bytecode = True
def forbidden(*args, **kwargs):
    raise RuntimeError("offline_socket_forbidden")
socket.socket = forbidden
socket.create_connection = forbidden
socket.getaddrinfo = forbidden
def audit(event, args):
    if event.startswith("socket."):
        forbidden()
sys.addaudithook(audit)
stage = pathlib.Path(sys.argv[2])
sys.path.insert(0, str(stage / "frozen-source"))
from farpoint_analytics import __main__ as cli
from farpoint_analytics.analysis import json_bytes
from farpoint_analytics.archive import read_verified_archive, source_snapshot
from farpoint_analytics.canonical import InvalidData, sha256, strict_loads
from farpoint_analytics.enrichment import IPToASN
from farpoint_analytics.network import build_network_observations
binding = strict_loads((stage / "stage.json").read_bytes())
try:
    if sys.argv[1] == "run":
        result = cli.network_context(argparse.Namespace(
            receipts=str(stage / "network-inputs/receipts.json"),
            config=str(stage / "network-inputs/config.json"),
            dataset=str(stage / "dataset-members" / binding["dataset_member"]),
            dataset_provenance=str(stage / "dataset-members" / binding["provenance_member"]),
            dataset_sha256=binding["dataset_sha256"], observed_at=binding["observed_at"],
            run_id=binding["run_id"], code_commit=binding["code_commit"],
            output=str(stage / "network-run")))
        if result["status"] != "complete" or result["network_context_status"] != "complete":
            raise InvalidData("network_receipt_integrity_incomplete")
    elif sys.argv[1] != "verify":
        raise InvalidData("unsupported_offline_operation")
    snapshot = read_verified_archive(stage / "network-run")
    files, metadata = snapshot["files"], snapshot["manifest"]["metadata"]
    for name, data in source_snapshot().items():
        if files.get(name) != data:
            raise InvalidData("archived_source_mismatch")
    for key, expected in (("kind", "network_context"), ("code_commit", binding["code_commit"]),
                          ("observation_run_id", binding["run_id"]),
                          ("observed_at", binding["observed_at"]),
                          ("dataset_sha256", binding["dataset_sha256"])):
        if metadata.get(key) != expected:
            raise InvalidData("network_metadata_mismatch")
    for name, path in {
        "inputs/receipts.json": stage / "network-inputs/receipts.json",
        "inputs/config.json": stage / "network-inputs/config.json",
        "inputs/dataset.tsv": stage / "dataset-members" / binding["dataset_member"],
        "inputs/dataset-provenance.json": stage / "dataset-members" / binding["provenance_member"],
    }.items():
        if files[name] != path.read_bytes():
            raise InvalidData("network_input_mismatch")
    observations = build_network_observations(
        strict_loads(files["inputs/receipts.json"]), strict_loads(files["inputs/config.json"]),
        IPToASN(files["inputs/dataset.tsv"], binding["dataset_sha256"]),
        observed_at=binding["observed_at"], observation_run_id=binding["run_id"],
        evidence_refs=[f"network-context:{binding['run_id']}:inputs/dataset.tsv",
                       f"network-context:{binding['run_id']}:inputs/dataset-provenance.json",
                       f"network-context:{binding['run_id']}:inputs/receipts.json"],
        retention_approved=True)
    if observations["status"] != "complete" or observations["receipt_integrity_errors"]:
        raise InvalidData("network_receipt_integrity_incomplete")
    if (json_bytes(observations) != files["outputs/network-context.json"] or
            json_bytes(observations["observations"]) != files["outputs/company-observations.json"]):
        raise InvalidData("network_replay_mismatch")
    result = {"status":"verified", "observations_match":True,
              "observations_sha256":sha256(files["outputs/company-observations.json"]),
              "observations":len(observations["observations"]),
              "archived_source_used":True,"python_socket_calls_blocked":True,
              "independent_os_runtime_recovery":False}
    print(json_bytes(result).decode())
except Exception as error:
    reason = str(error) if isinstance(error, InvalidData) else type(error).__name__
    print(json.dumps({"status":"failed", "reason":reason}))
    raise SystemExit(1)
'''


def _freeze(stage, repository):
    package = _absolute(repository) / "analytics/python/farpoint_analytics"
    _no_symlinks(package)
    _require(package.is_dir(), "missing_analysis_source")
    paths = sorted(p for p in package.iterdir() if p.suffix in (".py", ".json"))
    _require(paths and any(p.name == "__main__.py" for p in paths), "missing_analysis_source")
    for path in paths:
        _copy_expected({"path": str(path), **_file_info(path)}, stage / "frozen-source/farpoint_analytics" / path.name)
    here = Path(__file__).absolute()
    _copy_expected({"path": str(here), **_file_info(here)}, stage / "stage-source/network_stage.py")
    _write(stage / "stage-source/offline-runner.py", OFFLINE_RUNNER.encode())


def _offline(stage, operation, log_directory):
    _require((stage / "stage-source/offline-runner.py").read_bytes() == OFFLINE_RUNNER.encode(),
             "offline_runner_mismatch")
    # -I excludes PYTHONPATH/user site packages; frozen package is inserted by
    # the retained runner. Socket guards block Python network calls, not a VM.
    command = [sys.executable, "-I", "-B", str(stage / "stage-source/offline-runner.py"), operation, str(stage)]
    _write(log_directory / "command.json", _json({"argv": command, "python_socket_calls_blocked": True}))
    with _new_file(log_directory / "stdout.json") as stdout, _new_file(log_directory / "stderr.log") as stderr:
        result = subprocess.run(command, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                check=False, timeout=600, env={"PATH": os.defpath, "LANG": "C.UTF-8"})
        stdout.flush(); os.fsync(stdout.fileno())
        stderr.flush(); os.fsync(stderr.fileno())
    _write(log_directory / "exit.json", _json({"returncode": result.returncode}))
    _require(result.returncode == 0, "offline_network_stage_failed")
    value = _loads((log_directory / "stdout.json").read_bytes())
    _require(isinstance(value, dict) and value.get("status") == "verified"
             and value.get("observations_match") is True, "offline_network_stage_unverified")
    return value


def _all_files(root):
    result = []
    for directory, dirs, files in os.walk(root, followlinks=False):
        for name in dirs:
            _no_symlinks(Path(directory) / name)
        for name in files:
            path = Path(directory) / name
            _no_symlinks(path)
            _require(stat.S_ISREG(path.lstat().st_mode), "unsupported_stage_entry")
            _name(path.relative_to(root).as_posix())
            result.append(path)
    return sorted(result)


def _pack(stage, output):
    _require(not output.is_relative_to(stage), "archive_inside_source")
    paths = _all_files(stage)
    signatures = {str(p): _signature(p.lstat()) for p in paths}
    entries = [{"path": p.relative_to(stage).as_posix(), **_file_info(p)} for p in paths]
    _require(all(e["path"] != MANIFEST_NAME for e in entries), "reserved_manifest_path")
    manifest = {"format": FORMAT, "files": entries, "file_count": len(entries),
                "total_file_bytes": sum(e["bytes"] for e in entries),
                "snapshot_claim": "Exact listed files; not a transactional source snapshot."}
    manifest_bytes = _json(manifest)
    with _new_file(output) as target:
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as archive:
            for path, entry in zip(paths, entries):
                with _open_regular(path) as source, archive.open(entry["path"], "w", force_zip64=True) as member:
                    digest, count = hashlib.sha256(), 0
                    while data := source.read(CHUNK):
                        digest.update(data); count += len(data); member.write(data)
                _require(count == entry["bytes"] and digest.hexdigest() == entry["sha256"], "stage_changed_during_pack")
            _require(_all_files(stage) == paths
                     and all(_signature(p.lstat()) == signatures[str(p)] for p in paths),
                     "stage_changed_during_pack")
            archive.writestr(MANIFEST_NAME, manifest_bytes)
        target.flush(); os.fsync(target.fileno())
    info = _file_info(output)
    _verify_zip(output, _sha(manifest_bytes))
    return {"path": str(output), **info, "manifest_sha256": _sha(manifest_bytes), "record_count": len(entries)}


def _begin(root, prefix, request):
    root = _absolute(root)
    _mkdir(root)
    stage = root / (prefix + "-" + str(uuid.uuid4()))
    stage.mkdir(mode=0o700, exist_ok=False)
    _write(stage / "request.json", _json(request))
    return stage


def _private_root(root, repository_root):
    root, repository = _absolute(root), _absolute(repository_root)
    _require(not root.is_relative_to(repository), "private_root_inside_repository")
    return root


def _fail(stage, error):
    reason = str(error) if isinstance(error, StageFailure) else type(error).__name__
    try:
        _write(stage / ("failure-" + str(uuid.uuid4()) + ".json"),
               _json({"status": "failed", "reason": reason}))
    except Exception:
        pass
    raise StageFailure(reason, stage) from None


def _dataset_descriptor(value):
    _descriptor(value)
    _require(value.get("manifest_name", MANIFEST_NAME) == MANIFEST_NAME, "unsupported_manifest_name")
    _require(isinstance(value.get("expected_manifest_sha256"), str)
             and HEX64.fullmatch(value["expected_manifest_sha256"]), "manifest_hash_required")
    for key in ("dataset_member", "provenance_member"):
        _name(value.get(key))
    evidence = value.get("evidence_members", [])
    _require(isinstance(evidence, list), "invalid_evidence_members")
    names = [value["dataset_member"], value["provenance_member"], *evidence]
    for name in names:
        _name(name)
    _require(len(names) == len(set(names)), "duplicate_selected_member")
    return names


def _summary(observations, receipt_count):
    _require(isinstance(observations, list), "invalid_network_observations")
    forbidden = {"company", "company_name", "company_domain", "possible_company", "employer_name"}
    for item in observations:
        _require(isinstance(item, dict) and item.get("kind") == "network" and item.get("provider") == "IPtoASN"
                 and item.get("employer", "missing") is None and not forbidden.intersection(item),
                 "unexpected_company_identity_claim")
    return {"receipts": receipt_count, "observations": len(observations),
            "with_network_context": sum(bool(o.get("network_organization")) for o in observations),
            "unknown_network": sum(not o.get("network_organization") for o in observations),
            "verified_employers": 0, "employer_identity_status": "unknown",
            "scope": "Offline IPtoASN network ownership only; no employer identity."}


def run_stage(request, root, repository_root):
    root = _private_root(root, repository_root)
    stage = _begin(root, "network-stage", request)
    try:
        _require(isinstance(request, dict), "invalid_request")
        config, commit, run_id = request.get("config"), request.get("code_commit"), request.get("run_id")
        _require(isinstance(config, dict), "invalid_config")
        _require(isinstance(commit, str) and HEX40.fullmatch(commit), "exact_commit_required")
        _require(config.get("execution_code_commit", commit) == commit, "execution_commit_mismatch")
        _require(isinstance(run_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{8,100}", run_id), "invalid_run_id")
        dataset = request.get("dataset_archive")
        names = _dataset_descriptor(dataset)
        _copy_expected(dataset, stage / "inputs/original-dataset.zip")
        _, entries = _verify_zip(stage / "inputs/original-dataset.zip", dataset["expected_manifest_sha256"],
                                 names, stage / "dataset-members")
        provenance = _loads((stage / "dataset-members" / dataset["provenance_member"]).read_bytes())
        _validate_provenance(provenance, entries[dataset["dataset_member"]], entries,
                             dataset["provenance_member"], dataset.get("evidence_members", []))
        descriptors = request.get("receipts")
        proof_descriptors = request.get("provenance_evidence", [])
        _require(isinstance(descriptors, list) and isinstance(proof_descriptors, list), "invalid_input_lists")
        retained_receipts, retained_proof = [], []
        for index, descriptor in enumerate(descriptors):
            relative = f"inputs/receipts/{index:08d}.json"
            info = _copy_expected(descriptor, stage / relative)
            retained_receipts.append({**info, "path": relative})
        for index, descriptor in enumerate(proof_descriptors):
            relative = f"inputs/provenance-evidence/{index:08d}.bin"
            info = _copy_expected(descriptor, stage / relative)
            retained_proof.append({**info, "path": relative, "ref": descriptor.get("ref")})
        _validate_proof_refs(config, retained_proof)
        receipts = [_loads((stage / item["path"]).read_bytes()) for item in retained_receipts]
        _require(all(isinstance(r, dict) for r in receipts), "invalid_receipt_shape")
        _validate_cloudflare_source_scope(config, receipts)
        _write(stage / "network-inputs/receipts.json", _json(receipts))
        _write(stage / "network-inputs/config.json", _json(config))
        binding = {"format": FORMAT, "run_id": run_id, "code_commit": commit,
                   "observed_at": request.get("observed_at", config.get("observation_cutoff")),
                   "dataset_member": dataset["dataset_member"], "provenance_member": dataset["provenance_member"],
                   "dataset_sha256": entries[dataset["dataset_member"]]["sha256"],
                   "dataset_archive": {**dataset, "path": "inputs/original-dataset.zip"},
                   "receipts": retained_receipts, "provenance_evidence": retained_proof}
        _write(stage / "stage.json", _json(binding))
        _freeze(stage, repository_root)
        verified = _offline(stage, "run", stage / "logs/run")
        observation_bytes = (stage / "network-run/outputs/company-observations.json").read_bytes()
        observations = _loads(observation_bytes)
        summary = _summary(observations, len(receipts))
        _require(_sha(observation_bytes) == verified["observations_sha256"], "observations_integrity_mismatch")
        _write(stage / "stage-completed.json", _json({"status": "complete", "summary": summary,
                                                     "observations_sha256": _sha(observation_bytes)}))
        archive = _pack(stage, _absolute(root) / (stage.name + ".zip"))
        return {"status": "complete", "archive": archive, "observations": observations,
                "observations_base64": base64.b64encode(observation_bytes).decode(),
                "observations_sha256": _sha(observation_bytes), "summary": summary,
                "run_directory": str(stage), "python_socket_calls_blocked": True,
                "independent_os_runtime_recovery": False}
    except Exception as error:
        _fail(stage, error)


def _verify_retained_inputs(stage, binding, checks):
    _require(binding.get("format") == FORMAT, "invalid_stage_format")
    original_request = _loads((stage / "request.json").read_bytes())
    _require(isinstance(original_request, dict), "invalid_original_request")
    dataset = binding["dataset_archive"]
    _dataset_descriptor(dataset)
    _require(dataset["path"] == "inputs/original-dataset.zip", "invalid_retained_dataset_path")
    _require({**dataset, "path": original_request["dataset_archive"]["path"]} == original_request["dataset_archive"],
             "dataset_descriptor_mismatch")
    _require(_file_info(stage / dataset["path"]) == {k: dataset[k] for k in ("bytes", "sha256")},
             "retained_dataset_integrity_mismatch")
    _, entries = _verify_zip(stage / dataset["path"], dataset["expected_manifest_sha256"],
                             _dataset_descriptor(dataset), checks / "dataset-members")
    for name in _dataset_descriptor(dataset):
        _require(_file_info(stage / "dataset-members" / name) == _file_info(checks / "dataset-members" / name),
                 "retained_dataset_member_mismatch")
    _require(binding["dataset_member"] == dataset["dataset_member"]
             and binding["provenance_member"] == dataset["provenance_member"]
             and binding["dataset_sha256"] == entries[dataset["dataset_member"]]["sha256"], "dataset_binding_mismatch")
    provenance = _loads((stage / "dataset-members" / dataset["provenance_member"]).read_bytes())
    _validate_provenance(provenance, entries[dataset["dataset_member"]], entries,
                         dataset["provenance_member"], dataset.get("evidence_members", []))
    config = _loads((stage / "network-inputs/config.json").read_bytes())
    _require(config == original_request["config"] and binding["code_commit"] == original_request["code_commit"]
             and binding["run_id"] == original_request["run_id"]
             and binding["observed_at"] == original_request.get("observed_at", config.get("observation_cutoff")),
             "retained_request_mismatch")
    _require(isinstance(binding["code_commit"], str) and HEX40.fullmatch(binding["code_commit"])
             and config.get("execution_code_commit", binding["code_commit"]) == binding["code_commit"],
             "execution_commit_mismatch")
    for key in ("receipts", "provenance_evidence"):
        originals = original_request.get(key, [])
        retained = binding[key]
        _require(isinstance(retained, list) and len(originals) == len(retained), "retained_input_count_mismatch")
        for index, item in enumerate(retained):
            _descriptor(item)
            expected_path = (f"inputs/receipts/{index:08d}.json" if key == "receipts"
                             else f"inputs/provenance-evidence/{index:08d}.bin")
            _require(item["path"] == expected_path and all(item[k] == originals[index][k] for k in ("bytes", "sha256")),
                     "retained_input_descriptor_mismatch")
            _require(_file_info(stage / item["path"]) == {k: item[k] for k in ("bytes", "sha256")},
                     "retained_input_integrity_mismatch")
            if key == "provenance_evidence":
                _require(item["ref"] == originals[index]["ref"], "retained_evidence_ref_mismatch")
    _validate_proof_refs(config, binding["provenance_evidence"])
    receipts = [_loads((stage / item["path"]).read_bytes()) for item in binding["receipts"]]
    _require(_json(receipts) == (stage / "network-inputs/receipts.json").read_bytes(), "merged_receipt_mismatch")
    _validate_cloudflare_source_scope(config, receipts)


def verify_stage(request, root, repository_root=None):
    # Library callers can supply their checkout explicitly; the normal module
    # location also protects direct calls from writing private data into Git.
    root = _private_root(root, repository_root or Path(__file__).absolute().parents[2])
    verification = _begin(root, "network-verify", request)
    try:
        archive = request.get("archive")
        _copy_expected(archive, verification / "downloaded-stage.zip")
        restored = verification / "restored"
        manifest, _ = _verify_zip(verification / "downloaded-stage.zip", request.get("expected_manifest_sha256"),
                                   destination=restored, extract_all=True)
        _require(manifest.get("format") == FORMAT, "invalid_stage_format")
        binding = _loads((restored / "stage.json").read_bytes())
        _verify_retained_inputs(restored, binding, verification / "checks")
        verified = _offline(restored, "verify", verification / "logs/replay")
        data = (restored / "network-run/outputs/company-observations.json").read_bytes()
        observations = _loads(data)
        summary = _summary(observations, len(binding["receipts"]))
        _require(verified["observations_sha256"] == _sha(data), "observations_integrity_mismatch")
        completed = _loads((restored / "stage-completed.json").read_bytes())
        _require(completed == {"status": "complete", "summary": summary, "observations_sha256": _sha(data)},
                 "stage_completion_mismatch")
        result = {**verified, "status": "verified", "observations_match": True,
                  "observations_sha256": _sha(data), "summary": summary,
                  "manifest_sha256": request["expected_manifest_sha256"],
                  "record_count": manifest["file_count"], "run_directory": str(verification)}
        _write(verification / "verified.json", _json(result))
        return result
    except Exception as error:
        _fail(verification, error)


def transport_response(root, request, value):
    data = json.dumps(value, ensure_ascii=False, allow_nan=False).encode("utf-8")
    if request.get("stream_results") is not True or len(data) <= 16384:
        return data.decode()
    name = "bridge-results/" + str(uuid.uuid4()) + ".json"
    _write(_absolute(root) / name, data)
    return json.dumps({"status": "ok", "result_stream": {
        "path": name, "bytes": len(data), "sha256": _sha(data), "encoding": "utf-8-json"}})


def read_result_chunk(root, request):
    name, offset, maximum = request.get("path"), request.get("offset"), request.get("max_bytes", 8192)
    _require(isinstance(name, str) and re.fullmatch(r"bridge-results/[a-f0-9-]{36}\.json", name), "invalid_result_path")
    _require(type(offset) is int and offset >= 0 and type(maximum) is int and 1 <= maximum <= 8192,
             "invalid_result_range")
    with _open_regular(_absolute(root) / name) as source:
        size = os.fstat(source.fileno()).st_size
        _require(offset < size, "invalid_result_offset")
        source.seek(offset)
        data = source.read(maximum)
    return {"path": name, "offset": offset, "bytes": len(data), "total_bytes": size,
            "base64": base64.b64encode(data).decode(), "sha256": _sha(data)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True)
    parser.add_argument("--repository", required=True)
    args = parser.parse_args()
    if sys.stdin.isatty():
        settings = termios.tcgetattr(sys.stdin.fileno())
        settings[3] &= ~(termios.ECHO | termios.ICANON)
        termios.tcsetattr(sys.stdin.fileno(), termios.TCSANOW, settings)
    print("READY", flush=True)
    try:
        line = sys.stdin.readline(32 * CHUNK + 1)
        _require(len(line.encode()) <= 32 * CHUNK, "request_size_limit")
        request = _loads(line)
        _require(isinstance(request, dict), "invalid_request")
        _private_root(args.root, args.repository)
        if request.get("op") == "run":
            value = {"status": "ok", "result": run_stage(request, args.root, args.repository)}
        elif request.get("op") == "verify":
            value = {"status": "ok", "result": verify_stage(request, args.root, args.repository)}
        elif request.get("op") == "read_result":
            value = {"status": "ok", **read_result_chunk(args.root, request)}
        else:
            raise StageFailure("unsupported_operation")
        print(transport_response(args.root, request, value), flush=True)
        return 0
    except Exception as error:
        reason = str(error) if isinstance(error, StageFailure) else type(error).__name__
        value = {"status": "failed", "reason": reason}
        if isinstance(error, StageFailure) and error.failure_directory:
            value["failure_directory"] = error.failure_directory
        print(json.dumps(value), flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
