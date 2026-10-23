// Synthetic data only. No production mail or contact information belongs in Git.
export const INQUIRY = '514d4c21-94c4-4d75-af4e-834b33bf4282';
export const syntheticFields = {
  Name: 'Synthetic Buyer', Company: 'Example EPC', email: 'buyer@example.com',
  'Requirement or specification link': 'Two units, 25/33 MVA.\nhttps://example.com/spec?a=1&b=2\nKeep <brackets> and & characters.',
  'Transformer category': 'power', Application: 'industrial', 'Power-transformer reference configuration': 'Synthetic reference',
  Quantity: '2', 'Rating value': '25', 'Rating unit': 'MVA', 'Primary voltage value': '138', 'Primary voltage unit': 'kV',
  'Secondary voltage value': '13.8', 'Secondary voltage unit': 'kV', 'Required delivery to site': 'Q3 2027',
  'Target energization': 'Q4 2027', 'Project location': 'Example State', 'Project or package reference': 'SYNTHETIC-001',
  Phone: '+1 202 555 0100', 'Additional information': 'Synthetic warranty question.\nSecond line.',
  Source: 'website', Campaign: 'industrial', 'Website inquiry ID': INQUIRY
};
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
export function syntheticRfq({fields = syntheticFields, id = 'synthetic0001', received = Date.parse('2026-10-20T12:00:00Z'), extraRows = ''} = {}) {
  const html = `<html><body><p>New submission</p><table>${Object.entries(fields).map(([key, value]) => `<tr><td><strong>${escape(key)}</strong></td><td><pre>${escape(value)}</pre></td></tr>`).join('')}${extraRows}</table></body></html>`;
  return {id, internalDate: String(received), labelIds: ['INBOX'], payload: {mimeType: 'text/html', headers: [
    {name: 'Delivered-To', value: 'quotes@farpointenergy.com'},
    {name: 'Received', value: 'by 2002:synthetic with SMTP id fixture'},
    {name: 'Return-Path', value: '<submissions@formsubmit.co>'},
    {name: 'Received', value: 'from mail.formsubmit.co (mail.formsubmit.co. [192.0.2.1]) by mx.google.com with ESMTPS id synthetic'},
    {name: 'Authentication-Results', value: 'mx.google.com; dkim=pass header.i=@formsubmit.co header.s=mail; spf=pass smtp.mailfrom=submissions@formsubmit.co; dmarc=pass header.from=formsubmit.co'},
    {name: 'From', value: 'FormSubmit <submissions@formsubmit.co>'},
    {name: 'To', value: 'quotes@farpointenergy.com'}
  ], body: {data: Buffer.from(html).toString('base64url')}}};
}
export function reportModel() {
  return {interval: {period: 'weekly', localStart: '2026-10-12', localEnd: '2026-10-19'},
    metrics: {sessions: 2, browsers: 2, new_browsers: 1, returning_browsers: 1, page_views: 3, rfq_start_sessions: 1,
      accepted_inquiry_ids: 1, unlinked_acceptances: 0, received_receipts: 1, duplicate_inquiry_receipts: 0, email_clicks: 1, accepted_cohort_sessions: 1},
    completeness: {complete: true, reasons: []}, health: {healthy: true, reasons: []},
    leads: [], candidates: [], pages: [{page: '/quote.html', views: 3}], campaigns: [], omittedBrowsers: 0, omittedReceipts: 0, quarantinedReceipts: 0};
}
