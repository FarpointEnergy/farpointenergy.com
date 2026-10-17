#!/usr/bin/env python3
"""Farpoint Energy website generator. Content lives in content.py; run `python3 build.py` to regenerate all pages."""
import pathlib, html as H, json
from content import *
from inquiry import render_form, thanks_content
OUT = pathlib.Path(__file__).parent
E = H.escape
MARK = '<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="1" y="1" width="38" height="38" fill="none" stroke="#C4732C" stroke-width="3"/><line x1="7" y1="28" x2="33" y2="28" stroke="currentColor" stroke-width="3"/><circle cx="29" cy="13" r="4" fill="#C4732C"/></svg>'
NAV = [("Products", "products.html"), ("Applications", "applications.html"), ("Manufacturing base", "manufacturing.html"),
       ("Quality", "quality.html"), ("Delivery & warranty", "delivery.html"), ("About", "about.html")]

# Single-line diagram: generation → inverter → transformer → breaker → POI bus. Copper on navy.
DIAGRAM = """<svg class="sld" viewBox="0 0 560 300" aria-label="Single-line diagram: generation, inverter, main power transformer, breaker, point of interconnection" role="img">
<defs><pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#2A3D53" stroke-width=".6"/></pattern></defs>
<rect width="560" height="300" fill="url(#g)"/>
<g fill="none" stroke="#C4732C" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
<rect x="22" y="112" width="60" height="42" rx="2"/><path d="M32 112v42M42 112v42M52 112v42M62 112v42M72 112v42M22 126h60M22 140h60"/>
<path d="M82 133h40"/>
<rect x="122" y="106" width="56" height="54" rx="2"/><path d="M122 160l56-54"/><path d="M130 122h18"/><path d="M148 148c4-8 10-8 14 0"/>
<path d="M178 133h44"/>
<circle cx="247" cy="133" r="24"/><circle cx="279" cy="133" r="24"/>
<path d="M303 133h40"/>
<rect x="343" y="118" width="30" height="30"/><path d="M373 133h40"/>
<path d="M413 60v146" stroke-width="4"/>
<path d="M413 100h70M413 166h70"/><path d="M483 100l12-8v16zM483 166l12-8v16z" fill="#C4732C"/>
<path d="M263 157v28" stroke-dasharray="3 4"/><path d="M251 185h24M255 191h16M259 197h8"/>
</g>
<g font-family="IBM Plex Mono,ui-monospace,monospace" font-size="11" fill="#DCE2E8" letter-spacing=".08em">
<text x="22" y="176">GENERATION</text><text x="122" y="182">INVERTER</text><text x="222" y="216">MAIN POWER</text><text x="222" y="230">TRANSFORMER</text>
<text x="337" y="170">BREAKER</text><text x="548" y="52" text-anchor="end">POINT OF INTERCONNECTION</text>
<text x="190" y="98" fill="#C4732C">34.5 kV</text><text x="303" y="98" fill="#C4732C">69 – 230 kV</text>
</g></svg>"""

