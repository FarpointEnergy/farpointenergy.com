# Farpoint lead intelligence: detailed test and acceptance plan

Version 1.0 • 23 October 2026 • Companion to technical design v1.1

Status: finalized after three independent AI technical reviews; ready for the owner's build decision. This is a plan, not an execution report. All implementation cases below are NOT RUN. The owner will give a separate go-ahead before any code, infrastructure, synthetic submission, schedule or deployment is built or activated. Reviews cannot change the project's fixed goals.

## 1. What must be proved

The system must retain every admitted raw record, interpret it without destructive updates, protect private data, join observable website behavior to received inquiries, and reproduce numerical reports from archived inputs. A test passes only when the specified outcome is supported by retained evidence from the applicable code/configuration. Unit tests cannot substitute for a hosted gateway test, an inbox receipt, an unattended scheduled run or an isolated restore.

The minimal architecture remains website → small collector → private raw objects → scheduled Work/Python → versioned Drive archives/reports. GitHub holds source and design. No test finding automatically authorizes a new database, queue, hosting migration or change to the owner's goals.

Requirement coverage:

- G1 preservation: RAW-01–06, HASH-01–03, STORE-01–03 and HIST-01–02.
- G2 failure behavior: ACK-01–05, BROWSER-01–04 and FORM-01–06.
- G3 identity/access: AUTH-01–06, IP-01–03, PRIV-01–05 and ENRICH-01–03.
- G4 complete extraction: EXPORT-01–05, ARCHIVE-01–04 and GOLD-01–04.
- G5 recovery/history: RESTORE-01–03, HIST-01–02 and RELEASE-01–03.
- G6 conversion evidence: GOLD-01–04, FORM-01–06 and MAIL-01–05.
- G7 operations: JOB-01–05, PERF-01–03 and ENRICH-01–03.
- G8 website quality: UX-01–04 and RELEASE-01–03.

The person implementing each feature owns its evidence; an independent technical reviewer checks the oracle, result and relevant diff. Karan owns build authorization and any scope/requirement decision. The lead implementation agent owns the consolidated gate report and must not certify its own unsupported assumptions as facts.

## 2. Environments, phase order and stopping rules

Phase 0 — this documentation review. Finalize test definitions and independent expected results; preserve the previous design. Run no product code or infrastructure experiments. Exit when the technical reviewers approve the design/plan and all review findings have recorded dispositions. Then report changes to Karan and await the build go-ahead.

Phase 1 — local synthetic implementation, after approval. Implement contract and deterministic analysis tests with fake storage, fake email captures and stub enrichment. No real customer data or vendor API calls. Establish shared fixtures and golden results before implementation is allowed to determine the expected answers.

Phase 2 — isolated hosted feasibility. Use a separate candidate and private synthetic namespace, with production tracking still disabled. Test gateway identity, original-IP provenance, private exports, conditional writes, storage controls, complete archival and recovery. If Sites cannot satisfy an essential contract, stop that rollout and document the failure; do not downgrade the requirement or migrate the marketing site to conceal it.

Phase 3 — integrated website preview and controlled inbox tests. Preserve current copy/layout. Test normal, failure, keyboard, mobile and no-JavaScript journeys, then observe synthetic messages in the actual business inbox. Preview remains non-indexed and cannot accidentally invite public customer traffic. Only the explicitly designated controlled test harness may submit; ordinary preview submissions remain disabled.

Phase 4 — unattended operations and release review. Run archive/report and watchdog under actual scheduled authorization, including failure and catch-up cases. Review final source, data policy, evidence and gates. All mandatory cases for enabled capabilities must pass. A blocked capability cannot be described as working. Company-attribution and full-funnel project goals remain open until their respective gates pass; any narrower interim launch needs Karan's decision.

Phase 5 — only after deployment is authorized, run limited production smoke checks. Verify deployed commits, public behavior, durable canary receipt, owner-only export and archive. Keep prior code available for rollback; data is never rolled back or removed. A future full website migration has additional domain/route tests and is not part of the initial collector release.

Critical failures stop progression: lost or modified accepted record, unauthorized read/write/export, false acknowledgement, incomplete export labeled complete, leaked private data, fabricated conversion, destructive migration, or impossible reproduction from purportedly complete inputs. Fix, retain the failed evidence, and rerun the affected gate and dependent integration tests. Unrelated passing tests need not be repeated without a relevant change.

## 3. Fixtures, evidence and preservation rules

Planned fixture version F1 will include fixed event IDs, browser IDs, session IDs, inquiry IDs, timestamps, byte bodies, known hashes, synthetic email observations, provider stubs and independent expected tables. The worked sequences/counts below are already fixed as the independent oracle; executable fixtures are built only after authorization. Reserved documentation IPs may appear in offline fixtures only; do not send them to external enrichment services and mistake the result for accuracy evidence. Hosted original-IP probes use consenting controlled egress networks, with addresses retained only in private evidence.

All fixture identifiers use a synthetic namespace and fixed test markers. Tests, spam and malformed records stay in raw history; analytical exclusions are explicit. Test storage namespaces and artifacts are retained. There is no destructive cleanup, expiration, branch rewrite, or provider-account deletion. Corruption and missing-object scenarios use adapters or additional copies. Never delete an existing source object to make a restore test interesting.

