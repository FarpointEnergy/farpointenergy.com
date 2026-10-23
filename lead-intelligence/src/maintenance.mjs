import { randomUUID } from 'node:crypto';
import { privacyHash } from './db.mjs';

export const UMAMI_VERSION = '3.4.0';
export const UMAMI_COMMIT = 'ec0ff50388c264ed8ce46f00967e92f7e71476ae';
const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
// SHA256 of every official migration at UMAMI_COMMIT. Refuse an unreviewed schema.
export const UMAMI_MIGRATIONS = Object.freeze({
  '01_init': '65f0f9ee4a3b432e7fa917795033254887497a849d95acf7d9cb4ff24b45f98f',
  '02_report_schema_session_data': '4cc3c14482cb8700574cbdbdb478a93ccd1cabb0aeed37dfffb77a80278ce575',
  '03_metric_performance_index': 'baf86a7adc077bc46ea646d86aabc5f613aeb311e63894366979a18f6a9ca48c',
  '04_team_redesign': 'eb0e4ae2ef5204bc67ddb248358a402cd3bd88567d710f808f16c5124e5fd9cb',
  '05_add_visit_id': '12e5b277e41da871b0768118937cef221c4d4f9c3206b719fffba86324df7a11',
  '06_session_data': 'fcd8585d077229bb2a16ae4705a79a5bc31cf6cbca089de99f4b1c19cb0a0a17',
  '07_add_tag': 'c38c9605d759b3b00f94076c929b6081d7dbd01a25d2955909fc8d1a6e3276b4',
  '08_add_utm_clid': 'ad640f709cd22434c088d577a2cf124c275fe3dc53ca249a542ae05af66b07b6',
  '09_update_hostname_region': 'e94d9993b17ac5c330ae3f872fd5869fb8095a3f3a7d31d2aaade73dc45fbe9c',
  '10_add_distinct_id': '6ece5066ccec715ca8a07b65eafde7f96d110c0638b2d2187398fd1a79770ff6',
  '11_add_segment': 'e7421573e8b15f8a5c3e0928f1564ab43b3855d7c6634a36d87ece68196900e5',
  '12_update_report_parameter': 'f74b307b6e62c8457f32c4bae0beb99e26eb384467755912714abdfeae9e09af',
  '13_add_revenue': '53180616f450ac033a60143ff9b7c3656205947809c7979a51991922e7f326ad',
  '14_add_link_and_pixel': '2017fc23cad1365fa62fe1c18b70c631eb6a119a902f88672ffad63f90d80f3d',
  '15_add_share': '11e97bd1bd36611c473ca7f518a8c8c1e66fba5b2798e72db224f7e20477eb74',
  '16_boards': '5cef1484333ad14bcbbc3e1b2262601d3274a072d9656fb422530d112f98b447',
  '17_remove_duplicate_key': '19ef24e157ab33d7a34b13d06c5ffc2eca95ae4f668c1ccbbe219e48a09d13b1',
  '18_add_performance': '4ab4d1d954adfd3e65a327797b8fa2a528aa4377cbe03e2bd79b1d1c33c3b6ae',
  '19_add_session_replay': 'd0b6047a369c8aa04813fb06ac012c731777a9f3d602d491119f47e57aa2ec09',
  '20_add_heatmap': 'a52c3ae18fcfd73a49e5eaf445f701f0a6978abc96b8a0009aa27b100501663b',
  '21_add_session_link': '10b4a7ba0b04bc14703b85787f66dfc6a83cd70abf80bcd528c83966c1effa7c',
  '22_add_2fa': 'e1e8a160496540e0b2fd28610a92f8b0a1b3e4fc1c857ca1d7f890e3667571b4',
  '23_update_session_data': '5fc778b82bb34c3c04d78061e66d7036c3c51d0c506f5279f3c1cfc99f24f694',
  '24_lowercase_username': '857c15672654ed5691a104aa1197e761718cbe75de0024c54d813ea19737bdba',
  '25_add_annotation': '6da67237e4d1516853a84997ebe9ecfd65fc38187d0561d98a836c437085187d',
  '26_add_api_key': '08463808a2c091e2662e1cfae4c6736b3a3fa7c6931abe5fac32cef4b21954e9',
});

