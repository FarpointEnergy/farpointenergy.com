import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const core = await readFile(new URL('../../collector/core.mjs', import.meta.url), 'utf8');
const probe = await readFile(new URL('./ip-probe.mjs', import.meta.url), 'utf8');
const wrapper = await readFile(new URL('./wrapper.mjs', import.meta.url), 'utf8');
const module = await import('data:text/javascript;base64,' + Buffer.from("const BUILD_SOURCE_VERSION='synthetic-cloudflare-wrapper-test';\n" + core + '\n' + probe + '\n' + wrapper).toString('base64'));
const worker = module.default;
const host = 'synthetic-farpoint.example.invalid';
const origin = 'https://farpointenergy.com';
const stores = [];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

class Bucket {
  objects = new Map(); operations = []; failWrites = false;
  constructor() { stores.push(this); }
  async put(key, bytes, options) {
    this.operations.push({operation: 'put', key});
    assert.deepEqual(options.onlyIf, {etagDoesNotMatch: '*'});
    if (this.failWrites) throw new Error('synthetic-private-provider-error');
    if (this.objects.has(key)) return null;
    const object = {bytes: new Uint8Array(bytes), etag: randomUUID(), customMetadata: options.customMetadata};
    this.objects.set(key, object); return {etag: object.etag};
  }
  async head() { throw new Error('public collector must not read'); }
  async get() { throw new Error('public collector must not read'); }
  async list() { throw new Error('public collector must not enumerate'); }
}

function request({path='/v1/events', method='POST', body='{"synthetic":true}', headers={}, cf=true, hostname=host}={}) {
  const req = new Request(`https://${hostname}${path}`, {
    method,
    headers: {Origin: origin, 'Content-Type': 'application/json', ...headers},
    ...(!['GET','HEAD'].includes(method) ? {body} : {})
  });
  if (cf) Object.defineProperty(req, 'cf', {value: {colo: 'SYN', asn: 0}});
  return req;
}
function enabled(bucket=new Bucket()) {
  return {BUCKET: bucket, CLOUDFLARE_DIRECT_IP_VERIFIED: '1', CLOUDFLARE_VERIFIED_IP_HOSTNAME: host};
}
async function receipt(req, env) {
  const result = await worker.fetch(req, env);
  assert.equal(result.status, 202);
  const ack = await result.json();
  const entries = [...env.BUCKET.objects.entries()];
  const [key, value] = entries.find(([key]) => key.endsWith('/' + ack.receipt_id + '.json'));
  assert.equal(digest(value.bytes), value.customMetadata.sha256);
  return {key, record: JSON.parse(new TextDecoder().decode(value.bytes)), ack};
}

test('public /mcp is unconditionally denied without touching storage or requiring a binding', async () => {
  const env = {OWNER_USER_ID: 'synthetic-owner', CURSOR_HMAC_KEY: 'synthetic-secret-at-least-thirty-two-bytes', GATEWAY_IDENTITY_VERIFIED: '1', PRIVATE_CANDIDATE_BOOTSTRAP: '1', PRIVATE_OWNER_EXPORT_ENABLED: '1'};
  for (const method of ['GET','HEAD','POST','OPTIONS','PUT','PATCH','DELETE']) {
    const result = await worker.fetch(request({path:'/mcp',method,headers:{'oai-authenticated-user-id':'synthetic-owner',Authorization:'Bearer synthetic-bypass'}}), env);
    assert.equal(result.status, 403);
    assert.match(result.headers.get('cache-control'), /private, no-store/);
    const text = await result.text();
    assert(!text.includes('synthetic-owner'));
    assert(!text.includes('synthetic-secret'));
    assert(!text.includes('tools'));
  }
});

test('unknown, encoded and trailing-slash export routes expose no private operations', async () => {
  const env = enabled();
  for (const path of ['/mcp/','/%6dcp','/records','/receipts/2026/10/26/guessed.json','/debug']) {
    assert.equal((await worker.fetch(request({path}), env)).status, 404);
  }
  assert.deepEqual(env.BUCKET.operations, []);
});

test('default gate retains bodies while source IP stays unavailable', async () => {
  const env = {BUCKET: new Bucket()};
  const {record} = await receipt(request({headers:{'CF-Connecting-IP':'203.0.113.4'}}), env);
  assert.deepEqual(record.source_ip, {status:'unavailable', provenance:'unverified', address:null});
});

test('only exact gate string plus the tested hostname enables source-IP selection', () => {
  for (const flag of [undefined, null, false, true, 0, 1, 'true', 'false', '0', '01']) {
    assert.equal(module.cloudflareDirectSourceIp(request({headers:{'CF-Connecting-IP':'203.0.113.4'}}), {...enabled(),CLOUDFLARE_DIRECT_IP_VERIFIED:flag}), null);
  }
  for (const verifiedHost of [undefined, '', 'other.example.invalid', host+':443', host.toUpperCase()]) {
    assert.equal(module.cloudflareDirectSourceIp(request({headers:{'CF-Connecting-IP':'203.0.113.4'}}), {...enabled(),CLOUDFLARE_VERIFIED_IP_HOSTNAME:verifiedHost}), null);
  }
});