Synthetic origin is distinct from analytical eligibility inside an isolated test run. GOLD-F1 explicitly marks its eight business-journey sessions eligible in the isolated fixture-analysis configuration; additional canary/bot/invalid fixtures exercise exclusion. This fixture configuration cannot be enabled in production, and hosted synthetic traffic remains excluded from real buyer reports. Never remove test markers or disguise tests as genuine buyers to obtain the expected counts.

For every case, save: test ID; requirement/gate; fixture version and hash; code commit; relevant configuration/dependency versions; environment and route; timezone; start/end times; steps; independent expected outcome; actual outcome; status; evidence object/file IDs and hashes; reviewer disposition. Keep credentials and private identities out of public test logs and the public repository. A public summary can link a private evidence identifier without exposing its contents.

Statuses are NOT RUN, PASS, FAIL or BLOCKED. NOT APPLICABLE requires an explicit statement that the optional capability is disabled, with owner-approved scope if a fixed goal would otherwise be missed. A missing credential, unsupported browser or unavailable second test network is BLOCKED, never PASS. Failed runs and subsequent successful reruns have distinct run IDs; neither replaces the other.

Use browser/network traces only when they can be captured without spilling sensitive headers. The private evidence package may contain synthetic submissions and private probe addresses; public evidence uses redacted derivatives while retaining the original privately. Review screenshots, logs and archives for accidental secrets before sharing.

## 4. Raw receipts and canonical event encoding

RAW-01 — ordinary receipt. Send a known valid batch. Pass: a new receipt_id exists, raw bytes and receipt_body_sha256 match the submitted byte sequence, and the acknowledgement follows storage success. Evidence: request bytes/hash, storage result, private object readback, response and ordered operation trace.

RAW-02 — admitted bad bodies. Separately send empty bytes, invalid JSON, malformed UTF-8, duplicate JSON keys, unsupported schema, unknown fields and unsolicited sensitive text, all within the byte limit. Pass: every admitted body remains byte-identical under its own receipt ID; validation rejects or quarantines it without deletion or echoing raw content. Durable invalid receipts have terminal outcomes; no infinite retry loop.

RAW-03 — transport versus analytical limits. Test 32 KiB minus one byte, exactly 32 KiB, and one byte over; 49, 50 and 51 events within the byte limit; absent/false length and a chunked over-limit body; unsupported compression. Pass: every admitted byte-limited body is saved before event-count validation, so 51 events survive as an invalid batch. Over-limit/unsupported transport requests are not falsely acknowledged or silently truncated; available rejection metadata is distinguished from full retained receipts. Test the actual platform boundary, not only the local parser.

RAW-04 — six-receipt conflict fixture. R1 contains A/B; R2 repeats A/B; R3 contains A/C; R4 is malformed; R5 reuses B's event ID with a different canonical payload; R6 uses an unsupported schema. Pass: all six bodies survive; A/C are two trusted unique events; B has one conflicted identifier and no trusted contribution until an appended resolution; R4/R6 remain retrievable. The seven valid event occurrences have three distinct IDs, one conflicted ID, and two trusted IDs. Count occurrences explicitly rather than calling every extra variant a duplicate.

RAW-05 — raw before derived processing. Inject a parser crash, schema-validator exception and classification failure after durable receipt. Pass: raw bytes remain recoverable; no failed downstream work erases or alters the receipt. Later processing creates new observations and can reconstruct the result from raw history.

RAW-06 — mixed validity. Submit one supported valid envelope containing three events: valid A, invalid B with an unknown field, valid C. Pass: one exact raw receipt, two trusted valid events, one quarantined event, and a terminal durable receipt acknowledgement. Repeat with an unsupported top-level schema and with duplicate JSON keys: each admitted body remains stored but the entire affected batch is quarantined with zero trusted events. This fixes the distinction between event-level and envelope-level rejection.

HASH-01 — shared canonical vectors. Independently specify browser/Python expected canonical bytes for reordered object keys, ordered arrays, escaped quotation marks/backslashes/control characters, composed and decomposed Unicode, missing/null, booleans, integral numeric spellings and negative zero. Pass: both implementations emit identical specified bytes and SHA-256 values; Unicode forms remain distinct without normalization; missing and null remain distinct. Review vectors before accepting implementation output as the oracle.

HASH-02 — invalid canonical inputs. Test duplicate keys, unpaired surrogates, NaN/Infinity, unsafe integers, fractional values and unknown schema properties. Pass: invalid events cannot enter trusted totals, while original receipts remain. Check byte/character distinctions and parse behavior in both languages.

HASH-03 — rebatching. Place an unchanged event into two different HTTP batches and reorder other events. Pass: receipt-body hashes differ as expected, event-payload hash stays equal, both receipts persist, and the event contributes once. An actual changed payload with the same event ID becomes a conflict.

## 5. Durable acknowledgement and browser outbox

ACK-01 — pre-write failure. Inject unavailable storage, write rejection and timeout with no confirmed write. Pass: no durable-success acknowledgement; unacknowledged events remain queued. After recovery a retry is stored. If the write outcome was ambiguous, a read/reconciliation may find an extra preserved receipt; it must not be silently discarded.

