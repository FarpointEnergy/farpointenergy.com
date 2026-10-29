# Farpoint lead intelligence: minimal architecture and preservation design

Version 1.0 • 23 October 2026 • Owner: Farpoint Energy

Status: approved by two independent AI staff-engineer reviewers for staged implementation, beginning with synthetic feasibility testing; production acceptance tests outstanding. Hosting/provider recommendations remain recommendations to the owner. This document records fixed requirements, alternatives, assumptions and release gates. Design approval is not evidence of deployment or successful live tests.

## 1. Outcome and fixed requirements

Farpoint needs to understand website acquisition, progression through the quotation funnel, received inquiries, observed failures and drop-off. Daily collection and a weekly owner report should make the data useful without operating a separate analytics application, database server or model runtime. Daily reports can use the same saved analysis code.

The owner fixes the goals. Reviewers may correct the design, expose unsupported claims and require tests; they may not reduce those goals. The following requirements take precedence over earlier proposals:

- Preserve all collected records indefinitely, including duplicates, malformed records, failed processing results and previous interpretations. Never automatically delete, expire, overwrite or destructively compact historical records.
- Keep sufficient inputs, code and configuration to rerun numerical analysis and answer new questions. Preserve original generated prose rather than promising identical language from a model rerun.
- Use a small collector, file storage and scheduled ChatGPT Work analysis. No standing analysis server, hosted model or Postgres service is required for the initial volume.
- Favor trustworthy providers and direct agent control. Cost is subordinate to data protection and useful attribution. Railway is excluded by owner instruction.
- Preserve the website's design, navigation, content breadth, technical accordions, reference labels, manufacturing responsibility, warranty, founder biography, routes and quotation behavior.
- Keep source code, schemas, reusable analysis, tests and design versions in GitHub. Keep private business data and private operational documentation outside the public website repository.

“All records” refers to the data admitted to the collection and analysis system, not keystroke recording or a promise that an offline/blocked browser can transmit every action. The tracker deliberately does not capture free-text field contents, credentials or unrelated browsing. This is a collection boundary, not a deletion policy.

## 2. Recommendation and current state

Keep the production website on GitHub Pages while proving the collector. Build one small ChatGPT Sites service with a private R2 object store. Scheduled ChatGPT Work retrieves complete exports and received quotation evidence, runs pinned Python, and creates new Drive archives and reports. Start with no D1 database. Add a rebuildable index only when measured lookup or export time justifies it.

The existing website is a generated static site at farpointenergy.com. The public repository is FarpointEnergy/farpointenergy.com. Source content is in content.py, generation in build.py, and quotation handling in inquiry.js. The observed main commit is 2b84ab5d84eba7cb7816c963bd45656ef24aa2a8. The repository README says no analytics destination is configured. The existing quotation route uses FormSubmit and the business email quotes@farpointenergy.com.

This design does not claim that a new tracker, collector, enrichment service, schedule, backup or domain migration is already operating. Older analytics drafts are historical and must not be deployed as though they implement this design.

Data flow:

1. Website JavaScript records an allowlisted funnel event and retains it locally until a durable acknowledgement.
2. The collector writes a new private raw receipt object, then acknowledges it. It does not call an enrichment service on the request path.
3. Scheduled Work completely enumerates and exports receipts, captures received quotation evidence, and writes new checksummed Drive archives.
4. Saved Python derives sessions, campaign attribution, funnel stages and conversion matches. Optional IP enrichment and public-company research are separate observations.
5. Each report run saves its inputs, rules, warnings, tables and report under a unique run identifier.

## 3. Hosting decision: GitHub Pages versus ChatGPT Sites

GitHub is source control; GitHub Pages is a production hosting service. Moving hosting does not require giving up GitHub.

ChatGPT Sites supports custom apex domains and subdomains where available. Therefore a compatible deployment can remain at farpointenergy.com; a ChatGPT-branded address is not compulsory. The native domain tool supplies apex A records, subdomain CNAME targets, verification records and certificate status. Availability depends on account/workspace eligibility; official documentation says custom domains are unavailable in Enterprise workspaces at launch. Actual eligibility, DNS access and successful certificate issuance remain untested here.

A full move would put pages and the collector on the same origin, remove cross-origin configuration, and let the agent manage website versions and the collector through the same hosting interface. Sites also provides basic visitor/page-view counts. Those counts do not replace event-level funnels, inquiry joins or company matching.

