import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createPool, migrate, privacyHash, reserveQuota, withAdvisoryLock, transaction } from '../src/db.mjs';
import { validateEvent } from '../src/validation.mjs';
import { ingestEvent } from '../src/collector.mjs';
import { drainOutbox } from '../src/outbox.mjs';
import { createServer } from '../src/server.mjs';
import { enrichNetwork, refreshEnrichmentHealth } from '../src/enrichment.mjs';
import { testConfig, event } from './collector-helpers.mjs';

const enabled = Boolean(process.env.DATABASE_URL);
const native = !process.env.PGLITE_LOCAL_DEVELOPMENT;
const successResponse = () => new Response(JSON.stringify({ sessionId: randomUUID(), visitId: randomUUID(), cache: 'synthetic-cache-token' }), { status: 200 });

const developmentPool = enabled && !native ? createPool(testConfig(), { max: 1 }) : null;
after(async () => { if (developmentPool) await developmentPool.end(); });
async function database(t, overrides = {}) {
  let cfg = testConfig(overrides);
  if (!native) return { cfg, pool: developmentPool };
  const schema = `collector_test_${randomUUID().replaceAll('-', '')}`;
  const owner = createPool(cfg, { max: 1 });
  await owner.query(`CREATE SCHEMA ${schema}`); await owner.end();
  const url = new URL(cfg.databaseUrl); url.searchParams.set('options', `-csearch_path=${schema},public`);
  cfg = { ...cfg, databaseUrl: url.toString() };
  const pool = createPool(cfg, { max: 8 });
  t.after(async () => { await pool.end(); const cleanup = createPool(testConfig(), { max: 1 });
    await cleanup.query(`DROP SCHEMA ${schema} CASCADE`); await cleanup.end(); });
  return { cfg, pool };
}