ACK-02 — response lost after write. Persist the receipt, then drop the response before the browser sees it. Pass: retry creates another raw receipt, the analytical event counts once, and every acknowledged receipt/hash is independently readable. A false “exactly once network delivery” claim fails review.

ACK-03 — overlapping sends. Queue A/B, freeze delivery snapshot X, queue C, retry X, send snapshot Y containing C, then deliver replies out of order. Pass: only exact event versions in the matching acknowledged snapshot leave the transport queue. C remains until its own matching acknowledgement. No new event is cleared because it shares a mutable array or an old batch index.

ACK-04 — bogus or incomplete replies. Exercise wrong body hash, malformed response, missing receipt ID, response from the wrong configured endpoint, non-success status, timeout and sendBeacon=true without a receipt response. Pass: none is treated as durable acknowledgement. Use the TLS-authenticated configured endpoint and a schema-valid response; a receipt ID alone is not a bearer credential or proof from an untrusted host.

ACK-05 — retained invalid batch. Persist a batch that fails analytical validation. Pass: response communicates terminal retained status and exact body hash; transport retry stops for that snapshot while the validation failure remains visible for repair. A later corrected event gets a new version/identity, not a mutation of the old payload.

BROWSER-01 — persistence and lifecycle. Reload, navigate, close/reopen a controlled browser context, go offline/reconnect and background the page. Pass: supported browser storage retains unacknowledged items and later retries; event ordering/IDs remain stable; no success is inferred from an unload API accepting work. A browser that never reconnects is a disclosed capture gap, not falsely counted as a saved event.

BROWSER-02 — multiple tabs. Use two tabs for one browser, concurrent enqueue/flush and out-of-order replies. Pass: no conflicting writes erase the other tab's queue; event identifiers are unique; duplicate deliveries are harmless in derived counts. Use atomic storage operations rather than a shared last-write-wins JSON blob.

BROWSER-03 — storage denied/full. Simulate browser storage denial, quota exhaustion and private browsing restrictions. Pass: the form remains usable; no automatic oldest-event eviction occurs; the tracker records a health limitation when possible and uses documented transient fallback without claiming persistence. Do not clear an existing real browser profile to perform this test; simulate it in a test adapter/context.

BROWSER-04 — instrumentation absent. Disable JavaScript, block only the tracker/collector, and force a tracker startup exception. Pass: native form and email path remain usable; analytics reports unavailable coverage instead of zero activity or invented sessions. Do not treat one canary as proof all real browsers are tracked.

## 6. Storage protection, history and independent archives

STORE-01 — create-only collision. Force a fresh receipt allocation to collide with an existing synthetic key, using the required conditional write. Pass: original content/hash remains unchanged, the failed condition is detected, and a new key is allocated for the new receipt. Test both adapter behavior and hosted conditional-write semantics; never issue an unconditional replacement.

STORE-02 — mutation and retention controls. Inspect actual lifecycle, expiry, access and lock settings; verify no destructive application routes or code paths exist. Use denied authorization on nonexistent targets and simulated provider failures to test mutation handling. Do not send destructive calls against existing stored evidence or temporarily disable protection. Pass: available policy/control evidence substantiates the claimed protection. If hard storage protection cannot be safely verified, keep that gate BLOCKED; append-only application code alone does not establish it.

STORE-03 — restart, redeploy and capacity failure. Reopen the candidate after process restart/code redeployment; inject full storage and billing/quota errors in the adapter. Pass: previous keys/hashes remain readable; new writes fail explicitly when durability is unavailable; no TTL, eviction, truncation or destructive reset is invoked. Capacity incidents are surfaced and collection health is marked degraded.

HIST-01 — correction and enrichment. Append a validation correction, resolved event conflict, second provider observation and changed session rule, then rerun analysis. Pass: all raw data, original observations, original report and prior configuration remain retrievable; new results identify their source and superseded interpretation. No upsert replaces history.

HIST-02 — no destructive maintenance. Inspect migrations, deployment hooks, retention jobs, archive rotation and test cleanup. Pass: none can delete/overwrite historical records or compact away raw sources. Any index rebuild uses a separate derived version and preserves its source. An absent deletion route is evidence of application behavior, not a claim that administrators lack power.

EXPORT-01 — pagination and byte limits. Seed 2P+7 receipts where P is the configured provider listing-page size, with at least three date partitions, one near-limit raw body and variable metadata. Force the export tool's byte limit before its item-count limit. Pass: complete exported ID/hash inventory equals the independently generated fixture inventory; continuation metadata is explicit; no single-page or short-page assumption drops data.

EXPORT-02 — chunked object reads. Force one encoded receipt to exceed a tool response budget. Pass: authenticated bounded chunks reconstruct exact bytes/hash; offsets/lengths/encoding are explicit; missing, repeated or out-of-order chunks are detected. Cursor state and response-size budgets are versioned. Never accept a tool-truncated text response as a complete raw object.

EXPORT-03 — interruption and resume. Stop after each listing page and object chunk, then resume. Repeat a response and simulate an expired cursor. Pass: resume or a complete rescan accounts for every source key; duplicate export observations remain identifiable; no checkpoint advances beyond verified evidence.