function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('Invalid maintenance identifier');
  return value;
}
function instant(value) {
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw new Error('Invalid maintenance time');
  return result;
}
async function transaction(client, fn) {
  await client.query('BEGIN');
  try { const result = await fn(); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
}
async function withExclusivePrivacy(pool, fn) {
  const client = await pool.connect();
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(7104,1)'); locked = true;
    return await fn(client);
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(7104,1)').catch(() => {});
    client.release();
  }
}
export async function setMaintenanceGate(client, active, metadata = {}) {
  await client.query(`INSERT INTO system_state(key,value,updated_at) VALUES('privacy_maintenance',$1::jsonb,now())
    ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at`, [JSON.stringify({ ...metadata, active })]);
}
export async function verifyUmamiSchema(client) {
  const result = await client.query(`SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations WHERE rolled_back_at IS NULL ORDER BY migration_name`);
  if (result.rows.length !== Object.keys(UMAMI_MIGRATIONS).length || result.rows.some(row => !row.finished_at || UMAMI_MIGRATIONS[row.migration_name] !== row.checksum)) {
    throw new Error('Umami schema does not match reviewed version 3.4.0');
  }
}
async function verifyEmpty(client, sql, values = []) {
  const result = await client.query(sql, values);
  if (Number(result.rows[0].count) !== 0) throw new Error('Privacy deletion verification failed');
}

/** Uses the exact v3.4.0 dependency graph, independent of Prisma cascade behavior. */
export async function purgeUmamiIdentifiers(client, { websiteId, browserIds }) {
  uuid(websiteId); browserIds.forEach(uuid);
  await verifyUmamiSchema(client);
  return transaction(client, async () => {
    await client.query('SET LOCAL search_path TO public, pg_temp');
    const values = [websiteId, browserIds];
    await client.query(`CREATE TEMP TABLE pg_temp.purge_sessions ON COMMIT DROP AS
      SELECT session_id FROM session WHERE website_id=$1::uuid AND distinct_id=ANY($2::text[])
      UNION SELECT session_id FROM session_link WHERE website_id=$1::uuid AND distinct_id=ANY($2::text[])
      UNION SELECT session_id FROM session_data WHERE website_id=$1::uuid AND distinct_id=ANY($2::text[])`, values);
    await client.query(`CREATE TEMP TABLE pg_temp.purge_events ON COMMIT DROP AS SELECT event_id,visit_id FROM website_event
      WHERE website_id=$1::uuid AND session_id IN(SELECT session_id FROM pg_temp.purge_sessions)`, [websiteId]);
    await client.query(`CREATE TEMP TABLE pg_temp.purge_visits ON COMMIT DROP AS SELECT visit_id FROM pg_temp.purge_events
      UNION SELECT visit_id FROM session_replay WHERE website_id=$1::uuid AND session_id IN(SELECT session_id FROM pg_temp.purge_sessions)
      UNION SELECT visit_id FROM heatmap_event WHERE website_id=$1::uuid AND session_id IN(SELECT session_id FROM pg_temp.purge_sessions)`, [websiteId]);
    const counts = {};
    counts.event_data = (await client.query('DELETE FROM event_data WHERE website_event_id IN(SELECT event_id FROM pg_temp.purge_events)')).rowCount;
    counts.session_replay_saved = (await client.query('DELETE FROM session_replay_saved WHERE website_id=$1::uuid AND visit_id IN(SELECT visit_id FROM pg_temp.purge_visits)', [websiteId])).rowCount;
    for (const table of ['session_replay', 'heatmap_event', 'revenue', 'session_data', 'session_link']) {
      counts[table] = (await client.query(`DELETE FROM ${table} WHERE website_id=$1::uuid AND session_id IN(SELECT session_id FROM pg_temp.purge_sessions)`, [websiteId])).rowCount;
    }
    counts.website_event = (await client.query('DELETE FROM website_event WHERE event_id IN(SELECT event_id FROM pg_temp.purge_events)')).rowCount;
    counts.session = (await client.query('DELETE FROM session WHERE website_id=$1::uuid AND session_id IN(SELECT session_id FROM pg_temp.purge_sessions)', [websiteId])).rowCount;
    await verifyEmpty(client, 'SELECT count(*) FROM event_data WHERE website_event_id IN(SELECT event_id FROM pg_temp.purge_events)');
    await verifyEmpty(client, 'SELECT count(*) FROM session_replay_saved WHERE website_id=$1::uuid AND visit_id IN(SELECT visit_id FROM pg_temp.purge_visits)', [websiteId]);
    for (const table of ['session', 'website_event', 'session_data', 'session_link', 'revenue', 'session_replay', 'heatmap_event']) {
      await verifyEmpty(client, `SELECT count(*) FROM ${table} WHERE website_id=$1::uuid AND session_id IN(SELECT session_id FROM pg_temp.purge_sessions)`, [websiteId]);
    }
    return counts;
  });
}

