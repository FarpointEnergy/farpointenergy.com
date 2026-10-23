import {DateTime} from 'luxon';
import {withPrivacyLock} from './db.mjs';

export const REPORT_ZONE = 'America/New_York';
export function reportInterval({period = 'weekly', date, now = new Date()} = {}) {
  if (!['daily', 'weekly'].includes(period)) throw new Error('invalid_period');
  let start;
  if (date !== undefined) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid_date');
    start = DateTime.fromISO(date, {zone: REPORT_ZONE}).startOf('day');
    if (!start.isValid || start.toISODate() !== date || (period === 'weekly' && start.weekday !== 1)) throw new Error('invalid_period_start');
  } else {
    const current = DateTime.fromJSDate(new Date(now), {zone: REPORT_ZONE});
    if (!current.isValid) throw new Error('invalid_now');
    start = period === 'weekly' ? current.startOf('week').minus({weeks: 1}) : current.startOf('day').minus({days: 1});
  }
  const end = period === 'weekly' ? start.plus({weeks: 1}) : start.plus({days: 1});
  return {period, localStart: start.toISODate(), localEnd: end.toISODate(), start: start.toUTC().toJSDate(), end: end.toUTC().toJSDate(), zone: REPORT_ZONE};
}

export function duePeriods(config, now = new Date()) {
  const local = DateTime.fromJSDate(new Date(now), {zone: REPORT_ZONE});
  if (local.hour < 8 || local.hour >= 14) return [];
  const enabled = config.reportCadences ?? ['weekly'];
  return ['daily', 'weekly'].filter(period => enabled.includes(period) && (period !== 'weekly' || local.weekday === 1));
}

export async function countMetrics(client, interval, campaignCode = null) {
  const result = await client.query(`WITH clean AS (
      SELECT * FROM events WHERE received_at >= $1 AND received_at < $2 AND NOT is_qa AND NOT is_bot
      AND ($3::text IS NULL OR campaign_code=$3)
    ), cohort AS (SELECT DISTINCT session_id FROM clean WHERE event_name='page_view'),
    links AS (SELECT inquiry_id, (array_agg(campaign_code ORDER BY received_at DESC))[1] campaign_code
      FROM events WHERE inquiry_id IS NOT NULL AND NOT is_qa AND NOT is_bot AND received_at < $2
      GROUP BY inquiry_id HAVING count(DISTINCT browser_id)=1
      AND inquiry_id NOT IN(SELECT inquiry_id FROM rfq_receipts WHERE inquiry_id IS NOT NULL AND status='received' GROUP BY inquiry_id HAVING count(DISTINCT fields)>1)),
    receipts AS (SELECT r.* FROM rfq_receipts r LEFT JOIN links l USING(inquiry_id)
      WHERE r.received_at >= $1 AND r.received_at < $2 AND r.status='received' AND NOT r.is_qa
      AND ($3::text IS NULL OR l.campaign_code=$3)),
    event_counts AS (SELECT
      count(*) FILTER(WHERE event_name='page_view') page_views,
      count(DISTINCT session_id) FILTER(WHERE event_name='page_view') sessions,
      count(DISTINCT browser_id) browsers,
      count(DISTINCT session_id) FILTER(WHERE event_name='rfq_start') rfq_start_sessions,
      count(DISTINCT inquiry_id) FILTER(WHERE event_name='rfq_submit_success') accepted_inquiry_ids,
      count(*) FILTER(WHERE event_name='rfq_submit_success' AND inquiry_id IS NULL) unlinked_acceptances,
      count(*) FILTER(WHERE event_name='email_click') email_clicks,
      count(DISTINCT session_id) FILTER(WHERE event_name='rfq_start' AND session_id IN(SELECT session_id FROM cohort)) start_cohort_sessions,
      count(DISTINCT session_id) FILTER(WHERE event_name='rfq_submit_success' AND session_id IN(SELECT session_id FROM cohort)) accepted_cohort_sessions,
      count(DISTINCT session_id) FILTER(WHERE event_name='rfq_start' AND session_id NOT IN(SELECT session_id FROM cohort)) orphan_start_sessions,
      count(DISTINCT session_id) FILTER(WHERE event_name='rfq_submit_success' AND session_id NOT IN(SELECT session_id FROM cohort)) orphan_acceptance_sessions
      FROM clean),
    receipt_counts AS (SELECT count(*) received_receipts,
      count(inquiry_id)-count(DISTINCT inquiry_id) duplicate_inquiry_receipts FROM receipts)
    SELECT * FROM event_counts CROSS JOIN receipt_counts`, [interval.start, interval.end, campaignCode]);
  return Object.fromEntries(Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]));
}

