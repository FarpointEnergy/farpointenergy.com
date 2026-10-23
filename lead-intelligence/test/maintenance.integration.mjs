import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import { createDeletionJournal } from '../src/journal.mjs';
import { eraseIdentifiers, replayDeletionJournal, runRetention, purgeUmamiIdentifiers, purgeUmamiRetention, verifyUmamiSchema, UMAMI_MIGRATIONS } from '../src/maintenance.mjs';
import { assertPrivacyAllowed } from '../src/db.mjs';

const development = Boolean(process.env.PGLITE_MODULE_ROOT);
const enabled = Boolean(process.env.UMAMI_SOURCE_DIR && (development || (process.env.TEST_DATABASE_URL && process.env.UMAMI_TEST_DATABASE_URL)));
const DAY = 86400000;
async function pool(url) {
  if (development) {
    const root = process.env.PGLITE_MODULE_ROOT;
    const { PGlite } = await import(pathToFileURL(path.join(root, 'dist/index.js')));
    const { pgcrypto } = await import(pathToFileURL(path.join(root, 'dist/contrib/pgcrypto.js')));
    const db = await PGlite.create({ extensions: { pgcrypto } });
    const client = {
      async query(sql, values) {
        const result = values ? await db.query(sql, values) : (await db.exec(sql)).at(-1) || {};
        return { rows: result.rows || [], rowCount: result.rows?.length || result.affectedRows || 0 };
      },
      release() {},
    };
    return { ...client, async connect() { return client; }, async end() { await db.close(); } };
  }
  if (!new URL(url).pathname.endsWith('_test')) throw new Error('Maintenance integration requires an isolated *_test database');
  return new pg.Pool({ connectionString: url, max: 5 });
}
async function memoryJournal(websiteId) {
  const objects = new Map();
  const store = {
    async putIfAbsent(key, bytes) { if (objects.has(key)) return false; objects.set(key, Buffer.from(bytes)); return true; },
    async get(key) { if (!objects.has(key)) throw new Error('unavailable'); return Buffer.from(objects.get(key)); },
    async getWithVersion(key) { const bytes = await this.get(key); return { bytes, version: createHash('sha256').update(bytes).digest('hex') }; },
    async putIfMatch(key, bytes, version) { if (!objects.has(key) || createHash('sha256').update(objects.get(key)).digest('hex') !== version) return false; objects.set(key, Buffer.from(bytes)); return true; },
    async list(prefix) { return [...objects.keys()].filter(key => key.startsWith(prefix)); },
  };
  const journal = createDeletionJournal({ store, key: randomBytes(32), websiteId, installationId: randomUUID() });
  await journal.initialize();
  return { journal, store, objects };
}
async function initializeUmami(db) {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await db.query(`CREATE TABLE _prisma_migrations(id varchar(36) PRIMARY KEY,checksum varchar(64) NOT NULL,finished_at timestamptz,
    migration_name varchar(255) NOT NULL,logs text,rolled_back_at timestamptz,started_at timestamptz NOT NULL DEFAULT now(),applied_steps_count integer NOT NULL DEFAULT 0)`);
  const names = (await readdir(path.join(process.env.UMAMI_SOURCE_DIR, 'prisma/migrations'))).filter(name => /^\d+_/.test(name)).sort();
  assert.deepEqual(names, Object.keys(UMAMI_MIGRATIONS));
  for (const name of names) {
    const sql = await readFile(path.join(process.env.UMAMI_SOURCE_DIR, 'prisma/migrations', name, 'migration.sql'), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');
    assert.equal(checksum, UMAMI_MIGRATIONS[name]);
    await db.query(sql);
    await db.query('INSERT INTO _prisma_migrations(id,migration_name,checksum,finished_at,applied_steps_count) VALUES($1,$2,$3,now(),1)', [randomUUID(), name, checksum]);
  }
}
async function initializeLeads(db) {
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public');
  await db.query(await readFile(new URL('../migrations/001_initial.sql', import.meta.url), 'utf8'));
  await db.query('INSERT INTO schema_migrations(version) VALUES(1)');
}
async function clear(db, umami) {
  await db.query(`TRUNCATE analytics_outbox,events,rfq_receipts,privacy_tombstones,network_cache,quotas,health_history,daily_aggregates,report_deliveries RESTART IDENTITY CASCADE;
    UPDATE system_state SET value='{"active":false}' WHERE key='privacy_maintenance'`);
  await umami.query('TRUNCATE event_data,website_event,session_data,session_link,revenue,session_replay,session_replay_saved,heatmap_event,session,website CASCADE');
}
async function graph(db, { websiteId = randomUUID(), browserId = randomUUID(), when = new Date(), linkOnly = false, driftDataSite = null } = {}) {
  const sessionId = randomUUID(), eventId = randomUUID(), visitId = randomUUID();
  await db.query('INSERT INTO website(website_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING', [websiteId, 'Synthetic QA']);
  await db.query('INSERT INTO session(session_id,website_id,distinct_id,created_at) VALUES($1,$2,$3,$4)', [sessionId, websiteId, linkOnly ? null : browserId, when]);
  await db.query('INSERT INTO session_link(website_id,session_id,distinct_id,created_at) VALUES($1,$2,$3,$4)', [websiteId, sessionId, browserId, when]);
  await db.query('INSERT INTO website_event(event_id,website_id,session_id,visit_id,url_path,created_at) VALUES($1,$2,$3,$4,$5,$6)', [eventId, websiteId, sessionId, visitId, '/quote.html', when]);
  await db.query('INSERT INTO event_data(event_data_id,website_id,website_event_id,data_key,string_value,data_type,created_at) VALUES($1,$2,$3,$4,$5,1,$6)', [randomUUID(), driftDataSite || websiteId, eventId, 'synthetic', 'value', when]);
  await db.query('INSERT INTO session_data(session_data_id,website_id,session_id,distinct_id,data_key,data_type,created_at) VALUES($1,$2,$3,$4,$5,1,$6)', [randomUUID(), websiteId, sessionId, browserId, 'synthetic', when]);
  await db.query('INSERT INTO revenue(revenue_id,website_id,session_id,event_id,event_name,currency,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)', [randomUUID(), websiteId, sessionId, eventId, 'synthetic', 'USD', when]);
  const actualTime = when || new Date();
  await db.query('INSERT INTO session_replay(replay_id,website_id,session_id,visit_id,chunk_index,events,event_count,started_at,ended_at,created_at) VALUES($1,$2,$3,$4,0,$5,0,$6,$6,$7)', [randomUUID(), websiteId, sessionId, visitId, Buffer.from([]), actualTime, when]);
  await db.query('INSERT INTO session_replay_saved(saved_replay_id,name,website_id,visit_id,created_at) VALUES($1,$2,$3,$4,$5)', [randomUUID(), 'Synthetic', websiteId, visitId, when]);
  await db.query('INSERT INTO heatmap_event(heatmap_event_id,website_id,session_id,visit_id,url_path,event_type,created_at) VALUES($1,$2,$3,$4,$5,1,$6)', [randomUUID(), websiteId, sessionId, visitId, '/quote.html', actualTime]);
  return { websiteId, browserId, sessionId, eventId, visitId };
}
async function lead(db, { browserId = randomUUID(), inquiryId = randomUUID(), gmailId = 'synthetic' + randomBytes(6).toString('hex'), when = new Date() } = {}) {
  const eventId = randomUUID();
  await db.query(`INSERT INTO events(event_id,payload_hash,received_at,event_name,page,browser_id,session_id,product,application,language,screen_class,client_timestamp,inquiry_id,payload)
    VALUES($1,$2,$3,'rfq_submit_success','/quote.html',$4,$5,'power','utility','en','desktop',0,$6,'{}')`, [eventId, 'a'.repeat(64), when, browserId, randomUUID(), inquiryId]);
  await db.query("INSERT INTO analytics_outbox(event_id,browser_id,inquiry_id,payload,status,attempts,created_at) VALUES($1,$2,$3,'{}','leased',1,$4)", [eventId, browserId, inquiryId, when]);
  await db.query("INSERT INTO rfq_receipts(gmail_message_id,received_at,inquiry_id,fields,status) VALUES($1,$2,$3,'{}','received')", [gmailId, when, inquiryId]);
  return { browserId, inquiryId, gmailId, eventId };
}
const stopped = async () => ({ state: 'stopped', allInstancesStopped: true, verification: 'synthetic control-plane fixture' });
const started = async () => ({ state: 'running', privateHealthVerified: true });

test('maintenance against pinned official Umami schema' + (development ? ' [PGlite development only]' : ''), { skip: !enabled }, async t => {
  const leads = await pool(process.env.TEST_DATABASE_URL), umami = await pool(process.env.UMAMI_TEST_DATABASE_URL);
  try {
    await initializeLeads(leads); await initializeUmami(umami);
    await t.test('all dependent rows are purged; another browser and another website survive', async () => {
      await clear(leads, umami);
      const websiteId = randomUUID(), otherSite = randomUUID(), browserId = randomUUID();
      const target = await graph(umami, { websiteId, browserId, linkOnly: true, driftDataSite: otherSite });
      await graph(umami, { websiteId });
      await graph(umami, { websiteId: otherSite, browserId });
      // A public table with a staging name must not shadow the connection-local temporary table.
      await umami.query('CREATE TABLE public.purge_sessions(session_id uuid)');
      await umami.query('INSERT INTO public.purge_sessions SELECT session_id FROM session WHERE distinct_id<>$1', [browserId]);
      const result = await purgeUmamiIdentifiers(umami, { websiteId, browserIds: [browserId] });
      await umami.query('DROP TABLE public.purge_sessions');
      assert.equal(result.session, 1); assert.equal(result.event_data, 1);
      for (const table of ['session', 'website_event', 'event_data', 'session_data', 'session_link', 'revenue', 'session_replay', 'session_replay_saved', 'heatmap_event']) {
        assert.equal(Number((await umami.query(`SELECT count(*) FROM ${table}`)).rows[0].count), 2, table);
      }
      assert.equal((await umami.query('SELECT 1 FROM session WHERE session_id=$1', [target.sessionId])).rowCount, 0);
      assert.equal((await purgeUmamiIdentifiers(umami, { websiteId, browserIds: [browserId] })).session, 0);
    });
    await t.test('retention deletes expired and NULL timestamps, preserving old sessions with new activity and unrelated sites', async () => {
      await clear(leads, umami);
      const websiteId = randomUUID(), now = new Date(), cutoff = new Date(now.getTime() - 90 * DAY), old = new Date(now.getTime() - 91 * DAY);
      const target = await graph(umami, { websiteId, when: old });
      await graph(umami, { websiteId, when: null });
      await umami.query('DELETE FROM heatmap_event WHERE website_id=$1 AND created_at>$2', [websiteId, old]);
      await graph(umami, { when: old });
      const eventId = randomUUID();
      await umami.query('INSERT INTO website_event(event_id,website_id,session_id,visit_id,url_path,created_at) VALUES($1,$2,$3,$4,$5,$6)', [eventId, websiteId, target.sessionId, randomUUID(), '/index.html', now]);
      await purgeUmamiRetention(umami, { websiteId, cutoff });
      assert.equal(Number((await umami.query('SELECT count(*) FROM session WHERE website_id=$1', [websiteId])).rows[0].count), 1);
      assert.equal((await umami.query('SELECT 1 FROM website_event WHERE event_id=$1', [eventId])).rowCount, 1);
      for (const table of ['website_event', 'event_data', 'session_data', 'session_link', 'revenue', 'session_replay', 'session_replay_saved', 'heatmap_event']) {
        assert.equal(Number((await umami.query(`SELECT count(*) FROM ${table} WHERE website_id=$1 AND (created_at<$2 OR created_at IS NULL)`, [websiteId, cutoff])).rows[0].count), 0);
        assert.equal(Number((await umami.query(`SELECT count(*) FROM ${table} WHERE website_id<>$1`, [websiteId])).rows[0].count), 1);
      }
    });
    await t.test('unreviewed Umami migration checksum fails closed', async () => {
      await umami.query("UPDATE _prisma_migrations SET checksum='changed' WHERE migration_name='26_add_api_key'");
      await assert.rejects(verifyUmamiSchema(umami), /does not match/);
      await umami.query("UPDATE _prisma_migrations SET checksum=$1 WHERE migration_name='26_add_api_key'", [UMAMI_MIGRATIONS['26_add_api_key']]);
    });
    await t.test('erasure journals linked IDs, removes claimed outbox, tombstones overlap/backfill and restores without resurrection', async () => {
      await clear(leads, umami);
      const websiteId = randomUUID(), browserId = randomUUID(), now = new Date();
      const before = await lead(leads, { browserId });
      await graph(umami, { websiteId, browserId });
      const config = { umamiWebsiteId: websiteId, deletionSecret: 'synthetic-deletion-key-'.repeat(3) };
      const { journal } = await memoryJournal(websiteId);
      let rollups = 0, stops = 0;
      const options = { leadPool: leads, umamiPool: umami, config, journal, ids: { browserIds: [browserId] }, now, stopUmami: async () => {
        stops++;
        // A timed-out request can finish remotely before the control plane confirms shutdown.
        if (stops === 1) await graph(umami, { websiteId, browserId });
        return stopped();
      }, startUmami: started, rollup: async (...args) => { assert.equal(args[3].privacyLockHeld, true); rollups++; } };
      await eraseIdentifiers(options);
      const [record] = await journal.readRequests({ now });
      assert.deepEqual(record.inquiryIds, [before.inquiryId]); assert.deepEqual(record.gmailMessageIds, [before.gmailId]);
      assert.equal(Number((await leads.query('SELECT count(*) FROM privacy_tombstones')).rows[0].count), 3);
      assert.equal(Number((await leads.query('SELECT count(*) FROM analytics_outbox')).rows[0].count), 0);
      const c = await leads.connect();
      try {
        await c.query('BEGIN');
        assert.equal((await assertPrivacyAllowed(c, config, { gmailMessageId: before.gmailId, inquiryId: before.inquiryId })).reason, 'erased');
        await c.query('ROLLBACK');
      } finally { c.release(); }
      // Simulate restoring a pre-erasure DB snapshot while the independent journal survives.
      await leads.query('TRUNCATE privacy_tombstones');
      await lead(leads, { browserId, inquiryId: before.inquiryId, gmailId: before.gmailId });
      await graph(umami, { websiteId, browserId });
      await replayDeletionJournal(options);
      assert.equal(Number((await leads.query('SELECT count(*) FROM events')).rows[0].count), 0);
      assert.equal(Number((await leads.query('SELECT count(*) FROM rfq_receipts')).rows[0].count), 0);
      assert.equal(Number((await umami.query('SELECT count(*) FROM session')).rows[0].count), 0);
      assert.ok(rollups >= 2); assert.equal(stops, 2);
    });
    await t.test('journal and cross-database failures preserve maintenance gate; idempotent recovery succeeds', async () => {
      await clear(leads, umami);
      const websiteId = randomUUID(), browserId = randomUUID(), requestId = randomUUID(), now = new Date();
      await lead(leads, { browserId }); await graph(umami, { websiteId, browserId });
      const config = { umamiWebsiteId: websiteId, deletionSecret: 'synthetic-deletion-key-'.repeat(3) }, { journal } = await memoryJournal(websiteId);
      const options = { leadPool: leads, umamiPool: umami, config, journal, ids: { browserIds: [browserId] }, requestId, now, stopUmami: stopped, startUmami: started, rollup: async () => {} };
      await assert.rejects(eraseIdentifiers({ ...options, journal: { ...journal, writeRequest: async () => { throw new Error('durability failure'); } } }), /durability failure/);
      assert.equal((await leads.query("SELECT value FROM system_state WHERE key='privacy_maintenance'")).rows[0].value.active, true);
      assert.equal(Number((await leads.query('SELECT count(*) FROM events')).rows[0].count), 1);
      await assert.rejects(eraseIdentifiers({ ...options, requestId: randomUUID() }), /requires independent journal recovery/);
      await assert.rejects(eraseIdentifiers({ ...options, stopUmami: async () => ({ state: 'stopped', allInstancesStopped: false }) }), /all Umami|All Umami/);
      await assert.rejects(eraseIdentifiers({ ...options, ids: { browserIds: [randomUUID()] } }), /does not match its durable journal/);
      await assert.rejects(eraseIdentifiers({ ...options, umamiPool: { async connect() { throw new Error('second database crash'); } } }), /second database crash/);
      assert.equal(Number((await leads.query('SELECT count(*) FROM events')).rows[0].count), 0);
      assert.equal(Number((await umami.query('SELECT count(*) FROM session')).rows[0].count), 1);
      await eraseIdentifiers(options);
      assert.equal((await leads.query("SELECT value FROM system_state WHERE key='privacy_maintenance'")).rows[0].value.active, false);
      await assert.rejects(replayDeletionJournal({ ...options, journal: { ...journal, readRequests: async () => { throw new Error('independent journal unavailable'); } } }), /independent journal unavailable/);
      assert.equal((await leads.query("SELECT value FROM system_state WHERE key='privacy_maintenance'")).rows[0].value.active, true);
      await replayDeletionJournal(options);
      await assert.rejects(eraseIdentifiers({ ...options, journal: { ...journal, writeCompletion: async () => { throw new Error('completion durability failure'); } } }), /completion durability failure/);
      assert.equal((await leads.query("SELECT value FROM system_state WHERE key='privacy_maintenance'")).rows[0].value.active, true);
      await replayDeletionJournal(options);
      assert.equal((await leads.query("SELECT value FROM system_state WHERE key='privacy_maintenance'")).rows[0].value.active, false);
    });
    await t.test('nightly retention uses a fixed cutoff and requires stopped Umami for old unresolved forwarding', async () => {
      await clear(leads, umami);
      const websiteId = randomUUID(), qaWebsiteId = randomUUID(), now = new Date(), old = new Date(now.getTime() - 91 * DAY);
      await lead(leads, { when: old }); await graph(umami, { websiteId, when: old });
      await graph(umami, { websiteId: qaWebsiteId, when: old });
      await leads.query("INSERT INTO health_history(name,status,observed_at) VALUES('import','ok',$1),('import','degraded',$2),('import','ok',$3)", [new Date(old.getTime() - DAY), old, now]);
      const options = { leadPool: leads, umamiPool: umami, config: { umamiWebsiteId: websiteId, umamiQaWebsiteId: qaWebsiteId }, now, rollup: async () => {}, stopUmami: stopped, startUmami: started };
      const result = await runRetention(options);
      assert.equal(result.cutoff, new Date(now.getTime() - 90 * DAY).toISOString());
      assert.equal(Number((await leads.query('SELECT count(*) FROM events')).rows[0].count), 0);
      assert.equal(Number((await leads.query('SELECT count(*) FROM health_history')).rows[0].count), 2);
      assert.equal(Number((await umami.query('SELECT count(*) FROM session')).rows[0].count), 0);
      assert.equal(result.umamiQaCounts.session, 1);
      assert.equal(+new Date((await leads.query("SELECT value FROM system_state WHERE key='raw_retention_cutoff'")).rows[0].value.cutoff), now.getTime() - 90 * DAY);
    });
    await t.test('native shared lock prevents erasure from crossing an active outbox attempt', { skip: development }, async () => {
      await clear(leads, umami);
      const websiteId = randomUUID(), browserId = randomUUID(), now = new Date();
      await lead(leads, { browserId }); await graph(umami, { websiteId, browserId });
      const { journal } = await memoryJournal(websiteId), c = await leads.connect();
      await c.query('SELECT pg_advisory_lock_shared(7104,1)');
      let stopCalled = false;
      const pending = eraseIdentifiers({ leadPool: leads, umamiPool: umami, journal, config: { umamiWebsiteId: websiteId, deletionSecret: 'synthetic-deletion-key-'.repeat(3) }, ids: { browserIds: [browserId] }, now, stopUmami: async () => { stopCalled = true; return stopped(); }, startUmami: started, rollup: async () => {} });
      await new Promise(resolve => setTimeout(resolve, 80));
      assert.equal(stopCalled, false);
      await c.query('SELECT pg_advisory_unlock_shared(7104,1)'); c.release();
      await pending; assert.equal(stopCalled, true);
    });
    await clear(leads, umami);
  } finally { await leads.end(); await umami.end(); }
});
