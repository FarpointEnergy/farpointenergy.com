# Farpoint Work pipeline

This is the missing bridge between the hosted receipt tools and the reviewed
Python analysis. It runs inside a Work task using the existing native connectors.
There is no new server, database, credential store or always-on process.

Status: implemented with synthetic fault tests. Hosted export remains disabled
until gateway identity provenance is verified. Passing these tests does not
certify actual Drive/Gmail permissions, a scheduled run, retention locks,
visitor-IP provenance, independent runtime recovery or production readiness.

## Files and responsibilities

| File | Responsibility |
| --- | --- |
| `pipeline.mjs` | Full collector/mail rescan, exact chunks, frozen inputs, verified new Drive files, partial/failure records, completion and watchdog rules. |
| `native-adapters.mjs` | Exact native MCP, Drive and Gmail tool bindings. Raw RFC2822 capture; no sender-only lead classification. |
| `host-bridge.mjs` / `local_bridge.py` | Private create-only files and standard-library Python via hidden stdin. No credentials in shell arguments or files. |
| `portable-runtime.mjs` | UTF-8, base64 and SHA-256 compatibility for Functions V8, which lacks browser Web APIs. UUID entropy comes from the OS. |
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

## Build and tests

```sh
node analytics/work/build-bundle.mjs
node --test analytics/work/tests/pipeline.test.mjs analytics/work/tests/runtime.test.mjs
python3 -m unittest discover -s analytics/work/tests -v
```

Synthetic tests cover pagination, chunk/hash integrity, repeated cursors,
private-destination denial, incomplete mail, unresolved classification, ambiguous
uploads, readback corruption, independent recovery corruption, watchdog false
completions, source/timezone artifacts and Functions-host compatibility. Test
artifacts are retained under ignored `.evidence`; do not publish real input data.