EXPORT-04 — concurrent and late writes. Add objects before/after the cursor's current ordering position, across midnight, with old client timestamps and delayed persistence. Pass: each report has an immutable exact-input manifest; subsequent reconciliation includes all fixture records. Earlier reports remain unchanged. A successful listing is not mislabeled as a transactional snapshot or a permanently final historical window.

EXPORT-05 — incomplete sources. Simulate source read failure, missing object, malformed continuation and permission loss. Pass: no completion manifest or complete-report status is issued for the affected scope; missing IDs and errors are retained. Other sources may produce an explicitly partial diagnostic report, never an apparently complete funnel.

ARCHIVE-01 — write and verify. Create new Drive files for raw receipts, metadata, messages, attachments where applicable and manifests. Read back/check actual bytes, counts and hashes, then write a separate completion manifest. Pass: the manifest identifies exact immutable file IDs and verified contents; source counts match. A filename or successful upload response alone is insufficient evidence of a complete backup.

ARCHIVE-02 — partial/ambiguous upload. Interrupt before/after each file creation and before/after completion creation; simulate a timeout that may have created a file. Pass: reconciliation preserves discovered files and creates additional records as needed; no replace-by-name or duplicate deletion occurs. Failed/ambiguous completion cannot advance the latest verified archive watermark.

ARCHIVE-03 — privacy of destination. Check actual sharing and attempt unauthorized access to synthetic archives. Pass: no public or link-wide access, no inherited broad access mistaken for owner-only protection, and no customer fixtures in the documentation folder/public repository. Redact derivatives without altering originals.

ARCHIVE-04 — integrity regression. Create an additional archive copy with a truncated object, modified bytes, missing attachment, duplicate manifest entry and wrong count. Pass: each mismatch blocks completion or restore approval and produces a specific error. The valid archive and original objects remain intact.

RESTORE-01 — archive-only reconstruction. Disable access to original collector storage and reconstruct into a separate empty destination using only the verified archive and pinned source. Pass: every raw body/attachment hash and provenance record matches the manifest. Do not overwrite or delete the original destination, even after successful recovery.

RESTORE-02 — numerical replay offline. Disable Gmail and enrichment/network access. Replay the golden report from archived nonsecret source, required dependency/runtime artifacts, configuration, timezone data and exact archived inputs; do not fetch an old package or Git ref from the network. Pass: logical sorted result tables, counts, denominators and classifications equal independent expected values. Parquet container bytes need not match if encoding metadata differs; compare defined canonical logical output hashes. Preserve original prose rather than demanding deterministic model wording.

RESTORE-03 — partial recovery. Attempt reconstruction with one missing or corrupted required input and with incompatible schema/code. Pass: recovery is marked incomplete/failed with identified inputs; it cannot silently substitute current API responses or regenerate unsupported data. Repair uses an additional verified copy and a new recovery run.

## 7. Authorization, trusted IP and data minimization

AUTH-01 — caller matrix. Call every export/list/read/chunk operation as verified configured owner, anonymous visitor, unrelated signed-in viewer, wrong Site-scoped identity and revoked session. Pass: only the currently authorized owner receives private data. Test actual hosted gateway paths, not only mocked headers.

AUTH-02 — spoofing and initialization. Forge user-ID/email/display-name headers, duplicate/case-variant headers, owner tool arguments and direct Worker-route requests. Call before owner configuration. Pass: fail closed; no first-caller enrollment; no bypass of gateway identity provenance. If the runtime cannot establish this trust boundary, stop the hosted candidate.

AUTH-03 — bypass tokens and guessing. Supply a hosting bypass token without owner identity; guess receipt IDs, storage paths and debug routes; vary HTTP methods and encoded paths. Pass: no private read or mutation; no raw object URL becomes a public capability. Keep actual tokens out of test artifacts.

AUTH-04 — cursors and chunks. Tamper with export cursors, offsets and object keys; reuse another caller's cursor. Pass: authorization is enforced on every operation; malformed/out-of-scope requests fail without leaking data. Cursor possession does not confer access.

AUTH-05 — cache isolation. Export as owner, then request the same route anonymously through the same browser/proxy/CDN path. Pass: private data is never served from cache; responses have appropriate private/no-store handling and authorization remains mandatory.

AUTH-06 — public ingestion and Origin. Exercise allowed/unrelated/absent Origin, preflight and content types. Pass: documented admission/CORS behavior, without treating CORS as authentication; admitted hostile data is retained/quarantined and not trusted as buyer behavior. Missing Origin must not bypass limits or disclose internal configuration.

IP-01 — known egress. Send synthetic probes from two independently known public egress networks; record contemporaneous expected egress from controlled network evidence. Cover IPv4 and IPv6 separately. Pass: trusted server-observed address equals the controlled egress for each supported path. Private evidence identifies actual routes, family and comparison; a local/mock request does not pass this test.

IP-02 — forged forwarding. Repeat with attacker-supplied IP fields, CF-Connecting-IP, X-Forwarded-For, X-Real-IP, lists of addresses and conflicting headers. Pass: trusted original-IP derivation is unchanged, or the route is explicitly unsupported. A Cloudflare/OpenAI proxy address must never be enriched as the visitor's employer. Do not publish a diagnostic echo endpoint.

