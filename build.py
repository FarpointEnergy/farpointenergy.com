#!/usr/bin/env python3
"""Build the Farpoint static website: python3 build.py."""
import hashlib
import html as H
import json
import pathlib
from urllib.parse import urlencode
from content import *
from inquiry import render_form, thanks_content

OUT = pathlib.Path(__file__).parent
E = H.escape
MARK = '<svg class="mark" viewBox="0 0 40 40" aria-hidden="true"><rect x="1" y="1" width="38" height="38" fill="none" stroke="#C4732C" stroke-width="3"/><line x1="7" y1="28" x2="33" y2="28" stroke="currentColor" stroke-width="3"/><circle cx="29" cy="13" r="4" fill="#C4732C"/></svg>'
NAV = [("Products", "products.html"), ("Applications", "applications.html"), ("Quality and delivery", "quality.html"), ("About", "about.html")]

CSS = '''
:root{--ink:#0E1B2B;--copper:#C4732C;--copper-dk:#9E5A1F;--steel:#EEF1F4;--slate:#5A6675;--line:#D4DCE3;--tint:#F8F9FA;--paper:#fff;--f-display:Archivo,Arial,sans-serif;--f-body:"Source Sans 3",Arial,sans-serif;--f-mono:"IBM Plex Mono",monospace}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:90px}body{margin:0;background:var(--paper);color:var(--ink);font:18px/1.6 var(--f-body);overflow-wrap:break-word}a{color:var(--copper-dk);text-underline-offset:4px}a:hover{text-decoration-thickness:2px}button,input,select,textarea{font:inherit}button,a,input,select,textarea,summary{-webkit-tap-highlight-color:transparent}:focus-visible{outline:3px solid var(--copper);outline-offset:4px}h1,h2,h3{font-family:var(--f-display);font-weight:600;line-height:1.15;margin:0 0 16px;letter-spacing:-.025em}h1{font-size:clamp(36px,4.7vw,66px);max-width:18ch}h2{font-size:clamp(28px,3vw,40px)}h3{font-size:24px}p{margin:0 0 18px}ul{padding-left:22px}img,svg{max-width:100%}.wrap{width:min(1180px,calc(100% - 80px));margin:auto}.small{font-size:15px}.muted{color:var(--slate)}.mono{font-family:var(--f-mono)}.mt{margin-top:20px}.eyebrow{font:500 12px/1.5 var(--f-mono);text-transform:uppercase;letter-spacing:.13em;color:var(--copper-dk);margin-bottom:16px}.s{padding:72px 0}.s.alt{background:var(--tint)}.s.dark{background:var(--ink);color:#fff}.s.dark .eyebrow{color:#E4A568}.s.dark a{color:#F2BC89}.section-head{display:flex;justify-content:space-between;align-items:flex-end;gap:30px;margin-bottom:28px}.section-head p{max-width:48ch;margin-bottom:0}.cols,.grid2{display:grid;grid-template-columns:1fr 1fr;gap:36px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:24px}.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:24px}.cols>*{min-width:0}.section-intro{max-width:740px;margin-bottom:30px}.skip{position:absolute;top:-80px;left:16px;z-index:20;background:#fff;padding:12px}.skip:focus{top:8px}.nav{background:var(--ink);color:#fff;border-bottom:1px solid #314254}.nav .wrap{min-height:92px;display:flex;align-items:center;justify-content:space-between;gap:28px;flex-wrap:wrap}.brand{display:flex;align-items:center;gap:9px;color:inherit;text-decoration:none;font:600 19px/1 var(--f-display);letter-spacing:.03em;white-space:nowrap}.brand span{font-weight:400}.mark{width:32px;height:32px;flex:none}.nav ul{display:flex;list-style:none;gap:25px;align-items:center;padding:0;margin:0}.nav a.l{display:inline-flex;align-items:center;min-height:44px;color:#E8EDF2;font-size:15px;text-decoration:none}.nav a[aria-current=page]{box-shadow:inset 0 -2px var(--copper)}.navbtn{display:none;border:1px solid #667487;background:none;color:#fff;min-height:44px;padding:8px 14px;cursor:pointer}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:46px;padding:11px 21px;background:var(--copper-dk);border:1px solid var(--copper-dk);color:white;text-decoration:none;font:600 15px/1.4 var(--f-display);cursor:pointer;border-radius:2px}.btn:hover{background:#824819;color:#fff}.btn.ghost{background:transparent;border-color:var(--line);color:var(--ink)}.btn.ghost:hover{background:var(--steel)}.btn.onDark{color:#fff;border-color:#637184}.btn.onDark:hover{background:#22354A}.btn:disabled{opacity:.65;cursor:wait}.cta{display:flex;gap:12px;flex-wrap:wrap;margin:28px 0 18px}.hero{padding:58px 0 64px;background:var(--ink);color:#fff}.hero .eyebrow{color:#E4A568}.hero .sub{font-size:21px;line-height:1.5;color:#CCD7E1;max-width:64ch;margin:24px 0 0}.hero a.email{color:#D6DFE7;font-size:15px}.hero-grid{display:grid;grid-template-columns:1.25fr 1fr;gap:54px;align-items:center}.hero.plain h1{max-width:25ch;font-size:clamp(34px,4vw,56px)}.hero-art{border:1px solid #33465B;padding:22px 22px 16px;background:linear-gradient(135deg,#13253A,#0E1B2B)}.hero-art svg{width:100%;display:block}.hero-art figcaption{color:#B5C4D1;font:11px/1.6 var(--f-mono);margin-top:14px;letter-spacing:.03em}.hero-art{margin:0}.hero-art .diagram-title{font:12px var(--f-mono);letter-spacing:.1em;color:#C0CED9}.product-card{border:1px solid var(--line);border-top:3px solid var(--copper);padding:30px;background:#fff;display:flex;flex-direction:column;position:relative;min-width:0}.product-card h3{font-size:28px;max-width:17ch}.product-card .number{font:12px var(--f-mono);color:var(--slate);margin-bottom:30px}.product-card p{max-width:48ch;color:var(--slate)}.product-card .more{margin-top:auto;padding-top:16px;font-weight:600;min-height:44px}.product-icon{position:absolute;right:26px;top:24px;width:58px;height:48px;color:var(--copper-dk)}.support-line{margin:25px 0 0;font-size:16px}.card{padding:26px;border:1px solid var(--line);background:#fff;min-width:0}.card h3{font-size:23px}.card p{font-size:17px;color:var(--slate)}.card a{display:inline-flex;align-items:center;min-height:44px;font-weight:600}.label-list{display:flex;gap:10px;flex-wrap:wrap;margin-top:24px}.label-list a{border:1px solid var(--line);padding:9px 15px;font-size:16px;min-height:44px;text-decoration:none;background:white}.proposal-grid{border-top:1px solid var(--line);padding-top:28px}.proposal-item{padding:0 18px 0 0}.proposal-item span{display:block;color:var(--copper-dk);font:12px var(--f-mono);margin-bottom:14px}.proposal-item h3{font-size:20px}.proposal-item p{font-size:16px;color:var(--slate)}.steps{list-style:none;counter-reset:step;padding:0;margin:28px 0 0;display:grid;grid-template-columns:repeat(4,1fr);gap:28px}.steps li{counter-increment:step;border-top:1px solid #57687B;padding-top:18px}.steps li:before{content:"0" counter(step);display:block;color:#E4A568;font:13px var(--f-mono);margin-bottom:20px}.steps b{display:block;font:600 20px/1.3 var(--f-display);margin-bottom:12px}.steps p{font-size:16px;color:#C5D1DD}.compact-steps{list-style:decimal;padding-left:24px}.compact-steps li{padding:0 0 18px 8px}.compact-steps b{display:block;font-family:var(--f-display)}.check{padding-left:20px}.check li{padding-left:4px;margin:10px 0}.check li::marker{color:var(--copper-dk)}.panel{padding:22px 25px;background:var(--steel);border-left:3px solid var(--copper);margin:26px 0}.tbl{overflow-x:auto;margin:24px 0;border:1px solid var(--line)}table{width:100%;border-collapse:collapse;font-size:16px}th,td{padding:15px 18px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line)}th{background:var(--steel);font:500 12px/1.5 var(--f-mono);text-transform:uppercase;letter-spacing:.05em}td.v{font-family:var(--f-mono);font-size:14px}.sku{font-weight:600}tr:last-child td{border-bottom:0}.subnav{display:flex;gap:22px;flex-wrap:wrap;border-bottom:1px solid var(--line);margin-bottom:32px}.subnav a{padding:12px 0;min-height:44px}.subnav a[aria-current]{color:var(--ink);font-weight:600;border-bottom:2px solid var(--copper)}details{border-top:1px solid var(--line);padding:18px 0}summary{cursor:pointer;font:600 19px/1.4 var(--f-display);min-height:44px;padding:9px 0}details[open] summary{margin-bottom:16px}.app-section{scroll-margin-top:24px}.app-section h2{font-size:34px}.footer-cta{display:flex;justify-content:space-between;gap:32px;align-items:center;border-top:1px solid var(--line);padding-top:36px;margin-top:44px}.footer-cta h2{font-size:30px}.footer-cta p{max-width:60ch}.footer-cta .btn{flex:none}footer{background:var(--ink);color:#B9C7D4;padding:42px 0 24px;font-size:15px}footer .footer-grid{display:grid;grid-template-columns:1.5fr 1fr 1fr;gap:40px}footer .brand{color:#fff;margin-bottom:18px}footer a{color:#E7ECF2;display:inline-flex;align-items:center;min-height:36px}footer p{margin-bottom:8px}.footnote{border-top:1px solid #354457;padding-top:20px;margin-top:30px;font:12px var(--f-mono);color:#A2B2C2}.formbox{padding:28px;border:1px solid var(--line);background:#fff}.q{display:grid;grid-template-columns:1fr 1fr;gap:18px}.q .full{grid-column:1/-1}.q label{display:block;font-size:15px;font-weight:600;line-height:1.5;margin-bottom:7px}.q input,.q select,.q textarea{width:100%;max-width:100%;border:1px solid #A9B5C2;border-radius:2px;padding:11px 12px;background:white;color:var(--ink);font-size:16px;min-height:46px}.q textarea{min-height:130px;resize:vertical}.q details{grid-column:1/-1}.q .fields,.form-grid,.optional-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}.field-pair,.input-unit,.unit-pair{display:grid;grid-template-columns:minmax(0,1fr) 105px;gap:10px}.q small,.hint,.form-hint{font-size:14px;color:var(--slate);display:block;margin:6px 0 0}.q .error,.field-error{color:#9F2626;font-size:14px;margin:5px 0 0}.form-status{padding:16px;border-left:3px solid var(--copper);background:var(--steel)}.q [aria-invalid=true]{border-color:#A52A2A}.q .honeypot{display:none}.quote-grid{display:grid;grid-template-columns:1.35fr 1fr;gap:48px;align-items:start}.quote-aside{font-size:17px}.quote-aside h2{font-size:27px}.quote-aside h3{font-size:22px}.attachment-field label{display:block;font-size:15px;font-weight:600;margin-bottom:8px}.attachment-field input{width:100%;min-height:46px;padding:11px 12px;border:1px solid #A9B5C2;font-size:16px}.field-hint{font-weight:400;color:var(--slate);font-size:14px}.q [hidden],[hidden]{display:none!important}.prose{max-width:780px}.prose h2{margin-top:35px;font-size:28px}
@media(min-width:1600px){.hero{padding:76px 0}}
@media(max-width:1100px){.nav .wrap{gap:18px}.nav ul{gap:16px}.nav .brand{font-size:17px}.nav .btn{padding:10px 14px}.hero-grid{gap:28px}.grid4{grid-template-columns:1fr 1fr}}
@media(max-width:900px){.nav .wrap{padding:17px 0;min-height:78px}.nav ul{width:100%;flex-wrap:wrap;border-top:1px solid #34465B;padding-top:16px}.navbtn:not([hidden]){display:inline-flex}.nav.menu-ready ul:not(.is-open){display:none}.hero-grid{grid-template-columns:1fr}.hero-art{display:none}.hero h1{max-width:20ch}.hero .sub{max-width:57ch}.section-head{display:block}.section-head p{margin-top:18px}.grid3{grid-template-columns:1fr}.steps{grid-template-columns:1fr 1fr}.quote-grid{grid-template-columns:1fr;gap:36px}.footer-cta{align-items:flex-start;flex-direction:column}.cols{gap:28px}.q .full{min-width:0}}
@media(max-width:600px){.wrap{width:calc(100% - 40px)}body{font-size:17px}.s{padding:46px 0}.hero{padding:40px 0 46px}.hero .sub{font-size:19px}.hero .cta .btn{width:100%}.nav .brand{font-size:16px;gap:7px}.nav .mark{width:28px;height:28px}.nav ul{display:block}.nav li a.l{padding:7px 0}.nav li .btn{margin-top:12px;width:100%}.grid2,.grid4,.cols{grid-template-columns:1fr}.product-card{padding:25px}.product-card .number{margin-bottom:24px}.product-card h3{font-size:26px}.product-icon{right:22px}.proposal-grid{gap:24px}.proposal-item{border-bottom:1px solid var(--line);padding-bottom:8px}.steps{gap:22px}.steps b{font-size:18px}.steps p{font-size:15px}.q,.q .fields,.form-grid,.optional-grid{grid-template-columns:1fr}.formbox{padding:20px}.section-head h2{max-width:20ch}.footer-grid{grid-template-columns:1fr!important;gap:26px!important}.footer-cta h2{font-size:27px}.tbl table{min-width:560px}.tbl{scrollbar-width:thin}.label-list{gap:8px}h1{font-size:36px}.hero.plain h1{font-size:34px}.brand span{letter-spacing:0}.formbox .btn{width:100%}}
@media(max-width:359px){.wrap{width:calc(100% - 32px)}.nav .brand{font-size:14px}.nav .wrap{gap:10px}.navbtn{padding:8px 10px}h1{font-size:33px}.steps{grid-template-columns:1fr}.product-card{padding:22px}.formbox{padding:16px}.field-pair,.input-unit,.unit-pair{grid-template-columns:minmax(0,1fr) 90px}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}*,*::before,*::after{animation:none!important;transition:none!important}}
'''

