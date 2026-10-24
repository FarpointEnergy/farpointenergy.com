# Farpoint collector

This is the dependency-free Worker ESM core for technical design v1.1. It is a synthetic feasibility implementation until the hosted security, IP, retention, archive and recovery gates pass. Local tests do not establish the Sites gateway or R2 account policy.

`core.mjs` exports `createCollector`, `R2CreateOnlyStore`, `sha256`, `base64`, body/chunk limits and the collector version. The Sites owner integrates the module with its Worker starter and supplies the private R2 binding and managed configuration. No D1, enrichment call, analytics parser, external database or model endpoint runs on the ingestion path.

## Routes

- `POST /v1/events` admits at most 32,768 uncompressed received bytes from the exact configured website Origin. The only accepted media types are `application/json` and `text/plain` (for beacon delivery). Empty, malformed, invalid UTF-8, duplicate-key and over-count JSON bodies within the transport limit are preserved byte for byte. Content-Length never substitutes for the streaming byte limit.
- `OPTIONS /v1/events` permits POST plus Content-Type from the configured origins. Origin/CORS is a browser access policy, not caller authenticity or bot protection.
- `GET /health` returns only `{"status":"available"}`. It proves that this route executed, not that storage, real-visitor capture, export or backups are healthy.
- `POST /mcp` exposes MCP 2026-07-28 discovery and tool descriptions. Every data operation separately requires the configured owner plus an explicitly enabled trust mode: verified general gateway identity, or the bounded owner-private Sites MCP feasibility mode described below. There are no raw object URLs, debug routes, update routes or delete routes.

An accepted body is written synchronously to `receipts/YYYY/MM/DD/<receipt_id>.json` under a newly generated key with the R2 `etagDoesNotMatch: '*'` conditional. A failed precondition allocates another key without replacing an object. A storage failure returns 503 and no success acknowledgement. Receipt success is HTTP 202:

```json
{"status":"retained","terminal":true,"receipt_id":"generated-random-id","receipt_body_sha256":"sha256-of-exact-http-bytes","analytical_status":"not_evaluated"}
```

The terminal outcome means the exact batch is durable. It never says the events are valid. Validation and quarantine are versioned analysis observations; no JSON parser or schema validator can prevent retention. This implementation choice follows the design's separation of durable receipt from analytical validity and prevents invalid bodies retrying forever.

## Receipt v1

Each record has `receipt_schema_version`, `receipt_id`, UTC `received_at`, `receipt_body_sha256`, lossless `body_base64`, `body_bytes`, normalized supported `content_type`, allowlisted `origin`, `collector_version`, selected `transport` and `source_ip` evidence. The R2 object's SHA-256 custom metadata covers the full serialized receipt; it is different from the HTTP-body SHA-256.

Cookies, Authorization, arbitrary request headers, referrer strings and forwarded IP headers are not copied. Source IP defaults to `{status:"unavailable",provenance:"unverified",address:null}`. A wrapper may supply `verifiedSourceIp` only after actual provenance tests. Exceptions or unusable evidence keep the address unavailable and do not obstruct receipt persistence. This is not yet an employer-identification implementation.

Rejected transport requests preserve bounded categorical rejection metadata where storage is available; they do not pretend to retain rejected body bytes. Missing/foreign Origin, unsupported compression/media type, body read failure and overflow have fixed public reason codes. Downstream/provider errors never echo exception text. Edge-rejected requests that never execute this code are outside its observed boundary.

## Private export

The wrapper must configure `ownerIdentity` from a verified owner session, `verifiedGatewayIdentity: true` only after actual hosted anti-spoof checks, and a managed random `cursorHmacKey` of at least 32 bytes. The default denies exports. The string `"false"` or `"true"` cannot enable identity trust. A bypass bearer token does not establish owner identity. Never configure the owner from the first caller, a tool argument or an email display field.

