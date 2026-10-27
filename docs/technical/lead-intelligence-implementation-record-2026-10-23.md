# Farpoint lead intelligence: implementation record

23 October 2026 · Build checkpoint 1 · Production collection disabled

The tracker, create-only collector and deterministic analysis package have been implemented. All eight local verification commands passed on the source snapshot recorded below. A separate private hosted check also passed for R2 conditional creation and byte/hash readback. This is a build checkpoint, not a production-release approval: hosted authorization, visitor-IP provenance, retention controls, remote archival/recovery and the actual quotation inbox loop remain open.

## Authority and unchanged architecture

Karan approved the build in the project conversation: “Looks great. Let's build. Whenever in doubt come back to the design.” This supersedes the frozen documents' historical statement that build approval was still pending; it does not change their requirements or authorize a narrower claim of completion.

The normative references remain [design v1.1](lead-intelligence-design-v1.1.md) and [test plan v1](lead-intelligence-test-plan-v1.md). Their original contents are preserved. The architecture remains GitHub Pages website → small collector → private raw objects → Work/Python → versioned Drive archives and reports. FormSubmit/Gmail remains the quotation-delivery route. No database, analysis server, model endpoint or marketing-site migration has been introduced.

## Implemented behavior

| Component | Current behavior | Important boundary |
| --- | --- | --- |
| Browser tracker | Deferred first-party script; immutable event keys; exact endpoint/body-hash acknowledgement; retry preservation; registered campaign tokens; fixed event/page/error categories | `analytics-config.json` remains disabled with no endpoint or disclosure version. Mocked lifecycle checks do not establish real browser persistence. |
| Quotation integration | Inquiry/browser/session correlation; frozen original attribution on an unchanged uncertain retry; new identity for changed business intent; clear uncertainty/email fallback; values and references preserved | Provider acceptance remains distinct from observed inbox delivery. Analytics is not a dependency for submitting the form. |
| Collector | Preserves exact admitted body bytes before parsing; unique receipt IDs; conditional create-only storage; bounded rejection metadata; 32 KiB transport limit | Admitted malformed/duplicate/unknown-schema records survive. Edge-rejected traffic is outside the application's observed boundary. |
| Private export | Bounded listing/chunks, HMAC cursors, full-response byte budgeting, private/no-store responses, owner and gateway checks | Ordinary hosted exports stay disabled until the actual identity trust boundary is verified. A hosting bypass token is not an owner identity. |
| Python analysis | Strict decoding and validation; canonical hashes; duplicate/conflict handling; deterministic sessions; preserved first/session touch; evidence-based inquiry classification; separate stage and conversion counts | Fixtures prove numerical logic. Real Gmail capture and routing must be demonstrated independently. No IP-based person merging or inferred lost-interest motive. |
| Local archives | Create-only outputs, exact input/source/configuration manifests, verified-byte restore and numerical replay | Local filesystem proof is not Drive upload/readback proof. Replay used an existing matching interpreter, not a fully recoverable offline OS/runtime bundle. |
| Company context | Conservative local ASN/network classifications and append-only observation inputs | Unverified source IP produces unavailable attribution. No employer-matching service or real visitor IP enrichment has been activated. |

The current website's navigation, product/application breadth, reference labeling, manufacturing responsibility, founder biography, warranty and protected assets pass the existing preservation checks. Optional technical fields remain optional/collapsible. Conditional privacy copy cannot be enabled without a configured disclosure version.

## Executed verification

The final local run was recorded as `final-local-20261023T211710Z-5e3595aa-c7f9-424d-9cf5-ff0867d403f3`. Exact commands, stdout, stderr, exit codes, UTC start/end times, runtime versions and source hashes are retained in [the execution record](../../analytics/evidence/build-2026-10-23/final-local-20261023T211710Z-5e3595aa-c7f9-424d-9cf5-ff0867d403f3/execution.json). The before/after source inventory was unchanged. Node was v24.19.0; Python was 3.12.14. These are distinct checks and assertions, not 82 completed acceptance cases.