SHARED_JS = '''
(() => {
  const allowedApplications = new Set(['data-center','solar','storage','utility','industrial','other']);
  const allowedProducts = new Set(['power','distribution','unsure']);
  const params = new URLSearchParams(location.search);
  const app = params.get('application');
  const combined = location.pathname.endsWith('/solar-storage.html') && ['solar','storage'].includes(app);
  if ((allowedProducts.has(document.body.dataset.product) || combined) && params.getAll('application').length === 1 && allowedApplications.has(app)) {
    document.body.dataset.application = app;
    document.querySelectorAll('a[href]').forEach(link => {
      const target = link.getAttribute('href');
      if (target.startsWith('#')) return;
      const url = new URL(target, location.href);
      if (url.origin === location.origin && ['/quote.html','/power-transformers.html','/distribution-transformers.html'].some(route => url.pathname.endsWith(route))) {
        url.searchParams.set('application', app);
        link.setAttribute('href', url.pathname.split('/').pop() + '?' + url.searchParams.toString() + url.hash);
      }
    });
  }
  const nav = document.querySelector('.nav');
  const toggle = document.querySelector('.navbtn');
  const menu = document.getElementById('site-menu');
  if (nav && toggle && menu) {
    toggle.hidden = false;
    nav.classList.add('menu-ready');
    const close = () => { menu.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); };
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      menu.classList.toggle('is-open', open);
      toggle.setAttribute('aria-expanded', String(open));
    });
    nav.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); toggle.focus(); } });
    menu.addEventListener('click', event => { if (event.target.closest('a')) close(); });
    window.addEventListener('pageshow', close);
  }
})();
'''

