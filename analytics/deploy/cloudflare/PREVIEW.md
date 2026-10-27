# Synthetic website review Worker

This is an isolated browser review of the frozen website assets. It does not change GitHub Pages, the production analytics configuration, the existing candidate collector, or the quotation provider route. Deployment alone does not verify inbox delivery or satisfy production release gates.

The fixed hostname is `farpoint-lead-review.farpointenergy.workers.dev`. The prepared form path is `/quote.html?source=website&campaign=power&utm_medium=referral`. These source, medium and campaign codes are accepted by the existing form and tracker without ambiguous `utm_source`/`source` aliases. The tracker has `synthetic:true` and posts to this same hostname's `/v1/events`.

## What is served

`build-preview-worker.mjs` reads an explicit list of 17 HTML files and their CSS, JavaScript, favicon, social card and catalogue PDFs. Original website files are never written. Each HTML copy gains a visible synthetic-only banner and noindex metadata. The quote copy gains a manual fixture-fill button; the privacy copy states that test collection is enabled, identifies Cloudflare Workers/R2 and explains browser correlation and retained raw bytes. The generated `robots.txt` disallows crawling. Every response also has `X-Robots-Tag` and no-store headers. This is a publicly reachable test site, not an authenticated private website; noindex is not access control.

The normal `inquiry.js`, `tracker.js`, `site.js` and CSS are byte-identical to the source. The fixture helper fills 20 business fields only after an explicit click. Source and Campaign are filled by the unchanged query handler. Six correlation fields are added by the unchanged submit handler. The authorized self-test contact address is used; fixture company, requirement, location and reference are clearly synthetic. Optional fields stay collapsed. No helper code submits or sends a request. A human's normal Send request action sends a real synthetic test email through the existing FormSubmit route to the Farpoint inbox.

## Collector boundary

The generated Worker concatenates the unchanged collector core with `preview-wrapper.mjs`. Only the exact preview origin is admitted to `/v1/events`. `verifiedSourceIp` is explicitly null; environment variables or headers cannot change that. Public `/mcp` is always 403. No private export, identity bootstrap, source-IP probe, arbitrary URL proxy or filesystem route exists. Static routes come only from the build manifest. A binding named `BUCKET` must point to the existing private candidate R2 bucket with its existing retention configuration. No bucket creation, deletion, overwrite, retention change, DNS change or Worker deployment is performed by the builder.

Records use the same existing receipts/rejections namespaces and retain the preview-specific collector version and origin. Browser events are synthetic; arbitrary requests to the public endpoint are not automatically relabeled synthetic. Origin allowlisting is a browser boundary, not caller authentication. Malformed admitted bytes and duplicate attempts still use the unchanged create-only retention behavior. Rejected-request metadata is retained under the core contract. Private authenticated management access remains the read path.

## Build and verification

```sh
node --test analytics/deploy/cloudflare/preview-worker.test.mjs
node analytics/deploy/cloudflare/build-preview-worker.mjs /absolute/private/artifact-directory
node analytics/deploy/cloudflare/check-preview-browser.mjs /absolute/private/evidence-directory
```

The build emits a content-addressed Worker and manifest with every original and served asset SHA-256, collector-core SHA-256, transformed-file flags, final bundle SHA-256, byte count and fixed origin. Existing artifact names are accepted only when their bytes match exactly. No overwrite is allowed. The public source files contain no Cloudflare account or bucket identifier, token or private record.

Unit tests cover deterministic static bytes, noindex/banner, unchanged normal form scripts, preview-only CORS, forced unavailable IP, export/path denial, exact body preservation, retry retention, failed storage and helper behavior. All successful, rejected and failed storage fixture attempts are written to a new private evidence file.

The browser check executes the generated Worker locally behind intercepted browser routes. It intercepts every FormSubmit request and blocks all unrelated external network, so no actual RFQ or live collector request is sent. It checks desktop/mobile-width layout, manual fill, all 28 final fields, normal provider-error email fallback, retained inputs, successful retry, correlation stability, synthetic analytics and absence of form values in analytics. It requires all 20 business values to be nonempty and compares every business/source value with the browser's pre-submit FormData snapshot. Exact intercepted request/response/ACK bytes and storage attempts are hashed and appended before fulfillment; a separate snapshot is saved before browser cleanup. Missing intercepted POST bytes, including WebKit beacon bodies, are recorded as unavailable and aborted rather than admitted as empty bytes. Native beacon delivery is independently tested by the existing HTTPS browser suite. Screenshots and raw synthetic evidence are written to a new directory even on failure. By default it requests Chromium desktop and WebKit mobile; `FARPOINT_PREVIEW_ENGINES=firefox` explicitly requests Firefox desktop/mobile-width checks instead. A mobile-width Firefox check is not an iPhone/WebKit test. Missing engines remain failed/blocked evidence; they are not a pass.

## Remaining human proof

After the independently reviewed bundle is deployed, inspect the exact deployed bundle/asset hashes and private bucket configuration. Open the prepared link in a normal browser, click Fill synthetic test details, review the fields, and choose Send request once. Preserve the synthetic test reference and any on-screen error. The success screen means provider acceptance only. Separately verify the actual inbox message, all 28 field values and matching inquiry/browser/session identifiers against the retained collector events. Preserve that evidence and failures without deletion. Production activation, verified IP provenance, immutable administrator-proof retention and recurring reports remain separate release decisions.