export async function periodCompleteness(client, interval, now = new Date()) {
  const rows = (await client.query(`SELECT name,status,detail,observed_at FROM health_history
    WHERE observed_at >= $1 AND observed_at < $2
    UNION ALL SELECT name,status,detail,observed_at FROM (
      SELECT DISTINCT ON(name) name,status,detail,observed_at FROM health_history
      WHERE observed_at < $1 ORDER BY name,observed_at DESC
    ) prior ORDER BY observed_at`, [interval.start, interval.end])).rows;
  const reasons = new Set();
  const collector = rows.filter(r => r.name === 'collector');
  if (!collector.some(r => +new Date(r.observed_at) <= +interval.start)) reasons.add('Collection was not verified for the full interval.');
  const importRows = rows.filter(r => r.name === 'rfq_import');
  if (!importRows.length) reasons.add('RFQ mailbox coverage is unverified.');
  for (const row of rows) {
    if (['collector', 'rfq_import', 'synthetic_probe', 'outbox', 'enrichment'].includes(row.name) && row.status !== 'ok') {
      reasons.add(`${row.name.replaceAll('_', ' ')} reported incomplete coverage.`);
    }
  }
  const probes = rows.filter(r => r.name === 'synthetic_probe' && r.status === 'ok').map(r => +new Date(r.observed_at)).sort((a, b) => a - b);
  const start = +interval.start; const end = Math.min(+interval.end, +new Date(now));
  let last = probes.filter(p => p <= start).at(-1);
  if (last === undefined || start - last > 26 * 3_600_000) reasons.add('Synthetic collection probe coverage is unverified.');
  for (const point of probes.filter(p => p > start)) {
    if (last !== undefined && point - last > 26 * 3_600_000) reasons.add('Synthetic collection probe has a coverage gap.');
    last = point;
  }
  if (last === undefined || end - last > 26 * 3_600_000) reasons.add('Synthetic collection probe has a coverage gap.');
  // A successful overlapping import after the interval is required to close late receipt coverage.
  const latestImport = (await client.query("SELECT status FROM health_checks WHERE name='rfq_import'")).rows[0];
  const coverage = (await client.query("SELECT value FROM system_state WHERE key='rfq_import_coverage'")).rows[0]?.value?.through;
  if (!coverage || !Number.isFinite(+new Date(coverage)) || +new Date(coverage) < +interval.end || latestImport?.status !== 'ok') {
    reasons.add('Latest RFQ import has not verified the complete reporting interval.');
  }
  return {complete: reasons.size === 0, reasons: [...reasons]};
}

export async function currentHealth(client, now = new Date()) {
  const checks = (await client.query('SELECT name,last_success,last_attempt,status,detail FROM health_checks ORDER BY name')).rows;
  const reasons = new Set();
  for (const check of checks) if (check.status !== 'ok') reasons.add(`${check.name}: ${check.detail?.reason ?? check.status}`);
  const importer = checks.find(c => c.name === 'rfq_import');
  if (!importer?.last_success || +new Date(now) - +new Date(importer.last_success) > 2 * 3_600_000) reasons.add('RFQ import is missing or more than two hours old.');
  const probe = checks.find(c => c.name === 'synthetic_probe');
  if (!probe?.last_success || +new Date(now) - +new Date(probe.last_success) > 26 * 3_600_000) reasons.add('Synthetic collection probe is missing or more than 26 hours old.');
  return {healthy: reasons.size === 0, reasons: [...reasons], checks};
}

export async function recomputeDailyAggregates(pool, config, now = new Date(), options = {}) {
  async function run(client) {
    const lock = await client.query("SELECT pg_try_advisory_lock(hashtext('daily_aggregates')) AS locked");
    if (!lock.rows[0].locked) return {locked: false, days: 0};
    let days = 0; let frozenDays = 0;
    try {
      const today = DateTime.fromJSDate(new Date(now), {zone: REPORT_ZONE}).startOf('day');
      const watermark = (await client.query("SELECT value FROM system_state WHERE key='raw_retention_cutoff'")).rows[0]?.value?.cutoff;
      const retainedFrom = watermark ? +new Date(watermark) : -Infinity;
      if (watermark && !Number.isFinite(retainedFrom)) throw new Error('invalid_retention_watermark');
      const registry = config.campaignRegistry ?? config.campaigns ?? {};
      const dimensions = [null, ...Object.keys(registry)];
      for (let offset = 90; offset >= 1; offset--) {
        const interval = reportInterval({period: 'daily', date: today.minus({days: offset}).toISODate()});
        // A UTC retention cutoff can fall partway through a NY day. Never replace
        // its previously computed bucket from the now-partial source history.
        if (+interval.start < retainedFrom) {
          await client.query(`UPDATE daily_aggregates SET source_complete=false,
            incomplete_reason=CASE WHEN position('Frozen previous value:' IN coalesce(incomplete_reason,''))>0 THEN incomplete_reason
              ELSE concat_ws(' ',nullif(incomplete_reason,''),$2::text) END WHERE local_day=$1`,
          [interval.localStart, `Frozen previous value: raw retention removed part of this NY day; no partial recomputation replaced its last stored count (retention cutoff ${new Date(retainedFrom).toISOString()}).`]);
          frozenDays++; continue;
        }
        await client.query('BEGIN');
        try {
          const completeness = await periodCompleteness(client, interval, now);
          for (const dimension of dimensions) {
            const metrics = await countMetrics(client, interval, dimension);
            for (const [metric, value] of Object.entries(metrics)) {
              if (['start_cohort_sessions', 'accepted_cohort_sessions', 'orphan_start_sessions', 'orphan_acceptance_sessions'].includes(metric)) continue;
              await client.query(`INSERT INTO daily_aggregates(local_day,metric,dimension_key,value,computed_at,source_complete,incomplete_reason)
                VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(local_day,metric,dimension_key)
                DO UPDATE SET value=excluded.value,computed_at=excluded.computed_at,source_complete=excluded.source_complete,incomplete_reason=excluded.incomplete_reason`,
              [interval.localStart, metric, dimension ?? 'all', value, now, completeness.complete, completeness.reasons.join(' ').slice(0, 2000)]);
            }
          }
          await client.query('COMMIT'); days++;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      }
      return {locked: true, days, frozenDays};
    } finally { await client.query("SELECT pg_advisory_unlock(hashtext('daily_aggregates'))"); }
  }
  if (options.client && options.privacyLockHeld === true) return run(options.client);
  const outcome = await withPrivacyLock(pool, run);
  return outcome.allowed ? outcome.value : {locked: false, days: 0, deferred: 'privacy_maintenance'};
}