CSS = """
:root{--ink:#0E1B2B;--ink2:#16263A;--copper:#C4732C;--copper-dk:#9E5A1F;--steel:#EEF1F4;--slate:#5A6675;--line:#CBD3DB;--paper:#FFFFFF;--tint:#F7F8FA;--text:#0E1B2B;
--f-display:"Archivo",system-ui,-apple-system,"Segoe UI",Arial,sans-serif;--f-body:"Source Sans 3",system-ui,-apple-system,"Segoe UI",Arial,sans-serif;--f-mono:"IBM Plex Mono",ui-monospace,SFMono-Regular,Menlo,monospace}
*{box-sizing:border-box}html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--text);font-family:var(--f-body);font-size:17px;line-height:1.55;overflow-x:hidden}
a{color:var(--copper-dk)}img,svg{max-width:100%}
h1,h2,h3,h4{font-family:var(--f-display);letter-spacing:-0.01em;line-height:1.12;margin:0;text-wrap:balance;overflow-wrap:anywhere}
h1{font-size:clamp(30px,6.5vw,54px);font-weight:700}h2{font-size:clamp(24px,4vw,36px);font-weight:700}h3{font-size:20px;font-weight:600}h4{font-size:16px;font-weight:600}
p{margin:0 0 14px;max-width:66ch}
.eyebrow{font-family:var(--f-mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--copper);margin-bottom:10px}
.mono{font-family:var(--f-mono)}.muted{color:var(--slate)}.small{font-size:15px}.mt{margin-top:14px}
.wrap{max-width:1120px;margin:0 auto;padding-inline:clamp(16px,4vw,40px)}
.nav{background:var(--ink);color:#fff;position:sticky;top:0;z-index:20}
.nav .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:14px;flex-wrap:wrap}
.brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-family:var(--f-display);font-weight:700;letter-spacing:.16em;font-size:14px;white-space:nowrap}
.brand .mark{width:22px;height:22px;color:#fff;flex:none}.brand span{font-weight:400;color:#B9C3CE;letter-spacing:.2em}
.nav ul{list-style:none;margin:0;padding:0;display:flex;gap:22px;flex-wrap:wrap;align-items:center}
.nav a.l{color:#DCE2E8;text-decoration:none;font-size:15px;padding-block:4px;border-bottom:2px solid transparent}.nav a.l:hover,.nav a.l[aria-current]{color:#fff;border-bottom-color:var(--copper)}
.navtoggle,.navbtn{display:none}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:44px;background:var(--copper);color:#fff;text-decoration:none;font-family:var(--f-display);font-weight:600;padding:10px 20px;border-radius:2px;font-size:15px;border:0;cursor:pointer}
.btn:hover{background:var(--copper-dk)}.btn.ghost{background:transparent;border:1.5px solid var(--copper);color:var(--copper)}.btn.ghost.onDark{color:#fff;border-color:#fff}
.nav .btn{min-height:40px;padding:8px 16px}
.hero{background:var(--ink);color:#fff;padding-block:clamp(48px,8vw,104px);position:relative;overflow:hidden}
.hero .wrap{display:grid;grid-template-columns:minmax(0,7fr) minmax(0,5fr);gap:40px;align-items:center}
.hero.plain .wrap{display:block}
.hero h1{color:#fff;max-width:18ch}.hero .sub{font-family:var(--f-display);font-weight:400;font-size:clamp(17px,2vw,21px);color:#B9C3CE;max-width:52ch;margin-top:18px}
.hero .cta{display:flex;gap:14px;flex-wrap:wrap;margin-top:28px}
.sld{width:100%;height:auto;display:block;border:1px solid #2A3D53}
.strip{border-top:1px solid #33465B;margin-top:44px;padding-top:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px 24px;font-family:var(--f-mono);font-size:13px;letter-spacing:.06em;color:#DCE2E8;grid-column:1/-1}
section.s{padding-block:clamp(44px,7vw,84px)}section.s.alt{background:var(--tint)}section.s.dark{background:var(--ink);color:#fff}section.s.dark h2,section.s.dark h3{color:#fff}section.s.dark p{color:#DCE2E8}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:36px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,200px),1fr));gap:14px;margin-top:24px}
.tile{background:var(--steel);padding:18px 20px;border-top:3px solid var(--copper);color:var(--ink)}
.tile .v{font-family:var(--f-display);font-weight:700;font-size:clamp(22px,3vw,30px);line-height:1.05;overflow-wrap:anywhere}
.tile .l{font-family:var(--f-mono);font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--slate);margin-top:6px}
.steps{counter-reset:s;list-style:none;margin:20px 0 0;padding:0}
.steps li{display:grid;grid-template-columns:40px 1fr;gap:14px;padding:16px 0;border-top:1px solid var(--line)}
.steps li::before{counter-increment:s;content:counter(s,decimal-leading-zero);font-family:var(--f-mono);color:var(--copper);font-size:15px;padding-top:3px}
.steps b{font-family:var(--f-display);font-weight:600;display:block;margin-bottom:3px}
.panel{background:var(--tint);border-left:3px solid var(--copper);padding:16px 20px;margin:18px 0;max-width:70ch}
.tbl{overflow-x:auto;border:1px solid var(--line);background:#fff;margin-top:20px;-webkit-overflow-scrolling:touch}
table{border-collapse:collapse;width:100%;font-size:15px}
th,td{text-align:left;vertical-align:top;padding:10px 12px;border-bottom:1px solid var(--line)}
th{font-family:var(--f-mono);font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--slate);background:var(--steel);font-weight:500}
td.k{color:var(--slate);width:30%}td.v{font-family:var(--f-mono);font-size:14px;white-space:nowrap}
tr.sec td{background:var(--tint);font-family:var(--f-display);font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase}
.sku{font-family:var(--f-mono);font-weight:500;white-space:nowrap}
ul.check{list-style:none;padding:0;margin:12px 0}ul.check li{position:relative;padding-left:18px;margin:8px 0}
ul.check li::before{content:"";position:absolute;left:0;top:10px;width:7px;height:7px;background:var(--copper)}
.card{border:1px solid var(--line);padding:22px 24px;background:#fff;display:flex;flex-direction:column;gap:8px;color:var(--ink)}
.card .tag{font-family:var(--f-mono);font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--copper)}
.card p{margin:0}.card a.more{margin-top:auto;font-family:var(--f-display);font-weight:600;text-decoration:none;color:var(--copper-dk)}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px;margin-top:20px}
.grid4{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:16px;margin-top:20px}
details{border-top:1px solid var(--line);padding:14px 0}details summary{cursor:pointer;font-family:var(--f-display);font-weight:600;font-size:18px;list-style:none;display:flex;justify-content:space-between;gap:12px}
details summary::-webkit-details-marker{display:none}details summary::after{content:"+";color:var(--copper);font-weight:400;flex:none}details[open] summary::after{content:"–"}
footer{background:var(--ink);color:#B9C3CE;padding-block:40px;font-size:14px}
footer .wrap{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}footer a{color:#fff}
form.q{display:grid;grid-template-columns:1fr 1fr;gap:14px 16px}form.q .full{grid-column:1/-1}
form.q label{display:block;font-family:var(--f-mono);font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--slate);margin-bottom:5px}
form.q input,form.q select,form.q textarea{width:100%;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:2px;background:#fff;color:var(--ink);min-height:44px}
form.q textarea{min-height:120px;resize:vertical}form.q input:focus,form.q select:focus,form.q textarea:focus{outline:2px solid var(--copper);outline-offset:1px;border-color:var(--copper)}
.formbox{border:1px solid var(--line);background:#fff;padding:clamp(16px,3vw,28px)}
@media (max-width:900px){
 .nav .wrap{padding-block:10px}.navbtn{display:inline-flex;align-items:center;gap:8px;color:#fff;font-family:var(--f-display);font-weight:600;font-size:14px;cursor:pointer;padding:8px 0;min-height:44px;margin-left:auto}
 .navbtn i{display:block;width:22px;height:2px;background:#fff;box-shadow:0 -7px 0 #fff,0 7px 0 #fff}
 .nav ul{display:none;width:100%;flex-direction:column;align-items:stretch;gap:0;padding-block:6px 10px;border-top:1px solid #33465B}
 .nav ul li a.l{display:block;padding:12px 0;font-size:17px;border-bottom:1px solid #1F3247}.nav ul li a.l[aria-current]{border-bottom-color:var(--copper)}
 .nav ul li:last-child{padding-top:12px}.nav .btn{width:100%}
 .navtoggle:checked~ul{display:flex}
 .hero .wrap{grid-template-columns:1fr;gap:28px}.hero .sld{max-width:520px}
 .hero .cta .btn{width:100%}.strip{grid-template-columns:1fr 1fr;margin-top:32px}
 .steps li{grid-template-columns:32px 1fr}form.q{grid-template-columns:1fr}
 table.stack thead{display:none}table.stack tr{display:block;padding:8px 0;border-bottom:2px solid var(--line)}
 table.stack td{display:grid;grid-template-columns:110px 1fr;gap:10px;border:0;padding:5px 12px;white-space:normal}
 table.stack td::before{content:attr(data-label);font-family:var(--f-mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--slate);padding-top:2px}
 table.stack td.sku{display:block;font-size:16px;font-family:var(--f-display);font-weight:600;padding-top:8px}table.stack td.sku::before{display:none}
}
"""

