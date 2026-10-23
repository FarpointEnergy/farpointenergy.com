import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { loadConfig } from '../src/config.mjs';
import { validateEvent, canonicalHash, HttpError } from '../src/validation.mjs';
import { umamiPayload } from '../src/collector.mjs';
import { extractSourceIp, normalizeNetwork, publicIp } from '../src/enrichment.mjs';
import { classifyUmamiResponse } from '../src/outbox.mjs';
import { privacyHash } from '../src/db.mjs';
import { createServer } from '../src/server.mjs';
import { testConfig, event } from './collector-helpers.mjs';

test('closed event schema rejects PII, dynamic URLs, malformed IDs and unregistered attribution', () => {
  const cfg = testConfig({ campaigns: { c1: { source: 'email', medium: 'email' } } });
  const base = event(); const canonical = validateEvent(base, cfg);
  assert.equal(canonicalHash(canonical), canonicalHash(validateEvent({ ...base }, cfg)));
  assert.equal(validateEvent({ ...base, page: '/' }, cfg).page, '/index.html');
  for (const extra of ['email', 'nameOfPerson', 'url', 'title', 'referrer', 'query', 'isQa', '__proto__', 'constructor']) {
    const object = JSON.parse(JSON.stringify(base)); Object.defineProperty(object, extra, { value: 'private@example.test', enumerable: true });
    assert.throws(() => validateEvent(object, cfg), HttpError);
  }
  for (const override of [{ eventId: 'x' }, { browserId: base.browserId.toUpperCase() }, { page: '/quote.html?email=x' }, { page: '/quote.html#private' },
    { product: 'buyer name' }, { language: 'en-US-name' }, { referrerHost: 'employee.example.test' }, { clientTimestamp: Date.now() - 86400001 },
    { campaignCode: 'c1', source: 'email', medium: 'organic' }, { campaignCode: 'private-client', source: 'email', medium: 'email' },
    { campaignCode: '', source: 'email' }, { inquiryId: randomUUID() }, { screenClass: '1920x1080' }]) assert.throws(() => validateEvent({ ...base, ...override }, cfg), HttpError);
  assert.equal(validateEvent({ ...base, campaignCode: 'c1', source: 'email', medium: 'email' }, cfg).campaignCode, 'c1');
  assert.equal(validateEvent({ ...base, name: 'rfq_submit_success', inquiryId: randomUUID() }, cfg).name, 'rfq_submit_success');
});

test('config refuses invalid destinations, secrets, recipient override and unverified enrichment', () => {
  const env = { DATABASE_URL: 'postgresql://test@localhost/test', ADMIN_TOKEN: 'a'.repeat(32), NETWORK_HMAC_KEY: 'b'.repeat(32), DELETION_HMAC_KEY: 'c'.repeat(32) };
  assert.deepEqual(loadConfig(env).reportCadences, ['weekly']);
  for (const override of [{ ADMIN_TOKEN: '' }, { ALLOWED_ORIGINS: 'https://farpointenergy.com.evil/' }, { UMAMI_URL: 'https://example.test/api' },
    { REPORT_RECIPIENT: 'external@example.test' }, { ENRICHMENT_ENABLED: 'true', IPAPI_KEY: 'synthetic' }, { REPORT_CADENCES: 'hourly' },
    { CAMPAIGNS_JSON: '{"name@example.test":{"source":"email","medium":"email"}}' }]) assert.throws(() => loadConfig({ ...env, ...override }));
  const umami = { UMAMI_URL: 'http://umami:3000', UMAMI_WEBSITE_ID: '11111111-1111-4111-8111-111111111111' };
  assert.throws(() => loadConfig({ ...env, ...umami }));
  assert.throws(() => loadConfig({ ...env, ...umami, UMAMI_QA_WEBSITE_ID: umami.UMAMI_WEBSITE_ID }));
  assert.equal(loadConfig({ ...env, ...umami, UMAMI_QA_WEBSITE_ID: '22222222-2222-4222-8222-222222222222' }).umamiQaWebsiteId, '22222222-2222-4222-8222-222222222222');
});

