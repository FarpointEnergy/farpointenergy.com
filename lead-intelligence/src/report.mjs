import {reportInterval, countMetrics, periodCompleteness, currentHealth} from './metrics.mjs';

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const shorten = (value, max = 500) => String(value ?? '').length > max ? `${String(value).slice(0, max)}…` : String(value ?? '');
const campaignLabel = (code, config) => code ? (config.campaigns?.[code]?.label || code) : 'Direct / no known campaign';

export async function buildReport(client, config, {period = 'weekly', date, now = new Date()} = {}) {
  const interval = reportInterval({period, date, now});
  if (+interval.end > +new Date(now) || +interval.start < +new Date(now) - 90 * 86_400_000) throw new Error('report_interval_outside_retention');
  const metrics = await countMetrics(client, interval);
  const completeness = await periodCompleteness(client, interval, now);
  const health = await currentHealth(client, now);
  const newBrowsers = (await client.query(`SELECT count(DISTINCT e.browser_id) count FROM events e
    WHERE e.received_at >= $1 AND e.received_at < $2 AND NOT e.is_qa AND NOT e.is_bot
    AND NOT EXISTS(SELECT 1 FROM events p WHERE p.browser_id=e.browser_id AND p.received_at < $1 AND NOT p.is_qa AND NOT p.is_bot)`, [interval.start, interval.end])).rows[0];
  const pages = (await client.query(`SELECT page,count(*)::integer views FROM events
    WHERE received_at >= $1 AND received_at < $2 AND event_name='page_view' AND NOT is_qa AND NOT is_bot
    GROUP BY page ORDER BY views DESC,page`, [interval.start, interval.end])).rows;
  const browsers = (await client.query(`WITH active AS (
      SELECT browser_id,min(received_at) first_visit,max(received_at) last_visit,count(*)::integer activity,
        count(*) FILTER(WHERE event_name='page_view')::integer page_views,
        jsonb_agg(DISTINCT page) pages
      FROM events WHERE received_at >= $1 AND received_at < $2 AND NOT is_qa AND NOT is_bot
      GROUP BY browser_id ORDER BY count(*) DESC,max(received_at) DESC LIMIT 50)
    SELECT a.*,f.campaign_code first_campaign,l.campaign_code last_campaign,n.networks,n.network_count
    FROM active a LEFT JOIN LATERAL(SELECT campaign_code FROM events e WHERE e.browser_id=a.browser_id
      AND e.received_at < $2 AND e.campaign_code<>'' AND NOT e.is_qa AND NOT e.is_bot ORDER BY e.received_at ASC LIMIT 1) f ON true
    LEFT JOIN LATERAL(SELECT campaign_code FROM events e WHERE e.browser_id=a.browser_id
      AND e.received_at < $2 AND e.campaign_code<>'' AND NOT e.is_qa AND NOT e.is_bot ORDER BY e.received_at DESC LIMIT 1) l ON true
    LEFT JOIN LATERAL(SELECT jsonb_agg(evidence) networks,max(total)::integer network_count FROM (
      SELECT evidence,count(*) OVER() total FROM (SELECT DISTINCT network_evidence evidence FROM events e
        WHERE e.browser_id=a.browser_id AND e.received_at >= $1 AND e.received_at < $2 AND NOT e.is_qa AND NOT e.is_bot
          AND e.network_evidence->>'status'='inferred' AND e.network_evidence->>'networkType'='business') unique_evidence
      ORDER BY evidence::text LIMIT 3) limited_evidence) n ON true
    ORDER BY a.activity DESC,a.last_visit DESC`, [interval.start, interval.end])).rows;
  const receipts = (await client.query(`WITH links AS (
      SELECT inquiry_id,count(DISTINCT browser_id)::integer browser_count,
        (array_agg(campaign_code ORDER BY received_at DESC))[1] campaign_code,(array_agg(browser_id ORDER BY received_at DESC))[1] browser_id
      FROM events WHERE inquiry_id IS NOT NULL AND received_at < $2 AND NOT is_qa AND NOT is_bot GROUP BY inquiry_id),
    repeats AS(SELECT inquiry_id,count(*)::integer receipt_count,count(DISTINCT fields)::integer variants
      FROM rfq_receipts WHERE inquiry_id IS NOT NULL AND status='received' AND NOT is_qa GROUP BY inquiry_id)
    SELECT r.gmail_message_id,r.received_at,r.fields,r.inquiry_id,l.browser_count,l.campaign_code,j.pages,
      coalesce(d.receipt_count,1) receipt_count,coalesce(d.variants,1) variants
    FROM rfq_receipts r LEFT JOIN links l USING(inquiry_id) LEFT JOIN repeats d USING(inquiry_id)
    LEFT JOIN LATERAL(SELECT jsonb_agg(DISTINCT e.page) pages FROM events e WHERE e.browser_id=l.browser_id
      AND e.received_at < $2 AND NOT e.is_qa AND NOT e.is_bot) j ON l.browser_count=1
    WHERE r.received_at >= $1 AND r.received_at < $2 AND r.status='received' AND NOT r.is_qa
    ORDER BY r.received_at DESC,r.gmail_message_id LIMIT 100`, [interval.start, interval.end])).rows;
  const campaigns = (await client.query(`SELECT campaign_code,count(*) FILTER(WHERE event_name='page_view')::integer page_views,
    count(DISTINCT session_id) FILTER(WHERE event_name='page_view')::integer sessions
    FROM events WHERE received_at >= $1 AND received_at < $2 AND NOT is_qa AND NOT is_bot
    GROUP BY campaign_code ORDER BY sessions DESC,campaign_code`, [interval.start, interval.end])).rows.map(row => ({...row, label: campaignLabel(row.campaign_code, config)}));
  const quarantine = (await client.query(`SELECT count(*)::integer count FROM rfq_receipts WHERE received_at >= $1 AND received_at < $2 AND status='quarantined'`, [interval.start, interval.end])).rows[0].count;
  const leads = receipts.map(receipt => ({...receipt,
    linked: receipt.browser_count === 1 && receipt.variants === 1,
    attribution: receipt.browser_count > 1 || receipt.variants > 1 ? 'Conflicting inquiry evidence; attribution withheld' : receipt.browser_count === 1 ? campaignLabel(receipt.campaign_code, config) : 'Unlinked website attribution',
    gmailUrl: `https://mail.google.com/mail/u/?authuser=karan%40farpointenergy.com#all/${encodeURIComponent(receipt.gmail_message_id)}`
  }));
  const candidates = browsers.map((browser, index) => {
    const corporate = (browser.networks ?? []).filter(n => n.status === 'inferred' && n.networkType === 'business');
    const networks = corporate.map(network => {
      const domain = network.domain ?? network.companyDomain ?? '';
      const match = config.targetAccounts?.[domain];
      return {...network, buyerFit: match ? (typeof match === 'string' ? match : match.rationale ?? match.label ?? 'Listed target account') : 'Not classified in Farpoint’s target-account registry'};
    });
    return {...browser, label: `Consenting browser ${index + 1}`, networks, omittedNetworks: Math.max(0, (browser.network_count ?? 0) - networks.length),
      firstTouch: campaignLabel(browser.first_campaign, config), lastTouch: campaignLabel(browser.last_campaign, config)};
  });
  return {interval, metrics: {...metrics, new_browsers: Number(newBrowsers.count), returning_browsers: metrics.browsers - Number(newBrowsers.count)},
    completeness, health, pages, campaigns, leads, candidates, quarantinedReceipts: quarantine,
    omittedBrowsers: Math.max(0, metrics.browsers - candidates.length), omittedReceipts: Math.max(0, metrics.received_receipts - leads.length)};
}