CSS += """
[hidden]{display:none!important}.skip{position:absolute;left:16px;top:-100px;z-index:30;background:#fff;padding:12px}.skip:focus{top:8px}
:focus-visible{outline:3px solid var(--copper);outline-offset:4px}main{display:block}section[id]{scroll-margin-top:100px}
.cols>*,.hero .wrap>*,form.q>*{min-width:0}.navbtn{background:none;border:0}.diagram-caption{font-size:13px;color:#B9C3CE;margin:10px 0 0}
.s:not(.dark) .eyebrow,.card .tag{color:var(--copper-dk)}.jump-links{display:flex;gap:22px;flex-wrap:wrap;margin-top:24px}.jump-links a{color:#fff}
.unit-pair{display:grid;grid-template-columns:minmax(0,1fr) 5.5rem;gap:8px}.optional-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px 16px;margin-top:16px}
.field-hint{font-size:10px;letter-spacing:0}.field-error{color:#9A2A21;font-size:14px;margin:6px 0 0}.form-status{padding:12px;border-left:3px solid var(--copper);background:var(--tint);margin-top:14px}button:disabled{opacity:.65;cursor:default}
.btn{background:var(--copper-dk)}.btn:hover{background:#804817}.btn.ghost{background:transparent;color:var(--copper-dk);border-color:var(--copper-dk)}.btn.ghost:hover{background:var(--tint)}.btn.ghost.onDark{color:#fff;border-color:#fff}.btn.ghost.onDark:hover{background:var(--ink2)}
.steps li::before{color:var(--copper-dk)}form.q input,form.q select,form.q textarea{border-color:#7A8795}details summary{min-height:44px;align-items:center}.nav .btn{min-height:44px}
section[id],#main{scroll-margin-top:140px}
@media(max-width:900px){.nav ul{display:flex}.nav:not(.menu-ready){position:static}.nav.menu-ready ul{max-height:calc(100vh - 80px);max-height:calc(100dvh - 80px);overflow-y:auto}.nav.menu-ready ul:not(.is-open){display:none}.optional-grid{grid-template-columns:1fr}section[id],#main{scroll-margin-top:84px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
"""

