import { createHash } from 'node:crypto';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const EVENT_NAMES = ['page_view', 'product_path_view', 'rfq_start', 'rfq_submit_success', 'email_click'];
export const PAGES = ['index', 'products', 'applications', 'manufacturing', 'quality', 'delivery', 'quote', 'about', 'privacy', 'thanks', '404'].map(p => `/${p}.html`);
export const PRODUCTS = ['power', 'distribution', 'unsure'];
export const APPLICATIONS = ['data-center', 'solar', 'storage', 'hybrid', 'utility', 'industrial', 'other', 'unsure'];
export const REFERRERS = ['', 'other', 'google.com', 'bing.com', 'duckduckgo.com', 'linkedin.com', 'yahoo.com', 'facebook.com', 't.co'];
export const LANGUAGES = ['en', 'es', 'fr', 'de', 'pt', 'it', 'zh', 'ja', 'ko', 'hi', 'ar', 'ru', 'other'];
const KEYS = new Set(['schemaVersion', 'eventId', 'browserId', 'sessionId', 'name', 'page', 'product', 'application', 'campaignCode', 'source', 'medium', 'referrerHost', 'language', 'screenClass', 'clientTimestamp', 'inquiryId']);
export class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const invalid = () => { throw new HttpError(400, 'invalid_event'); };

/** Return a new canonical, closed-schema object. No raw URL or arbitrary properties survive. */
export function validateEvent(input, config = {}, now = Date.now()) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !KEYS.has(k))) invalid();
  if (input.schemaVersion !== 1 || !['eventId', 'browserId', 'sessionId'].every(k => typeof input[k] === 'string' && UUID.test(input[k]))) invalid();
  if (!EVENT_NAMES.includes(input.name)) invalid();
  const page = input.page === '/' ? '/index.html' : input.page;
  if (!PAGES.includes(page) || !Number.isSafeInteger(input.clientTimestamp) || Math.abs(input.clientTimestamp - now) > 86400000) invalid();
  const out = { schemaVersion: 1, eventId: input.eventId, browserId: input.browserId, sessionId: input.sessionId, name: input.name, page,
    product: input.product ?? 'unsure', application: input.application ?? 'unsure', campaignCode: input.campaignCode ?? '',
    source: input.source ?? '', medium: input.medium ?? '', referrerHost: input.referrerHost ?? '', language: input.language ?? 'other',
    screenClass: input.screenClass ?? 'desktop', clientTimestamp: input.clientTimestamp };
  if (!PRODUCTS.includes(out.product) || !APPLICATIONS.includes(out.application) || !REFERRERS.includes(out.referrerHost) || !LANGUAGES.includes(out.language) || !['mobile', 'tablet', 'desktop'].includes(out.screenClass)) invalid();
  if (typeof out.campaignCode !== 'string' || typeof out.source !== 'string' || typeof out.medium !== 'string') invalid();
  if (out.campaignCode) {
    const campaign = Object.hasOwn(config.campaigns ?? {}, out.campaignCode) && config.campaigns[out.campaignCode];
    if (!campaign || out.source !== campaign.source || out.medium !== campaign.medium) invalid();
  } else if (out.source || out.medium) invalid();
  if (Object.hasOwn(input, 'inquiryId')) {
    if (out.name !== 'rfq_submit_success' || !UUID.test(input.inquiryId)) invalid();
    out.inquiryId = input.inquiryId;
  }
  return Object.freeze(out);
}

export function canonicalHash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function knownBot(userAgent = '') {
  // Deliberately conservative; unrecognized scanners remain a documented measurement limit.
  return /bot\b|crawler|spider|headlesschrome|facebookexternalhit|slackbot|preview|python-requests|curl\//i.test(String(userAgent).slice(0, 1024));
}