A move would not remove the collector, storage, export, analysis or backup work. It would require a compatible static-asset/server deployment, route parity checks, DNS changes and a release process across GitHub and Sites-managed Git. Sites is currently a public beta; no production recovery guarantee or customer-configurable immutable storage contract has been verified for this account. The small operational saving does not yet justify moving the working marketing website.

Decision: keep Pages for the first implementation. Treat a later full migration as an independently testable packaging change. Hosting must not alter the event contract or historical data. No DNS cutover is part of this design-document release.

If a later migration proceeds: deploy a candidate, verify all routes/assets/canonicals and desktop/mobile behavior, configure apex and www separately, check HTTPS and a single canonical redirect, then cut over only the website DNS records. Preserve email routing and verification records. Keep the existing Pages deployment available for rollback. Code rollback must never roll back or delete collected data.

## 4. Version control and document ownership

Drive is the project reading and operational workspace. Its dedicated Technical folder contains dated design revisions, decision records, reviewer findings, test evidence and private runbooks. Future design changes create new numbered versions with a supersession link; old versions remain available.

GitHub is canonical for executable source and the public-safe technical design: website changes, collector source, event schemas, analysis scripts, fixtures, dependency locks, build scripts and release manifests. Do not copy private PRDs, account research, visitor data, quotation text, credentials or private authorization identifiers into the public repository. The nonsecret Sites project_id belongs in the tracked .openai/hosting.json manifest as required by the deployment workflow. Private operational details remain in Drive unless a separate private repository is established.

Sites uses its own managed Git repository. Do not claim native automatic two-way GitHub sync. A release must record the reviewed GitHub commit, the corresponding Sites commit, saved Site version and deployment identifier. Verify the deployed source corresponds to the reviewed input. Preserve normal Git history; no force push or destructive branch rewrite. Changes made through Sites must return to GitHub through the same review path.

Website source versioning and saved deployment versions protect code. They are not backups of event storage. Runtime data remains a separate asset with its own manifests and recovery tests.

## 5. Browser event contract and quotation integration

Use a small first-party script integrated through the existing generator and event interface. Do not add a framework or session-replay product. Version the schema and tracker. Events carry event_id, browser_id when available, session_id, client timestamp, sequence number, event name, allowlisted page path, product/application/reference identifiers, campaign fields, tracker version and inquiry_id when applicable.

Generate random identifiers locally; never encode an email address or person name. Treat browser identifiers as pseudonymous browser observations, not unique humans. Preserve raw event order and client timestamps; calculate normalized time and session rules in derived outputs. Record unavailable browser storage and sequence gaps where observable.

Initial events: page_view, product_view, reference_select, quotation_view, quotation_start, technical_details_open, quotation_validation_error, quotation_attempt, quotation_provider_accepted, quotation_transport_error, email_click and script_error. Add events only when they answer a stated business question. Use enumerated error categories and safe location codes, not arbitrary exception text that may contain customer data.

Store only pathname and an allowlisted campaign dictionary. Do not collect full query strings or referrer URLs that could include personal data. Retain source classifications and permitted referrer origin/path only. No names, email addresses, field values, specifications or attachments belong in browser analytics. Form values continue through the existing quotation submission route.

Generate an inquiry_id when a submission attempt begins; include it and available browser/session/campaign identifiers as hidden fields in the actual inquiry. Retain the same inquiry_id for uncertain retries of that inquiry; a deliberate new inquiry gets a new one. Do not block the form on analytics success. Preserve entered requirements and reference selections on errors. Keep no-JavaScript submission usable; its attribution may be unavailable.

The browser maintains an outbox using supported persistent browser storage. Foreground fetch receives acknowledgements; unload delivery may use keepalive or sendBeacon, but sendBeacon returning true is not a durable server acknowledgement. Preserve unacknowledged items for a later visit and retry with bounded backoff. An acknowledged item may be removed from the browser transport queue only because its exact record is durably retained server-side; this is not deletion of the historical record. The client takes an immutable snapshot for each delivery attempt. The acknowledgement must include receipt_id and the SHA-256 of that exact received batch body; clear only the outbox event versions contained in the matching snapshot. Overlapping retries and newly queued events must not be cleared by an unrelated acknowledgement. Quota denial, user-cleared storage, offline closure and script blocking remain capture gaps. Do not silently evict queued events to maintain a fixed-size history.

## 6. Collector and append-only storage contract