def page(title, body, current, desc):
    VER = __import__("hashlib").md5(CSS.encode()).hexdigest()[:8]
    script_versions = {name: __import__("hashlib").sha256((OUT / name).read_bytes()).hexdigest()[:10] for name in ("site.js", "inquiry.js")}
    route = current or "404.html"
    canonical = SITE['domain'].rstrip('/') + ('/' if route == 'index.html' else '/' + route)
    robots = '<meta name="robots" content="noindex,follow">' if route in {'thanks.html','404.html'} else ''
    org = json.dumps({'@context':'https://schema.org','@type':'Organization','name':'Farpoint Energy','url':SITE['domain'],'email':SITE['email'],'telephone':SITE['phone']})
    nav = "".join('<li><a class="l" href="%s"%s>%s</a></li>' % (h, ' aria-current="page"' if h == current else '', t) for t, h in NAV)
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(title)}</title><meta name="description" content="{E(desc, quote=True)}">
<link rel="canonical" href="{canonical}">{robots}
<meta property="og:type" content="website"><meta property="og:site_name" content="Farpoint Energy"><meta property="og:url" content="{canonical}">
<meta property="og:title" content="{E(title, quote=True)}"><meta property="og:description" content="{E(desc, quote=True)}"><meta property="og:image" content="{SITE['domain']}/social-card.png">
<meta name="twitter:card" content="summary_large_image"><script type="application/ld+json">{org}</script>
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="style.css?v={VER}">
<script src="site.js?v={script_versions['site.js']}" defer></script><script src="inquiry.js?v={script_versions['inquiry.js']}" defer></script>
</head><body><a class="skip" href="#main">Skip to content</a>
<nav class="nav" aria-label="Main navigation"><div class="wrap"><a class="brand" href="index.html">{MARK}FARPOINT&nbsp;<span>ENERGY</span></a>
<button type="button" class="navbtn" aria-controls="site-menu" aria-expanded="false" hidden><i aria-hidden="true"></i>Menu</button>
<ul id="site-menu">{nav}<li><a class="btn" href="quote.html">Request a quotation</a></li></ul></div></nav>
<main id="main" tabindex="-1">{body}</main>
<footer><div class="wrap"><div><div class="brand" style="margin-bottom:10px">{MARK}FARPOINT&nbsp;<span>ENERGY</span></div>Power and distribution transformers, engineered to your specification.<br>{SITE['city']}</div>
<div><a href="mailto:{SITE['email']}">{SITE['email']}</a><br><a href="tel:{SITE['phone_raw']}">{SITE['phone']}</a><br><a href="quote.html">Request a quotation</a></div>
<div class="mono" style="font-size:12px;align-self:flex-end">© 2026 Farpoint Energy · <a href="privacy.html">Privacy</a></div></div></footer>
</body></html>"""

def hero(eyebrow, h1, sub=None, diagram=False, cta=None, strip=None):
    inner = f'<div><div class="eyebrow">{E(eyebrow)}</div><h1>{E(h1)}</h1>' + (f'<p class="sub">{E(sub)}</p>' if sub else '') + (cta or '') + '</div>'
    if diagram: inner += f'<div>{DIAGRAM}<p class="diagram-caption">Illustrative generation/interconnection example.</p></div>'
    if strip: inner += f'<div class="strip">{"".join(f"<span>{E(x)}</span>" for x in strip)}</div>'
    cls = "hero" if diagram else "hero plain"
    sty = "" if diagram else ' style="padding-block:clamp(40px,6vw,72px)"'
    return f'<header class="{cls}"{sty}><div class="wrap">{inner}</div></header>'

def steps(items): return '<ol class="steps">' + "".join(f'<li><div><b>{E(b)}</b>{E(t)}</div></li>' for b, t in items) + '</ol>'
def checks(items): return '<ul class="check">' + "".join(f'<li>{E(i)}</li>' for i in items) + '</ul>'
def tiles(items, mt=True): return f'<div class="tiles"{"" if mt else " style=margin-top:0"}>' + "".join(f'<div class="tile"><div class="v">{E(v)}</div><div class="l">{E(l)}</div></div>' for v, l in items) + '</div>'

CAP_HEAD = ["Family", "High-voltage class", "Rating", "Typical use"]
def cap_table(notes=True):
    heads = CAP_HEAD
    rows = ""
    for r in CAPABILITY:
        cells = [r[0], r[1], r[2], r[4]]
        rows += "<tr>" + "".join(f'<td data-label="{heads[i]}" class="{"sku" if i==0 else ("v" if i in (1,2) else "")}">{E(c)}</td>' for i, c in enumerate(cells)) + "</tr>"
    return f'<div class="tbl"><table class="stack"><thead><tr>{"".join(f"<th>{h}</th>" for h in heads)}</tr></thead><tbody>{rows}</tbody></table></div><p class="small muted" style="margin-top:10px">{E(CAP_NOTE)}</p>'

# ---------- HOME
summary_rows = ''.join(f'<tr><td><a href="products.html#{E(anchor)}">{E(family)}</a></td><td>{E(use)}</td></tr>' for family,use,anchor in PRODUCT_SUMMARY)
summary_table = f'<div class="tbl"><table><thead><tr><th>Product family</th><th>Project scope</th></tr></thead><tbody>{summary_rows}</tbody></table></div>'
apps = "".join(f'<div class="card"><div class="tag">{E(m["name"])}</div><p>{E(m["lead"])}</p><a class="more" href="applications.html#{m["id"]}">Read more →</a></div>' for m in APPLICATIONS)
home = hero(HERO['eyebrow'], HERO['h1'], HERO['sub'], diagram=True,
            cta='<div class="cta"><a class="btn" href="quote.html">Request a quotation</a><a class="btn ghost onDark" href="products.html">Capability and product line</a></div>', strip=HERO['strip']) + f"""
