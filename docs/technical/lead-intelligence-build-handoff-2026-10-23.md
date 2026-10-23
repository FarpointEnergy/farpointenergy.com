# Farpoint lead intelligence — build handoff, 23 October 2026

The implementation is built and independently reviewed for its current code scope. All 13 final local verification commands passed against an unchanged 83-file source inventory. The private website preview is deployed. **Production analytics, ordinary collector exports and recurring reports remain disabled:** the required hosted security, retention and end-to-end operational evidence is not complete.

[Open the private website preview](https://farpoint-analytics-review.karanuppal.chatgpt.site) · [Review pull request 4](https://github.com/FarpointEnergy/farpointenergy.com/pull/4)

The preview requires the owner's access. Its quotation submission is deliberately disabled, with a visible review banner and no indexing or tracking. It is a review environment; this build does not change the public Farpoint website.

## Architecture and implementation

The approved minimum remains: **GitHub Pages website → small collector → private raw object storage → ChatGPT Work and saved Python → new private Drive archives and reports.** The quotation route remains FormSubmit and Gmail. GitHub holds the reusable source, tests and public-safe documentation. No database, continuously running analysis server or separate model service was introduced.

| Component | Implemented behavior |
| --- | --- |
| Website tracker | Versioned, allowlisted events; bounded batches; raw acknowledgement matching; retry and pending-event preservation; browser/session identifiers and campaign context. The legitimate tracker excludes names, email, quotation text and attachments. It remains disabled in configuration. |
| Quotation handling | Stable inquiry identity for unchanged uncertain retries; correlation fields travel with the actual inquiry. Analytics failure cannot block the form. Errors preserve reference selection and requirements, offer an explicit retry and a clickable email fallback. Existing design, navigation, product breadth, optional technical details, warranty and founder copy are preserved. |
| Collector | Create-only raw receipts, independent analytical validation, preserved malformed/duplicate/conflicting evidence, bounded exports and chunk/hash verification. Application routes cannot delete or replace stored history. Unverified owner identity fails closed. |
| Saved Python | Deterministic validation, deduplication, sessions, event and campaign-touch tables, first-observed-browser and inquiry-session attribution, landing/product/application/reference breakdowns, inquiry cohorts and later-evidence restatements. Raw inputs and earlier reports remain intact. |
| Contact and company evidence | Declared contacts require eligible received-inquiry evidence. Company observations retain provenance and correction history. Network organization is not presented as a confirmed employer, and an enrichment flag cannot substitute for trusted source-IP evidence. |
| Work orchestration | Paginated retrieval, raw mail and attachment handling, exact hashes, private Drive create/readback, separate completion manifests, pinned analysis, explicit two-pass classification and a separate missed-run watchdog. Unknown or unreviewed classifications keep report authority pending. The executable recipe is in `analytics/work/TASK.md`; no schedule was activated. |

The resulting reports distinguish observed traffic, stage reach, received inquiries, error evidence and unexplained drop-off. A departure without an observed error is not proof of lost interest. Browser IDs are not person counts; cross-device identity, anonymous personal identity and sales outcomes beyond received inquiry are not inferred. The issued-campaign registry is currently empty and must be populated/versioned before campaign-specific collection is enabled.

## Verification and review

The final local run used Node v24.19.0 and Python 3.12.14. Exact commands, timestamps, stdout/stderr, exits and source hashes are retained in:

`analytics/evidence/build-2026-10-23/final-integrated-20261023T214723Z-c6a3759a-2f26-4b52-b854-721b77a1f0ea/`

| Check | Observed result |
| --- | --- |
| Collector | 35 tests passed |
| Python analysis and reporting | 42 tests passed |
| Tracker | 149 assertions passed; 4,967 bytes gzip |
| Inquiry and navigation/context | Mocked inquiry suite passed; 71 context cases passed |
| Sites wrapper and cross-language path | 5 tests passed; tracker → collector → chunked export → Python fixture passed |
| Work orchestration and portable runtime | 32 JavaScript tests and 5 Python bridge tests passed |
| Generated artifacts | Work bundle matched two rebuilds exactly; website build reproducible; 17 routes passed preservation/link/sitemap checks |
| Preview/source mapping | All 26 public source assets matched the final preview manifest; disabled collection/submission and noindex guards verified |
| Whitespace | `git diff --check` passed |

These are different measures, not a combined acceptance-test count. The frozen 82-case plan currently records **5 PASS, 30 BLOCKED and 47 NOT RUN** at full-case scope. Passing component tests do not complete a hosted, inbox, browser-engine or scheduled acceptance case. Aggregate release gates G1–G8 remain incomplete. The append-only status ledger is `analytics/evidence/build-2026-10-23/006-final-build-checkpoint.json`; earlier records are preserved.

Independent reporting review found and closed two correctness issues: submillisecond company corrections could select the wrong observation, and equivalent equal-time classifications could depend on input order. The fixes preserve timestamp precision and apply a stable tie-break.

Independent Work review closed incorrect watchdog acceptance of unrelated job windows, confusion between archival completeness and report authority, repeated-object metadata discrepancies, incomplete failure evidence, accidental promotion of unreviewed classifications, and future-dated review observations becoming authoritative too early. The final portable bundle also passed an actual Functions V8 Unicode/SHA256 smoke check. Both reviews approve their code scopes, not production readiness.

The frozen golden fixture contained an arithmetic inconsistency: S8 listed five events while declaring six. The executable fixture explicitly includes the missing same-session reload `page_view`; the required 35 unique events, 42 valid occurrences, seven duplicates and original funnel oracle remain unchanged. The original design and test plan were not rewritten.

## Hosted and browser evidence

| Evidence obtained | What it establishes — and its limit |
| --- | --- |
| Private collector synthetic check | Two originals and a collision copy were preserved; an overwrite attempt was refused and all three hashes matched readback. This proves the tested storage operations, not retention locks, trusted IPs or successful owner-only export. |
| Collector environment revision 2 | The owner secret was deployed without a source change. `GATEWAY_IDENTITY_VERIFIED` remains `0`. An ordinary list request was denied HTTP 403 as expected; that denial does not certify the full authorization matrix. No identity or token is published. |
| Existing controlled Gmail message | One raw RFC2822 message, its exact connector response and capture metadata were uploaded as new restricted Drive files; a separate completion manifest followed verification. All four files passed exact byte readback and owner-only checks. This does not prove full-history pagination, attachments or the current form's new correlation fields. |
| Actual Work bundle → native Drive | One 244-byte synthetic file was created and read back exactly through the reviewed bundle and connected Drive adapter; owner-only access and parent placement were verified. No collector, mail, RFQ or scheduled pipeline was invoked. |
| New provider submission attempt | One direct request was rejected with HTTP 403 / Cloudflare 1010 `browser_signature_banned`; no retry or bypass followed. An exact-marker inbox search returned no match. Field comparison was **NOT RUN**. This is a blocked delivery test, not a completed delivery proof or evidence that ordinary browser submissions fail. |
| Responsive quotation review | Chromium CSS frames at 320, 390, 768 and 1366 px showed no horizontal overflow. Offer/email placement, collapsed optional details, preserved references/requirements, keyboard menu and simulated failure fallback were checked. Pointer-menu behavior was inconclusive; real mobile touch, Safari/WebKit, Firefox and performance traces remain outstanding. |

Final preview source: `cf5137e35105af9e1d70596fbada5e4b669fe52f`, deployed at 21:39:43 UTC on 23 October 2026. Its exact source mapping is recorded in checkpoint 006. That checkpoint also corrects an earlier chronology note: the first preview already contained the shorter uncertainty copy; subsequent publication incorporated whitespace normalization and regenerated cache references.

## Remaining release work, in dependency order

1. **Establish storage and ingress controls.** Obtain owner-authorized account access that exposes bucket retention/lifecycle configuration and trusted source-IP handling. Inspect protections non-destructively; preserve every admitted source record and use no expiration or cleanup policy. If the Sites candidate cannot expose the required controls, keep the same small collector/object-store architecture under a Farpoint-controlled Cloudflare account. This is the approved design fallback, not a new deployment already performed.
2. **Prove hosted authorization and source IP.** Run the required missing/wrong/forged identity matrix and successful owner export through the authenticated connection. Never treat a hosting bypass token or caller-supplied header as owner identity. Keep the gateway gate closed until its trust boundary is verified. Compare captured IPs against independent known egress observations, including required IPv4/IPv6 cases.
3. **Complete current quotation delivery.** Use an authorized normal browser or provider-supported route, preserve a submitted-value manifest, then compare all 28 business/legacy/correlation fields against received raw mail. Test direct-email attachments, no-JavaScript fallback and analytics-blocked behavior. Preserve failed attempts as evidence; do not retry through a security bypass.
4. **Run the complete private pipeline and recovery exercise.** Export all collector pages, capture full relevant mailbox history and attachments, verify every remote byte/hash, and append completion only after coverage is established. Freeze classifications and observation cutoffs, archive executable source/runtime/timezone inputs, then restore into a separate location and reproduce the report without replacing originals. Reconcile ambiguous uploads by inventory rather than destructive cleanup.
5. **Finish browser, policy and operational gates.** Complete actual required engines/touch and mobile performance evidence; register allowed campaign tokens; reconcile the public Privacy disclosure with enabled collection. Prove one complete unattended archive/report run, independent missed-run warning, outage/catch-up and canary paths before recurring reporting is activated.
6. **Review the exact release version.** Reconcile the full acceptance ledger with retained evidence, verify private archive permissions and the public source inventory, and only then approve activation. A code rollback changes code; it must preserve old and new raw history.

Cloudflare's [official account MCP documentation](https://developers.cloudflare.com/agents/model-context-protocol/cloudflare/servers-for-cloudflare/) and [R2 bucket-lock documentation](https://developers.cloudflare.com/r2/buckets/bucket-locks/) were checked on 23 October 2026. They document a supported account-access path and indefinite bucket locks. Privileged administrators can remove lock rules, so this is not administrator-proof immutability. A plugin search in this run returned no Cloudflare result; an authenticated account connection is still required.

The controlling documents remain `lead-intelligence-design-v1.1.md` and `lead-intelligence-test-plan-v1.md`. This handoff records implementation and evidence; it does not lower their requirements or change the owner's fixed goals.
