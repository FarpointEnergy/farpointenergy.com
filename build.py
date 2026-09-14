#!/usr/bin/env python3
"""Farpoint Energy website generator. Content lives in content.py; run `python3 build.py` to regenerate all pages."""
import pathlib, html as H
from content import *
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

def page(title, body, current, desc):
    nav = "".join('<li><a class="l" href="%s"%s>%s</a></li>' % (h, ' aria-current="page"' if h == current else '', t) for t, h in NAV)
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><meta name="description" content="{desc}">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="style.css">
</head><body>
<nav class="nav"><div class="wrap"><a class="brand" href="index.html">{MARK}FARPOINT&nbsp;<span>ENERGY</span></a>
<input type="checkbox" id="navtoggle" class="navtoggle" aria-hidden="true"><label for="navtoggle" class="navbtn" aria-label="Menu"><i></i>Menu</label>
<ul>{nav}<li><a class="btn" href="quote.html">Request a quotation</a></li></ul></div></nav>
{body}
<footer><div class="wrap"><div><div class="brand" style="margin-bottom:10px">{MARK}FARPOINT&nbsp;<span>ENERGY</span></div>Power transformers, engineered to your specification.<br>{SITE['city']}</div>
<div><a href="mailto:{SITE['email']}">{SITE['email']}</a><br><a href="tel:{SITE['phone_raw']}">{SITE['phone']}</a><br><a href="quote.html">Request a quotation</a></div>
<div class="mono" style="font-size:12px;align-self:flex-end">© 2026 Farpoint Energy · IEEE C57.12.00 / C57.12.90</div></div></footer>
</body></html>"""

def hero(eyebrow, h1, sub=None, diagram=False, cta=None, strip=None):
    inner = f'<div><div class="eyebrow">{E(eyebrow)}</div><h1>{E(h1)}</h1>' + (f'<p class="sub">{E(sub)}</p>' if sub else '') + (cta or '') + '</div>'
    if diagram: inner += f'<div>{DIAGRAM}</div>'
    if strip: inner += f'<div class="strip">{"".join(f"<span>{E(x)}</span>" for x in strip)}</div>'
    cls = "hero" if diagram else "hero plain"
    sty = "" if diagram else ' style="padding-block:clamp(40px,6vw,72px)"'
    return f'<header class="{cls}"{sty}><div class="wrap">{inner}</div></header>'

def steps(items): return '<ol class="steps">' + "".join(f'<li><div><b>{E(b)}</b>{E(t)}</div></li>' for b, t in items) + '</ol>'
def checks(items): return '<ul class="check">' + "".join(f'<li>{E(i)}</li>' for i in items) + '</ul>'
def tiles(items, mt=True): return f'<div class="tiles"{"" if mt else " style=margin-top:0"}>' + "".join(f'<div class="tile"><div class="v">{E(v)}</div><div class="l">{E(l)}</div></div>' for v, l in items) + '</div>'

CAP_HEAD = ["Family", "HV class", "Rating", "BIL (HV)", "Typical use"]
def cap_table(notes=True):
    heads = CAP_HEAD if notes else CAP_HEAD[:4]
    rows = ""
    for r in CAPABILITY:
        cells = r if notes else r[:4]
        rows += "<tr>" + "".join(f'<td data-label="{heads[i]}" class="{"sku" if i==0 else ("v" if i in (1,2,3) else "")}">{E(c)}</td>' for i, c in enumerate(cells)) + "</tr>"
    return f'<div class="tbl"><table class="stack"><thead><tr>{"".join(f"<th>{h}</th>" for h in heads)}</tr></thead><tbody>{rows}</tbody></table></div><p class="small muted" style="margin-top:10px">{E(CAP_NOTE)}</p>'

# ---------- HOME
apps = "".join(f'<div class="card"><div class="tag">{E(m["name"])}</div><p>{E(m["lead"])}</p><a class="more" href="applications.html#{m["id"]}">Read more →</a></div>' for m in APPLICATIONS)
home = hero(HERO['eyebrow'], HERO['h1'], HERO['sub'], diagram=True,
            cta='<div class="cta"><a class="btn" href="quote.html">Request a quotation</a><a class="btn ghost onDark" href="products.html">Capability and product line</a></div>', strip=HERO['strip']) + f"""
