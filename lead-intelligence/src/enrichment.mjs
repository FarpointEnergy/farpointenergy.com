import { createHmac } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { reserveQuota } from './db.mjs';

export function normalizedIp(value) {
  if (typeof value !== 'string' || value.length > 64 || value.includes('%')) return null;
  try { const address = ipaddr.process(value); return address.toNormalizedString(); } catch { return null; }
}
export function publicIp(value) {
  const ip = normalizedIp(value);
  return ip && ipaddr.parse(ip).range() === 'unicast' ? ip : null;
}
function inTrustedRanges(value, cidrs) {
  try {
    const address = ipaddr.process(value);
    return cidrs.some(cidr => {
      const [network, mask] = ipaddr.parseCIDR(cidr);
      return address.kind() === network.kind() && address.match(network, mask);
    });
  } catch { return false; }
}
/** No forwarding header is trusted until deployed spoof testing establishes this contract. */
export function extractSourceIp(request, config) {
  if (!config.trustProxyVerified || config.trustProxyMode === 'disabled') return null;
  const remote = normalizedIp(request.socket?.remoteAddress);
  if (!remote) return null;
  if (config.trustProxyMode === 'direct') return publicIp(remote);
  if (!inTrustedRanges(remote, config.trustedProxyCidrs)) return null;
  const raw = request.headers?.['x-forwarded-for'];
  if (typeof raw !== 'string' || raw.length > 700) return null;
  const chain = raw.split(',').map(s => normalizedIp(s.trim()));
  if (!chain.length || chain.length > 10 || chain.some(ip => !ip)) return null;
  // Walk outward from a verified socket peer. Attacker-supplied leftmost values cannot win.
  for (let i = chain.length - 1; i >= 0; i--) if (!inTrustedRanges(chain[i], config.trustedProxyCidrs)) return publicIp(chain[i]);
  return null;
}
export function networkHash(ip, secret) { return createHmac('sha256', secret).update(ip).digest('hex'); }
export async function readBoundedJson(response, maxBytes) {
  if (!response.body || typeof response.body.getReader !== 'function') throw new Error('missing_response_stream');
  const reader = response.body.getReader(); const chunks = []; let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error('response_too_large'); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { reader.releaseLock(); }
}
const safeText = (value, max) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
const domainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const flags = ['is_bogon', 'is_mobile', 'is_satellite', 'is_anycast', 'is_crawler', 'is_datacenter', 'is_tor', 'is_proxy', 'is_vpn'];

/** Whitelist the provider's output; never retain an address, exact location or abuse contact. */
export function normalizeNetwork(response, config = {}) {
  const unavailable = reason => ({ status: 'unknown', reason, provider: 'ipapi.is' });
  if (!response || typeof response !== 'object' || response.error || response.docs || flags.some(k => !Object.hasOwn(response, k))) return unavailable('incomplete_response');
  const exclusions = flags.filter(k => Boolean(response[k]));
  if (response.egress_service) exclusions.push('egress_service');
  if (response.datacenter) exclusions.push('datacenter');
  if (response.asn?.type && ['hosting', 'isp', 'education', 'government'].includes(response.asn.type) && response.company?.type !== 'business') exclusions.push('shared_network');
  if (exclusions.length) return { ...unavailable('shared_or_nonbuyer_network'), flags: exclusions };
  const company = response.company;
  const domain = typeof company?.domain === 'string' ? company.domain.toLowerCase().replace(/^www\./, '') : '';
  if (company?.type !== 'business' || !safeText(company.name, 160) || !domainPattern.test(domain)) return unavailable('ambiguous_ownership');
  // Even a business-shaped WHOIS entry can belong to a general cloud/ISP. No automatic target assignment.
  if (response.asn?.type === 'hosting' || response.asn?.type === 'isp') return unavailable('shared_network');
  const target = Object.hasOwn(config.targetAccounts ?? {}, domain) ? config.targetAccounts[domain] : null;
  return { status: 'inferred', provider: 'ipapi.is', company: safeText(company.name, 160), domain, networkType: 'business',
    country: /^[A-Z]{2}$/.test(response.location?.country_code) ? response.location.country_code : '',
    region: safeText(response.location?.state, 80),
    targetAccount: Boolean(target), buyerFit: target ? safeText(typeof target === 'string' ? target : target.rationale, 200) : 'Not classified against the target account registry',
    limitation: 'Network ownership is inferred; it does not identify a person or prove their employer.' };
}

export async function enrichNetwork(client, config, sourceIp, { fetchImpl = fetch, now = new Date() } = {}) {
  if (!config.enrichmentEnabled) return { evidence: { status: 'unavailable', reason: 'disabled' }, key: null };
  const ip = publicIp(sourceIp);
  if (!ip || !config.trustProxyVerified) return { evidence: { status: 'unavailable', reason: 'untrusted_source' }, key: null };
  const key = networkHash(ip, config.hmacSecret);
  const cached = await client.query('SELECT evidence FROM network_cache WHERE key_hash=$1 AND expires_at>$2', [key, now]);
  if (cached.rowCount) return { evidence: cached.rows[0].evidence, key };
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(+day + 86400000);
  const reserved = await reserveQuota(client, 'enrichment', day, config.limits.enrichmentPerDay, end);
  if (!reserved) return { evidence: { status: 'unavailable', reason: 'quota_exhausted' }, key };
  let evidence;
  let ttl = 7 * 86400000;
  try {
    const response = await fetchImpl('https://api.ipapi.is/', { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: ip, key: config.ipapiKey }), signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('provider_failure');
    evidence = normalizeNetwork(await readBoundedJson(response, 65536), config);
    if (evidence.reason === 'incomplete_response') ttl = 900000;
  } catch { evidence = { status: 'unavailable', provider: 'ipapi.is', reason: 'lookup_failed' }; ttl = 900000; }
  await client.query(`INSERT INTO network_cache(key_hash,evidence,created_at,expires_at) VALUES($1,$2,$3,$4)
    ON CONFLICT(key_hash) DO UPDATE SET evidence=$2,created_at=$3,expires_at=$4`, [key, evidence, now, new Date(+now + ttl)]);
  return { evidence, key };
}
