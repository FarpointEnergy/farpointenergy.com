import pg from 'pg';
import { createHmac, createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { UUID } from './validation.mjs';

export function createPool(config, { max = 5 } = {}) {
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max, statement_timeout: 5000, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000 });
  // Error messages can contain infrastructure credentials: surface only a safe code to stderr.
  pool.on('error', () => process.stderr.write('database_pool_error\n'));
  return pool;
}
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try { await client.query('BEGIN'); const value = await fn(client); await client.query('COMMIT'); return value; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { client.release(); }
}
export function advisoryKey(value) { return createHash('sha256').update(String(value)).digest().readBigInt64BE(0).toString(); }
export async function withAdvisoryLock(pool, key, fn) {
  const client = await pool.connect();
  let locked = false;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [advisoryKey(key)])).rows[0].locked;
    if (!locked) return { locked: false };
    return { locked: true, value: await fn(client) };
  } finally { if (locked) await client.query('SELECT pg_advisory_unlock($1::bigint)', [advisoryKey(key)]).catch(() => {}); client.release(); }
}
export async function migrate(pool) {
  return withAdvisoryLock(pool, 'farpoint:migrations', async client => {
    const schema = (await client.query('SELECT current_schema() AS name')).rows[0]?.name;
    if (!schema) throw new Error('Database schema unavailable');
    const migrations = `"${schema.replaceAll('"', '""')}".schema_migrations`;
    await client.query(`CREATE TABLE IF NOT EXISTS ${migrations}(version integer PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())`);
    const dir = new URL('../migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(f => /^\d+_.*\.sql$/.test(f)).sort()) {
      const version = Number(file.split('_')[0]);
      if ((await client.query(`SELECT 1 FROM ${migrations} WHERE version=$1`, [version])).rowCount) continue;
      await client.query('BEGIN');
      try { await client.query(await readFile(new URL(file, dir), 'utf8')); await client.query(`INSERT INTO ${migrations}(version) VALUES ($1)`, [version]); await client.query('COMMIT'); }
      catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  });
}
export function privacyHash(kind, id, secret) {
  if (!['browser', 'inquiry', 'gmail'].includes(kind) || typeof id !== 'string' || typeof secret !== 'string' || secret.length < 32) throw new Error('Invalid privacy key input');
  const normalized = kind === 'gmail' ? id : id.toLowerCase();
  if (kind === 'gmail' ? !/^[a-zA-Z0-9_-]{1,128}$/.test(normalized) : !UUID.test(normalized)) throw new Error('Invalid privacy identity');
  return createHmac('sha256', secret).update(`${kind}:${normalized}`).digest('hex');
}
export async function privacyGate(client) {
  const { rows } = await client.query("SELECT value FROM system_state WHERE key='privacy_maintenance'");
  // Missing gate is a schema/recovery fault, never permission to collect.
  return rows.length !== 1 || rows[0].value?.active !== false;
}
export async function checkTombstones(client, config, identities = {}) {
  for (const [property, kind] of [['browserId', 'browser'], ['gmailMessageId', 'gmail'], ['inquiryId', 'inquiry']]) {
    if (!identities[property]) continue;
    const found = await client.query('SELECT 1 FROM privacy_tombstones WHERE kind=$1 AND key_hash=$2 AND expires_at>now()', [kind, privacyHash(kind, identities[property], config.deletionSecret)]);
    if (found.rowCount) return true;
  }
  return false;
}
export async function assertPrivacyAllowed(client, config, identities = {}) {
  await client.query('SELECT pg_advisory_xact_lock_shared(7104,1)');
  if (await privacyGate(client)) return { allowed: false, reason: 'maintenance' };
  if (await checkTombstones(client, config, identities)) return { allowed: false, reason: 'erased' };
  return { allowed: true };
}
export async function withPrivacyLock(pool, fn) {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock_shared(7104,1)'); locked = true;
    if (await privacyGate(client)) return { allowed: false, reason: 'maintenance' };
    return { allowed: true, value: await fn(client) };
  } finally { if (locked) await client.query('SELECT pg_advisory_unlock_shared(7104,1)').catch(() => {}); client.release(); }
}
export async function setHealth(pool, name, status, detail = {}, success = false) {
  if (!/^[a-z0-9_.:-]{1,64}$/.test(name) || !/^[a-z_]{1,32}$/.test(status)) throw new Error('Invalid health key');
  const encoded = JSON.stringify(detail);
  if (Buffer.byteLength(encoded) > 4096) throw new Error('Health detail too large');
  await pool.query(`INSERT INTO health_checks(name,last_success,last_attempt,status,detail) VALUES($1,CASE WHEN $4 THEN now() END,now(),$2,$3::jsonb)
    ON CONFLICT(name) DO UPDATE SET last_attempt=now(),status=$2,detail=$3::jsonb,last_success=CASE WHEN $4 THEN now() ELSE health_checks.last_success END`, [name, status, encoded, success]);
  // Preserve state changes and hourly continuity without one history row per page view.
  await pool.query(`WITH previous AS (SELECT status,detail,observed_at FROM health_history WHERE name=$1::varchar ORDER BY observed_at DESC,id DESC LIMIT 1)
    INSERT INTO health_history(name,status,detail) SELECT $1::varchar,$2::varchar,$3::jsonb WHERE NOT EXISTS(SELECT 1 FROM previous)
      OR EXISTS(SELECT 1 FROM previous WHERE status<>$2::varchar OR detail IS DISTINCT FROM $3::jsonb OR observed_at<now()-interval '1 hour')`, [name, status, encoded]);
}
/** Atomic quota reservation; rejected reservations do not increment the count. */
export async function reserveQuota(client, scope, bucket, limit, expiresAt) {
  const result = await client.query(`INSERT INTO quotas(scope,bucket,used,expires_at) VALUES($1,$2,1,$4)
    ON CONFLICT(scope,bucket) DO UPDATE SET used=quotas.used+1 WHERE quotas.used<$3 RETURNING used`, [scope, bucket, limit, expiresAt]);
  return result.rowCount === 1;
}
