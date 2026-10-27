"""Optional private offline DB-IP stage. No purchase, remote calls or activation.

The stage retains raw inputs and pinned source, replays the exact dependency and
all observations, then returns an independently verifiable create-only ZIP.
Operator approval is hash-bound evidence, not authenticated by this helper.
"""
from __future__ import annotations

import argparse
import base64
import os
from pathlib import Path
import re
import subprocess
import sys
import termios
import uuid
import zipfile

import network_stage as common

FORMAT = "farpoint-company-stage/1"
PROVIDER_KEYS = ("dataset", "license", "approval", "reader")
WORK_SOURCES = ("analytics/work/company_stage.py", "analytics/work/network_stage.py", "analytics/work/company-stage.mjs")
PACKAGE_PREFIX = "analytics/python/farpoint_analytics/"
StageFailure = common.StageFailure
_require, _json, _loads, _sha = common._require, common._json, common._loads, common._sha
_write, _file_info, _copy_expected = common._write, common._file_info, common._copy_expected

OFFLINE_RUNNER = r'''import pathlib,socket,sys
sys.dont_write_bytecode=True
def forbidden(*a,**kw):raise RuntimeError('offline_socket_forbidden')
socket.socket=forbidden;socket.create_connection=forbidden;socket.getaddrinfo=forbidden
def audit(event,args):
    if event.startswith('socket.'):forbidden()
sys.addaudithook(audit)
stage=pathlib.Path(sys.argv[2]); replay=pathlib.Path(sys.argv[3])
sys.path.insert(0,str(stage/'frozen-source'))
from farpoint_analytics import dbip_cli
from farpoint_analytics.analysis import json_bytes
from farpoint_analytics.archive import read_verified_archive,source_snapshot,create_only
from farpoint_analytics.canonical import strict_loads,sha256,InvalidData
binding=strict_loads((stage/'stage.json').read_bytes())
try:
    if sys.argv[1]=='run':
        result=dbip_cli.run_archive(input_path=stage/'company-inputs/request.json',artifact_root=stage/'provider-artifacts',output=stage/'company-run',code_commit=binding['code_commit'])
        if result['status']!='complete' or result['analysis_status']!='complete':raise InvalidData('company_observations_incomplete')
    elif sys.argv[1]!='verify':raise InvalidData('invalid_company_operation')
    snapshot=read_verified_archive(stage/'company-run'); files=snapshot['files']; metadata=snapshot['manifest']['metadata']
    if metadata.get('kind')!='dbip_company_observations' or metadata.get('code_commit')!=binding['code_commit']:raise InvalidData('company_archive_metadata_mismatch')
    for name,data in source_snapshot().items():
        if files.get(name)!=data:raise InvalidData('company_archived_source_mismatch')
    if files['inputs/request.json']!=(stage/'company-inputs/request.json').read_bytes():raise InvalidData('company_archive_request_mismatch')
    for item in binding['artifacts']:
        if files['inputs/artifacts/'+item['artifact']]!=(stage/item['path']).read_bytes():raise InvalidData('company_archive_artifact_mismatch')
    result=strict_loads(files['outputs/company-observations.json'])
    if result['status']!='complete' or result['receipt_integrity_errors'] or result['omitted']:raise InvalidData('company_observations_incomplete')
    data=json_bytes(result['observations'])
    if sys.argv[1]=='run':create_only(stage/'outputs/company-observations.json',data)
    elif data!=(stage/'outputs/company-observations.json').read_bytes():raise InvalidData('company_list_mismatch')
    checked=dbip_cli.replay_archive(source=stage/'company-run',destination=replay)
    if checked['status']!='verified' or checked['offline_reader_artifact_used'] is not True:raise InvalidData('company_reader_replay_unverified')
    print(json_bytes({'status':'verified','observations_match':True,'observations_sha256':sha256(data),'observations':len(result['observations']),'archived_source_used':True,'offline_reader_artifact_used':True,'python_socket_calls_blocked':True,'independent_os_runtime_recovery':False}).decode())
except Exception as error:
    print(json_bytes({'status':'failed','reason':str(error) if isinstance(error,InvalidData) else type(error).__name__}).decode());raise SystemExit(1)
'''