def href(category=None, application=None):
    params = {k: v for k, v in [('product', category), ('application', application)] if v}
    return 'quote.html' + ('?' + urlencode(params) if params else '')

def checks(items):
    return '<ul class="check">' + ''.join(f'<li>{E(x)}</li>' for x in items) + '</ul>'

def hero(eyebrow, title, sub='', actions='', graphic=False):
    content = f'<div><div class="eyebrow">{E(eyebrow)}</div><h1>{E(title)}</h1><p class="sub">{E(sub)}</p>{actions}</div>'
    if graphic:
        content += diagram()
    return f'<header class="hero {"" if graphic else "plain"}"><div class="wrap {"hero-grid" if graphic else ""}">{content}</div></header>'

def diagram():
    return '''<figure class="hero-art"><div class="diagram-title">TRANSFORMER SUPPLY / TWO PRODUCT PATHS</div><svg viewBox="0 0 420 250" role="img" aria-labelledby="diagram-title"><title id="diagram-title">Illustrative power and distribution transformer symbols, shown as equal product categories</title><g fill="none" stroke="#8D9EAF" stroke-width="1"><path d="M0 40H420M0 90H420M0 140H420M0 190H420M50 20V225M130 20V225M210 20V225M290 20V225M370 20V225" opacity=".15"/></g><g fill="none" stroke="#E4A568" stroke-width="2"><path d="M95 60V85M95 167V192M310 60V85M310 167V192"/><circle cx="95" cy="116" r="31"/><circle cx="95" cy="140" r="27"/><circle cx="310" cy="116" r="31"/><circle cx="310" cy="140" r="27"/></g><g font-family="Arial,sans-serif" fill="#DAE4EC" font-size="16" text-anchor="middle"><text x="95" y="223">Power</text><text x="310" y="223">Distribution</text></g><path d="M210 70V185" stroke="#43556A" stroke-dasharray="3 6"/></svg><figcaption>Illustrative product symbols. Configuration is set by the project specification.</figcaption></figure>'''