<section class="s"><div class="wrap"><div class="eyebrow">{E(ETO['h'])}</div><h2>Every unit is designed for its project</h2><p class="mt">{E(ETO['p'])}</p>{summary_table}
<p class="mt"><a class="btn ghost" href="products.html">Product families and reference configurations</a></p></div></section>
<section class="s alt"><div class="wrap"><div class="eyebrow">Applications</div><h2>What your site does to the transformer, and what changes in the design because of it</h2><div class="grid4">{apps}</div></div></section>
<section class="s dark"><div class="wrap"><div class="cols"><div><div class="eyebrow">{E(BASE['h'])}</div><h2>{E(BASE['model_h'])}</h2><p class="mt">{E(BASE['model'])}</p><p><a class="btn ghost onDark" href="manufacturing.html">The manufacturing base</a></p></div>
<div>{tiles(BASE['facts'], mt=False)}</div></div></div></section>
<section class="s"><div class="wrap"><div class="cols"><div><div class="eyebrow">Quality</div><h2>{E(QUALITY['h'])}</h2><p class="mt">{E(QUALITY['blocks'][2][1])}</p><p><a href="quality.html">Test program, inspection points, and documentation →</a></p></div>
<div><div class="eyebrow">Delivery &amp; warranty</div><h2>{E(DELIVERY['warranty_h'])}</h2><p class="mt">{E(DELIVERY['warranty'])}</p><p><a href="delivery.html">Lead time, stages, and service →</a></p></div></div></div></section>
"""
(OUT/"index.html").write_text(page("Farpoint Energy — Power and distribution transformers", home, "index.html", "Power and distribution transformers engineered for data centers, solar, storage, utilities, and industrial projects. Project-specific designs and a three-year warranty from energization."))

# ---------- PRODUCTS
s = STANDARD
lineup = "".join(f'<tr><td class="sku" data-label="Configuration">{E(a)}</td><td class="v" data-label="Rating">{E(b)}</td><td class="v" data-label="High side">{E(c)}</td><td class="v" data-label="Low side">{E(d)}</td></tr>' for a,b,c,d in s['lineup'])
bil_rows = ''.join(f'<tr><td>{E(r[0])}</td><td>{E(r[3])}</td></tr>' for r in CAPABILITY)
dist_rows = ''.join(f'<tr><td class="k">{E(label)}</td><td>{E(text)}</td></tr>' for label,text in DISTRIBUTION['choices'])
products = hero("Products", "Power and distribution transformers", "Main power and incoming-substation transformers, plus distribution and medium-voltage packages engineered for your site.", cta='<div class="jump-links"><a href="#power">Power transformers ↓</a><a href="#distribution">Distribution transformers ↓</a></div>') + f"""
<section class="s" id="power"><div class="wrap"><div class="eyebrow">Power transformers</div><h2>Power-transformer reference ranges</h2><p class="mt">{E(ETO['p'])}</p>{cap_table()}
<details><summary>Insulation levels and engineering detail</summary><p class="small mt">Basic impulse insulation level (BIL) is selected for the system and insulation coordination requirements. The high-side values below accompany the reference ranges.</p><div class="tbl"><table><thead><tr><th>Family</th><th>Reference high-side BIL</th></tr></thead><tbody>{bil_rows}</tbody></table></div></details>
<details><summary>FP-MPT reference configurations — ratings, cooling, taps, and options</summary><h3 class="mt">{E(s['h'])}</h3><p class="mt">{E(s['p'])}</p>
<div class="tbl"><table class="stack"><thead><tr><th>Configuration</th><th>Rating</th><th>High side</th><th>Low side</th></tr></thead><tbody>{lineup}</tbody></table></div>
<p class="small muted" style="margin-top:12px">{E(s['common'])}</p><p class="small">{E(s['options'])}</p>
<div class="panel">{E(s['catalog_note'])}</div></details>
<p class="mt"><a href="quote.html?product=power">Request a power-transformer quotation →</a></p></div></section>
<section class="s alt" id="distribution"><div class="wrap"><div class="eyebrow">Distribution transformers</div><h2>{E(DISTRIBUTION['h'])}</h2><p class="mt">{E(DISTRIBUTION['intro'])}</p>
<div class="tbl"><table><thead><tr><th>Configuration</th><th>Project choices</th></tr></thead><tbody>{dist_rows}</tbody></table></div>
<p class="mt">For <a href="applications.html?product=distribution#datacenter">data-center site distribution</a> and <a href="applications.html?product=distribution#solar">solar</a> or <a href="applications.html?product=distribution#storage">storage packages</a>, define quantities and delivery phases alongside the electrical requirements.</p>
<p><a href="quote.html?product=distribution">Request a distribution-transformer quotation →</a></p></div></section>"""
(OUT/"products.html").write_text(page("Products — Farpoint Energy", products, "products.html", "Power-transformer reference ranges and FP-MPT configurations, plus project-specific distribution and medium-voltage transformers for data centers, solar, and storage."))

# ---------- APPLICATIONS
APP_CONTEXT = {'utilities':'utility','solar':'solar','storage':'storage','hybrid':'hybrid','datacenter':'data-center','industrial':'industrial','wind':'other','replacement':'other'}
def application_links(m):
    app = APP_CONTEXT[m['id']]
    categories = '<a href="products.html?application=' + app + '#power">Power transformers</a>'
    if m['id'] in {'datacenter','solar','storage','hybrid','industrial','utilities','replacement'}:
        categories += ' · <a href="products.html?application=' + app + '#distribution">Distribution transformers</a>'
    return '<p class="small mt">' + categories + '</p><p><a href="quote.html?application=' + app + '">Discuss this application →</a></p>'
asec = "".join(f"""
<section class="s{' alt' if i%2 else ''}" id="{m['id']}"><div class="wrap"><div class="cols"><div><div class="eyebrow">Applications</div><h2>{E(m['name'])}</h2><p class="mt" style="font-family:var(--f-display);font-size:19px">{E(m['lead'])}</p></div>
<div><p>{E(m['body'])}</p>{application_links(m)}</div></div></div></section>""" for i,m in enumerate(APPLICATIONS))
applications = hero("Applications", "Every project loads a transformer differently", "What your site does to the unit, and what changes in the design because of it.") + asec + f"""
<section class="s dark"><div class="wrap"><h2>Your application is not listed?</h2><p class="mt">Special-duty units, ester-filled designs, furnace and rectifier duty, and replacements to an existing nameplate are engineered per project.</p><a class="btn" href="quote.html">Request a quotation</a></div></section>"""
(OUT/"applications.html").write_text(page("Applications — Farpoint Energy", applications, "applications.html", "Power and distribution transformers for utilities, solar, storage, hybrid sites, data centers, industrial plants, wind, and fleet replacement."))

# ---------- MANUFACTURING BASE
b = BASE
manufacturing = hero("Manufacturing base", b['h'], b['intro']) + f"""
<section class="s"><div class="wrap">{tiles(b['facts'], mt=False)}<div class="cols" style="margin-top:36px"><div><h2>Plants and laboratories</h2>{checks(b['lines'])}</div>
<div><h2>{E(b['model_h'])}</h2><p class="mt">{E(b['model'])}</p><p><a href="quality.html">How every unit is inspected and tested →</a></p></div></div></div></section>
<section class="s alt"><div class="wrap"><h2>Visit the plant building your unit</h2><p class="mt">Buyers and owner's engineers are welcome at the plant for the agreed pre-production audit, inspection hold points, and witnessed factory acceptance test. Farpoint arranges the visit and hosts it.</p><a class="btn" href="quote.html">Request a quotation</a></div></section>"""
(OUT/"manufacturing.html").write_text(page("Manufacturing base — Farpoint Energy", manufacturing, "manufacturing.html", "Farpoint coordinates transformer design, manufacturing, inspection, and documentation against the agreed project specification."))

