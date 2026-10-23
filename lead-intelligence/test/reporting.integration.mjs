import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createPool, migrate, privacyHash} from '../src/db.mjs';
import {loadConfig} from '../src/config.mjs';
import {importRfqReceipts} from '../src/rfq.mjs';
import {countMetrics, reportInterval, recomputeDailyAggregates, periodCompleteness} from '../src/metrics.mjs';
import {buildReport, renderReport} from '../src/report.mjs';
import {deliverReport, reconcileDeliveries, bodyDigest} from '../src/delivery.mjs';
import {GmailError} from '../src/gmail.mjs';
import {syntheticRfq, syntheticFields, reportModel, INQUIRY} from './reporting-fixtures.mjs';

const enabled = Boolean(process.env.DATABASE_URL);
test('PostgreSQL reporting: import fidelity/privacy, exact counts, rollup idempotence, send crash/locks/inbox evidence', {skip: !enabled, timeout: 120_000}, async t => {
  const env = {...process.env, NODE_ENV: 'test', ADMIN_TOKEN: 'a'.repeat(40), NETWORK_HMAC_KEY: 'b'.repeat(40), DELETION_HMAC_KEY: 'c'.repeat(40)};
  const localPglite = process.env.PGLITE_LOCAL_DEVELOPMENT === '1';
  const admin = createPool(loadConfig(env), {max: localPglite ? 1 : 5});
  const schema = `report_test_${process.pid}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url = new URL(env.DATABASE_URL); url.searchParams.set('options', `-c search_path=${schema},public`);
  const config = loadConfig({...env, DATABASE_URL: localPglite ? env.DATABASE_URL : url.toString()});
  const pool = localPglite ? admin : createPool(config, {max: 5});
  if (localPglite) await pool.query(`SET search_path=${schema},public`);
  try {
    await migrate(pool);
    const when = new Date('2026-10-19T12:17:00Z');
    const received = Date.parse('2026-10-15T12:00:00Z');
    const gmail = {verifyProfile: async () => config.mailbox, listMessages: async () => ({messages: [{id: 'synthetic0001'}]}),
      getMessage: async () => syntheticRfq({received})};
    await t.test('overlap import preserves all fields, dedupes messages and excludes erased identities', async () => {
      const imported = await importRfqReceipts({pool, config, gmail, now: when});
      assert.equal(imported.inserted, 1); assert.equal(imported.complete, true);
      assert.deepEqual((await pool.query('SELECT fields FROM rfq_receipts')).rows[0].fields, syntheticFields);
      assert.equal((await importRfqReceipts({pool, config, gmail, now: when})).inserted, 0);
      await pool.query("INSERT INTO privacy_tombstones(kind,key_hash,expires_at) VALUES('inquiry',$1,now()+interval '100 days')", [privacyHash('inquiry', INQUIRY, config.deletionSecret)]);
      await pool.query('DELETE FROM rfq_receipts');
      assert.equal((await importRfqReceipts({pool, config, gmail, now: when})).erased, 1);
      assert.equal((await pool.query('SELECT count(*) FROM rfq_receipts')).rows[0].count, '0');
      await pool.query('DELETE FROM privacy_tombstones');
      await importRfqReceipts({pool, config, gmail, now: when});
    });
    const browserA = randomUUID(), browserB = randomUUID(), sessionA = randomUUID(), sessionB = randomUUID();
    async function event(name, {browser = browserA, session = sessionA, inquiry = null, qa = false, bot = false, at = '2026-10-15T11:00:00Z', page = '/quote.html'} = {}) {
      const id = randomUUID();
      await pool.query(`INSERT INTO events(event_id,payload_hash,received_at,event_name,page,browser_id,session_id,product,application,
        language,screen_class,client_timestamp,inquiry_id,is_qa,is_bot,payload) VALUES($1,$2,$3,$4,$5,$6,$7,'power','industrial','en','desktop',$8,$9,$10,$11,'{}')`,
      [id, '0'.repeat(64), at, name, page, browser, session, Date.parse(at), inquiry, qa, bot]);
      return id;
    }
    await t.test('cohort conversion never exceeds100%, QA/bots excluded, received separate', async () => {
      await event('page_view'); await event('rfq_start'); await event('rfq_submit_success', {inquiry: INQUIRY});
      await event('rfq_start', {browser: browserB, session: sessionB});
      await event('rfq_submit_success', {browser: browserB, session: sessionB, inquiry: randomUUID()});
      await event('page_view', {browser: randomUUID(), session: randomUUID(), qa: true});
      await event('page_view', {browser: randomUUID(), session: randomUUID(), bot: true});
      const metrics = await countMetrics(pool, reportInterval({period: 'weekly', date: '2026-10-12'}));
      assert.equal(metrics.sessions, 1); assert.equal(metrics.browsers, 2); assert.equal(metrics.rfq_start_sessions, 2);
      assert.equal(metrics.accepted_inquiry_ids, 2); assert.equal(metrics.accepted_cohort_sessions, 1); assert.equal(metrics.received_receipts, 1);
      assert.equal(metrics.orphan_start_sessions, 1); assert.equal(metrics.orphan_acceptance_sessions, 1);
      const model = await buildReport(pool, config, {date: '2026-10-12', now: when});
      assert.equal(model.leads[0].linked, true); assert.equal(model.completeness.complete, false);
      assert.match(renderReport(model).text, /DATA INCOMPLETE/);
      assert.match(renderReport(model).text, /1 form-start sessions and 1 acceptance sessions lacked an observed page view/);
    });
    await t.test('conflicting inquiry identity never claims a browser/person association', async () => {
      const alternate = {...syntheticFields, Name: 'Other Synthetic Buyer'};
      await pool.query(`INSERT INTO rfq_receipts(gmail_message_id,received_at,inquiry_id,fields,status,is_qa)
        VALUES('synthetic0002',$1,$2,$3,'received',false)`, [new Date(received), INQUIRY, alternate]);
      const model = await buildReport(pool, config, {date: '2026-10-12', now: when});
      assert.equal(model.leads.filter(l => l.linked).length, 0);
      assert.equal(model.metrics.duplicate_inquiry_receipts, 1);
      await pool.query("DELETE FROM rfq_receipts WHERE gmail_message_id='synthetic0002'");
    });
    await t.test('rollup retries replace buckets; late receipt uses receive day', async () => {
      await recomputeDailyAggregates(pool, config, when);
      const initial = await pool.query("SELECT metric,value,source_complete FROM daily_aggregates WHERE local_day='2026-10-15' ORDER BY metric");
      await recomputeDailyAggregates(pool, config, when);
      assert.deepEqual((await pool.query("SELECT metric,value,source_complete FROM daily_aggregates WHERE local_day='2026-10-15' ORDER BY metric")).rows, initial.rows);
      await pool.query("INSERT INTO rfq_receipts(gmail_message_id,received_at,fields,status,is_qa) VALUES('late',$1,$2,'received',false)", [new Date(received), syntheticFields]);
      await recomputeDailyAggregates(pool, config, when);
      assert.equal((await pool.query("SELECT value FROM daily_aggregates WHERE local_day='2026-10-15' AND metric='received_receipts' AND dimension_key='all'")).rows[0].value, '2');
    });
    await t.test('concurrent deliveries send once and commit sending before HTTP', {skip: localPglite ? 'Requires native PostgreSQL concurrent connections' : false}, async () => {
      let sends = 0;
      const sender = {sendRaw: async () => {
        sends++; assert.equal((await pool.query('SELECT state FROM report_deliveries')).rows[0].state, 'sending');
        await new Promise(resolve => setTimeout(resolve, 20)); return {id: 'sent0001'};
      }};
      const args = {pool, config, gmail: sender, now: when, build: async () => reportModel()};
      const outcomes = await Promise.all([deliverReport(args), deliverReport(args)]);
      assert.equal(sends, 1); assert.ok(outcomes.some(o => o.state === 'provider_accepted'));
      assert.notEqual((await pool.query('SELECT state FROM report_deliveries')).rows[0].state, 'inbox_verified');
    });
    await t.test('Sent reconciliation proves acceptance only; matching INBOX proves delivery', async () => {
      if (localPglite) await deliverReport({pool, config, gmail: {sendRaw: async () => ({id: 'sent0001'})}, now: when, build: async () => reportModel()});
      const row = (await pool.query('SELECT * FROM report_deliveries')).rows[0]; const report = renderReport(reportModel());
      assert.equal(bodyDigest(report.html), row.digest_hash);
      const message = label => ({id: label === 'SENT' ? 'sent0001' : 'inbox0001', labelIds: [label], payload: {mimeType: 'text/html',
        headers: [{name: 'From', value: config.mailbox}, {name: 'To', value: config.reportRecipient}, {name: 'Message-ID', value: row.message_id}, {name: 'Subject', value: row.subject}],
        body: {data: Buffer.from(report.html).toString('base64url')}}});
      await pool.query("UPDATE report_deliveries SET state='uncertain'");
      let inbox = false;
      const reader = {listMessages: async ({labelIds}) => ({messages: labelIds[0] === 'INBOX' && !inbox ? [] : [{id: labelIds[0]}]}), getMessage: async label => message(label)};
      assert.equal((await reconcileDeliveries({pool, config, gmail: reader, now: new Date(+when + 180_000)}))[0].state, 'provider_accepted');
      inbox = true;
      assert.equal((await reconcileDeliveries({pool, config, gmail: reader, now: new Date(+when + 240_000)}))[0].state, 'inbox_verified');
    });
    await t.test('timeout stays uncertain and repeated execution never blind-resends', async () => {
      await pool.query('DELETE FROM report_deliveries'); let sends = 0;
      const uncertain = {sendRaw: async () => { sends++; throw new GmailError('timeout', {stage: 'send'}); }, listMessages: async () => ({messages: []})};
      const args = {pool, config, gmail: uncertain, now: when, build: async () => reportModel()};
      assert.equal((await deliverReport(args)).state, 'uncertain');
      assert.equal((await deliverReport({...args, now: new Date(+when + 180_000)})).state, 'uncertain');
      assert.equal(sends, 1);
      await pool.query("UPDATE report_deliveries SET state='sending',sending_at=$1", [when]);
      assert.equal((await deliverReport({...args, now: new Date(+when + 240_000)})).state, 'uncertain');
      assert.equal(sends, 1);
    });
    await t.test('more than50 stale/manual deliveries cannot starve a fresh inbox verification', async () => {
      await pool.query('DELETE FROM report_deliveries');
      await pool.query(`INSERT INTO report_deliveries(delivery_key,period,period_start,period_end,recipient,message_id,subject,digest_hash,state,sending_at,updated_at)
        SELECT 'stale-'||n,'daily',$1::timestamptz-interval '4 days',$1::timestamptz-interval '3 days',$2,
          '<stale-'||n||'@farpointenergy.com>','Stale synthetic report',repeat('a',64),'uncertain',$1::timestamptz-interval '3 days',$1::timestamptz-interval '3 days'
        FROM generate_series(1,51) n`, [when, config.reportRecipient]);
      await pool.query("UPDATE report_deliveries SET state='sending' WHERE delivery_key='stale-1'");
      await deliverReport({pool, config, gmail: {sendRaw: async () => ({id: 'freshsend'})}, now: when, build: async () => reportModel()});
      const fresh = (await pool.query("SELECT * FROM report_deliveries WHERE state='provider_accepted'")).rows[0];
      const report = renderReport(reportModel()); let reads = 0;
      const reader = {listMessages: async () => ({messages: [{id: 'freshinbox'}]}), getMessage: async () => {
        reads++; return {id: 'freshinbox', labelIds: ['INBOX'], payload: {mimeType: 'text/html',
          headers: [{name: 'From', value: config.mailbox}, {name: 'To', value: config.reportRecipient}, {name: 'Message-ID', value: fresh.message_id}, {name: 'Subject', value: fresh.subject}],
          body: {data: Buffer.from(report.html).toString('base64url')}}};
      }};
      const outcomes = await reconcileDeliveries({pool, config, gmail: reader, now: new Date(+when + 180_000)});
      assert.ok(outcomes.some(o => o.state === 'inbox_verified')); assert.equal(reads, 1);
      assert.equal((await pool.query("SELECT count(*) count FROM report_deliveries WHERE state='uncertain'")).rows[0].count, '51');
      assert.equal((await pool.query("SELECT detail FROM health_checks WHERE name='report_reconciliation'")).rows[0].detail.manualReviewCount, 51);
    });
    await t.test('oldest NY bucket survives rollup-retention-rerollup without partial overwrite', async () => {
      const cutoff = new Date(+when - 90 * 86_400_000);
      const day = cutoff.toISOString().slice(0, 10);
      await event('page_view', {at: new Date(+cutoff - 3_600_000).toISOString()});
      await event('page_view', {at: new Date(+cutoff + 3_600_000).toISOString()});
      await recomputeDailyAggregates(pool, config, when);
      const before = (await pool.query("SELECT value,computed_at FROM daily_aggregates WHERE local_day=$1 AND metric='page_views' AND dimension_key='all'", [day])).rows[0];
      assert.equal(before.value, '2');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM events WHERE received_at<$1', [cutoff]);
        await client.query("INSERT INTO system_state(key,value) VALUES('raw_retention_cutoff',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [{cutoff: cutoff.toISOString()}]);
        await client.query('COMMIT');
      } finally { client.release(); }
      const rerun = await recomputeDailyAggregates(pool, config, when);
      const after = (await pool.query("SELECT value,computed_at,source_complete,incomplete_reason FROM daily_aggregates WHERE local_day=$1 AND metric='page_views' AND dimension_key='all'", [day])).rows[0];
      assert.equal(after.value, before.value); assert.deepEqual(after.computed_at, before.computed_at);
      assert.equal(after.source_complete, false); assert.match(after.incomplete_reason, /Frozen previous value/); assert.equal(rerun.frozenDays, 1);
      await recomputeDailyAggregates(pool, config, when);
      assert.equal((await pool.query("SELECT value FROM daily_aggregates WHERE local_day=$1 AND metric='page_views' AND dimension_key='all'", [day])).rows[0].value, '2');
    });
    await t.test('SQL bounds network evidence before JSON aggregation and discloses omitted observations', async () => {
      const browser = randomUUID();
      for (let i = 0; i < 8; i++) {
        const id = await event('page_view', {browser, session: randomUUID()});
        await pool.query('UPDATE events SET network_evidence=$2 WHERE event_id=$1', [id, {status: 'inferred', networkType: 'business', company: `Synthetic Network ${i}`, domain: `example${i}.com`}]);
      }
      const model = await buildReport(pool, config, {date: '2026-10-12', now: when});
      const candidate = model.candidates.find(c => c.browser_id === browser);
      assert.equal(candidate.networks.length, 3); assert.equal(candidate.omittedNetworks, 5);
      assert.match(renderReport(model).text, /5 further network observations omitted/);
    });
    await t.test('bounded multi-page imports resume, recover invalid token, and retain cursor on OAuth failure', async () => {
      await pool.query("DELETE FROM system_state WHERE key IN('rfq_import_cursor','rfq_import_coverage')");
      const requests = []; const fetched = [];
      const paged = {verifyProfile: async () => config.mailbox,
        listMessages: async ({pageToken, q}) => { requests.push({pageToken, q});
          return pageToken === 'page2' ? {messages: [{id: 'paged3'}]} : {messages: [{id: 'paged1'}, {id: 'paged2'}], nextPageToken: 'page2'}; },
        getMessage: async id => { fetched.push(id); return syntheticRfq({id, received, fields: {...syntheticFields, 'Website inquiry ID': ''}}); }};
      assert.equal((await importRfqReceipts({pool, config, gmail: paged, now: when, maxMessages: 2})).complete, false);
      assert.equal((await pool.query("SELECT value FROM system_state WHERE key='rfq_import_cursor'")).rows[0].value.pageToken, 'page2');
      assert.equal((await importRfqReceipts({pool, config, gmail: paged, now: when, maxMessages: 2})).complete, true);
      assert.equal(requests.at(-1).pageToken, 'page2'); assert.equal(new Set(fetched).size, 3);
      const fixed = {since: received - 86_400_000, before: +when, pageToken: 'expired', finished: false, leaseUntil: 0};
      await pool.query("INSERT INTO system_state(key,value) VALUES('rfq_import_cursor',$1)", [fixed]);
      let restarted = 0;
      const expired = {...paged, listMessages: async ({pageToken}) => {
        if (pageToken === 'expired') throw new GmailError('gmail_request_rejected', {status: 400, stage: 'read'});
        restarted++; return {messages: [{id: 'paged1'}, {id: 'paged4'}]};
      }};
      assert.equal((await importRfqReceipts({pool, config, gmail: expired, now: when})).complete, true);
      assert.equal(restarted, 1); assert.equal(fetched.filter(id => id === 'paged1').length, 1);
      await pool.query("INSERT INTO system_state(key,value) VALUES('rfq_import_cursor',$1)", [fixed]);
      const denied = {...paged, listMessages: async () => { throw new GmailError('gmail_request_rejected', {status: 401, stage: 'read'}); }};
      assert.equal((await importRfqReceipts({pool, config, gmail: denied, now: when})).complete, false);
      assert.equal((await pool.query("SELECT value FROM system_state WHERE key='rfq_import_cursor'")).rows[0].value.pageToken, 'expired');
      const auth400 = {...paged, listMessages: async () => { throw new GmailError('gmail_auth_rejected', {status: 400, stage: 'auth'}); }};
      assert.equal((await importRfqReceipts({pool, config, gmail: auth400, now: when})).complete, false);
      assert.equal((await pool.query("SELECT value FROM system_state WHERE key='rfq_import_cursor'")).rows[0].value.pageToken, 'expired');
    });
    await t.test('resumed backfill coverage advances to queried-before, not wall-clock completion', async () => {
      await pool.query("DELETE FROM system_state WHERE key IN('rfq_import_cursor','rfq_import_coverage')");
      const oldBefore = Date.parse('2026-10-01T00:00:00Z');
      await pool.query("INSERT INTO system_state(key,value) VALUES('rfq_import_cursor',$1)", [{since: oldBefore - 20 * 86_400_000, before: oldBefore, pageToken: 'resume', leaseUntil: 0}]);
      const queries = [];
      const backfill = {verifyProfile: async () => config.mailbox, listMessages: async ({q}) => { queries.push(q); return {messages: []}; }};
      assert.equal((await importRfqReceipts({pool, config, gmail: backfill, now: when})).complete, true);
      assert.equal((await pool.query("SELECT value FROM system_state WHERE key='rfq_import_coverage'")).rows[0].value.through, new Date(oldBefore).toISOString());
      const completeness = await periodCompleteness(pool, reportInterval({date: '2026-10-12'}), when);
      assert.ok(completeness.reasons.includes('Latest RFQ import has not verified the complete reporting interval.'));
      await importRfqReceipts({pool, config, gmail: backfill, now: when});
      assert.match(queries.at(-1), new RegExp(`after:${Math.floor((oldBefore - 7 * 86_400_000) / 1000)}`));
      assert.equal((await pool.query("SELECT value FROM system_state WHERE key='rfq_import_coverage'")).rows[0].value.through, when.toISOString());
    });
  } finally {
    if (!localPglite) await pool.end();
    else await admin.query('SET search_path=public');
    await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end();
  }
});