The collector is a small public HTTPS endpoint. It accepts only the documented analytics route and method, limits request size and avoids expensive work. Cross-origin access is restricted to the expected website origins. Origin checks and CORS are not authentication or bot prevention; hostile clients can forge public requests. Preserve suspicious data and exclude it only in derived reporting.

Proposed protocol limits, to verify against the runtime: at most 32 KiB per request and 50 events per batch. The normal tracker remains well below these limits. These values protect availability; no claim is made that arbitrarily large hostile traffic or requests rejected before application execution can be retained in full. Record available metadata for such rejection where the application can do so, and report this boundary separately. If the owner requires storage of every upstream rejected byte, this design cannot satisfy it and must not be declared complete.

For every admitted request, allocate a new receipt_id independent of event_id. Save the original body bytes, receive timestamp, receipt_body_sha256, content type, origin, schema/tracker hints, deployed collector version, and explicitly selected transport metadata. Encode raw bytes losslessly when the envelope is JSON. Never copy Cookie, Authorization or arbitrary request headers. Keep selected source-IP evidence private and label its provenance. event_payload_sha256 is a separate derived hash of the schema's canonical individual event representation.

Example key layout: receipts/YYYY/MM/DD/<receipt_id>.json. Each HTTP batch gets one object; do not buffer separate HTTP requests solely in Worker memory. Use conditional create-only writes, detect failed preconditions and allocate a new key on collision. Return an accepted response only after the object write succeeds. Do not rely on a deferred background write after returning success.

Store before parsing/validating the admitted body. Malformed JSON, unsupported schema and duplicate events therefore survive. Return a receipt acknowledgement containing receipt_id and receipt_body_sha256 that distinguishes durable receipt from analytical validity. A durably retained invalid batch receives a terminal receipt outcome, so it does not retry forever. Parsing and validation results become new records referencing the receipt; they never rewrite its bytes. If storage fails, return a retryable failure and no success acknowledgement. If a write succeeds but the response is lost, a retry creates another raw receipt; deduplication occurs only in analysis.

No application route or export tool can delete or replace source objects. No time-to-live, lifecycle expiration, truncate, retention-of-last-N, destructive migration or destructive compaction is allowed. Corrections, enrichment, exclusions and changed session assignments append new observations. Parquet files are additional analytical representations; raw objects remain.

R2 supports conditional writes and storage locks, but Sites exposure of bucket-lock controls is not verified. Application-level append-only code is weaker than storage-enforced immutability. Require a tested retention mechanism and restrict privileged administrative access. Do not describe the store as immutable against account owners or provider administrators. If Sites cannot expose adequate retention protection, retain the same simple collector/object-store pattern on a supported established provider with the necessary controls; do not silently accept a weaker retention goal.

## 7. Reliable visitor IP and company attribution

Anonymous employer identification is probabilistic. An IP address may identify an internet provider, shared office, VPN, hosting service or corporate network. It does not prove a person's identity or employer. Do not turn an ASN/network owner into a verified buyer account.

The collector must establish trustworthy original-IP provenance before sending lookups. Cloudflare forwarding behavior varies with proxy and Worker paths; Sites documentation has not established the actual contract here. Test two known independent network origins, forged forwarding headers, IPv4/IPv6 and the actual deployed/custom-domain path. Attacker-controlled headers must not change the trusted address. A provider/proxy IP is not a customer IP. Failed provenance means company_lookup_unavailable, never a fabricated match.

Recommended baseline: local IPtoASN files in scheduled Python for network context. The dataset is public domain (PDDL v1.0), supports IPv4/IPv6 and can be snapshotted permanently; visitors' IPs need not be sent to another enrichment vendor. It provides network ownership, not an employer identity database. Treat missing or generic network names as unknown.

Candidate enhancement: ipapi.is registered free tier, currently 1,000 full lookups/day, commercial use permitted. Its company field represents a more specific network allocation and includes useful hosting/VPN/proxy flags. It is a small independent provider, not an independently verified enterprise-security equivalent to OpenAI/Google. Production use is conditional on security, account data controls and retention compatibility, not selected merely because it is free.

ipapi.is permits retaining results embedded in individual event records as needed, but places refresh/deletion restrictions on reusable caches and downloaded datasets. Do not build a permanent reusable IP cache from historical observations. Confirm that complete response snapshots for individual lookup events and their backups fit the event-record exception before production use. Until resolved, use open network data and preserve the unresolved company-attribution gap.