# ---------- QUALITY
q = QUALITY
blocks = "".join(f'<div><h3>{E(a)}</h3><p class="mt">{E(bb)}</p></div>' for a,bb in q['blocks'])
tests = "".join(f'<tr class="sec"><td colspan="2">{E(sec)}</td></tr>' + "".join(f'<tr><td class="k" style="color:var(--ink)">{E(k)}</td><td>{E(v)}</td></tr>' for k,v in items) for sec,items in q['tests'])
quality = hero("Quality", q['h']) + f"""
<section class="s"><div class="wrap"><div class="grid4" style="gap:32px;margin-top:0">{blocks}</div></div></section>
<section class="s alt"><div class="wrap"><div class="eyebrow">For your engineering team</div><h2>Test program, inspection points, standards, and interfaces</h2>
<details style="margin-top:20px"><summary>Factory test program — project scope and IEEE C57.12.90</summary><p class="small mt">{E(q['test_scope'])}</p><div class="tbl"><table><thead><tr><th>Test</th><th>Scope</th></tr></thead><tbody>{tests}</tbody></table></div></details>
<details><summary>Inspection and test plan</summary><p class="small">{E(q['itp_scope'])}</p>{checks(q['itp'])}</details>
<details><summary>Site program</summary><p class="small mt">{E(q['site_scope'])}</p>{checks(q['site'])}</details>
<details><summary>Standards</summary><p class="small mt">{E(q['standards_scope'])}</p><p class="mono small mt">{E(q['standards'])}</p><p class="small">Built to IEC 60076 or regional specifications when the project requires it.</p></details>
<details><summary>Interfaces and submittals</summary><p class="mt">{E(q['interfaces'])}</p></details>
</div></section>
<section class="s"><div class="wrap"><h2>Bring your inspector</h2><p class="mt">Your engineer or third-party inspector is welcome at the agreed hold points and factory acceptance test. We schedule it with you at order.</p><a class="btn" href="quote.html">Request a quotation</a></div></section>"""
(OUT/"quality.html").write_text(page("Quality — Farpoint Energy", quality, "quality.html", "Engineering review, inspection hold points, project-specific factory and site tests, and serialized transformer documentation."))