IP-03 — route coverage. Test the exact default/custom-domain collector route used at launch. Future custom domains remain gated until tested, without blocking an unused optional route. An unsupported address family yields unavailable attribution for that traffic and a coverage count; it cannot be called full provenance coverage. Karan decides any interim launch while the fixed goal remains incomplete.

PRIV-01 — legitimate tracker sentinels. Put synthetic name, email and specification sentinels in every form field, pathname, query/fragment, UTM value, referrer and exception message. Pass: none enters browser analytics, normal logs, enrichment requests or public artifacts. Only fixed page/source identifiers, registered campaign tokens and enumerated errors are emitted. Unknown input becomes a categorical unknown without retaining the original text in analytics.

PRIV-02 — unsolicited raw sensitive content. Directly submit an admitted malformed payload with sensitive-looking sentinels. Pass: exact bytes remain privately preserved per the retention requirement, while normal analysis/enrichment sees a quarantine outcome; neither errors nor logs echo the body. This does not falsely claim a public endpoint can prevent all unsolicited content.

PRIV-03 — hostile data. Use HTML/script strings, spreadsheet-formula prefixes, path-like names and instruction text asking the agent to leak data. Pass: no code execution, trusted rendering, spreadsheet formula execution, tool routing or external communication follows from stored content. Safe rendered/CSV derivatives are additional representations; originals remain unchanged.

PRIV-04 — public release scan. Inspect Git diff, generated pages, source maps, fixtures, logs, screenshots, secrets configuration and build artifacts. Pass: no real visitor data, private owner IDs, keys, private business documents or live fault-injection endpoints. API/provider secrets never appear in browser requests. Confirm fault injection exists only in test adapters or inaccessible candidate tooling.

PRIV-05 — disclosure/configuration parity. Compare the proposed Privacy page with actual collection fields, identifiers/IPs, purposes, storage, enrichment processors and preservation behavior. Pass: accurate public disclosure and recorded collection-policy decisions before live collection; no anonymous-data claim for retained identifiers/IPs, no false deletion promise and no undisclosed new processing path. An unresolved policy conflict blocks launch; it does not authorize silent deletion or a new platform.

ENRICH-01 — deterministic classification. Use stub responses for corporate network, residential ISP, mobile carrier, cloud host, VPN, shared office, proxy, unknown and contradictory sources. Pass: no network result becomes verified employment; risky/shared classes stay unknown for employer inference; source/time/version and uncertainty are preserved. Firecrawl receives public company/domain research inputs only.

ENRICH-02 — provider failure and retention. Simulate timeout, 429, malformed result, quota exhaustion and changed schema; inspect the selected provider's retained-data rights and account security evidence before real IP use. Pass: collection continues, failures append observations, no destructive cache policy is introduced, and no historical observation is reused as a lookup cache contrary to the selected license. A license conflict blocks that provider; it does not waive preservation.

ENRICH-03 — controlled usefulness check. After provider approval, compare consenting known corporate and noncorporate test networks, keeping the independent network ownership evidence separate from returned data. Pass for correctness: no invented matches, no false claim of verified person/employer, and honest matched/unknown/incorrect counts with sample size. This small sample is not a production accuracy percentage. If corporate identification remains unavailable or materially unhelpful, the company-identification goal stays open and alternatives are evaluated; do not declare ASN context alone equivalent to employer mapping.

## 8. Golden funnel dataset and exact expected answers

Fixture GOLD-F1 has eight eligible sessions and seven browser identifiers. B1 appears in S1 and later S2, more than 30 minutes apart; other sessions use different identifiers. All events use unique stable IDs and deterministic UTC timestamps within one reporting window, except deliberate receipt arrival tests. Session sequences:

- S1/B1, email campaign A: page, product, reference selection — 3 events.
- S2/B1, direct/unknown: page, quotation view, start, attempt Q1, provider accepted Q1 — 5 events.
- S3/B2, paid campaign: page, product, quotation view, start, validation error, attempt Q2, provider accepted Q2 — 7 events.
- S4/B3, organic search: page, product, quotation view, start, attempt Q3, transport error — 6 events.
- S5/B4, direct/unknown: page, quotation view, start, validation error — 4 events.
- S6/B5, referral: page, product, email click — 3 events.
- S7/B6, direct/unknown: page — 1 event.
- S8/B7, email campaign B: page, quotation view, start, attempt Q5, transport error — 6 events.

Delivery fixture: one original batch per session; a full unchanged S2 retry; another batch containing two unchanged S3 events; one malformed batch; one unsupported-schema batch. Expected: 12 raw HTTP receipts, 42 valid-schema event occurrences, 35 unique valid events, 7 duplicate occurrences, 1 malformed receipt and 1 unsupported-schema receipt. Do not fold the separate RAW-04 conflict fixture into these totals.

Expected distinct-session stage reach: page 8; product 4; reference selection 1; quotation view 5; start 5; attempt 4; provider accepted 2; validation error 2; transport error 2; email click 1. These counts are not an ordered product-before-quotation funnel. Seven browser identifiers must not be labeled seven people.

