import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const API = 'https://api.northflank.com/v1';
const STATUSES = new Set(['TASK_RUNNING', 'TASK_STARTING', 'TASK_STAGING', 'TASK_KILLING', 'TASK_KILLED', 'TASK_FAILED', 'TASK_FINISHED']);
// A failed container is not treated as proof that its processes have terminated.
const STOPPED = new Set(['TASK_KILLED', 'TASK_FINISHED']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = message => { throw new Error(`Umami lifecycle: ${message}`); };
function integer(value, min, max, name) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`invalid ${name}`);
  return value;
}
function validateConfig({ token, projectId, serviceId, serviceUid, umamiUrl }) {
  if (typeof token !== 'string' || token.length < 32 || token.length > 4096 || /\s|[\x00-\x1f\x7f]/.test(token)) fail('invalid NORTHFLANK_API_TOKEN');
  for (const [name, value] of Object.entries({ projectId, serviceId })) {
    if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9-]{0,62}$/.test(value)) fail(`invalid ${name}`);
  }
  if (typeof serviceUid !== 'string' || !/^[a-f0-9]{24}$/.test(serviceUid)) fail('invalid NORTHFLANK_UMAMI_SERVICE_UID');
  let url;
  try { url = new URL(umamiUrl); } catch { fail('invalid UMAMI_URL'); }
  // Northflank documents project-private service-name:port addressing. Do not
  // accept public hosts, arbitrary destinations, redirects or URL credentials.
  if (url.protocol !== 'http:' || url.hostname !== serviceId || url.port !== '3000' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    fail('UMAMI_URL must be the configured private service on port 3000');
  }
  return { token, projectId, serviceId, serviceUid, umamiUrl: url.origin };
}

export function loadNorthflankLifecycleConfig(env = process.env) {
  return Object.freeze(validateConfig({ token: env.NORTHFLANK_API_TOKEN, projectId: env.NORTHFLANK_PROJECT_ID,
    serviceId: env.NORTHFLANK_UMAMI_SERVICE_ID, serviceUid: env.NORTHFLANK_UMAMI_SERVICE_UID, umamiUrl: env.UMAMI_URL }));
}

