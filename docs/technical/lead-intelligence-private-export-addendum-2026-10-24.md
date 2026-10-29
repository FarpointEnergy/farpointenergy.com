# Owner-private Sites MCP export feasibility addendum

Date: 24 October 2026. Scope: implementation and test plan for the existing private Farpoint collector. Hosted completion must be recorded separately from this design addendum.

## Decision and purpose

Reuse the existing `list_records` and `read_record_chunk` tools to export the three existing synthetic storage-test objects. Add one explicitly scoped, default-off authorization mode for owner-private Sites MCP requests. Do not create a second exporter, new storage probe, external database or hosting account. The public website, tracking configuration and collection behavior remain outside this change.

The existing general gateway gate was intentionally stricter than the evidence currently available. Leaving it off remains correct. Separately, Sites documents an authenticated private MCP path that can support a bounded owner-private feasibility test. Distinguishing those trust scopes avoids mislabeling a private test as public-route anti-spoof verification.

## Contract, observations and limits

The official Sites [MCP reference](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/references/site-mcp-server.md), read on 24 October 2026, states that Sites authenticates MCP requests, checks the caller can view the Site, and forwards the caller's Site-scoped identity. The [identity reference](skill://plugin_connector_1p_689987207de08191979cf68eca2941c6/sites/references/identity-and-secrets.md) states that a service-access bypass credential conveys neither visitor identity nor connected-app consent. The application must still authorize the operation against its configured owner.

Before enabling private export, retain separate evidence of the actual one-owner audience, genuine authenticated plugin identity matching the configured owner, and denied no-identity access. An edge 401 can establish that no-identity access was denied; it does not establish that a bypass token was accepted or that the application executed its owner guard. The local tests separately verify application-level 403 denial. Neither result proves a wrong-account hosted test or public gateway header anti-spoof behavior.

Identity equality is an observation, not proof of transport provenance. Trust in this bounded private mode rests on the documented Sites MCP contract together with the verified owner-private access policy and actual authenticated-path evidence. The Worker cannot independently read its current Site audience. Audience verification and disabling the private mode before exposure are therefore mandatory operational prerequisites.

## Implementation

`createCollector` gains `privateSiteMcpOwnerAccess=false`. It accepts only boolean `true`; strings and numbers do not enable it. The existing `verifiedGatewayIdentity` path remains separate. Private access requires a configured cursor signing secret of at least 32 UTF-8 bytes before either list or read is authorized. The common owner guard requires exact equality with the configured Site-scoped owner and rejects empty, overlength, comma-separated or whitespace-containing identities.

The Sites wrapper may pass the private option only when every condition holds:

- Request is exactly `POST /mcp`.
- `PRIVATE_CANDIDATE_BOOTSTRAP` equals the string `1`.
- `PRIVATE_OWNER_EXPORT_ENABLED` equals the string `1`.
- `CURSOR_HMAC_KEY` is a string containing at least 32 UTF-8 bytes.

The release operator must also verify that the actual Site remains owner-private with one owner. A configuration flag does not inspect or change that audience. `GATEWAY_IDENTITY_VERIFIED` remains `0`, and the private option neither supplies verified visitor IPs nor changes ingestion behavior.

The same existing exporter handles argument validation, HMAC cursor signing, owner/namespace binding, bounded enumeration, conditional range reads and response budgets. There are no new object write, delete, overwrite, retention-policy or configuration-mutation operations.

The official [MCP 2026-07-28 tools specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx), checked on 24 October 2026, describes standard request metadata in `params._meta`. The original strict parameter allowlist rejected that field. Core and wrapper now share envelope validation that accepts an optional metadata object, keeps it inert, and rejects null, array or primitive metadata and unknown other parameter fields. Actual tool arguments retain their own strict validation. Metadata never supplies identity, changes business inputs, enters storage, or appears in responses. The existing 16 KiB total request bound includes metadata; this is metadata compatibility, not a claim of full MCP 2026-07-28 conformance.

An oversized-metadata regression also exposed a cloned-stream cancellation wait in the private wrapper. Only that clone reader now requests cancellation without awaiting the tee sibling; the core then consumes and rejects the original under its unchanged byte limit. Default bounded-reader cancellation behavior elsewhere is unchanged. A bounded-time test verifies oversized metadata is rejected without storage access.

Owner diagnostics separately report `gateway_identity_verified` and `private_owner_export_enabled`. The legacy `ordinary_export_gate_enabled` is their aggregate configuration state; the caller must still pass the owner check. Diagnostic output contains safe booleans plus scope and source version. The pre-existing bootstrap tool additionally retains its legacy Site identity field for compatibility; that field must stay in private session memory and must not enter reports, source, logs or evidence documents.

## Secret handling

