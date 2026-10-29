"""Create-only private DB-IP preparation/replay; no acquisition or activation.

Run in a fresh process. The manifest is the existing local archive format, not
proof of remote backup. A caller must upload and verify the completed archive.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys
import uuid

from .analysis import json_bytes
from .archive import create_archive, create_only, read_verified_archive, runtime_identity, safe_relative, source_snapshot
from .canonical import InvalidData, sha256, strict_loads
from .dbip_company import DBIPCompanyDataset, READER_VERSION, READER_SDIST_SHA256, build_dbip_observations


def execute(input_bytes, artifacts, runtime_directory):
    inputs = strict_loads(input_bytes)
    if not isinstance(inputs, dict):
        raise InvalidData("dbip_input_invalid")
    provider = inputs.get("provider_config", {})
    dataset = DBIPCompanyDataset(provider, artifacts, runtime_directory=runtime_directory)
    try:
        return build_dbip_observations(inputs.get("receipts", []), inputs.get("analysis_config", {}), dataset,
                                       observed_at=inputs.get("observed_at"),
                                       observation_run_id=inputs.get("observation_run_id"),
                                       evidence_refs=inputs.get("evidence_refs", []),
                                       contradictory_receipt_ids=inputs.get("contradictory_receipt_ids", []))
    finally:
        dataset.close()


def run_archive(*, input_path, artifact_root, output, code_commit):
    """Preserve exact acquisition bytes, full result, licence and reader sources.

    Failed runs get a partial archive and no completion marker. No file is
    replaced. Approval meaning remains the caller's responsibility.
    """
    if not isinstance(code_commit, str) or not re.fullmatch(r"[a-f0-9]{40}", code_commit):
        raise InvalidData("dbip_code_commit_required")
    output, input_path, artifact_root = Path(output), Path(input_path), Path(artifact_root)
    if output.exists():
        raise FileExistsError(output)
    if any(p.is_symlink() for p in (input_path, *input_path.parents, artifact_root, *artifact_root.parents)):
        raise InvalidData("dbip_symlink_input")
    raw_input = input_path.read_bytes()
    runtime_record = runtime_identity()
    files = {"inputs/request.json": raw_input, **source_snapshot()}
    artifacts, result, failure = {}, None, None
    try:
        inputs = strict_loads(raw_input)
        provider = inputs.get("provider_config", {}) if isinstance(inputs, dict) else {}
        if isinstance(provider, dict) and provider.get("enabled") is True:
            runtime_record["external_dependencies"] = [{"name": "maxminddb", "version": READER_VERSION,
                                                       "sdist_sha256": READER_SDIST_SHA256,
                                                       "mode": "pinned pure Python MODE_FD"}]
            runtime_record["offline_dependency_artifacts_verified"] = False
            for key in ("dataset", "license", "approval", "reader"):
                binding = provider.get(key)
                if not isinstance(binding, dict) or not isinstance(binding.get("artifact"), str):
                    raise InvalidData("dbip_artifact_binding_missing")
                name = binding["artifact"]
                safe_relative(name)
                path = artifact_root / name
                if any(p.is_symlink() for p in (path, *path.parents)):
                    raise InvalidData("dbip_symlink_input")
                data = path.read_bytes()
                if name in artifacts and artifacts[name] != data:
                    raise InvalidData("dbip_artifact_changed_during_acquisition")
                artifacts[name] = data
                files["inputs/artifacts/" + name] = data
        runtime = output.parent / ("dbip-reader-runtime-" + str(uuid.uuid4()))
        result = execute(raw_input, artifacts, runtime)
        if result["status"] != "disabled":
            runtime_record["offline_dependency_artifacts_verified"] = True
        files["outputs/company-observations.json"] = json_bytes(result)
    except Exception as error:
        failure = str(error) if isinstance(error, InvalidData) else type(error).__name__
        files["outputs/failure.json"] = json_bytes({"reason": failure, "scope": "local optional provider preparation"})
    files["replay/runtime.json"] = json_bytes(runtime_record)
    complete = failure is None and result["status"] in ("complete", "disabled")
    archived = create_archive(output, files, {"kind": "dbip_company_observations", "code_commit": code_commit,
                              "provider_enabled": bool(result and result["status"] != "disabled"),
                              "result_sha256": sha256(files["outputs/company-observations.json"]) if result is not None else None,
                              "provider_purchase_verified": False, "production_readiness_verified": False},
                              {"acquired_inputs_preserved": True, "analysis_completed": complete})
    return {**archived, "observations": len(result["observations"]) if result else 0,
            "analysis_status": result["status"] if result else "failed", "failure": failure}


def replay_archive(*, source, destination):
    """Fresh directory, archived code + dependency + inputs; sockets forbidden.

    This checks numerical/observation replay on the installed Python runtime,
    not recovery of a new operating system or provenance of an authorization.
    """
    snapshot = read_verified_archive(source)
    files = snapshot["files"]
    if snapshot["manifest"].get("metadata", {}).get("kind") != "dbip_company_observations":
        raise InvalidData("dbip_archive_kind_invalid")
    required = ("inputs/request.json", "outputs/company-observations.json",
                "replay/source/farpoint_analytics/dbip_cli.py", "replay/source/farpoint_analytics/dbip_company.py")
    if any(name not in files for name in required):
        raise InvalidData("dbip_replay_inputs_missing")
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=False, mode=0o700)
    for name, data in files.items():
        create_only(destination / name, data)
    bootstrap = """import pathlib,socket,sys
