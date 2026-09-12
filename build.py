import pathlib
OUT=pathlib.Path(".")
EMAIL="karan@farpointenergy.com"; PHONE="+1 (217) 417-9345"; PHONE_RAW="+12174179345"
FORM_URL=None  # Google Form link to be inserted

MARK='<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="1" y="1" width="38" height="38" fill="none" stroke="#C4732C" stroke-width="3"/><line x1="7" y1="28" x2="33" y2="28" stroke="currentColor" stroke-width="3"/><circle cx="29" cy="13" r="4" fill="#C4732C"/></svg>'

CSS = """
:root{--ink:#0E1B2B;--ink2:#16263A;--copper:#C4732C;--copper-dk:#9E5A1F;--steel:#EEF1F4;--slate:#5A6675;--line:#CBD3DB;--paper:#FFFFFF;--tint:#F7F8FA;--text:#0E1B2B}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--text);font-family:"Source Sans 3",system-ui,Arial,sans-serif;font-size:17px;line-height:1.55}
a{color:var(--copper-dk)}img,svg{max-width:100%}
h1,h2,h3,h4{font-family:"Archivo",system-ui,Arial,sans-serif;letter-spacing:-0.01em;line-height:1.12;margin:0;text-wrap:balance}
h1{font-size:clamp(34px,5vw,56px);font-weight:700}h2{font-size:clamp(26px,3.2vw,36px);font-weight:700}h3{font-size:20px;font-weight:600}h4{font-size:16px;font-weight:600}
p{margin:0 0 14px;max-width:66ch}
.eyebrow{font-family:"IBM Plex Mono",ui-monospace,monospace;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--copper);margin-bottom:10px}
.mono{font-family:"IBM Plex Mono",ui-monospace,monospace}
.wrap{max-width:1120px;margin:0 auto;padding-inline:clamp(16px,4vw,40px)}
/* nav */
.nav{background:var(--ink);color:#fff;position:sticky;top:0;z-index:10}
.nav .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;padding-block:14px}
.brand{display:flex;align-items:center;gap:10px;color:#fff;text-decoration:none;font-family:"Archivo";font-weight:700;letter-spacing:.16em;font-size:14px}
.brand .mark{width:22px;height:22px;color:#fff}
.brand span{font-weight:400;color:#B9C3CE;letter-spacing:.2em}
.nav ul{list-style:none;margin:0;padding:0;display:flex;gap:22px;flex-wrap:wrap}
.nav a.l{color:#DCE2E8;text-decoration:none;font-size:15px}.nav a.l:hover,.nav a.l[aria-current]{color:#fff;border-bottom:2px solid var(--copper)}
.btn{display:inline-block;background:var(--copper);color:#fff;text-decoration:none;font-family:"Archivo";font-weight:600;padding:12px 20px;border-radius:2px;font-size:15px}
.btn:hover{background:var(--copper-dk)}.btn.ghost{background:transparent;border:1.5px solid var(--copper);color:var(--copper)}
.btn.ghost.onDark{color:#fff;border-color:#fff}
/* hero */
.hero{background:var(--ink);color:#fff;padding-block:clamp(56px,9vw,120px)}
.hero h1{color:#fff;max-width:14ch}.hero .sub{font-family:"Archivo";font-weight:400;font-size:clamp(17px,2vw,22px);color:#B9C3CE;max-width:52ch;margin-top:18px}
.hero .cta{display:flex;gap:14px;flex-wrap:wrap;margin-top:28px}
.strip{border-top:1px solid var(--copper);margin-top:48px;padding-top:16px;display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;font-family:"IBM Plex Mono";font-size:13px;letter-spacing:.06em;color:#DCE2E8}
/* sections */
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
td.k{color:var(--slate);width:32%}td.v{font-family:"IBM Plex Mono";font-size:14px}
tr.sec td{background:var(--tint);font-family:"Archivo";font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase}
.sku{font-family:"IBM Plex Mono";font-weight:500}
ul.check{list-style:none;padding:0;margin:12px 0}ul.check li{position:relative;padding-left:18px;margin:8px 0}
ul.check li::before{content:"";position:absolute;left:0;top:10px;width:7px;height:7px;background:var(--copper)}
.card{border:1px solid var(--line);padding:20px 22px;background:#fff}
.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:20px}
footer{background:var(--ink);color:#B9C3CE;padding-block:40px;font-size:14px}
footer .wrap{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap}
footer a{color:#fff}
.formwrap{border:1px solid var(--line);background:#fff;padding:8px;min-height:400px}
.formwrap iframe{width:100%;height:1100px;border:0}
@media (max-width:760px){.nav .wrap{flex-wrap:wrap}.nav ul{width:100%;gap:14px;align-items:center}.nav .btn{padding:9px 14px;font-size:14px}.steps li{grid-template-columns:32px 1fr}}
"""

