# Farpoint lead intelligence: Northflank pilot deployment

This runbook implements the approved [technical design](lead-intelligence-design.md). It does not record a live deployment. Unit tests use synthetic Northflank responses; an actual account, its resource allowance, hosting responses, network trust and Gmail delivery must still pass the release gates below. Keep `analytics-config.js` disabled until those gates pass. The existing quotation form remains independent of analytics.

## Account and resource plan

Use Farpoint's Northflank team and a single project. Confirm account ownership and the Sandbox plan in the provider UI. The [current pricing page](https://northflank.com/pricing) advertises two services, one database and two cron jobs. Capture the actual account estimate and quota, including storage, builds, job execution and egress. A 512 MiB target for each long-running component is a sizing proposal, not proof it fits the free allowance. Do not add a card, upgrade, create another paid service, or reduce the agreed acceptance criteria to make deployment appear complete.

| Resource | Source / command | Exposure | Initial target |
| --- | --- | --- | --- |
| `collector` combined build/deploy service | GitHub repository, `lead-intelligence/Dockerfile`; `node src/runtime.mjs serve` | HTTPS public collector port 8080 | One instance, 512 MiB, shared CPU |
| `umami` deployment service | Exact Umami 3.4.0 image and digest in `lead-intelligence/compose.yaml` | Project-private port 3000 only | One instance, 512 MiB, shared CPU |
| PostgreSQL addon | PostgreSQL 15; two databases and separate roles | Private only | 512 MiB target; measured storage |
| `lead-hourly` job | The collector's reviewed build; `node src/runtime.mjs hourly` | No public port | 512 MiB target, cron `17 * * * *` |
| `lead-maintenance` job | Same reviewed build; `node src/runtime.mjs maintenance` | No public port | 512 MiB target, cron `17 5 * * *` |

Use the collector's combined service build for both jobs instead of creating a third build service. Record the deployed source commit and image digest for all workloads. Before enabling maintenance, disable Umami CI/CD, registry-triggered redeployment, automatic upgrades and horizontal autoscaling in the provider configuration; read back those settings. Avoid simultaneous infrastructure edits while maintenance is running.

Link the Northflank GitHub integration to `FarpointEnergy/farpointenergy.com` with access limited to that repository. Build context is `lead-intelligence/`, with its Dockerfile at the context root. Never copy runtime `.env` files into GitHub, build arguments, public artifacts or the website. If repository access or the free resource allocation is unavailable, leave deployment unverified and finish local/CI validation without claiming collection has started.

## Database and initial release sequence

