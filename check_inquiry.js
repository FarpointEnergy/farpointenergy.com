const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const script = fs.readFileSync(require('path').join(__dirname, 'inquiry.js'), 'utf8');
const markup = fs.readFileSync(require('path').join(__dirname, 'quote.html'), 'utf8');
const namedControls = Array.from(markup.matchAll(/<(input|select|textarea)\b([^>]*)>/g), match => {
  const attrs=Object.fromEntries(Array.from(match[2].matchAll(/([\w-]+)="([^"]*)"/g), attr=>[attr[1],attr[2]]));
  return attrs.name ? attrs : null;
}).filter(Boolean);
function element() {
  return {children:[], _text:'', get textContent(){return this._text+this.children.map(child=>typeof child==='string'?child:child.textContent).join('')},set textContent(value){this._text=value;this.children=[]},append(...children){this.children.push(...children)}};
}
function setup({response={ok:true, success:true}, search='', native=false, thanks=false, marker=null, deferred=false, pageOnly=false, path='/quote.html', hash='', analyticsThrows=false, storageDenied=false, requestTimeout=false, initialValues={}}={}) {
  const listeners={}, elementListeners={}, windowListeners={}, events=[], calls=[], stored=new Map(marker ? [['farpoint-inquiry-accepted', JSON.stringify(marker)]] : []);
  const ids={};
  for (const id of new Set([...namedControls.map(control=>control.id).filter(Boolean),'f-configuration-hint','configuration-summary','quote-submit','quote-status','thanks-heading','thanks-message','thanks-neutral'])) ids[id]=Object.assign(element(),{value:'',type:'text',hidden:true,disabled:false,dataset:{},addEventListener(name,fn){elementListeners[`${id}:${name}`]=fn},setCustomValidity(v){this.customError=v},setAttribute(){},removeAttribute(){},focus(){}});
  ids['f-name'].value='Synthetic Test'; ids['f-company'].value='Example'; ids['f-email'].value='synthetic@example.com'; ids['f-requirement'].value='Private synthetic requirement'; ids['f-product'].value='unsure';
  ids['f-rating-unit'].value='kVA';ids['f-primary-unit'].value=ids['f-secondary-unit'].value='kV';
  ids['f-source'].type='hidden'; ids['f-campaign'].type='hidden'; ids['f-source'].disabled=ids['f-campaign'].disabled=true;
  ids['f-configuration'].options=['','FP-MPT-138-50','FP-MPT-115-50','FP-MPT-138-100','FP-MPT-115-100'].map(value=>({value,textContent:value}));
  ids['f-configuration-hint'].textContent='An optional starting point for power-transformer design review. Your project requirements determine the final specification.';
  for (const [id,value] of Object.entries(initialValues)) ids[id].value=value;
  const form={elements:{'Transformer category':ids['f-product'],Application:ids['f-application']},dataset:{ajaxAction:'https://formsubmit.co/ajax/quotes@farpointenergy.com',thanks:'thanks.html'},querySelectorAll(){return Object.entries(ids).filter(([id])=>id.startsWith('f-')).map(([,field])=>field)},addEventListener(k,f){listeners[k]=f},reportValidity(){return !['f-name','f-company','f-requirement'].some(id=>ids[id].customError)},setAttribute(){},removeAttribute(){}};
  let resolveFetch;
  const fetch=async(url,options)=>{calls.push({url,options}); if(deferred) await new Promise(r=>resolveFetch=r); if(requestTimeout) await new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Object.assign(new Error('Aborted'),{name:'AbortError'})),{once:true})); if(response instanceof Error) throw response; return {ok:response.ok,json:async()=>{if(response.invalidJSON) throw new SyntaxError('Invalid JSON');return Object.hasOwn(response,'body')?response.body:{success:response.success}}}};
  const location={pathname:thanks?'/thanks.html':path,search,hash,assign(v){this.assigned=v}};
  const attachmentLink={dataset:{email:'quotes@farpointenergy.com'}};
  const ctx={document:{body:{dataset:{}},createElement:()=>element(),getElementById(id){return id==='quote-form'?(thanks||pageOnly?null:form):ids[id]},querySelector(){return thanks?{}:null},querySelectorAll(){return [attachmentLink]},addEventListener(){}},location,window:{fetch:native?undefined:fetch,FormData:true,AbortController,addEventListener:(name,fn)=>windowListeners[name]=fn,farpointAnalytics:(name,payload)=>{if(analyticsThrows)throw new Error('Analytics unavailable');events.push({name,payload})}},fetch,FormData:class {constructor(){assert.equal(ids['f-name'].disabled,false,'Payload must be captured before fields are disabled');this.values=namedControls.filter(control=>!control.id||!ids[control.id].disabled).map(control=>[control.name,control.id?ids[control.id].value:control.value||''])}entries(){return this.values[Symbol.iterator]()}},AbortController,URLSearchParams,setTimeout:requestTimeout?(fn,ms)=>{assert.equal(ms,25000);return setTimeout(fn,0)}:setTimeout,clearTimeout,Date,sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>{if(storageDenied)throw new Error('Storage unavailable');stored.set(k,v)},removeItem:k=>stored.delete(k)},console};
  vm.runInNewContext(script,ctx);
  return {ids,listeners,elementListeners,windowListeners,events,calls,location,stored,attachmentLink,submit:()=>listeners.submit({preventDefault(){}}),resolve:()=>resolveFetch()};
}
function assertEmailFallback(t) {
  const links=t.ids['quote-status'].children.filter(child=>typeof child==='object');
  assert.equal(links.length,1,'Failure status includes one direct email fallback');
  assert.equal(links[0].href,'mailto:quotes@farpointenergy.com');
  assert.equal(links[0].textContent,'quotes@farpointenergy.com');
  assert(t.ids['quote-status'].textContent.includes('Your entries are still here')||t.ids['quote-status'].textContent.includes('your entries are still here'));
}
(async()=>{
  let t=setup({search:'?product=distribution&application=data-center&source=private-customer&campaign=distribution'});
  assert.equal(t.ids['f-product'].value,'distribution'); assert.equal(t.ids['f-application'].value,'data-center'); assert(t.ids['f-source'].disabled); assert(!t.ids['f-campaign'].disabled);
  await t.submit(); assert.equal(t.calls.length,1); assert.equal(t.location.assigned,'thanks.html'); assert(t.stored.has('farpoint-inquiry-accepted'));
  assert(!JSON.parse(t.calls[0].options.body)['Rating unit']);
  for(const event of t.events){assert.deepEqual(Object.keys(event.payload).sort(),['application','product']); assert(!JSON.stringify(event).includes('synthetic'));assert(!JSON.stringify(event).includes('Private'));}
  assert.deepEqual(Object.keys(JSON.parse(t.stored.get('farpoint-inquiry-accepted'))).sort(),['accepted','at']);
  await t.submit(); assert.equal(t.calls.length,1);
  t=setup({search:'?product=power&product=distribution&application=%3Cscript%3E&source=email&campaign=private-name'}); assert.equal(t.ids['f-product'].value,'unsure');assert.equal(t.ids['f-application'].value,'');assert(!t.ids['f-source'].disabled);assert(t.ids['f-campaign'].disabled);
  t=setup({search:'?product=distribution&application=hybrid&campaign=hybrid'});assert.equal(t.ids['f-application'].value,'hybrid');assert.equal(t.ids['f-campaign'].value,'hybrid');await t.submit();assert(t.events.some(e=>e.name==='rfq_submit_success'&&e.payload.application==='hybrid'));
  for(const reference of ['FP-MPT-138-50','FP-MPT-115-50','FP-MPT-138-100','FP-MPT-115-100']) {
    t=setup({search:`?reference=${reference}`,initialValues:{'f-rating':'75','f-primary':'161','f-secondary':'33'}});
    assert.equal(t.ids['f-configuration'].value,reference);assert.equal(t.ids['f-product'].value,'power');
    assert.equal(t.ids['configuration-summary'].hidden,false);assert(t.ids['configuration-summary'].textContent.includes(reference));assert(t.ids['configuration-summary'].textContent.includes('Starting from:'));
    assert.equal(t.ids['f-rating'].value,'75');assert.equal(t.ids['f-primary'].value,'161');assert.equal(t.ids['f-secondary'].value,'33');
    await t.submit();assert.equal(JSON.parse(t.calls[0].options.body)['Power-transformer reference configuration'],reference);
    assert(!JSON.stringify(t.events).includes(reference),'Configuration references stay out of analytics');
  }
  for(const search of ['?reference=%3Cscript%3E','?reference=FP-MPT-138-50&reference=FP-MPT-115-50','?reference=FP-MPT-138-50&reference=FP-MPT-138-50']) {
    t=setup({search});assert.equal(t.ids['f-configuration'].value,'');assert.equal(t.ids['f-product'].value,'unsure');assert(t.ids['configuration-summary'].hidden);
  }
  t=setup({search:'?product=distribution&reference=FP-MPT-138-50'});assert.equal(t.ids['f-product'].value,'distribution');assert.equal(t.ids['f-configuration'].value,'');assert(t.ids['f-configuration'].disabled);await t.submit();assert(!Object.hasOwn(JSON.parse(t.calls[0].options.body),'Power-transformer reference configuration'));
  t=setup({initialValues:{'f-rating':'85','f-primary':'230','f-secondary':'34.5'}});t.ids['f-configuration'].value='FP-MPT-138-100';t.elementListeners['f-configuration:change']();assert.equal(t.ids['f-product'].value,'power');assert.equal(t.ids['f-rating'].value,'85');assert.equal(t.ids['f-primary'].value,'230');assert.equal(t.ids['f-secondary'].value,'34.5');
  assert.equal(t.ids['configuration-summary'].hidden,false);assert(t.ids['configuration-summary'].textContent.includes('FP-MPT-138-100'));
  t.ids['f-configuration'].value='';t.elementListeners['f-configuration:change']();assert(t.ids['configuration-summary'].hidden);assert.equal(t.ids['configuration-summary'].textContent,'');
  t.ids['f-configuration'].value='FP-MPT-115-50';t.elementListeners['f-configuration:change']();assert(t.ids['configuration-summary'].textContent.includes('FP-MPT-115-50'));
  t.ids['f-product'].value='distribution';t.elementListeners['f-product:change']();assert.equal(t.ids['f-configuration'].value,'');assert(t.ids['f-configuration'].disabled);assert(t.ids['f-configuration-hint'].textContent.includes('Distribution transformers'));
  assert(t.ids['configuration-summary'].hidden);assert.equal(t.ids['configuration-summary'].textContent,'');
  t.ids['f-product'].value='unsure';t.elementListeners['f-product:change']();assert.equal(t.ids['f-configuration'].disabled,false);assert.equal(t.ids['f-configuration'].value,'');assert(t.ids['f-configuration-hint'].textContent.includes('optional starting point'));
  t=setup({native:true,search:'?reference=FP-MPT-115-100'});assert.equal(t.listeners.submit,undefined);assert.equal(t.ids['f-configuration'].value,'FP-MPT-115-100');
  for(const success of [false,'false']) {t=setup({response:{ok:false,success}});await t.submit();assert.equal(t.ids['quote-status'].dataset.state,'failed');assert.equal(t.ids['quote-submit'].disabled,false);assertEmailFallback(t);await t.submit();assert.equal(t.calls.length,2);assertEmailFallback(t);}
  for(const response of [{ok:true},{ok:false,success:true},{ok:true,body:null},{ok:true,invalidJSON:true},new Error('network ended')]){t=setup({response});await t.submit();assert.equal(t.ids['quote-status'].dataset.state,'uncertain');assertEmailFallback(t);await t.submit();assert.equal(t.calls.length,1);assert.equal(t.ids['f-requirement'].value,'Private synthetic requirement');assert(!t.events.some(e=>e.name==='rfq_submit_success'));}
  t=setup({requestTimeout:true});await t.submit();assert.equal(t.ids['quote-status'].dataset.state,'uncertain');assertEmailFallback(t);assert(t.calls[0].options.signal.aborted);await t.submit();assert.equal(t.calls.length,1,'A timeout cannot cause duplicate resubmission');
  const fullValues={'f-name':'QA Name','f-company':'QA Company & Partners','f-email':'synthetic@example.com','f-requirement':'TEST ONLY — 2 units\nPreserve every field & <literal> text.','f-product':'power','f-application':'solar','f-configuration':'FP-MPT-138-50','f-quantity':'2','f-rating':'50','f-rating-unit':'MVA','f-primary':'138','f-primary-unit':'kV','f-secondary':'34500','f-secondary-unit':'V','f-delivery':'2027 Q4 — test only','f-energization':'2028 Q1 — test only','f-location':'Synthetic location','f-reference':'QA-FULL-FIELDS','f-phone':'+1 202 555 0100','f-details':'TEST ONLY\nAdditional information with “quotes” & symbols.'};
  for(const response of [{ok:true,success:true},{ok:false,success:false},new Error('network ended')]) {
    t=setup({response,search:'?source=website&campaign=solar',initialValues:fullValues});await t.submit();
    const payload=JSON.parse(t.calls[0].options.body);
    for(const [id,value] of Object.entries(fullValues)) {
      const control=namedControls.find(control=>control.id===id);assert(control,`${id} must remain in the actual form`);
      assert.equal(payload[control.name],value,`${control.name} must be preserved in the payload`);
      assert.equal(t.ids[id].value,value,`${control.name} must remain in the form`);
      assert.equal(t.ids[id].disabled,response.success===true,`${control.name} must remain editable after an unsuccessful submission`);
    }
    assert.equal(payload.Source,'website');assert.equal(payload.Campaign,'solar');assert.equal(payload._subject,'Quotation request — QA-FULL-FIELDS');
  }
  t=setup({response:{ok:true,success:'true'}});await t.submit();assert.equal(t.ids['quote-status'].dataset.state,'accepted');
  t=setup({deferred:true}); const pending=t.submit(); await t.submit(); assert.equal(t.calls.length,1);assert.equal(t.ids['quote-submit'].disabled,true);assert(t.ids['f-requirement'].disabled);assert(t.ids['f-product'].disabled);assert(t.ids['f-reference'].disabled);assert.equal(JSON.parse(t.calls[0].options.body)['Requirement or specification link'],'Private synthetic requirement');t.resolve();await pending;assert(t.ids['f-requirement'].disabled,'Accepted fields remain locked');
  for(const response of [{ok:false,success:false},new Error('network ended')]){t=setup({deferred:true,response,search:'?campaign=hybrid'});t.ids['f-phone'].disabled=true;const pending=t.submit();assert(t.ids['f-name'].disabled);assert(t.ids['f-source'].disabled);assert.equal(t.ids['f-campaign'].disabled,false);t.resolve();await pending;assert.equal(t.ids['f-name'].disabled,false);assert.equal(t.ids['f-requirement'].disabled,false);assert(t.ids['f-phone'].disabled,'Restore prior editable disabled state');assert(t.ids['f-source'].disabled,'Preserve disabled hidden state');assert.equal(t.ids['f-campaign'].disabled,false,'Preserve enabled hidden state');assert.equal(t.ids['f-requirement'].value,'Private synthetic requirement');}
  t=setup();t.ids['f-name'].value=' ';await t.submit();assert.equal(t.calls.length,0);
  const details={open:false},field={id:'test-field',validationMessage:'Please enter a positive value.',closest(){return details},setAttribute(k,v){this[k]=v}};
  t.ids['test-field-error']={};t.listeners.invalid({target:field});assert(details.open);assert.equal(field['aria-invalid'],'true');assert.equal(t.ids['test-field-error'].textContent,field.validationMessage);
  t=setup({native:true});assert.equal(t.listeners.submit,undefined);
  t=setup({thanks:true});assert.notEqual(t.ids['thanks-heading'].textContent,'Your request was submitted.');
  t=setup({thanks:true,marker:{accepted:true,at:Date.now()}});assert.equal(t.ids['thanks-heading'].textContent,'Your request was submitted.');assert.equal(t.stored.size,0);
  t=setup({thanks:true,marker:{accepted:true,at:Date.now()-11*60*1000}});assert.notEqual(t.ids['thanks-heading'].textContent,'Your request was submitted.');
  t=setup({analyticsThrows:true});await t.submit();assert.equal(t.ids['quote-status'].dataset.state,'accepted');
  t=setup({storageDenied:true});await t.submit();assert.equal(t.ids['quote-status'].dataset.state,'accepted');assert.equal(t.location.assigned,undefined);
  t=setup();t.ids['f-reference'].value='RFQ &cc=other@example.com\r\nExtra';t.elementListeners['f-reference:input']();assert(!t.attachmentLink.href.includes('&cc='));assert(!decodeURIComponent(t.attachmentLink.href).includes('\r'));assert(decodeURIComponent(t.attachmentLink.href).includes('RFQ &cc='));
  t=setup({pageOnly:true,path:'/products.html',hash:'#distribution'});assert.equal(t.events[0].name,'product_path_view');assert.equal(t.events[0].payload.product,'distribution');t.location.hash='#power';t.windowListeners.hashchange();assert.equal(t.events[1].payload.product,'power');t.location.hash='#private-specification';t.windowListeners.hashchange();assert.equal(t.events.length,2);
  const python=fs.readFileSync(require('path').join(__dirname,'inquiry.py'),'utf8');assert(!python.includes('name="_next"'),'Native POST must show the provider result');assert(python.includes('data-thanks="thanks.html"'),'AJAX retains its accepted-only local redirect');
  console.log('PASS: allowed/hybrid/reference prefills, safe reference selection/payload and category changes without overwriting electrical inputs, unsafe/duplicate query rejection, explicit acceptance/failure, rejection retry, clickable error-state email fallback, uncertain/network/malformed response/25-second timeout lockout, every customer field preserved in payload and after failure, in-flight field freeze/duplicate guard, payload before freeze, prior disabled states/values restored, validation, native provider result, neutral/accepted/expired thanks, safe subjects, section tracking, isolated analytics/storage failure, no inquiry data in analytics or storage. No network requests made.');
})().catch(e=>{console.error(e);process.exitCode=1});
