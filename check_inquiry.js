const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const script = fs.readFileSync(require('path').join(__dirname, 'inquiry.js'), 'utf8');
function setup({response={ok:true, success:true}, search='', native=false, thanks=false, marker=null, deferred=false}={}) {
  const listeners={}, events=[], calls=[], stored=new Map(marker ? [['farpoint-inquiry-accepted', JSON.stringify(marker)]] : []);
  const ids={};
  for (const id of ['f-name','f-company','f-email','f-requirement','f-product','f-application','f-source','f-campaign','f-reference','quote-submit','quote-status','thanks-heading','thanks-message','thanks-neutral']) ids[id]={value:'',type:'text',hidden:true,disabled:false,dataset:{},textContent:'',addEventListener(){},setCustomValidity(v){this.customError=v},setAttribute(){},removeAttribute(){},focus(){}};
  ids['f-name'].value='Synthetic Test'; ids['f-company'].value='Example'; ids['f-email'].value='synthetic@example.com'; ids['f-requirement'].value='Private synthetic requirement'; ids['f-product'].value='unsure';
  ids['f-source'].type='hidden'; ids['f-campaign'].type='hidden'; ids['f-source'].disabled=ids['f-campaign'].disabled=true;
  const form={elements:{'Transformer category':ids['f-product'],Application:ids['f-application']},dataset:{ajaxAction:'https://formsubmit.co/ajax/quotes@farpointenergy.com',thanks:'thanks.html'},addEventListener(k,f){listeners[k]=f},reportValidity(){return !['f-name','f-company','f-requirement'].some(id=>ids[id].customError)},setAttribute(){},removeAttribute(){}};
  let resolveFetch;
  const fetch=async(url,options)=>{calls.push({url,options}); if(deferred) await new Promise(r=>resolveFetch=r); if(response instanceof Error) throw response; return {ok:response.ok,json:async()=>({success:response.success})}};
  const location={pathname:thanks?'/thanks.html':'/quote.html',search,assign(v){this.assigned=v}};
  const ctx={document:{body:{dataset:{}},getElementById(id){return id==='quote-form'?(thanks?null:form):ids[id]},querySelector(){return thanks?{}:null},querySelectorAll(){return []},addEventListener(){}},location,window:{fetch:native?undefined:fetch,FormData:true,AbortController,farpointAnalytics:(name,payload)=>events.push({name,payload})},fetch,FormData:class {entries(){return [['Name','Synthetic Test'],['email','synthetic@example.com'],['Requirement or specification link','Private synthetic requirement'],['Rating value',''],['Rating unit','kVA']][Symbol.iterator]()}},AbortController,URLSearchParams,setTimeout,clearTimeout,Date,sessionStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)},console};
  vm.runInNewContext(script,ctx);
  return {ids,listeners,events,calls,location,stored,submit:()=>listeners.submit({preventDefault(){}}),resolve:()=>resolveFetch()};
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
  for(const success of [false,'false']) {t=setup({response:{ok:false,success}});await t.submit();assert.equal(t.ids['quote-status'].dataset.state,'failed');assert.equal(t.ids['quote-submit'].disabled,false);await t.submit();assert.equal(t.calls.length,2);}
  for(const response of [{ok:true},{ok:false,success:true},new Error('network ended')]){t=setup({response});await t.submit();assert.equal(t.ids['quote-status'].dataset.state,'uncertain');await t.submit();assert.equal(t.calls.length,1);assert.equal(t.ids['f-requirement'].value,'Private synthetic requirement');assert(!t.events.some(e=>e.name==='rfq_submit_success'));}
  t=setup({response:{ok:true,success:'true'}});await t.submit();assert.equal(t.ids['quote-status'].dataset.state,'accepted');
  t=setup({deferred:true}); const pending=t.submit(); await t.submit(); assert.equal(t.calls.length,1);assert.equal(t.ids['quote-submit'].disabled,true);t.resolve();await pending;
  t=setup();t.ids['f-name'].value=' ';await t.submit();assert.equal(t.calls.length,0);
  const details={open:false},field={id:'test-field',validationMessage:'Please enter a positive value.',closest(){return details},setAttribute(k,v){this[k]=v}};
  t.ids['test-field-error']={};t.listeners.invalid({target:field});assert(details.open);assert.equal(field['aria-invalid'],'true');assert.equal(t.ids['test-field-error'].textContent,field.validationMessage);
  t=setup({native:true});assert.equal(t.listeners.submit,undefined);
  t=setup({thanks:true});assert.notEqual(t.ids['thanks-heading'].textContent,'Your request was submitted.');
  t=setup({thanks:true,marker:{accepted:true,at:Date.now()}});assert.equal(t.ids['thanks-heading'].textContent,'Your request was submitted.');assert.equal(t.stored.size,0);
  t=setup({thanks:true,marker:{accepted:true,at:Date.now()-11*60*1000}});assert.notEqual(t.ids['thanks-heading'].textContent,'Your request was submitted.');
  console.log('PASS: allowed prefills, disallowed/duplicate query rejection, bool/string explicit success/failure, known rejection retry, uncertain response/network lockout, duplicate in-flight guard, retained fields, whitespace validation, revealed optional errors, native fallback, neutral/accepted/expired thanks, no inquiry data in analytics or storage. No network requests made.');
})().catch(e=>{console.error(e);process.exitCode=1});
