# Optional offline company context

This implementation is **disabled by default**. It does not purchase, download,
activate or call a DB-IP service. Current reports and the IPtoASN stage are
unchanged. A paid dataset, approved licence/retention decision, actual provider
schema inspection, and the consented usefulness cohort are still required
before activation. Synthetic tests cannot close ENRICH-03.

The purpose is to make a conservative company association from a verified
network address. It never identifies a person or verifies an employer. The
existing report labels a result `possible_corporate_match`; `employer` stays
null and `verified_employers` stays zero.

## Exact dependencies and authorization

The adapter accepts four private artifacts. Each has an exact relative path,
byte count and SHA-256 binding in `provider_config`:

- `dataset`: the purchased IP-to-ISP MMDB edition, plus `edition`, the exact
  observed `database_type`, and `build_epoch` from that edition's metadata.
- `license`: retained purchase/licence/terms evidence for that edition.
- `approval`: retained JSON decision binding the dataset, licence and reader.
- `reader`: the complete `maxminddb-3.2.0.tar.gz` source distribution, 531,318
  bytes, SHA-256
  `d28e0073fd1dd637c8b95947bc864b5625eca9f8f2db1538145e33b2a1cd4b92`.
  Its binding also requires `version: "3.2.0"`.

The approval JSON must contain `provider: "DB-IP"`, `product: "ip-to-isp"`,
`purpose: "farpoint_private_company_context"`, `dataset_sha256`,
`dataset_edition`, `license_sha256`, `reader_sha256`, and literal booleans
`approved`, `retention_approved`, `offline_replay_approved` all set to true.
This is a hash-bound record of an externally authorized decision. It is **not**
an authentication mechanism or proof that a licence was purchased. Do not
create a real approval artifact until the owner makes that decision.

The loader verifies all bindings before opening the database. It copies only
the seven pinned Python source files and package metadata into a new private
directory, executes no installer, uses the pure Python `MODE_FD` reader on the
verified in-memory database bytes, and checks the edition metadata. An
incompatible already-imported reader fails. Every run archives the complete
source distribution so replay does not depend on a package server or wheel.

## Classification

The current DB-IP format distinguishes `traits.organization` from the ISP and
ASN organization. A possible-company result requires all of:

- nonempty organization distinct from the ISP;
- `connection_type: "Corporate"` and `user_type: "business"`;
- literal `is_anycast: false`;
- no supplied hosting, VPN, proxy, relay or other shared-network flag;
- no conflicting evidence, an independently approved source-IP provenance, and
  the retained approval above.

Missing or malformed classifications remain unknown. Hosting, residential,
cellular and anycast records remain unknown even if an organization is named.
The provider's documented Google public-DNS example combines `Corporate`,
`hosting` and anycast; it therefore **does not** yield an employer or company
match. No fallback from an ASN name or ISP name is used. The full matched
record, matched network, rule version, observation time, exact receipt hash,
event/receipt links, dataset metadata, reader binding and approval binding are
retained with each observation. Provider lookup failures make the run
incomplete instead of producing a healthy zero.

## Optional API and reproducible archive

`DBIPCompanyDataset(config, artifacts, runtime_directory=...)` accepts private
artifact bytes. A missing configuration or any `enabled` value other than the
literal boolean true disables it without loading dependencies.

`build_dbip_observations(...)` follows the same trusted derived-event scope and
source-provenance allowlist as the existing network stage. It excludes invalid
and conflicting events and production-excluded synthetic records. Its
`observations` may be supplied to the existing analysis API's
`company_observations` argument. No default Work callback has been enabled;
connecting this optional stage after approval must preserve its artifact
archive and replay verification before completing a report.

For a standalone private preparation run, an input JSON contains
`provider_config`, `receipts`, `analysis_config`, `observed_at`,
`observation_run_id`, `evidence_refs`, and optional
`contradictory_receipt_ids`. Artifact names resolve beneath the supplied private
artifact directory; unsafe paths and symlinks are rejected. Run with a new
output directory and an exact published source commit:

```sh
PYTHONPATH=analytics/python python -m farpoint_analytics.dbip_cli run \
  --input /private/request.json --artifacts /private/provider-artifacts \
  --output /private/new-company-run --code-commit ACTUAL_40_HEX_COMMIT
PYTHONPATH=analytics/python python -m farpoint_analytics.dbip_cli replay \
  --source /private/new-company-run --destination /private/new-company-replay
```

The create-only archive retains exact request/artifact bytes, full results,
all Python source, and interpreter identity. Partial acquisition/analysis
failures retain a partial archive without a completion marker. Replay verifies
every archive entry, starts a fresh process with archived code and dependency
bytes, disables sockets, and requires identical observation bytes. It uses the
installed Python runtime; it does not certify a new operating system. A local
completion is not a verified remote backup: the existing private upload,
download, hash and restore procedure still applies. Keep licensed database
bytes and observations out of Git and public artifacts.

## Primary references and remaining activation checks

- [DB-IP IP-to-ISP MMDB fields](https://db-ip.com/db/format/ip-to-isp/mmdb.html)
- [DB-IP terms](https://db-ip.com/tos.php): purchased editions have perpetual
  rights under the applicable licence; retain the terms and purchase evidence
  applicable to the actual edition. Current terms are not a substitute for that
  evidence or permission to redistribute the data.
- [Official MaxMind reader](https://github.com/maxmind/MaxMind-DB-Reader-python)
- [Pinned reader release](https://pypi.org/project/maxminddb/3.2.0/)

Before activation, obtain the owner's dataset decision, archive its applicable
licence evidence and exact edition, inspect its real field/metadata values,
verify offline replay and remote archive restoration, and run the approved
consented corporate versus noncorporate cohort with independent ground truth.
Report possible-match, unknown and incorrect rates separately; public fixtures
and network ownership alone cannot establish employee identity or usefulness.