IPLocate is another free account-based option at 1,000 single lookups/day with company and privacy fields. It publishes open-source Python and MCP clients; its documented MCP runs locally over stdio, not a verified hosted ChatGPT plugin. Its terms contain a marketing restriction concerning WHOIS/ASN/abuse-contact data and its security pages have subprocessor inconsistencies. Treat it as an alternative requiring clarification. Free batch access is not documented; single requests can be made from Python.

IPinfo Lite provides free network/ASN context, not the separate paid company dataset. ipwhois is an open-source RDAP/WHOIS client, not an employer database. GeoLite2 ASN has license and update/deletion conditions that may conflict with permanent snapshot retention. ip-api.com's free offering lacks HTTPS and commercial eligibility; ipapi.co's free tier is for testing/development. These are not the selected production solution.

Leadfeeder/Dealfront may improve corporate matching coverage through its maintained identity data, but no Farpoint-specific comparison has demonstrated that benefit. Keep it replaceable. Firecrawl can research a known company/domain and supply sourced context; it does not by itself supply the missing IP-to-employer mapping. No relevant installed ChatGPT IP-company connector was verified; a tiny Python HTTPS adapter is sufficient if a service is selected.

Each enrichment observation records its own identifier, input receipt/event references, provider, fetch time, raw response where retention is permitted, rule version and evidence category. Use labels such as declared company, inferred network organization, possible corporate match, or unknown. Suppress employer inference for ISP, hosting, mobile, VPN, proxy, relay and ambiguous shared networks. Avoid invented confidence percentages. Record provider errors and quota exhaustion; never let them interrupt collection or erase records.

## 8. Private exports, Drive archives and recovery

R2 objects are private. Public visitors may submit data but cannot enumerate, read, modify, delete or export it. The service's MCP export tools require the verified owner identity plus explicit application authorization. Sites view permission alone is insufficient because the collector is public. Configure the allowed Site-scoped oai-authenticated-user-id through a verified owner session before exposing exports; never use first-caller-wins registration or a request-supplied owner identifier. Verify that identity headers cannot be forged on public routes. A hosting bypass token is not an owner identity and cannot authorize exports. Fail closed when identity is absent or incorrect. Credentials remain in managed secret storage, never browser code or GitHub.

Export operations list private records with opaque cursor pagination and return bounded chunks with IDs, hashes and completion metadata. A page of output is not a complete export. Follow continuation until the provider signals completion. Cap output size without silently truncating it. Persist immutable export manifests and separate completion records so interrupted exports can resume. Direct developer table-read tools are not the archival interface.

Scheduled Work runs daily collection/archive and a weekly report, proposed at 08:00 America/New_York; schedule activation and unattended connector access must be tested before calling it operational. Every archive uses a unique run ID and new Drive file IDs. Include exact raw receipts, enrichment observations, relevant captured Gmail evidence, schema metadata, checksums and source object keys. No updates to a single events.csv or overwriting yesterday's file.

On each run, rescan unfinished/recent partitions and reconcile against completed manifests. Periodically enumerate all source objects to catch late records or incomplete cursor runs. The initial volume permits a full reconciliation on every daily run; optimize only with evidence. Record the reconciliation cutoff and mark any report incomplete if extraction failed. Concurrent writes after cutoff belong to a subsequent run, not silent missing data.

Drive is an independent archive but ordinary Drive files are not a write-once legal vault. Use create-only application operations, restricted access and verified checksums. Keep archival raw data in a private restricted location; the Technical documentation folder must not automatically inherit public access for customer data. Verify actual sharing before using any folder as a data destination.

Daily archives leave up to a scheduled interval of unreplicated data, longer if a run fails. Show last successful archive time and outstanding lag. Storage durability plus backups is not a mathematical no-loss guarantee. If zero loss under a primary-provider catastrophe is required, a second durable write before acknowledgement is necessary and adds a failure dependency; do not pretend daily backups provide it. The non-deletion policy remains absolute for routine operation.

Recovery must restore raw objects into a separate destination and compare every hash before replaying analysis. Never restore by overwriting a live store. Preserve both original and reconstructed records and record the relationship. Expanding capacity, changing hosting or replacing a provider must copy and verify history before any routing change, without deleting the source.

## 9. Analysis, conversion evidence and report contract

Use saved Python with pinned dependencies; do not generate new business logic from scratch on each schedule. Preserve raw inputs and produce derived tables for validated events, deduplicated events, sessions, campaign touches, inquiry receipts, company observations and funnel outcomes. Version every transformation and exclusion rule.