/** Maintenance-only adapter. It never clears the database maintenance gate. */
export function createNorthflankLifecycle(options) {
  const config = validateConfig(options);
  const { fetchImpl = globalThis.fetch, now = Date.now, sleep = delay } = options;
  const pollIntervalMs = integer(options.pollIntervalMs ?? 5000, 1, 30000, 'poll interval');
  const maxWaitMs = integer(options.maxWaitMs ?? 300000, 1, 600000, 'maximum wait');
  const requestTimeoutMs = integer(options.requestTimeoutMs ?? 10000, 1, 30000, 'request timeout');
  const maxPolls = integer(options.maxPolls ?? 60, 2, 120, 'poll limit');
  const maxContainerPages = integer(options.maxContainerPages ?? 10, 1, 20, 'container page limit');
  if (typeof fetchImpl !== 'function' || typeof now !== 'function' || typeof sleep !== 'function') fail('invalid dependencies');
  const path = `/projects/${config.projectId}/services/${config.serviceId}`;
  let busy = false;

  async function request(url, { method = 'GET', body, authenticated = true, allowConflict = false, deadline } = {}) {
    const timeout = Math.min(requestTimeoutMs, deadline - now());
    if (timeout <= 0) fail('verification timed out; maintenance remains gated');
    const controller = new AbortController();
    let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetchImpl(url, { method, redirect: 'error', credentials: 'omit', cache: 'no-store',
            signal: controller.signal, headers: { Accept: 'application/json', 'Cache-Control': 'no-cache',
              ...(authenticated ? { Authorization: `Bearer ${config.token}` } : {}),
              ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
          if (allowConflict && response.status === 409) { await response.body?.cancel(); return null; }
          if (response.status !== 200 || response.redirected) {
            await response.body?.cancel();
            fail('hosting or health request rejected');
          }
          const reader = response.body?.getReader();
          if (!reader) fail('missing hosting response');
          const chunks = []; let size = 0;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 256 * 1024) { await reader.cancel(); fail('oversized hosting response'); }
            chunks.push(Buffer.from(value));
          }
          let result;
          try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid hosting response'); }
          if (!object(result)) fail('invalid hosting response');
          return result;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Umami lifecycle: request timed out; maintenance remains gated')); }, timeout); }),
      ]);
    } catch {
      // Neither provider response bodies nor transport errors are safe to log:
      // get-service can include secrets, and errors can include request headers.
      fail('hosting or health verification failed; maintenance remains gated');
    } finally { clearTimeout(timer); controller.abort(); }
  }

  async function service(deadline) {
    const { data } = await request(`${API}${path}`, { deadline });
    if (!object(data) || data.id !== config.serviceId || data.uid !== config.serviceUid || data.serviceType !== 'deployment' ||
        !Number.isInteger(data.deployment?.instances) || data.deployment.instances < 0 ||
        !['PENDING', 'IN_PROGRESS', 'COMPLETED', 'FAILED'].includes(data.status?.deployment?.status)) fail('unexpected service identity or state');
    if (!Array.isArray(data.ports) || !data.ports.some(port => port.internalPort === 3000) ||
        data.ports.some(port => port.public !== false || (port.vpcAccessible !== undefined && port.vpcAccessible !== false)) ||
        data.autoscaling?.horizontal?.enabled === true) fail('service must be private with autoscaling disabled');
    return { instances: data.deployment.instances, status: data.status.deployment.status };
  }

  async function containers(deadline) {
    const all = []; const cursors = new Set(); const names = new Set(); let cursor;
    for (let page = 0; page < maxContainerPages; page++) {
      const url = new URL(`${API}${path}/containers`);
      url.searchParams.set('per_page', '100');
      if (cursor) url.searchParams.set('cursor', cursor);
      const result = await request(url.href, { deadline });
      const list = result.data?.containers;
      if (!Array.isArray(list) || list.length > 100 || typeof result.pagination?.hasNextPage !== 'boolean' || result.pagination.count !== list.length) fail('incomplete container evidence');
      for (const item of list) {
        if (!object(item) || typeof item.name !== 'string' || !item.name || names.has(item.name) || !STATUSES.has(item.status)) fail('invalid container evidence');
        names.add(item.name); all.push({ name: item.name, status: item.status });
      }
      if (!result.pagination.hasNextPage) return all;
      cursor = result.pagination.cursor;
      if (typeof cursor !== 'string' || !/^[a-zA-Z0-9]{24}$/.test(cursor) || cursors.has(cursor)) fail('incomplete container pagination');
      cursors.add(cursor);
    }
    fail('container pagination exceeds verification limit');
  }

  async function observation(deadline) {
    const before = await service(deadline);
    const listed = await containers(deadline);
    const observedAfter = now();
    const { data } = await request(`${API}${path}/health`, { deadline });
    const observedAt = typeof data?.observedAt === 'string' ? Date.parse(data.observedAt) : NaN;
    if (!Number.isFinite(observedAt) || observedAt < observedAfter - 5000 || observedAt > now() + 5000 || now() - observedAt > 30000 ||
        !Array.isArray(data.current?.containers) || data.current.hasMore !== false) fail('stale or incomplete instance evidence');
    const current = data.current.containers.map(item => {
      if (!object(item) || typeof item.name !== 'string' || !item.name || !STATUSES.has(item.status) || typeof item.terminated !== 'boolean') fail('invalid instance evidence');
      return { name: item.name, status: item.status, terminated: item.terminated };
    });
    if (new Set(current.map(item => item.name)).size !== current.length) fail('duplicate instance evidence');
    const after = await service(deadline);
    return { before, after, listed, current, observedAt };
  }

  async function transition(mode) {
    if (busy) fail('another lifecycle operation is in progress');
    busy = true;
    try {
      const deadline = now() + maxWaitMs;
      const initial = await service(deadline); // Match immutable UID before mutation.
      if (mode === 'stop' && initial.instances !== 0) {
        const result = await request(`${API}${path}/pause`, { method: 'POST', deadline });
        if (!object(result?.data)) fail('invalid pause acknowledgement');
      } else if (mode === 'start' && initial.instances === 0) {
        const result = await request(`${API}${path}/resume`, { method: 'POST', deadline, allowConflict: true,
          body: { instances: 1, disabledCI: true, disabledCD: true, enableAutoscaling: false } });
        if (result !== null && !object(result.data)) fail('invalid resume acknowledgement');
      } else if (mode === 'start' && initial.instances !== 1) fail('pilot resume requires exactly one instance');

      let previous;
      for (let attempt = 0; attempt < maxPolls && now() < deadline; attempt++) {
        const evidence = await observation(deadline);
        const stable = evidence.before.status === 'COMPLETED' && evidence.after.status === 'COMPLETED';
        let verified;
        if (mode === 'stop') {
          verified = stable && evidence.before.instances === 0 && evidence.after.instances === 0 &&
            evidence.listed.every(item => STOPPED.has(item.status)) &&
            evidence.current.every(item => item.terminated && STOPPED.has(item.status));
        } else {
          verified = stable && evidence.before.instances === 1 && evidence.after.instances === 1 &&
            evidence.current.filter(item => !item.terminated).length === 1 &&
            evidence.current.some(item => !item.terminated && item.status === 'TASK_RUNNING') &&
            evidence.listed.filter(item => item.status === 'TASK_RUNNING').length === 1 &&
            evidence.listed.every(item => item.status === 'TASK_RUNNING' || STOPPED.has(item.status)) &&
            evidence.current.some(item => !item.terminated && evidence.listed.some(listed => listed.name === item.name && listed.status === 'TASK_RUNNING'));
        }
        // Repeated, fresh control-plane observations guard against transient and
        // cached scale-down responses. Failed HTTP health never proves a stop.
        if (verified && previous !== undefined && evidence.observedAt > previous) {
          if (mode === 'start') {
            try {
              const health = await request(`${config.umamiUrl}/api/heartbeat`, { authenticated: false, deadline });
              if (health.ok === true) return { state: 'running', privateHealthVerified: true };
            } catch { /* A starting process may not be ready yet; keep the gate closed. */ }
          } else {
            const digest = createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
            return { state: 'stopped', allInstancesStopped: true,
              verification: `Northflank ${path}; uid=${config.serviceUid}; observedAt=${new Date(evidence.observedAt).toISOString()}; evidence-sha256=${digest}` };
          }
        }
        previous = verified ? evidence.observedAt : undefined;
        const remaining = deadline - now();
        if (remaining > 0 && attempt + 1 < maxPolls) await sleep(Math.min(pollIntervalMs, remaining));
      }
      fail('verification timed out; maintenance remains gated');
    } finally { busy = false; }
  }
  return Object.freeze({ stopUmami: () => transition('stop'), startUmami: () => transition('start') });
}