def page(title, body, current, desc):
    items=[("Products","products.html"),("Delivery & quality","delivery.html"),("About","about.html"),("Contact","contact.html")]
    nav = "".join('<li><a class="l" href="%s"%s>%s</a></li>' % (h, ' aria-current="page"' if h==current else '', t) for t,h in items)
    return f"""<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><meta name="description" content="{desc}">
<link rel="icon" href="favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<link rel="stylesheet" href="style.css">
</head><body>
<nav class="nav"><div class="wrap"><a class="brand" href="index.html">{MARK}FARPOINT&nbsp;<span>ENERGY</span></a><ul>{nav}<li><a class="btn" href="contact.html">Request a quote</a></li></ul></div></nav>
{body}
<footer><div class="wrap"><div><div class="brand" style="margin-bottom:10px">{MARK}FARPOINT&nbsp;<span>ENERGY</span></div>Main power transformers for solar and storage projects.<br>New York, NY · United States</div>
<div><a href="mailto:{EMAIL}">{EMAIL}</a><br><a href="tel:{PHONE_RAW}">{PHONE}</a><br><a href="Farpoint_Energy_Product_Catalog_2026.pdf">Download the catalog (PDF)</a></div>
<div class="mono" style="font-size:12px;align-self:flex-end">© 2026 Farpoint Energy · FP-MPT-50 · FP-MPT-100 · IEEE C57.12.00 / C57.12.90</div></div></footer>
</body></html>"""

