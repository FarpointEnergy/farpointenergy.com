#!/usr/bin/env python3
"""Farpoint Energy website generator. Content lives in content.py; run `python3 build.py` to regenerate all pages."""
import pathlib, html as H
from content import *
OUT = pathlib.Path(__file__).parent
MARK = '<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="1" y="1" width="38" height="38" fill="none" stroke="#C4732C" stroke-width="3"/><line x1="7" y1="28" x2="33" y2="28" stroke="currentColor" stroke-width="3"/><circle cx="29" cy="13" r="4" fill="#C4732C"/></svg>'
NAV = [("Products", "products.html"), ("Markets", "markets.html"), ("Quality", "quality.html"), ("Delivery & warranty", "delivery.html"), ("About", "about.html")]

CSS = """
:root{--ink:#0E1B2B;--ink2:#16263A;--copper:#C4732C;--copper-dk:#9E5A1F;--steel:#EEF1F4;--slate:#5A6675;--line:#CBD3DB;--paper:#FFFFFF;--tint:#F7F8FA;--text:#0E1B2B}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--text);font-family:"Source Sans 3",system-ui,Arial,sans-serif;font-size:17px;line-height:1.55}
a{color:var(--copper-dk)}img,svg{max-width:100%}
h1,h2,h3,h4{font-family:"Archivo",system-ui,Arial,sans-serif;letter-spacing:-0.01em;line-height:1.12;margin:0;text-wrap:balance}
h1{font-size:clamp(34px,5vw,56px);font-weight:700}h2{font-size:clamp(26px,3.2vw,36px);font-weight:700}h3{font-size:20px;font-weight:600}h4{font-size:16px;font-weight:600}
p{margin:0 0 14px;max-width:66ch}
.eyebrow{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--copper);margin-bottom:10px}
.mono{font-family:"IBM Plex Mono",ui-monospace,monospace}.muted{color:var(--slate)}.small{font-size:15px}
.wrap{max-width:1120px;margin:0 auto;padding-inline:clamp(16px,4vw,40px)}
.nav{background:var(--ink);color:#fff;position:sticky;top:0;z-index:10}
.nav .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:14px}
.brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-family:"Archivo";font-weight:700;letter-spacing:.16em;font-size:14px}
.brand .mark{width:22px;height:22px;color:#fff}.brand span{font-weight:400;color:#B9C3CE;letter-spacing:.2em}
.nav ul{list-style:none;margin:0;padding:0;display:flex;gap:22px;flex-wrap:wrap;align-items:center}
.nav a.l{color:#DCE2E8;text-decoration:none;font-size:15px}.nav a.l:hover,.nav a.l[aria-current]{color:#fff;border-bottom:2px solid var(--copper)}
.btn{display:inline-block;background:var(--copper);color:#fff;text-decoration:none;font-family:"Archivo";font-weight:600;padding:12px 20px;border-radius:2px;font-size:15px}
.btn:hover{background:var(--copper-dk)}.btn.ghost{background:transparent;border:1.5px solid var(--copper);color:var(--copper)}.btn.ghost.onDark{color:#fff;border-color:#fff}
.hero{background:var(--ink);color:#fff;padding-block:clamp(56px,9vw,120px)}
.hero h1{color:#fff;max-width:16ch}.hero .sub{font-family:"Archivo";font-weight:400;font-size:clamp(17px,2vw,22px);color:#B9C3CE;max-width:52ch;margin-top:18px}
.hero .cta{display:flex;gap:14px;flex-wrap:wrap;margin-top:28px}
.strip{border-top:1px solid #33465B;margin-top:48px;padding-top:16px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-family:"IBM Plex Mono";font-size:13px;letter-spacing:.06em;color:#DCE2E8}
section.s{padding-block:clamp(48px,7vw,88px)}section.s.alt{background:var(--tint)}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:36px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:24px}
.tile{background:var(--steel);padding:18px 20px;border-top:3px solid var(--copper)}
.tile .v{font-family:"Archivo";font-weight:700;font-size:30px;line-height:1.05}
.tile .l{font-family:"IBM Plex Mono";font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--slate);margin-top:6px}
.steps{counter-reset:s;list-style:none;margin:20px 0 0;padding:0}
.steps li{display:grid;grid-template-columns:40px 1fr;gap:14px;padding:16px 0;border-top:1px solid var(--line)}
.steps li::before{counter-increment:s;content:counter(s,decimal-leading-zero);font-family:"IBM Plex Mono";color:var(--copper);font-size:15px;padding-top:3px}
.steps b{font-family:"Archivo";font-weight:600;display:block;margin-bottom:3px}
.panel{background:var(--tint);border-left:3px solid var(--copper);padding:16px 20px;margin:18px 0;max-width:70ch}
.tbl{overflow-x:auto;border:1px solid var(--line);background:#fff;margin-top:20px}
table{border-collapse:collapse;width:100%;min-width:720px;font-size:15px}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}
th{font-family:"IBM Plex Mono";font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--slate);background:var(--steel);font-weight:500}
td.k{color:var(--slate);width:28%}td.v{font-family:"IBM Plex Mono";font-size:14px}
tr.sec td{background:var(--tint);font-family:"Archivo";font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase}
.sku{font-family:"IBM Plex Mono";font-weight:500;white-space:nowrap}
ul.check{list-style:none;padding:0;margin:12px 0}ul.check li{position:relative;padding-left:18px;margin:8px 0}
ul.check li::before{content:"";position:absolute;left:0;top:10px;width:7px;height:7px;background:var(--copper)}
.card{border:1px solid var(--line);padding:22px 24px;background:#fff;display:flex;flex-direction:column;gap:8px}
.card .tag{font-family:"IBM Plex Mono";font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--copper)}
.card p{margin:0}.card a.more{margin-top:auto;font-family:"Archivo";font-weight:600;text-decoration:none;color:var(--copper-dk)}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:20px}
.grid4{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin-top:20px}
details{border-top:1px solid var(--line);padding:14px 0}details summary{cursor:pointer;font-family:"Archivo";font-weight:600;font-size:18px;list-style:none;display:flex;justify-content:space-between}
details summary::after{content:"+";color:var(--copper);font-weight:400}details[open] summary::after{content:"–"}
footer{background:var(--ink);color:#B9C3CE;padding-block:40px;font-size:14px}
footer .wrap{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}footer a{color:#fff}
.formwrap{border:1px solid var(--line);background:#fff;padding:8px;min-height:200px}.formwrap iframe{width:100%;height:1100px;border:0}
@media (max-width:760px){.nav .wrap{flex-wrap:wrap}.nav ul{width:100%;gap:14px}.nav .btn{padding:9px 14px;font-size:14px}.steps li{grid-template-columns:32px 1fr}}
"""

