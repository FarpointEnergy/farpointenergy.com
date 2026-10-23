// Synthetic-only integration against the exact production Umami image. Never
// accepts a production DB or sends Gmail. Docker is used only in the CI runner.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { loadConfig } from '../src/config.mjs';
import { createPool, migrate } from '../src/db.mjs';
import { createServer } from '../src/server.mjs';
import { drainOutbox } from '../src/outbox.mjs';
import { purgeUmamiIdentifiers, verifyUmamiSchema } from '../src/maintenance.mjs';

const IMAGE = 'ghcr.io/umami-software/umami:3.4.0@sha256:85909afc45bdcda1917394594a087421fdbb05610fded0fa9f6fb861abb2f367';
if (process.env.NODE_ENV !== 'test' || !new URL(process.env.DATABASE_URL).pathname.endsWith('_test') || !new URL(process.env.UMAMI_TEST_DATABASE_URL).pathname.endsWith('/umami_test')) throw new Error('Only isolated synthetic test databases are allowed');
const task = process.argv[2];
function docker(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    // No provider response or environment is emitted to CI output.
    child.stdout.resume(); child.stderr.resume();
    child.on('error', () => reject(new Error('Docker unavailable')));
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('Synthetic Umami container operation failed')));
  });
}
if (task === 'prepare') {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try { if (!(await pool.query("SELECT 1 FROM pg_database WHERE datname='umami_test'")).rowCount) await pool.query('CREATE DATABASE umami_test'); }
  finally { await pool.end(); }
} else if (task === 'start') {
  await docker(['run', '--detach', '--name', 'farpoint-umami-ci', '--network', 'host', '-e', 'DATABASE_URL', '-e', 'APP_SECRET', '-e', 'TWO_FACTOR_ENCRYPTION_KEY', '-e', 'DISABLE_TELEMETRY=1', '-e', 'HOSTNAME=127.0.0.1', '-e', 'PORT=3000', IMAGE],
    { ...process.env, DATABASE_URL: process.env.UMAMI_TEST_DATABASE_URL, APP_SECRET: 'synthetic-ci-only-umami-secret-00000000000', TWO_FACTOR_ENCRYPTION_KEY: 'a'.repeat(64) });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch('http://127.0.0.1:3000/api/heartbeat', { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch { /* bounded readiness polling */ }
    await setTimeout(1000);
  }
  assert.equal(ready, true, 'Pinned Umami must become healthy');
} else if (task === 'verify') {
  const websiteId = randomUUID(), productionWebsiteId = randomUUID(), browserId = randomUUID(), sessionId = randomUUID();
  const config = loadConfig({ ...process.env, UMAMI_URL: 'http://127.0.0.1:3000', UMAMI_WEBSITE_ID: productionWebsiteId, UMAMI_QA_WEBSITE_ID: websiteId, QA_ENVIRONMENT: 'true' });
  const pool = createPool(config), umami = new pg.Pool({ connectionString: process.env.UMAMI_TEST_DATABASE_URL });
  let server;
  try {
    await migrate(pool);
    await verifyUmamiSchema(umami);
    await umami.query('INSERT INTO website(website_id,name,domain) VALUES($1,$2,$3)', [websiteId, 'Synthetic CI only', 'farpointenergy.com']);
    await umami.query('INSERT INTO website(website_id,name,domain) VALUES($1,$2,$3)', [productionWebsiteId, 'Production separation fixture', 'farpointenergy.com']);
    server = createServer({ pool, config });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const endpoint = `http://127.0.0.1:${server.address().port}/v1/events`;
    const base = { schemaVersion: 1, browserId, sessionId, page: '/quote.html', product: 'power', application: 'utility', campaignCode: '', source: '', medium: '', referrerHost: 'google.com', language: 'en', screenClass: 'desktop', clientTimestamp: Date.now() };
    const events = [{ ...base, eventId: randomUUID(), name: 'page_view' }, { ...base, eventId: randomUUID(), name: 'rfq_start' }];
    for (const event of events) {
      const response = await fetch(endpoint, { method: 'POST', headers: { Origin: config.origins[0], 'Content-Type': 'application/json' }, body: JSON.stringify(event) });
      assert.equal(response.status, 202);
    }
    const duplicate = await fetch(endpoint, { method: 'POST', headers: { Origin: config.origins[0], 'Content-Type': 'application/json' }, body: JSON.stringify(events[0]) });
    assert.equal((await duplicate.json()).duplicate, true);
    const forwarded = await drainOutbox(pool, config);
    assert.equal(forwarded.forwarded, 2, 'Both sanitized events must persist upstream');
    const stored = (await umami.query('SELECT url_path,url_query,referrer_query,event_name,created_at FROM website_event WHERE website_id=$1 ORDER BY created_at', [websiteId])).rows;
    assert.equal(stored.length, 2);
    assert.ok(stored.every(r => r.url_path === '/quote.html' && !r.url_query && !r.referrer_query));
    assert.equal(stored.filter(r => r.event_name === 'rfq_start').length, 1);
    const sessions = (await umami.query('SELECT distinct_id,country,browser,os FROM session WHERE website_id=$1', [websiteId])).rows;
    assert.equal(sessions.length, 1); assert.equal(sessions[0].distinct_id, browserId); assert.ok(!sessions[0].country);
    assert.ok(!sessions[0].browser && !sessions[0].os, 'Omitted browser fingerprints must not become invented Chrome/Linux data');
    assert.equal(Number((await umami.query('SELECT count(*) FROM website_event WHERE website_id=$1', [productionWebsiteId])).rows[0].count), 0, 'QA traffic must not inflate the production dashboard');
    assert.equal(Number((await pool.query('SELECT count(*) FROM events WHERE browser_id=$1', [browserId])).rows[0].count), 2);
    await docker(['stop', 'farpoint-umami-ci']);
    const offline = { ...base, eventId: randomUUID(), name: 'email_click', clientTimestamp: Date.now() };
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { Origin: config.origins[0], 'Content-Type': 'application/json' }, body: JSON.stringify(offline) })).status, 202);
    assert.equal((await drainOutbox(pool, config)).retry, 1, 'Unavailable Umami cannot break collection');
    const client = await umami.connect();
    try {
      await client.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='umami_maintenance_ci') THEN CREATE ROLE umami_maintenance_ci NOLOGIN; END IF; END $$");
      await client.query('GRANT USAGE ON SCHEMA public TO umami_maintenance_ci');
      await client.query('GRANT SELECT ON ALL TABLES IN SCHEMA public TO umami_maintenance_ci');
      await client.query('GRANT DELETE ON session,session_link,website_event,event_data,session_data,revenue,session_replay,session_replay_saved,heatmap_event TO umami_maintenance_ci');
      await client.query('GRANT TEMPORARY ON DATABASE umami_test TO umami_maintenance_ci');
      await client.query('SET ROLE umami_maintenance_ci');
      for (const table of ['user', 'app_setting', 'api_key']) {
        await assert.rejects(client.query(`DELETE FROM "${table}" WHERE false`), error => error.code === '42501');
      }
      await purgeUmamiIdentifiers(client, { websiteId, browserIds: [browserId] });
    } finally { await client.query('RESET ROLE'); client.release(); }
    assert.equal(Number((await umami.query('SELECT count(*) FROM session WHERE website_id=$1', [websiteId])).rows[0].count), 0);
    assert.equal(Number((await umami.query('SELECT count(*) FROM website_event WHERE website_id=$1', [websiteId])).rows[0].count), 0);
    process.stdout.write('Pinned Umami: actual ingestion, browser identity, sanitized storage, outage isolation and purge verified.\n');
  } finally {
    if (server) await new Promise(resolve => server.close(resolve));
    await pool.end(); await umami.end();
  }
} else throw new Error('Expected prepare, start or verify');