INDEX = f"""
<header class="hero"><div class="wrap">
<div class="eyebrow">Main power transformers · 30–100 MVA · 115 / 138 kV</div>
<h1>Built to spec. Delivered on a date.</h1>
<div class="sub">Standard-configuration main power transformers for solar and storage projects — engineered to IEEE C57, factory-tested with independent witness, delivered to your site in 12–14 months with the month in writing.</div>
<div class="cta"><a class="btn" href="contact.html">Request a quote</a><a class="btn ghost onDark" href="products.html">See configurations</a></div>
<div class="strip"><span>30 / 40 / 50 MVA · 60 / 80 / 100 MVA</span><span>115 kV · 138 kV · 34.5 kV</span><span>12–14 MONTH DELIVERY</span></div>
</div></header>
<section class="s"><div class="wrap"><div class="cols">
<div><div class="eyebrow">Who we are</div><h2>The supplier of record</h2>
<p style="margin-top:14px">Farpoint Energy supplies main power transformers to developers who cannot wait three years for a substation to be energized. We design to a small set of standard configurations, build them at Farpoint-qualified partner facilities under our own quality program, and stand behind every unit: our contract, our factory acceptance test, our warranty, our service response.</p>
<p>Fixed configurations are the reason we can commit to a delivery month. A repeat design means drawings exist on day one, long-lead materials are reserved before your order is signed, and the factory has built the unit before. Custom is what the 2–4 year market sells. Standard is how we deliver in 12–14 months.</p></div>
<div><div class="tiles" style="grid-template-columns:1fr 1fr;margin-top:0">
<div class="tile"><div class="v">12–14</div><div class="l">months to site</div></div>
<div class="tile"><div class="v">30–100</div><div class="l">MVA, three-stage cooling</div></div>
<div class="tile"><div class="v">115 / 138</div><div class="l">kV high side</div></div>
<div class="tile"><div class="v">C57</div><div class="l">IEEE design &amp; test</div></div></div>
<div class="panel"><b>Supplier of record.</b> The purchase contract, the letter of credit to the factory, the factory acceptance test, importer-of-record duties, and the warranty all sit with Farpoint Energy, a US company. You buy a transformer from us; how we build it is our responsibility.</div></div>
</div></div></section>
<section class="s alt"><div class="wrap"><div class="eyebrow">Configurations</div><h2>Four standard units cover most projects from 50 to 200 MW</h2>
<div class="tbl"><table><thead><tr><th>Configuration</th><th>Rating (MVA)</th><th>High side</th><th>Low side</th><th>Typical project fit</th></tr></thead><tbody>
<tr><td class="sku">FP-MPT-138-50</td><td class="v">30 / 40 / 50</td><td class="v">138 kV · 650 kV BIL</td><td class="v">34.5 kV</td><td>50–60 MW block, one unit</td></tr>
<tr><td class="sku">FP-MPT-115-50</td><td class="v">30 / 40 / 50</td><td class="v">115 kV · 550 kV BIL</td><td class="v">34.5 kV</td><td>50–60 MW block, one unit</td></tr>
<tr><td class="sku">FP-MPT-138-100</td><td class="v">60 / 80 / 100</td><td class="v">138 kV · 650 kV BIL</td><td class="v">34.5 kV</td><td>80–110 MW block, one unit</td></tr>
<tr><td class="sku">FP-MPT-115-100</td><td class="v">60 / 80 / 100</td><td class="v">115 kV · 550 kV BIL</td><td class="v">34.5 kV</td><td>80–110 MW block, one unit</td></tr>
</tbody></table></div>
<p style="margin-top:16px">Two-unit configurations for 120–200 MW and a 161 kV variant are quoted on request. <a href="products.html">Full datasheets and options →</a></p></div></section>
<section class="s"><div class="wrap"><div class="eyebrow">How Farpoint delivers</div><h2>From single-line diagram to energization</h2>
<ol class="steps">
<li><div><b>Configuration match</b>Send your single-line diagram and site data. We confirm the standard configuration that fits and any project-specific values within the design window.</div></li>
<li><div><b>Firm quote, committed month</b>Price, delivery month, and terms — binding — within ten business days.</div></li>
<li><div><b>Drawings for approval</b>Outline, nameplate, and test plan issued to your engineer and interconnecting utility. The approval cycle is built into the schedule.</div></li>
<li><div><b>Build and witnessed test</b>Production in a reserved slot. Full routine suite to IEEE C57.12.90, witnessed by an independent inspection agency. You are welcome at FAT.</div></li>
<li><div><b>Delivery and energization</b>Export packing with impact recorders, ocean and inland transport, DAP to your site. Commissioning supervision at energization. US-based service response under warranty.</div></li>
</ol>
<div style="margin-top:28px;display:flex;gap:14px;flex-wrap:wrap"><a class="btn" href="contact.html">Request a quote</a><a class="btn ghost" href="Farpoint_Energy_Product_Catalog_2026.pdf">Download the catalog (PDF)</a></div>
</div></section>
"""

