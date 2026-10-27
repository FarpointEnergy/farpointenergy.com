import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
export const PREVIEW_ORIGIN = 'https://farpoint-lead-review.farpointenergy.workers.dev';
export const PREPARED_PATH = '/quote.html?source=website&campaign=power&utm_medium=referral';
export const HTML_FILES = Object.freeze(['404.html','about.html','applications.html','contact.html','data-centers.html','delivery.html','distribution-transformers.html','index.html','manufacturing.html','markets.html','power-transformers.html','privacy.html','products.html','quality.html','quote.html','solar-storage.html','thanks.html']);
export const STATIC_FILES = Object.freeze([...HTML_FILES,'style.css','site.js','inquiry.js','tracker.js','analytics-config.js','favicon.svg','social-card.png','Farpoint_Energy_Product_Catalog_2026.pdf','Farpoint_Energy_Product_Catalog_2026_Solar_Storage_Edition.pdf']);
const hash = value => createHash('sha256').update(value).digest('hex');
const types = {html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',svg:'image/svg+xml',png:'image/png',pdf:'application/pdf',txt:'text/plain; charset=utf-8'};
const bannerText = 'Test site — synthetic details only. Test quotations go to Farpoint inbox.';
const preparedHref = PREPARED_PATH.replaceAll('&','&amp;');
const banner = `<aside aria-label="Synthetic test site" style="padding:12px 20px;background:#fff2ce;color:#182b3a;border-bottom:2px solid #a85b14;font:600 15px/1.5 system-ui;text-align:center">${bannerText} <a href="${preparedHref}" style="color:inherit;text-decoration:underline">Open synthetic form test</a></aside>`;
const helper = `<section aria-labelledby="preview-test-heading" style="margin-bottom:20px;padding:18px;border:2px solid #a85b14;background:#fff9e9;color:#182b3a"><h2 id="preview-test-heading" style="font-size:20px">Synthetic form test</h2><p>No real customer or project details. This uses the normal quotation form and sends a test message to quotes@farpointenergy.com only when you choose Send request.</p><p><a href="${preparedHref}">Open prepared test link</a> · <button id="preview-fill" type="button" class="btn">Fill synthetic test details</button></p><p id="preview-fill-status" role="status" aria-live="polite">The button fills a clearly marked fixture; it does not submit the form. Optional technical details stay collapsed for your review.</p></section>`;
const privacyOld = 'This static website is hosted on GitHub Pages and uses Google Fonts. Those services receive technical request information when your browser loads their resources. This website does not currently send inquiry analytics to a tracking service.';
const privacyNew = 'This synthetic test copy is hosted on Cloudflare Workers and uses Google Fonts. Those services receive technical request information when your browser loads their resources. Test analytics are enabled on this copy only. Browser-generated events are marked synthetic and sent to a collector on this same hostname, then retained in Farpoint’s private Cloudflare R2 storage. The collector does not assert a verified visitor IP address or identify an employer. It preserves admitted request bytes, including malformed test records, without a deletion schedule. Browser identifiers, session identifiers, allowlisted campaign codes and form-stage events support test correlation. Analytics events do not include your form answers. Browser storage holds these identifiers and pending events. When you submit, the normal form includes source and correlation identifiers with the synthetic business fields and sends them through FormSubmit to the Farpoint inbox. Use synthetic details only.';

export async function buildPreview() {
  const inputs = {};
  const assets = {};
  const manifestAssets = {};
  const core = await readFile(resolve(root,'analytics/collector/core.mjs'),'utf8');
  const wrapper = await readFile(resolve(here,'preview-wrapper.mjs'),'utf8');
  const helperScript = await readFile(resolve(here,'preview-fixture.js'),'utf8');
  const builder = await readFile(fileURLToPath(import.meta.url),'utf8');
  const configRaw = await readFile(resolve(root,'analytics-config.json'),'utf8');
  const config = JSON.parse(configRaw);
  if (config.enabled !== false) throw new Error('Preview source must have production tracking disabled');
  const previewConfig = {...config,enabled:true,synthetic:true,endpoint:PREVIEW_ORIGIN+'/v1/events',privacy_disclosure_version:'1',campaign_registry:{source:['website'],medium:['referral'],campaign:['power']}};
  function add(name, raw, sourceHash=null) {
    const bytes = Buffer.from(raw);
    const entry = {content_type:types[name.split('.').pop()],bytes:bytes.length,sha256:hash(bytes),base64:bytes.toString('base64')};
    if (!entry.content_type || Object.hasOwn(assets,'/'+name)) throw new Error('Invalid or duplicate static asset');
    assets['/'+name] = entry;
    manifestAssets['/'+name] = {content_type:entry.content_type,bytes:entry.bytes,sha256:entry.sha256,source_sha256:sourceHash,transformed:sourceHash!==entry.sha256};
  }
  for (const name of STATIC_FILES) {
    let raw = await readFile(resolve(root,name));
    inputs[name] = hash(raw);
    if (HTML_FILES.includes(name)) {
      let html = raw.toString('utf8');
      if (!html.includes('</head>') || !/<body\b[^>]*>/.test(html)) throw new Error('HTML shape changed: '+name);
      html = html.replace(/<meta name="robots"[^>]*>/g,'');
      html = html.replace('</head>','<meta name="robots" content="noindex,nofollow,noarchive">'+(name==='quote.html'?'<script src="preview-fixture.js" defer></script>':'')+'</head>');
      html = html.replace(/(<body\b[^>]*>)/, '$1'+banner);
      if (name === 'quote.html') {
        if (!html.includes('<form id="quote-form"')) throw new Error('Quotation form changed');
        html = html.replace('<form id="quote-form"', helper+'<form id="quote-form"');
      }
      if (name === 'privacy.html') {
        if (!html.includes(privacyOld)) throw new Error('Privacy source changed; review disclosure before building');
        html = html.replace(privacyOld, privacyNew);
      }
      raw = Buffer.from(html);
    } else if (name === 'analytics-config.js') {
      raw = Buffer.from('/* Synthetic review only. Production configuration is unchanged. */\nwindow.farpointAnalyticsConfig = Object.freeze('+JSON.stringify(previewConfig)+');\n');
    }
    add(name,raw,inputs[name]);
  }
  add('preview-fixture.js',helperScript,hash(helperScript));
  add('robots.txt','User-agent: *\nDisallow: /\n');
  const sourceHashes = {core:hash(core),wrapper:hash(wrapper),fixture:hash(helperScript),builder:hash(builder),config:hash(configRaw)};
  const sourceHash = hash(JSON.stringify({sourceHashes,inputs,manifestAssets,origin:PREVIEW_ORIGIN}));
  const version = 'farpoint-synthetic-review/1.0.0+'+sourceHash;
  const source = `const PREVIEW_ORIGIN=${JSON.stringify(PREVIEW_ORIGIN)};\nconst PREVIEW_BUILD_VERSION=${JSON.stringify(version)};\nconst PREVIEW_ASSETS=${JSON.stringify(assets)};\n${core}\n${wrapper}`;
  const manifest = {format_version:1,scope:'Synthetic-only website review; user-triggered normal RFQ; no production activation',origin:PREVIEW_ORIGIN,prepared_path:PREPARED_PATH,html_count:HTML_FILES.length,source_version:version,source_sha256:sourceHash,source_hashes:sourceHashes,source_files:inputs,assets:manifestAssets,worker_sha256:hash(source),worker_bytes:Buffer.byteLength(source),binding_names:['BUCKET'],public_export_enabled:false,verified_source_ip_enabled:false,production_files_modified:false,campaign_registry:previewConfig.campaign_registry};
  return {source,manifest,assets,previewConfig};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const destination = process.argv[2];
  if (!destination || !destination.startsWith('/')) throw new Error('Absolute artifact directory required');
  const {source,manifest} = await buildPreview();
  await mkdir(destination,{recursive:true});
  const output = resolve(destination,'review-'+manifest.source_sha256+'.mjs');
  const manifestPath = resolve(destination,'review-'+manifest.source_sha256+'.manifest.json');
  async function createOrMatch(path,content) {
    try { await writeFile(path,content,{flag:'wx'}); }
    catch(error) { if(error.code!=='EEXIST' || await readFile(path,'utf8')!==content) throw error; }
  }
  await createOrMatch(output,source);
  await createOrMatch(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  console.log(JSON.stringify({output,manifest:manifestPath,worker_sha256:manifest.worker_sha256,worker_bytes:manifest.worker_bytes,html_count:manifest.html_count,source_version:manifest.source_version}));
}