def _request(request):
    _require(isinstance(request, dict), "invalid_company_request")
    config, provider, sources = request.get("config"), request.get("provider_config"), request.get("source_bindings")
    commit, run_id = request.get("code_commit"), request.get("run_id")
    _require(isinstance(config, dict) and isinstance(provider, dict) and provider.get("enabled") is True, "company_provider_not_enabled")
    _require(isinstance(commit, str) and common.HEX40.fullmatch(commit), "exact_company_commit_required")
    _require(config.get("execution_code_commit") == commit, "company_execution_commit_mismatch")
    _require(config.get("company_provider") == provider and config.get("company_source_bindings") == sources, "company_configuration_mismatch")
    _require(isinstance(run_id, str) and re.fullmatch(r"[A-Za-z0-9_-]{8,100}", run_id), "invalid_company_run_id")
    _require(isinstance(sources, list) and sources, "company_source_bindings_missing")
    paths=set()
    for row in sources:
        common._descriptor(row); name=row.get("path");common._name(name)
        _require(name not in paths and (name in WORK_SOURCES or name.startswith(PACKAGE_PREFIX) and Path(name).suffix in (".py", ".json") and "/" not in name[len(PACKAGE_PREFIX):]), "invalid_company_source_binding")
        paths.add(name)
    _require(set(WORK_SOURCES) <= paths and {PACKAGE_PREFIX+"dbip_cli.py",PACKAGE_PREFIX+"dbip_company.py"} <= paths, "company_source_binding_missing")
    names=set()
    for key in PROVIDER_KEYS:
        spec=provider.get(key);common._descriptor(spec);name=spec.get("artifact");common._name(name)
        _require(spec["bytes"]>0 and name not in names and isinstance(spec.get("id"),str) and spec["id"], "invalid_company_artifact_binding")
        names.add(name)
    for field in ("artifacts","receipts","provenance_evidence"):
        _require(isinstance(request.get(field),list), "company_input_list_missing")
    conflicts=request.get("contradictory_receipt_ids",[])
    _require(isinstance(conflicts,list) and all(isinstance(v,str) for v in conflicts), "invalid_company_conflict_refs")
    return config,provider,sources


def _freeze(stage, repository, sources):
    repository=common._absolute(repository)
    package=repository/PACKAGE_PREFIX
    common._no_symlinks(package)
    expected={PACKAGE_PREFIX+p.name for p in package.iterdir() if p.suffix in (".py", ".json")} | set(WORK_SOURCES)
    _require({row["path"] for row in sources}==expected, "company_source_inventory_mismatch")
    for row in sources:
        path=repository/row["path"]
        _copy_expected({**row,"path":str(path)},stage/"stage-source/repository"/row["path"])
        if row["path"].startswith(PACKAGE_PREFIX):
            _copy_expected({**row,"path":str(path)},stage/"frozen-source/farpoint_analytics"/Path(row["path"]).name)
    for path,module in (("analytics/work/company_stage.py",Path(__file__).absolute()),("analytics/work/network_stage.py",Path(common.__file__).absolute())):
        _require(_file_info(module)==_file_info(stage/"stage-source/repository"/path), "company_executing_helper_mismatch")
    _write(stage/"stage-source/offline-runner.py",OFFLINE_RUNNER.encode())


def _offline(stage, operation, logs, replay):
    _require((stage/"stage-source/offline-runner.py").read_bytes()==OFFLINE_RUNNER.encode(), "company_offline_runner_mismatch")
    command=[sys.executable,"-I","-B",str(stage/"stage-source/offline-runner.py"),operation,str(stage),str(replay)]
    _write(logs/"command.json",_json({"argv":command,"python_socket_calls_blocked":True}))
    with common._new_file(logs/"stdout.json") as stdout,common._new_file(logs/"stderr.log") as stderr:
        process=subprocess.run(command,stdin=subprocess.DEVNULL,stdout=stdout,stderr=stderr,timeout=600,check=False,env={"PATH":os.defpath,"LANG":"C.UTF-8"})
        stdout.flush();os.fsync(stdout.fileno());stderr.flush();os.fsync(stderr.fileno())
    _write(logs/"exit.json",_json({"returncode":process.returncode}))
    _require(process.returncode==0,"offline_company_stage_failed")
    result=_loads((logs/"stdout.json").read_bytes())
    _require(isinstance(result,dict) and result.get("status")=="verified" and result.get("observations_match") is True,"offline_company_stage_unverified")
    return result