| Command | Observed result | Scope |
| --- | --- | --- |
| `node --test analytics/tests/collector/collector.test.mjs` | 35 tests passed | In-memory storage/authorization, raw receipt/ACK behavior, pagination/chunking and failure handling |
| `PYTHONPATH=analytics/python python3 -m unittest discover -s analytics/tests/python -v` | 32 tests passed | Synthetic analytical, classification, archive and replay cases |
| `node check_tracker.js` | 149 assertions passed; 4,967 bytes gzip | Mocked browser/network and shared JS/Python canonical vectors |
| `node check_inquiry.js` | Passed | Mocked form payload, retry, reference, fallback and analytics-isolation checks; no email sent |
| `node check_context.js` | 71 cases passed | Context/navigation/redirect logic; no browser or network |
| `node --test analytics/deploy/sites/wrapper.test.mjs` | 5 tests passed | Candidate-only bootstrap and safe three-object storage-check algorithm |
| `node analytics/tests/collector/cross-language.mjs` | Passed | Actual tracker code → local collector → authenticated bounded export → Python |
| `python3 check_site.py` | 17 routes and reproducible build passed | Protected content/assets, local links, navigation, generated output |

The cross-language test retained a wrong-hash acknowledgement in the browser queue, retried, reconstructed exported bytes, verified hashes and derived three raw receipts, four valid occurrences, two unique/trusted events, two duplicate occurrences and one quarantined malformed receipt. It is explicitly a local integration result, not a hosted end-to-end result.

Independent local reviews approved the collector and Python code after corrections. The tracker review approved the earlier 125-assertion checkpoint; the later shared canonical-vector additions increased the final executed count to 149. The final log preserves that distinction instead of rewriting the earlier review record.

### Hosted synthetic evidence

The private collector candidate was deployed from Sites source commit `e3eda72602c1a739ee3ff455f28f1ddf0ea57a68`, saved version `appgprj_6adbbaca1c548191aa47200d710de59b~appgver_05508d3373ac81919f3ef7632baf39c6`, deployment `appgdep_6adbbdf6c9688191ab73790df5f0f662`. The bundled collector/wrapper source version was `farpoint-collector/1.0.0+a6bd1dfb3a390e5aa37dee67737c90378834a28b05084ac042430154f777eea3`.

The authenticated plugin became available and the candidate access policy was confirmed to contain only its owner, with no groups or external visitors. The returned Site-scoped identity was saved only as secret `OWNER_USER_ID` in environment revision 2; its value is excluded from public evidence. That revision was not redeployed during the synthetic check. `GATEWAY_IDENTITY_VERIFIED` remained `0`; saving an identity is not proof of gateway anti-spoofing or ordinary owner-only export.

One `candidate_storage_check` invocation reported PASS for `hosted_R2_create_only_collision_and_readback`: two original records plus a separate collision-test copy remained retained, a conditional overwrite of the copy was refused, and all three object hashes matched. Each object was 682 bytes. The result explicitly returned `retention_lock_verified: false`.

The exact safe response and scope were saved in a private hosted-check evidence document in 07 Technical. This proves a hosted storage primitive and authenticated tool execution; it does not pass scheduled archive/report/watchdog acceptance or certify indefinite retention, IP provenance or production readiness. Its locator is omitted from current public source; the original evidence and Git history remain preserved.

## Review corrections and retained history

- Collector: fixed possible error-text leakage, strict boolean gateway checks, malformed/oversized/repeated/Unicode cursor handling and exact serialized MCP budget accounting, including escaped request IDs.
- Python: bounded extreme numeric exponents, required literal successful source-completeness values, quarantined malformed evidence, prevented classification/capture count confusion, restored verified bytes without a second-read race, and kept uncertain network classes out of employer matches.
- Funnel/retry: an unchanged retry keeps the original inquiry and attribution context; later retries of an already received inquiry cannot create an extra converted session or a new delivery-unverified outcome.
- Candidate tooling: malformed discovery IDs retain the core error response; both attempted byte sequences are retained before testing collision behavior on a separate copy. Candidate bootstrap must be disabled before public deployment.
- Earlier failed tests remain recorded: a collector fixture moved its export clock backward; an integration harness had a syntax error; early Python assertions selected the wrong result-table level. Corrected runs have new evidence rather than replaced histories. An earlier wrapper-harness syntax failure is recorded as historical execution context; the final five-test log is the retained successful execution evidence.

### GOLD-F1 erratum: S8's missing sixth event

The frozen plan lists five event names for S8 but declares six events; the named sequences otherwise sum to 34 while the fixed oracle requires 35 unique events and 42 valid occurrences. The executable fixture makes the sixth event explicit: a reload `page_view` after S8's transport error, in the same session. This preserves every original distinct-session stage count and outcome, 35 unique events, 42 occurrences and seven duplicate occurrences. The implementation owner approved this arithmetic clarification and an independent reviewer verified it. It changes no project goal, funnel denominator or acceptance threshold; the original plan is preserved.