def ds(code, title, r, imp):
    return f"""
<h3 style="margin-top:36px"><span class="mono" style="color:var(--copper);font-size:14px;letter-spacing:.08em">{code}</span><br>{title}</h3>
<div class="tbl"><table><thead><tr><th style="width:32%">Parameter</th><th>138 kV variant</th><th>115 kV variant</th></tr></thead><tbody>
<tr class="sec"><td colspan="3">Ratings</td></tr>
<tr><td class="k">Rated power</td><td class="v">{r} MVA (ONAN / ONAF / ONAF)</td><td class="v">{r} MVA (ONAN / ONAF / ONAF)</td></tr>
<tr><td class="k">Frequency</td><td class="v">60 Hz</td><td class="v">60 Hz</td></tr>
<tr><td class="k">Temperature rise</td><td class="v">65 °C average winding, 80 °C hottest spot</td><td class="v">65 °C average winding, 80 °C hottest spot</td></tr>
<tr><td class="k">Phases / vector group</td><td class="v">3-phase, YNd1 (typical; per project)</td><td class="v">3-phase, YNd1 (typical; per project)</td></tr>
<tr class="sec"><td colspan="3">Voltage &amp; insulation</td></tr>
<tr><td class="k">High-voltage winding</td><td class="v">138 kV, grounded wye — 145 kV class</td><td class="v">115 kV, grounded wye — 123 kV class</td></tr>
<tr><td class="k">HV basic impulse level</td><td class="v">650 kV (550 kV with surge arresters, per study)</td><td class="v">550 kV (450 kV with surge arresters, per study)</td></tr>
<tr><td class="k">Low-voltage winding</td><td class="v">34.5 kV, delta (wye available per single-line)</td><td class="v">34.5 kV, delta (wye available per single-line)</td></tr>
<tr><td class="k">LV basic impulse level</td><td class="v">200 kV</td><td class="v">200 kV</td></tr>
<tr><td class="k">Impedance</td><td class="v">{imp}</td><td class="v">{imp}</td></tr>
<tr><td class="k">Taps</td><td class="v">DETC on HV, ±2 × 2.5 %, no-load · LTC optional</td><td class="v">DETC on HV, ±2 × 2.5 %, no-load · LTC optional</td></tr>
<tr class="sec"><td colspan="3">Construction</td></tr>
<tr><td class="k">Core / windings</td><td class="v">Grain-oriented electrical steel core; copper windings</td><td class="v">Grain-oriented electrical steel core; copper windings</td></tr>
<tr><td class="k">Insulating fluid</td><td class="v">Mineral oil (natural-ester FR3-class optional)</td><td class="v">Mineral oil (natural-ester FR3-class optional)</td></tr>
<tr><td class="k">Oil preservation</td><td class="v">Sealed tank with nitrogen blanket, or conservator</td><td class="v">Sealed tank with nitrogen blanket, or conservator</td></tr>
<tr><td class="k">Cooling</td><td class="v">Detachable radiators, two fan banks, fan control by winding temperature</td><td class="v">Detachable radiators, two fan banks, fan control by winding temperature</td></tr>
<tr class="sec"><td colspan="3">Standards &amp; site</td></tr>
<tr><td class="k">Design and test</td><td class="v" colspan="2">ANSI/IEEE C57.12.00 (general), C57.12.90 (test code), C57.91 (loading guide), NEMA TR-1 (sound)</td></tr>
<tr><td class="k">Site basis</td><td class="v" colspan="2">Outdoor, altitude ≤ 1,000 m, 30 °C average / 40 °C maximum ambient; seismic per site</td></tr>
</tbody></table></div>
<p style="margin-top:10px;font-size:14px;color:var(--slate)">Sound level per NEMA TR-1 · ANSI 70 light gray finish · outline drawings and weights issued with the quotation.</p>"""

