import {withPrivacyLock, setHealth} from './db.mjs';
import {createGmailClient} from './gmail.mjs';
import {importRfqReceipts} from './rfq.mjs';
import {buildReport, renderReport} from './report.mjs';
import {currentHealth, duePeriods} from './metrics.mjs';
import {deliverReport, reconcileDeliveries} from './delivery.mjs';

export async function runHourlyJob({pool, config, gmail = createGmailClient(config), now = new Date()}) {
  // Cron and manual execution share delivery keys and DB locks. A failed import is
  // visible in the digest, rather than being mistaken for an empty sales period.
  const imported = await importRfqReceipts({pool, config, gmail, now});
  const reconciled = await reconcileDeliveries({pool, config, gmail, now});
  const reports = [];
  for (const period of duePeriods(config, now)) reports.push(await deliverReport({pool, config, gmail, period, now}));
  await setHealth(pool, 'report_job', imported.complete && reports.every(r => ['provider_accepted', 'inbox_verified', 'locked'].includes(r.state)) ? 'ok' : 'degraded',
    {importComplete: imported.complete, reports: reports.map(r => ({period: r.period, state: r.state}))}, imported.complete);
  return {import: imported, reconciliation: reconciled, reports};
}

export function createReportHandlers({pool, config, gmail = createGmailClient(config)}) {
  return {
    async preview({period = 'weekly', date, now = new Date()} = {}) {
      const result = await withPrivacyLock(pool, async client => {
        await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
        try {
          const model = await buildReport(client, config, {period, date: date || undefined, now});
          await client.query('COMMIT');
          return {...renderReport(model), model};
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      });
      if (!result.allowed) throw new Error('privacy_maintenance');
      return result.value;
    },
    runJob: ({now = new Date()} = {}) => runHourlyJob({pool, config, gmail, now}),
    async status() {
      const health = await currentHealth(pool);
      const deliveries = (await pool.query(`SELECT period,period_start,period_end,state,attempt_count,reconcile_count,last_error,updated_at
        FROM report_deliveries ORDER BY period_start DESC LIMIT 20`)).rows;
      const rfqCoverageThrough = (await pool.query("SELECT value FROM system_state WHERE key='rfq_import_coverage'")).rows[0]?.value?.through ?? null;
      return {reportHealth: {healthy: health.healthy, reasons: health.reasons}, rfqCoverageThrough, deliveries};
    }
  };
}