Cutoff A email observations: capture G1/Q1 twice; G2 is a second actual message for the same unchanged Q1; G3/Q3 arrives despite the browser transport error; G4 is one direct email without website identifiers; G5 is one no-JavaScript form inquiry without identifiers. Q2's eventual message has not yet been observed. Expected: six raw email observations, five distinct mailbox/message IDs, four distinct received inquiries, two matched website inquiries and two unattributed inquiries. Session conversion is 2/8 = 25%; attempt-session conversion is 2/4 = 50%. Q2 remains delivery-unverified; Q3 is received despite a transport error.

Cutoff B adds G6/Q2 with its original received timestamp inside the reporting window. Expected new report: seven raw email observations, six distinct messages, five distinct received inquiries, three matched website inquiries, two unattributed inquiries, session conversion 3/8 = 37.5%, attempt-session conversion 3/4 = 75%, and zero provider-accepted inquiries lacking receipt evidence. Cutoff-A inputs and all its saved values remain unchanged.

Q1 attribution: first observed browser touch is email campaign A; inquiry-session touch is direct/unknown. Neither replaces the other. At cutoff A the six sessions without matched conversion are S1/S6/S7 browsing exits without observed errors, S5 validation friction, S3 delivery-unverified and S8 transport-error-associated exit. None proves lost interest; S4's observed error must not classify it as a lost conversion.

GOLD-01 — run the complete F1 fixture. Pass: every count, denominator, attribution and outcome above matches exactly. Evidence includes an independently reviewed expected-results file and the generated canonical logical tables. A test comparing a function to another function using the same business logic is insufficient.

GOLD-02 — late observations and cohorts. Produce cutoff A, then B, then add an inquiry received outside the session window. Pass: immutable earlier reports; distinguish inquiries-received-in-window from cohort conversions as of the later cutoff. Replay A using only its manifest still returns A's exact answers even after later data exists.

GOLD-03 — identity ambiguities and missing telemetry. Test two inquiries in one session, duplicate email captures, conflicting inquiry fields/session IDs, shared IPs across browsers, a second device, direct email after an unrelated mailto click and a thank-you URL visit without evidence. Pass: two inquiries/one converted session where appropriate; ambiguous joins remain unresolved; no IP-based person merging, fabricated stages or mailto/thank-you conversions. Received but unattributable inquiries remain counted separately.

GOLD-04 — time and exclusions. Test gaps of 29:59, 30:00 and 30:01; identical timestamps/sequence ties; late, invalid and more-than-five-minutes-future client timestamps; missing browser IDs; synthetic/bot/conflicted records; midnight and both New York daylight-saving transitions. Pass: the design's exact rules and independently enumerated window membership are followed, raw timestamps remain intact, unidentified observations have separate coverage counts, and exclusion reasons are visible. Pin timezone data; do not derive expected answers using the production sessionizer.

## 9. Website, form and actual inbox loop

Freeze a test input manifest from the actual form's named controls before implementation tests. Current business fields to check include Name, Company, email, Requirement or specification link, Transformer category, Application, Power-transformer reference configuration, Quantity, Rating value/unit, Primary voltage value/unit, Secondary voltage value/unit, Required delivery to site, Target energization, Project location, Project/package reference, Phone, Additional information, Source and Campaign. Add the actual inquiry/browser/session/campaign correlation fields. Inventory hidden fields and provider fields separately. Compare names and values; do not count provider control fields as customer requirements.

Use synthetic names, safe test text, multiline/Unicode values and a controlled reply address. Record every submitted value and expected normalization. Do not use a prospect's email or real project specification. Actual emails are limited to the existing controlled business inbox after build/test authorization. Evidence must verify delivery to the quotes@ route, not merely that an unrelated message appeared in a connected mailbox.

FORM-01 — minimal inquiry. Submit only required fields with technical details collapsed. Pass: optional fields remain optional, provider acceptance is distinct from delivery, the actual received message matches supplied values, and the inquiry matches its observed session when identifiers are available.

FORM-02 — all-fields inquiry and references. Submit a full distribution inquiry with mixed units, multiline Unicode text and optional dates; separately follow a power-reference link from Products and submit its selected reference. Pass: every actual field survives, reference selection and entered requirements remain correct, no incompatible stale hidden reference is submitted after category changes, and relevant testing/documentation/warranty offer details remain accessible.

FORM-03 — validation, rejection and uncertainty. Trigger required-field validation, invalid optional numerics, provider rejection, timeout, malformed provider response and analytics failure independently. Pass: clear accessible error, preserved entered values/reference, focused/associated error feedback and clickable quotes@ email fallback. Uncertain transport must not display confirmed success or confirmed inbox delivery. Analytics failure never blocks submission.

FORM-04 — retries and deliberate new intent. Double-click, retry unchanged after timeout, edit submitted business fields, then deliberately start another inquiry. Pass: unchanged retries retain one inquiry identity; changed business payload/new intent gets a new identity; unrelated requests are not merged. Multiple emails for unchanged Q1 count once as a received inquiry. Conflicting values under a reused ID are flagged, not silently accepted as identical.

FORM-05 — absent JavaScript/analytics. Use the native form with JavaScript disabled and repeat with only analytics blocked. Pass: actual inbox receipt, useful fallback and preserved field values. No-JavaScript attribution can remain unavailable, but the inquiry is counted as received/unattributed and missing funnel coverage is disclosed.