test('gated synthetic direct-edge fixtures accept well-formed IPv4 and IPv6', async () => {
  for (const [input, expected] of [['203.0.113.4','203.0.113.4'],['2001:0DB8:0:0:0:0:0:4','2001:db8::4']]) {
    const {record} = await receipt(request({headers:{'CF-Connecting-IP':input}}), enabled());
    assert.deepEqual(record.source_ip, {status:'verified', provenance:'cloudflare_direct_edge_v1', address:expected});
  }
});

test('ordinary forwarded headers and payload addresses never override the selected edge value', async () => {
  const {record} = await receipt(request({headers:{'CF-Connecting-IP':'203.0.113.4','X-Forwarded-For':'198.51.100.99, 192.0.2.4','X-Real-IP':'198.51.100.2','True-Client-IP':'192.0.2.99'},body:'{"source_ip":"192.0.2.8"}'}), enabled());
  assert.equal(record.source_ip.address, '203.0.113.4');
  assert.equal(record.transport['x-forwarded-for'], undefined);
  assert.equal(record.headers, undefined);
});

test('missing Cloudflare request metadata and missing edge header remain unavailable', async () => {
  for (const req of [request({cf:false,headers:{'CF-Connecting-IP':'203.0.113.4'}}), request({headers:{'X-Forwarded-For':'203.0.113.4','X-Real-IP':'203.0.113.4'}})]) {
    assert.equal((await receipt(req, enabled())).record.source_ip.status, 'unavailable');
  }
});

test('Worker, O2O and pseudo-IPv4 paths retain bodies without asserted visitor attribution', async () => {
  for (const headers of [
    {'CF-Worker':'attacker.example.invalid'}, {'CF-Worker':''}, {'CF-Connecting-O2O':'1'},
    {'CF-Connecting-IPv6':'2001:db8::4'}, {'CF-Connecting-IP':'240.1.2.3'},
    {'CF-Connecting-IP':'2a06:98c0:3600::103'}, {'CF-Connecting-IP':'2A06:98C0:3600:0:0:0:0:0103'}
  ]) {
    assert.equal((await receipt(request({headers:{'CF-Connecting-IP':'203.0.113.4',...headers}}), enabled())).record.source_ip.status, 'unavailable');
  }
});

test('malformed or multiple edge addresses fail closed rather than guessing', async () => {
  for (const value of ['', '1.2.3', '01.2.3.4', '256.2.3.4', '203.0.113.4:443', '203.0.113.4, 192.0.2.4', '[2001:db8::4]', '2001:db8::4%eth0', ':::', '2001:db8:::4', 'not-an-ip']) {
    assert.equal((await receipt(request({headers:{'CF-Connecting-IP':value}}), enabled())).record.source_ip.status, 'unavailable');
  }
});

test('binary malformed bytes and retries are retained as distinct exact receipts', async () => {
  const env = {BUCKET: new Bucket()};
  const bytes = new Uint8Array([0xff, 0xfe, 0, 0x7b, 0x0a]);
  const ids = [];
  for (let i=0;i<2;i++) {
    const {record,ack} = await receipt(request({body:bytes}), env);
    assert.deepEqual(Buffer.from(record.body_base64,'base64'), Buffer.from(bytes));
    assert.equal(ack.receipt_body_sha256, digest(bytes));
    ids.push(ack.receipt_id);
  }
  assert.equal(new Set(ids).size, 2);
  assert.equal(env.BUCKET.objects.size, 2);
});

test('storage failure never returns a durable acknowledgement or provider error text', async () => {
  const env = {BUCKET:new Bucket()}; env.BUCKET.failWrites = true;
  const result = await worker.fetch(request(), env);
  assert.equal(result.status, 503);
  assert.deepEqual(await result.json(), {status:'retry',reason:'durability_unconfirmed'});
  assert.equal(env.BUCKET.objects.size, 0);
});

test('health and preflight keep existing minimal protocol behavior', async () => {
  const env = {BUCKET:new Bucket()};
  assert.deepEqual(await(await worker.fetch(request({path:'/health',method:'GET'}),env)).json(), {status:'available'});
  const response = await worker.fetch(request({method:'OPTIONS',headers:{'Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'content-type'}}), env);
  assert.equal(response.status,204);
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  assert.deepEqual(env.BUCKET.operations,[]);
});

after(async () => {
  const override = process.env.FARPOINT_TEST_EVIDENCE_DIR;
  if (override && !isAbsolute(override)) throw new Error('Evidence directory must be absolute');
  const directory = override || fileURLToPath(new URL('./evidence/', import.meta.url));
  await mkdir(directory, {recursive:true});
  const path = resolve(directory, 'cloudflare-wrapper-stores-' + randomUUID() + '.json');
  const objects = stores.map(bucket => [...bucket.objects].map(([key,value]) => ({key, body_base64:Buffer.from(value.bytes).toString('base64'), sha256:digest(value.bytes)})));
  await writeFile(path, JSON.stringify({scope:'local_synthetic_cloudflare_wrapper_only',created_at:new Date().toISOString(),objects},null,2)+'\n', {flag:'wx'});
  console.log('Synthetic stores retained: ' + path);
});
