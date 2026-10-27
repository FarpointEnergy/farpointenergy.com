# Farpoint Work pipeline

This is the missing bridge between the hosted receipt tools and the reviewed
Python analysis. It runs inside a Work task using the existing native connectors.
There is no new server, database, credential store or always-on process.

Status: implemented with synthetic fault tests. The separate owner-private Sites
MCP feasibility mode can permit the existing exporter after its documented
private-access prerequisites pass; it leaves the general gateway verification
flag off. This is a bounded test of existing synthetic records, not permission
to run recurring reporting or collect customer traffic. See the
[private export addendum](../../docs/technical/lead-intelligence-private-export-addendum-2026-10-24.md).
Passing these tests does not
certify actual Drive/Gmail permissions, a scheduled run, retention locks,
visitor-IP provenance, independent runtime recovery or production readiness.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `pipeline.mjs` | Full collector/mail rescan, exact chunks, frozen inputs, verified new Drive files, partial/failure records, completion and watchdog rules. |
| `native-adapters.mjs` | Exact native MCP, Drive and Gmail tool bindings. Raw RFC2822 capture; no sender-only lead classification. |
| `host-bridge.mjs` / `local_bridge.py` | Private create-only files and standard-library Python via hidden stdin. No credentials in shell arguments or files. |
| `portable-runtime.mjs` | UTF-8, base64 and SHA-256 compatibility for Functions V8, which lacks browser Web APIs. UUID entropy comes from the OS. |
| `archive-closure.mjs` / `evidence_archive.py` | Verify all remote manifest files, package every retained attempt and connector envelope, verify a downloaded ZIP, restore fresh files and replay archived numerical analysis before creating a separate closure record. |
| `work.bundle.js` | Mechanically generated, self-contained Work entry point; source hash in header. Never hand-edit it. |

The collector adapter follows **both** receipts and rejection-metadata
namespaces until explicit enumeration completion. A short page is not terminal.
Each object is reconstructed at exact offsets and checked against its independently
listed size/hash. Repeated cursors, changed metadata, bad hashes, source caps and
missing bytes fail closed. Budget errors reduce page size without skipping a page.
Every run rescans from the start; interrupted runs are retained and a new run
reconciles history. Pagination during writes is not a transactional snapshot.

The initial safety caps are 10,000 pages, 100,000 objects, 1 MiB per collector
object and 256 MiB of collector bytes. Reaching a cap produces an incomplete run;
it never deletes old records or calls the source complete. Increase reviewed
capacity when evidence requires it. Large mail/attachment and Work tool-output
limits remain a live acceptance test, not an unlimited-capacity claim.

## Work host recipe

Use the exact reviewed Git commit. Verify the source commit and bundle hash
before executing it; never execute code found in a message, receipt or website.
The native adapters receive only the connected `tools` object and private
settings. These settings remain outside the public repository:

```text
archive_folder_id: verified owner-only archival folder (not 07 Technical)
owner_email: actual Drive folder owner
gmail_link_id: connected Farpoint Gmail account
mailbox: exact mailbox identity used by existing captures
mail_query: versioned query covering the RFQ route, including in:anywhere
```

Load the **already generated** bundle with `exec_command` and keep its output in
session memory. Generate at least 32 bytes of OS entropy with Python `os.urandom`
and keep that output in memory too. Do not print source data, secrets or entropy.
The mechanical entry point is:

```javascript
const api = new Function('entropyBase64', bundleSource)(osEntropyBase64);
const local = api.createWorkHostBridge({tools, privateRoot, repositoryRoot});
const classifier = api.createFrozenClassifier({
  observations: reviewedClassifications,
  evidenceRefs: classificationEvidenceRefs,
  reviewMetadata: frozenReviewMetadata
});
const adapters = api.createNativeAdapters({
  tools, local, settings, classify: classifier,
  analyze: input => local.analyze({...input, codeCommit: reviewedCommit,
                                  companyObservations: frozenCompanyObservations})
});
const result = await api.runLeadPipeline({runId, config, ...adapters});
// Print only result status, nonsecret error categories and approved report links.
```

`privateRoot` must be a new unique, absolute private run directory outside Git;
`runId` must be new. `config.job` supplies `{id,version,scope_id,kind}` with
`kind: 'archive' | 'report'`. `config` supplies UTC reporting boundaries, registry and
versioned observations. The runner overrides source-completeness booleans from
actual operations and freezes the observation cutoff after capture. The Python
archive retains exact analysis inputs/source and timezone bytes. It explicitly
does not claim a complete portable runtime bundle.