def page(title, body, current, desc):
    nav = "".join('<li><a class="l" href="%s"%s>%s</a></li>' % (h, ' aria-current="page"' if h == current else '', t) for t, h in NAV)
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><meta name="description" content="{desc}">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="style.css">
</head><body>
<nav class="nav"><div class="wrap"><a class="brand" href="index.html">{MARK}FARPOINT&nbsp;<span>ENERGY</span></a><ul>{nav}<li><a class="btn" href="quote.html">Request a quotation</a></li></ul></div></nav>
{body}
<footer><div class="wrap"><div><div class="brand" style="margin-bottom:10px">{MARK}FARPOINT&nbsp;<span>ENERGY</span></div>Power transformers, engineered to your specification.<br>{SITE['city']}</div>
<div><a href="mailto:{SITE['email']}">{SITE['email']}</a><br><a href="tel:{SITE['phone_raw']}">{SITE['phone']}</a><br><a href="{SITE['catalog']}">Product catalog — Solar &amp; Storage Edition 2026 (PDF)</a></div>
<div class="mono" style="font-size:12px;align-self:flex-end">© 2026 Farpoint Energy · IEEE C57.12.00 / C57.12.90</div></div></footer>
</body></html>"""

def steps(items):
    return '<ol class="steps">' + "".join(f'<li><div><b>{H.escape(b)}</b>{H.escape(t)}</div></li>' for b, t in items) + '</ol>'
def checks(items):
    return '<ul class="check">' + "".join(f'<li>{H.escape(i)}</li>' for i in items) + '</ul>'

# ---------- HOME
h = HOME
cards = "".join(f'<div class="card"><div class="tag">{H.escape(m["name"])}</div><p>{H.escape(m["lead"])}</p><a class="more" href="markets.html#{m["id"]}">Read more →</a></div>' for m in MARKETS)
fam = "".join(f'<div class="card"><div class="tag">{H.escape(f["tag"])}</div><h3>{H.escape(f["name"])}</h3><p>{H.escape(f["body"])}</p><a class="more" href="products.html#{f["id"]}">{"Configurations and datasheets" if f["detail"] else "Request a quotation"} →</a></div>' for f in FAMILIES)
home = f"""
<header class="hero"><div class="wrap"><div class="eyebrow">{H.escape(h['eyebrow'])}</div><h1>{H.escape(h['h1'])}</h1>
<p class="sub">{H.escape(h['sub'])}</p>
<div class="cta"><a class="btn" href="quote.html">Request a quotation</a><a class="btn ghost onDark" href="products.html">See the product line</a></div>
<div class="strip">{''.join(f'<span>{H.escape(x)}</span>' for x in h['strip'])}</div></div></header>
<section class="s"><div class="wrap"><div class="eyebrow">Markets</div><h2>Built for the projects the grid is waiting for</h2>
<div class="grid4">{cards}</div></div></section>
<section class="s alt"><div class="wrap"><div class="cols"><div><div class="eyebrow">Farpoint Energy</div><h2>{H.escape(h['edge_h'])}</h2>{''.join(f'<p style="margin-top:14px">{H.escape(p)}</p>' for p in h['edge'])}</div>
<div><div class="tiles" style="margin-top:0">{''.join(f'<div class="tile"><div class="v">{H.escape(v)}</div><div class="l">{H.escape(l)}</div></div>' for v,l in h['tiles'])}</div></div></div></div></section>
<section class="s"><div class="wrap"><div class="eyebrow">Product line</div><h2>Four families, one standard</h2><div class="grid4">{fam}</div></div></section>
<section class="s alt"><div class="wrap"><div class="cols"><div><div class="eyebrow">Process</div><h2>{H.escape(h['how_h'])}</h2>{steps(h['how'])}</div>
<div><div class="eyebrow">Warranty &amp; service</div><h2>{H.escape(DELIVERY['warranty_h'])}</h2><p style="margin-top:14px">{H.escape(DELIVERY['warranty'])}</p>{checks(DELIVERY['service'][:3])}<a class="btn" style="margin-top:8px" href="delivery.html">Delivery and warranty</a></div></div></div></section>
"""
(OUT/"index.html").write_text(page("Farpoint Energy — Power transformers, engineered to your specification", home, "index.html", "Power transformers to 250 MVA and 230 kV for renewable, storage, data center, industrial, and utility projects. IEEE C57 design and test, three-year warranty, 100 units per year."))

# ---------- PRODUCTS
lineup = "".join(f'<tr><td class="sku">{H.escape(a)}</td><td class="v">{H.escape(b)}</td><td class="v">{H.escape(c)}</td><td class="v">{H.escape(d)}</td><td>{H.escape(e)}</td></tr>' for a,b,c,d,e in LINEUP)
params = "".join(f'<tr><td class="k">{H.escape(a)}</td><td>{H.escape(b)}</td><td>{H.escape(c)}</td></tr>' for a,b,c in PARAMS)
opts = "".join(f'<tr><td class="k">{H.escape(a)}</td><td>{H.escape(b)}</td><td>{H.escape(c)}</td></tr>' for a,b,c in OPTIONS)
famsec = ""
for f in FAMILIES:
    if f["detail"]:
        famsec += f"""