Deduplicate using event_id plus a stable event-payload hash. Define canonical event serialization and its hash version in the schema; immutable event contents exclude per-attempt transport metadata. This event hash is separate from the exact raw HTTP-receipt body hash, so putting an unchanged event into a different batch does not create a false conflict. Preserve the original raw bytes as well as the canonical derived representation. Identical retransmissions count once in the analytical event view while every receipt remains. The same event identifier with different canonical payloads is a conflict to retain and flag, not a last-write-wins update. Bot/test/invalid records remain in raw storage and receive explicit derived exclusion reasons.

Capture source/campaign at observed entry and retain all permitted touches. Report first observed touch and inquiry-session touch separately. Do not overwrite an earlier campaign with a later one. Direct/unavailable referrer is an unknown-source category, not proof of organic acquisition. No cross-device stitching or person identity from IP address alone.

The conversion ladder is: quotation attempt, provider-accepted submission, and independently observed inbox receipt. A received inquiry matched by inquiry_id is the conversion evidence. Save the Gmail message identifier, source timestamp and captured content used for the match in the private archive; future analysis must not depend on a mailbox search returning the same data forever. Preserve all fields of received quotation submissions and relevant attachments in the private quotation archive, separate from the analytics payload. Verify connector attachment/raw-message completeness during acceptance.

Mailto clicks are intent. Direct email inquiries count as received inquiries but remain unattributed unless evidence connects them. A visit to a thank-you URL is not a received inquiry. Provider acceptance without a matching receipt is delivery_unverified; a later receipt appends evidence and revises the derived outcome without changing the original report.

Report questions and evidence:

- Who is coming? Observed sessions and acquisition channels; named contacts only when submitted; separately labeled inferred company/network context and unknown share.
- What stages do they reach? Product/application/reference engagement, quotation view/start/attempt/provider acceptance/received inquiry, with denominators shown.
- Where do conversions happen? Landing page, campaign, product path and inquiry-session attribution, joined to received inquiries.
- When is it an error? Observed script/transport failures, form validation and unmatched provider acceptance reported separately. Do not label user input validation as a site outage.
- When is interest lost? Drop-off without an observed error. This is an observation, not proof of motive. An error before exit is association, not established causation.

Use a configurable session inactivity window, initially 30 minutes as an analysis convention, not an observed truth. Daily/weekly reports display the timezone, window, cutoff, coverage warnings and small-sample counts. Initial weekly report: traffic/source mix, funnel, received inquiries, candidate companies, error/drop-off segments, data-health status and evidence-linked actions. Sales-stage progression beyond received inquiry requires a separate recorded outcome; it cannot be inferred from browsing.

Every analysis run stores run_id, exact input object IDs/hashes, enrichment versions, code commit, dependency lock, configuration, event definitions, timezone/window/cutoff, numerical outputs, report, warnings and prompt/model metadata if prose uses a model. Save original prose and research sources. A rerun creates a new run and may point to the run it supersedes; it never replaces it.

## 10. Security, scale and failure handling

Separate anonymous ingestion from owner-only export. Test authorization with no identity, another identity and forged headers. Do not expose raw data through website assets, logs, public storage or the public repository. Treat received bodies and retrieved web/email text as untrusted input; never execute instructions contained in them. Analysis parsing must not execute embedded code or render untrusted HTML.

Only IPs go to any approved IP provider. Firecrawl receives public company/domain research inputs, not RFQ bodies or attachments. Verify account/workspace data controls and provider terms before private customer data enters a new processing path. Do not assume personal ChatGPT settings equal a business-data contract.

Preservation does not justify collecting unnecessary personal information. No routine retention purge is configured. Any mandatory legal request that conflicts with the owner's policy must be escalated for an explicit decision; software must not invent a deletion exception. Provider selection must avoid licenses that force deletion of required historical evidence.

Size planning uses assumptions until actual traffic is measured. Illustrative estimate: 10,000 events/day at 2 KiB each is about 20 MiB/day or 7 GiB/year before envelopes, duplicates, indexes, archives and attachments. This is a sizing example, not observed traffic. Sites documents a 10 GB D1 limit; it would not be a permanent history solution. R2's documented lack of a fixed Site storage cap is not a promise of perpetual unlimited free retention.