export async function purgeUmamiRetention(client, { websiteId, cutoff }) {
  uuid(websiteId); cutoff = instant(cutoff);
  await verifyUmamiSchema(client);
  return transaction(client, async () => {
    await client.query('SET LOCAL search_path TO public, pg_temp');
    const values = [websiteId, cutoff];
    await client.query(`CREATE TEMP TABLE pg_temp.expired_events ON COMMIT DROP AS SELECT event_id,visit_id FROM website_event
      WHERE website_id=$1::uuid AND (created_at<$2 OR created_at IS NULL)`, values);
    const counts = {};
    counts.event_data = (await client.query('DELETE FROM event_data WHERE website_event_id IN(SELECT event_id FROM pg_temp.expired_events)')).rowCount;
    counts.website_event = (await client.query('DELETE FROM website_event WHERE event_id IN(SELECT event_id FROM pg_temp.expired_events)')).rowCount;
    for (const table of ['event_data', 'session_data', 'session_link', 'revenue', 'session_replay_saved', 'session_replay', 'heatmap_event']) {
      counts[table] = (counts[table] || 0) + (await client.query(`DELETE FROM ${table} WHERE website_id=$1::uuid AND (created_at<$2 OR created_at IS NULL)`, values)).rowCount;
    }
    await client.query(`CREATE TEMP TABLE pg_temp.expired_sessions ON COMMIT DROP AS SELECT s.session_id FROM session s
      WHERE s.website_id=$1::uuid AND (s.created_at<$2 OR s.created_at IS NULL)
      AND NOT EXISTS(SELECT 1 FROM website_event c WHERE c.session_id=s.session_id)
      AND NOT EXISTS(SELECT 1 FROM session_data c WHERE c.session_id=s.session_id)
      AND NOT EXISTS(SELECT 1 FROM revenue c WHERE c.session_id=s.session_id)
      AND NOT EXISTS(SELECT 1 FROM session_replay c WHERE c.session_id=s.session_id)
      AND NOT EXISTS(SELECT 1 FROM heatmap_event c WHERE c.session_id=s.session_id)`, values);
    counts.session_link += (await client.query('DELETE FROM session_link WHERE website_id=$1::uuid AND session_id IN(SELECT session_id FROM pg_temp.expired_sessions)', [websiteId])).rowCount;
    counts.session = (await client.query('DELETE FROM session WHERE website_id=$1::uuid AND session_id IN(SELECT session_id FROM pg_temp.expired_sessions)', [websiteId])).rowCount;
    for (const table of ['website_event', 'event_data', 'session_data', 'session_link', 'revenue', 'session_replay_saved', 'session_replay', 'heatmap_event']) {
      await verifyEmpty(client, `SELECT count(*) FROM ${table} WHERE website_id=$1::uuid AND (created_at<$2 OR created_at IS NULL)`, values);
    }
    return counts;
  });
}