The separate `privateSiteMcpOwnerAccess: true` option permits the same existing list/chunk operations for an owner-private Sites feasibility candidate, relying on Sites' documented authenticated MCP forwarding and an exact owner match. It also requires the cursor secret before either operation can run. The Sites wrapper enables it only on `POST /mcp` with both `PRIVATE_CANDIDATE_BOOTSTRAP=1` and `PRIVATE_OWNER_EXPORT_ENABLED=1`, and a valid configured cursor secret. `GATEWAY_IDENTITY_VERIFIED` remains `0`; this mode does not certify public-route anti-spoofing or production readiness. Verify one-owner audience, genuine plugin owner match and no-identity denial before opt-in. Disable the private export flag before any audience change. See the [private export addendum](../../docs/technical/lead-intelligence-private-export-addendum-2026-10-24.md) for rollout and evidence requirements.

The default store prefix is empty. An optional single safe `storagePrefix` such as `candidate/` isolates a namespace. Exports cannot address another prefix. Do not change a production prefix to make old history inaccessible without an explicit migration/reconciliation plan.

Tool-call envelopes accept optional MCP `params._meta` objects as inert transport metadata, within the existing 16 KiB total request limit. Metadata is not identity, tool arguments, stored data or response content. Unknown other parameter fields, malformed metadata shapes and invalid business arguments remain rejected. This compatibility behavior does not establish full MCP protocol conformance.

- `list_records({namespace:"receipts"|"rejections",cursor?,limit?})` returns object key, full-record SHA-256, size, continuation, scan time and `transactional_snapshot:false`. Follow every continuation even on a short page. HMAC cursors bind the provider cursor, owner, namespace and issue time. Tampering, expiry, wrong scope or invalid provider continuation fails closed. On `page_budget_exceeded_retry_smaller_limit`, retry the same input cursor with a smaller limit. Never discard the failed-run evidence or advance a checkpoint. Consumers must also detect multi-page cursor cycles and duplicate/changed keys.
- `read_record_chunk({key,offset?,max_bytes?})` returns up to 8,192 raw object bytes as base64, object size/hash, exact offset/length and the next offset. Reassemble every chunk, reject gaps/inconsistent hashes and verify full size/SHA-256. `object_complete:true` describes the returned chunk reaching the end; it does not prove the consumer received earlier chunks. Missing/truncated/changed storage reads are failures.

All private responses are private/no-store and vary by identity. The list budget includes both MCP text and structured representations. The complete MCP response has a 24,000-byte hard cap. Successful enumeration is not a complete verified archive: scheduled analysis must retain exact enumeration/chunk evidence and immutable manifests, read back the independent archive, then append completion evidence. It must rescan history to discover late writes; a cursor is not a snapshot.

## Validation and release boundary

Run `node --test analytics/tests/collector/collector.test.mjs` from the repository root. The tests use an in-memory create-only R2 adapter and synthetic identities. Every test run retains its synthetic raw-store snapshots in `analytics/tests/collector/evidence`; the execution harness saves unique TAP logs. No cleanup deletes records. Keep those evidence files when copying the release package.

Run `node --test analytics/deploy/sites/owner-binding.test.mjs analytics/deploy/sites/private-export.test.mjs` for the private Sites wrapper. These read-only local fixtures test dual-flag/route/secret gating, owner rejection, bounded pagination and chunk/hash reconstruction, cache policy, and no write/delete operations. Local fixtures make no hosted calls and do not certify hosted authorization.

Tests cover byte limits, malformed-body retention, durable ACK timing, collision/failure behavior, scoped cursor pagination/chunks, replay/resume, local owner authorization, header minimization and private cache policy. They do not pass hosted identity/IP tests, storage-enforced immutability, real-inbox delivery, unattended schedules, mobile/browser checks or load targets. The broader acceptance ledger retains those gates as NOT RUN/BLOCKED until independent evidence exists.

Native adapter semantics were checked against Cloudflare's R2 Workers API reference on 23 October 2026: https://developers.cloudflare.com/r2/api/workers/workers-api-reference/. In particular, failed conditional `put` returns null, failed conditional `get` has no body, and listing may return a short page before completion. The code exposes no bucket-lock management; application append-only behavior is not an immutable-storage guarantee.