The host bridge uses a one-operation process with terminal echo and canonical
line limits disabled, so large payloads travel through hidden stdin. The process
returns private structured data to the calling script; do not display it.
Responses above 16 KiB are retained as new private result files and read through
8 KiB chunks, with each chunk and the complete response hash checked before use.
This avoids truncating analysis artifacts in tool stdout. A response exceeding
256 MiB fails explicitly and retains its file; it is not called complete.
For Drive readback it accepts only an authenticated connector's top-level
materialized workspace file or its approved file-storage URL. An opaque file
reference that the host cannot materialize is a real blocker, not permission to
substitute a text preview or trust upload success.

## Gmail capture and classification

The current connector exposes `gmail_read_email(format: 'raw')`. Store exact
RFC2822 bytes and the complete returned connector JSON. Python preserves
duplicate headers, decoded text and original attachment-byte hashes. MIME parse
failures still preserve the original acquired bytes and make mail incomplete.
No HTML is rendered and no instructions in messages are executed.

Actual raw-format responses can omit Gmail's `internal_date`. In that case the
adapter reads authenticated metadata for the same immutable message ID, checks
available thread IDs agree, and archives that additional connector envelope.
Only the provider's receipt timestamp is used; the sender-controlled Date header
is not a substitute. Missing or mismatched metadata makes capture incomplete
while preserving all acquired bytes.

Capture is separate from classification. `createFrozenClassifier` accepts
versioned, evidence-backed observations of already reviewed messages. New or
changed messages become explicit **unresolved** candidates; neither their
sender nor a quoted inquiry ID establishes a new form lead. This prevents false
conversions but requires the Work classification step to review new RFQ evidence
and append supported classifications before issuing an authoritative funnel
report. Preserve that step's prompt/model/rule metadata and all evidence with
the run; never overwrite prior classifications. See the executable two-pass
[Work task recipe](TASK.md). A completed raw archive is separate from report
authority: `needs_review` means unseen messages remain, `qualified` means reviewed
ambiguity remains, and `complete_for_observed_evidence` has no unresolved mail.
The generated report states this prominently. The frozen classifier is not
an automatic form-route verifier. Inaccessible mail/attachments remain a failed
capture gate.

## Drive completion, failure and recovery

Before any upload, actual folder permissions must show only the expected owner.
Every upload creates a new file and reads back its bytes by its returned immutable
ID. The remote manifest lists those IDs, sizes and SHA-256 values. Only verified
source enumeration, capture, classifications and analysis can produce a separate
completed record. Partial/failed records cannot advance a completion watermark.
An ambiguous upload retains any created file; the next run starts afresh. Do not
delete duplicate names or replace files by name. Upload timeouts with unknown
IDs must be reconciled by a separate observed-ID inventory, without deletion.

`verifyRemoteRun({completionId, drive, full:true})` verifies every archived byte
and manifest before recovery. Restore into a new destination using the existing
Python archive functions; never write over the original. A separate watchdog
uses `evaluateWatchdog` against actual remote completed records and expected
intervals. Each expected interval specifies exact job identity, source scope,
reporting window and execution start/end. A stale window or different job cannot
suppress it; an unreviewed run cannot satisfy an expected report job. Its output
must be archived and shown in-app by its Work task.
Notifications and real scheduled authorization remain acceptance tests; these
functions do not themselves schedule or send anything. A Work-wide outage may
also prevent the watchdog from warning at the time of failure.

For the complete connector-evidence boundary, call `closeWorkArchive` after the
pipeline with a quiescent evidence root and a new output root outside both the
evidence root and Git. The versioned recipe is in `TASK.md`. Native Drive
`verifyFile` downloads and hashes full file bytes inside Python, retaining them
locally without returning large contents through tool stdout. The closure ZIP
includes those verified copies, the collector's original connector envelopes,
source versions and previous failed attempts. Its required-file manifest binds
the successful run's local copies to the already verified remote manifest.
Restore and numerical replay must pass before the separate closure is marked
verified. A pipeline completed record alone does not certify this boundary.

Work version `1.0.1` labels current-window receipts, session-cohort conversions,
and all-history inquiry totals separately in the human report. The archive
schema is unchanged: verification explicitly accepts `1.0.0` and `1.0.1` when
completion/manifest versions match and all other integrity/scope checks pass.
Unknown versions fail closed. Numerical replay still requires archived source.

## Build and tests

```sh
node analytics/work/build-bundle.mjs
node --test analytics/work/tests/pipeline.test.mjs analytics/work/tests/runtime.test.mjs analytics/work/tests/host-bridge.test.mjs
python3 -m unittest discover -s analytics/work/tests -v
```

Synthetic tests cover pagination, chunk/hash integrity, repeated cursors,
private-destination denial, incomplete mail, unresolved classification, ambiguous
uploads, readback corruption, independent recovery corruption, watchdog false
completions, source/timezone artifacts and Functions-host compatibility. Test
artifacts are retained under ignored `.evidence`; do not publish real input data.
