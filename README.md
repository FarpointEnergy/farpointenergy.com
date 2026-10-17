# farpointenergy.com

Static website hosted on GitHub Pages. Python 3 standard library builds the pages.

- Edit public copy in `content.py` and layout/style in `build.py`.
- Inquiry markup is in `inquiry.py`; progressive enhancement is in `inquiry.js`.
- Run `python3 build.py` and commit source and generated output together.
- Run `python3 check_site.py` for route, metadata, preservation and build checks.
- Run `node check_inquiry.js` for mocked inquiry and confirmation behavior (no emails sent).
- Preview with `python3 -m http.server 8000` in a local development environment.
- The form retains a native FormSubmit POST fallback. Confirm receiver activation and test actual inbox delivery before release.
- Optional `window.farpointAnalytics` receives only event name and allowlisted product/application values. No tracking destination is configured.
- Keep `CNAME`, `.nojekyll` and existing PDF files intact. Product PDFs are not linked by the website.
- Review a feature branch before merging into the production branch. Verify the Pages source and the deployment after release; use a Git revert for rollback.