<section class="s"><div class="wrap"><div class="eyebrow">{E(ETO['h'])}</div><h2>Every unit is designed for its project</h2><p class="mt">{E(ETO['p'])}</p>{cap_table(notes=False)}
<p class="mt"><a class="btn ghost" href="products.html">Capability ranges and the FP-MPT standard line</a></p></div></section>
<section class="s alt"><div class="wrap"><div class="eyebrow">Applications</div><h2>What your site does to the transformer, and what changes in the design because of it</h2><div class="grid4">{apps}</div></div></section>
<section class="s dark"><div class="wrap"><div class="cols"><div><div class="eyebrow">{E(BASE['h'])}</div><h2>{E(BASE['model_h'])}</h2><p class="mt">{E(BASE['model'])}</p><p><a class="btn ghost onDark" href="manufacturing.html">The manufacturing base</a></p></div>
<div>{tiles(BASE['facts'], mt=False)}</div></div></div></section>
<section class="s"><div class="wrap"><div class="cols"><div><div class="eyebrow">Quality</div><h2>{E(QUALITY['h'])}</h2><p class="mt">{E(QUALITY['blocks'][2][1])}</p><p><a href="quality.html">Test program, inspection points, and documentation →</a></p></div>
<div><div class="eyebrow">Delivery &amp; warranty</div><h2>{E(DELIVERY['warranty_h'])}</h2><p class="mt">{E(DELIVERY['warranty'])}</p><p><a href="delivery.html">Lead time, stages, and service →</a></p></div></div></div></section>
"""
(OUT/"index.html").write_text(page("Farpoint Energy — Power transformers, engineered to your specification", home, "index.html", "Power transformers to 250 MVA and 230 kV for utility, renewable, storage, data center, and industrial projects. IEEE C57 design and test, three-year warranty, 100 units per year."))

# ---------- PRODUCTS
s = STANDARD
lineup = "".join(f'<tr><td class="sku" data-label="Configuration">{E(a)}</td><td class="v" data-label="Rating">{E(b)}</td><td class="v" data-label="High side">{E(c)}</td><td class="v" data-label="Low side">{E(d)}</td></tr>' for a,b,c,d in s['lineup'])
products = hero("Products", "Power transformers to 250 MVA and 230 kV", "Main power, generator step-up, substation, auto, and special-duty transformers, engineered to your specification. A pre-engineered standard line for solar and storage interconnections.") + f"""
<section class="s"><div class="wrap"><div class="eyebrow">{E(ETO['h'])}</div><h2>Capability ranges</h2><p class="mt">{E(ETO['p'])}</p>{cap_table()}</div></section>
<section class="s alt"><div class="wrap"><div class="eyebrow">Standard line</div><h2>{E(s['h'])}</h2><p class="mt">{E(s['p'])}</p>
<div class="tbl"><table class="stack"><thead><tr><th>Configuration</th><th>Rating</th><th>High side</th><th>Low side</th></tr></thead><tbody>{lineup}</tbody></table></div>
<p class="small muted" style="margin-top:12px">{E(s['common'])}</p><p class="small">{E(s['options'])}</p>
<div class="panel">{E(s['catalog_note'])} <a href="quote.html">Request it with your quotation.</a></div></div></section>
<section class="s"><div class="wrap"><div class="cols"><div><h2>Already have a specification?</h2><p class="mt">Send it. The quotation answers every clause: comply, comply with clarification, or exception. Your utility's standard specification works the same way.</p></div>
<div><h2>Early in development?</h2><p class="mt">Send the single-line diagram, the MW at the point of interconnection, and the site conditions. We propose the unit and quote it.</p><a class="btn" href="quote.html">Request a quotation</a></div></div></div></section>"""
(OUT/"products.html").write_text(page("Products — Farpoint Energy", products, "products.html", "Main power, generator step-up, substation, auto, and special-duty transformers to 250 MVA and 230 kV, and the FP-MPT standard line for 50 and 100 MW solar and storage blocks."))

# ---------- APPLICATIONS
asec = "".join(f"""
<section class="s{' alt' if i%2 else ''}" id="{m['id']}"><div class="wrap"><div class="cols"><div><div class="eyebrow">Applications</div><h2>{E(m['name'])}</h2><p class="mt" style="font-family:var(--f-display);font-size:19px">{E(m['lead'])}</p></div>
<div><p>{E(m['body'])}</p></div></div></div></section>""" for i,m in enumerate(APPLICATIONS))
applications = hero("Applications", "Every project loads a transformer differently", "What your site does to the unit, and what changes in the design because of it.") + asec + f"""
<section class="s dark"><div class="wrap"><h2>Your application is not listed?</h2><p class="mt">Special-duty units, ester-filled designs, furnace and rectifier duty, and replacements to an existing nameplate are engineered per project.</p><a class="btn" href="quote.html">Request a quotation</a></div></section>"""
(OUT/"applications.html").write_text(page("Applications — Farpoint Energy", applications, "applications.html", "Power transformers for utilities, utility-scale solar, battery storage, hybrid sites, data centers, industrial plants, wind, and fleet replacement."))

# ---------- MANUFACTURING BASE
b = BASE
manufacturing = hero("Manufacturing base", b['h'], b['intro']) + f"""
<section class="s"><div class="wrap">{tiles(b['facts'], mt=False)}<div class="cols" style="margin-top:36px"><div><h2>Plants and laboratories</h2>{checks(b['lines'])}</div>
<div><h2>{E(b['model_h'])}</h2><p class="mt">{E(b['model'])}</p><p><a href="quality.html">How every unit is inspected and tested →</a></p></div></div></div></section>
<section class="s alt"><div class="wrap"><h2>Visit the plant building your unit</h2><p class="mt">Buyers and owner's engineers are welcome at the plant for the pre-production audit, at any inspection hold point, and for the witnessed factory acceptance test. Farpoint arranges the visit and hosts it.</p><a class="btn" href="quote.html">Request a quotation</a></div></section>"""
(OUT/"manufacturing.html").write_text(page("Manufacturing base — Farpoint Energy", manufacturing, "manufacturing.html", "Farpoint units are built across a qualified base of established power-transformer plants with ISO/IEC 17025 laboratories, 100+ GVA combined capacity, and units in service in 25+ countries."))

