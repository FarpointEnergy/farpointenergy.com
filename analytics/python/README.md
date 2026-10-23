# Farpoint offline analysis

The package uses the Python standard library only. It performs no network calls,
executes no message/web content, and has no overwrite/delete/expiry operation.
Keep all real input/output directories outside the public website repository.

Run from the repository root:

```sh
PYTHONPATH=analytics/python python3 -m farpoint_analytics run \
  --receipts /private/export/receipts.json \
  --messages /private/export/messages.json \
  --classifications /private/export/mail-classifications.json \
  --config /private/export/config.json \
  --code-commit REVIEWED_40_CHARACTER_GIT_SHA \
  --output /private/runs/NEW_UNIQUE_RUN_DIRECTORY
```

`verify PATH`, `restore SOURCE NEW_DESTINATION`, and `replay --archive PATH
--output NEW_DESTINATION` verify hashes, restore into a new archive, and reproduce
the frozen numerical report. Existing destinations are rejected. Partial and
failed artifacts are retained. A successful local archive is not a verified
Drive upload; the export and Drive adapters must read back actual remote bytes
and record completion separately.

The run archive contains exact JSON input bytes, configuration, output, source
snapshot, interpreter identity/hash, and optional named runtime artifacts passed
through `--runtime-artifact NAME=PATH`. An interpreter identity is not a complete
recoverable runtime. The output explicitly leaves runtime recovery unverified
until an independently retained runtime/OS/dependency bundle passes offline
recovery. No package download or old Git reference is assumed sufficient.

## Contracts

`farpoint_analytics/schema-v1.json` defines the browser event contract and issued
campaign registry. Initially there are no registered campaign tokens; unknown
tokens must be replaced by `unknown_campaign` before sending. Registered tokens
must be versioned with the tracker and archived configuration.

Receipt input is a JSON array of exact collector envelopes containing
`receipt_id`, `received_at`, `receipt_body_sha256`, `body_base64`, and optionally
`body_bytes`. Every body is hash-verified before interpretation. Malformed JSON,
duplicate keys, invalid UTF-8, invalid envelopes, and batches over 50 events are
wholly quarantined. Supported mixed batches validate events individually.

Email captures are separate JSON records with `observation_id`, `mailbox`,
`message_id`, `captured_at`, `received_at`, `body`, `headers`, and `attachments`.
Preserve full body/header/attachment evidence through the capture adapter. This
package does not assume a subject or sender proves a form submission.

Each separate classification observation contains `classification_id`, `mailbox`,
`message_id`, `message_content_sha256`, `classified_at`, `rule_version`, `kind`,
`status`, and `evidence_refs`. Kinds are `new_inquiry`, `follow_up`, `automated`,
`noise`, and `unresolved`. Only `status: confirmed` with evidence can contribute.
`capture_content_hash` hashes immutable message content independently from labels
and capture timestamps. Changed content requires a new supported classification.

A new inquiry additionally requires `business_payload_sha256` and independently
validated `route_evidence` with `status: verified`, `kind: form|direct_email`,
`destination: quotes@farpointenergy.com`, and `evidence_refs`. A form may carry
`inquiry_id`, `browser_id` and `session_id`. A quoted ID in direct mail does not
automatically establish a website conversion. Input classifications are trusted
processing observations, never fields read from a customer-supplied body.

Config requires UTC-offset-aware `window_start`, `window_end`,
`observation_cutoff`. Session cohorts start within the half-open event-time
window; stage reach uses events in that window; cohort conversions use received
evidence through the cutoff. `source_completeness` must identify every required
source, and each must be `true` only after its full export is verified. Missing
completeness produces an incomplete diagnostic report. The initial session gap
is 1,800 seconds. Missing browser IDs are visible but excluded from session
denominators; no IP/person stitching occurs.

`mode: isolated_fixture` plus explicit `fixture_eligible_event_ids` enables the
reviewed golden business journeys only in isolated tests. Production rejects
this fixture override. Marked hosted canaries remain excluded from buyer totals.

Company matching is deliberately conservative. `enrichment.IPToASN` consumes a
checksummed local TSV and yields network context only; provenance-unverified IPs
yield unavailable. No real visitor IP is sent to an enrichment provider here.

## Report tables and company evidence

Analysis rule `farpoint-analysis-1.1.0` adds deterministic `tables` for validated
event occurrences, trusted deduplicated events, derived sessions and campaign
touches. The session table marks membership in the reporting cohort, preserves
the ordered observed page path and links received inquiry keys. No page or funnel
stage is fabricated for a visitor with missing telemetry.

`attribution` groups cohort sessions by session-entry source/campaign, first
observed browser touch and landing page. Product, application and reference
engagement groups are **nonexclusive**: a session may appear in more than one
group, and group totals must not be added together. Every group includes session
IDs, received inquiry keys, stage counts and a conversion numerator/denominator.
Engagement is measured inside the event-time window; receipts use the observation
cutoff. These are associations, not proof that a page caused a conversion.

An independently confirmed, route-verified `new_inquiry` classification may add
`declared_contact` with only `name`, `email`, `company` and `phone` string fields.
The trusted capture/classification adapter must ground these exact declarations
in its archived message evidence. Analysis never scrapes declarations from an
untrusted message body or infers a name from browsing. The `declared_contacts`
table references the selected message-content hash and classification ID;
contradictory declarations remain separate labeled rows. These outputs are
private customer data and must never enter the public source repository.

Optional `--company-observations PATH` loads an array of separately archived
processing observations. Exact input bytes are retained as
`inputs/company_observations.json`, including provider responses/evidence supplied
by the approved adapter. An observation requires:

- `observation_id`, `provider`, `rule_version`, `observed_at`;
- `kind: network|company`, `status: ok|error|unavailable`;
- nonempty `receipt_ids`, `event_ids`, `evidence_refs` arrays referencing the
  actual trusted event/receipt relationship;
- for positive context, `input_ip`, literal `ip_provenance_verified: true` and
  `retention_approved: true`;
- for an IPtoASN network observation, `dataset_sha256` and
  `network_organization`; for company observations, `company`,
  `network_category` and any `contradictory_evidence`.

The raw receipt must independently carry `source_ip.status: verified`, the same
address, and a provenance tag included in the configuration's
`verified_ip_provenances` mapping from tag to retained verification evidence
references. This mapping is empty by default. An observation's own boolean cannot
enable company inference. Dataset/provider selection and provenance verification
are operational gates; this CLI makes no network calls and does not approve a
provider or dataset by itself.

`company_context` retains every supported observation as of the cutoff and
derives current per-session categories from the newest observation for each
provider/event. Conflicting/noncorporate evidence suppresses a possible company.
Network ownership stays network context; even a possible corporate match has
`employer: null`. Coverage explicitly reports sessions with network context,
possible-company matches, unknown company share and zero verified employers.
Absent observations produce unknown/unavailable coverage rather than fabricated
matches. Invalid evidence links make the report incomplete.

The CLI archives the exact source version used for these expanded outputs.
Replaying an older `1.0.0` report requires its archived `1.0.0` source; do not use
new transformations to overwrite an earlier report or claim identical replay.

## Checks

```sh
PYTHONPATH=analytics/python python3 -m unittest discover -s analytics/tests/python -v
```

Tests use public synthetic fixtures, no live forms or customer data. Persistent
test artifacts live beneath the test directory's ignored `.evidence` directory;
they are never destructively cleaned up. Hosted authorization, actual email
delivery, remote archive permissions, scheduled execution and complete runtime
recovery remain separate acceptance gates.