export const REPORT_BUDGET = Object.freeze({htmlBytes: 192 * 1024, textBytes: 128 * 1024, networksPerBrowser: 3});

export function renderReport(model) {
  // Bound expansion before rendering and then enforce an exact UTF-8 byte budget.
  // The resulting HTML fits the same production read path used for verification.
  const limited = {...model,
    completeness: {...model.completeness, reasons: model.completeness.reasons.slice(0, 20).map(reason => shorten(reason, 240))},
    health: {...model.health, reasons: model.health.reasons.slice(0, 20).map(reason => shorten(reason, 240))},
    leads: model.leads.slice(0, 100), candidates: model.candidates.slice(0, 50).map(candidate => ({...candidate,
      networks: candidate.networks.slice(0, REPORT_BUDGET.networksPerBrowser).map(network => ({...network,
        company: shorten(network.company ?? network.name ?? network.domain ?? 'an unnamed business', 160), buyerFit: shorten(network.buyerFit, 200)})),
      omittedNetworks: (candidate.omittedNetworks ?? 0) + Math.max(0, candidate.networks.length - REPORT_BUDGET.networksPerBrowser)})),
    campaigns: model.campaigns.slice(0, 50),
    omittedCampaigns: Math.max(0, model.campaigns.length - 50),
    omittedReceipts: (model.omittedReceipts ?? 0) + Math.max(0, model.leads.length - 100),
    omittedBrowsers: (model.omittedBrowsers ?? 0) + Math.max(0, model.candidates.length - 50)
  };
  while (true) {
    const report = renderReportUnchecked(limited);
    if (Buffer.byteLength(report.html) <= REPORT_BUDGET.htmlBytes && Buffer.byteLength(report.text) <= REPORT_BUDGET.textBytes) return report;
    if (limited.candidates.length) { limited.candidates.pop(); limited.omittedBrowsers++; }
    else if (limited.leads.length) { limited.leads.pop(); limited.omittedReceipts++; }
    else if (limited.campaigns.length) { limited.campaigns.pop(); limited.omittedCampaigns++; }
    else throw new Error('report_fixed_content_exceeds_budget');
  }
}