def icon():
    return '<svg class="product-icon" viewBox="0 0 64 50" aria-hidden="true"><path d="M4 25H15M49 25H60" stroke="currentColor" fill="none" stroke-width="2"/><circle cx="26" cy="25" r="13" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="39" cy="25" r="13" fill="none" stroke="currentColor" stroke-width="2"/></svg>'

def product_cards(application=None):
    return '<div class="grid2">' + ''.join(f'<article class="product-card"><span class="number">0{i+1} / TRANSFORMERS</span>{icon()}<h3>{E(p["name"])}</h3><p>{E(p["summary"])}</p><a class="more" href="{p["route"]}">Explore {E(p["name"].lower())} <span aria-hidden="true">→</span></a></article>' for i,p in enumerate(PRODUCT_CATEGORIES)) + '</div>'

def proposal():
    return '<section class="s"><div class="wrap"><div class="section-head"><div><div class="eyebrow">Your proposal</div><h2>A clear basis for the purchase</h2></div><p>Review the configuration, scope and schedule together. Technical exceptions are set out for your team.</p></div><div class="grid4 proposal-grid">' + ''.join(f'<div class="proposal-item"><span>0{i+1}</span><h3>{E(h)}</h3><p>{E(p)}</p></div>' for i,(h,p) in enumerate(PROPOSAL)) + '</div></div></section>'