def _summary(observations, receipts):
    _require(isinstance(observations,list),"invalid_company_observations")
    for row in observations:
        _require(isinstance(row,dict) and row.get("kind")=="company" and row.get("provider")=="DB-IP" and row.get("employer","missing") is None and row.get("identity_category") in ("unknown","possible_corporate_match") and row.get("status") in ("ok","unavailable"),"invalid_company_identity_claim")
    return {"receipts":receipts,"observations":len(observations),"possible_company_matches":sum(r["identity_category"]=="possible_corporate_match" for r in observations),"unknown_company":sum(r["identity_category"]=="unknown" for r in observations),"verified_employers":0,"scope":"Optional offline possible-company context; no verified employment or purchased-dataset certification."}


def _pack(stage, output):
    _require(not output.is_relative_to(stage),"company_archive_inside_source")
    paths=common._all_files(stage); signatures={str(p):common._signature(p.lstat()) for p in paths}
    entries=[{"path":p.relative_to(stage).as_posix(),**_file_info(p)} for p in paths]
    _require(all(row["path"]!=common.MANIFEST_NAME for row in entries),"reserved_manifest_path")
    manifest={"format":FORMAT,"files":entries,"file_count":len(entries),"total_file_bytes":sum(e["bytes"] for e in entries),"snapshot_claim":"Exact retained optional-company stage files; no pipeline or production completion claim."}
    common._manifest_entries(manifest);data=_json(manifest)
    with common._new_file(output) as target:
        with zipfile.ZipFile(target,"w",compression=zipfile.ZIP_DEFLATED,allowZip64=True) as z:
            for path,row in zip(paths,entries):
                with common._open_regular(path) as source,z.open(row["path"],"w",force_zip64=True) as member:
                    import hashlib
                    h=hashlib.sha256();size=0
                    while chunk:=source.read(common.CHUNK):h.update(chunk);size+=len(chunk);member.write(chunk)
                _require(size==row["bytes"] and h.hexdigest()==row["sha256"],"company_stage_changed_during_pack")
            _require(common._all_files(stage)==paths and all(common._signature(p.lstat())==signatures[str(p)] for p in paths),"company_stage_changed_during_pack")
            z.writestr(common.MANIFEST_NAME,data)
        target.flush();os.fsync(target.fileno())
    common._verify_zip(output,_sha(data))
    return {"path":str(output),**_file_info(output),"manifest_sha256":_sha(data),"record_count":len(entries)}