Generate at least 32 bytes of cryptographically secure random material for `CURSOR_HMAC_KEY`, encode it for the native Sites secret configuration, and retain it only as the Site's managed secret. Do not print it, commit it, put it in the hosting manifest, or pass it as a URL or shell argument. Preserve it across deployments to keep outstanding cursors valid. Rotation, if later necessary, invalidates old cursors and requires a new full enumeration; it never deletes or replaces source records.

`OWNER_USER_ID` remains the existing Site-scoped owner secret obtained through the genuinely authenticated plugin. Never enroll an arbitrary caller, infer owner identity from email, forge identity headers, or use a bypass token as identity.

## Rollout and rollback order

1. Reconfirm owner-private audience with exactly one owner. Retain safe verification evidence only.
2. Through the genuinely authenticated installed plugin, verify the configured owner match. A stale plugin tool catalog may use the existing bootstrap tool's compatible safe diagnostics; keep its legacy identity field private.
3. Verify no-identity access is denied. Record whether rejection occurred at the Sites edge or application. Do not manufacture an identity or reinterpret a service-access token as one.
4. Provision the cursor secret through native Sites secret management. Keep `PRIVATE_OWNER_EXPORT_ENABLED` absent or `0` while deploying the reviewed code. Keep `GATEWAY_IDENTITY_VERIFIED=0`.
5. Only after those prerequisites pass, set `PRIVATE_OWNER_EXPORT_ENABLED=1` through native configuration while preserving audience and all other settings. Deploy the same saved, reviewed Site version with that environment revision; an environment update alone does not apply the values to the running deployment. Verify the deployment succeeded and uses the intended environment revision before attempting exports.
6. Exercise the existing authenticated list/chunk tools against the already retained synthetic objects. Retain complete safe enumeration and exact-byte/hash verification evidence; do not rerun the write-generating storage probe.
7. Recheck no-identity denial against an ordinary export tool and confirm audience is still owner-private. On a failed prerequisite or unexpected result, stop further export testing, set the private export flag to `0`, deploy the same reviewed version with the disabled environment revision, and verify deployment success and ordinary-export denial. Retain all evidence and stored records.

Before any audience expansion, first set `PRIVATE_OWNER_EXPORT_ENABLED=0` and `PRIVATE_CANDIDATE_BOOTSTRAP=0`, deploy the disabled configuration, and verify ordinary exports are denied with `GATEWAY_IDENTITY_VERIFIED=0` and private tools are absent from discovery. Only then may a separately authorized public configuration be considered. This addendum does not authorize that audience change. Public-route authentication, anonymous intake, visitor-IP provenance and all other production release gates remain separate. No recurring reporting is activated by this change.

## Tests and acceptance evidence

The focused local tests cover strict boolean/string flags; missing, incorrect and malformed identities; missing, short and non-string cursor secrets; route/method isolation; zero storage I/O for denied list/read operations; safe diagnostics; private/no-store caching; and preservation of the existing explicit general gateway mode.

A read-only local bucket is preloaded directly with three deterministic synthetic objects. The tests list one object per page, follow every signed cursor, replay a cursor, reject altered or wrong-namespace cursors, and read each object through multiple bounded chunks. Reassembled byte counts and SHA-256 must match the independently listed metadata and original fixture bytes. Any call to write or delete fails the test; records and environment values remain unchanged.

For the hosted test, enumerate both `receipts` and `rejections` namespaces with a small limit to exercise continuation, following every cursor through explicit completion, including for a namespace that appears empty. Reconcile all discovered objects against prior storage-test evidence. Retain and report any unexpected extra records; do not silently ignore them. Read every discovered object in multiple bounded chunks where its size permits, preserve exact offsets, verify object size and full-object SHA-256, and compare known records with the prior safe evidence. A complete scan is not a transactional snapshot or an independently verified archive. An inaccessible object, missing chunk, changed hash, incomplete enumeration or unexpected record is a reported incomplete result, never grounds to delete or overwrite anything.

Commands from the repository root:

```sh
node --test analytics/deploy/sites/owner-binding.test.mjs analytics/deploy/sites/private-export.test.mjs
node --test analytics/tests/collector/collector.test.mjs
```

Passing local tests establishes implementation behavior only. The final hosted evidence must state separately whether authenticated owner binding, private ordinary export, exact-byte reconstruction, and no-identity denial actually passed. It must not certify public gateway anti-spoofing, wrong-user hosted isolation, visitor-IP provenance, locked retention, independent archive recovery, scheduled operation or production readiness without their own evidence.

The full AUTH-01/02 acceptance gates remain pending: a wrong real user, revoked-session access and public header-spoofing behavior have not been established by this scoped test. An owner equality match and an edge no-identity 401 neither complete those gates nor prove application-level denial or bypass-token validity.
