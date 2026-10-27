// Preview-only wrapper. Build constants and unchanged collector core precede it.
// No environment setting can enable identity adaptation, source IP, or exports.
const PREVIEW_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff',
  'X-Robots-Tag': 'noindex, nofollow, noarchive',
  'X-Frame-Options': 'DENY'
};
function previewError(status, error) {
  return new Response(JSON.stringify({error}), {status, headers:{...PREVIEW_HEADERS, 'Content-Type':'application/json; charset=utf-8'}});
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.origin !== PREVIEW_ORIGIN) return previewError(404, 'not_found');
    if (url.pathname === '/mcp') return previewError(403, 'private_export_unavailable');
    if (url.pathname === '/v1/events') {
      return createCollector({
        store: new R2CreateOnlyStore(env.BUCKET),
        allowedOrigins: [PREVIEW_ORIGIN],
        collectorVersion: PREVIEW_BUILD_VERSION,
        verifiedSourceIp: null
      }).fetch(request);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return previewError(405, 'method_not_allowed');
    // Literal manifest lookup only: no decoding, filesystem access, or fetch proxy.
    const path = url.pathname === '/' ? '/index.html' : url.pathname;
    const asset = Object.hasOwn(PREVIEW_ASSETS, path) ? PREVIEW_ASSETS[path] : null;
    if (!asset) return previewError(404, 'not_found');
    const bytes = request.method === 'HEAD' ? null : Uint8Array.from(atob(asset.base64), c => c.charCodeAt(0));
    return new Response(bytes, {status: path === '/404.html' ? 404 : 200, headers:{
      ...PREVIEW_HEADERS,
      'Content-Type': asset.content_type,
      'Content-Length': String(asset.bytes),
      'X-Farpoint-Asset-SHA256': asset.sha256
    }});
  }
};