def blocked(*args,**kwargs): raise RuntimeError('offline_replay_network_forbidden')
socket.socket=blocked;socket.create_connection=blocked;socket.getaddrinfo=blocked
root=pathlib.Path(sys.argv[1]);sys.path.insert(0,str(root/'replay/source'))
from farpoint_analytics.dbip_cli import execute
from farpoint_analytics.analysis import json_bytes
from farpoint_analytics.archive import create_only
artifacts={str(p.relative_to(root/'inputs/artifacts')).replace('\\\\','/'):p.read_bytes() for p in (root/'inputs/artifacts').rglob('*') if p.is_file()}
result=execute((root/'inputs/request.json').read_bytes(),artifacts,root/'reader-runtime')
create_only(root/'replayed-observations.json',json_bytes(result))
"""
    process = subprocess.run([sys.executable, "-I", "-B", "-c", bootstrap, str(destination.resolve())],
                             capture_output=True, timeout=300)
    create_only(destination / "replay-stdout.bin", process.stdout)
    create_only(destination / "replay-stderr.bin", process.stderr)
    if process.returncode:
        create_only(destination / "replay-failure.json", json_bytes({"reason": "archived_source_replay_failed", "exit_code": process.returncode}))
        raise InvalidData("dbip_archived_source_replay_failed")
    observed = (destination / "replayed-observations.json").read_bytes()
    expected = files["outputs/company-observations.json"]
    if observed != expected:
        create_only(destination / "replay-failure.json", json_bytes({"reason": "observation_bytes_mismatch",
                    "expected_sha256": sha256(expected), "actual_sha256": sha256(observed)}))
        raise InvalidData("dbip_replay_observation_mismatch")
    used_reader = strict_loads(observed)["status"] != "disabled"
    result = {"status": "verified", "source_manifest_sha256": snapshot["verification"]["manifest_sha256"],
              "observation_bytes": len(observed), "observations_sha256": sha256(observed),
              "archived_source_used": True, "offline_reader_artifact_used": used_reader,
              "network_disabled": True, "independent_os_recovery_verified": False,
              "actual_purchased_provider_dataset_verified": False}
    create_only(destination / "replay-verification.json", json_bytes(result))
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    run = commands.add_parser("run")
    run.add_argument("--input", required=True)
    run.add_argument("--artifacts", required=True)
    run.add_argument("--output", required=True)
    run.add_argument("--code-commit", required=True)
    replay = commands.add_parser("replay")
    replay.add_argument("--source", required=True)
    replay.add_argument("--destination", required=True)
    args = parser.parse_args()
    if args.command == "run":
        result = run_archive(input_path=args.input, artifact_root=args.artifacts,
                             output=args.output, code_commit=args.code_commit)
    else:
        result = replay_archive(source=args.source, destination=args.destination)
    print(json.dumps(result, sort_keys=True))
    return 0 if result.get("status") in ("complete", "verified") else 1


if __name__ == "__main__":
    raise SystemExit(main())