test('PostgreSQL collector integration: durable canonical store, privacy, limits and HTTP', { skip: !enabled }, async t => {
  const { cfg, pool } = await database(t);
  const migration = await migrate(pool); assert.equal(migration.locked, true); await migrate(pool);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n, 1);
  // Separate fixtures isolate this suite from receipt/maintenance suites sharing the same CI database.
  const browserId = randomUUID();
  const data = validateEvent(event({ browserId }), cfg);
  const accepted = await ingestEvent(pool, cfg, data); assert.equal(accepted.accepted, true);
  const duplicate = await ingestEvent(pool, cfg, data); assert.equal(duplicate.duplicate, true);
  await assert.rejects(ingestEvent(pool, cfg, { ...data, page: '/quote.html' }), e => e.status === 409);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM analytics_outbox WHERE event_id=$1', [data.eventId])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT payload FROM events WHERE event_id=$1', [data.eventId])).rows[0].payload.browserId, browserId);
  // A new pool observes committed records; process restart does not remove event IDs.
  if (native) { const second = createPool(cfg);
    assert.equal((await second.query('SELECT event_id FROM events WHERE event_id=$1', [data.eventId])).rowCount, 1); await second.end(); }
  const conflict = { ...data, eventId: randomUUID(), name: 'rfq_submit_success', inquiryId: randomUUID() };
  await pool.query('INSERT INTO privacy_tombstones(kind,key_hash,expires_at) VALUES($1,$2,now()+interval\'100 days\')', ['inquiry', privacyHash('inquiry', conflict.inquiryId, cfg.deletionSecret)]);
  assert.equal((await ingestEvent(pool, cfg, conflict)).suppressed, true);
  assert.equal((await pool.query('SELECT 1 FROM events WHERE event_id=$1', [conflict.eventId])).rowCount, 0);
  await pool.query("UPDATE system_state SET value='{" + '"active":true' + "}' WHERE key='privacy_maintenance'");
  try { await assert.rejects(ingestEvent(pool, cfg, validateEvent(event(), cfg)), e => e.status === 503); }
  finally { await pool.query("UPDATE system_state SET value='{" + '"active":false' + "}' WHERE key='privacy_maintenance'"); }
  const limitedCfg = { ...cfg, limits: { ...cfg.limits, browserPerMinute: 2 } };
  const limitedBrowser = randomUUID();
  await ingestEvent(pool, limitedCfg, validateEvent(event({ browserId: limitedBrowser }), cfg));
  await ingestEvent(pool, limitedCfg, validateEvent(event({ browserId: limitedBrowser }), cfg));
  await assert.rejects(ingestEvent(pool, limitedCfg, validateEvent(event({ browserId: limitedBrowser }), cfg)), e => e.status === 429);
  const server = createServer({ pool, config: cfg }); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal((await fetch(`${base}/readyz`)).status, 200);
    const submission = event();
    const response = await fetch(`${base}/v1/events`, { method: 'POST', headers: { Origin: 'https://farpointenergy.com', 'Content-Type': 'application/json' }, body: JSON.stringify(submission) });
    assert.equal(response.status, 202);
    assert.equal((await pool.query('SELECT event_id FROM events WHERE event_id=$1', [submission.eventId])).rowCount, 1);
    const qaSubmission = event();
    const qaResponse = await fetch(`${base}/v1/events`, { method: 'POST', headers: { Origin: 'https://farpointenergy.com', 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.adminToken}` }, body: JSON.stringify(qaSubmission) });
    assert.equal(qaResponse.status, 202);
    const storedQa = (await pool.query('SELECT e.is_qa,o.payload FROM events e JOIN analytics_outbox o USING(event_id) WHERE event_id=$1', [qaSubmission.eventId])).rows[0];
    assert.equal(storedQa.is_qa, true); assert.equal(storedQa.payload.payload.website, cfg.umamiQaWebsiteId);
    assert.equal(storedQa.payload.payload.browser, ''); assert.equal(storedQa.payload.payload.os, '');
    const privateStatus = await fetch(`${base}/v1/status`, { headers: { Authorization: `Bearer ${cfg.adminToken}` } });
    assert.equal(privateStatus.status, 200);
    const enrichmentStatus = (await privateStatus.json()).checks.find(check => check.name === 'enrichment');
    assert.equal(enrichmentStatus.status, 'degraded'); assert.equal(enrichmentStatus.detail.reason, 'disabled');
  } finally { await new Promise(resolve => server.close(resolve)); }
  // Parametric values cannot execute SQL; DB checks also protect direct accidental callers.
  if (native) await assert.rejects(pool.query('UPDATE events SET product=$1 WHERE event_id=$2', ["power');DROP TABLE events;--", data.eventId]));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM events')).rows[0].n > 0, true);
});

test('PostgreSQL outbox recovers expired leases, suppresses tombstones, bounds age and distinguishes upstream outcomes', { skip: !enabled }, async t => {
  const { cfg, pool } = await database(t); await migrate(pool);
  // Remove only this suite's IDs in cleanup; drain only isolated database expected in CI sequencing.
  await pool.query("UPDATE analytics_outbox SET status='forwarded' WHERE status IN ('pending','leased')");
  const make = async () => { const data = validateEvent(event(), cfg); await ingestEvent(pool, cfg, data); return data; };
  const a = await make(); let calls = 0;
  const forwarded = await drainOutbox(pool, cfg, { fetchImpl: async () => { calls++; return successResponse(); } });
  assert.equal(forwarded.forwarded, 1); assert.equal(calls, 1);
  assert.equal((await pool.query('SELECT status FROM analytics_outbox WHERE event_id=$1', [a.eventId])).rows[0].status, 'forwarded');
  const b = await make();
  await pool.query("UPDATE analytics_outbox SET status='leased',attempts=1,lease_until=now()-interval '1 minute',lease_token=$2 WHERE event_id=$1", [b.eventId, randomUUID()]);
  const retried = await drainOutbox(pool, cfg, { fetchImpl: async () => new Response('{}', { status: 503 }), random: () => 0 });
  assert.equal(retried.retry, 1);
  const leased = (await pool.query('SELECT status,attempts,lease_token FROM analytics_outbox WHERE event_id=$1', [b.eventId])).rows[0];
  assert.equal(leased.status, 'pending'); assert.equal(leased.attempts, 2); assert.equal(leased.lease_token, null);
  const c = await make();
  await pool.query('INSERT INTO privacy_tombstones(kind,key_hash,expires_at) VALUES($1,$2,now()+interval\'100 days\')', ['browser', privacyHash('browser', c.browserId, cfg.deletionSecret)]);
  let erasedSent = false;
  await drainOutbox(pool, cfg, { fetchImpl: async (_url, opts) => { if (JSON.parse(opts.body).payload.id === c.browserId) erasedSent = true; return successResponse(); } });
  assert.equal(erasedSent, false); assert.equal((await pool.query('SELECT 1 FROM analytics_outbox WHERE event_id=$1', [c.eventId])).rowCount, 0);
  const d = await make(); await pool.query("UPDATE events SET received_at=now()-interval '49 hours' WHERE event_id=$1", [d.eventId]);
  const expired = await drainOutbox(pool, cfg, { fetchImpl: async () => { throw new Error('expired must not forward'); } }); assert.equal(expired.expired, 1);
  const e = await make(); const suppress = await drainOutbox(pool, cfg, { fetchImpl: async () => new Response('{"beep":"boop"}', { status: 200 }) }); assert.equal(suppress.suppressed, 1);
  const f = await make(); const failed = await drainOutbox(pool, cfg, { fetchImpl: async () => new Response('{}', { status: 400 }) }); assert.equal(failed.dead_letter, 1);
  const serialized = JSON.stringify((await pool.query('SELECT payload FROM analytics_outbox WHERE event_id=ANY($1::uuid[])', [[a.eventId, b.eventId, e.eventId, f.eventId]])).rows);
  assert(!serialized.includes('private@example.test')); assert(serialized.includes('0.0.0.0'));
});

test('PostgreSQL enrichment quota persists before lookup; errors are cached and safe fields survive', { skip: !enabled }, async t => {
  const { cfg, pool } = await database(t, { enrichmentEnabled: true, trustProxyVerified: true, trustProxyMode: 'direct', ipapiKey: 'synthetic-key', limits: { ...testConfig().limits, enrichmentPerDay: 900 } }); await migrate(pool);
  await pool.query('DELETE FROM network_cache'); await pool.query("DELETE FROM quotas WHERE scope='enrichment'");
  const client = await pool.connect();
  try {
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error('provider failed private data must not log'); };
    const first = await enrichNetwork(client, cfg, '8.8.8.8', { fetchImpl });
    assert.equal(first.evidence.reason, 'lookup_failed');
    const current = async () => (await client.query("SELECT status,detail,last_success FROM health_checks WHERE name='enrichment'")).rows[0];
    assert.equal((await current()).status, 'degraded'); assert.equal((await current()).detail.reason, 'lookup_failed');
    await enrichNetwork(client, cfg, '8.8.8.8', { fetchImpl }); assert.equal(calls, 1);
    assert.equal((await client.query("SELECT used FROM quotas WHERE scope='enrichment'")).rows[0].used, 1);
    const quota = await enrichNetwork(client, { ...cfg, limits: { ...cfg.limits, enrichmentPerDay: 1 } }, '9.9.9.9', { fetchImpl });
    assert.equal(quota.evidence.reason, 'quota_exhausted'); assert.equal(calls, 1);
    assert.equal((await current()).detail.reason, 'quota_exhausted'); assert.equal((await current()).detail.used, 1);
    const knownUnknown = { is_bogon: false, is_mobile: true, is_satellite: false, is_anycast: false, is_crawler: false,
      is_datacenter: false, is_tor: false, is_proxy: false, is_vpn: false, company: { type: 'isp' } };
    const resolved = async () => new Response(JSON.stringify(knownUnknown), { status: 200 });
    const recovery = await enrichNetwork(client, cfg, '9.9.9.9', { fetchImpl: resolved });
    assert.equal(recovery.evidence.status, 'unknown');
    assert.equal((await current()).status, 'ok'); assert.equal((await current()).detail.lastOutcome, 'unknown');
    const verifiedAt = (await current()).detail.lastVerifiedAt;
    assert(verifiedAt); assert((await current()).last_success);
    // A fresh provider failure remains visible even when another IP hits a known-good cache.
    await enrichNetwork(client, cfg, '1.1.1.1', { fetchImpl });
    await enrichNetwork(client, cfg, '9.9.9.9', { fetchImpl: resolved });
    assert.equal((await current()).detail.reason, 'lookup_failed'); assert.equal((await current()).detail.lastVerifiedAt, verifiedAt);
    const untrusted = await enrichNetwork(client, cfg, null, { fetchImpl: resolved });
    assert.equal(untrusted.evidence.reason, 'untrusted_source'); assert.equal((await current()).detail.reason, 'untrusted_source');
    await enrichNetwork(client, { ...cfg, enrichmentEnabled: false }, '9.9.9.9', { fetchImpl: resolved });
    assert.equal((await current()).detail.reason, 'disabled');
    const incomplete = await enrichNetwork(client, cfg, '8.8.4.4', { fetchImpl: async () => new Response('{"company":"minimal response"}') });
    assert.equal(incomplete.evidence.status, 'unavailable'); assert.equal((await current()).detail.reason, 'incomplete_response');
    await enrichNetwork(client, cfg, '1.0.0.1', { fetchImpl: resolved });
    assert.equal((await current()).status, 'ok');
    const day = new Date(); day.setUTCHours(0, 0, 0, 0);
    await client.query("UPDATE quotas SET used=810 WHERE scope='enrichment' AND bucket=$1", [day]);
    assert.equal((await refreshEnrichmentHealth(client, cfg)).status, 'ok');
    await client.query("UPDATE quotas SET used=811 WHERE scope='enrichment' AND bucket=$1", [day]);
    const warning = await refreshEnrichmentHealth(client, cfg);
    assert.equal(warning.status, 'warning'); assert.equal(warning.detail.reason, 'quota_near_limit'); assert.equal(warning.detail.remaining, 89);
    await client.query("UPDATE quotas SET used=900 WHERE scope='enrichment' AND bucket=$1", [day]);
    assert.equal((await refreshEnrichmentHealth(client, cfg)).detail.reason, 'quota_exhausted');
    await enrichNetwork(client, cfg, '9.9.9.9', { fetchImpl: resolved });
    assert.equal((await current()).detail.reason, 'quota_exhausted');
    // Calendar reset can recover an exhausted budget, but readonly report evaluation changes no persisted state.
    const tomorrow = new Date(+day + 86400000);
    const readonlyReset = await refreshEnrichmentHealth(client, cfg, { now: tomorrow, persist: false });
    assert.equal(readonlyReset.status, 'ok'); assert.equal(readonlyReset.detail.used, 0);
    assert.equal((await current()).detail.used, 900);
    await refreshEnrichmentHealth(client, cfg, { now: tomorrow });
    assert.equal((await current()).status, 'ok'); assert.equal((await current()).detail.used, 0);
    assert(!JSON.stringify((await client.query('SELECT * FROM network_cache')).rows).includes('8.8.8.8'));
    const health = JSON.stringify((await client.query("SELECT * FROM health_history WHERE name='enrichment'")).rows);
    assert(!health.includes('8.8.8.8')); assert(!health.includes('synthetic-key')); assert(!health.includes('provider failed private data'));
  } finally { client.release(); }
});

test('native PostgreSQL concurrency: one event/outbox, atomic quota and session advisory exclusion', { skip: !enabled || !native }, async t => {
  const { cfg, pool } = await database(t); await migrate(pool);
  const data = validateEvent(event(), cfg);
  const results = await Promise.all(Array.from({ length: 8 }, () => ingestEvent(pool, cfg, data)));
  assert.equal(results.filter(r => !r.duplicate).length, 1);
  assert.equal((await pool.query('SELECT 1 FROM analytics_outbox WHERE event_id=$1', [data.eventId])).rowCount, 1);
  const scope = `test:${randomUUID()}`; const now = new Date();
  const reservations = await Promise.all(Array.from({ length: 8 }, () => reserveQuota(pool, scope, now, 3, new Date(+now + 60000))));
  assert.equal(reservations.filter(Boolean).length, 3);
  let release; const held = new Promise(resolve => { release = resolve; });
  let acquired; const ready = new Promise(resolve => { acquired = resolve; });
  const key = `test-lock:${randomUUID()}`;
  const first = withAdvisoryLock(pool, key, async () => { acquired(); await held; return 'first'; });
  await ready;
  assert.equal((await withAdvisoryLock(pool, key, async () => 'second')).locked, false);
  release(); assert.equal((await first).value, 'first');
  const enrichmentConfig = { ...cfg, enrichmentEnabled: true, trustProxyVerified: true, trustProxyMode: 'direct' };
  await Promise.all(Array.from({ length: 8 }, (_, index) => refreshEnrichmentHealth(pool, enrichmentConfig,
    { observation: { type: index === 3 ? 'lookup_failed' : 'cache_hit' } })));
  assert.equal((await pool.query("SELECT detail FROM health_checks WHERE name='enrichment'")).rows[0].detail.reason, 'lookup_failed', 'Concurrent cache hits cannot erase a recorded provider failure');
  assert.equal((await refreshEnrichmentHealth(pool, enrichmentConfig, { observation: { type: 'resolved', outcome: 'unknown' } })).status, 'ok');
  // A failed transaction restores its quota reservation.
  await assert.rejects(transaction(pool, async client => { await reserveQuota(client, `rollback:${scope}`, now, 3, new Date(+now + 60000)); throw new Error('synthetic crash'); }));
  assert.equal((await pool.query('SELECT 1 FROM quotas WHERE scope=$1', [`rollback:${scope}`])).rowCount, 0);
});
