# Direct Cloudflare collector candidate

This adapter reuses the unchanged dependency-free collector core and its
create-only R2 store. It is a synthetic deployment candidate; it does not enable
website tracking, submit quotations, schedule reports, or certify production
readiness.

## Configuration and build

Bind the private R2 bucket as `BUCKET`. Configure an indefinite bucket lock and
inspect lifecycle/public-access settings before intake. The deployment operator
must retain the actual configuration evidence; application conditional writes
alone do not establish a storage lock.

Build a self-contained module without installing packages:

```sh
node analytics/deploy/cloudflare/build-worker.mjs /absolute/private/artifact-directory
```

The builder creates content-addressed module and manifest files and refuses to
replace differing existing bytes. The module can be uploaded through the
Cloudflare Worker API with `main_module` pointing to its multipart module name.
`wrangler.example.jsonc` shows equivalent configuration with placeholders; it is
not a deployment-ready configuration or a statement about an existing account.

## Public and private boundaries

The public collector retains the original `/v1/events` and `/health` behavior
and exact website Origin allowlist. `/mcp` always returns 403 before reading
storage, for every HTTP method and regardless of any environment flags or
claimed identity. Other unknown paths return the core's 404. There are no public
read, update, delete, diagnostic or bootstrap routes.

The Sites wrapper is not included. No OpenAI identity header, hosting bypass
token, or first caller is accepted as owner identity. No owner or cursor secret
is needed by this public-only candidate. Initial private readback uses the
separately authenticated Cloudflare management connection. That management
access must be proven against actual objects before claiming the analysis path
works. The existing private Sites candidate and its historical objects remain
untouched.

## Source-IP gate

Default deployment values are:

| Variable | Initial value | Meaning |
| --- | --- | --- |
| `CLOUDFLARE_DIRECT_IP_VERIFIED` | `0` | All receipts have unavailable/unverified source IP. |
| `CLOUDFLARE_VERIFIED_IP_HOSTNAME` | empty | No hostname is approved for IP attribution. |

Only the exact string `1` plus the exact tested hostname can enable the adapter.
The deployment operator must first pass the existing known-egress, forged-header,
address-family and actual-route tests. These variables record that decision;
neither the variables nor local fixtures prove Cloudflare's transport behavior.
Future hostname changes require new evidence.

The adapter reads only `CF-Connecting-IP`, requires Cloudflare request metadata,
and refuses Worker subrequests (`CF-Worker` present), Cloudflare O2O paths,
Pseudo IPv4 overwrite paths (`CF-Connecting-IPv6` present), Class E pseudo
addresses, the documented cross-zone Worker address, and malformed/list values.
Unsupported paths still retain the exact body with unavailable attribution.
`X-Forwarded-For`, `X-Real-IP`, body fields and caller-supplied identities never
provide source-IP evidence. Suppression headers can cause unavailable attribution;
their absence alone is not proof of provenance.

A verified address means the network peer Cloudflare observed. It does not prove
the natural person, employer, device, or original source behind another proxy.
Company lookup remains a separate evidence-producing step.

Current provider references checked 26 October 2026:

- https://developers.cloudflare.com/fundamentals/reference/http-headers/
- https://developers.cloudflare.com/network/pseudo-ipv4/
- https://developers.cloudflare.com/waf/custom-rules/use-cases/block-worker-subrequests/

## Checks

```sh
node --test analytics/deploy/cloudflare/wrapper.test.mjs
node --test analytics/tests/collector/collector.test.mjs
```

The wrapper tests preserve every synthetic store in a unique evidence file.
Set `FARPOINT_TEST_EVIDENCE_DIR` to an absolute private artifact directory to
retain these outside the checkout. Test data and failed attempts are not deleted.
Local tests cover gate behavior, closed public export, byte retention and safe
storage failure; they do not certify hosted IP provenance, storage locks,
authenticated management readback, inbox delivery or unattended reporting.
