# Public intake feasibility — 25 October 2026

The existing ChatGPT Sites collector accepted anonymous synthetic HTTP requests,
preserved their bodies in R2 and returned the same bytes through its authenticated
owner-private exporter. This removes the basic anonymous-endpoint feasibility
question. It does not certify production readiness or require a hosting change.

## Authorized test and final state

Karan approved a temporary public audience for synthetic testing. The public window
ran from 14:40:48 to 14:42:16 America/New_York (18:40:48–18:42:16 UTC).
All three trust flags were `0` during that window. No identity, cookie, service
credential or forwarding header was supplied by the HTTP harness.

The Site returned to `custom` access with exactly one owner, no other users,
editors, groups or external visitors. Private export was temporarily enabled only
after that restoration, used through the installed authenticated plugin, then
disabled again. Final environment revision: 9. Both private flags and
`GATEWAY_IDENTITY_VERIFIED` are `0`; a final authenticated export attempt returned
application HTTP 403. No production source change was deployed.

No live website tracking was enabled, no RFQ was submitted, and no recurring
reporting was activated. No stored object was overwritten or deleted. The
one-time `candidate_storage_check` was not rerun.

## Observed results

| Check | Result and evidence limit |
| --- | --- |
| Anonymous health | Fresh request returned 200 and the exact availability JSON. An earlier request returned an edge 401; both results are preserved. Propagation versus cache effects were not isolated. |
| Allowed-origin preflight | 204 with the exact website Origin, POST and Content-Type. This verifies HTTP headers, not browser enforcement. |
| JSON and identical retry | Two separate 202 receipt IDs with identical body hashes. |
| Text/plain, malformed JSON, invalid UTF-8 | Each returned 202 and was recovered byte-for-byte. Analytical validity remains a later step. |
| Exactly 32,768 bytes | 202; complete body recovered without truncation. |
| 32,769 bytes | 413 with body-too-large rejection metadata. No claim to retaining rejected body bytes. |
| Unsupported media type | 415 with categorical rejection metadata. |
| Missing or foreign Origin | 403 without an allowing CORS header; two rejection records retained. |
| Anonymous export and bootstrap requests | Sites edge 401, no record data returned. These responses do not prove execution of the application owner guard or bootstrap handler. |
| Authenticated private readback | Nine receipts and four rejection records across five pages; all 13 objects reconstructed from 18 chunks, totaling 51,036 bytes. |
| Historical preservation | All three original objects matched their original sizes and SHA-256 hashes. |
| Independent review | Storage reconstruction approved; bit-flip, truncation, missing-object and duplicate-key corruption cases all rejected. |

Six new receipts matched the exact submitted body bytes and acknowledged hashes.
Four rejection records had the expected categorical reasons. There were no
unexpected objects in the enumerated namespaces. Every new receipt explicitly
records source IP as unavailable, unverified and null.

The original HTTP summary checked statuses and acknowledgements. Independent
review added offline verification of complete case coverage, health content,
CORS, rejection semantics, cache policy and receipt-ID uniqueness. Original
evidence is preserved; revised verification is a new file. Two exploratory
readback-harness mistakes (field names and an omitted hash await) were corrected
without writes; they were not collector defects.

All 12 offline evidence-validator regression checks passed. The four independent
storage-corruption cases also rejected the altered inputs as expected.

## Verified private archive

A new owner-private Drive archive contains 71 evidence/source files totaling
4,429,289 bytes, plus archive control records. Its actual downloaded ZIP matched
all 190,687 uploaded bytes. Restore into a fresh directory verified every archived
file and all 13 raw objects. A separate completion record preserves the returned
private file IDs; they are omitted here.

- ZIP SHA-256: `9697243a89e7702fbc280a04bc82652f4cf779885cae699ed27b5a1f028bac95`
- Manifest SHA-256: `d1eb0a7fba062cda992447cbbf7a5961eb6c7157f8166f2372f7eadb1584ce12`

This proves this archive's byte integrity and restoration. It does not establish
an unattended run, provider retention policy or complete portable-runtime recovery.

## Remaining requirements

| Requirement | What is missing | Next action |
| --- | --- | --- |
| Original visitor IP | A documented Sites forwarding/trust contract, synthetic candidate-field instrumentation and independent controlled-network comparisons. The current wrapper intentionally supplies no verified IP extractor. | Obtain the contract, then observe selected candidate fields privately and run the approved IPv4/IPv6 and spoofed-forwarding matrix. Do not infer employer from an unverified proxy address. |
| Retention and mutation protection | Actual lifecycle, expiration and overwrite/delete policy for this Site's bound R2 bucket. Persistence and conditional create/readback already passed. | Obtain bucket-specific settings or a supported inspection/control mechanism. Lack of an exposed tool is missing evidence, not proof the feature is unavailable. |
| Public owner authorization | Separate-account, revoked-session, anti-spoof and cache-isolation matrix while the collector has its intended production audience. | Complete the hosted auth matrix before enabling the general gateway flag. |
| Browser and funnel integration | A real browser request from the website Origin, remaining browser/device checks and complete RFQ correlation delivery. | Keep the live tracker off until the approved test plan passes; do not treat command-line Origin headers as a browser test. |
| Unattended operation and recovery | Real scheduled archive/report/watchdog acceptance and full portable-runtime recovery. | Run the existing versioned plan when platform and access gates permit. This run creates no recurring jobs. |

The current RFQ verification also retains the earlier FormSubmit security-block
result; this test did not submit a quotation or resolve that separate delivery
gate. Existing evidence and test-plan gaps remain in force.

## Questions for platform confirmation

1. Which server-side field, if any, contains the original anonymous visitor's IP
   after Sites dispatch? What trust guarantee covers it?
2. Which incoming IP headers does Sites strip or replace, and what differs across
   direct requests, proxy/Worker requests, IPv4, IPv6 and custom domains?
3. What lifecycle/expiration and storage-enforced overwrite/delete protections
   currently apply to this project's R2 bucket?
4. How can its owner inspect/configure those policies, and what happens on Site
   deletion, account closure, plan changes or capacity restrictions?

These questions concern normal retention and administrator-controlled policies;
they do not add an administrator-proof requirement. No support message was sent.

Official references checked on 25 October 2026:
- [Sites data and connections](https://learn.chatgpt.com/docs/sites/data-and-connections)
  describes R2 file storage and public sign-in features.
- [Sites administration](https://learn.chatgpt.com/docs/enterprise/sites)
  directs retention/deletion questions to OpenAI Support.

## Architecture decision

Continue with GitHub Pages, the existing Sites collector/R2 and Work/Drive.
An external ingress component is an alternative only if trustworthy visitor-IP
ingress cannot be established. Controlled external object storage is an alternative
only if the bound bucket cannot meet the preservation requirements. Neither
condition has been demonstrated, and neither requires moving the marketing site.

## Reproduction and evidence

`analytics/deploy/sites/public-intake-check.py` is an explicitly authorized,
bounded synthetic HTTP harness. It captures body bytes and selected headers,
not a full wire capture. It does not change audience or supply identity.

`analytics/deploy/sites/verify-public-intake-storage.py` compares captured HTTP
evidence with authenticated exported objects and the preserved original baseline.
Run it using ordinary Python, never `python -O`.

Raw records, cursors, HTTP evidence and corruption fixtures belong in the verified
owner-private archive. Public Git contains reusable procedures and safe aggregate
results only. The safe technical record belongs in project folder 07 Technical.
