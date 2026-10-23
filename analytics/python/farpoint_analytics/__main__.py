"""Offline CLI. Source adapters/export permissions are outside this process."""
from __future__ import annotations

import argparse
from pathlib import Path
import platform
import re
import sys

from .analysis import analyze, json_bytes
from .archive import create_archive, read_verified_archive, restore_archive, runtime_identity, source_snapshot, verify_archive
from .canonical import InvalidData, sha256, strict_loads


def read_json(path):
    data = Path(path).read_bytes()
    return strict_loads(data), data


def run(args):
    files, values = {}, {}
    for name in ("receipts", "messages", "classifications", "resolutions", "company_observations", "config"):
        path = getattr(args, name, None)
        value, data = read_json(path) if path else ([], b"[]")
        values[name] = value
        files["inputs/" + name + ".json"] = data
    config = values["config"]
    if not re.fullmatch(r"[0-9a-f]{40}", args.code_commit) and config.get("mode") != "isolated_fixture":
        raise InvalidData("production_requires_exact_git_commit")
    result = analyze(values["receipts"], values["messages"], values["classifications"], config,
                     values["resolutions"], values["company_observations"])
    files["outputs/report.json"] = json_bytes(result)
    files.update(source_snapshot())
    identity = runtime_identity()
    files["replay/runtime-identity.json"] = json_bytes(identity)
    for artifact in args.runtime_artifact:
        name, separator, path = artifact.partition("=")
        if not separator or not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
            raise InvalidData("invalid_runtime_artifact_argument")
        key = "replay/runtime-artifacts/" + name
        if key in files:
            raise InvalidData("duplicate_runtime_artifact")
        files[key] = Path(path).read_bytes()
    metadata = {"kind": "analysis_run", "code_commit": args.code_commit,
                "rule_version": result["rule_version"], "report_sha256": sha256(files["outputs/report.json"]),
                "runtime": identity, "timezone": config.get("timezone", "America/New_York"),
                "observation_cutoff": config["observation_cutoff"],
                "replay_artifact_status": "runtime_bundle_requires_independent_offline_verification",
                "supersedes_run_id": args.supersedes_run_id}
    source_completeness = {**config.get("source_completeness", {}),
                           "required_analysis_sources_and_integrity": result["status"] == "complete"}
    archive = create_archive(args.output, files, metadata, source_completeness)
    return {**archive, "report_status": result["status"], "runtime_recovery_verified": False}


def replay(args):
    directory = Path(args.archive)
    snapshot = read_verified_archive(directory)
    manifest, files = snapshot["manifest"], snapshot["files"]
    for name, data in source_snapshot().items():
        if files.get(name) != data:
            raise InvalidData("run_with_archived_source_for_replay")
    identity = strict_loads(files["replay/runtime-identity.json"])
    if identity["python_version"] != platform.python_version():
        raise InvalidData("runtime_version_mismatch")
    values = {name: strict_loads(files["inputs/" + name + ".json"])
              for name in ("receipts", "messages", "classifications", "resolutions", "company_observations", "config")}
    result = analyze(values["receipts"], values["messages"], values["classifications"], values["config"],
                     values["resolutions"], values["company_observations"])
    report_bytes = json_bytes(result)
    if report_bytes != files["outputs/report.json"]:
        raise InvalidData("numerical_replay_mismatch")
    files = {"outputs/replayed-report.json": report_bytes}
    return create_archive(args.output, files,
                          {"kind": "numerical_replay", "replayed_run_id": manifest["run_id"],
                           "source_manifest_sha256": snapshot["verification"]["manifest_sha256"],
                           "runtime": runtime_identity(), "numerical_match": True},
                          {"verified_frozen_archive": True})


def main():
    parser = argparse.ArgumentParser(description="Farpoint offline lead analysis and create-only archives")
    sub = parser.add_subparsers(dest="command", required=True)
    analyze_parser = sub.add_parser("run")
    for name in ("receipts", "messages", "classifications", "resolutions", "config"):
        analyze_parser.add_argument("--" + name, required=name in {"receipts", "config"})
    analyze_parser.add_argument("--company-observations", dest="company_observations")
    analyze_parser.add_argument("--output", required=True, help="New private output directory; must not exist")
    analyze_parser.add_argument("--code-commit", required=True)
    analyze_parser.add_argument("--supersedes-run-id")
    analyze_parser.add_argument("--runtime-artifact", action="append", default=[], metavar="NAME=PATH")
    verify = sub.add_parser("verify")
    verify.add_argument("archive")
    restore = sub.add_parser("restore")
    restore.add_argument("source")
    restore.add_argument("destination")
    replay_parser = sub.add_parser("replay")
    replay_parser.add_argument("--archive", required=True)
    replay_parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        if args.command == "run":
            result = run(args)
        elif args.command == "verify":
            result = verify_archive(args.archive)
        elif args.command == "restore":
            result = restore_archive(args.source, args.destination)
        else:
            result = replay(args)
        print(json_bytes(result).decode())
    except (InvalidData, OSError, KeyError, TypeError, ValueError) as exc:
        # Avoid logging arbitrary filesystem/private-data details.
        error = str(exc) if isinstance(exc, InvalidData) else type(exc).__name__
        print(json_bytes({"status": "failed", "reason": error}).decode(), file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