def cta(category=None, application=None, title='Have a transformer requirement?'):
    return f'<div class="footer-cta"><div><h2>{E(title)}</h2><p>Send your specification, equipment schedule or an outline of the requirement. Include your required site date when known.</p><a href="mailto:{SITE["email"]}">{SITE["email"]}</a></div><a class="btn" href="{E(href(category,application))}">Request a quotation</a></div>'

def subnav(current):
    return '<nav class="subnav" aria-label="Quality and delivery">' + ''.join(f'<a href="{route}"{chr(32)+"aria-current=page" if current==route else ""}>{title}</a>' for title,route in [('Quality','quality.html'),('Delivery and warranty','delivery.html'),('From specification to delivery','manufacturing.html')]) + '</nav>'

PAGES = []
def write(route, title, desc, body, section=None, noindex=False, product='', application=''):
    ver = hashlib.sha256(CSS.encode()).hexdigest()[:10]
    jsver = hashlib.sha256(SHARED_JS.encode()).hexdigest()[:10]
    formver = hashlib.sha256((OUT/'inquiry.js').read_bytes()).hexdigest()[:10]
    canonical = SITE['domain'] + ('/' if route == 'index.html' else '/' + route)
    nav = ''.join(f'<li><a class="l" href="{link}"'+(' aria-current="page"' if link == (section or route) else '')+f'>{title}</a></li>' for title,link in NAV)
    quote_url = E(href(product or None, application or None))
    org = json.dumps({'@context':'https://schema.org','@type':'Organization','name':SITE['name'],'url':SITE['domain'],'email':SITE['email'],'telephone':SITE['phone_raw']})
    document = f'''<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{E(title)}</title><meta name="description" content="{E(desc)}"><link rel="canonical" href="{canonical}">
{ '<meta name="robots" content="noindex,follow">' if noindex else '' }
<meta property="og:type" content="website"><meta property="og:site_name" content="Farpoint Energy"><meta property="og:title" content="{E(title)}"><meta property="og:description" content="{E(desc)}"><meta property="og:url" content="{canonical}"><meta property="og:image" content="{SITE['domain']}/social-card.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Farpoint Energy — Power and distribution transformers"><meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="favicon.svg" type="image/svg+xml"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap"><link rel="stylesheet" href="style.css?v={ver}">
<script type="application/ld+json">{org}</script><script src="site.js?v={jsver}" defer></script><script src="inquiry.js?v={formver}" defer></script></head>
<body data-product="{product}" data-application="{application}"><a class="skip" href="#main">Skip to content</a><nav class="nav" aria-label="Main navigation"><div class="wrap"><a class="brand" href="index.html">{MARK}FARPOINT&nbsp;<span>ENERGY</span></a><button class="navbtn" type="button" aria-controls="site-menu" aria-expanded="false" hidden>Menu</button><ul id="site-menu">{nav}<li><a class="btn" href="{quote_url}">Request a quotation</a></li></ul></div></nav>
<main id="main">{body}</main>
<footer><div class="wrap"><div class="footer-grid"><div><div class="brand">{MARK}FARPOINT&nbsp;<span>ENERGY</span></div><p>Power and distribution transformers,<br>built to your specification.</p><p>{SITE['city']}</p></div><div><p><a href="products.html">Products</a><br><a href="applications.html">Applications</a><br><a href="manufacturing.html">From specification to delivery</a><br><a href="delivery.html">Delivery and warranty</a></p></div><div><a href="mailto:{SITE['email']}">{SITE['email']}</a><br><a href="tel:{SITE['phone_raw']}">{SITE['phone']}</a><br><a href="{quote_url}">Request a quotation</a><br><a href="privacy.html">Privacy</a></div></div><div class="footnote">© 2026 Farpoint Energy</div></div></footer></body></html>'''
    (OUT/route).write_text(document+'\n',encoding='utf-8')
    if not noindex: PAGES.append(route)

