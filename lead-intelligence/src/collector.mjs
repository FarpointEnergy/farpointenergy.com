import { canonicalHash, knownBot, HttpError } from './validation.mjs';
import { advisoryKey, assertPrivacyAllowed, privacyHash, reserveQuota, setHealth, withPrivacyLock } from './db.mjs';
import { enrichNetwork, networkHash } from './enrichment.mjs';

export function umamiPayload(event, config, receivedAt, { qa = false } = {}) {
  const payload = { website: qa ? config.umamiQaWebsiteId : config.umamiWebsiteId, hostname: config.umamiHostname, url: event.page,
    id: event.browserId, ip: '0.0.0.0', userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    // The generic non-bot UA is a stable session input, not evidence about the visitor's software.
    browser: '', os: '',
    language: event.language === 'other' ? '' : event.language, device: event.screenClass === 'desktop' ? 'desktop' : event.screenClass,
    timestamp: Math.floor(+receivedAt / 1000), data: { product: event.product, application: event.application } };
  if (event.name !== 'page_view') payload.name = event.name;
  if (event.referrerHost && event.referrerHost !== 'other') payload.referrer = `https://${event.referrerHost}/`;
  if (event.campaignCode) Object.assign(payload.data, { campaign: event.campaignCode, source: event.source, medium: event.medium });
  // No inquiryID in the secondary analytics database: joins stay in the protected canonical store.
  return { type: 'event', payload };
}

/** Privacy/session lock covers both committed quota reservation and bounded enrichment. */
export async function ingestEvent(pool, config, event, { sourceIp = null, userAgent = '', qa = config.qa, fetchImpl = fetch, now = new Date() } = {}) {
  const result = await withPrivacyLock(pool, async client => {
    // Serialize duplicate retries before enrichment/quota work; no duplicate spends a lookup.
    const key = advisoryKey(`event:${event.eventId}`);
    await client.query('SELECT pg_advisory_lock($1::bigint)', [key]);
    try {
      await client.query('BEGIN');
      let duplicate;
      try {
        const privacy = await assertPrivacyAllowed(client, config, { browserId: event.browserId, inquiryId: event.inquiryId });
        if (!privacy.allowed) { await client.query('ROLLBACK'); return privacy.reason === 'erased' ? { accepted: true, suppressed: true } : { deferred: true }; }
        duplicate = (await client.query('SELECT payload_hash FROM events WHERE event_id=$1', [event.eventId])).rows[0];
        if (duplicate) {
          if (duplicate.payload_hash !== canonicalHash(event)) throw new HttpError(409, 'event_id_conflict');
          await client.query('COMMIT'); return { accepted: true, duplicate: true };
        }
        const minute = new Date(Math.floor(+now / 60000) * 60000);
        const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const quotas = [[`browser:${privacyHash('browser', event.browserId, config.deletionSecret)}`, minute, config.limits.browserPerMinute, new Date(+minute + 86400000)],
          ['events', day, config.limits.eventsPerDay, new Date(+day + 86400000)]];
        if (sourceIp) quotas.push([`source:${networkHash(sourceIp, config.hmacSecret)}`, minute, config.limits.sourcePerMinute, new Date(+minute + 86400000)]);
        // Sorted lock order prevents quota-key deadlocks across concurrent clients.
        quotas.sort((a, b) => a[0].localeCompare(b[0]));
        for (const args of quotas) if (!await reserveQuota(client, ...args)) throw new HttpError(429, 'rate_limited');
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      const bot = knownBot(userAgent);
      // Enrichment reservation commits before HTTP I/O; a crash consumes quota rather than exceeding it.
      const network = bot || qa ? { evidence: { status: 'unavailable', reason: bot ? 'bot' : 'qa' }, key: null }
        : await enrichNetwork(client, config, sourceIp, { fetchImpl, now });
      await client.query('BEGIN');
      try {
        const privacy = await assertPrivacyAllowed(client, config, { browserId: event.browserId, inquiryId: event.inquiryId });
        if (!privacy.allowed) { await client.query('ROLLBACK'); return { accepted: true, suppressed: true }; }
        await client.query(`INSERT INTO events(event_id,payload_hash,received_at,event_name,page,browser_id,session_id,product,application,campaign_code,source,medium,referrer_host,language,screen_class,client_timestamp,inquiry_id,network_key,network_evidence,is_qa,is_bot,payload)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
        [event.eventId, canonicalHash(event), now, event.name, event.page, event.browserId, event.sessionId, event.product, event.application,
          event.campaignCode, event.source, event.medium, event.referrerHost, event.language, event.screenClass, event.clientTimestamp, event.inquiryId || null,
          network.key, network.evidence, Boolean(qa), bot, event]);
        await client.query(`INSERT INTO analytics_outbox(event_id,browser_id,inquiry_id,payload,status,last_error,created_at,updated_at)
          VALUES($1,$2,$3,$4,$5,$6,$7,$7)`, [event.eventId, event.browserId, event.inquiryId || null, umamiPayload(event, config, now, { qa: Boolean(qa) }),
          bot ? 'suppressed' : 'pending', bot ? 'known_bot' : null, now]);
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      await setHealth(client, 'collector', 'ok', { eventAccepted: true }, true);
      return { accepted: true, duplicate: false };
    } finally { await client.query('SELECT pg_advisory_unlock($1::bigint)', [key]).catch(() => {}); }
  });
  if (!result.allowed || result.value?.deferred) throw new HttpError(503, 'temporarily_unavailable');
  return result.value;
}