<section class="s" id="{f['id']}"><div class="wrap"><div class="eyebrow">{H.escape(f['tag'])}</div><h2>{H.escape(f['name'])}</h2><p style="margin-top:14px">{H.escape(f['body'])}</p>
<p class="small muted">{H.escape(COMMON)}</p>
<div class="tbl"><table><thead><tr><th>Configuration</th><th>Rating (MVA)</th><th>High side</th><th>Low side</th><th>Typical project fit</th></tr></thead><tbody>{lineup}</tbody></table></div>
<div class="cols" style="margin-top:36px"><div><h3>Sizing basis</h3><p>Top rating ≥ point-of-interconnection MW ÷ required power factor, plus margin for altitude, ambient, and duty. At 0.95, 45 MW calls for a 50 MVA unit and 90 MW for a 100 MVA unit; a 160 MW site is two 100-class units with phased energization. Storage and hybrid duty profiles are checked before the configuration is confirmed.</p></div>
<div><h3>Already have a specification?</h3><p>Send it. Every quotation answers it clause by clause — comply, comply with clarification, or exception — every clause answered. Your utility's standard specification works the same way.</p><a class="btn" href="quote.html">Request a quotation</a></div></div>
<h3 style="margin-top:36px">Design parameters — set by your project</h3><p class="small muted">Every order settles these. The standard value is what the catalog unit is built to; the range is how far it moves within the same design.</p>
<div class="tbl"><table><thead><tr><th>Parameter</th><th>Standard</th><th>Range within the design</th></tr></thead><tbody>{params}</tbody></table></div>
<h3 style="margin-top:36px">Options — add to the standard unit</h3>
<div class="tbl"><table><thead><tr><th>Option</th><th>What it is</th><th>When you'd specify it</th></tr></thead><tbody>{opts}</tbody></table></div>
<h3 style="margin-top:36px">Standard accessories</h3><p class="small">{H.escape(ACCESSORIES)}</p>
<p><a class="btn ghost" href="{SITE['catalog']}">Datasheets and full specification — catalog PDF</a></p>
</div></section>"""
    else:
        famsec += f"""
