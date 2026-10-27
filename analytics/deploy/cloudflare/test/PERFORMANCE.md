# Candidate performance and boundary acceptance

This is a bounded, one-shot test of the existing candidate. It does not deploy
anything or enable probes, tracking, reporting, email or an RFQ. Root must give
a fresh GO after the scheduled baseline archive finishes, the test is reviewed,
and the private decryption key has been verified in the owner-private archive.

## Boundaries and release gate

The candidate must return 200 for `/health` and 404 for the synthetic probe.
The runner must be GitHub-hosted, in the existing repository, without proxy
environment variables. There is no proxy bypass, disguised user agent or retry.
A 401/403, observed code 1010, or 429/503 capacity response stops further dispatch;
there is no automatic resumption that ignores a Retry-After signal. A blocked local canary
client is not retried by this test; the GitHub network was independently planned
and previously validated before this performance test.

An ordinary source push runs offline tests only. Live execution additionally
requires the explicit `[farpoint-perf-go]` commit marker or a deliberate
`workflow_dispatch` with `run_live=true`. The Python entry point also requires
its exact GO value. Root owns source publication and the decision to run.

## Fixed load and evidence

- PERF-01: 600 small synthetic requests, nominally 10/second for 60 seconds.
- PERF-02: 500 small synthetic requests, at most 50/second for 10 seconds.
- RAW-03 supplemental phase: eight separately counted boundary attempts.
- Two candidate safety GETs and three GETs of the existing quotation HTML
  before, during and after the burst. No page JavaScript is executed and no
  provider or form submission occurs. This checks HTML availability only.

The maximum is 1,108 candidate POST attempts. The quota context checked on
2026-10-27 is 100,000 [Worker requests/day](https://developers.cloudflare.com/workers/platform/limits/)
and 1,000,000 [R2 writes/month](https://developers.cloudflare.com/r2/pricing/); the private evidence
package must retain the dated official quota check and current account context.
The scheduler admits at most the configured rate in each rolling one-second
window. It does not catch up above the limit. Requests missing the phase window
are marked undispatched and cannot count toward a passing throughput result.
The deadline is checked again immediately before calling curl. Admission and
actual pre-call dispatch offsets are retained separately, with observed dispatch
span, mean interval rate and maximum rolling one-second counts for both. These
measure client dispatch timing, not arrival at the server; scheduling jitter is
reported without rounding it away or claiming an absolute wire-level rate.
The client uses at most 64 concurrent subprocesses. Each request has an explicit
timeout, a bounded response and a unique synthetic input. No automatic retries
can enlarge the configured load.

Acknowledgement latency includes the client subprocess and the full received
response. Percentiles use nearest rank over valid acknowledgements. Normal
acceptance requires all 600 exact acknowledgements, p95 at most one second and
p99 at most three seconds. The first request is reported separately; the test
does not claim to force or identify a Cloudflare isolate cold start.

A CI success requires uninterrupted execution and all eight boundary attempts
to have dispatched and produced result records, in addition to the profile and
HTML availability checks. An exception after successful profiles, or a boundary
attempt skipped because dispatch stopped, cannot pass. Boundary HTTP outcomes
still require their separate semantic review; completion alone is not success.

A CI success is preliminary. Every acknowledged receipt must subsequently be
reconciled against authenticated R2 object metadata, exact object bytes and the
independently preserved original input. Missing, altered or false acknowledgements
fail acceptance. Raw inputs, successes, failures, headers, curl diagnostics,
source bytes and timestamps are retained. No records or failed artifacts are
deleted or overwritten.

`performance-r2-check.mjs` supports that final comparison through the authenticated
Cloudflare management tool. Supply at most 40 expected receipt rows from a complete
metadata listing and the original ACK inventory. The helper reads in groups of
five, checks outer object hashes/sizes and inner receipt hashes/IDs, and returns
safe comparisons without raw bodies or IP values. An original-body mismatch in
the deliberate false-length case requires separate framing analysis; it is not
silently counted as normal accepted traffic.

The CI runner encrypts its full evidence tar with the pinned public certificate,
using OpenSSL CMS AES-256-GCM and RSA-OAEP SHA-256. The private key never enters
GitHub. Only ciphertext, its integrity manifest, safe acknowledgement inventory
and safe summary enter the artifact directory. The artifact is a transfer buffer:
download, verify, decrypt and save it in the permanent owner-private project
archive before considering evidence complete. Preserve the source and the key
so the original evidence remains recoverable.

## Supplemental raw-body cases

| Case | Purpose and required interpretation |
| --- | --- |
| 32,767 received bytes | Verify exact admitted bytes immediately below the 32,768-byte limit. |
| 49 / 50 / 51 events | Preserve all three raw batches. The 51-event envelope is unsupported by the analysis schema and must remain raw/quarantined. |
| Absent Content-Length with chunked framing | Verify exact received body independently of a length declaration. |
| Content-Length: 1 with a bounded JSON body | Record actual edge/framing behavior on one closed connection. Do not assume bytes beyond the HTTP-declared body reached the Worker, or call a matching received-prefix receipt false. |
| Chunked 32,769-byte body | Verify size rejection or explicitly distinguish an earlier platform rejection. |
| Gzip with unsupported Content-Encoding | Verify rejection, or record any observable platform normalization separately; no universal claim is inferred. |

An edge rejection is not proof the Worker executed. Original requests and every
available response survive in encrypted evidence even when no R2 receipt exists.

## Existing export and rollback evidence

The collector tests already cover `2P+7` keys with provider page size P=3 across
three synthetic date partitions, a response-byte limit before item count, and
near-limit objects requiring multiple chunks. Performance receipts supply a
separate actual native-storage pagination/reconciliation check. They must retain
their real receipt dates; do not forge historical production metadata to manufacture
a third partition. Additional remote fixtures, if required by review, must use
an explicitly marked isolated fixture namespace and a separate reviewed plan.

RELEASE-02 is not established by additive redeployments or helper-flag cleanup.
The retained prior compatible bundle has source version ending
`8e3c2ddc7c092d0fcb40c7a1e04c8cf636bf46482f4cf6ea04d7603db8ef083e`
and worker SHA-256
`e12baf921d207f9385b2d37c708926650440354d840bd639db27672b0cbbbcdb`.
Its collector core hash matches the later actual-intake candidate, and it retains
the reviewed direct-edge adapter and conditional-create store. After explicit
approval, root can restore those compatible code bytes without changing storage,
using existing old and new receipts as the forward-data oracle. Record source and
deployment mappings, then prove both sets remain exact and exportable. Restore
the current reviewed release afterward if needed; never roll back data.