FORM-06 — navigation and non-conversion actions. Test back/forward, reload, reference changes, accordion toggles, mailto clicks and direct thank-you-page visits. Pass: fields/reference state follow the existing intended behavior, no accidental duplicate submission, and only explicit provider/inbox evidence changes the respective conversion state.

MAIL-01 — field-by-field comparison. Retrieve the actual synthetic messages through the configured mailbox connection. Pass: controlled unique test marker, intended destination route, message ID, timestamps, available delivery/authentication headers, full submitted field comparison and matching inquiry/session output. A provider success response, screenshot or mailbox search hit alone cannot pass this case. If headers or full fields cannot be retrieved, record the precise limitation as BLOCKED.

MAIL-02 — email-only attachments. Send one separate controlled email with a synthetic attachment and explicit project/inquiry reference, preserving the site's current email attachment method. Pass: received attachment bytes/hash match the source, filename/media type are preserved as evidence, and any linkage is evidence-backed. Do not invent a file-upload capability in the website test.

MAIL-03 — delayed/duplicate/filtered delivery. Use fixture captures for duplicate messages, changed labels, delayed arrival, spam classification, missing IDs and uncertain mailbox results. Pass: captured observations remain raw; delivery-unverified stays distinct from permanent failure; retries cannot double-count a lead. For the controlled live test, wait up to 10 minutes for an observed receipt, then mark delivery verification BLOCKED and investigate routing/filtering; do not assert permanent loss from that timeout.

MAIL-04 — full capture and privacy. Check raw-message/attachment pagination and connector size limits using synthetic fixtures. Pass: archived evidence is complete enough to reproduce the field match without Gmail; any inaccessible body or attachment prevents a complete archive claim. Browser analytics and enrichment still contain none of the quotation's submitted text.

MAIL-05 — eligible inquiry versus other mail. Add an attachment follow-up referencing Q1, an autoreply, a bounce, unrelated mail quoting Q1, a forged form sender/subject and an ambiguous possible inquiry. Pass: zero additional confirmed inquiries, all six observations archived, an explicit unresolved candidate for the ambiguous item, and no forged form-route conversion. A genuine new project in an old thread gets its own eligible inquiry when evidence supports it; a thread ID alone cannot merge it. Preserve classification/rule versions and any later correction. Keep these extra fixtures separate from the unextended GOLD-F1 counts.

UX-01 — responsive layout. Review 390, 768 and 1366 px, plus 320 px overflow, with long references and errors. Pass: no page-level horizontal overflow, usable technical table scrolling, visible email/offer before the form, readable text and usable controls. Preserve design, navigation and content.

UX-02 — keyboard and accessibility. Navigate menu, references, form, accordions, errors and success without a mouse; inspect labels/focus/expanded states and reduced-motion behavior. Pass: no keyboard trap, visible focus, correctly associated errors and clear status changes. Confirm clickable direct email fallback in desktop/mobile layouts.

UX-03 — supported browser engines. Required coverage: current desktop Chromium, desktop Safari/WebKit and mobile Safari or a clearly labeled equivalent test environment; record actual versions/device/emulation. Exercise outbox/storage, keepalive and form failure paths in each. Firefox gets a basic form/tracker compatibility smoke test. An emulated viewport is not proof of a real mobile Safari run; unavailable mandatory coverage stays BLOCKED until resolved or explicitly accepted by Karan.

UX-04 — buyer/content regression. Compare against the approved production baseline: complete product/application breadth, reference labels, manufacturing responsibility, warranty and founder biography. Verify optional technical accordions and the quotation offer/email route. No analytics UI, debug copy or additional tracking consent behavior is invented without a documented decision.

## 10. Scheduled operations, capacity and release checks

JOB-01 — real unattended execution. After approval, run one actual scheduled archive and one report under the intended owner's connections, without interactive assistance. Pass: authenticated complete export, verified archive completion, deterministic tables, retained report and owner-visible completion. A manually triggered run alone does not prove the scheduled permission path.

JOB-02 — independent task-level watchdog. Skip/disable the primary job while keeping the separate Work watchdog active. With the proposed 08:00 primary/09:00 watchdog schedule in America/New_York, pass: the owner gets an in-app warning referring to the missing expected completion by 09:15 in the controlled test. This 15-minute watchdog allowance is a project acceptance target, not a platform guarantee. Started, partial, stale or mismatched manifests must not suppress it. Record actual scheduling/notification latency; do not claim a hard platform SLA.

JOB-03 — common-mode outage and catch-up. Simulate both tasks unavailable by fixture/schedule-state injection, without deleting jobs or historical evidence. Pass: the next successful run identifies missed intervals, reconciles history, preserves gap warnings and marks data incomplete until caught up. Explicitly document that a Work-wide outage can also prevent the watchdog from warning in real time.

JOB-04 — canary and false-zero defense. Submit a marked synthetic canary through the actual collector and confirm its raw receipt and inclusion in the next archive; exclude it from buyer totals. Simulate no organic traffic and then a failed collector. Pass: the latter is surfaced as unhealthy/unverified collection, never presented as healthy zero traffic solely because no events arrived. Coverage remains limited for blocked real browsers.

JOB-05 — job and provider failures. Simulate expired authorization, Drive outage, quota exhaustion, bad schema, interrupted Python execution and missing dependency/version. Pass: immutable failure evidence, no complete watermark advancement, owner-visible warning when Work can execute, retained backlog and successful catch-up on a new run. No automatic data deletion or secret logging occurs.