# ---------- QUALITY
q = QUALITY
blocks = "".join(f'<div><h3>{E(a)}</h3><p class="mt">{E(bb)}</p></div>' for a,bb in q['blocks'])
tests = "".join(f'<tr class="sec"><td colspan="2">{E(sec)}</td></tr>' + "".join(f'<tr><td class="k" style="color:var(--ink)">{E(k)}</td><td>{E(v)}</td></tr>' for k,v in items) for sec,items in q['tests'])
quality = hero("Quality", q['h']) + f"""
<section class="s"><div class="wrap"><div class="grid4" style="gap:32px;margin-top:0">{blocks}</div></div></section>
<section class="s alt"><div class="wrap"><div class="eyebrow">For your engineering team</div><h2>Test program, inspection points, standards, and interfaces</h2>
<details style="margin-top:20px"><summary>Factory test program — IEEE C57.12.90</summary><div class="tbl"><table><thead><tr><th>Test</th><th>Scope</th></tr></thead><tbody>{tests}</tbody></table></div></details>
<details><summary>Inspection and test plan</summary><p class="small">Issued for your sign-off before production. Each point is marked hold (production stops until released), witness, or review.</p>{checks(q['itp'])}</details>
<details><summary>Site program</summary>{checks(q['site'])}</details>
<details><summary>Standards</summary><p class="mono small mt">{E(q['standards'])}</p><p class="small">Built to IEC 60076 or regional specifications when the project requires it.</p></details>
<details><summary>Interfaces and submittals</summary><p class="mt">{E(q['interfaces'])}</p></details>
</div></section>
<section class="s"><div class="wrap"><h2>Bring your inspector</h2><p class="mt">Your engineer or third-party inspector is welcome at any hold point and at the factory acceptance test. We schedule it with you at order.</p><a class="btn" href="quote.html">Request a quotation</a></div></section>"""
(OUT/"quality.html").write_text(page("Quality — Farpoint Energy", quality, "quality.html", "Engineering review, stage-gated inspection, the full IEEE C57.12.90 factory test program in ISO/IEC 17025 laboratories, and a serialized documentation dossier on every Farpoint transformer."))

