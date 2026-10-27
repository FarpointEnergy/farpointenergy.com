# Read-only Cloudflare collector adapter

`cloudflare-adapter.mjs` gives the existing Work pipeline its `collector.list`
and `collector.chunk` callbacks through the authenticated Farpoint Cloudflare
plugin. It also exports the explicit aliases `listRecords` and
`readRecordChunk`. The existing Sites adapter and historical source remain.

Supply `accountId` and `bucketName` through private configuration. They are fixed
for an adapter instance; list/read arguments cannot choose an account, bucket,
arbitrary URL or executable code. Supply the actual `tools` object and a
`recordEvidence(name, bytes)` callback that creates a new private evidence file,
verifies its bytes, and includes it in the run archive. Every returned tool
envelope is retained before parsing, including malformed or rejected responses.
Connector exceptions retain a safe failure observation without copying arbitrary
exception text into reports.

```js
const collector = createCloudflareCollectorAdapter({
  tools,
  accountId: privateSettings.cloudflare_account_id,
  bucketName: privateSettings.cloudflare_bucket_name,
  recordEvidence: (name, bytes) => local.create(`adapter-evidence/${name}`, bytes)
});
const adapters = createNativeAdapters({tools, local, settings, classify, analyze});
// Pass the replacement collector together with the unchanged Drive/mail adapters.
const result = await runLeadPipeline({...adapters, collector, runId, config});
```

The adapter-evidence callback writes outside the pipeline journal. Therefore a
pipeline completed record alone is not the full connector-evidence archive.
Keep all attempts beneath one private evidence root and finish with the bundled
`closeWorkArchive` entry point in `TASK.md`. It binds the pipeline's verified
manifest to a complete evidence ZIP, verifies its actual Drive download and
fresh restoration, and replays the archived analysis before emitting a separate
verified closure. Future tasks must require that closure result.

The adapter emits only fixed `GET` requests through
`mcp__codex_apps__farpoint_cloudflare_execute`. **This does not make the connected
account or token read-only.** Provisioning uses administrative access; analysis
should use suitably restricted source credentials when available. Scope and
owner access must be checked against the actual connected account. No API token,
owner identifier, account/bucket value or raw record belongs in public source.

List pages are capped at 40 and object reads at 8,192 bytes per returned chunk.
The provider executes the full object read, UTF-8 byte conversion and SHA-256
before returning only the requested chunk. The initial octet-stream control
object returned an exact text string, while actual `application/json` collector
objects are parsed into plain objects by the management client. These are two
different observed response forms, not interchangeable byte-read proofs.

For text strings, the method is recorded as `raw_utf8_text`. For parsed plain
objects, `JSON.stringify` reconstructs a candidate outer envelope and the method
is `json_stringify_verified`. **Both exact byte length and SHA-256 must match the
independently listed original object before any chunk is returned.** Semantic
JSON equivalence is insufficient: whitespace, changed key order, numeric
normalization, escape differences, duplicate keys or other lost representation
details cause failure whenever they change bytes. Unsupported result types also
fail. There is no substitution of normalized JSON for a mismatching original.

The exact original HTTP submission remains independently preserved inside the
receipt's `body_base64` and `receipt_body_sha256` fields. Verifying reconstruction
of the outer receipt does not alter or reinterpret those submitted bytes.
Private evidence retains the actual returned tool envelope, bounded provider
response shape, reconstruction method, hashes and chunks. It does not duplicate
the complete provider object in every chunk response. The adapter additionally
checks each transmitted chunk's length/hash, and the existing pipeline performs
the final reconstructed-object hash check. No raw public export endpoint is added.

Only the observed single JSON-text-block tool envelope is accepted. Error,
truncated, ambiguous, nested or differently shaped responses fail closed.
Continuation cursors are run-scoped and namespace-bound; the normal pipeline
starts a fresh full rescan for each run. Short pages do not imply completion.
Cloudflare's REST schema makes `result_info` optional, and actual terminal
responses omit it. When a nonempty page lacks that metadata, the adapter issues
a second read with the same prefix, `start_after` equal to the last returned key,
and `per_page=1`. An empty successful remaining-range result establishes the
provider-observed end at that request. A nonempty probe continues from the last
delivered key, so the probe's object is not skipped. Explicit provider cursors
are followed whenever present. Empty truncated pages still follow their cursor.
The adapter rejects inconsistent continuation facts, changed metadata, out-of-
order keys, duplicate keys, repeated cursors and nonadvancing range probes.
Every probe and failed probe is retained in private connector evidence.
Enumeration never claims a transactional snapshot; later runs rescan earlier
keys for late writes. This adaptation uses the documented `start_after`
lexicographic-range behavior rather than interpreting a short page as complete.

Provider contract: https://developers.cloudflare.com/api/resources/r2/subresources/buckets/subresources/objects/methods/list/

To generate the combined Work runtime with this adapter while retaining older
bundles unchanged:

```sh
node analytics/work/build-cloudflare-bundle.mjs /absolute/private/artifact-directory
```

The generated function body accepts the same CSPRNG-supplied `entropyBase64` as
the existing Work bundle and additionally exports
`createCloudflareCollectorAdapter`. All code versions and test evidence must be
retained with the archive for reproducible analysis.

Run focused local checks:

```sh
FARPOINT_TEST_EVIDENCE_DIR=/absolute/private/artifact-directory node --test analytics/work/tests/cloudflare-adapter.test.mjs
```

These checks execute generated read code against a synthetic provider and verify
pagination, chunks, exact Unicode bytes, safe failures, list/hash consistency,
private evidence capture, argument scope and the absence of mutating requests.
They do not establish real account permissions or actual hosted data access.