def _retained(stage, request, binding):
    config,provider,sources=_request(request)
    _require(binding.get("format")==FORMAT and binding.get("code_commit")==request["code_commit"] and binding.get("run_id")==request["run_id"] and binding.get("observed_at")==request.get("observed_at",config.get("observation_cutoff")),"company_stage_binding_mismatch")
    _require(binding.get("source_bindings")==sources,"company_retained_source_binding_mismatch")
    frozen=common._all_files(stage/"stage-source/repository")
    _require({p.relative_to(stage/"stage-source/repository").as_posix() for p in frozen}=={r["path"] for r in sources},"company_retained_source_set_mismatch")
    for row in sources:
        expected={k:row[k] for k in ("bytes","sha256")}
        _require(_file_info(stage/"stage-source/repository"/row["path"])==expected,"company_retained_source_mismatch")
        if row["path"].startswith(PACKAGE_PREFIX):_require(_file_info(stage/"frozen-source/farpoint_analytics"/Path(row["path"]).name)==expected,"company_frozen_source_mismatch")
    _require({p.relative_to(stage/"frozen-source").as_posix() for p in common._all_files(stage/"frozen-source")}=={"farpoint_analytics/"+Path(r["path"]).name for r in sources if r["path"].startswith(PACKAGE_PREFIX)},"company_frozen_source_set_mismatch")
    descriptors=request["artifacts"];_require(len(descriptors)==4 and {r.get("key") for r in descriptors}==set(PROVIDER_KEYS),"company_artifact_keys_mismatch")
    bykey={r["key"]:r for r in descriptors}
    _require(len(binding["artifacts"])==4,"company_retained_artifact_count_mismatch")
    for key,item in zip(PROVIDER_KEYS,binding["artifacts"]):
        spec=provider[key];expected={k:spec[k] for k in ("bytes","sha256")}
        _require(item=={"key":key,"artifact":spec["artifact"],"path":"provider-artifacts/"+spec["artifact"],**expected} and {k:bykey[key][k] for k in expected}==expected,"company_artifact_descriptor_mismatch")
        _require(_file_info(stage/item["path"])==expected,"company_retained_artifact_mismatch")
    _require({p.relative_to(stage/"provider-artifacts").as_posix() for p in common._all_files(stage/"provider-artifacts")}=={provider[k]["artifact"] for k in PROVIDER_KEYS},"company_artifact_set_mismatch")
    for key in ("receipts","provenance_evidence"):
        original=request[key];retained=binding[key]
        _require(len(original)==len(retained),"company_retained_input_count_mismatch")
        for index,(descriptor,item) in enumerate(zip(original,retained)):
            relative=(f"inputs/receipts/{index:08d}.json" if key=="receipts" else f"inputs/provenance-evidence/{index:08d}.bin")
            expected={k:descriptor[k] for k in ("bytes","sha256")}
            _require(item["path"]==relative and {k:item[k] for k in expected}==expected and _file_info(stage/relative)==expected,"company_retained_input_mismatch")
            if key=="provenance_evidence":_require(item["ref"]==descriptor["ref"],"company_retained_proof_ref_mismatch")
    common._validate_proof_refs(config,binding["provenance_evidence"])
    receipts=[_loads((stage/r["path"]).read_bytes()) for r in binding["receipts"]]
    _require(all(isinstance(r,dict) for r in receipts),"invalid_company_receipt_shape")
    refs=["company-stage:"+request["run_id"]+":"+r["path"] for r in binding["artifacts"]]+[r["ref"] for r in binding["provenance_evidence"]]
    expected={"provider_config":provider,"receipts":receipts,"analysis_config":config,"observed_at":binding["observed_at"],"observation_run_id":request["run_id"],"evidence_refs":refs,"contradictory_receipt_ids":request.get("contradictory_receipt_ids",[])}
    _require((stage/"company-inputs/request.json").read_bytes()==_json(expected),"company_merged_request_mismatch")


def run_stage(request,root,repository_root):
    root=common._private_root(root,repository_root);stage=common._begin(root,"company-stage",request)
    try:
        config,provider,sources=_request(request)
        # Copy all acquired raw inputs before parsing receipts or executing source.
        artifacts=request["artifacts"]
        _require(len(artifacts)==4 and {r.get("key") for r in artifacts}==set(PROVIDER_KEYS),"company_artifact_keys_mismatch")
        bykey={r["key"]:r for r in artifacts};retained=[]
        for key in PROVIDER_KEYS:
            spec=provider[key];d=bykey[key];common._descriptor(d)
            relative="provider-artifacts/"+spec["artifact"]
            _require(all(d[k]==spec[k] for k in ("bytes","sha256")),"company_artifact_descriptor_mismatch")
            _copy_expected(d,stage/relative);retained.append({"key":key,"artifact":spec["artifact"],"path":relative,**{k:spec[k] for k in ("bytes","sha256")}})
        inputs={}
        for key in ("receipts","provenance_evidence"):
            inputs[key]=[]
            for index,d in enumerate(request[key]):
                relative=(f"inputs/receipts/{index:08d}.json" if key=="receipts" else f"inputs/provenance-evidence/{index:08d}.bin")
                info=_copy_expected(d,stage/relative);item={**info,"path":relative}
                if key=="provenance_evidence":item["ref"]=d.get("ref")
                inputs[key].append(item)
        common._validate_proof_refs(config,inputs["provenance_evidence"])
        _freeze(stage,repository_root,sources)
        receipts=[_loads((stage/r["path"]).read_bytes()) for r in inputs["receipts"]]
        _require(all(isinstance(r,dict) for r in receipts),"invalid_company_receipt_shape")
        observed=request.get("observed_at",config.get("observation_cutoff"))
        refs=["company-stage:"+request["run_id"]+":"+r["path"] for r in retained]+[r["ref"] for r in inputs["provenance_evidence"]]
        merged={"provider_config":provider,"receipts":receipts,"analysis_config":config,"observed_at":observed,"observation_run_id":request["run_id"],"evidence_refs":refs,"contradictory_receipt_ids":request.get("contradictory_receipt_ids",[])}
        _write(stage/"company-inputs/request.json",_json(merged))
        binding={"format":FORMAT,"code_commit":request["code_commit"],"run_id":request["run_id"],"observed_at":observed,"artifacts":retained,"source_bindings":sources,**inputs}
        _write(stage/"stage.json",_json(binding));_retained(stage,request,binding)
        verified=_offline(stage,"run",stage/"logs/run",stage/"offline-replay")
        data=(stage/"outputs/company-observations.json").read_bytes();observations=_loads(data);summary=_summary(observations,len(receipts))
        _require(_sha(data)==verified["observations_sha256"],"company_observations_integrity_mismatch")
        _write(stage/"stage-completed.json",_json({"status":"complete","summary":summary,"observations_sha256":_sha(data)}))
        archive=_pack(stage,root/(stage.name+".zip"))
        return {"status":"complete","archive":archive,"observations_base64":base64.b64encode(data).decode(),"observations_sha256":_sha(data),"summary":summary,"run_directory":str(stage),"python_socket_calls_blocked":True,"independent_os_runtime_recovery":False}
    except Exception as error:common._fail(stage,error)