function normalizeIds(ids, config) {
  const output = {};
  for (const [field, kind] of [['browserIds', 'browser'], ['inquiryIds', 'inquiry'], ['gmailMessageIds', 'gmail']]) {
    const values = ids?.[field] || [];
    if (!Array.isArray(values) || values.length > 1000) throw new Error('Invalid maintenance identifiers');
    output[field] = [...new Set(values.map(value => {
      privacyHash(kind, value, config.deletionSecret);
      return kind === 'gmail' ? value : value.toLowerCase();
    }))].sort();
  }
  if (!Object.values(output).some(values => values.length)) throw new Error('At least one erasure identifier is required');
  return output;
}
async function discoverLinkedIds(client, ids, config) {
  let found = normalizeIds(ids, config);
  // Follow exact random-ID links to closure; never match a name, address or company.
  for (let iteration = 0; iteration < 1000; iteration++) {
    const before = JSON.stringify(found);
    const inquiries = await client.query(`SELECT DISTINCT inquiry_id FROM events WHERE browser_id=ANY($1::uuid[]) AND inquiry_id IS NOT NULL
      UNION SELECT inquiry_id FROM rfq_receipts WHERE gmail_message_id=ANY($2::text[]) AND inquiry_id IS NOT NULL`, [found.browserIds, found.gmailMessageIds]);
    found.inquiryIds = [...new Set([...found.inquiryIds, ...inquiries.rows.map(row => row.inquiry_id)])].sort();
    const receipts = await client.query('SELECT gmail_message_id FROM rfq_receipts WHERE inquiry_id=ANY($1::uuid[])', [found.inquiryIds]);
    found.gmailMessageIds = [...new Set([...found.gmailMessageIds, ...receipts.rows.map(row => row.gmail_message_id)])].sort();
    const browsers = await client.query('SELECT DISTINCT browser_id FROM events WHERE inquiry_id=ANY($1::uuid[])', [found.inquiryIds]);
    found.browserIds = [...new Set([...found.browserIds, ...browsers.rows.map(row => row.browser_id)])].sort();
    found = normalizeIds(found, config);
    if (JSON.stringify(found) === before) return found;
  }
  throw new Error('Erasure identity graph exceeds safety limit');
}
async function writeTombstones(client, record, config) {
  const expires = new Date(Date.parse(record.requestedAt) + 100 * DAY);
  await transaction(client, async () => {
    for (const [field, kind] of [['browserIds', 'browser'], ['inquiryIds', 'inquiry'], ['gmailMessageIds', 'gmail']]) {
      for (const id of record[field]) {
        await client.query(`INSERT INTO privacy_tombstones(kind,key_hash,expires_at,created_at) VALUES($1,$2,$3,$4)
          ON CONFLICT(kind,key_hash) DO UPDATE SET expires_at=GREATEST(privacy_tombstones.expires_at,excluded.expires_at)`,
        [kind, privacyHash(kind, id, config.deletionSecret), expires, record.requestedAt]);
      }
    }
  });
}
async function purgeLeadIdentifiers(client, record) {
  const values = [record.browserIds, record.inquiryIds, record.gmailMessageIds];
  return transaction(client, async () => {
    const outbox = await client.query('DELETE FROM analytics_outbox WHERE browser_id=ANY($1::uuid[]) OR inquiry_id=ANY($2::uuid[])', values.slice(0, 2));
    const events = await client.query('DELETE FROM events WHERE browser_id=ANY($1::uuid[]) OR inquiry_id=ANY($2::uuid[])', values.slice(0, 2));
    const receipts = await client.query('DELETE FROM rfq_receipts WHERE inquiry_id=ANY($1::uuid[]) OR gmail_message_id=ANY($2::text[])', [record.inquiryIds, record.gmailMessageIds]);
    await verifyEmpty(client, 'SELECT count(*) FROM analytics_outbox WHERE browser_id=ANY($1::uuid[]) OR inquiry_id=ANY($2::uuid[])', values.slice(0, 2));
    await verifyEmpty(client, 'SELECT count(*) FROM events WHERE browser_id=ANY($1::uuid[]) OR inquiry_id=ANY($2::uuid[])', values.slice(0, 2));
    await verifyEmpty(client, 'SELECT count(*) FROM rfq_receipts WHERE inquiry_id=ANY($1::uuid[]) OR gmail_message_id=ANY($2::text[])', [record.inquiryIds, record.gmailMessageIds]);
    return { events: events.rowCount, outbox: outbox.rowCount, receipts: receipts.rowCount };
  });
}
function requireAdapters(options) {
  if (!options.journal || typeof options.stopUmami !== 'function' || typeof options.startUmami !== 'function' || typeof options.rollup !== 'function') {
    throw new Error('Verified journal, Umami lifecycle controls and rollup adapter are required');
  }
}
async function stopAndVerify(stopUmami) {
  const evidence = await stopUmami();
  if (!evidence || evidence.state !== 'stopped' || evidence.allInstancesStopped !== true || typeof evidence.verification !== 'string' || !evidence.verification.trim()) {
    throw new Error('All Umami processes must be confirmed stopped by hosting controls');
  }
}
async function startAndVerify(startUmami) {
  const evidence = await startUmami();
  if (!evidence || evidence.state !== 'running' || evidence.privateHealthVerified !== true) throw new Error('Private Umami health verification failed');
}

