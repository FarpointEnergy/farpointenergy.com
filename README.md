# farpointenergy.com

Static GitHub Pages site. Edit `content.py` for copy and `build.py` for layout, then run `python3 build.py` and commit the generated pages. Preserve `CNAME` and `.nojekyll`.

## Review checks

Run `python3 check_site.py`, `node check_inquiry.js`, `node check_context.js`, and `node check_tracker.js`. These check baseline preservation, local navigation, reproducible builds, and mocked inquiry/context behavior. They do not send email or prove delivery. Browser review and one controlled inquiry receipt check are required before release.

`node check_browser.mjs` exercises actual Chromium, WebKit and Firefox engines against the local website, an isolated local HTTPS collector and synthetic form responses. Install OpenSSL, Playwright 1.62.1 and its browser engines first, or use the `Browser QA` GitHub Actions workflow. Missing engines are BLOCKED and fail the check. These tests never submit a real RFQ or certify inbox delivery. Preserve every run's screenshots, reports and logs in the permanent R2/Drive evidence archive; GitHub artifacts are temporary transfer buffers.

The quote form progressively enhances a native FormSubmit POST. Only explicit provider acceptance shows success; uncertain transport results retain the entered values. The first-party tracker is configured in `analytics-config.json`. Release activation requires passed hosted acceptance checks, the exact HTTPS collector endpoint and matching Privacy disclosure. Preview snapshots must disable submissions and indexing.

Power and distribution are sections of Products. The four former standalone draft routes are compatibility redirects. Catalog PDFs remain unchanged and unlinked.
