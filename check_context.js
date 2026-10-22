const assert = require('assert');
const vm = require('vm');
const fs = require('fs');
const code = fs.readFileSync(require('path').join(__dirname, 'site.js'),'utf8');
class Element {
  constructor(attrs={}) {this.attrs={...attrs};this.listeners={};this.hidden=true;this.tagName='A';const classes=new Set();this.classList={add:x=>classes.add(x),remove:x=>classes.delete(x),contains:x=>classes.has(x),toggle:(x,on)=>on?classes.add(x):classes.delete(x)};}
  getAttribute(k){return this.attrs[k] ?? null}
  setAttribute(k,v){this.attrs[k]=v}
  addEventListener(k,fn){this.listeners[k]=fn}
  closest(q){return this.tagName==='A'&&q==='a[href]'?this:null}
  focus(){this.focused=true}
}
function setup(href,targets){
  const links=targets.map(h=>new Element({href:h}));
  const nav=new Element(),toggle=new Element({'aria-expanded':'false'}),menu=new Element();toggle.tagName='BUTTON';
  const listeners={},location={href},body={dataset:{}};
  const document={body,querySelectorAll:()=>links,querySelector:s=>s==='.nav'?nav:s==='.navbtn'?toggle:null,getElementById:id=>id==='site-menu'?menu:null};
  const window={addEventListener(k,fn){(listeners[k]??=[]).push(fn)},matchMedia:()=>({addEventListener(){}})};
  vm.runInNewContext(code,{document,window,location,URL,Element});
  return {links,nav,toggle,menu,body,change(url){location.href=url;for(const fn of listeners.hashchange||[])fn()},show(){for(const fn of listeners.pageshow||[])fn()}};
}
let cases=0;
for(const [fragment,product] of [['power','power'],['distribution','distribution']]) {
  const t=setup(`https://example.test/products.html?product=unsure&application=data-center&source=email&name=DoNotCopy#${fragment}`,['quote.html','#distribution',' #power','applications.html#storage','quote.html?product=unsure&application=industrial','products.html#power','https://external.test/quote.html','mailto:quotes@example.test']);
  let u=new URL(t.links[0].getAttribute('href'),'https://example.test');assert.equal(u.searchParams.get('product'),product);assert.equal(u.searchParams.get('application'),'data-center');assert.equal(u.searchParams.get('source'),'email');assert(!u.searchParams.has('name'));cases++;
  assert.equal(t.links[1].getAttribute('href'),'#distribution');assert.equal(t.links[2].getAttribute('href'),' #power');cases++;
  u=new URL(t.links[3].getAttribute('href'),'https://example.test');assert.equal(u.searchParams.get('application'),'storage');cases++;
  u=new URL(t.links[4].getAttribute('href'),'https://example.test');assert.equal(u.searchParams.get('product'),'unsure');assert.equal(u.searchParams.get('application'),'industrial');cases++;
  u=new URL(t.links[5].getAttribute('href'),'https://example.test');assert.equal(u.searchParams.get('product'),'power');cases++;
  assert.equal(t.links[6].getAttribute('href'),'https://external.test/quote.html');assert.equal(t.links[7].getAttribute('href'),'mailto:quotes@example.test');cases++;
}
for(const [fragment,application] of Object.entries({datacenter:'data-center',solar:'solar',storage:'storage',hybrid:'hybrid',utilities:'utility',industrial:'industrial',wind:'other',replacement:'other'})){
  const t=setup(`https://example.test/applications.html?product=distribution#${fragment}`,['quote.html','products.html#power']);
  for(const link of t.links){const u=new URL(link.getAttribute('href'),'https://example.test');assert.equal(u.searchParams.get('application'),application);cases++;}
  assert.equal(t.body.dataset.application,application);cases++;
}
let t=setup('https://example.test/products.html#distribution',['quote.html','quote.html?application=industrial']);
t.change('https://example.test/products.html#power');assert.equal(new URL(t.links[0].attrs.href,'https://example.test').searchParams.get('product'),'power');cases++;
t.change('https://example.test/products.html');assert.equal(new URL(t.links[0].attrs.href,'https://example.test').searchParams.get('product'),null);assert.equal(t.body.dataset.product,'unsure');cases++;
t=setup('https://example.test/applications.html?product=power&application=solar#storage',['quote.html']);t.change('https://example.test/applications.html?product=power&application=solar#hybrid');assert.equal(new URL(t.links[0].attrs.href,'https://example.test').searchParams.get('application'),'hybrid');cases++;
t=setup('https://example.test/applications.html?campaign=hybrid#hybrid',['products.html#distribution']);let productURL=new URL(t.links[0].attrs.href,'https://example.test');assert.equal(productURL.searchParams.get('application'),'hybrid');t=setup(productURL.href,['quote.html']);let inquiryURL=new URL(t.links[0].attrs.href,'https://example.test');assert.equal(inquiryURL.searchParams.get('application'),'hybrid');assert.equal(inquiryURL.searchParams.get('product'),'distribution');assert.equal(inquiryURL.searchParams.get('campaign'),'hybrid');cases++;
t=setup('https://example.test/quote.html?product=power&product=distribution&application=bad&source=buyer-name&campaign=private-token&email=private@example.test',['quote.html','quote.html?source=not-approved&application=solar&application=storage']);for(const link of t.links){assert.equal(new URL(link.attrs.href,'https://example.test').search,'');cases++;}
t=setup('https://example.test/products.html#distribution',['quote.html?application=solar&campaign=storage&custom=public-reference']);let u=new URL(t.links[0].attrs.href,'https://example.test');assert.equal(u.searchParams.get('custom'),'public-reference');assert.equal(u.searchParams.get('campaign'),'storage');cases++;
for(const reference of ['FP-MPT-138-50','FP-MPT-115-50','FP-MPT-138-100','FP-MPT-115-100']) {
  const context=setup('https://example.test/products.html?application=solar#distribution',[`quote.html?product=power&reference=${reference}#quote-form`]);
  const target=new URL(context.links[0].attrs.href,'https://example.test');assert.equal(target.searchParams.get('product'),'power');assert.equal(target.searchParams.get('reference'),reference);assert.equal(target.searchParams.get('application'),'solar');assert.equal(target.hash,'#quote-form');cases++;
}
t=setup('https://example.test/quote.html?reference=FP-MPT-138-50',['products.html#distribution']);assert(!new URL(t.links[0].attrs.href,'https://example.test').searchParams.has('reference'),'Reference does not follow unrelated navigation');cases++;
assert.equal(t.toggle.hidden,false);assert(t.nav.classList.contains('menu-ready'));assert.equal(t.toggle.getAttribute('aria-expanded'),'false');t.toggle.listeners.click();assert.equal(t.toggle.getAttribute('aria-expanded'),'true');assert(t.menu.classList.contains('is-open'));t.nav.listeners.keydown({key:'Escape'});assert.equal(t.toggle.getAttribute('aria-expanded'),'false');assert(t.toggle.focused);t.toggle.listeners.click();t.menu.listeners.click({target:t.links[0]});assert.equal(t.toggle.getAttribute('aria-expanded'),'false');t.toggle.listeners.click();t.show();assert.equal(t.toggle.getAttribute('aria-expanded'),'false');cases++;
function redirect(file,query='',hash='') {
  const html=fs.readFileSync(require('path').join(__dirname,file),'utf8');
  const script=html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const href=`https://example.test/${file}${query}${hash}`,input=new URL(href);
  let result;
  vm.runInNewContext(script,{URL,URLSearchParams,location:{href,pathname:input.pathname,search:input.search,hash:input.hash,replace:v=>result=new URL(v)}});
  return result;
}
for(const [file,path,hash] of [['markets.html','/applications.html',''],['contact.html','/quote.html',''],['power-transformers.html','/products.html','#power'],['distribution-transformers.html','/products.html','#distribution'],['data-centers.html','/applications.html','#datacenter'],['solar-storage.html','/applications.html','#solar']]) {
  let u=redirect(file,'?product=distribution&application=data-center&source=email&campaign=storage&email=private@example.test');assert.equal(u.pathname,path);assert.equal(u.hash,hash);assert.equal(u.searchParams.get('product'),'distribution');assert.equal(u.searchParams.get('application'),'data-center');assert.equal(u.searchParams.get('source'),'email');assert.equal(u.searchParams.get('campaign'),'storage');assert(!u.searchParams.has('email'));cases++;
  u=redirect(file,'?product=power&product=distribution&application=invalid&source=private-name&campaign=private-customer-code');assert.equal(u.search,'');cases++;
}
for(const hash of ['#utilities','#solar','#storage','#hybrid','#datacenter','#industrial','#wind','#replacement']){assert.equal(redirect('markets.html','',hash).hash,hash);cases++;}
assert.equal(redirect('markets.html','','#private-name').hash,'');assert.equal(redirect('solar-storage.html','?application=storage').hash,'#storage');cases+=2;
console.log(`PASS: ${cases} context/navigation/redirect cases. Explicit destinations preserved, section inference fresh, fragment links untouched, legacy anchors retained, unknown/duplicate context excluded, no freeform propagation, keyboard/toggle/reset behavior valid. No browser or network used.`);