# ---------- DELIVERY
d = DELIVERY
stages = "".join(f'<tr><td class="v">{E(a)}</td><td>{E(bb)}</td></tr>' for a,bb in d['stages'])
delivery = hero("Delivery & warranty", "From order to energization", d['intro']) + f"""
<section class="s"><div class="wrap"><div class="cols"><div><h2>Stages</h2><div class="tbl"><table><thead><tr><th>Stage</th><th>What happens</th></tr></thead><tbody>{stages}</tbody></table></div></div>
<div><div class="eyebrow">Warranty</div><h2>{E(d['warranty_h'])}</h2><p class="mt">{E(d['warranty'])}</p><div class="eyebrow" style="margin-top:28px">Service</div>{checks(d['service'])}<a class="btn" href="quote.html">Request a quotation</a></div></div></div></section>"""
(OUT/"delivery.html").write_text(page("Delivery & warranty — Farpoint Energy", delivery, "delivery.html", "100 units per year capacity, committed delivery dates, monthly order status reports, and a three-year warranty from energization with field service from Farpoint."))

# ---------- QUOTE (FormSubmit)
qq = QUOTE
app_opts = "".join(f'<option>{E(m["name"])}</option>' for m in APPLICATIONS) + '<option>Other</option>'
form = f"""<div class="formbox"><form class="q" action="{SITE['form_action']}" method="POST">
<input type="hidden" name="_subject" value="Quotation request — farpointenergy.com"><input type="hidden" name="_template" value="table"><input type="hidden" name="_next" value="{SITE['domain']}/thanks.html"><input type="hidden" name="_captcha" value="false"><input type="text" name="_honey" style="display:none" tabindex="-1" autocomplete="off">
<div><label for="f-name">Name</label><input id="f-name" name="Name" required autocomplete="name"></div>
<div><label for="f-company">Company</label><input id="f-company" name="Company" required autocomplete="organization"></div>
<div><label for="f-email">Email</label><input id="f-email" name="Email" type="email" required autocomplete="email"></div>
<div><label for="f-phone">Phone</label><input id="f-phone" name="Phone" type="tel" autocomplete="tel"></div>
<div><label for="f-app">Application</label><select id="f-app" name="Application">{app_opts}</select></div>
<div><label for="f-mw">MW at the point of interconnection</label><input id="f-mw" name="MW at POI" inputmode="decimal" placeholder="e.g. 90"></div>
<div><label for="f-hv">High-side voltage (kV)</label><input id="f-hv" name="HV kV" inputmode="decimal" placeholder="e.g. 138"></div>
<div><label for="f-lv">Low-side voltage (kV)</label><input id="f-lv" name="LV kV" inputmode="decimal" placeholder="e.g. 34.5"></div>
<div class="full"><label for="f-date">Target energization</label><input id="f-date" name="Target energization" placeholder="e.g. Q4 2028"></div>
<div class="full"><label for="f-msg">Project details</label><textarea id="f-msg" name="Message" placeholder="Site, utility, specification status, quantity, anything else that helps us quote."></textarea></div>
<div class="full"><button class="btn" type="submit">Send request</button><p class="small muted" style="margin:10px 0 0">Attach the single-line and specification by replying to the confirmation email, or send them to <a href="mailto:{SITE['email']}">{SITE['email']}</a>.</p></div>
</form></div>"""
quote = hero("Request a quotation", qq['h'], qq['sub']) + f"""
<section class="s"><div class="wrap"><div class="cols" style="grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr))"><div>{form}</div>
<div><h2>Three ways to start</h2>{steps(qq['ways'])}<h3 style="margin-top:28px">What to send</h3>{checks(qq['send'])}<div class="panel">{E(qq['back'])}</div>
<p class="small">Prefer email or a call? <a href="mailto:{SITE['email']}?subject=Quotation%20request">{SITE['email']}</a> · <a href="tel:{SITE['phone_raw']}">{SITE['phone']}</a></p></div></div></div></section>"""
(OUT/"quote.html").write_text(page("Request a quotation — Farpoint Energy", quote, "quote.html", "Pick a configuration, send your specification, or send a single-line diagram and site data. Farpoint returns a quotation, a compliance matrix, and a committed delivery date."))
(OUT/"thanks.html").write_text(page("Request received — Farpoint Energy", hero("Request a quotation", "Request received", "Thank you. Farpoint engineering reviews every request; you will hear from us by email. Send drawings and specifications to " + SITE['email'] + ".") + '<section class="s"><div class="wrap"><p><a href="index.html">Back to the home page</a></p></div></section>', "quote.html", "Quotation request received."))

