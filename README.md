# farpointenergy.com

Static site for Farpoint Energy. No build step — plain HTML/CSS, hosted on GitHub Pages.

## Structure
- `index.html`, `products.html`, `delivery.html`, `about.html`, `contact.html` — pages (shared header/footer)
- `style.css` — the whole design system (colors, type, layout)
- `Farpoint_Energy_Product_Catalog_2026.pdf` — downloadable catalog
- `CNAME` — custom domain for GitHub Pages (`farpointenergy.com`)
- `build.py` — optional generator that produces the pages from one template (edit copy there, run `python3 build.py`), or just edit the HTML directly

## Deploy (GitHub Pages)
1. Push this folder to the `main` branch of the repo.
2. Repo → Settings → Pages → Source: "Deploy from a branch", Branch: `main` / root. Save.
3. Settings → Pages → Custom domain: `farpointenergy.com` → Save → tick "Enforce HTTPS" once the certificate is issued (a few minutes to an hour).

## DNS (at the registrar)
- `A` records for `@` (apex) → 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153
- `CNAME` record for `www` → `<github-username>.github.io`
- Keep the Google Workspace `MX` records untouched.

## Editing
- Contact form: set `FORM_URL` in `build.py` to the Google Form embed link and rebuild, or paste the iframe into `contact.html`.
- Email/phone: `EMAIL` / `PHONE` at the top of `build.py`.