Alert on collection write failures, unmatched accepted inquiries, export failures, missing scheduled runs, archive lag, hash mismatches, quota exhaustion and abnormal growth. Do not infer collector health from zero traffic alone. Use a synthetic canary through the collector and confirm its durable receipt/export; exclude it analytically while preserving it. Detection and notification execution must be demonstrated in Work, including missed-run visibility, before reporting monitoring as complete. Capacity or billing problems trigger escalation and expansion, never eviction.

The public endpoint necessarily faces abuse and platform limits. Preserve admitted bad records; distinguish edge-blocked requests, application failures and analytical exclusions in operational reporting. A larger attack may exceed quotas. Do not claim complete adversarial traffic preservation or spend unlimited funds automatically.

## 11. Decision log and rejected additions

D01 — Keep Pages initially. It already serves the website; full migration saves cross-origin setup but adds DNS and release risk without resolving IP or preservation questions.

D02 — One small Sites collector is the first candidate. It provides direct agent deployment and managed storage without a new dedicated server. Acceptance depends on actual IP provenance, authorization, retention and recovery tests.

D03 — R2 raw objects are canonical; no D1 initially. Files suit append-only history and expected analysis volume. An optional index must remain reconstructable.

D04 — ChatGPT Work executes versioned Python. A persistent model endpoint, Cloud Run analysis service, Postgres and a separate dashboard are not required for the requested reporting.

D05 — GitHub holds reusable source/design; Drive holds readable project records and private archives. Hosting, source control and data backup are distinct responsibilities.

D06 — Preserve everything collected; interpret through new versions. Duplicate removal, bot filtering and corrections belong in derived views only. Old raw-IP expiration and rolling-log assumptions are superseded.

D07 — Begin with open network context; company inference is an interchangeable enhancement. No vendor has demonstrated Farpoint-specific matching accuracy. Security and permanent-retention terms are gates, not details to waive for a free tier.

D08 — Keep FormSubmit/Gmail initially. Match the existing inquiry route using identifiers and receipt evidence; an analytics collector must not become a form availability dependency. Form delivery remains independently testable.

## 12. Acceptance tests and release gates

G1 — Record preservation: valid, malformed, unknown-schema and duplicate fixtures survive exact byte/hash comparison. Duplicate retries, including the same event in differently composed batches, yield multiple receipts and one analytical event. Conflicting duplicate IDs are flagged. Conditional write collisions cannot replace objects.

G2 — Failure semantics: storage failure returns no successful acknowledgement; later retry persists. A crash after durable write but before response produces a preserved duplicate on retry. Out-of-order acknowledgements while new events enter the outbox clear only matching saved event versions. Retained invalid batches do not loop forever. Analytics failure never prevents a valid quotation submission.

G3 — Identity and access: known independent network origins match the trusted source-IP field; forged headers do not. Anonymous and other-user clients cannot read/list/export/change/delete records. Test both default and intended custom-domain paths. Report unsupported IP provenance as a failed company-attribution gate.

G4 — Export completeness: fixtures exceed one provider page and one tool-response limit. Interrupted, late and concurrent writes appear through reconciliation. All source keys and hashes are accounted for. A failed export cannot produce a report labeled complete.

G5 — Recovery and history: restore an archive into an isolated store, compare raw hashes, reproduce numerical outputs using pinned code, and confirm originals remain. Enrichment changes, report reruns, redeployment and code rollback preserve prior data. Verify retention controls and backup access restrictions.

G6 — Funnel evidence: desktop/mobile controlled inquiries preserve submitted fields and reach quotes@farpointenergy.com, with inquiry/session matching. Test validation, provider rejection, timeout, double click, mailto, no JavaScript and unavailable analytics. Preserve reference selection and requirements. Do not call inbox delivery verified without observed receipt.

G7 — Operations: demonstrate a scheduled unattended export and analysis run, a failed-run warning, a canary receipt and archive-lag visibility. Confirm storage capacity/price assumptions and no lifecycle deletion rules. Test provider quota/errors and append-only enrichment history.

G8 — Website quality: run existing reproducible build/preservation/inquiry/context checks; examine 390, 768 and 1366 px layouts plus 320 px overflow, keyboard focus and the menu. Verify unchanged product breadth, references, warranty and founder copy. Any future hosting move repeats route/HTTPS/form tests before DNS cutover.

Staff review must resolve correctness defects in this design and later in implementation. Unrun acceptance tests remain explicitly unrun. No reviewer can convert an unmet requirement into a claimed success by relabeling it out of scope.