# ---------- DELIVERY
d = DELIVERY
stages = "".join(f'<tr><td class="v">{E(a)}</td><td>{E(bb)}</td></tr>' for a,bb in d['stages'])
delivery = hero("Delivery & warranty", "From order to energization", d['intro']) + f"""
<section class="s"><div class="wrap"><div class="cols"><div><h2>Stages</h2><div class="tbl"><table><thead><tr><th>Stage</th><th>What happens</th></tr></thead><tbody>{stages}</tbody></table></div></div>
<div><div class="eyebrow">Warranty</div><h2>{E(d['warranty_h'])}</h2><p class="mt">{E(d['warranty'])}</p><div class="eyebrow" style="margin-top:28px">Service</div>{checks(d['service'])}<a class="btn" href="quote.html">Request a quotation</a></div></div></div></section>"""
(OUT/"delivery.html").write_text(page("Delivery & warranty — Farpoint Energy", delivery, "delivery.html", "Transformer delivery stages, project schedules, and a three-year warranty from energization with an optional five-year extension."))

# ---------- QUOTE (FormSubmit)
qq = QUOTE
form = render_form(SITE)
quote = hero("Request a quotation", qq['h'], qq['sub']) + f"""
<section class="s"><div class="wrap"><div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))"><div>{form}</div>
<div><h2>Three ways to start</h2>{steps(qq['ways'])}<div class="panel">{E(qq['back'])}</div>
<p class="small">Prefer email or a call? <a href="mailto:{SITE['email']}?subject=Quotation%20request">{SITE['email']}</a> · <a href="tel:{SITE['phone_raw']}">{SITE['phone']}</a></p></div></div></div></section>"""
(OUT/"quote.html").write_text(page("Request a quotation — Farpoint Energy", quote, "quote.html", "Request power or distribution transformers with a reference configuration, specification, or single-line diagram and project outline."))
(OUT/"thanks.html").write_text(page("Your inquiry — Farpoint Energy", thanks_content(SITE), "thanks.html", "Continue your transformer inquiry and share project documents with Farpoint."))

# ---------- ABOUT
a = ABOUT
about = hero("About", a['h'], a['intro']) + f"""
<section class="s"><div class="wrap"><div class="cols"><div><div class="eyebrow">Founder</div><h2>{E(a['founder_name'])}</h2><p class="muted">{E(a['founder_title'])}</p><p>{E(a['founder'])}</p><p>{E(a['advisors'])}</p></div>
<div><div class="eyebrow">Contact</div><h2>New York</h2><p class="mt"><a href="mailto:{SITE['founder_email']}">{SITE['founder_email']}</a><br><a href="mailto:{SITE['email']}">{SITE['email']}</a><br><a href="tel:{SITE['phone_raw']}">{SITE['phone']}</a></p><a class="btn" href="quote.html">Request a quotation</a></div></div></div></section>"""
(OUT/"about.html").write_text(page("About — Farpoint Energy", about, "about.html", "Farpoint Energy supplies power and distribution transformers for the US grid, based in New York."))