/** Operator-only API. Adapters must verify hosting control state, not endpoint unreachability. */
export async function eraseIdentifiers(options) {
  const { leadPool, umamiPool, journal, config, ids, stopUmami, startUmami, rollup, requestId = randomUUID() } = options;
  const now = instant(options.now || new Date());
  requireAdapters(options); uuid(config.umamiWebsiteId); uuid(requestId);
  return withExclusivePrivacy(leadPool, async client => {
    const current = (await client.query("SELECT value FROM system_state WHERE key='privacy_maintenance'")).rows[0]?.value;
    if (!current || (current.active !== false && (current.operation !== 'erasure' || current.requestId !== requestId))) {
      throw new Error('Prior privacy operation requires independent journal recovery');
    }
    await setMaintenanceGate(client, true, { operation: 'erasure', requestId });
    // Any failure from here intentionally leaves the persistent gate active.
    let record;
    const prior = (await journal.readRequests({ now, websiteId: config.umamiWebsiteId })).find(item => item.requestId === requestId);
    if (prior) {
      if (ids) {
        const supplied = normalizeIds(ids, config);
        if (Object.keys(supplied).some(field => supplied[field].some(id => !prior[field].includes(id)))) throw new Error('Erasure request does not match its durable journal');
      }
      record = prior;
    }
    else {
      const linked = await discoverLinkedIds(client, ids, config);
      record = await journal.writeRequest({ requestId, requestedAt: now.toISOString(), websiteId: config.umamiWebsiteId, ...linked });
    }
    await writeTombstones(client, record, config);
    await stopAndVerify(stopUmami);
    const leadCounts = await purgeLeadIdentifiers(client, record);
    const umamiClient = await umamiPool.connect();
    let umamiCounts;
    try { umamiCounts = await purgeUmamiIdentifiers(umamiClient, record); } finally { umamiClient.release(); }
    await rollup(leadPool, config, now, { client, privacyLockHeld: true });
    await startAndVerify(startUmami);
    await journal.writeCompletion(record, new Date(Math.max(Date.now(), now.getTime())));
    await setMaintenanceGate(client, false);
    return { completed: true, requestId, leadCounts, umamiCounts };
  });
}

