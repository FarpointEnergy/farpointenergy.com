# Lead intelligence — independent review record

Goals may be changed only by Karan. Approval here concerns design/implementation correctness and never waives production acceptance.

## Design round1 — v0.1 — REQUEST CHANGES

Reviewer: independent staff engineer (`design_staff_review`). Findings: public Umami ingestion isolation, exact API/SQL contracts, outbox and enrichment crash behavior, report-send state machine, strict RFQ authentication/parser, deploy topology/cost/OAuth, explicit health/retention, pinned Umami payload semantics. All eight are mechanism fixes; goals unchanged.

Resolution draft v0.2: section15 supplies concrete contracts; Umami has no public ingress; private collector is sole source; reporting counts come from deduplicated PG; forwarded Umami geography explicitly unavailable (company enrichment remains separate real-ingress gate); recipient/inbox verification distinct from provider acceptance; review pending.

## Design round2 — v0.2 — REQUEST CHANGES

Two remaining findings: reconcile obsolete transport/Umami prose; specify aggregation and metric semantics including deduplication, QA, late receipts and denominators. v0.3 resolves these in sections5/8/15.2 and15.5. No goals changed. Additional edge cases preserved: opt-in after earlier form interaction, browser-expiry attribution reset, and native unlinked RFQs.


## Security review — v0.4 — APPROVED FOR IMPLEMENTATION

Reviewer: independent security/correctness reviewer (`design_security_check`). Concrete blocker in v0.3: stated retention/erasure omitted replicated Umami data, and restore replay lacked a durable off-snapshot deletion record. Verified Umami v3.4.0 local source (`prisma/schema.prisma`, `src/queries/prisma/session.ts`, `src/queries/prisma/website.ts`); direct SQL cannot rely on cascades because relationMode is prisma.

v0.4 section15.6 resolves the blocker with explicit session/event/dependent-table purge, separate maintenance-only DB authority, shared/exclusive privacy locks and a persistent gate, stopped-Umami erasure to exclude ambiguous remote writes, encrypted verified off-snapshot journal, browser/inquiry/Gmail tombstones preventing replay, bounded retention, and mandatory crash/restore/provider evidence. A15 now requires real erasure/retention checks across both databases. Also incorporated the staff review clarification that conversion numerators use only sessions in the observed-page-view denominator cohort. Project goals unchanged.

Security design verdict: APPROVED FOR IMPLEMENTATION, subject to the documented deployment and acceptance gates; this is not a claim that erasure SQL, restore or production delivery has already passed runtime tests. Final staff approval of the complete v0.4 design remains required before implementation starts.

## Design round3 — v0.4 — APPROVED FOR IMPLEMENTATION

Independent staff reviewer: `design_staff_review`. Approved content SHA256: `952410a0a5cdfea89980b8df23cf196dee1ba486f3250b0f7edb5c02925c000d`. All blocking design findings resolved. Approval satisfies A1 only; goals remain unchanged, and A2–A16 require implementation and live evidence. Implementation began only after this explicit approval. After approval, only the document status header was changed to record the verdict; the approved design content is unchanged.

## Implementation browser review — two fix rounds — APPROVED within scope

The staff reviewer found cross-tab storage-event ping-pong and repeated Allow resetting identifiers/attribution. Both were corrected and tested in one/two-tab fixtures; actual browser QA additionally verified stable counts across two tabs and opt-out propagation. Reviewed analytics.js SHA256: `893c1e7fc3154ae5d8a474d6531a5a4edb735684caa27b0321bb3c62fd66b23d`. Existing inquiry/context/build checks pass. This approval does not imply backend or deployment approval.

## Implementation security review — corrections and scoped approval

Resolved journal installation/inventory recovery gap with CAS-protected manifest; fabricated Umami browser/OS with explicit unavailable values; QA dashboard pollution with a separate QA website; broad maintenance DELETE privileges with explicit analytics-table grants; and incomplete object-listing acceptance with strict page validation. Security reviewer reran14 journal/collector tests and found no remaining blocker in scope. Native/provider checks and exact final-revision review remain required.

## Implementation reporting review — four correction groups — APPROVED within scope

Independent staff review approved the corrections for reconciliation starvation, report byte limits, retention aggregates and importer pagination/coverage. The reviewer independently ran all16 reporting unit tests and reproduced the original oversized-report case; the bounded digest round-trips through the production parser with a matching digest. Development SQL regressions passed12 groups; native concurrency was explicitly skipped and remains a CI gate.

Eligible reconciliation work is separated from the manual backlog; stale sending becomes uncertain without automatic resend. Reports cap SQL evidence and UTF-8 output, stating omitted counts. Aggregates below the atomic raw-retention watermark are frozen. Pagination resets only after a rejected Gmail listing token, while OAuth/transport failures preserve the position; completed coverage is recorded separately from successful job execution. Orphan conversion counts are explicit. Designv0.5 records these mechanisms without changing project goals. Exact final revision and live delivery remain separate gates.
