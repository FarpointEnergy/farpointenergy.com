#!/usr/bin/env python3
"""Focused static-site checks. Run after python3 build.py."""
import hashlib
from html.parser import HTMLParser
import pathlib
import subprocess
import sys
from urllib.parse import urlsplit, unquote
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).parent
BASELINE = '46a24e8df1537f85d9d379d96f99d0305b65465e'
class Page(HTMLParser):
    def __init__(self, text):
        super().__init__(convert_charrefs=True)
        self.tags=[]; self.ids=set(); self.duplicate_ids=[]; self.feed(text)
    def handle_starttag(self, tag, attrs):
        a=dict(attrs); self.tags.append((tag,a))
        if a.get('id'):
            if a['id'] in self.ids: self.duplicate_ids.append(a['id'])
            self.ids.add(a['id'])
    def find(self,tag,**attrs):
        return [a for t,a in self.tags if t==tag and all(a.get(k)==v for k,v in attrs.items())]

def baseline(path):
    return subprocess.check_output(['git','show',f'{BASELINE}:{path}'],cwd=ROOT)

def snapshots():
    return {p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.iterdir() if p.is_file() and p.suffix in {'.html','.css','.js','.xml','.txt','.md','.svg','.png'}}

def main():
    errors=[]
    def check(ok,message):
        if not ok: errors.append(message)
    pages={p.name:Page(p.read_text()) for p in ROOT.glob('*.html')}
    redirects={'contact.html','markets.html'}
    for name,page in pages.items():
        check(not page.duplicate_ids,f'{name}: duplicate IDs {page.duplicate_ids}')
        check(len(page.find('link',rel='canonical'))==1,f'{name}: canonical missing')
        if name not in redirects:
            check(bool(page.find('meta',name='description')),f'{name}: description missing')
            check(bool(page.find('meta',property='og:image')),f'{name}: sharing image missing')
            check(bool(page.find('main',id='main')),f'{name}: main landmark missing')
            check(len(page.find('h1'))==1,f'{name}: must have one h1')
        for tag,a in page.tags:
            target=a.get('href') if tag in {'a','link'} else a.get('src') if tag in {'script','img'} else None
            if not target: continue
            u=urlsplit(target)
            if u.scheme or u.netloc: continue
            path=unquote(u.path) or name
            check((ROOT/path).exists(),f'{name}: missing local target {target}')
            if u.fragment and path in pages:
                check(u.fragment in pages[path].ids,f'{name}: broken anchor {target}')
            check(not path.lower().endswith('.pdf'),f'{name}: catalog promoted')
    for anchor in ['utilities','solar','storage','hybrid','datacenter','industrial','wind','replacement']:
        check(anchor in pages['applications.html'].ids,f'Legacy anchor missing: {anchor}')
    for route in ['power-transformers.html','distribution-transformers.html','data-centers.html','solar-storage.html','privacy.html']:
        check(route in pages,f'Route missing: {route}')
    for route in ['index.html','products.html']:
        links={a.get('href') for a in pages[route].find('a')}
        check({'power-transformers.html','distribution-transformers.html'}<=links,f'{route}: product path missing')
    form=pages['quote.html']; required={a.get('name') for t,a in form.tags if 'required' in a}
    check(required=={'Name','Company','email','Requirement or specification link'},f'Required fields changed: {required}')
    check(bool(form.find('form',method='POST',action='https://formsubmit.co/quotes@farpointenergy.com')),'Native POST fallback missing')
    labels={a.get('for') for a in form.find('label')}
    for t,a in form.tags:
        if t in {'input','textarea','select'} and a.get('type')!='hidden':
            check(a.get('id') in labels or bool(a.get('aria-label')),f'Unlabelled form control {a}')
    for route in ['thanks.html','404.html']:
        check(bool(pages[route].find('meta',name='robots',content='noindex,follow')),f'{route}: noindex missing')
    sitemap=ET.fromstring((ROOT/'sitemap.xml').read_text())
    urls=[node.text for node in sitemap.iter() if node.tag.endswith('loc')]
    check(not any('thanks' in u or '404' in u for u in urls),'Utility pages in sitemap')
    old={};exec(baseline('content.py'),old)
    now={};exec((ROOT/'content.py').read_text(),now)
    for key in ['founder_name','founder_title','founder','advisors']:
        check(old['ABOUT'][key]==now['ABOUT'][key],f'Founder field changed: {key}')
    def founder(text):
        start=text.index('<section',text.index('</header>'))
        end=text.index('</section>',start)+len('</section>')
        return text[start:end]
    check(founder(baseline('about.html').decode())==founder((ROOT/'about.html').read_text()),'Complete founder section changed')
    for filename in subprocess.check_output(['git','ls-tree','--name-only',BASELINE],cwd=ROOT,text=True).splitlines():
        if filename.endswith('.pdf') or filename in {'CNAME','.nojekyll','favicon.svg'}:
            check(baseline(filename)==(ROOT/filename).read_bytes(),f'Preserved asset changed: {filename}')
    before=snapshots()
    subprocess.run([sys.executable,'build.py'],cwd=ROOT,check=True,stdout=subprocess.DEVNULL)
    check(before==snapshots(),'Second build changed generated files')
    if errors:
        for e in errors: print('FAIL:',e)
        return 1
    print(f'PASS: {len(pages)} HTML routes; local links/anchors, labels, required fields, metadata, exact founder/PDF preservation, reproducible build.')
    print('Browser layout and real form delivery must be verified separately before release.')
    return 0
if __name__=='__main__': sys.exit(main())
