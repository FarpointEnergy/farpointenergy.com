import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRfq, extractHtml} from '../src/rfq.mjs';
import {createGmailClient, GmailError, sendFailureState, MAILBOX} from '../src/gmail.mjs';
import {reportInterval, duePeriods} from '../src/metrics.mjs';
import {renderReport, REPORT_BUDGET} from '../src/report.mjs';
import {deliveryIdentity, encodeReportMessage, bodyDigest} from '../src/delivery.mjs';
import {syntheticFields, syntheticRfq, reportModel, INQUIRY} from './reporting-fixtures.mjs';

test('authenticated HTML receipt preserves all 20 customer fields and metadata exactly', () => {
  const parsed = parseRfq(syntheticRfq());
  assert.equal(parsed.status, 'received'); assert.equal(parsed.inquiryId, INQUIRY);
  assert.deepEqual(parsed.fields, syntheticFields); assert.equal(Object.keys(parsed.fields).length, 23);
});
test('authentication failure, forged body headers and conflicting trusted headers quarantine', () => {
  const failed = syntheticRfq(); failed.payload.headers[4].value = failed.payload.headers[4].value.replace('dmarc=pass', 'dmarc=fail');
  assert.equal(parseRfq(failed).reason, 'authentication_failed');
  const missing = syntheticRfq(); missing.payload.headers.splice(4, 1);
  missing.payload.body.data = Buffer.from('Authentication-Results: mx.google.com; dkim=pass; dmarc=pass').toString('base64url');
  assert.equal(parseRfq(missing).status, 'quarantined');
  const conflict = syntheticRfq(); conflict.payload.headers.splice(5, 0, {name: 'Authentication-Results', value: 'mx.google.com; dmarc=fail'});
  assert.equal(parseRfq(conflict).reason, 'ambiguous_authentication');
});
test('header position, duplicate sender, wrong alias and oversized fields reject', () => {
  const moved = syntheticRfq(); moved.payload.headers.push(...moved.payload.headers.splice(4, 1));
  assert.equal(parseRfq(moved).reason, 'untrusted_header_position');
  const duplicate = syntheticRfq(); duplicate.payload.headers.push({name: 'From', value: 'attacker@example.com'});
  assert.equal(parseRfq(duplicate).status, 'quarantined');
  const alias = syntheticRfq(); alias.payload.headers[0].value = 'other@example.com'; alias.payload.headers.at(-1).value = 'other@example.com';
  assert.equal(parseRfq(alias).reason, 'unexpected_recipient');
  assert.equal(parseRfq(syntheticRfq({fields: {...syntheticFields, Name: 'x'.repeat(161)}})).reason, 'field_limit_exceeded');
});
test('HTML injection stays text; entities decode exactly once; duplicate conflicting fields reject', () => {
  const fields = {...syntheticFields, Name: '<img src=x onerror=alert(1)>', 'Additional information': '&lt;literal&gt;'};
  assert.deepEqual(parseRfq(syntheticRfq({fields})).fields, fields);
  assert.equal(parseRfq(syntheticRfq({extraRows: '<tr><td><strong>Name</strong></td><td><pre>Different</pre></td></tr>'})).reason, 'conflicting_duplicate_field');
});
test('preformatted values preserve a leading newline as well as internal line breaks', () => {
  const fields = {...syntheticFields, 'Additional information': '\nFirst line\nSecond line'};
  assert.deepEqual(parseRfq(syntheticRfq({fields})).fields, fields);
});
test('missing required field, malformed inquiry ID and QA are distinct outcomes', () => {
  const fields = {...syntheticFields}; delete fields.Company;
  assert.equal(parseRfq(syntheticRfq({fields})).reason, 'missing_required_field');
  const unlinked = parseRfq(syntheticRfq({fields: {...syntheticFields, 'Website inquiry ID': 'not-an-id'}}));
  assert.equal(unlinked.status, 'received'); assert.equal(unlinked.inquiryId, null);
  assert.equal(parseRfq(syntheticRfq({fields: {...syntheticFields, 'Project or package reference': 'FARPOINT-QA-SYNTHETIC'}})).isQa, true);
});
test('attached HTML and message/rfc822 are never treated as receipt body', () => {
  const message = syntheticRfq(); const part = message.payload;
  message.payload = {headers: part.headers, mimeType: 'multipart/mixed', parts: [{...part, filename: 'attached.html'}]};
  assert.throws(() => extractHtml(message), /missing_or_ambiguous_html/);
  message.payload.parts = [{mimeType: 'message/rfc822', parts: [part]}];
  assert.throws(() => extractHtml(message));
});
test('NY calendar intervals use 23-hour, 25-hour days and DST weeks', () => {
  const spring = reportInterval({period: 'daily', date: '2026-03-08'});
  const fall = reportInterval({period: 'daily', date: '2026-11-01'});
  assert.equal((spring.end - spring.start) / 3_600_000, 23);
  assert.equal((fall.end - fall.start) / 3_600_000, 25);
  assert.equal((reportInterval({period: 'weekly', date: '2026-03-02'}).end - reportInterval({period: 'weekly', date: '2026-03-02'}).start) / 3_600_000, 167);
  assert.equal(reportInterval({now: new Date('2026-10-19T12:17:00Z')}).localStart, '2026-10-12');
  assert.throws(() => reportInterval({period: 'weekly', date: '2026-10-13'}));
  assert.throws(() => reportInterval({period: 'daily', date: '2026-02-30'}));
});
test('schedule is Monday 8 AM New York with six-hour catchup, not fixed UTC', () => {
  assert.deepEqual(duePeriods({}, new Date('2026-10-19T12:17:00Z')), ['weekly']);
  assert.deepEqual(duePeriods({}, new Date('2026-11-02T13:17:00Z')), ['weekly']);
  assert.deepEqual(duePeriods({}, new Date('2026-10-19T18:17:00Z')), []);
  assert.deepEqual(duePeriods({}, new Date('2026-10-20T12:17:00Z')), []);
  assert.deepEqual(duePeriods({reportCadences: ['daily']}, new Date('2026-10-20T12:17:00Z')), ['daily']);
});
test('report separates accepted, received and clicked; escapes every supplied field', () => {
  const model = reportModel(); model.completeness = {complete: false, reasons: ['Synthetic probe missing']};
  model.leads = [{fields: {...syntheticFields, Name: '<script>alert(1)</script>'}, received_at: '2026-10-15T12:00:00Z', attribution: 'Unlinked', receipt_count: 1, gmailUrl: 'https://mail.google.com/', linked: false}];
  const report = renderReport(model);
  assert.match(report.text, /DATA INCOMPLETE/); assert.match(report.text, /accepted by FormSubmit/); assert.match(report.text, /authenticated RFQ email receipts/);
  assert.match(report.text, /not proof of sent email/); assert.doesNotMatch(report.html, /<script>/); assert.match(report.html, /&lt;script&gt;/);
});
test('maximum-row Unicode/escaping digest stays within its production verification byte limits', () => {
  const model = reportModel(); const expansion = '<&"\'💡';
  const fill = length => expansion.repeat(length).slice(0, length);
  model.leads = Array.from({length: 100}, (_, i) => ({fields: {...syntheticFields,
    Name: fill(160), Company: fill(200), email: `${'&'.repeat(240)}@example.com`,
    'Requirement or specification link': fill(20_000), 'Required delivery to site': fill(160)},
    received_at: '2026-10-15T12:00:00Z', attribution: fill(120), linked: true, pages: ['/quote.html'],
    receipt_count: 1, gmailUrl: `https://mail.google.com/mail/u/?authuser=karan%40farpointenergy.com#all/synthetic${i}`}));
  model.candidates = Array.from({length: 50}, (_, i) => ({label: `Browser ${i}`, page_views: 100,
    first_visit: '2026-10-15T11:00:00Z', last_visit: '2026-10-15T12:00:00Z', pages: ['/quote.html'],
    firstTouch: fill(120), lastTouch: fill(120), networks: Array.from({length: 1000}, () => ({company: fill(160), buyerFit: fill(200)}))}));
  const report = renderReport(model);
  assert.ok(Buffer.byteLength(report.html) <= REPORT_BUDGET.htmlBytes);
  assert.ok(Buffer.byteLength(report.text) <= REPORT_BUDGET.textBytes);
  assert.match(report.text, /omitted from this size-limited digest/);
  assert.match(report.text, /https:\/\/mail.google.com/);
  const fullMessage = {payload: {mimeType: 'multipart/alternative', parts: [
    {mimeType: 'text/plain', body: {data: Buffer.from(report.text).toString('base64url')}},
    {mimeType: 'text/html', body: {data: Buffer.from(report.html).toString('base64url')}}]}};
  assert.ok(Buffer.byteLength(JSON.stringify(fullMessage)) < 2 * 1024 * 1024);
  assert.equal(bodyDigest(extractHtml(fullMessage)), bodyDigest(report.html));
});
test('network evidence is capped with an explicit omitted-evidence count', () => {
  const model = reportModel();
  model.candidates = [{label: 'Browser 1', page_views: 5, first_visit: '2026-10-15T11:00:00Z', last_visit: '2026-10-15T12:00:00Z',
    pages: ['/quote.html'], firstTouch: 'Direct', lastTouch: 'Direct', networks: Array.from({length: 10}, (_, i) => ({company: `Synthetic company ${i}`, buyerFit: 'Unknown'}))}];
  const report = renderReport(model);
  assert.equal((report.text.match(/Network associated with/g) ?? []).length, 3);
  assert.match(report.text, /7 further network observations omitted/);
});
test('stable MIME identity and body digest; header injection and recipients reject', () => {
  const identity = deliveryIdentity('weekly', '2026-10-12'); const report = renderReport(reportModel());
  assert.deepEqual(identity, deliveryIdentity('weekly', '2026-10-12'));
  const raw = Buffer.from(encodeReportMessage({...report, messageId: identity.messageId}), 'base64url').toString();
  assert.match(raw, /To: karan@farpointenergy.com/); assert.ok(raw.includes(`Message-ID: ${identity.messageId}`));
  assert.equal(bodyDigest('hello\r\n'), bodyDigest('hello\n'));
  assert.throws(() => encodeReportMessage({...report, subject: 'x\r\nBcc: attacker@example.com', messageId: identity.messageId}));
  assert.throws(() => deliveryIdentity('weekly', '2026-10-12', 'other@example.com'));
});
test('send uncertainty distinguishes rejection from timeout, 429 and provider errors', () => {
  for (const status of [408, 429, 500, 503, 0]) assert.equal(sendFailureState(new GmailError('failure', {status, stage: 'send'})), 'uncertain');
  for (const status of [400, 401, 403]) assert.equal(sendFailureState(new GmailError('failure', {status, stage: 'send'})), 'failed');
  assert.equal(sendFailureState(new GmailError('oauth', {stage: 'auth', status: 503})), 'failed');
});
test('Gmail OAuth refuses wrong profile before any mail read or send', async () => {
  const calls = [];
  const gmail = createGmailClient({gmailClientId: 'id', gmailClientSecret: 'secret', gmailRefreshToken: 'refresh'}, {fetchImpl: async (url, options) => {
    calls.push(url);
    return new Response(JSON.stringify(url.includes('oauth2') ? {access_token: 'fake', expires_in: 3600} : {emailAddress: 'wrong@example.com'}), {status: 200});
  }});
  await assert.rejects(gmail.sendRaw('fake'), /gmail_wrong_mailbox/);
  assert.equal(calls.some(url => url.includes('messages/send')), false);
});
test('Gmail send never automatically retries ambiguous HTTP failure', async () => {
  let sends = 0;
  const gmail = createGmailClient({gmailClientId: 'id', gmailClientSecret: 'secret', gmailRefreshToken: 'refresh'}, {fetchImpl: async url => {
    if (url.includes('oauth2')) return new Response(JSON.stringify({access_token: 'fake', expires_in: 3600}));
    if (url.endsWith('profile')) return new Response(JSON.stringify({emailAddress: MAILBOX}));
    sends++; return new Response('{}', {status: 503});
  }});
  await assert.rejects(gmail.sendRaw('fake'), e => e.status === 503 && e.stage === 'send');
  assert.equal(sends, 1);
});
