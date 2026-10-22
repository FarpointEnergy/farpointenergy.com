#!/usr/bin/env python3
"""Focused content-preservation and static-site checks. Run after build.py."""
import ast
import hashlib
import html
from html.parser import HTMLParser
import pathlib
import re
import subprocess
import sys
from urllib.parse import parse_qs, unquote, urlsplit
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).parent
BASELINE = '46a24e8df1537f85d9d379d96f99d0305b65465e'
COMPATIBILITY = {
    'power-transformers.html': 'products.html#power',
    'distribution-transformers.html': 'products.html#distribution',
    'data-centers.html': 'applications.html#datacenter',
    'solar-storage.html': 'applications.html#solar',
}
APPLICATIONS = ['utilities', 'solar', 'storage', 'hybrid', 'datacenter', 'industrial', 'wind', 'replacement']


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.tags, self.ids, self.duplicates = [], [], []
        self.text = text
        self.feed(text)

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        self.tags.append((tag, attrs))
        if attrs.get('id'):
            if attrs['id'] in self.ids:
                self.duplicates.append(attrs['id'])
            self.ids.append(attrs['id'])

    def find(self, tag, **attrs):
        return [a for t, a in self.tags if t == tag and all(a.get(k) == v for k, v in attrs.items())]


def baseline(path):
    return subprocess.check_output(['git', 'show', f'{BASELINE}:{path}'], cwd=ROOT)


def value(node):
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == 'dict':
        return {item.arg: value(item.value) for item in node.keywords}
    return ast.literal_eval(node)


def constant(source, name):
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(isinstance(n, ast.Name) and n.id == name for n in node.targets):
            return value(node.value)
    raise ValueError(f'Missing source constant {name}')


def founder(text):
    start = text.index('<section', text.index('</header>'))
    return text[start:text.index('</section>', start) + len('</section>')]


def sections(text):
    return re.findall(r'<section\b[^>]*>.*?</section>', text, re.S)


def snapshot():
    extensions = {'.html', '.css', '.js', '.xml', '.txt', '.md', '.svg', '.png'}
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.iterdir()
            if p.is_file() and p.suffix in extensions}


