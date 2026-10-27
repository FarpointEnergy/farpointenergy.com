// Concatenated after the unchanged collector core by build-worker.mjs.
// Direct Cloudflare deployment deliberately has no public export/auth adapter.
const CF_WRAPPER_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'private, no-store, max-age=0',
  'Pragma': 'no-cache',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow'
};

function canonicalCloudflareIp(value) {
  if (typeof value !== 'string' || value.length < 2 || value.length > 45 || !/^[0-9a-fA-F:.]+$/.test(value)) return null;
  if (value.includes(':')) {
    try {
      const host = new URL(`https://[${value}]/`).hostname;
      return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : null;
    } catch { return null; }
  }
  const parts = value.split('.');
  if (parts.length !== 4 || parts.some(p => !/^(0|[1-9][0-9]{0,2})$/.test(p) || Number(p) > 255)) return null;
  // Cloudflare's Pseudo IPv4 addresses use Class E, never a visitor address.
  return Number(parts[0]) >= 240 ? null : value;
}

/**
 * Default-off adapter for an exact, independently tested direct-edge hostname.
 * The deployment gate records external evidence; these checks do not prove it.
 * Forwarded headers and request-body fields never provide source IP evidence.
 * A valid address identifies the observed network peer, not an employer/person.
 */
export function cloudflareDirectSourceIp(request, env) {
  if (env.CLOUDFLARE_DIRECT_IP_VERIFIED !== '1') return null;
  const host = env.CLOUDFLARE_VERIFIED_IP_HOSTNAME;
  if (typeof host !== 'string' || !host || new URL(request.url).hostname !== host) return null;
  if (!request.cf || typeof request.cf !== 'object' || Array.isArray(request.cf)) return null;
  // CF-Worker is added to fetch() subrequests by Cloudflare. A client adding it
  // can only suppress attribution, not make another header authoritative.
  if (request.headers.has('cf-worker') || request.headers.has('cf-connecting-o2o')) return null;
  // Pseudo IPv4 Overwrite Headers is outside this initially supported path.
  // Do not guess which client-supplied companion header is trustworthy.
  if (request.headers.has('cf-connecting-ipv6')) return null;
  const address = canonicalCloudflareIp(request.headers.get('cf-connecting-ip'));
  if (!address || address === '2a06:98c0:3600::103') return null;
  return {status: 'verified', provenance: 'cloudflare_direct_edge_v1', address};
}

export default {
  async fetch(request, env) {
    // No environment variable, bearer token or forged Sites identity can enable
    // export on the public collector. Use the authenticated management path.
    if (new URL(request.url).pathname === '/mcp') {
      return new Response(JSON.stringify({error: 'private_export_unavailable'}), {status: 403, headers: CF_WRAPPER_HEADERS});
    }
    const probe = await createSyntheticIpProbe({sourceVersion: BUILD_SOURCE_VERSION})(request, env);
    if (probe) return probe;
    const collector = createCollector({
      store: new R2CreateOnlyStore(env.BUCKET),
      ...(syntheticIntakeProofEnabled(request,env)?{allowedOrigins:['https://farpointenergy.com','https://www.farpointenergy.com','https://'+env.CLOUDFLARE_SYNTHETIC_IP_PROBE_HOSTNAME]}:{}),
      collectorVersion: BUILD_SOURCE_VERSION,
      verifiedSourceIp: request => cloudflareDirectSourceIp(request, env)
      // ownerIdentity and both identity trust modes remain at closed defaults.
    });
    return collector.fetch(request);
  }
};
