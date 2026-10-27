# Optional offline company context

This stage is disabled unless the operator explicitly supplies an enabled,
fully bound provider configuration. It does not purchase a dataset, record a
real owner's approval, activate website tracking, contact an IP lookup service,
or replace the mandatory IPtoASN stage. A company observation is a possible
organization match, never verified employment. The usefulness test with a
consented corporate/noncorporate cohort remains a separate release decision.

The provider policy, exclusions, pinned free reader, license requirements and
core archive format are in [DBIP_COMPANY.md](../python/DBIP_COMPANY.md). The
official provider dataset is not included in the repository. Synthetic tests
use a tiny generated MMDB and explicit test-only license/approval records.

## Required private configuration

Use one exact published execution commit and the corresponding source files.
`config.execution_code_commit` must match the wrapper's `codeCommit`.
`config.company_provider` must equal `providerConfig`, and
`config.company_source_bindings` must equal `sourceBindings`. The wrapper
freezes these constructor values and rejects a changed execution configuration.
The ordinary company-disabled path makes no company connector or file calls.
An enabled configuration without its wrapper fails rather than silently
delegating an unenriched report.

The four `providerConfig` artifact descriptors are `dataset`, `license`,
`approval` and `reader`. Each includes an exact owner-private Drive file `id`,
relative `artifact` name, byte length and SHA-256. Preserve the additional core
fields: dataset edition/database type/build epoch and reader version. The
approval file binds the exact dataset, terms and reader hashes, plus permission
for retention and offline replay. It is an operator-supplied authorization
record, not authentication or proof of purchase. Do not substitute a synthetic
test approval for the owner's actual decision.

`sourceBindings` is the complete array of `{path, bytes, sha256}` for every
direct `.py` and `.json` file in `analytics/python/farpoint_analytics`, plus:

- `analytics/work/company-stage.mjs`
- `analytics/work/company_stage.py`
- `analytics/work/network_stage.py`

The helper checks the full inventory, executing Python helper bytes and every
copied package file. It rejects missing, substituted or extra frozen import
files. Bind these bytes to the published commit in the invocation manifest;
passing a commit-shaped string alone does not establish source publication.

Supply the independently retained source-IP proof artifacts as
`provenanceArtifacts`, each with an exact private Drive ID, byte length, SHA-256
and `ref`. The restored proof references must cover
`config.verified_ip_provenances`. A proof authorizes the source-IP provenance
rule; it does not establish a visitor's employer.

All provider and proof artifacts must be in the same verified owner-only
archive folder used by the native Drive adapter. `shared` must be explicitly
false, with the sole expected owner. No permission is changed by the stage.
Keep artifact IDs, account identifiers, raw receipts and dependency download
references in the private invocation configuration, outside Git.

## Composition with the existing Work pipeline

Wrap the numerical callback underneath the mandatory network analyzer:

```js
const companyAnalyze = createCompanyAnalyzer({
  tools, local, settings, privateRoot, repositoryRoot, codeCommit,
  providerConfig: privateConfig.company_provider,
  sourceBindings: privateConfig.company_source_bindings,
  provenanceArtifacts: privateConfig.company_provenance_artifacts,
});
const analyze = createNetworkAnalyzer({
  tools, local: {...local, analyze: companyAnalyze}, settings,
  privateRoot, repositoryRoot, codeCommit,
  datasetArtifact: privateConfig.network_dataset,
  provenanceArtifacts: privateConfig.network_provenance_artifacts,
});
// Supply analyze to the native adapters and runLeadPipeline as usual.
```

When company context is disabled, this composition is the original network
stage followed by the numerical analyzer. When enabled, the company wrapper
preserves every incoming network observation and appends the company
observations only after their independent archive and replay succeed. It does
not change capture, inquiry classification, funnel attribution or lead counts.

Use `config.local_write_mode: "bounded_batches_v1"` with the existing reviewed
local bridge to stage receipts in groups of at most 64 files and 256 KiB.
Large files retain the individual create-only path. Every queued group is
flushed before generation, including when a later receipt fails validation.

## Execution and retention contract

1. Verify the private destination; download and hash all four dependencies and
   source-IP proofs through the authenticated Drive connection. Full downloaded
   bytes remain local; large files never enter tool stdout.
2. Preserve every exact receipt object before parsing it. Bind provider inputs,
   proof bytes, source files, execution configuration and observation cutoff.
   Freeze the Python package and helper source into the stage directory.
3. Run the core lookup using the pinned reader in a fresh Python subprocess
   with socket calls blocked. Keep complete matched provider records, lookup
   outcomes, conflicts and unknowns. Invalid or incomplete results block the
   stage; they are not converted to a healthy zero.
4. Create a new archive containing the exact inputs, dependencies, source,
   outputs, failure-free completion evidence and first offline replay. Upload
   it as a new private file; retain its returned ID immediately.
5. Download that uploaded archive, verify its length and hash, validate every
   member, restore into a new directory and regenerate observations using the
   archived code and reader. Exact observation bytes must match before the
   numerical analyzer is called.
6. Save the stage verification as an analysis artifact. Keep the entire stage,
   original connector envelopes, downloads, failed attempts and post-upload
   verification under the invocation's evidence root. The existing final
   `closeWorkArchive` step must cover that whole root after writes stop.

No existing record is overwritten or removed. A post-upload failure retains
the known created ID; an ambiguous upload outcome is reported explicitly.
Partial stage inputs remain available for the invocation's failure/closure
archive. The stage's ZIP does not certify completion of the surrounding Work
pipeline. Archived-source replay uses the installed Python runtime and is not
a claim of recovery on an independently provisioned operating system.

## Validation

The unit suite checks the disabled path, exact configuration and source
bindings, privacy/integrity failures, employer-promotion rejection, preservation
of prior network observations, known upload IDs and bounded receipt writes.
Python tests use the pinned reader and generated IPv4/IPv6 data, including
conflicts, unverified provenance, retained malformed inputs, denied approvals,
rehashed archive tampering, extra import modules, symlinks and exact offline
replay. The integration test executes the real JS/Python bridge, lookup,
archive, restoration, replay, streamed responses and numerical analysis with
an explicitly simulated filesystem provider.

Provide `FARPOINT_DBIP_READER_SDIST` as the exact separately retained
`maxminddb-3.2.0.tar.gz` before running the dependency tests. Tests never download
or install packages. A skipped dependency test is not acceptance evidence.
Retain `FARPOINT_PRIVATE_TEST_EVIDENCE` and
`FARPOINT_COMPANY_STAGE_EVIDENCE` outside the repository.

An actual owner-private Drive synthetic smoke must separately demonstrate the
native upload/download boundary and fresh offline regeneration. That smoke
does not validate the paid provider's coverage, licensing, a corporate cohort,
visitor employment, or production readiness. No real provider activation is
permitted by these code tests.