1. Provision the private PostgreSQL addon. Use a temporary owner connection through the provider's secure console or authenticated forwarding. Adapt `lead-intelligence/deploy/init-databases.sh` to that managed connection: create `farpoint_leads` and `umami` databases, their separate login roles and the `umami_maintenance` role. The script reads passwords from environment variables, not command arguments. Do not print credentials or store owner credentials in the collector.
2. Verify the Farpoint application role cannot connect to the Umami database. The maintenance role receives `CONNECT`, `TEMPORARY`, schema `USAGE` and read access for encrypted backup. After upstream migrations, run `lead-intelligence/deploy/grant-maintenance.sql`: DELETE applies only to the nine analytics tables, never user/API-key/configuration tables. Set SELECT defaults before migrations and verify explicit DELETE grants afterward. Confirm native PostgreSQL integration tests against the resulting roles. These are separate databases within one addon, not two addons.
3. Create `umami` from the pinned image. Supply its own `DATABASE_URL`, `APP_SECRET` and `TWO_FACTOR_ENCRYPTION_KEY`; set `DISABLE_TELEMETRY=1`. Explicitly make **all** ports private, with `public=false` and `vpcAccessible=false`. Port detection can create public ports, so inspect the saved configuration. Do not expose `/api/send`, the dashboard or a share link publicly.
4. Allow Umami's first initialization to complete. Through authenticated local forwarding, change its initial admin credentials, enable available account protections, create separate Farpoint production and synthetic QA websites, and record both UUIDs privately. Confirm `/api/heartbeat` returns `{"ok":true}` from inside the project. This heartbeat verifies the process, not database persistence; test ingestion separately.
5. Build the collector at the reviewed commit. Before starting it, run `node src/runtime.mjs migrate` once using an existing job's manual command override and only the Farpoint database credential. If per-run overrides are unavailable, keep the job schedule suspended, temporarily change its command, run once, verify completion, then restore the scheduled command. Do not create a third persistent job just for migration. Migration locking prevents concurrent schema changes.
6. Start the collector with the configuration below. Verify `/readyz`, test authenticated status/report access, and confirm private report responses are inaccessible without authorization. Save the HTTPS collector origin as `COLLECTOR_PUBLIC_URL` on the hourly job. Keep the website's public endpoint empty until end-to-end validation succeeds.
7. Configure the hourly and maintenance jobs using the exact commands in the table. Choose `Forbid` concurrency. [Northflank's job documentation](https://northflank.com/docs/v1/application/run/run-an-image-once-or-on-a-schedule) notes that manually triggered executions do not use the scheduled concurrency policy; application advisory locks and delivery keys remain required. Confirm the account's cron timezone is UTC. The hourly application decides when reports are due in `America/New_York`, including DST and its catch-up window.

## Runtime secrets and connections

Use `lead-intelligence/deploy/collector.env.example` and `maintenance.env.example` as names-only starting points. Enter actual values in the provider's secret settings. Share only the subset each workload requires.

| Setting group | Workload and purpose |
| --- | --- |
| `DATABASE_URL` | Farpoint application database; collector and jobs. Use provider-supported TLS settings and private endpoint. |
| `UMAMI_URL=http://umami:3000`, `UMAMI_WEBSITE_ID`, `UMAMI_QA_WEBSITE_ID` | Collector and jobs; fixed private analytics destination. If the service is named differently, hostname must equal that service ID. |
| `ADMIN_TOKEN`, `NETWORK_HMAC_KEY`, `DELETION_HMAC_KEY` | Strong independent random secrets; collector and applicable jobs. Keep deletion key stable across restores. |
| `ALLOWED_ORIGINS`, `CAMPAIGNS_JSON`, `TARGET_ACCOUNTS_JSON` | Reviewed values. Browser campaign registry must match the server registry. No personal identifiers in campaign codes. |
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | Workloads that import RFQs or send/reconcile reports; server OAuth grant for `karan@farpointenergy.com`. |
| `GMAIL_MAILBOX`, `REPORT_RECIPIENT`, `REPORT_CADENCES` | Mailbox and recipient both `karan@farpointenergy.com`; initially `weekly`. |
| `UMAMI_MAINTENANCE_DATABASE_URL` | Maintenance job only. Never grant it to the public collector, outbox worker or hourly report job. |
| `BACKUP_S3_*`, `BACKUP_ENCRYPTION_KEY`, `JOURNAL_ENCRYPTION_KEY`, `JOURNAL_INSTALLATION_ID` | Maintenance job only; private off-instance object store and separate authenticated-encryption keys. |
| `NORTHFLANK_API_TOKEN`, `NORTHFLANK_PROJECT_ID`, `NORTHFLANK_UMAMI_SERVICE_ID`, `NORTHFLANK_UMAMI_SERVICE_UID` | Maintenance job only; lifecycle control described below. |

The existing ChatGPT Gmail connection is not a deployed server credential. Configure a Farpoint Workspace internal OAuth application where available, grant only `gmail.readonly` and `gmail.send`, approve the intended mailbox and store its refresh token securely. Verify the Gmail API profile before import/send. Do not depend on a short-lived external Testing grant. The implementation uses the Gmail API, not SMTP; it needs no paid SMTP subscription.

Start with `TRUST_PROXY_MODE=disabled`, `PROXY_TRUST_VERIFIED=false` and `ENRICHMENT_ENABLED=false`. These values make missing company evidence explicit; they do not satisfy the enrichment acceptance gate. From independent test clients, forge `X-Forwarded-For` chains and alternate client-IP/location headers. Record which headers the Northflank edge overwrites or appends and which proxy addresses are trustworthy. Configure the collector's supported extraction mode/CIDRs only after those checks. Do not trust a leftmost header simply because it is present. Then supply the free enrichment provider key, verify quota controls, and enable enrichment. The outbox intentionally sends Umami IP `0.0.0.0`; Umami geography is unavailable, and Farpoint's own event store owns visitor/session counts and separately sourced company evidence.

Verify private object-store access and its free allowance independently of Northflank's compute allowance. Provision the encrypted journal once with `node src/runtime.mjs initialize-journal`. Its stable installation UUID and website UUID bind the CAS-protected inventory; missing indexed requests must fail recovery. Verify real conditional-write semantics and strong read-after-write. Keep the manifest permanently and do not auto-initialize during restoration. Daily snapshots retain seven days. Backup and restore enforce the same1GiB encrypted-snapshot ceiling; verify measured snapshots and total retained bytes fit the actual free storage allowance. An oversized backup fails before upload/verified status. The separately encrypted deletion journal retains 100 days; snapshot cleanup must not remove journal objects. Verify read-back, failed authentication, retention behavior and restoration to isolated databases. Never use a public bucket or put backup URLs in public release evidence. See design section 15.6 for the mandatory replay sequence.

## Maintenance host adapter and permission boundaries

`lead-intelligence/src/host-lifecycle.mjs` exports:

```js
const lifecycle = createNorthflankLifecycle(loadNorthflankLifecycleConfig(process.env));
// The maintenance runner supplies these functions to erase/recover/retention:
// lifecycle.stopUmami(); lifecycle.startUmami();
```

The adapter uses a **team-scoped** token and the fixed API origin `https://api.northflank.com/v1`. Organization-wide tokens requiring a team-prefixed route are not supported. Obtain the actual service `id` and immutable 24-character hex `uid` from the service specification. The adapter compares both before mutation, rejects a build/combined target, public/VPC-exposed ports or enabled autoscaling, and never logs provider response bodies, transport errors or tokens. Its private health URL must be `http://<configured-service-id>:3000`.

Create a dedicated role with the least permissions available: **Project → Services → General → Read and Update**, restricted to this project; exclude create/delete, unrelated projects, addon, team and explicit secret-management permissions. Read back the effective role and token scope. [Northflank documents project restrictions](https://northflank.com/docs/v1/application/secure/use-role-based-access-control); this runbook does **not** assume service-only authorization exists. A project-scoped token may control both project services, and service metadata may include environment information. Compromise of that token therefore has broader impact than the adapter's fixed Umami target. Only the maintenance job receives it; never use an owner/admin token or expose it to public ingestion. Test that unrelated-project reads are denied without mutating unrelated resources.

| Operation | API and required evidence |
| --- | --- |
| Request stop | `POST /projects/{projectId}/services/{serviceId}/pause`; skip mutation when desired instances are already zero, but still verify. |
| Verify stopped | Two fresh observations, separated by polling: service desired instances zero and completed deployment before/after enumeration; every `/containers` page inspected; fresh `/health` with `current.hasMore=false` and explicit terminated states. Only `TASK_KILLED` and `TASK_FINISHED` count as stopped. |
| Request start | `POST /projects/{projectId}/services/{serviceId}/resume` with one instance, CI/CD disabled and autoscaling disabled; an already-running single-instance service is verified without another mutation. |
| Verify restarted | Two fresh running observations and successful private `/api/heartbeat` JSON `ok=true`. The Northflank token is never sent to Umami. |

Successful stop returns `{state:'stopped', allInstancesStopped:true, verification:...}` with the target UID, hosting observation time and a digest of sanitized evidence. Successful start returns `{state:'running', privateHealthVerified:true}`. Missing, stale, truncated, contradictory or unknown hosting evidence fails closed. A 409 on resume is not success: the full read-back and heartbeat still have to pass. A timeout, health failure, HTTP 200 pause acknowledgement or zero desired count alone never proves processes are stopped.

Defaults are a five-second polling interval, a five-minute total wait, ten-second request timeout, at most 60 polls and ten container pages per observation. Provider HTTP errors stop control-plane verification rather than retrying mutations blindly. Startup heartbeat can recover within the polling deadline. If the account's real response schema differs from the documented contract, preserve the gate and resolve the discrepancy; do not weaken evidence checks to pass a test.

The adapter does not acquire database locks or clear the maintenance gate; the maintenance runner owns that sequence. All operators must avoid manual resume, scaling, deployment or alternative Umami processes during erasure. Automatic deployment triggers must already be disabled and verified in the provider configuration: the documented service response does not expose a dependable `disabledCD` field, so this adapter cannot certify that precondition by itself. The target must contain every Umami process capable of writing this database. If a second service or a manually started copy writes to it, this adapter cannot prove exclusion.

To erase, provide a private JSON request file to `node src/runtime.mjs erase /private/request.json`; never place customer/browser identifiers directly in command arguments. If interrupted, keep the persisted maintenance gate active and rerun the same request or execute `node src/runtime.mjs recover` as applicable. After restoring a database snapshot, keep ingestion and jobs gated, replay the independent journal with `recover`, verify both databases and private health, and only then reopen collection. A failed command must not be described as a completed erasure.

## Acceptance evidence and launch

Use a private release checklist with timestamps and nonsecret evidence references. Keep actual contact data, RFQ content, tokens and response dumps out of this repository.

- Confirm the reviewed build and native PostgreSQL tests pass. Test one runtime restart, database interruption, quota exhaustion and unavailable external providers.
- Prove private Umami and PostgreSQL are unreachable publicly. Inspect live requests on desktop and mobile: no analytics before consent, no raw query strings/referrers/form data, functional withdrawal and self-exclusion, unchanged RFQ behavior.
- Submit a clearly identified QA RFQ. Verify FormSubmit acceptance separately from authenticated receipt at `quotes@farpointenergy.com` in Karan's mailbox, field preservation and attribution linking. QA records must not inflate prospect totals.
- Run the real hourly job and verify a report's rendered content, stable Message-ID, Gmail provider acceptance and matching inbox receipt. Test a second execution for duplicate suppression and an ambiguous-send recovery case. Provider acceptance is not inbox verification.
- Run an authenticated synthetic collection probe, verify durable event/outbox state and private Umami persistence. Prove the actual trusted-IP extraction and a company-enrichment lookup; record unknown/shared/proxy results accurately.
- Run a synthetic erasure and restore exercise against the actual private Umami version. Confirm all hosting processes stop, erased records do not return, unrelated records survive, fresh private health passes and the gate is cleared only after journal completion. Validate the least-privilege token's actual access.
- Confirm measured resource fit stays within the account's free allowance, including backup storage and build/job costs. Record a tested browser URL for private dashboard access through authenticated forwarding; never publish the analytics dashboard to create a convenient review link.

Only after these gates pass, set the website's public analytics endpoint and enable its configuration, rebuild, review and deploy the static site through the existing GitHub workflow. Recheck the deployed desktop/mobile site and a production QA probe. For rollback, disable website analytics first, pause scheduled jobs and preserve the databases and deletion journal. The RFQ email/form path continues to operate.

At preparation time, authenticated Northflank deployment access, real free resource allocation, effective permission scope, edge-IP trust, dedicated Gmail OAuth approval, off-instance backup allocation and actual hosted report delivery remain unverified. Local tests and this runbook resolve implementation readiness; they do not close those live gates.

## API references verified for this adapter

- [Pause service](https://northflank.com/docs/v1/api/project/services/pause-service)
- [Resume service](https://northflank.com/docs/v1/api/project/services/resume-service)
- [Get service](https://northflank.com/docs/v1/api/project/services/get-service)
- [List service containers, including pagination](https://northflank.com/docs/v1/api/project/services/list-service-containers)
- [Current instance health and termination evidence](https://northflank.com/docs/v1/api/project/services/get-service-instance-health)
- [Private service ports](https://northflank.com/docs/v1/application/network/configure-ports)
- [API token scopes and routes](https://northflank.com/docs/v1/api/use-the-api)
- [Umami 3.4.0 heartbeat implementation](https://github.com/umami-software/umami/blob/v3.4.0/src/app/api/heartbeat/route.ts)

### Independent storage candidate

Use a native Farpoint-owned Tigris account and a private Standard-tier **Single-region** bucket, with a documented location such as `iad`. Configure `BACKUP_S3_ENDPOINT=https://t3.storage.dev` and `BACKUP_S3_REGION=auto`. This is a prepared option, not provisioned infrastructure.

Official [pricing](https://www.tigrisdata.com/pricing.md) advertises no card required to start,5GiB Standard storage,10,000 Class A and100,000 Class B requests per month. [Conditional operations](https://www.tigrisdata.com/docs/objects/conditionals/) support create-only `If-None-Match` and ETag `If-Match`. [Bucket locations](https://www.tigrisdata.com/docs/buckets/locations/) distinguish strongly consistent Single-region/Multi-region from default Global and Dual-region configurations. Use [private bucket settings](https://www.tigrisdata.com/docs/buckets/create-bucket/) and [bucket-restricted access keys](https://www.tigrisdata.com/docs/iam/manage-access-key/), disabling Default allowed operations.

Verify actual account allowance, location, privacy, permissions, version/soft-delete retention and quota-exhaustion behavior. A published free allowance is not a guaranteed billing hard cap. Run real concurrent CAS/create-only, immediate read-back, anonymous-denial and restore tests before acceptance.

Backup pruning deliberately uses a strict seven-day cutoff after both new snapshots verify. A fixed daily schedule therefore retains8 daily sets at the exact boundary and temporarily reaches9 sets. Budget **9 × combined encrypted daily dump size + journal + retained versions/headroom** against the actual free allowance. The1GiB per-file safety bound alone does not establish aggregate free-tier fit.
