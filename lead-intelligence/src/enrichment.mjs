import { createHmac } from 'node:crypto';
import ipaddr from 'ipaddr.js';
import { reserveQuota, setHealth } from './db.mjs';

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
  if (!response || typeof response !== 'object' || response.error || response.docs || flags.some(k => !Object.hasOwn(response, k))) return { ...unavailable('incomplete_response'), status: 'unavailable' };
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

/** Refresh quota/configuration without claiming that a cached result tested provider recovery. */
export async function refreshEnrichmentHealth(client, config, { now = new Date(), observation, persist = true } = {}) {
  if (!persist) return evaluateEnrichmentHealth(client, config, { now, observation, persist: false });
  // Serialize read-modify-write transitions so a concurrent healthy cache hit
  // cannot overwrite a newly recorded provider failure using an older snapshot.
  const ownsConnection = typeof client.connect === 'function' && typeof client.release !== 'function';
  const connection = ownsConnection ? await client.connect() : client;
  let locked = false;
  try {
    await connection.query('SELECT pg_advisory_lock(7104,2)'); locked = true;
    return await evaluateEnrichmentHealth(connection, config, { now, observation, persist: true });
  } finally {
    try { if (locked) await connection.query('SELECT pg_advisory_unlock(7104,2)'); }
    finally { if (ownsConnection) connection.release(); }
  }
}

async function evaluateEnrichmentHealth(client, config, { now, observation, persist }) {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const used = Number((await client.query("SELECT used FROM quotas WHERE scope='enrichment' AND bucket=$1", [day])).rows[0]?.used || 0);
  const previous = (await client.query("SELECT detail FROM health_checks WHERE name='enrichment'")).rows[0]?.detail || {};
  let condition = previous.condition || 'no_lookup_verified';
  let lastVerifiedAt = previous.lastVerifiedAt || null;
  let lastOutcome = previous.lastOutcome || null;
  if (observation?.type === 'resolved') {
    condition = 'healthy'; lastVerifiedAt = now.toISOString(); lastOutcome = observation.outcome;
  } else if (['lookup_failed', 'incomplete_response', 'untrusted_source'].includes(observation?.type)) {
    condition = observation.type; lastOutcome = 'unavailable';
  }
  const limit = config.limits.enrichmentPerDay;
  const quotaState = used >= limit ? 'exhausted' : used > limit * 0.9 ? 'near_limit' : 'available';
  let reason;
  if (!config.enrichmentEnabled) reason = 'disabled';
  else if (!config.trustProxyVerified || config.trustProxyMode === 'disabled') reason = 'untrusted_source';
  else if (quotaState === 'exhausted') reason = 'quota_exhausted';
  else if (condition !== 'healthy') reason = condition;
  else if (quotaState === 'near_limit') reason = 'quota_near_limit';
  else reason = 'available';
  const status = reason === 'available' ? 'ok' : reason === 'quota_near_limit' ? 'warning' : 'degraded';
  const detail = { reason, used, limit, remaining: Math.max(0, limit - used), quotaDay: day.toISOString().slice(0, 10), quotaState,
    condition, lastVerifiedAt, lastOutcome };
  // No addresses, cache hashes or provider error bodies are permitted in operational health.
  if (persist) await setHealth(client, 'enrichment', status, detail, observation?.type === 'resolved');
  return { status, detail };
}

export async function enrichNetwork(client, config, sourceIp, { fetchImpl = fetch, now = new Date() } = {}) {
  if (!config.enrichmentEnabled) {
    await refreshEnrichmentHealth(client, config, { now });
    return { evidence: { status: 'unavailable', reason: 'disabled' }, key: null };
  }
  const ip = publicIp(sourceIp);
  if (!ip || !config.trustProxyVerified || config.trustProxyMode === 'disabled') {
    await refreshEnrichmentHealth(client, config, { now, observation: { type: 'untrusted_source' } });
    return { evidence: { status: 'unavailable', reason: 'untrusted_source' }, key: null };
  }
  const key = networkHash(ip, config.hmacSecret);
  const cached = await client.query('SELECT evidence FROM network_cache WHERE key_hash=$1 AND expires_at>$2', [key, now]);
  if (cached.rowCount) {
    const evidence = cached.rows[0].evidence;
    await refreshEnrichmentHealth(client, config, { now,
      observation: ['lookup_failed', 'incomplete_response'].includes(evidence.reason) ? { type: evidence.reason } : { type: 'cache_hit' } });
    return { evidence, key };
  }
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(+day + 86400000);
  const reserved = await reserveQuota(client, 'enrichment', day, config.limits.enrichmentPerDay, end);
  if (!reserved) {
    await refreshEnrichmentHealth(client, config, { now });
    return { evidence: { status: 'unavailable', reason: 'quota_exhausted' }, key };
  }
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
  await refreshEnrichmentHealth(client, config, { now, observation:
    ['lookup_failed', 'incomplete_response'].includes(evidence.reason) ? { type: evidence.reason } : { type: 'resolved', outcome: evidence.status } });
  return { evidence, key };
}
