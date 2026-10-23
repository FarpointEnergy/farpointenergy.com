# Lead intelligence acceptance evidence

This record distinguishes executed checks from required live verification. No analytics service, production endpoint, OAuth grant or scheduled report is claimed as deployed by this document. The original project goal remains fixed.

## Executed during development

- A1: independent staff and security design approval of v0.4 after three rounds, recorded in the review log.
- A2–A4: reproducible website build, existing inquiry/navigation/context checks and new consent/privacy/state tests pass. Production config remains disabled. The browser review fixed cross-tab event loops and non-idempotent repeated consent choices.
- A5: actual browser inspection of desktop and 390-pixel mobile quotation layouts. Opening/closing preferences preserves requirements/reference selection, leaves technical details collapsed, restores keyboard focus and produces no horizontal overflow. Real browser tabs with a **synthetic event sink** verified repeated Allow does not add visits, cross-tab actions do not loop, and withdrawal stops subsequent events in both tabs. This is UI evidence, not a live collector test.
- A6/A9/A12/A13: unit, actual HTTP-boundary and development SQL checks cover hostile input, strict schemas, source-IP trust, enrichment classifications, quotas, receipt authentication/field limits, DST, report escaping and delivery states. Native database/provider evidence remains separate.
- A11 partial: the already-received real FormSubmit QA email was parsed by the new importer. All 20 customer field values matched an independent HTML parser after normalizing CRLF to LF. It was correctly classified as QA and unlinked because that older submission predates the new inquiry-ID field. Actual email bodies/contact values were kept out of Git. This does **not** prove the new unattended OAuth importer or a newly submitted ID join.
- Combined implementation:49 unit/adversarial tests pass. Reporting development SQL:12 pass with1 native-concurrency skip. These counts do not substitute for native CI or live-provider acceptance.
- Dependencies are version pinned. Initial audit reported zero known vulnerabilities; CI repeats the audit at the tested revision.

## CI and production gates still to record

| Gate | Required evidence |
| --- | --- |
| A7 | Native PostgreSQL migrations, constraints, concurrency, outbox/report/privacy locks and restart persistence. |
| A8 | Exact Umami image receives sanitized events; QA separation, missing geography/browser/OS, outage isolation and purge verified. |
| A10 | Actual Northflank edge/proxy spoof tests and verified enrichment source. |
| A11 | New QA RFQ sent through deployed page, all fields received, random inquiry ID joined, unattended importer authorized. |
| A14 | Actual hosted job sends one digest; matching recipient INBOX message verified; scheduler and duplicate suppression read back. |
| A15 | Free resource/storage allocation, scoped secrets, private ingress, object-store CAS/durability, encrypted backup and restore, host-stop proof, retention and health. |
| A16 | Exact final tested revision independently approved, deployed and checked after release. |

Open access dependencies: authenticated Northflank account; dedicated Gmail server OAuth grant; private off-instance storage with verified free capacity. Existing connected Gmail access can inspect receipts but does not supply a deployable OAuth refresh token. These are live release gates; they cannot be changed to “passed” by local mocks or review approval.
