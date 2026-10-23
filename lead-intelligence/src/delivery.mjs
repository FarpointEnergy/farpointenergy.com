import {createHash} from 'node:crypto';
import {advisoryKey, withPrivacyLock, setHealth} from './db.mjs';
import {MAILBOX, sendFailureState} from './gmail.mjs';
import {headerValues, exactAddress, extractHtml} from './rfq.mjs';
import {reportInterval} from './metrics.mjs';
import {buildReport, renderReport} from './report.mjs';

export const bodyDigest = html => createHash('sha256').update(String(html).replace(/\r\n/g, '\n').trimEnd()).digest('hex');
export function deliveryIdentity(period, localStart, recipient = MAILBOX) {
  if (recipient !== MAILBOX || !['daily', 'weekly'].includes(period) || !/^\d{4}-\d{2}-\d{2}$/.test(localStart)) throw new Error('invalid_delivery_identity');
  const key = `${period}:${localStart}:${recipient}`;
  return {key, messageId: `<farpoint-leads-${createHash('sha256').update(key).digest('hex').slice(0, 40)}@farpointenergy.com>`};
}
export function encodeReportMessage({subject, text, html, messageId, recipient = MAILBOX, now = new Date()}) {
  if (recipient !== MAILBOX || /[\x00-\x1f\x7f]/.test(subject) || !/^<farpoint-leads-[a-f0-9]{40}@farpointenergy\.com>$/.test(messageId)) throw new Error('invalid_message_header');
  const boundary = `farpoint_${bodyDigest(html).slice(0, 40)}`;
  const base64 = value => Buffer.from(value, 'utf8').toString('base64').match(/.{1,76}/g)?.join('\r\n') ?? '';
  const mime = [`From: ${MAILBOX}`, `To: ${recipient}`, `Date: ${new Date(now).toUTCString()}`, `Message-ID: ${messageId}`,
    `Subject: ${subject}`, 'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', base64(text),
    `--${boundary}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', base64(html),
    `--${boundary}--`, ''].join('\r\n');
  return Buffer.from(mime).toString('base64url');
}
function matchesReport(message, row, label) {
  try {
    if (!message.labelIds?.includes(label)) return false;
    const from = headerValues(message, 'From'); const to = headerValues(message, 'To');
    const id = headerValues(message, 'Message-ID'); const subject = headerValues(message, 'Subject');
    return from.length === 1 && to.length === 1 && id.length === 1 && subject.length === 1 &&
      exactAddress(from[0]) === MAILBOX && exactAddress(to[0]) === row.recipient &&
      id[0].trim() === row.message_id && subject[0] === row.subject && bodyDigest(extractHtml(message)) === row.digest_hash;
  } catch { return false; }
}
async function findReport(gmail, row, label) {
  const result = await gmail.listMessages({q: `rfc822msgid:${row.message_id}`, labelIds: [label], maxResults: 10});
  if (result.nextPageToken) return {match: null, ambiguous: true};
  const matches = [];
  for (const entry of result.messages ?? []) {
    const message = await gmail.getMessage(entry.id);
    if (matchesReport(message, row, label)) matches.push(message);
  }
  return {match: matches.length === 1 ? matches[0] : null, ambiguous: matches.length > 1};
}

async function reconcileRow(client, gmail, row, now) {
  const age = +new Date(now) - +new Date(row.sending_at ?? row.updated_at);
  if (row.state === 'sending') {
    if (age < 2 * 60_000) return {state: 'sending', deferred: true};
    await client.query("UPDATE report_deliveries SET state='uncertain',last_error='stale_sending',updated_at=$2 WHERE delivery_key=$1", [row.delivery_key, now]);
    row.state = 'uncertain';
  }
  if (!['uncertain', 'provider_accepted'].includes(row.state)) return {state: row.state};
  if (age < 2 * 60_000 || age > 24 * 3_600_000 || row.reconcile_count >= 24) {
    return {state: row.state, deferred: true, operatorRequired: age > 24 * 3_600_000 || row.reconcile_count >= 24};
  }
  await client.query('UPDATE report_deliveries SET reconcile_count=reconcile_count+1,updated_at=$2 WHERE delivery_key=$1', [row.delivery_key, now]);
  try {
    const inbox = await findReport(gmail, row, 'INBOX');
    if (inbox.ambiguous) {
      await client.query("UPDATE report_deliveries SET last_error='duplicate_inbox_matches',updated_at=$2 WHERE delivery_key=$1", [row.delivery_key, now]);
      return {state: row.state, operatorRequired: true};
    }
    if (inbox.match) {
      await client.query("UPDATE report_deliveries SET state='inbox_verified',provider_id=coalesce(provider_id,$2),last_error=NULL,updated_at=$3 WHERE delivery_key=$1", [row.delivery_key, inbox.match.id, now]);
      return {state: 'inbox_verified'};
    }
    if (row.state === 'uncertain') {
      const sent = await findReport(gmail, row, 'SENT');
      if (sent.match) {
        await client.query("UPDATE report_deliveries SET state='provider_accepted',provider_id=$2,last_error=NULL,updated_at=$3 WHERE delivery_key=$1", [row.delivery_key, sent.match.id, now]);
        return {state: 'provider_accepted'};
      }
      if (sent.ambiguous) return {state: row.state, operatorRequired: true};
    }
    return {state: row.state, verified: false};
  } catch {
    await client.query("UPDATE report_deliveries SET last_error='reconciliation_unavailable',updated_at=$2 WHERE delivery_key=$1", [row.delivery_key, now]);
    return {state: row.state, error: 'reconciliation_unavailable'};
  }
}

async function lockedDelivery(pool, key, fn) {
  const privacy = await withPrivacyLock(pool, async client => {
    const lockId = advisoryKey(`report:${key}`);
    const locked = (await client.query('SELECT pg_try_advisory_lock($1::bigint) AS locked', [lockId])).rows[0].locked;
    if (!locked) return {state: 'locked', deferred: true};
    try { return await fn(client); }
    finally { await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockId]); }
  });
  return privacy.allowed ? privacy.value : {state: 'deferred', reason: 'privacy_maintenance'};
}

export async function deliverReport({pool, config, gmail, period = 'weekly', date, now = new Date(), build = buildReport}) {
  const interval = reportInterval({period, date, now});
  const {key, messageId} = deliveryIdentity(period, interval.localStart, config.reportRecipient);
  const outcome = await lockedDelivery(pool, key, async client => {
    let row = (await client.query('SELECT * FROM report_deliveries WHERE delivery_key=$1', [key])).rows[0];
    if (row && ['sending', 'uncertain', 'provider_accepted', 'inbox_verified'].includes(row.state)) return reconcileRow(client, gmail, row, now);
    if (row?.attempt_count >= 3) return {state: row.state, operatorRequired: true};
    let model;
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    try { model = await build(client, config, {period, date: interval.localStart, now}); await client.query('COMMIT'); }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    const report = renderReport(model);
    const digest = bodyDigest(report.html);
    await client.query(`INSERT INTO report_deliveries(delivery_key,period,period_start,period_end,recipient,message_id,subject,digest_hash,state)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,'prepared') ON CONFLICT(delivery_key)
      DO UPDATE SET subject=excluded.subject,digest_hash=excluded.digest_hash,state='prepared',updated_at=$9`,
    [key, period, interval.start, interval.end, config.reportRecipient, messageId, report.subject, digest, now]);
    const raw = encodeReportMessage({...report, messageId, recipient: config.reportRecipient, now});
    // Autocommit is intentional: 'sending' is durable BEFORE any send side effect.
    await client.query("UPDATE report_deliveries SET state='sending',sending_at=$2,updated_at=$2,attempt_count=attempt_count+1,last_error=NULL WHERE delivery_key=$1", [key, now]);
    try {
      const sent = await gmail.sendRaw(raw);
      if (!sent?.id) throw new Error('invalid_success');
      await client.query("UPDATE report_deliveries SET state='provider_accepted',provider_id=$2,updated_at=$3 WHERE delivery_key=$1", [key, sent.id, now]);
      return {state: 'provider_accepted'};
    } catch (error) {
      const state = sendFailureState(error);
      await client.query('UPDATE report_deliveries SET state=$2,last_error=$3,updated_at=$4 WHERE delivery_key=$1', [key, state, state === 'failed' ? 'send_rejected' : 'send_outcome_uncertain', now]);
      return {state};
    }
  });
  await setHealth(pool, 'report_delivery', ['provider_accepted', 'inbox_verified'].includes(outcome.state) ? 'ok' : 'degraded', {state: outcome.state, ...(outcome.operatorRequired ? {operatorRequired: true} : {})}, ['provider_accepted', 'inbox_verified'].includes(outcome.state));
  return {period, localStart: interval.localStart, ...outcome};
}

export async function reconcileDeliveries({pool, config, gmail, now = new Date()}) {
  // Recover crashed send markers even when their reconciliation window expired.
  // This is a state correction only; it never initiates another send.
  const crashed = (await pool.query(`SELECT delivery_key FROM report_deliveries WHERE state='sending'
    AND coalesce(sending_at,updated_at)<=$1::timestamptz-interval '2 minutes' ORDER BY updated_at LIMIT 50`, [now])).rows;
  for (const {delivery_key: key} of crashed) await lockedDelivery(pool, key, async client => {
    await client.query(`UPDATE report_deliveries SET state='uncertain',last_error='stale_sending',updated_at=$2
      WHERE delivery_key=$1 AND state='sending' AND coalesce(sending_at,updated_at)<=$2::timestamptz-interval '2 minutes'`, [key, now]);
    return {state: 'uncertain'};
  });
  // Expired/manual-only rows stay uncertain in the ledger, but cannot monopolize
  // the bounded work queue. Least-recently-checked eligible rows get fair turns.
  const pending = (await pool.query(`SELECT delivery_key FROM report_deliveries
    WHERE state IN('sending','uncertain','provider_accepted') AND reconcile_count<24
      AND coalesce(sending_at,updated_at) >= $1::timestamptz-interval '24 hours'
      AND coalesce(sending_at,updated_at) <= $1::timestamptz-interval '2 minutes'
    ORDER BY updated_at,delivery_key LIMIT 50`, [now])).rows;
  const outcomes = [];
  for (const {delivery_key: key} of pending) outcomes.push(await lockedDelivery(pool, key, async client => {
    const row = (await client.query('SELECT * FROM report_deliveries WHERE delivery_key=$1', [key])).rows[0];
    return row ? reconcileRow(client, gmail, row, now) : {state: 'missing'};
  }));
  const manual = Number((await pool.query(`SELECT count(*) count FROM report_deliveries
    WHERE state IN('sending','uncertain','provider_accepted') AND
      (coalesce(sending_at,updated_at)<$1::timestamptz-interval '24 hours' OR reconcile_count>=24)`, [now])).rows[0].count);
  if (manual || outcomes.some(o => o.operatorRequired || o.state === 'uncertain' || o.error)) {
    await setHealth(pool, 'report_reconciliation', 'degraded', {reason: 'unverified_delivery_requires_attention', manualReviewCount: manual}, false);
  } else await setHealth(pool, 'report_reconciliation', 'ok', {verified: outcomes.filter(o => o.state === 'inbox_verified').length, manualReviewCount: 0}, true);
  if (manual) outcomes.push({state: 'manual_review_required', count: manual});
  return outcomes;
}
