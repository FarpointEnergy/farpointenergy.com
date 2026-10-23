import { randomUUID } from 'node:crypto';
import { checkTombstones, setHealth, withPrivacyLock } from './db.mjs';
import { readBoundedJson } from './enrichment.mjs';

export async function outboxHealth(client) {
  const { rows: [row] } = await client.query(`SELECT count(*) FILTER(WHERE status='dead_letter')::int AS dead_letters,
    count(*) FILTER(WHERE status IN ('pending','leased'))::int AS pending,
    extract(epoch from (now()-min(created_at) FILTER(WHERE status IN ('pending','leased'))))::int AS oldest_seconds
    FROM analytics_outbox`);
  return { ...row, status: row.dead_letters || row.oldest_seconds > 900 ? 'degraded' : 'ok' };
}
export function classifyUmamiResponse(status, body) {
  if (status >= 200 && status < 300) {
    if (body?.beep === 'boop') return 'suppressed';
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    if (uuid.test(body?.sessionId) && uuid.test(body?.visitId) && typeof body?.cache === 'string' && body.cache.length > 10) return 'forwarded';
    return 'retry';
  }
  return status >= 400 && status < 500 && status !== 408 && status !== 429 ? 'dead_letter' : 'retry';
}
export async function drainOutbox(pool, config, { fetchImpl = fetch, limit = 20, random = Math.random, now = new Date() } = {}) {
  if (!config.umamiUrl) { await setHealth(pool, 'outbox', 'degraded', { reason: 'umami_unconfigured' }); return { deferred: true }; }
  const totals = { forwarded: 0, suppressed: 0, retry: 0, dead_letter: 0, expired: 0 };
  for (let n = 0; n < limit; n++) {
    const result = await withPrivacyLock(pool, async client => {
      await client.query('BEGIN');
      let row;
      const lease = randomUUID();
      try {
        await client.query(`UPDATE analytics_outbox SET status='dead_letter',last_error='attempts_exhausted',updated_at=$1
          WHERE attempts>=10 AND (status='pending' OR (status='leased' AND lease_until<$1))`, [now]);
        row = (await client.query(`WITH candidate AS (
          SELECT event_id FROM analytics_outbox WHERE attempts<10 AND ((status='pending' AND next_attempt<=$1) OR (status='leased' AND lease_until<$1))
          ORDER BY next_attempt,event_id FOR UPDATE SKIP LOCKED LIMIT 1)
          UPDATE analytics_outbox o SET status='leased',lease_token=$2,lease_until=$1::timestamptz+interval '2 minutes',attempts=attempts+1,updated_at=$1
          FROM candidate c WHERE o.event_id=c.event_id RETURNING o.*`, [now, lease])).rows[0];
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      if (!row) return null;
      const source = (await client.query('SELECT received_at FROM events WHERE event_id=$1', [row.event_id])).rows[0];
      const erased = await checkTombstones(client, config, { browserId: row.browser_id, inquiryId: row.inquiry_id });
      const expired = source && +now - +source.received_at > 48 * 3600000;
      if (!source || erased || expired) {
        await client.query('DELETE FROM analytics_outbox WHERE event_id=$1 AND lease_token=$2', [row.event_id, lease]);
        if (expired) await setHealth(client, 'outbox_expiry', 'degraded', { reason: 'unforwarded_event_expired' });
        return expired ? 'expired' : 'suppressed';
      }
      let outcome = 'retry';
      try {
        const response = await fetchImpl(new URL('/api/send', config.umamiUrl), { method: 'POST', redirect: 'error',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(row.payload), signal: AbortSignal.timeout(5000) });
        let body; try { body = await readBoundedJson(response, 16384); } catch { body = null; }
        outcome = classifyUmamiResponse(response.status, body);
      } catch { /* A timeout can already have inserted remotely; retry is at-least-once. */ }
      if (outcome === 'retry' && row.attempts >= 10) outcome = 'dead_letter';
      const delay = Math.min(21600000, 30000 * (2 ** (row.attempts - 1))) + Math.floor(random() * 5000);
      await client.query(`UPDATE analytics_outbox SET status=$3,next_attempt=$4,lease_until=NULL,lease_token=NULL,last_error=$5,updated_at=$6
        WHERE event_id=$1 AND lease_token=$2`, [row.event_id, lease, outcome === 'retry' ? 'pending' : outcome,
        new Date(+now + delay), outcome === 'retry' ? 'upstream_uncertain' : outcome === 'dead_letter' ? 'upstream_failed' : null, now]);
      return outcome;
    });
    if (!result.allowed || !result.value) break;
    totals[result.value]++;
  }
  const health = await outboxHealth(pool);
  await setHealth(pool, 'outbox', health.status, { pending: health.pending, deadLetters: health.dead_letters, oldestSeconds: health.oldest_seconds }, health.status === 'ok');
  return totals;
}