# ---------- ABOUT
a = ABOUT
about = hero("About", a['h'], a['intro']) + f"""
<section class="s"><div class="wrap"><div class="cols"><div><div class="eyebrow">Founder</div><h2>{E(a['founder_name'])}</h2><p class="muted">{E(a['founder_title'])}</p><p>{E(a['founder'])}</p><p>{E(a['advisors'])}</p></div>
<div><div class="eyebrow">Contact</div><h2>New York</h2><p class="mt"><a href="mailto:{SITE['founder_email']}">{SITE['founder_email']}</a><br><a href="mailto:{SITE['email']}">{SITE['email']}</a><br><a href="tel:{SITE['phone_raw']}">{SITE['phone']}</a></p><a class="btn" href="quote.html">Request a quotation</a></div></div></div></section>"""
(OUT/"about.html").write_text(page("About — Farpoint Energy", about, "about.html", "Farpoint Energy builds power transformers for the US grid, based in New York."))

# ---------- 404, redirects, sitemap, css
(OUT/"404.html").write_text(page("Page not found — Farpoint Energy", '<section class="s"><div class="wrap"><h1>Page not found</h1><p class="mt"><a href="index.html">Back to the home page</a></p></div></section>', "", "Page not found"))
for old, new in [("markets.html", "applications.html"), ("contact.html", "quote.html")]:
    (OUT/old).write_text(f'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Farpoint Energy</title><meta http-equiv="refresh" content="0; url={new}"><link rel="canonical" href="{SITE["domain"]}/{new}"></head><body><a href="{new}">Continue</a></body></html>')
pages = ["index","products","applications","manufacturing","quality","delivery","quote","about"]
(OUT/"sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "".join(f'  <url><loc>{SITE["domain"]}/{p}.html</loc></url>\n' for p in pages) + '</urlset>\n')
(OUT/"style.css").write_text(CSS.strip()+"\n")
(OUT/"README.md").write_text("# farpointenergy.com\n\nStatic site. Edit `content.py`, run `python3 build.py`, commit the generated HTML. Hosted on GitHub Pages.\n")
print("built", ", ".join(p+".html" for p in pages))