## 13. Implementation sequence and open assumptions

First, review this design and preserve the decision record. Then build a bounded collector feasibility candidate with synthetic data to prove trusted IP, owner-only export, conditional writes and retained history. These tests precede real customer analytics.

If the candidate passes, implement the small tracker, inquiry identifiers, private exports and versioned Python. Run preservation/failure/recovery tests, then desktop/mobile and controlled inbox tests. Activate scheduled work only after unattended access and failure reporting are verified. Publish a release record with exact commits, deployed endpoints, test results and unresolved gaps.

If Sites fails an essential contract, document the failing test and evaluate the same small collector plus object storage on an established provider. Do not add an analysis server or database solely to change hosting. A full website migration is optional and is considered only after the collector requirements are satisfied.

Open assumptions: actual traffic volume; Sites account/domain eligibility; trustworthy original-IP propagation; storage-lock access; recovery behavior after account/site deletion; scheduled Work completeness and missed-run visibility; ability to capture full quotation/attachment evidence; enrichment retention permissions; actual company-match coverage; private-data account settings. These are concrete test or policy decisions, not hidden dependencies.

## 14. Evidence and research boundaries

Checked 23 October 2026. Product features, quotas, licenses and availability can change. No live Farpoint traffic has been sent to the researched enrichment vendors as part of this design research. No provider accuracy benchmark or production collector test is claimed.

- Current website source and workflow: https://github.com/FarpointEnergy/farpointenergy.com and its README at the baseline commit above.
- Sites domains, analytics and saved versions: https://learn.chatgpt.com/docs/sites/managing-a-site
- Sites storage limits and runtime scope: https://learn.chatgpt.com/docs/sites
- Sites pricing/beta eligibility: https://learn.chatgpt.com/docs/pricing
- Sites data/connections: https://learn.chatgpt.com/docs/sites/data-and-connections
- Installed Sites skill: source workflow, storage and Site MCP server references, version 1.1.1. The native add_custom_domain tool confirms apex and subdomain record types; a tool capability is not a completed deployment.
- Cloudflare original-IP header behavior: https://developers.cloudflare.com/fundamentals/reference/http-headers/
- R2 conditional writes, consistency and pagination: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- R2 storage locks: https://developers.cloudflare.com/r2/buckets/bucket-locks/
- Public-domain network data: https://iptoasn.com/
- ipapi.is free quota/features: https://ipapi.is/pricing.html and https://ipapi.is/developers.html
- ipapi.is retention and processing terms: https://ipapi.is/terms.html and https://ipapi.is/dpa.html
- IPLocate quota, data, terms and MCP: https://www.iplocate.io/pricing ; https://www.iplocate.io/docs/ip-intelligence-api/data-types ; https://www.iplocate.io/legal/terms ; https://www.iplocate.io/docs/integrations/mcp-server
- IPinfo Lite and separate company data: https://ipinfo.io/lite and https://ipinfo.io/data/ip-company
- Open-source registry client: https://github.com/secynic/ipwhois
- GeoLite license/update conditions: https://dev.maxmind.com/geoip/geolite2-free-geolocation-data/
- Other free-tier exclusions: https://ip-api.com/ and https://ipapi.co/free/

The comparison covers meaningful open datasets, registry clients, free hosted IP services, maintained commercial company mapping and available plugin paths. It does not assert that every possible supplier has been found. Future evidence can improve implementation choices while preserving the owner's fixed goals.

## 15. Staff-engineer review record

23 October 2026: two independent AI reviewers examined the actual document, one focused on preservation/reproducibility and one on hosting/domains/GitHub/authorization/IP correctness. Both approved the staged implementation plan after a correction and re-review loop. Neither changed the owner's goals or certified production readiness.

Resolved findings: distinguish exact receipt-body hashes from canonical event hashes; acknowledge only the exact submitted batch; preserve unacknowledged events during overlapping retries; give retained invalid batches terminal outcomes; add rebatching and out-of-order acknowledgement tests; preconfigure the verified Site-scoped owner identity; reject hosting-bypass tokens as owner identity; retain the nonsecret project_id in the tracked manifest; and use the documented 10 GB D1 limit.

Final disposition: no blocking design defects remain within the reviewed scope. Every production gate in section 12 is still unrun. The next executable step is a synthetic collector feasibility test, not a production DNS migration or a claim that attribution already works.
