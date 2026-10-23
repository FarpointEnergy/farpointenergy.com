# Farpoint lead intelligence

Open-source website measurement and private lead reporting. The static site remains on GitHub Pages. This Node 24 service stores deduplicated events in PostgreSQL 15, forwards sanitized analytics to private Umami 3.4.0, imports authenticated FormSubmit receipts, and prepares daily/weekly Gmail reports for `karan@farpointenergy.com`.

The approved [design](../docs/lead-intelligence-design.md), [review record](../docs/lead-intelligence-review.md), [deployment runbook](../docs/northflank-deployment.md) and [acceptance evidence](../docs/lead-intelligence-acceptance.md) are authoritative. Production analytics is disabled until live release gates pass. An accepted form, a received RFQ, an email-link click and a delivered digest are separate states.

A [synthetic weekly report example](../docs/sample-lead-report.html) shows the output format using invented activity and contacts; it is not live traffic.

## Development checks

```sh
npm ci --ignore-scripts
npm test
# Only against disposable test databases; integration tests reset test schemas.
node --test --test-concurrency=1 test/*.integration.mjs
```

The integration suite needs `DATABASE_URL`, `TEST_DATABASE_URL`, `UMAMI_TEST_DATABASE_URL`, and `UMAMI_SOURCE_DIR` pointing to the exact upstream commit in the design. GitHub Actions provisions native PostgreSQL and the pinned Umami image. PGlite development runs cannot satisfy native concurrency or production persistence acceptance.

From the repository root, also run `python3 build.py`, `python3 check_site.py`, `node check_inquiry.js`, `node check_context.js` and `node check_analytics.js`. A reproducible build must leave no generated-file differences.

## Runtime commands

| Command | Purpose |
| --- | --- |
| `node src/runtime.mjs migrate` | Apply transactional migrations once; requires only the Farpoint DB connection. |
| `node src/runtime.mjs serve` | Public collector and authenticated private report/status APIs; outbox every 30 seconds. |
| `node src/runtime.mjs hourly` | Daily QA probe when due, resumable RFQ import, delivery reconciliation and reports due at 08:00 New York. |
| `node src/runtime.mjs probe` | Authenticated synthetic event through real HTTPS ingress and private Umami QA website. |
| `node src/runtime.mjs initialize-journal` | One-time provisioning of the independent encrypted inventory; never use to repair a missing restore journal. |
| `node src/runtime.mjs maintenance` | Journal expiry, aggregate rollup, retention in both databases and encrypted backup/read-back. |
| `node src/runtime.mjs backup` | Encrypted snapshots of both databases, verified remotely before old snapshots expire. |
| `node src/runtime.mjs erase /private/request.json` | Operator-only analytics erasure with stable request UUID, independent journal and verified host exclusion. |
| `node src/runtime.mjs recover` | Replay the independent journal and current retention before reopening a restored/interrupted deployment. |
| `node src/runtime.mjs download-restore snapshots/… /private/output.dump` | Download and authenticate an encrypted snapshot before any separate `pg_restore` operation. |

Use the names-only examples in `deploy/`; set actual secrets through host controls. `.env` is Compose interpolation only, `.env.collector` contains the public service's limited credentials, and `.env.maintenance` contains maintenance-only credentials. Never commit filled values. Umami has no public port. Run `deploy/grant-maintenance.sql` as owner after upstream migrations; it denies destructive access to authentication/configuration tables.

Erasure request shape (use real IDs only in a private file):

```json
{"requestId":"11111111-1111-4111-8111-111111111111","ids":{"browserIds":["22222222-2222-4222-8222-222222222222"],"inquiryIds":[],"gmailMessageIds":[]}}
```

Keep the same request ID for retry. Maintenance controls do not delete Gmail business correspondence or previously delivered digests. No prospect outreach is automated.

## Reporting and operational limits

Set `REPORT_CADENCES=weekly` initially, or `daily,weekly` for both. Reports cover the prior complete New York calendar day/week, including DST. Exact recent totals come from the Farpoint event store. Anonymous traffic stays anonymous; network-owner matches are inferred, and submitted contacts are described as supplied by the sender. QA activity uses a separate Umami website and is excluded from business totals.

Configure registered opaque campaigns in both server and browser registries. Private account labels belong only in server configuration. The public collector rejects arbitrary URL/query/form data. Company enrichment remains disabled until the deployed proxy's source-IP contract and free API account are verified.

The private object store must support strong read-after-write, complete listing and conditional writes (`If-None-Match` and `If-Match`). Keep the encrypted manifest permanently; retain request/completion objects for at least 100 days and database snapshots for seven days. Verify real provider semantics, storage cost and a restore drill before launch. Reconciliation never blindly resends an ambiguous message; stale unresolved deliveries remain visible for manual inspection.