def verify_stage(request,root,repository_root=None):
    root=common._private_root(root,repository_root or Path(__file__).absolute().parents[2]);stage=common._begin(root,"company-verify",request)
    try:
        _copy_expected(request.get("archive"),stage/"downloaded-stage.zip")
        restored=stage/"restored";manifest,_=common._verify_zip(stage/"downloaded-stage.zip",request.get("expected_manifest_sha256"),destination=restored,extract_all=True)
        _require(manifest.get("format")==FORMAT,"invalid_company_stage_format")
        original=_loads((restored/"request.json").read_bytes());binding=_loads((restored/"stage.json").read_bytes())
        _retained(restored,original,binding)
        verified=_offline(restored,"verify",stage/"logs/replay",stage/"checks/offline-replay")
        data=(restored/"outputs/company-observations.json").read_bytes();summary=_summary(_loads(data),len(binding["receipts"]))
        _require(verified["observations_sha256"]==_sha(data),"company_observations_integrity_mismatch")
        _require(_loads((restored/"stage-completed.json").read_bytes())=={"status":"complete","summary":summary,"observations_sha256":_sha(data)},"company_stage_completion_mismatch")
        result={**verified,"status":"verified","observations_match":True,"observations_sha256":_sha(data),"summary":summary,"manifest_sha256":request["expected_manifest_sha256"],"record_count":manifest["file_count"],"run_directory":str(stage)}
        _write(stage/"verified.json",_json(result));return result
    except Exception as error:common._fail(stage,error)


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--root",required=True);p.add_argument("--repository",required=True);args=p.parse_args()
    if sys.stdin.isatty():
        settings=termios.tcgetattr(sys.stdin.fileno());settings[3]&=~(termios.ECHO|termios.ICANON);termios.tcsetattr(sys.stdin.fileno(),termios.TCSANOW,settings)
    print("READY",flush=True)
    try:
        line=sys.stdin.readline(32*common.CHUNK+1);_require(len(line.encode())<=32*common.CHUNK,"request_size_limit");request=_loads(line);_require(isinstance(request,dict),"invalid_company_request")
        common._private_root(args.root,args.repository)
        if request.get("op")=="run":value={"status":"ok","result":run_stage(request,args.root,args.repository)}
        elif request.get("op")=="verify":value={"status":"ok","result":verify_stage(request,args.root,args.repository)}
        elif request.get("op")=="read_result":value={"status":"ok",**common.read_result_chunk(args.root,request)}
        else:raise StageFailure("unsupported_operation")
        print(common.transport_response(args.root,request,value),flush=True);return 0
    except Exception as error:
        value={"status":"failed","reason":str(error) if isinstance(error,StageFailure) else type(error).__name__}
        if isinstance(error,StageFailure) and error.failure_directory:value["failure_directory"]=error.failure_directory
        print(common.json.dumps(value),flush=True);return 1


if __name__=="__main__":raise SystemExit(main())