PERF-01 — normal envelope. Initial engineering acceptance target, not measured traffic or vendor guarantee: sustain 10 small requests/second for 60 seconds in the isolated candidate, after confirming platform quotas/budget. Pass: zero acknowledged receipts missing or modified; p95 client-observed acknowledgement latency at most 1 second and p99 at most 3 seconds on the recorded stable test network. Record cold-start behavior separately and revisit the implementation if missed rather than dropping data.

PERF-02 — bounded burst. At most 50 small requests/second for 10 seconds, within the approved candidate limits; retain all synthetic receipts. Pass: no false acknowledgement, explicit retryable rejection where limits intervene, eventual reconciliation of every successfully accepted fixture receipt and no impact on form availability. Do not run unbounded load, third-party service load or a production stress test.

PERF-03 — browser cost and resource limits. Initial target: tracker at most 15 KiB gzip, deferred/nonblocking load, no synchronous network call on the quotation path and no tracker-attributable main-thread task above 50 ms under the chosen repeatable mobile profile. Compare three runs against baseline and retain traces. Simulate long backlog, archive growth and local quota pressure; pass only if preservation semantics and form availability hold. These are project targets to validate, not claims about current performance.

RELEASE-01 — existing checks and reproducibility. Run python3 check_site.py, node check_inquiry.js and node check_context.js, plus the meaningful new tests. Rebuild twice and compare generated output. Pass: no unexplained diff, unchanged protected content/assets, no broken local routes, and explicit distinction between mocked checks and live inbox evidence.

RELEASE-02 — code rollback with forward data. Record reviewed GitHub SHA, Sites source SHA, saved version and deployment ID. In the candidate deploy an additive code change, retain new records, then restore the prior compatible code version without touching storage. Pass: old and new raw data remain readable/exportable; unsupported schema is retained rather than destroyed. Never invoke a destructive database rollback.

RELEASE-03 — final package and optional domain migration. Review generated assets, secret handling, public/private boundaries, test-hook absence, exact source/version mapping and unresolved gates. For a later approved full website migration additionally verify apex/www HTTPS, canonical redirects, every old route/anchor/asset, mail DNS preservation and rollback routing. Those future migration tests are not evidence that a migration was performed now.

## 11. Acceptance ledger and review closure

At implementation start create an append-only execution ledger containing every test ID above, initially NOT RUN. Record each attempt independently; derive the latest status without replacing history. A completed gate needs all mandatory case evidence at the applicable release commit/configuration, with the independent reviewer disposition. A design-review approval never flips any implementation case to PASS.

For each defect retain: finding ID, reviewer, affected requirement/case, severity, rationale, correction, changed document/code version, re-review result and closure evidence. Blocking design defects must be resolved before declaring design ready. Runtime unknowns remain explicitly blocked/not run until tested; they do not require inventing infrastructure before evidence exists.

The final owner handoff will identify what changed during review, what remains to be tested after authorization, and the exact first build phase. Do not provision a candidate, create schedules, send test emails, merge code or change DNS until Karan gives the build go-ahead and the subsequent action falls within that authorization.

Review disposition: approved by all three independent AI technical reviewers after corrections and re-review of this actual plan and design v1.1. Execution disposition: all 82 planned cases NOT RUN. Karan's build go-ahead remains required.

## 12. Review findings and closure record

The initial contract review clarified exact hashes/conflicts, frozen report manifests, verified archive completion, session/time boundaries, separate stage reach, inquiry/message deduplication, campaign-value privacy, export cursor/cache authorization, missed-job detection and actual email-only attachment testing. These changes are reflected in the design and cases above without adding a new runtime or database.

DATA-01 — All synthetic fixtures would otherwise be excluded from the golden counts. Resolved with explicit eligible business journeys in isolated fixture analysis and separate canary/bot exclusion cases; production cannot enable fixture eligibility. Data and funnel reviewers confirmed closure.

DATA-02 — Mixed-validity batches had two plausible analytical outcomes. Resolved with per-event validation for supported envelopes and whole-batch quarantine for invalid envelopes, plus RAW-06's independent exact counts. Data reviewer confirmed closure.

FUNNEL-01 — Identifier-free follow-ups or automatic messages could inflate leads. Resolved with versioned eligibility classification, unresolved candidates and MAIL-05, including supported follow-up linkage and a genuine new project in an old thread. Funnel reviewer confirmed closure.

SECURITY-01 — Disclosure and negative identity coverage needed explicit launch tests. Resolved with PRIV-05 and forged-sender/quoted-inquiry-ID cases; private-data preservation and quarantine remain intact. Security reviewer confirmed closure.

REPLAY-01 — A commit hash/dependency lock alone may not be sufficient for future offline reproduction. Resolved by retaining exact nonsecret source and required runtime/dependency artifacts, then proving archive-only numerical replay in RESTORE-02.

Clerical closure: independently verified 82 unique case IDs, every G1–G8 range, RAW-04 arithmetic and GOLD-F1 counts. The previous v1.0 design remains unchanged. Reviews approve design readiness only; they certify no live capability, delivery, storage protection or runtime test result.