# ---------- PRIVACY
privacy = hero("Privacy", "Inquiry information", "How information sent through this website is handled.") + f"""
<section class="s"><div class="wrap"><h2>Information you send</h2><p class="mt">The quotation form collects your contact details and the project information you choose to provide. Farpoint uses it to review your requirement, prepare a response and communicate about the potential supply.</p>
<h2 class="mt">Form and email processing</h2><p class="mt">The form is submitted through <a href="https://formsubmit.co/privacy.pdf">FormSubmit</a> and routed to {SITE['email']}. Email attachments go directly to that business inbox. FormSubmit and the email provider process information as part of those services. Contact us first if a project requires a separate confidential document process.</p>
<h2 class="mt">Website services</h2><p class="mt">This static website is hosted on GitHub Pages and uses Google Fonts. Those services receive technical request information when your browser loads their resources. This website does not currently send inquiry analytics to a tracking service.</p><p>After an accepted form submission, temporary browser session storage may display the confirmation. It is cleared after the confirmation is displayed. A source or campaign code may be included with an inquiry; personal information is not added to page URLs.</p>
<h2 class="mt">Questions and requests</h2><p class="mt">For questions about information you have sent, or to request correction or deletion, email <a href="mailto:{SITE['email']}">{SITE['email']}</a>.</p></div></section>"""
(OUT/"privacy.html").write_text(page("Privacy — Farpoint Energy", privacy, "privacy.html", "How contact and project information submitted through the Farpoint website is processed."))

# ---------- 404, redirects, sitemap, css
(OUT/"404.html").write_text(page("Page not found — Farpoint Energy", '<section class="s"><div class="wrap"><h1>Page not found</h1><p class="mt"><a href="index.html">Back to the home page</a></p></div></section>', "", "Page not found"))
redirects = [("markets.html", "applications.html"), ("contact.html", "quote.html"),
             ("power-transformers.html", "products.html#power"), ("distribution-transformers.html", "products.html#distribution"),
             ("data-centers.html", "applications.html#datacenter"), ("solar-storage.html", "applications.html#solar")]
for old, new in redirects:
    # Compatibility only: retain safe inquiry context, never personal fields.
    script = """(()=>{const u=new URL(DEST,location.href),p=new URLSearchParams(location.search),allow={product:['power','distribution','unsure'],application:['data-center','solar','storage','hybrid','utility','industrial','other'],source:['website','homepage','products','power-transformers','distribution-transformers','applications','data-centers','solar-storage','quality','delivery','manufacturing','about','email'],campaign:['power','distribution','data-center','solar','storage','hybrid','utility','industrial','other']};for(const k of ['product','application','source','campaign']){const v=p.get(k);if(p.getAll(k).length===1&&v&&allow[k].includes(v))u.searchParams.set(k,v)}if(location.pathname.endsWith('/markets.html')&&['#utilities','#solar','#storage','#hybrid','#datacenter','#industrial','#wind','#replacement'].includes(location.hash))u.hash=location.hash;if(location.pathname.endsWith('/solar-storage.html')&&['storage','hybrid'].includes(u.searchParams.get('application')))u.hash=u.searchParams.get('application');location.replace(u.href)})();""".replace('DEST', json.dumps(new))
    (OUT/old).write_text(f'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Farpoint Energy</title><meta name="robots" content="noindex,follow"><script>{script}</script><meta http-equiv="refresh" content="0; url={new}"><link rel="canonical" href="{SITE["domain"]}/{new}"></head><body><a href="{new}">Continue</a></body></html>')
pages = ["index","products","applications","manufacturing","quality","delivery","quote","about","privacy"]
(OUT/"sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(f'  <url><loc>{SITE["domain"]}/{p}.html</loc></url>\n' for p in pages) + '</urlset>\n')
(OUT/"style.css").write_text(CSS.strip()+"\n")
(OUT/"README.md").write_text("""# farpointenergy.com

Static GitHub Pages site. Edit `content.py` for copy and `build.py` for layout, then run `python3 build.py` and commit the generated pages. Preserve `CNAME` and `.nojekyll`.

## Review checks

Run `python3 check_site.py`, `node check_inquiry.js`, and `node check_context.js`. These check baseline preservation, local navigation, reproducible builds, and mocked inquiry/context behavior. They do not send email or prove delivery. Browser review and one controlled inquiry receipt check are required before release.

The quote form progressively enhances a native FormSubmit POST. Only explicit provider acceptance shows success; uncertain transport results retain the entered values. No analytics destination is configured. Preview snapshots must disable submissions and indexing.

Power and distribution are sections of Products. The four former standalone draft routes are compatibility redirects. Catalog PDFs remain unchanged and unlinked.
""")
print("built", ", ".join(p+".html" for p in pages))
