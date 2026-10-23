import {parse} from 'parse5';
import {randomUUID} from 'node:crypto';
import {transaction, assertPrivacyAllowed, setHealth} from './db.mjs';

export const RFQ_FIELDS = Object.freeze({
  Name: 160, Company: 200, email: 254, 'Requirement or specification link': 20_000,
  'Transformer category': 32, Application: 32, 'Power-transformer reference configuration': 200,
  Quantity: 128, 'Rating value': 128, 'Rating unit': 16, 'Primary voltage value': 128,
  'Primary voltage unit': 16, 'Secondary voltage value': 128, 'Secondary voltage unit': 16,
  'Required delivery to site': 160, 'Target energization': 160, 'Project location': 240,
  'Project or package reference': 160, Phone: 80, 'Additional information': 10_000,
  Source: 64, Campaign: 64, 'Website inquiry ID': 128
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BODY_LIMIT = 256 * 1024;

export function headerValues(message, name) {
  return (message.payload?.headers ?? []).filter(h => h.name?.toLowerCase() === name.toLowerCase()).map(h => String(h.value ?? '').replace(/\r?\n[ \t]+/g, ' '));
}
export function exactAddress(value) {
  if (typeof value !== 'string' || /[\r\n\x00-\x1f\x7f,;]/.test(value)) return null;
  const match = value.trim().match(/^(?:[^<>]*<([^<>]+)>|([^<>\s]+))$/);
  return (match?.[1] ?? match?.[2] ?? '').trim().toLowerCase() || null;
}
function authenticate(message) {
  const headers = message.payload?.headers;
  if (!Array.isArray(headers) || headers.length > 256 || JSON.stringify(headers).length > 128 * 1024) return 'invalid_headers';
  const from = headerValues(message, 'From'); const to = headerValues(message, 'To');
  const delivered = headerValues(message, 'Delivered-To');
  if (from.length !== 1 || to.length !== 1 || delivered.length > 1) return 'duplicate_or_missing_address_header';
  if (exactAddress(from[0]) !== 'submissions@formsubmit.co') return 'unexpected_sender';
  if (exactAddress(to[0]) !== 'quotes@farpointenergy.com' && exactAddress(delivered[0]) !== 'quotes@farpointenergy.com') return 'unexpected_recipient';
  const indexed = headers.map((h, index) => ({name: h.name?.toLowerCase(), value: String(h.value ?? '').replace(/\r?\n[ \t]+/g, ' '), index}));
  const auth = indexed.filter(h => h.name === 'authentication-results');
  if (!auth.length || !/^mx\.google\.com\s*;/i.test(auth[0].value)) return 'missing_trusted_authentication';
  const trusted = auth.filter(h => /^mx\.google\.com\s*;/i.test(h.value));
  if (trusted.length !== 1 || /[\r\n\0]/.test(trusted[0].value)) return 'ambiguous_authentication';
  const fromIndex = indexed.find(h => h.name === 'from').index;
  const received = indexed.filter(h => h.name === 'received' && h.index < trusted[0].index).at(-1);
  if (trusted[0].index > fromIndex || !received || !/\bby\s+mx\.google\.com\b/i.test(received.value)) return 'untrusted_header_position';
  const clauses = trusted[0].value.split(';').slice(1).map(v => v.trim());
  const dmarcResults = clauses.filter(v => /^dmarc=/i.test(v));
  const dmarc = dmarcResults.length === 1 && /^dmarc=pass\b/i.test(dmarcResults[0]) && /\bheader\.from=formsubmit\.co(?:\s|$)/i.test(dmarcResults[0]);
  const alignedDkim = clauses.filter(v => /^dkim=/i.test(v) && /\bheader\.(?:d=formsubmit\.co|i=(?:[^@\s;]*@)?formsubmit\.co)(?:\s|$)/i.test(v));
  const dkim = alignedDkim.length > 0 && alignedDkim.every(v => /^dkim=pass\b/i.test(v));
  return dmarc && dkim ? null : 'authentication_failed';
}

export function extractHtml(message) {
  const queue = [{part: message.payload, depth: 0}]; const html = []; let total = 0;
  while (queue.length) {
    const {part, depth} = queue.shift();
    if (!part || depth > 20) throw new Error('invalid_mime_structure');
    if (part.filename || part.body?.attachmentId || part.mimeType === 'message/rfc822') continue;
    if (part.mimeType === 'text/html' && part.body?.data) {
      const data = part.body.data;
      if (typeof data !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(data) || data.length > Math.ceil(BODY_LIMIT * 4 / 3) + 8) throw new Error('oversized_or_invalid_body');
      const decoded = Buffer.from(data, 'base64url'); total += decoded.length;
      if (total > BODY_LIMIT) throw new Error('oversized_or_invalid_body');
      html.push(new TextDecoder('utf-8', {fatal: true}).decode(decoded));
    }
    if (Array.isArray(part.parts)) for (const child of part.parts) queue.push({part: child, depth: depth + 1});
    if (queue.length > 100) throw new Error('invalid_mime_structure');
  }
  if (html.length !== 1) throw new Error('missing_or_ambiguous_html');
  return html[0];
}
function descendants(node, tag) {
  const found = []; const queue = [...(node.childNodes ?? [])];
  while (queue.length) {
    const n = queue.shift(); if (n.tagName === tag) found.push(n);
    queue.push(...(n.childNodes ?? []));
  }
  return found;
}
function textOf(node) {
  let value = ''; const stack = [node];
  while (stack.length) {
    const current = stack.pop();
    if (current.nodeName === '#text') value += current.value;
    else if (current.tagName === 'br') value += '\n';
    else if (!['script', 'style', 'template'].includes(current.tagName)) stack.push(...[...(current.childNodes ?? [])].reverse());
  }
  return value.replace(/\r\n?/g, '\n');
}

export function parseRfq(message) {
  const quarantined = reason => ({status: 'quarantined', reason, fields: {}, inquiryId: null, isQa: false, unknownFields: 0});
  const authFailure = authenticate(message); if (authFailure) return quarantined(authFailure);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(message.id ?? '') || !/^\d{10,16}$/.test(String(message.internalDate ?? ''))) return quarantined('invalid_message_metadata');
  try {
    const html = extractHtml(message);
    const document = parse(html, {sourceCodeLocationInfo: true}); const fields = {}; let unknownFields = 0;
    for (const row of descendants(document, 'tr')) {
      const cells = (row.childNodes ?? []).filter(n => n.tagName === 'td');
      if (cells.length !== 2) continue;
      const labels = descendants(cells[0], 'strong');
      if (labels.length !== 1) continue;
      const key = textOf(labels[0]).trim();
      if (!Object.hasOwn(RFQ_FIELDS, key)) { unknownFields++; continue; }
      const pre = descendants(cells[1], 'pre');
      if (pre.length !== 1) return quarantined('unrecognized_field_template');
      // HTML's <pre> parsing rule discards one initial LF. Restore that character
      // from the source so a submitted leading line break is not silently lost.
      const rawStart = pre[0].sourceCodeLocation?.startTag?.endOffset;
      const leadingLf = Number.isInteger(rawStart) && /^(?:\r\n?|\n|&#(?:0*10|x0*a);)/i.test(html.slice(rawStart));
      const value = (leadingLf ? '\n' : '') + textOf(pre[0]);
      if (value.length > RFQ_FIELDS[key] || value.includes('\0')) return quarantined('field_limit_exceeded');
      if (Object.hasOwn(fields, key) && fields[key] !== value) return quarantined('conflicting_duplicate_field');
      fields[key] = value;
    }
    if (['Name', 'Company', 'email', 'Requirement or specification link'].some(k => !fields[k]?.trim())) return quarantined('missing_required_field');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email)) return quarantined('invalid_contact_email');
    const inquiryId = UUID.test(fields['Website inquiry ID'] ?? '') ? fields['Website inquiry ID'] : null;
    return {status: 'received', reason: null, fields, inquiryId, isQa: fields['Project or package reference']?.startsWith('FARPOINT-QA-') ?? false, unknownFields};
  } catch (error) {
    return quarantined(['invalid_mime_structure', 'oversized_or_invalid_body', 'missing_or_ambiguous_html'].includes(error.message) ? error.message : 'invalid_body');
  }
}