# Home
home = hero(HERO['eyebrow'], HERO['h1'], HERO['sub'], f'<div class="cta"><a class="btn" href="quote.html">Request a quotation</a><a class="btn ghost onDark" href="products.html">Explore transformers</a></div><a class="email" href="mailto:{SITE["email"]}">{SITE["email"]}</a>', True)
home += '<section class="s"><div class="wrap"><div class="section-head"><div><div class="eyebrow">Products</div><h2>The transformer your project needs</h2></div><p>Two product paths. Each quoted to the specification, installation and delivery requirements of your project.</p></div>' + product_cards() + '<p class="support-line">Not sure which category fits? <a href="quote.html?product=unsure">Send the requirement.</a></p></div></section>'
home += '<section class="s alt"><div class="wrap"><div class="section-head"><div><div class="eyebrow">Applications</div><h2>From the substation to site distribution</h2></div><a href="applications.html">View all applications →</a></div><div class="grid2"><article class="card"><h3>Data centers</h3><p>Incoming utility and substation transformation, plus distribution for the site. Send the package specification and delivery phases.</p><a href="data-centers.html">Data-center transformers →</a></article><article class="card"><h3>Solar and storage</h3><p>Main interconnection transformers and medium-voltage units associated with solar and storage systems.</p><a href="solar-storage.html">Solar and storage transformers →</a></article></div><div class="label-list"><a href="applications.html#utilities">Utilities</a><a href="applications.html#industrial">Industrial projects</a><a href="applications.html#replacement">Replacements</a></div></div></section>'
home += proposal()
home += '<section class="s dark"><div class="wrap"><div class="eyebrow">Execution</div><h2>From requirement to delivery</h2><ol class="steps">' + ''.join(f'<li><b>{E(h)}</b><p>{E(p)}</p></li>' for h,p in PROCESS) + '</ol><p class="mt"><a href="manufacturing.html">Explore the delivery process →</a></p></div></section><section class="s"><div class="wrap">' + cta() + '</div></section>'
write('index.html','Farpoint Energy — Power and distribution transformers',HERO['sub'],home)

# Product overview and detail routes
body = hero('Products','Power and distribution transformers','Find the right quotation path for your transformer package. Send the specification you have, or start with the project requirement.')
body += '<section class="s"><div class="wrap">' + product_cards() + cta('unsure', title='Not sure which category fits?') + '</div></section>' + proposal()
write('products.html','Transformer products — Farpoint Energy','Power and distribution transformer supply for data centers, energy projects, utilities and industry.',body)
for p in PRODUCT_CATEGORIES:
    body = hero('Products / '+p['eyebrow'],p['name'],p['summary'],f'<div class="cta"><a class="btn" href="{href(p["id"])}">Request a quotation</a><a class="btn ghost onDark" href="products.html">Compare product paths</a></div>')
    body += '<section class="s"><div class="wrap"><div class="cols"><div><div class="eyebrow">Package scope</div><h2>Built around the application</h2>' + checks(p['uses']) + '</div><div><div class="eyebrow">Start with what you have</div><h2>Useful specification inputs</h2>' + checks(p['inputs']) + '</div></div></div></section>'
    if p['id']=='power':
        rows = ''.join('<tr>'+''.join(f'<td class="{ "sku" if j==0 else "v" }">{E(c)}</td>' for j,c in enumerate(row))+'</tr>' for row in STANDARD['lineup'])
        body += f'<section class="s alt"><div class="wrap"><div class="eyebrow">Reference configurations</div><h2>{E(STANDARD["h"])}</h2><p class="section-intro">{E(STANDARD["p"])}</p><div class="tbl" tabindex="0" role="region" aria-label="Example transformer configurations; scroll horizontally on small screens"><table><thead><tr><th scope="col">Reference</th><th scope="col">Cooling-stage ratings</th><th scope="col">High side</th><th scope="col">Low side</th></tr></thead><tbody>{rows}</tbody></table></div><p class="small muted">{E(STANDARD["common"])}</p><p class="small">{E(STANDARD["options"])}</p></div></section>'
    else:
        body += '<section class="s alt"><div class="wrap"><div class="cols"><div><h2>The installation sets the configuration</h2><p>Mounting arrangement, insulation medium, taps, impedance, terminals and accessories are specified for the project. Include site conditions and installation constraints with your inquiry.</p></div><div><h2>One unit or a phased package</h2><p>Send quantities by rating and the required site dates for each phase. If the equipment schedule is still developing, share the information available.</p></div></div></div></section>'
    body += proposal() + '<section class="s alt"><div class="wrap">'+cta(p['id'])+'</div></section>'
    write(p['route'],p['name']+' — Farpoint Energy',p['summary'],body,'products.html',product=p['id'])

# Applications retain established fragment addresses.
body = hero('Applications','Transformer supply for your project','Select the application, then the transformer package. The project specification determines its rating and configuration.')
body += '<section class="s"><div class="wrap"><div class="label-list">'+''.join(f'<a href="#{a["id"]}">{E(a["name"])}</a>' for a in APPLICATIONS)+'</div></div></section>'
for i,a in enumerate(APPLICATIONS):
    body += f'<section class="s app-section {"alt" if i%2==0 else ""}" id="{a["id"]}"><div class="wrap"><div class="cols"><div><h2>{E(a["name"])}</h2><p>{E(a["lead"])}</p></div><div><p>{E(a["body"])}</p><div class="cta"><a class="btn" href="{E(href(a.get("category"),a["application"]))}">Request a quotation</a>'
    if a.get('route') and not a['route'].startswith('applications.html'): body += f'<a class="btn ghost" href="{a["route"]}">Explore the application</a>'
    body += '</div></div></div></div></section>'
