import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { loadConfig } from './config.mjs';
import { createPool, migrate, setHealth } from './db.mjs';
import { drainOutbox } from './outbox.mjs';
import { runHourlyJob } from './jobs.mjs';
import { startCollector } from './serve.mjs';
import { createDeletionJournal } from './journal.mjs';
import { runRetention, eraseIdentifiers, replayDeletionJournal } from './maintenance.mjs';
import { recomputeDailyAggregates } from './metrics.mjs';
import { objectStoreFromEnv } from './object-store.mjs';
import { backupDatabases, downloadVerifiedSnapshot } from './backup.mjs';

function safeLog(action, status) { process.stdout.write(JSON.stringify({ action, status, at: new Date().toISOString() }) + '\n'); }
function publicCollector(env) {
  const value = new URL(env.COLLECTOR_PUBLIC_URL || '');
  if (value.protocol !== 'https:' || value.username || value.password || value.pathname !== '/' || value.search || value.hash) throw new Error('Public collector URL must be an HTTPS origin');
  return value;
}

async function runProbe(pool, config, env) {
  const origin = publicCollector(env);
  const eventId = randomUUID();
  const event = { schemaVersion: 1, eventId, browserId: randomUUID(), sessionId: randomUUID(), name: 'page_view', page: '/index.html', product: 'unsure', application: 'unsure', campaignCode: '', source: '', medium: '', referrerHost: '', language: 'en', screenClass: 'desktop', clientTimestamp: Date.now() };
  try {
    const response = await fetch(new URL('/v1/events', origin), { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json', Origin: config.origins[0], Authorization: `Bearer ${config.adminToken}` }, body: JSON.stringify(event), signal: AbortSignal.timeout(6000) });
    if (response.status !== 202) throw new Error('Probe rejected');
    const record = await pool.query('SELECT is_qa FROM events WHERE event_id=$1', [eventId]);
    if (record.rows[0]?.is_qa !== true) throw new Error('Probe QA isolation not verified');
    await drainOutbox(pool, config, { limit: 50 });
    const outbox = await pool.query('SELECT status FROM analytics_outbox WHERE event_id=$1', [eventId]);
    if (outbox.rows[0]?.status !== 'forwarded') throw new Error('Probe forwarding not verified');
    await setHealth(pool, 'synthetic_probe', 'ok', { http: true, database: true, forwarding: true }, true);
  } catch {
    await setHealth(pool, 'synthetic_probe', 'degraded', { reason: 'probe_failed' });
    throw new Error('Synthetic probe incomplete');
  }
}

async function main() {
  const command = process.argv[2] || 'serve';
  if (command === 'migrate') {
    if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL || '')) throw new Error('Database URL unavailable');
    const pool = createPool({ databaseUrl: process.env.DATABASE_URL });
    try { if (!(await migrate(pool)).locked) throw new Error('Migration already running'); safeLog('migrate', 'complete'); }
    finally { await pool.end(); }
    return;
  }
  const config = loadConfig();
  const pool = createPool(config, { max: command === 'serve' ? 5 : 2 });
  if (command === 'serve') {
    await startCollector({ pool, config, onReady: () => safeLog('serve', 'ready') });
    return;
  }
  let umamiPool;
  try {
    if (command === 'hourly') {
      const last = await pool.query("SELECT last_success FROM health_checks WHERE name='synthetic_probe'");
      if (!last.rows[0]?.last_success || +new Date(last.rows[0].last_success) < Date.now() - 86400000) await runProbe(pool, config, process.env).catch(() => {});
      await runHourlyJob({ pool, config });
    } else if (command === 'probe') {
      await runProbe(pool, config, process.env);
    } else if (command === 'initialize-journal') {
      // Provision once in the empty durable store. Recovery never initializes it.
      const journal = createDeletionJournal({ store: objectStoreFromEnv(), key: process.env.JOURNAL_ENCRYPTION_KEY, websiteId: config.umamiWebsiteId, installationId: process.env.JOURNAL_INSTALLATION_ID });
      await journal.initialize();
    } else if (command === 'backup') {
      await backupDatabases({ store: objectStoreFromEnv(), databases: { farpoint_leads: config.databaseUrl, umami: process.env.UMAMI_MAINTENANCE_DATABASE_URL }, encryptionKey: process.env.BACKUP_ENCRYPTION_KEY });
      await setHealth(pool, 'backup', 'ok', { verifiedReadBack: true }, true);
    } else if (command === 'download-restore') {
      if (!process.argv[3] || !process.argv[4]) throw new Error('Snapshot key and private output path required');
      await downloadVerifiedSnapshot({ store: objectStoreFromEnv(), key: process.argv[3], destination: process.argv[4], encryptionKey: process.env.BACKUP_ENCRYPTION_KEY });
    } else if (['maintenance', 'erase', 'recover'].includes(command)) {
      if (!process.env.UMAMI_MAINTENANCE_DATABASE_URL) throw new Error('Maintenance database credential unavailable');
      umamiPool = createPool({ databaseUrl: process.env.UMAMI_MAINTENANCE_DATABASE_URL }, { max: 2 });
      const options = { leadPool: pool, umamiPool, config, rollup: recomputeDailyAggregates };
      if (process.env.NORTHFLANK_API_TOKEN) {
        const { createNorthflankLifecycle, loadNorthflankLifecycleConfig } = await import('./host-lifecycle.mjs');
        Object.assign(options, createNorthflankLifecycle(loadNorthflankLifecycleConfig(process.env)));
      }
      if (command === 'maintenance') {
        const journal = createDeletionJournal({ store: objectStoreFromEnv(), key: process.env.JOURNAL_ENCRYPTION_KEY, websiteId: config.umamiWebsiteId, installationId: process.env.JOURNAL_INSTALLATION_ID });
        await journal.pruneExpired({ now: new Date() });
        await runRetention(options);
        await backupDatabases({ store: objectStoreFromEnv(), databases: { farpoint_leads: config.databaseUrl, umami: process.env.UMAMI_MAINTENANCE_DATABASE_URL }, encryptionKey: process.env.BACKUP_ENCRYPTION_KEY });
        await setHealth(pool, 'backup', 'ok', { verifiedReadBack: true }, true);
      } else {
        options.journal = createDeletionJournal({ store: objectStoreFromEnv(), key: process.env.JOURNAL_ENCRYPTION_KEY, websiteId: config.umamiWebsiteId, installationId: process.env.JOURNAL_INSTALLATION_ID });
        if (command === 'erase') {
          // Operator supplies a private JSON file. Never put IDs in command-line arguments.
          if (!process.argv[3]) throw new Error('Private erasure request file required');
          const data = await readFile(process.argv[3]);
          if (data.length > 256 * 1024) throw new Error('Erasure request too large');
          const request = JSON.parse(data);
          await eraseIdentifiers({ ...options, ids: request.ids, requestId: request.requestId });
        } else await replayDeletionJournal(options);
      }
      await setHealth(pool, 'maintenance', 'ok', { verified: true }, true);
    } else throw new Error('Unknown runtime command');
    safeLog(command, 'complete');
  } catch (error) {
    await setHealth(pool, command === 'maintenance' || command === 'backup' ? command : 'runtime', 'degraded', { reason: 'command_failed' }).catch(() => {});
    throw error;
  } finally { if (umamiPool) await umamiPool.end(); await pool.end(); }
}

main().catch(() => { process.stderr.write('runtime_command_failed\n'); process.exitCode = 1; });