<section class="s alt" id="{f['id']}"><div class="wrap"><div class="cols"><div><div class="eyebrow">{H.escape(f['tag'])}</div><h2>{H.escape(f['name'])}</h2><p style="margin-top:14px">{H.escape(f['body'])}</p><a class="btn" href="quote.html">Request a quotation</a></div>
<div><div class="panel" style="margin-top:0"><b>Engineered to order.</b> Send your specification or single-line and site data. Every unit is designed to IEEE C57 and your utility's requirements, built under the same inspection and test program as the standard line, and covered by the same warranty.</div></div></div></div></section>"""
products = f"""
<header class="hero" style="padding-block:clamp(40px,6vw,72px)"><div class="wrap"><div class="eyebrow">Products</div><h1>Power transformers to 250 MVA and 230 kV</h1><p class="sub">A standard line for renewable and storage interconnections, and generator step-up, substation, and auto transformers engineered to your specification.</p></div></header>
{famsec}"""
(OUT/"products.html").write_text(page("Products — Farpoint Energy", products, "products.html", "FP-MPT main power transformers 30–100 MVA at 115/138 kV, plus generator step-up, substation, and auto transformers to 250 MVA and 230 kV."))

# ---------- MARKETS
msec = "".join(f"""
<section class="s{' alt' if i%2 else ''}" id="{m['id']}"><div class="wrap"><div class="cols"><div><div class="eyebrow">Markets</div><h2>{H.escape(m['name'])}</h2><p style="margin-top:14px;font-family:Archivo;font-size:19px">{H.escape(m['lead'])}</p></div>
<div><p>{H.escape(m['body'])}</p><a class="btn ghost" href="{m['href']}">{H.escape(m['cta'])}</a></div></div></div></section>""" for i,m in enumerate(MARKETS))
markets = f"""
<header class="hero" style="padding-block:clamp(40px,6vw,72px)"><div class="wrap"><div class="eyebrow">Markets</div><h1>Every project loads a transformer differently</h1><p class="sub">What your site does to the unit, and what changes in the design because of it.</p></div></header>{msec}"""
(OUT/"markets.html").write_text(page("Markets — Farpoint Energy", markets, "markets.html", "Power transformers for utility-scale solar, battery storage, hybrid, wind, data centers, industrial plants, utilities, and fleet replacement."))