def main():
    failures = []
    def check(condition, message):
        if not condition:
            failures.append(message)

    pages = {p.name: Page(p.read_text()) for p in ROOT.glob('*.html')}
    redirects = {'markets.html', 'contact.html'} | set(COMPATIBILITY)
    baseline_routes = set(subprocess.check_output(['git', 'ls-tree', '--name-only', BASELINE], cwd=ROOT, text=True).splitlines())
    expected_routes = {p for p in baseline_routes if p.endswith('.html')} | {'privacy.html'} | set(COMPATIBILITY)
    check(set(pages) == expected_routes, f'Unexpected route inventory: {set(pages) ^ expected_routes}')
    source = (ROOT / 'build.py').read_text()
    old_source = baseline('build.py').decode()
    expected_nav = constant(old_source, 'NAV')
    check(constant(source, 'NAV') == expected_nav, 'Existing navigation changed')
    diagram = constant(old_source, 'DIAGRAM')
    check(constant(source, 'DIAGRAM') == diagram, 'Engineering illustration changed')
    check(diagram in pages['index.html'].text, 'Original engineering illustration missing from home')
    check('illustrative' in pages['index.html'].text.lower(), 'Illustration needs an illustrative-example label')

    for name, page in pages.items():
        check(not page.duplicates, f'{name}: duplicate IDs {page.duplicates}')
        check(len(page.find('link', rel='canonical')) == 1, f'{name}: canonical missing')
        if name not in redirects:
            check(len(page.find('h1')) == 1, f'{name}: expected one h1')
            check(bool(page.find('meta', name='description')), f'{name}: description missing')
            check(bool(page.find('meta', property='og:image')), f'{name}: sharing image missing')
            nav = re.search(r'<nav\b.*?</nav>', page.text, re.S)
            nav_links = Page(nav.group(0)).find('a') if nav else []
            links = [a.get('href', '').split('?')[0] for a in nav_links]
            check(links == ['index.html'] + [route for _, route in expected_nav] + ['quote.html'], f'{name}: rendered navigation differs')
        for tag, attrs in page.tags:
            target = attrs.get('href') if tag in {'a', 'link'} else attrs.get('src') if tag in {'script', 'img'} else None
            if not target:
                continue
            url = urlsplit(target)
            if url.scheme or url.netloc:
                continue
            path = unquote(url.path) or name
            check((ROOT / path).exists(), f'{name}: missing local target {target}')
            if url.fragment and path in pages:
                check(url.fragment in pages[path].ids, f'{name}: broken anchor {target}')
            check(not path.lower().endswith('.pdf'), f'{name}: catalog link promoted')
            if name not in redirects and tag == 'a':
                check(path not in COMPATIBILITY, f'{name}: extra product/application navigation layer')

    check([i for i in pages['applications.html'].ids if i in APPLICATIONS] == APPLICATIONS, 'Application sections changed order or are missing')
    check({'power', 'distribution'} <= set(pages['products.html'].ids), 'Product anchors missing')
    home = pages['index.html'].text
    home_sections, old_sections = sections(home), sections(baseline('index.html').decode())
    check(len(home_sections) == len(old_sections) == 4, 'Homepage gained or lost an explanatory section')
    if len(home_sections) == 4:
        for i, routes in enumerate([['products.html#distribution'], ['applications.html#datacenter'], ['manufacturing.html'], ['quality.html', 'delivery.html']]):
            for route in routes:
                check(route in html.unescape(home_sections[i]), f'Homepage section {i + 1}: missing {route}')
    for name, page in pages.items():
        check('A clear basis for the purchase' not in page.text, f'{name}: repeated proposal module retained')

    for old, destination in COMPATIBILITY.items():
        page = pages[old]
        check(any(a.get('content', '').lower().startswith('noindex') for a in page.find('meta', name='robots')), f'{old}: redirect not noindex')
        check(any(destination in a.get('content', '') for a in page.find('meta', **{'http-equiv': 'refresh'})), f'{old}: wrong fallback redirect')
        check(any(destination in a.get('href', '') for a in page.find('a')), f'{old}: redirect fallback link missing')

    old_content = baseline('content.py').decode()
    content = (ROOT / 'content.py').read_text()
    old_about, about = constant(old_content, 'ABOUT'), constant(content, 'ABOUT')
    for key in ['founder_name', 'founder_title', 'founder', 'advisors']:
        check(old_about[key] == about[key], f'Founder field changed: {key}')
    check(founder(baseline('about.html').decode()) == founder(pages['about.html'].text), 'Complete founder section changed')
    check(constant(old_content, 'DELIVERY')['warranty'] == constant(content, 'DELIVERY')['warranty'], 'Established warranty policy changed')
    for filename in baseline_routes:
        if filename.endswith('.pdf') or filename in {'CNAME', '.nojekyll', 'favicon.svg'}:
            check((ROOT / filename).read_bytes() == baseline(filename), f'Preserved asset changed: {filename}')

    form = pages['quote.html']
    expected_references = {row[0] for row in constant(content, 'STANDARD')['lineup']}
    reference_links = pages['products.html'].find('a', **{'class': 'reference-link'})
    linked_references = []
    for link in reference_links:
        target = urlsplit(link['href'])
        query = parse_qs(target.query)
        linked_references.extend(query.get('reference', []))
        check(target.path == 'quote.html' and target.fragment == 'quote-form' and query.get('product') == ['power'], 'Reference action does not lead directly to power quotation form')
        check(link.get('aria-label', '').startswith('Use this reference:'), 'Reference action loses its visible accessible name')
    check(len(linked_references) == 4 and set(linked_references) == expected_references, 'Reference quotation actions do not match the product lineup')
    selector = re.search(r'<select[^>]*id="f-configuration"[^>]*>.*?</select>', form.text, re.S)
    reference_options = Page(selector.group(0)).find('option') if selector else []
    check({o.get('value') for o in reference_options} == expected_references | {''}, 'Reference selector and product lineup differ')
    required = {a.get('name') for _, a in form.tags if 'required' in a}
    check(required == {'Name', 'Company', 'email', 'Requirement or specification link'}, f'Required form fields changed: {required}')
    check(bool(form.find('form', method='POST', action='https://formsubmit.co/quotes@farpointenergy.com')), 'Native form fallback missing')
    labels = {a.get('for') for a in form.find('label')}
    for tag, attrs in form.tags:
        if tag in {'input', 'textarea', 'select'} and attrs.get('type') != 'hidden':
            check(attrs.get('id') in labels or bool(attrs.get('aria-label')), f'Unlabelled form control: {attrs.get("id")}')
    sitemap = ET.fromstring((ROOT / 'sitemap.xml').read_text())
    urls = [node.text for node in sitemap.iter() if node.tag.endswith('loc')]
    check(not any(any(route in url for route in redirects | {'thanks.html', '404.html'}) for url in urls), 'Redirect/utility route in sitemap')
    for route in ['thanks.html', '404.html']:
        check(any(a.get('content', '').lower().startswith('noindex') for a in pages[route].find('meta', name='robots')), f'{route}: noindex missing')

    if '--skip-build' not in sys.argv:
        before = snapshot()
        subprocess.run([sys.executable, 'build.py'], cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
        check(before == snapshot(), 'Second build changed generated output')
    if failures:
        print('\n'.join('FAIL: ' + item for item in failures))
        return 1
    print(f'PASS: {len(pages)} routes; preserved navigation, diagram, founder, warranty and assets; in-page products, applications, redirect boundaries, labels and local links.')
    print('Reproducible build checked.' if '--skip-build' not in sys.argv else 'Build check skipped.')
    print('Browser layout, keyboard behavior and real form delivery require separate verification.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