PRODUCTS = f"""
<section class="s"><div class="wrap"><div class="eyebrow">Products</div><h2>Standard configurations</h2>
<p style="margin-top:14px">Every unit: 60 Hz · ONAN/ONAF/ONAF three-stage cooling · 65 °C average winding rise · 34.5 kV delta low side (wye per project) · DETC ±2 × 2.5 % on the high side · mineral oil · designed and tested to ANSI/IEEE C57.12.00 and C57.12.90.</p>
<div class="tbl"><table><thead><tr><th>Configuration</th><th>Rating (MVA)</th><th>High side</th><th>Low side</th><th>Typical project fit</th></tr></thead><tbody>
<tr><td class="sku">FP-MPT-138-50</td><td class="v">30 / 40 / 50</td><td class="v">138 kV · 650 kV BIL</td><td class="v">34.5 kV · 200 kV BIL</td><td>50–60 MW block, one unit</td></tr>
<tr><td class="sku">FP-MPT-115-50</td><td class="v">30 / 40 / 50</td><td class="v">115 kV · 550 kV BIL</td><td class="v">34.5 kV · 200 kV BIL</td><td>50–60 MW block, one unit</td></tr>
<tr><td class="sku">FP-MPT-138-100</td><td class="v">60 / 80 / 100</td><td class="v">138 kV · 650 kV BIL</td><td class="v">34.5 kV · 200 kV BIL</td><td>80–110 MW block, one unit</td></tr>
<tr><td class="sku">FP-MPT-115-100</td><td class="v">60 / 80 / 100</td><td class="v">115 kV · 550 kV BIL</td><td class="v">34.5 kV · 200 kV BIL</td><td>80–110 MW block, one unit</td></tr>
<tr><td class="sku">Two-unit configurations</td><td class="v">2 × 50 or 2 × 100 class</td><td class="v">115 / 138 kV</td><td class="v">34.5 kV</td><td>120–200 MW; phased energization and N-1 redundancy</td></tr>
<tr><td class="sku">161 kV variant</td><td class="v">per project</td><td class="v">161 kV</td><td class="v">34.5 kV</td><td>Quoted on request — different insulation class</td></tr>
</tbody></table></div>
<div class="cols" style="margin-top:36px">
<div><h3>Sizing guide</h3><p style="margin-top:10px">Total transformer MVA ≈ project MW ÷ 0.95, one unit per 100–150 MW block. A 55 MW project at 138 kV is one FP-MPT-138-50. A 95 MW project is one FP-MPT-138-100. A 160 MW project is two units, which also lets you energize the first block while the second is still under construction.</p></div>
<div><h3>Why a rating reads 30 / 40 / 50</h3><p style="margin-top:10px">One transformer, three cooling stages: 30 MVA with oil and air circulating naturally (ONAN), 40 MVA with the first bank of fans (ONAF), 50 MVA with the second bank. Same core, same windings. You run quiet at base load and let the fans carry the afternoon peak — the staged rating is matched to a solar generation profile, and it is the standard IEEE way to rate a unit of this class.</p></div>
</div>
<div class="eyebrow" style="margin-top:48px">Datasheets</div><h2>Specifications</h2>
{ds("FP-MPT-138-50 · FP-MPT-115-50","30 / 40 / 50 MVA main power transformer","30 / 40 / 50","8.5 % at 50 MVA base (7.5–9 % window, per project)")}
{ds("FP-MPT-138-100 · FP-MPT-115-100","60 / 80 / 100 MVA main power transformer","60 / 80 / 100","Per project; confirmed at quotation")}
<div class="eyebrow" style="margin-top:48px">Options</div><h2>Configure within the standard</h2>
<p style="margin-top:14px">Options are pre-engineered so they do not reopen the design. Each is quoted as a line item with its effect on delivery stated plainly.</p>
<div class="tbl"><table><thead><tr><th style="width:26%">Option</th><th>What it is</th><th style="width:28%">When you'd specify it</th></tr></thead><tbody>
<tr><td class="sku">On-load tap changer</td><td>LTC in place of DETC, ±16 steps typical; current component lead time stated in the quote</td><td>Utility requires voltage regulation under load</td></tr>
<tr><td class="sku">Natural-ester fluid</td><td>FR3-class biodegradable, high fire-point fluid in place of mineral oil</td><td>Fire-safety setbacks, environmental permits</td></tr>
<tr><td class="sku">Reduced BIL</td><td>550 kV (138 kV) or 450 kV (115 kV) with surge arresters</td><td>Where your insulation coordination study supports it</td></tr>
<tr><td class="sku">Harmonic-duty review</td><td>Design check against your inverter and storage duty cycle; derating or design adjustment if required</td><td>Storage-heavy sites; high inverter harmonic content</td></tr>
<tr><td class="sku">Monitoring package</td><td>Online dissolved-gas analysis, bushing monitoring, digital temperature and cooling control with SCADA points</td><td>Owners running condition-based maintenance</td></tr>
<tr><td class="sku">Spare-unit program</td><td>A reserved production slot or a stocked spare held against your operating fleet</td><td>Fleets that cannot tolerate a multi-year replacement wait</td></tr>
<tr><td class="sku">Extended warranty</td><td>Beyond the standard term, with defined service response</td><td>Lender or owner requirements</td></tr>
</tbody></table></div>
<h3 style="margin-top:32px">Standard accessories (all configurations)</h3>
<p style="margin-top:10px">ANSI outdoor porcelain bushings · multi-ratio bushing current transformers (relay classes per project) · sudden-pressure relay · top-oil and winding temperature indicators with alarm/trip contacts · liquid-level gauge · pressure-relief device · dissolved-gas monitoring provision · drain and sampling valves · jacking pads and skid base with provision for rail or trailer transport · grounding pads · nameplate per C57.12.00.</p>
<div style="margin-top:28px;display:flex;gap:14px;flex-wrap:wrap"><a class="btn" href="contact.html">Request a quote</a><a class="btn ghost" href="Farpoint_Energy_Product_Catalog_2026.pdf">Download the catalog (PDF)</a></div>
</div></section>"""