body += proposal()
write('applications.html','Transformer applications — Farpoint Energy','Transformer packages for data centers, solar, battery storage, utilities, industry and replacement projects.',body,'applications.html')
for key,data in APPLICATION_LANDINGS.items():
    app = 'data-center' if key=='data-center' else ''
    route = 'data-centers.html' if key=='data-center' else 'solar-storage.html'
    body=hero('Applications',data['title'],data['intro'])
    body+='<section class="s"><div class="wrap"><div class="grid2">'
    for heading,desc,cat in data['packages']:
        product = next(p for p in PRODUCT_CATEGORIES if p['id']==cat)
        body+=f'<article class="product-card"><div class="eyebrow">{E(product["name"])}</div><h2>{E(heading)}</h2><p>{E(desc)}</p><a class="more" href="{E(href(cat,app))}">Request this transformer package →</a><a href="{product["route"]}{"?application="+app if app else ""}">Explore {E(product["name"].lower())}</a></article>'
    body+='</div></div></section><section class="s alt"><div class="wrap"><div class="cols"><div><h2>What to send</h2>'+checks(data['inputs'])+'</div><div><h2>Define the package and the schedule</h2><p>Identify the units in scope and any delivery phases. The quotation sets out transformer supply, technical exceptions, testing, documentation and the agreed delivery scope.</p><p>Start with your existing documents; an early requirement is welcome.</p></div></div>'+cta(application=app)+'</div></section>'+proposal()
    write(route,data['title']+' — Farpoint Energy',data['intro'],body,'applications.html',application=app)

# Quality, execution, delivery
q=QUALITY
body=hero('Quality and delivery',q['h'],q['intro'])+'<section class="s"><div class="wrap">'+subnav('quality.html')+'<div class="grid2">'+''.join(f'<div><h3>{E(h)}</h3><p>{E(p)}</p></div>' for h,p in q['blocks'])+'</div></div></section>'
rows=''.join(f'<tr><td>{E(h)}</td><td>{E(p)}</td></tr>' for h,p in q['tests'])
body+='<section class="s alt"><div class="wrap"><h2>For your engineering team</h2><details><summary>Factory test plan</summary><p>The applicable product standard and agreed specification determine the test scope, acceptance criteria and witnessing arrangements.</p><div class="tbl" tabindex="0" role="region" aria-label="Test planning examples"><table><thead><tr><th>Test area</th><th>Scope to define</th></tr></thead><tbody>'+rows+'</tbody></table></div></details><details><summary>Inspection and release points</summary>'+checks(q['itp'])+'</details><details><summary>Site activities</summary>'+checks(q['site'])+'</details><details><summary>Standards and interfaces</summary><p>'+E(q['standards'])+'</p><p>'+E(q['interfaces'])+'</p></details>'+cta()+'</div></section>'
write('quality.html','Quality and testing — Farpoint Energy','Specification review, approval drawings, inspection, factory acceptance testing and documentation for the proposed transformer package.',body,'quality.html')
body=hero('Quality and delivery','From specification to delivery','A defined transformer package, an agreed approval process and a delivery plan built around your project.')+'<section class="s"><div class="wrap">'+subnav('manufacturing.html')+'<div class="grid2">'+''.join(f'<div><div class="eyebrow">0{i+1}</div><h2>{E(h)}</h2><p>{E(p)}</p></div>' for i,(h,p) in enumerate(PROCESS))+'</div>'+cta()+'</div></section>'
write('manufacturing.html','From specification to delivery — Farpoint Energy','Requirement review, design approvals, production, testing and delivery for project-specific transformer supply.',body,'quality.html')
d=DELIVERY
body=hero('Quality and delivery','Delivery, warranty and service',d['intro'])+'<section class="s"><div class="wrap">'+subnav('delivery.html')+'<div class="cols"><div><h2>A schedule with defined milestones</h2><ol class="compact-steps">'+''.join(f'<li><b>{E(h)}</b>{E(p)}</li>' for h,p in d['stages'])+'</ol></div><div><h2>'+E(d['warranty_h'])+'</h2><p>'+E(d['warranty'])+'</p><h3 class="mt">After-sales scope</h3>'+checks(d['service'])+'</div></div>'+cta()+'</div></section>'
write('delivery.html','Delivery and warranty — Farpoint Energy','Project-specific delivery schedules, warranty terms and after-sales scope included in the transformer proposal.',body,'quality.html')

