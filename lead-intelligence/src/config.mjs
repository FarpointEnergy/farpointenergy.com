import { UUID } from './validation.mjs';
import ipaddr from 'ipaddr.js';

const fail = name => { throw new Error(`Invalid configuration: ${name}`); };
const boolean = (value, fallback = false) => value === undefined || value === '' ? fallback : value === 'true' ? true : value === 'false' ? false : fail('boolean');
function secret(env, key, required = true) {
  const value = env[key] || '';
  if ((required && value.length < 32) || /[\r\n\0]/.test(value)) fail(key);
  return value;
}
function jsonObject(value, name) {
  let result;
  try { result = JSON.parse(value || '{}'); } catch { fail(name); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) fail(name);
  return result;
}

export function loadConfig(env = process.env) {
  const databaseUrl = env.DATABASE_URL || '';
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) fail('DATABASE_URL');
  const origins = (env.ALLOWED_ORIGINS || 'https://farpointenergy.com,https://www.farpointenergy.com').split(',').filter(Boolean);
  const testMode = env.NODE_ENV === 'test';
  for (const value of origins) {
    let url; try { url = new URL(value); } catch { fail('ALLOWED_ORIGINS'); }
    if (url.origin !== value || url.username || url.password || (url.protocol !== 'https:' && !(testMode && ['localhost', '127.0.0.1'].includes(url.hostname)))) fail('ALLOWED_ORIGINS');
  }
  const campaigns = jsonObject(env.CAMPAIGNS_JSON, 'CAMPAIGNS_JSON');
  for (const [code, entry] of Object.entries(campaigns)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(code) || !entry || typeof entry !== 'object' || Array.isArray(entry) ||
      Object.keys(entry).some(k => !['source', 'medium', 'label', 'accountDomain'].includes(k)) ||
      !['email', 'search', 'social', 'referral', 'direct'].includes(entry.source) || !['email', 'organic', 'social', 'referral', 'none'].includes(entry.medium) ||
      (entry.label !== undefined && (typeof entry.label !== 'string' || entry.label.length > 120 || /[\r\n\0]/.test(entry.label))) ||
      (entry.accountDomain !== undefined && !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(entry.accountDomain))) fail('CAMPAIGNS_JSON');
  }
  const umamiUrl = env.UMAMI_URL || '';
  if (umamiUrl) {
    let url; try { url = new URL(umamiUrl); } catch { fail('UMAMI_URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') fail('UMAMI_URL');
  }
  const umamiWebsiteId = env.UMAMI_WEBSITE_ID || '';
  if (umamiUrl && !UUID.test(umamiWebsiteId)) fail('UMAMI_WEBSITE_ID');
  const umamiQaWebsiteId = env.UMAMI_QA_WEBSITE_ID || '';
  if (umamiUrl && (!UUID.test(umamiQaWebsiteId) || umamiQaWebsiteId === umamiWebsiteId)) fail('UMAMI_QA_WEBSITE_ID must be distinct');
  const reportCadences = (env.REPORT_CADENCES || 'weekly').split(',');
  if (reportCadences.some(c => !['daily', 'weekly'].includes(c)) || new Set(reportCadences).size !== reportCadences.length) fail('REPORT_CADENCES');
  const mailbox = env.GMAIL_MAILBOX || 'karan@farpointenergy.com';
  const reportRecipient = env.REPORT_RECIPIENT || mailbox;
  if (mailbox !== 'karan@farpointenergy.com' || reportRecipient !== mailbox) fail('GMAIL_MAILBOX/REPORT_RECIPIENT');
  const trustProxyMode = env.TRUST_PROXY_MODE || 'disabled';
  if (!['disabled', 'direct', 'cidr'].includes(trustProxyMode)) fail('TRUST_PROXY_MODE');
  const trustProxyVerified = boolean(env.PROXY_TRUST_VERIFIED);
  const trustedProxyCidrs = (env.TRUSTED_PROXY_CIDRS || '').split(',').filter(Boolean);
  if (trustProxyMode === 'cidr' && trustedProxyCidrs.length === 0) fail('TRUSTED_PROXY_CIDRS');
  for (const cidr of trustedProxyCidrs) { try { ipaddr.parseCIDR(cidr); } catch { fail('TRUSTED_PROXY_CIDRS'); } }
  const enrichmentEnabled = boolean(env.ENRICHMENT_ENABLED);
  const ipapiKey = env.IPAPI_KEY || '';
  if (enrichmentEnabled && (!ipapiKey || !trustProxyVerified || trustProxyMode === 'disabled')) fail('ENRICHMENT_ENABLED requires key and verified proxy contract');
  const port = Number(env.PORT || 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('PORT');
  return Object.freeze({ databaseUrl, origins, campaigns, port, host: env.HOST || '0.0.0.0', testMode,
    adminToken: secret(env, 'ADMIN_TOKEN'), hmacSecret: secret(env, 'NETWORK_HMAC_KEY'), deletionSecret: secret(env, 'DELETION_HMAC_KEY'),
    umamiUrl, umamiWebsiteId, umamiQaWebsiteId, umamiHostname: 'farpointenergy.com',
    trustProxyMode, trustProxyVerified, trustedProxyCidrs, enrichmentEnabled, ipapiKey,
    qa: boolean(env.QA_ENVIRONMENT), mailbox, reportRecipient, reportCadences,
    gmailClientId: env.GMAIL_CLIENT_ID || '', gmailClientSecret: env.GMAIL_CLIENT_SECRET || '', gmailRefreshToken: env.GMAIL_REFRESH_TOKEN || '',
    limits: Object.freeze({ browserPerMinute: 120, sourcePerMinute: 600, eventsPerDay: 20000, enrichmentPerDay: 900 }),
    targetAccounts: jsonObject(env.TARGET_ACCOUNTS_JSON, 'TARGET_ACCOUNTS_JSON') });
}