DELIVERY = f"""
<section class="s"><div class="wrap"><div class="eyebrow">Delivery</div><h2>12–14 months, with the month in writing</h2>
<div class="cols" style="margin-top:20px">
<div><p>The delivery month is in the quotation and in the purchase order. It covers the approval cycle, production, testing, ocean transport, and inland delivery to your site.</p>
<div class="tbl"><table style="min-width:0"><thead><tr><th>Stage</th><th>What happens</th></tr></thead><tbody>
<tr><td class="v">Order</td><td>Purchase order and deposit; production slot confirmed</td></tr>
<tr><td class="v">Weeks 1–8</td><td>Drawings for approval; long-lead materials committed</td></tr>
<tr><td class="v">Production</td><td>Core, windings, assembly, vacuum drying, oil processing</td></tr>
<tr><td class="v">FAT</td><td>Full routine suite, witnessed; test report issued</td></tr>
<tr><td class="v">Transit</td><td>Export packing with impact recorders; ocean and inland freight; Farpoint is importer of record</td></tr>
<tr><td class="v">Site</td><td>DAP delivery; commissioning supervision at energization</td></tr></tbody></table></div></div>
<div><h3>What's included with every unit</h3><ul class="check">
<li>Complete drawing package for utility and owner's-engineer review</li><li>Witnessed factory acceptance test per IEEE C57.12.90</li><li>Temperature-rise test on the first unit of a configuration</li><li>Export packing, ocean and inland transport, customs — DAP your site</li><li>Commissioning supervision at energization</li><li>Warranty: 18 months from energization or 24 months from shipment</li><li>US-based field service response under warranty</li><li>Escalation-indexed pricing on published indices — the same structure utility RFPs use</li></ul>
<div class="panel"><b>Warranty and service.</b> Warranty claims are handled by Farpoint, not passed to a factory abroad. Field response — oil handling, testing, diagnostics, minor repair — is provided by our US service partner; major repair or replacement is backed by the manufacturing partner under our contract.</div></div>
</div></div></section>
<section class="s alt"><div class="wrap"><div class="eyebrow">Quality</div><h2>Every unit is proven, not assumed</h2>
<div class="cols" style="margin-top:20px">
<div><h4>Where it is built</h4><p>Farpoint-qualified manufacturing partners operating ISO 9001 quality systems with accredited high-voltage test laboratories. Each partner is qualified against our design standard, process audit, and in-process hold points before it builds a Farpoint unit.</p>
<h4>Design authority</h4><p>Drawings are issued and controlled by Farpoint. Your engineer and interconnecting utility review outline drawings, nameplate, and the test plan before manufacturing releases.</p>
<h4>Independent inspection</h4><p>An independent inspection agency (SGS or Bureau Veritas class) witnesses in-process hold points, the factory acceptance test, and pre-shipment packing on every unit. Customers and owner's engineers are welcome at FAT.</p></div>
<div><h4>Factory acceptance tests — IEEE C57.12.90</h4><ul class="check">
<li>Winding resistance · ratio, polarity and phase relation</li><li>No-load losses and excitation current</li><li>Load losses and impedance at rated current</li><li>Applied-voltage and induced-voltage tests, with partial-discharge measurement</li><li>Lightning impulse test, full and chopped wave</li><li>Insulation power factor · core ground · leak test</li><li>Oil dielectric strength, moisture, and dissolved-gas baseline</li><li>Temperature-rise test on the first unit of each configuration</li><li>Sound level, when specified</li></ul>
<p style="font-size:14px;color:var(--slate)">Test reports, oil certificates, and the inspection agency's release are delivered with the unit and archived with its serial number.</p></div>
</div></div></section>"""

ABOUT = f"""
<section class="s"><div class="wrap"><div class="eyebrow">About</div><h2>Farpoint Energy</h2>
<div class="cols" style="margin-top:20px">
<div><p>Farpoint Energy is a US transformer company founded in 2026 to supply the equipment the grid is waiting for. We started with the unit that gates the most projects — the main power transformer between a solar or storage site and the transmission system — and with a simple commitment: a standard configuration, a firm price, and a delivery month in writing.</p>
<p>We act as the supplier of record on every order. The contract, the factory acceptance test, the warranty, and the service response are ours. Manufacturing takes place at Farpoint-qualified partner facilities under our design authority and quality program, with independent inspection on every unit.</p>
<p>Transformers are where Farpoint starts. Our purpose is to make abundant power cheaper and faster to deploy than it has ever been — first by shortening the wait for the equipment that connects generation to the grid, and over time by building that equipment in new ways.</p></div>
<div><div class="card"><div class="eyebrow">Leadership</div><h3>Karan Uppal</h3><p style="margin-top:6px;color:var(--slate)">Founder</p><p style="font-size:15px">Karan spent the last several years building and scaling enterprise AI products before founding Farpoint to apply the same discipline — standard platforms, software-driven engineering, measured delivery — to grid equipment.</p><a href="mailto:{EMAIL}">{EMAIL}</a></div></div>
</div></div></section>"""