Cutoff A still produces 2/8 session conversion (25%) and 2/4 attempt-session conversion (50%). Cutoff B produces 3/8 (37.5%) and 3/4 (75%). Neither a mailto click nor a thank-you visit becomes a received inquiry.

## Release gates still open

The [corrected append-only status checkpoint](../../analytics/evidence/build-2026-10-23/004-evidence-metadata-correction.json) retains every one of the 82 planned cases: five complete local cases, 30 blocked cases and 47 cases whose full acceptance sequence has not run. Related passing suites are links to nearby code evidence; they do not imply that a particular hosted, inbox, network or browser case was executed. No aggregate G1–G8 gate is certified complete by this record.

Evidence review also resolved two bookkeeping issues without replacing history. The initial imported test-plan hash included one extra trailing newline; the exact tracked plan matches Git and has SHA-256 `1d33157e62942fba37ed4fb44495505cb045ceeee75e55b7306656a97772b952`. The first checkpoint's broad “local component PASS” labels are superseded by explicit related-suite links in checkpoint 004. The original ledger and intermediate checkpoint remain preserved.

| Gate | Remaining evidence/action |
| --- | --- |
| Storage controls | Inspect real bucket lifecycle/expiry/retention controls. The currently available Sites interface has not exposed the controls required to verify STORE-02. Create-only application writes alone cannot substitute for them. |
| Hosted identity and exports | Apply the staged secret through an authorized private deployment, establish trusted gateway identity without forged/bypass identity, and run the owner/anonymous/other-user/revocation/spoof/cache matrix before enabling ordinary export. |
| Visitor-IP provenance and company usefulness | Prove exact routed source IP against two controlled egress networks and spoof attempts, including supported IP families. Keep unproven addresses unavailable. Corporate-matching usefulness remains a fixed open goal. |
| Remote archives and recovery | Use a separately verified restricted archive destination, read back actual remote bytes, append completion only after verification, and demonstrate isolated offline recovery with retained runtime artifacts. 07 Technical is a shared documentation folder, not an approved private-customer archive. |
| Real quotation delivery | Freeze all current field names/values and run controlled desktop/mobile and native no-JavaScript inquiries; retrieve real delivered messages, route evidence and complete fields. Test direct-email attachments separately. Mocked success is insufficient. |
| Browser UX/engines | Finish responsive, keyboard, failure and storage tests; record actual browser versions. Chromium CSS-width frames do not establish mobile Safari, desktop WebKit or Firefox coverage. |
| Operations and performance | Run actual scheduled export/archive/report plus a separate missed-run watchdog, failure/catch-up/canary tests, bounded hosted load and repeatable mobile main-thread traces. The small storage probe is not JOB-01. |
| Final release | Review privacy/configuration parity, remove candidate-only tools, scan public artifacts, record exact GitHub/Sites source mappings, and verify additive deploy/rollback preserves old and new data. |

If Sites cannot meet an essential contract, evaluate the same collector/object-store architecture on an established provider with the required account controls. Do not introduce a database, weaken preservation, migrate the marketing site or claim a narrower success to bypass a failing gate. Any interim launch that leaves the fixed goal incomplete requires Karan's decision.

## Operating sequence

1. Keep live tracking disabled while hosted gates are unresolved. Public-safe source and synthetic evidence can be versioned; real quotation records, visitor addresses, identities and secrets stay outside the public repository and shared technical folder.
2. Preserve every original receipt, test attempt, export page/chunk, raw mail observation and classification. Append a uniquely identified run and manifest for each attempt. Ambiguous uploads trigger reconciliation, not replace-by-name or duplicate deletion.
3. Follow every export continuation, reconstruct and hash-check every chunk, then independently verify archive bytes/counts. A short page, upload success, filename or canary alone cannot advance a complete watermark.
4. Run the reviewed Python entry point against the frozen, verified inputs and source/configuration identity. Report first observed browser touch and inquiry-session touch separately; keep unavailable attribution, unmatched acceptance, unresolved mail and observed errors visible.
5. On quota, write, export, hash, archive or schedule failure, retain the evidence/backlog and report incomplete coverage. Expand capacity or repair access; never evict history. Catch up missed intervals before labeling a report complete.
6. Before release, attach independent dispositions and exact source/version evidence for every mandatory case. A code rollback restores compatible code only; data continues forward without deletion or mutation.

Future verification appends a new dated record and ledger event. This checkpoint and the original design/test-plan documents remain preserved.