async function retentionUnderLock(client, options) {
  const { leadPool, umamiPool, config, rollup, now } = options;
  const cutoff = new Date(now.getTime() - 90 * DAY);
  await rollup(leadPool, config, now, { client, privacyLockHeld: true });
  await transaction(client, async () => {
    await client.query(`DELETE FROM analytics_outbox WHERE created_at<$1 OR event_id IN(SELECT event_id FROM events WHERE received_at<$1)`, [cutoff]);
    await client.query('DELETE FROM events WHERE received_at<$1', [cutoff]);
    await client.query('DELETE FROM rfq_receipts WHERE received_at<$1', [cutoff]);
    await client.query(`INSERT INTO system_state(key,value,updated_at) VALUES('raw_retention_cutoff',jsonb_build_object('cutoff',$1::timestamptz),now())
      ON CONFLICT(key) DO UPDATE SET value=jsonb_build_object('cutoff',GREATEST((system_state.value->>'cutoff')::timestamptz,$1::timestamptz)),updated_at=now()`, [cutoff]);
    await client.query('DELETE FROM network_cache WHERE expires_at<=$1', [now]);
    await client.query('DELETE FROM quotas WHERE expires_at<=$1', [now]);
    await client.query('DELETE FROM privacy_tombstones WHERE expires_at<=$1', [now]);
    await client.query("DELETE FROM daily_aggregates WHERE local_day<($1::timestamptz AT TIME ZONE 'America/New_York')::date - INTERVAL '13 months'", [now]);
    await client.query("DELETE FROM report_deliveries WHERE period_end<$1::timestamptz - INTERVAL '13 months'", [now]);
    // Preserve one predecessor per component so the oldest retained day has an initial health state.
    await client.query(`DELETE FROM health_history h WHERE h.observed_at<$1 AND h.id NOT IN
      (SELECT DISTINCT ON(name) id FROM health_history WHERE observed_at<$1 ORDER BY name,observed_at DESC,id DESC)`, [cutoff]);
  });
  const umamiClient = await umamiPool.connect();
  try {
    const result = { cutoff: cutoff.toISOString(), umamiCounts: await purgeUmamiRetention(umamiClient, { websiteId: config.umamiWebsiteId, cutoff }) };
    if (config.umamiQaWebsiteId && config.umamiQaWebsiteId !== config.umamiWebsiteId) {
      result.umamiQaCounts = await purgeUmamiRetention(umamiClient, { websiteId: uuid(config.umamiQaWebsiteId), cutoff });
    }
    return result;
  }
  finally { umamiClient.release(); }
}

export async function runRetention(options) {
  const now = instant(options.now || new Date());
  if (typeof options.rollup !== 'function') throw new Error('Rollup adapter is required');
  uuid(options.config.umamiWebsiteId);
  if (options.config.umamiQaWebsiteId) uuid(options.config.umamiQaWebsiteId);
  return withExclusivePrivacy(options.leadPool, async client => {
    const gate = await client.query("SELECT value FROM system_state WHERE key='privacy_maintenance'");
    if (!gate.rows.length || gate.rows[0].value.active !== false) throw new Error('Privacy maintenance requires recovery before retention');
    await setMaintenanceGate(client, true);
    const ambiguousOld = await client.query(`SELECT 1 FROM analytics_outbox o JOIN events e USING(event_id)
      WHERE e.received_at<$1 AND o.attempts>0 AND o.status IN('pending','leased','dead_letter') LIMIT 1`, [new Date(now.getTime() - 90 * DAY)]);
    if (ambiguousOld.rowCount) {
      if (typeof options.stopUmami !== 'function' || typeof options.startUmami !== 'function') throw new Error('Old unresolved forwarding requires verified Umami stop');
      await stopAndVerify(options.stopUmami);
    }
    const result = await retentionUnderLock(client, { ...options, now });
    if (ambiguousOld.rowCount) await startAndVerify(options.startUmami);
    await setMaintenanceGate(client, false);
    return result;
  });
}

/** Restores never trust deletion state contained only in the database snapshot. */
export async function replayDeletionJournal(options) {
  const { leadPool, umamiPool, journal, config, stopUmami, startUmami, rollup } = options;
  const now = instant(options.now || new Date());
  requireAdapters(options); uuid(config.umamiWebsiteId);
  return withExclusivePrivacy(leadPool, async client => {
    await setMaintenanceGate(client, true);
    const records = await journal.readRequests({ now, websiteId: config.umamiWebsiteId });
    await stopAndVerify(stopUmami);
    const umamiClient = await umamiPool.connect();
    try {
      for (const record of records) {
        await writeTombstones(client, record, config);
        await purgeLeadIdentifiers(client, record);
        await purgeUmamiIdentifiers(umamiClient, record);
      }
    } finally { umamiClient.release(); }
    const retention = await retentionUnderLock(client, { ...options, now });
    await startAndVerify(startUmami);
    for (const record of records) await journal.writeCompletion(record, new Date(Math.max(Date.now(), now.getTime())));
    await setMaintenanceGate(client, false);
    return { completed: true, replayedRequests: records.length, ...retention };
  });
}