export async function importRfqReceipts({pool, config, gmail, now = new Date(), maxMessages = 1000, maxRunMs = 90_000}) {
  if (!Number.isInteger(maxMessages) || maxMessages < 1 || maxMessages > 1000 || !Number.isInteger(maxRunMs) || maxRunMs < 1000 || maxRunMs > 90_000) throw new Error('invalid_import_limits');
  const nowMs = +now; const cutoff = nowMs - 90 * 86_400_000;
  const deadline = Date.now() + maxRunMs;
  const lease = randomUUID();
  const cursor = await transaction(pool, async client => {
    if (!(await assertPrivacyAllowed(client, config)).allowed) return null;
    await client.query("SELECT pg_advisory_xact_lock(hashtext('rfq_import_cursor'))");
    const old = (await client.query("SELECT value FROM system_state WHERE key='rfq_import_cursor'")).rows[0]?.value;
    if (old?.leaseUntil > Date.now()) return null;
    const coverage = (await client.query("SELECT value FROM system_state WHERE key='rfq_import_coverage'")).rows[0]?.value?.through;
    const previous = coverage ? +new Date(coverage) : null;
    if (coverage && !Number.isFinite(previous)) throw new Error('invalid_import_coverage');
    const window = old && old.before >= cutoff && Number.isFinite(old.since) && Number.isFinite(old.before) ? old : {
      since: Math.max(cutoff, previous ? Math.min(nowMs, previous) - 7 * 86_400_000 : cutoff), before: nowMs, pageToken: null, finished: false
    };
    const claimed = {...window, lease, leaseUntil: Date.now() + 180_000};
    await client.query("INSERT INTO system_state(key,value) VALUES('rfq_import_cursor',$1) ON CONFLICT(key) DO UPDATE SET value=$1,updated_at=now()", [claimed]);
    return claimed;
  });
  if (!cursor) return {scanned: 0, inserted: 0, quarantined: 0, erased: 0, complete: false, deferred: 'import_busy_or_privacy_maintenance'};
  const result = {scanned: 0, inserted: 0, quarantined: 0, erased: 0, complete: true};
  let resumeToken = cursor.pageToken; let finished = cursor.finished === true;
  async function saveCursor(complete) {
    return transaction(pool, async client => {
      if (!(await assertPrivacyAllowed(client, config)).allowed) return false;
      await client.query("SELECT pg_advisory_xact_lock(hashtext('rfq_import_cursor'))");
      const current = (await client.query("SELECT value FROM system_state WHERE key='rfq_import_cursor'")).rows[0]?.value;
      if (current?.lease !== lease) return false;
      if (complete) {
        // Coverage ends at the fixed queried window, never at the later wall-clock
        // completion time of a resumed backfill.
        const previous = (await client.query("SELECT value FROM system_state WHERE key='rfq_import_coverage'")).rows[0]?.value?.through;
        const through = new Date(Math.max(previous ? +new Date(previous) : 0, cursor.before)).toISOString();
        await client.query("INSERT INTO system_state(key,value) VALUES('rfq_import_coverage',$1) ON CONFLICT(key) DO UPDATE SET value=$1,updated_at=now()", [{through}]);
        await client.query("DELETE FROM system_state WHERE key='rfq_import_cursor'");
      }
      else await client.query("UPDATE system_state SET value=$1,updated_at=now() WHERE key='rfq_import_cursor'", [{since: cursor.since, before: cursor.before, pageToken: resumeToken, finished, leaseUntil: 0}]);
      return true;
    });
  }
  try {
    await gmail.verifyProfile({force: true});
    const seenTokens = new Set();
    let paginationRestarts = 0;
    while (!finished) {
      if (Date.now() >= deadline) { result.complete = false; break; }
      if (seenTokens.has(resumeToken ?? '')) throw new Error('invalid_gmail_pagination');
      seenTokens.add(resumeToken ?? '');
      let page;
      try {
        page = await gmail.listMessages({q: `from:submissions@formsubmit.co {to:quotes@farpointenergy.com deliveredto:quotes@farpointenergy.com} after:${Math.floor(cursor.since / 1000)} before:${Math.ceil(cursor.before / 1000)}`, pageToken: resumeToken, maxResults: Math.min(100, maxMessages - result.scanned)});
      } catch (error) {
        // The query is application-controlled and already valid; a list HTTP400
        // with a saved page token can recover by replaying this same time window.
        // OAuth, rate-limit and transport failures retain their cursor unchanged.
        if (resumeToken && error.status === 400 && error.stage === 'read' && error.code === 'gmail_request_rejected') {
          resumeToken = null; finished = false;
          if (paginationRestarts++ === 0) { seenTokens.clear(); continue; }
        }
        throw error;
      }
      if (!Array.isArray(page.messages ?? [])) throw new Error('invalid_gmail_list');
      if (page.nextPageToken !== undefined && (typeof page.nextPageToken !== 'string' || page.nextPageToken.length > 2048)) throw new Error('invalid_gmail_pagination');
      let pageComplete = true;
      for (const entry of page.messages ?? []) {
        if (result.scanned >= maxMessages || Date.now() >= deadline) { result.complete = false; pageComplete = false; break; }
        result.scanned++;
        if ((await pool.query('SELECT 1 FROM rfq_receipts WHERE gmail_message_id=$1', [entry.id])).rowCount) continue;
        const message = await gmail.getMessage(entry.id);
        const receivedMs = Number(message.internalDate);
        if (!Number.isFinite(receivedMs) || receivedMs < cutoff || receivedMs >= nowMs) continue;
        const parsed = parseRfq(message);
        const outcome = await transaction(pool, async client => {
          const privacy = await assertPrivacyAllowed(client, config, {gmailMessageId: message.id, inquiryId: parsed.inquiryId});
          if (!privacy.allowed) return privacy.reason === 'maintenance' ? 'maintenance' : 'erased';
          const inserted = await client.query(`INSERT INTO rfq_receipts
            (gmail_message_id,received_at,inquiry_id,fields,status,reason,is_qa,attribution_status)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(gmail_message_id) DO NOTHING RETURNING gmail_message_id`,
          [message.id, new Date(receivedMs), parsed.inquiryId, JSON.stringify(parsed.fields), parsed.status, parsed.reason, parsed.isQa, 'unlinked']);
          if (parsed.inquiryId) await client.query(`UPDATE rfq_receipts SET attribution_status=CASE
            WHEN (SELECT count(DISTINCT fields) FROM rfq_receipts WHERE inquiry_id=$1 AND status='received')>1
              OR (SELECT count(DISTINCT browser_id) FROM events WHERE inquiry_id=$1 AND NOT is_qa AND NOT is_bot)>1 THEN 'conflict'
            WHEN (SELECT count(DISTINCT browser_id) FROM events WHERE inquiry_id=$1 AND NOT is_qa AND NOT is_bot)=1 THEN 'linked'
            ELSE 'unlinked' END WHERE inquiry_id=$1`, [parsed.inquiryId]);
          return inserted.rowCount ? parsed.status : 'duplicate';
        });
        if (outcome === 'maintenance') throw new Error('privacy_maintenance');
        if (outcome === 'erased') result.erased++;
        if (outcome === 'received') result.inserted++;
        if (outcome === 'quarantined') result.quarantined++;
      }
      if (pageComplete) { resumeToken = page.nextPageToken ?? null; finished = !resumeToken; }
      if (!result.complete) break;
      if (result.scanned >= maxMessages) { result.complete = false; break; }
    }
    if (!await saveCursor(result.complete)) result.complete = false;
    if (result.complete) result.completedThrough = new Date(cursor.before).toISOString();
    await setHealth(pool, 'rfq_import', result.complete ? 'ok' : 'degraded', {...result, reason: result.complete ? null : 'import_run_limit_reached'}, result.complete);
    return result;
  } catch (error) {
    await saveCursor(false).catch(() => {});
    await setHealth(pool, 'rfq_import', 'degraded', {reason: error.code ?? (error.message === 'privacy_maintenance' ? 'privacy_maintenance' : 'import_failed')}, false);
    return {...result, complete: false, error: 'import_failed'};
  }
}