# ---------- QUALITY
q = QUALITY
blocks = "".join(f'<div><h3>{H.escape(a)}</h3><p>{H.escape(b)}</p></div>' for a,b in q['blocks'])
stds = "".join(f'<tr class="sec"><td colspan="2">{H.escape(sec)}</td></tr>' + "".join(f'<tr><td class="k mono" style="color:var(--ink)">{H.escape(k)}</td><td>{H.escape(v)}</td></tr>' for k,v in items) for sec,items in q['standards'])
tests = "".join(f'<tr class="sec"><td colspan="2">{H.escape(sec)}</td></tr>' + "".join(f'<tr><td class="k" style="color:var(--ink)">{H.escape(k)}</td><td>{H.escape(v)}</td></tr>' for k,v in items) for sec,items in q['tests'])
quality = f"""
<header class="hero" style="padding-block:clamp(40px,6vw,72px)"><div class="wrap"><div class="eyebrow">Quality</div><h1>{H.escape(q['h'])}</h1></div></header>
<section class="s"><div class="wrap"><div class="cols">{blocks}</div></div></section>
<section class="s alt"><div class="wrap"><div class="eyebrow">For your engineering team</div><h2>Standards, test program, inspection points, and documentation</h2>
<details><summary>Standards</summary><div class="tbl"><table><thead><tr><th>Standard</th><th>What it governs</th></tr></thead><tbody>{stds}</tbody></table></div><p class="small" style="margin-top:14px">Site basis: outdoor installation · altitude up to 1,000 m · 30 °C average and 40 °C maximum ambient · seismic qualification to IEEE 693 Moderate, High where the site requires it; the qualification report and bushing certificates are issued with the approval drawings · tank designed for full vacuum and the pressures of IEEE C57.12.10.</p></details>
<details><summary>Factory test program — IEEE C57.12.90</summary><div class="tbl"><table><thead><tr><th>Test</th><th>Scope</th></tr></thead><tbody>{tests}</tbody></table></div></details>
<details><summary>Inspection and test plan</summary><p class="small">Issued for your sign-off before production. Each point is marked hold (production stops until released), witness, or review.</p>{checks(q['itp'])}</details>
<details><summary>Site program</summary>{checks(q['site'])}</details>
<details><summary>Interfaces and submittals</summary><p>{H.escape(q['interfaces'])}</p></details>
<details><summary>Documentation dossier</summary><p>{H.escape(q['dossier'])}</p></details>
</div></section>"""
(OUT/"quality.html").write_text(page("Quality — Farpoint Energy", quality, "quality.html", "Engineering review, stage-gated inspection, full IEEE C57.12.90 factory test program, and a serialized documentation dossier on every Farpoint transformer."))