# Inquiry and confirmation
qq=QUOTE
body=hero('Start a conversation',qq['h'],qq['sub'])+'<section class="s"><div class="wrap quote-grid"><div>'+render_form(SITE,PRODUCT_CATEGORIES,APPLICATIONS)+'</div><aside class="quote-aside"><h2>Start with what you have</h2><ol class="compact-steps">'+''.join(f'<li><b>{E(h)}</b>{E(p)}</li>' for h,p in qq['ways'])+'</ol><h3>Useful documents</h3>'+checks(qq['send'])+'<div class="panel">'+E(qq['back'])+f'</div><p>Prefer email?<br><a href="mailto:{SITE["email"]}">{SITE["email"]}</a></p></aside></div></section>'
write('quote.html','Request a quotation — Farpoint Energy','Send a transformer requirement or specification. Power and distribution inquiries for complete specifications and early project planning.',body)
write('thanks.html','Your quotation request — Farpoint Energy','Next steps for a Farpoint transformer inquiry.',thanks_content(SITE),noindex=True)

# Preserve the established founder section.
a=ABOUT
about=hero('About',a['h'],a['intro'])+f'''
<section class="s"><div class="wrap"><div class="cols"><div><div class="eyebrow">Founder</div><h2>{E(a['founder_name'])}</h2><p class="muted">{E(a['founder_title'])}</p><p>{E(a['founder'])}</p><p>{E(a['advisors'])}</p></div>
<div><div class="eyebrow">Contact</div><h2>New York</h2><p class="mt"><a href="mailto:{SITE['founder_email']}">{SITE['founder_email']}</a><br><a href="mailto:{SITE['email']}">{SITE['email']}</a><br><a href="tel:{SITE['phone_raw']}">{SITE['phone']}</a></p><a class="btn" href="quote.html">Request a quotation</a></div></div></div></section>'''
write('about.html','About — Farpoint Energy','Farpoint Energy supplies power and distribution transformers for US projects. Based in New York.',about)

privacy=hero('Privacy','Inquiry information','How information sent through this website is handled.')+f'''<section class="s"><div class="wrap prose"><h2>Information you send</h2><p>The quotation form collects your contact details and the project information you choose to provide. Farpoint uses it to review your requirement, prepare a response and communicate about the potential supply.</p><h2>Form and email processing</h2><p>The form is submitted through <a href="https://formsubmit.co/privacy.pdf" rel="external">FormSubmit</a> and routed to {SITE['email']}. Email attachments go directly to that business inbox. FormSubmit and the email provider process information as part of those services. Send only information you are authorized to share; contact us first if a project requires a separate confidential document process.</p><h2>Website services</h2><p>This static website is hosted on GitHub Pages and uses Google Fonts. Those services receive technical request information when your browser loads their resources. This website does not currently send inquiry analytics to a tracking service.</p><p>After an accepted form submission, this website may use temporary browser session storage to display the confirmation. It is cleared after the confirmation is displayed. A source or campaign code may be included with an inquiry; personal information is not added to page URLs.</p><h2>Questions and requests</h2><p>For questions about information you have sent, or to request correction or deletion, email <a href="mailto:{SITE['email']}">{SITE['email']}</a>.</p></div></section>'''
write('privacy.html','Privacy — Farpoint Energy','How contact and project information submitted through the Farpoint website is processed.',privacy)
write('404.html','Page not found — Farpoint Energy','Page not found.',hero('404','Page not found','Use the product pages or send us your transformer requirement.', '<div class="cta"><a class="btn" href="products.html">Explore transformers</a><a class="btn ghost onDark" href="quote.html">Request a quotation</a></div>'),noindex=True)
for old,new in [('markets.html','applications.html'),('contact.html','quote.html')]:
    (OUT/old).write_text(f'<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,follow"><title>Farpoint Energy</title><meta http-equiv="refresh" content="0; url={new}"><link rel="canonical" href="{SITE["domain"]}/{new}"></head><body><a href="{new}">Continue to Farpoint Energy</a><script>location.replace("{new}" + location.hash);</script></body></html>\n',encoding='utf-8')
(OUT/'sitemap.xml').write_text('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+''.join(f'  <url><loc>{SITE["domain"]}/{"" if r=="index.html" else r}</loc></url>\n' for r in PAGES)+'</urlset>\n',encoding='utf-8')
(OUT/'robots.txt').write_text('User-agent: *\nAllow: /\nSitemap: '+SITE['domain']+'/sitemap.xml\n',encoding='utf-8')
(OUT/'style.css').write_text(CSS.strip()+'\n',encoding='utf-8')
(OUT/'site.js').write_text(SHARED_JS.strip()+'\n',encoding='utf-8')
(OUT/'README.md').write_text('''# farpointenergy.com

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
''',encoding='utf-8')
print('Built',len(PAGES),'indexable pages plus confirmation, redirects and 404.')
