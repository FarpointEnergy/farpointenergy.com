import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { HttpError, validateEvent } from './validation.mjs';
import { extractSourceIp } from './enrichment.mjs';
import { ingestEvent } from './collector.mjs';
import { outboxHealth } from './outbox.mjs';
import { privacyGate } from './db.mjs';

function authorized(request, config) {
  const given = Buffer.from(request.headers.authorization || '');
  const expected = Buffer.from(`Bearer ${config.adminToken}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
function send(response, status, body, headers = {}) {
  if (response.writableEnded || response.destroyed) return;
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  response.end(body === undefined ? '' : JSON.stringify(body));
}
export function readBody(request, max = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = []; let finished = false;
    function fail(error) { if (!finished) { finished = true; chunks.length = 0; reject(error); } }
    if (Number(request.headers['content-length']) > max) { request.resume(); fail(new HttpError(413, 'body_too_large')); return; }
    request.on('data', chunk => {
      size += chunk.length;
      if (size > max) return fail(new HttpError(413, 'body_too_large'));
      if (!finished) chunks.push(chunk);
    });
    request.on('error', () => fail(new HttpError(400, 'invalid_request')));
    request.on('aborted', () => fail(new HttpError(400, 'invalid_request')));
    request.on('end', () => { if (!finished) { finished = true; resolve(Buffer.concat(chunks).toString('utf8')); } });
  });
}
const safeHealth = rows => rows.map(({ name, last_success, last_attempt, status, detail }) => ({ name, last_success, last_attempt, status, detail }));

export function createServer({ pool, config, reportHandlers = {}, ingest = ingestEvent }) {
  const server = http.createServer(async (request, response) => {
    const adminJob = request.method === 'POST' && request.url === '/v1/jobs/report' && authorized(request, config);
    const timer = setTimeout(() => send(response, 503, { error: 'temporarily_unavailable' }, { 'Retry-After': '60' }), adminJob ? 120000 : 5000);
    timer.unref();
    try {
      const url = new URL(request.url, 'http://collector.invalid');
      if (url.pathname === '/healthz' && request.method === 'GET') return send(response, 200, { status: 'ok' });
      if (url.pathname === '/readyz' && request.method === 'GET') {
        const check = await pool.query('SELECT max(version)::int AS version FROM schema_migrations');
        if (check.rows[0]?.version !== 1 || await privacyGate(pool)) throw new HttpError(503, 'not_ready');
        return send(response, 200, { status: 'ready' });
      }
      if (url.pathname === '/v1/events') {
        if (url.search) throw new HttpError(400, 'invalid_request');
        const origin = request.headers.origin;
        if (!config.origins.includes(origin)) throw new HttpError(403, 'origin_not_allowed');
        const cors = { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' };
        if (request.method === 'OPTIONS') {
          if (request.headers['access-control-request-method'] !== 'POST' || (request.headers['access-control-request-headers'] || '').split(',').some(h => h.trim() && h.trim().toLowerCase() !== 'content-type')) throw new HttpError(403, 'preflight_not_allowed');
          return send(response, 204, undefined, { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' });
        }
        if (request.method !== 'POST') throw new HttpError(405, 'method_not_allowed');
        if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] || '') || request.headers['content-encoding']) throw new HttpError(415, 'unsupported_content_type');
        let body; try { body = JSON.parse(await readBody(request)); } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'invalid_json'); }
        const event = validateEvent(body, config);
        const result = await ingest(pool, config, event, { sourceIp: extractSourceIp(request, config), userAgent: request.headers['user-agent'] || '',
          qa: config.qa || authorized(request, config) });
        return send(response, 202, { accepted: true, ...(result.duplicate ? { duplicate: true } : {}) }, cors);
      }
      if (!['/v1/report', '/v1/jobs/report', '/v1/status'].includes(url.pathname)) throw new HttpError(404, 'not_found');
      if (!authorized(request, config)) throw new HttpError(401, 'unauthorized');
      if ([...url.searchParams.keys()].some(k => url.pathname !== '/v1/report' || !['period', 'date'].includes(k))) throw new HttpError(400, 'invalid_parameters');
      if (url.pathname === '/v1/status' && request.method === 'GET') {
        const checks = await pool.query('SELECT name,last_success,last_attempt,status,detail FROM health_checks ORDER BY name');
        return send(response, 200, { checks: safeHealth(checks.rows), outbox: await outboxHealth(pool), ...(reportHandlers.status ? await reportHandlers.status() : {}) });
      }
      if (url.pathname === '/v1/report' && request.method === 'GET') {
        const period = url.searchParams.get('period') || 'weekly'; const date = url.searchParams.get('date');
        if (!['daily', 'weekly'].includes(period) || (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) || ['period', 'date'].some(k => url.searchParams.getAll(k).length > 1)) throw new HttpError(400, 'invalid_parameters');
        if (!reportHandlers.preview) throw new HttpError(503, 'report_unavailable');
        return send(response, 200, await reportHandlers.preview({ period, date }));
      }
      if (url.pathname === '/v1/jobs/report' && request.method === 'POST') {
        const body = await readBody(request, 64);
        if (body && body.trim() !== '{}') throw new HttpError(400, 'invalid_parameters');
        if (!reportHandlers.runJob) throw new HttpError(503, 'report_unavailable');
        return send(response, 200, await reportHandlers.runJob({ now: new Date() }));
      }
      throw new HttpError(405, 'method_not_allowed');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 503;
      send(response, status, { error: error instanceof HttpError ? error.code : 'temporarily_unavailable' }, status === 429 || status === 503 ? { 'Retry-After': '60' } : {});
    } finally { clearTimeout(timer); }
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.keepAliveTimeout = 5000;
  return server;
}