# ---------- DELIVERY
d = DELIVERY
stages = "".join(f'<tr><td class="v">{H.escape(a)}</td><td>{H.escape(b)}</td></tr>' for a,b in d['stages'])
delivery = f"""
<header class="hero" style="padding-block:clamp(40px,6vw,72px)"><div class="wrap"><div class="eyebrow">Delivery &amp; warranty</div><h1>From order to energization</h1><p class="sub">{H.escape(d['intro'])}</p></div></header>
<section class="s"><div class="wrap"><div class="cols"><div><h2>Stages</h2><div class="tbl"><table style="min-width:0"><thead><tr><th>Stage</th><th>What happens</th></tr></thead><tbody>{stages}</tbody></table></div></div>
<div><div class="eyebrow">Warranty &amp; service</div><h2>{H.escape(d['warranty_h'])}</h2><p style="margin-top:14px">{H.escape(d['warranty'])}</p>{checks(d['service'])}<a class="btn" href="quote.html">Request a quotation</a></div></div></div></section>"""
(OUT/"delivery.html").write_text(page("Delivery & warranty — Farpoint Energy", delivery, "delivery.html", "100 units per year capacity, committed delivery dates, monthly order status reports, and a three-year warranty from energization with field service from Farpoint."))

# ---------- QUOTE
qq = QUOTE
form = f'<div class="formwrap"><iframe src="{SITE["form_url"]}" title="Request a quotation"></iframe></div>' if SITE['form_url'] else f'<div class="panel" style="margin-top:0"><b>Email your request.</b> Send your specification or single-line to <a href="mailto:{SITE["email"]}?subject=Quotation%20request">{SITE["email"]}</a>, or call <a href="tel:{SITE["phone_raw"]}">{SITE["phone"]}</a>.</div>'
quote = f"""
<header class="hero" style="padding-block:clamp(40px,6vw,72px)"><div class="wrap"><div class="eyebrow">Request a quotation</div><h1>{H.escape(qq['h'])}</h1><p class="sub">{H.escape(qq['sub'])}</p></div></header>
<section class="s"><div class="wrap"><div class="cols"><div><h2>Three ways to start</h2>{steps(qq['ways'])}<h3 style="margin-top:28px">What to send</h3>{checks(qq['send'])}</div>
<div>{form}<div class="card" style="margin-top:16px"><div class="tag">Contact</div><h3>Karan Uppal</h3><p class="muted">Founder</p><p><a href="mailto:{SITE['founder_email']}">{SITE['founder_email']}</a><br><a href="tel:{SITE['phone_raw']}">{SITE['phone']}</a></p><p class="muted">{SITE['city']}</p></div></div></div></div></section>"""
(OUT/"quote.html").write_text(page("Request a quotation — Farpoint Energy", quote, "quote.html", "Pick a configuration, send your specification, or send a single-line diagram and site data. Farpoint returns a quotation and compliance matrix."))

# ---------- ABOUT
a = ABOUT
about = f"""
<header class="hero" style="padding-block:clamp(40px,6vw,72px)"><div class="wrap"><div class="eyebrow">About</div><h1>{H.escape(a['h'])}</h1></div></header>
<section class="s"><div class="wrap"><div class="cols"><div>{''.join(f'<p>{H.escape(p)}</p>' for p in a['body'])}<a class="btn" href="quote.html">Request a quotation</a></div>
<div class="tiles" style="margin-top:0">{''.join(f'<div class="tile"><div class="v">{H.escape(v)}</div><div class="l">{H.escape(l)}</div></div>' for v,l in HOME['tiles'])}</div></div></div></section>"""
(OUT/"about.html").write_text(page("About — Farpoint Energy", about, "about.html", "Farpoint Energy builds power transformers for the US grid, based in New York."))

# ---------- 404, sitemap, css
(OUT/"404.html").write_text(page("Page not found — Farpoint Energy", '<section class="s"><div class="wrap"><h1>Page not found</h1><p style="margin-top:14px"><a href="index.html">Back to the home page</a></p></div></section>', "", "Page not found"))
pages = ["index","products","markets","quality","delivery","quote","about"]
(OUT/"sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(f'  <url><loc>{SITE["domain"]}/{p}.html</loc></url>\n' for p in pages) + '</urlset>\n')
(OUT/"style.css").write_text(CSS.strip()+"\n")
(OUT/"README.md").write_text("# farpointenergy.com\n\nStatic site. Edit `content.py`, run `python3 build.py`, commit the generated HTML. Hosted on GitHub Pages.\n")
print("built", ", ".join(p+".html" for p in pages))