FORM_BLOCK = (f'<div class="formwrap"><iframe src="{FORM_URL}" title="Request a quote">Loading…</iframe></div>' if FORM_URL else
  f'<div class="card"><h3>Request a quote</h3><p style="margin-top:8px">Email us your single-line diagram, project size, interconnection voltage, and required delivery window. We reply with the configuration that fits and a firm quote within ten business days.</p><a class="btn" href="mailto:{EMAIL}?subject=Quote%20request%20%E2%80%94%20main%20power%20transformer">Email {EMAIL}</a><p style="margin-top:14px;font-size:14px;color:var(--slate)">Online request form coming shortly.</p></div>')

CONTACT = f"""
<section class="s"><div class="wrap"><div class="eyebrow">Contact</div><h2>Request a configuration match or a quote</h2>
<div class="cols" style="margin-top:20px">
<div>{FORM_BLOCK}</div>
<div><div class="grid3" style="grid-template-columns:1fr;margin-top:0">
<div class="card"><div class="eyebrow">Email</div><a href="mailto:{EMAIL}" style="font-size:18px">{EMAIL}</a></div>
<div class="card"><div class="eyebrow">Phone</div><a href="tel:{PHONE_RAW}" style="font-size:18px">{PHONE}</a></div>
<div class="card"><div class="eyebrow">Office</div>New York, NY · United States</div>
<div class="card"><div class="eyebrow">What to send</div><ul class="check" style="margin-bottom:0"><li>Single-line diagram (or a short spec)</li><li>Project MW and interconnection kV</li><li>Site location and required delivery window</li><li>Any utility-imposed requirements</li></ul></div>
</div></div></div></div></section>"""

pages = {
 "index.html": ("Farpoint Energy — Main Power Transformers for Solar & Storage", INDEX, "index.html", "Standard-configuration main power transformers, 30–100 MVA at 115/138 kV, delivered in 12–14 months with the month in writing."),
 "products.html": ("Products — Farpoint Energy", PRODUCTS, "products.html", "FP-MPT-50 and FP-MPT-100 main power transformer configurations, datasheets, and options."),
 "delivery.html": ("Delivery & Quality — Farpoint Energy", DELIVERY, "delivery.html", "How Farpoint delivers in 12–14 months: approval, production, witnessed FAT, DAP delivery, warranty."),
 "about.html": ("About — Farpoint Energy", ABOUT, "about.html", "Farpoint Energy is a US transformer company supplying the equipment the grid is waiting for."),
 "contact.html": ("Contact — Farpoint Energy", CONTACT, "contact.html", "Request a configuration match or a firm quote for a main power transformer."),
}
for fn,(t,b,c,d) in pages.items(): (OUT/fn).write_text(page(t,b,c,d))
(OUT/"style.css").write_text(CSS)
(OUT/"favicon.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#0E1B2B"/><rect x="4" y="4" width="32" height="32" fill="none" stroke="#C4732C" stroke-width="3"/><line x1="9" y1="27" x2="31" y2="27" stroke="#fff" stroke-width="3"/><circle cx="28" cy="14" r="4" fill="#C4732C"/></svg>')
(OUT/"CNAME").write_text("farpointenergy.com\n")
(OUT/"404.html").write_text(page("Not found — Farpoint Energy", '<section class="s"><div class="wrap"><h2>Page not found</h2><p style="margin-top:12px"><a href="index.html">Back to the home page</a></p></div></section>', "", "Page not found."))
(OUT/"robots.txt").write_text("User-agent: *\nAllow: /\nSitemap: https://farpointenergy.com/sitemap.xml\n")
(OUT/"sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+"".join(f"<url><loc>https://farpointenergy.com/{p if p!='index.html' else ''}</loc></url>" for p in pages)+"</urlset>")
(OUT/".nojekyll").write_text("")
print("built", list(pages))