function renderReportUnchecked(model) {
  const {interval, metrics: m} = model;
  const subject = `Farpoint lead report - ${interval.period === 'weekly' ? 'week of' : 'day of'} ${interval.localStart}`;
  const lines = [`${subject}`, `${interval.localStart} to ${interval.localEnd} (end exclusive), America/New_York.`, ''];
  const warnings = [...new Set([...model.completeness.reasons, ...model.health.reasons])];
  if (warnings.length) lines.push('DATA INCOMPLETE: ' + warnings.join(' '), '');
  lines.push(`${m.sessions} measured visits; ${m.browsers} consenting browsers (${m.new_browsers} new, ${m.returning_browsers} returning within the retained identifier window).`,
    `${m.page_views} page views; ${m.rfq_start_sessions} sessions with quotation-form interaction.`,
    `${m.accepted_inquiry_ids} distinct inquiries accepted by FormSubmit; ${m.unlinked_acceptances} acceptance events without a link ID.`,
    `${m.received_receipts} authenticated RFQ email receipts; ${m.duplicate_inquiry_receipts} repeated-ID receipts beyond the first.`,
    `${m.email_clicks} email-link clicks (not proof of sent email).`,
    `Measured visit conversion: ${m.sessions ? (100 * m.accepted_cohort_sessions / m.sessions).toFixed(1) + '%' : 'not available'} (${m.accepted_cohort_sessions}/${m.sessions} page-view sessions with accepted submissions).`, '',
    `${m.orphan_start_sessions ?? 0} form-start sessions and ${m.orphan_acceptance_sessions ?? 0} acceptance sessions lacked an observed page view; excluded from the conversion numerator.`, '',
    'Measurement is opt-in and may miss blocked scripts. Anonymous browsers are not identified people. Network matches are inferred and campaign links may be forwarded.', '', 'Received RFQs');
  for (const lead of model.leads) {
    const f = lead.fields;
    lines.push(`- ${f.Name} | ${f.Company} | ${f.email}`, `  Received: ${new Date(lead.received_at).toISOString()}; ${lead.attribution}.`,
      `  Product/application: ${f['Transformer category'] || 'Not supplied'} / ${f.Application || 'Not supplied'}.`,
      `  Requirement: ${shorten(f['Requirement or specification link'])}`,
      `  Required site date: ${f['Required delivery to site'] || 'Not supplied'}.`,
      `  Linked browsing: ${lead.linked ? (lead.pages ?? []).join(', ') || 'No retained page history' : 'Unavailable; no person or browser association assumed'}.`,
      `  ${lead.receipt_count > 1 ? 'Possible duplicate: multiple receipts share the inquiry ID. ' : ''}Next action: review the original RFQ and prepare a manual response.`, `  ${lead.gmailUrl}`);
  }
  if (!model.leads.length && !m.received_receipts) lines.push('No authenticated RFQ receipts measured in this interval.');
  if (model.omittedReceipts) lines.push(`${model.omittedReceipts} further receipts are counted but omitted from this size-limited digest. Full RFQ details remain in the protected mailbox:`, 'https://mail.google.com/mail/u/?authuser=karan%40farpointenergy.com#search/from%3Asubmissions%40formsubmit.co');
  lines.push('', 'Visitor and account evidence');
  for (const candidate of model.candidates) {
    lines.push(`- ${candidate.label}: ${candidate.page_views} page views, ${new Date(candidate.first_visit).toISOString()} to ${new Date(candidate.last_visit).toISOString()}.`,
      `  Pages: ${candidate.pages.join(', ')}. First campaign: ${candidate.firstTouch}; last campaign: ${candidate.lastTouch}.`);
    for (const network of candidate.networks) lines.push(`  Network associated with ${network.company ?? network.name ?? network.domain ?? 'an unnamed business'} (inferred; not a named visitor). Buyer fit: ${network.buyerFit}. Next action: review account fit manually; do not assume a specific person visited.`);
    if (candidate.omittedNetworks) lines.push(`  ${candidate.omittedNetworks} further network observations omitted from this digest; retained evidence remains in the protected event store.`);
    if (!candidate.networks.length) lines.push('  Anonymous / network unknown. No person or employer inferred.');
  }
  if (model.omittedBrowsers) lines.push(`${model.omittedBrowsers} additional consenting browsers counted but omitted from this size-limited digest. Complete retained activity remains in the protected event store and private analytics dashboard.`);
  lines.push('', 'Pages', ...model.pages.map(p => `- ${p.page}: ${p.views} views`), '', 'Campaigns', ...model.campaigns.map(c => `- ${c.label}: ${c.sessions} measured visits, ${c.page_views} views`), '',
    `${model.quarantinedReceipts} messages quarantined and excluded from received-RFQ totals.`,
    'First-party metrics are deduplicated by event ID. Umami may contain forwarding retries. Received RFQs can include nonconsenting visitors and are not divided by consenting visits.',
    'Known contacts are submitter-supplied business details, not independently verified identities. This private report does not trigger outreach.');
  if (model.omittedCampaigns) lines.push(`${model.omittedCampaigns} campaign rows omitted from this digest; all activity remains included in the overall totals.`);
  const text = lines.join('\n');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(subject)}</title></head><body style="margin:0;background:#f3f5f6;color:#142536;font:16px/1.5 Arial,sans-serif"><main style="max-width:760px;margin:auto;padding:24px;background:white"><h1 style="font-size:24px">${escapeHtml(subject)}</h1>${lines.slice(1).map(line => line ? `<p style="margin:8px 0;overflow-wrap:anywhere;white-space:pre-wrap">${escapeHtml(line)}</p>` : '<hr style="border:0;border-top:1px solid #dbe2e7;margin:20px 0">').join('')}</main></body></html>`;
  return {subject, text, html};
}