test('source-IP extraction anchors trust at socket and excludes private/reserved addresses', () => {
  const config = testConfig({ trustProxyMode: 'cidr', trustProxyVerified: true, trustedProxyCidrs: ['10.0.0.0/8'] });
  const req = { socket: { remoteAddress: '10.1.1.1' }, headers: { 'x-forwarded-for': '1.2.3.4, 8.8.8.8, 10.2.1.1', 'x-real-ip': '9.9.9.9' } };
  assert.equal(extractSourceIp(req, config), '8.8.8.8');
  assert.equal(extractSourceIp(req, { ...config, trustProxyVerified: false }), null);
  assert.equal(extractSourceIp({ ...req, socket: { remoteAddress: '9.9.9.9' } }, config), null);
  assert.equal(extractSourceIp({ ...req, headers: { 'x-forwarded-for': '8.8.8.8, invalid' } }, config), null);
  for (const ip of ['127.0.0.1', '10.0.0.1', '192.168.1.1', '169.254.1.2', '100.64.0.1', '192.0.2.4', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(publicIp(ip), null);
  assert.equal(publicIp('::ffff:8.8.8.8'), '8.8.8.8');
});

test('network matches are conservative and provider private fields cannot escape', () => {
  const response = { is_bogon: false, is_mobile: false, is_satellite: false, is_anycast: false, is_crawler: false, is_datacenter: false, is_tor: false, is_proxy: false, is_vpn: false,
    ip: '8.8.8.8', abuse: { email: 'private@example.test' }, company: { name: 'Synthetic EPC', domain: 'epc.example', type: 'business' },
    location: { country_code: 'US', state: 'Ohio', city: 'Private city', latitude: 40, longitude: -80 } };
  const match = normalizeNetwork(response, { targetAccounts: { 'epc.example': 'Synthetic account' } });
  assert.equal(match.status, 'inferred'); assert.equal(match.targetAccount, true);
  assert(!JSON.stringify(match).includes('8.8.8.8')); assert(!JSON.stringify(match).includes('private@example')); assert(!JSON.stringify(match).includes('Private city'));
  for (const override of [{ is_vpn: 'true' }, { is_crawler: 'Bot' }, { is_mobile: true }, { is_datacenter: true }, { egress_service: { type: 'secure_web_gateway' } },
    { company: { name: 'ISP', domain: 'isp.example', type: 'isp' } }, { asn: { type: 'hosting' } }]) assert.equal(normalizeNetwork({ ...response, ...override }).status, 'unknown');
  assert.equal(normalizeNetwork({ company: 'Anonymous minimal response' }).status, 'unavailable');
});

test('Umami payload preserves sanitized categories, anonymous identity, original timestamp and response meaning', () => {
  const cfg = testConfig(); const input = event({ name: 'rfq_submit_success', inquiryId: randomUUID(), referrerHost: 'google.com' });
  const payload = umamiPayload(input, cfg, new Date('2026-10-20T12:00:00Z'));
  assert.equal(payload.payload.ip, '0.0.0.0'); assert.equal(payload.payload.id, input.browserId); assert.equal(payload.payload.timestamp, 1792497600);
  assert.equal(payload.payload.browser, ''); assert.equal(payload.payload.os, '');
  assert.equal(payload.payload.website, cfg.umamiWebsiteId);
  assert.equal(umamiPayload(input, cfg, new Date(), { qa: true }).payload.website, cfg.umamiQaWebsiteId);
  assert(!JSON.stringify(payload).includes(input.inquiryId)); assert.equal(payload.payload.referrer, 'https://google.com/');
  assert.equal(umamiPayload(event(), cfg, new Date()).payload.name, undefined);
  assert.equal(classifyUmamiResponse(200, { beep: 'boop' }), 'suppressed');
  assert.equal(classifyUmamiResponse(200, { sessionId: randomUUID(), visitId: randomUUID(), cache: 'synthetic-cache-token' }), 'forwarded');
  assert.equal(classifyUmamiResponse(200, { sessionId: '', visitId: '', cache: '' }), 'retry');
  assert.equal(classifyUmamiResponse(429, {}), 'retry'); assert.equal(classifyUmamiResponse(500, {}), 'retry'); assert.equal(classifyUmamiResponse(400, {}), 'dead_letter');
  assert.equal(privacyHash('browser', input.browserId.toUpperCase(), cfg.deletionSecret), privacyHash('browser', input.browserId, cfg.deletionSecret));
});

test('actual HTTP boundary enforces origin, auth, body limits and no secret-bearing errors', async t => {
  const config = testConfig(); let calls = 0; const qaFlags = [];
  const pool = { query: async () => { throw new Error('postgresql://private:password@host database details'); } };
  const server = createServer({ pool, config, ingest: async (_pool, _cfg, _event, options) => { calls++; qaFlags.push(options.qa); return { accepted: true }; }, reportHandlers: { preview: async () => ({ private: 'synthetic' }) } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const post = (body, headers = {}) => fetch(`${origin}/v1/events`, { method: 'POST', headers: { Origin: 'https://farpointenergy.com', 'Content-Type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
  assert.equal((await post(event())).status, 202); assert.equal(calls, 1);
  assert.equal((await post(event(), { Origin: 'https://farpointenergy.com.attacker.test' })).status, 403);
  assert.equal((await post(event({ email: 'private@example.test' }))).status, 400);
  assert.equal((await post('x'.repeat(5000))).status, 413);
  assert.equal((await post(event(), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await fetch(`${origin}/v1/report?token=${config.adminToken}`)).status, 401);
  assert.equal((await fetch(`${origin}/v1/report?token=x`, { headers: { Authorization: `Bearer ${config.adminToken}` } })).status, 400);
  assert.equal((await fetch(`${origin}/v1/report`, { headers: { Authorization: `Bearer ${config.adminToken}` } })).status, 200);
  assert.equal((await fetch(`${origin}/v1/report?recipient=external@example.test`, { headers: { Authorization: `Bearer ${config.adminToken}` } })).status, 400);
  const failure = await fetch(`${origin}/readyz`); assert.equal(failure.status, 503); assert.equal((await failure.text()).includes('password'), false);
  const preflight = await fetch(`${origin}/v1/events`, { method: 'OPTIONS', headers: { Origin: 'https://farpointenergy.com', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://farpointenergy.com');
  assert.equal(calls, 1);
  assert.equal((await post(event(), { Authorization: 'Bearer wrong' })).status, 202);
  assert.equal((await post(event(), { Authorization: `Bearer ${config.adminToken}` })).status, 202);
  assert.deepEqual(qaFlags, [false, false, true]);
});
