import test from 'node:test';
import assert from 'node:assert/strict';
import { createNorthflankLifecycle, loadNorthflankLifecycleConfig } from '../src/host-lifecycle.mjs';

const token = 'synthetic-test-token-do-not-use-in-production';
const config = { token, projectId: 'farpoint', serviceId: 'umami', serviceUid: '68f0aa1b9c4e2d7f11a3b402', umamiUrl: 'http://umami:3000' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function harness(overrides = {}) {
  let time = Date.parse('2026-10-23T12:00:00.000Z');
  let instances = overrides.initialInstances ?? 1;
  const calls = [];
  const running = { name: 'umami-one', status: 'TASK_RUNNING', terminated: false };
  const fetchImpl = async (address, options) => {
    const url = new URL(address); calls.push({ url, options });
    if (overrides.intercept) {
      const result = await overrides.intercept(url, options, { instances, time, calls });
      if (result !== undefined) return result;
    }
    if (url.pathname.endsWith('/pause')) { instances = 0; return json({ data: {} }); }
    if (url.pathname.endsWith('/resume')) { instances = 1; return json({ data: {} }); }
    if (url.pathname === '/api/heartbeat') return json({ ok: true });
    if (url.pathname.endsWith('/containers')) return json({ data: { containers: instances ? [running] : [] }, pagination: { hasNextPage: false, count: instances ? 1 : 0 } });
    if (url.pathname.endsWith('/health')) return json({ data: { observedAt: new Date(time).toISOString(), current: { hasMore: false, containers: instances ? [running] : [] } } });
    return json({ data: { id: 'umami', uid: config.serviceUid, serviceType: 'deployment', deployment: { instances },
      status: { deployment: { status: 'COMPLETED' } }, ports: [{ internalPort: 3000, public: false, vpcAccessible: false }] } });
  };
  return { calls, options: { ...config, fetchImpl, now: () => time, sleep: async ms => { time += ms; },
    pollIntervalMs: 10, maxWaitMs: 1000, maxPolls: 4, ...overrides.options } };
}

test('pause requires complete fresh hosting observations and does not use private HTTP failure as proof', async () => {
  const h = harness();
  const result = await createNorthflankLifecycle(h.options).stopUmami();
  assert.equal(result.state, 'stopped'); assert.equal(result.allInstancesStopped, true);
  assert.match(result.verification, /uid=68f0aa1b9c4e2d7f11a3b402.*observedAt=.*evidence-sha256=[a-f0-9]{64}/);
  assert.equal(result.verification.includes(token), false);
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('/pause')).length, 1);
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('/health')).length, 2);
  assert.equal(h.calls.some(call => call.url.pathname === '/api/heartbeat'), false);
  for (const { url, options } of h.calls) {
    assert.equal(url.origin, 'https://api.northflank.com');
    assert.equal(options.redirect, 'error'); assert.equal(options.credentials, 'omit');
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
  }
});

test('already stopped recovery is idempotent and still verifies every instance', async () => {
  const h = harness({ initialInstances: 0 });
  assert.equal((await createNorthflankLifecycle(h.options).stopUmami()).allInstancesStopped, true);
  assert.equal(h.calls.some(call => call.options.method === 'POST'), false);
  assert.equal(h.calls.filter(call => call.url.pathname.endsWith('/health')).length, 2);
});

test('a second page containing a running instance prevents stop verification', async () => {
  const h = harness({ intercept(url) {
    if (!url.pathname.endsWith('/containers')) return;
    if (!url.searchParams.has('cursor')) return json({ data: { containers: [] }, pagination: { count: 0, hasNextPage: true, cursor: '123456789012345678901234' } });
    return json({ data: { containers: [{ name: 'old-replica', status: 'TASK_RUNNING' }] }, pagination: { count: 1, hasNextPage: false } });
  } });
  await assert.rejects(createNorthflankLifecycle(h.options).stopUmami(), /timed out/);
  assert.equal(h.calls.filter(call => call.url.searchParams.has('cursor')).length, 4);
});

test('termination requires explicit terminal status; killing or failed is insufficient', async () => {
  for (const status of ['TASK_KILLING', 'TASK_FAILED']) {
    const h = harness({ intercept(url) {
      if (url.pathname.endsWith('/containers')) return json({ data: { containers: [{ name: 'old-replica', status }] }, pagination: { count: 1, hasNextPage: false } });
    } });
    await assert.rejects(createNorthflankLifecycle(h.options).stopUmami(), /timed out/);
  }
});

test('malformed, truncated, stale or contradictory instance evidence fails closed', async () => {
  const cases = [
    { observedAt: null, current: { containers: [], hasMore: false } },
    { observedAt: '2000-01-01T00:00:00Z', current: { containers: [], hasMore: false } },
    { current: { containers: [], hasMore: true } },
    { current: { containers: [] } },
    { current: { containers: [{ name: 'old', status: 'TASK_KILLED' }], hasMore: false } },
  ];
  for (const sample of cases) {
    const h = harness({ intercept(url, _, { time }) {
      if (url.pathname.endsWith('/health')) return json({ data: { observedAt: new Date(time).toISOString(), ...sample } });
    } });
    await assert.rejects(createNorthflankLifecycle(h.options).stopUmami(), /evidence/);
  }
  const h = harness({ intercept(url, _, { time }) {
    if (url.pathname.endsWith('/health')) return json({ data: { observedAt: new Date(time).toISOString(), current: {
      hasMore: false, containers: [{ name: 'old', status: 'TASK_KILLED', terminated: false }] } } });
  } });
  await assert.rejects(createNorthflankLifecycle(h.options).stopUmami(), /timed out/);
});

test('an unchanged cached observation never satisfies the second stop verification', async () => {
  const h = harness({ intercept(url) {
    if (url.pathname.endsWith('/health')) return json({ data: { observedAt: '2026-10-23T12:00:00.000Z', current: { hasMore: false, containers: [] } } });
  } });
  await assert.rejects(createNorthflankLifecycle(h.options).stopUmami(), /timed out/);
});

test('missing pagination, loops, unknown states and excessive pages are rejected', async () => {
  for (const sample of [
    { data: { containers: [] } },
    { data: { containers: [] }, pagination: { count: 0, hasNextPage: true } },
    { data: { containers: [] }, pagination: { count: 1, hasNextPage: false } },
    { data: { containers: [{ name: 'one', status: 'UNKNOWN' }] }, pagination: { count: 1, hasNextPage: false } },
    { data: { containers: [] }, pagination: { count: 0, hasNextPage: true, cursor: '123456789012345678901234' } },
  ]) {
    const h = harness({ intercept(url) { if (url.pathname.endsWith('/containers')) return json(sample); } });
    await assert.rejects(createNorthflankLifecycle(h.options).stopUmami(), /container/);
  }
  const h = harness({ options: { maxContainerPages: 1 }, intercept(url) {
    if (url.pathname.endsWith('/containers')) return json({ data: { containers: [] }, pagination: { count: 0, hasNextPage: true, cursor: '123456789012345678901234' } });
  } });
  await assert.rejects(createNorthflankLifecycle(h.options).stopUmami(), /limit/);
});

test('wrong immutable service UID, exposed ports and autoscaling refuse mutation', async () => {
  for (const extra of [{ uid: '000000000000000000000000' }, { ports: [{ internalPort: 3000, public: true }] },
    { ports: [{ internalPort: 3000, public: false, vpcAccessible: true }] }, { autoscaling: { horizontal: { enabled: true } } }]) {
    const h = harness({ intercept(url) {
      if (url.pathname.endsWith('/umami')) return json({ data: { id: 'umami', uid: config.serviceUid, serviceType: 'deployment',
        deployment: { instances: 1 }, status: { deployment: { status: 'COMPLETED' } }, ports: [{ internalPort: 3000, public: false }], ...extra } });
    } });
    await assert.rejects(createNorthflankLifecycle(h.options).stopUmami());
    assert.equal(h.calls.some(call => call.options.method === 'POST'), false);
  }
});

test('resume sets one instance, disables automation and verifies private heartbeat without API token', async () => {
  const h = harness({ initialInstances: 0 });
  assert.deepEqual(await createNorthflankLifecycle(h.options).startUmami(), { state: 'running', privateHealthVerified: true });
  const resume = h.calls.find(call => call.url.pathname.endsWith('/resume'));
  assert.deepEqual(JSON.parse(resume.options.body), { instances: 1, disabledCI: true, disabledCD: true, enableAutoscaling: false });
  const health = h.calls.find(call => call.url.pathname === '/api/heartbeat');
  assert.equal(health.url.href, 'http://umami:3000/api/heartbeat');
  assert.equal(health.options.headers.Authorization, undefined);
});

test('a running service without private health cannot return success; readiness can recover', async () => {
  const h = harness({ intercept(url) { if (url.pathname === '/api/heartbeat') return json({ ok: false }); } });
  await assert.rejects(createNorthflankLifecycle(h.options).startUmami(), /timed out/);
  let failures = 1;
  const recovery = harness({ intercept(url) { if (url.pathname === '/api/heartbeat' && failures-- > 0) return json({}, 503); } });
  assert.equal((await createNorthflankLifecycle(recovery.options).startUmami()).privateHealthVerified, true);
});

test('transport and provider failures never expose response bodies or token-bearing errors', async () => {
  for (const intercept of [() => json({ error: token }, 403), () => { throw new Error(`fetch Authorization Bearer ${token}`); },
    () => new Response(`${token}not-json`), () => new Response('x'.repeat(256 * 1024 + 1)), () => json({}, 302)]) {
    const h = harness({ intercept });
    await assert.rejects(createNorthflankLifecycle(h.options).stopUmami(), error => {
      assert.equal(String(error.stack).includes(token), false); assert.match(error.message, /verification failed/); return true;
    });
  }
});

test('hanging transport is bounded and overlapping lifecycle operations are rejected', async () => {
  const h = harness({ options: { requestTimeoutMs: 10 }, intercept: () => new Promise(() => {}) });
  const adapter = createNorthflankLifecycle(h.options);
  const pending = adapter.stopUmami();
  await assert.rejects(adapter.startUmami(), /in progress/);
  await assert.rejects(pending, /verification failed/);
});

test('configuration requires fixed safe private target and server token', () => {
  const env = { NORTHFLANK_API_TOKEN: token, NORTHFLANK_PROJECT_ID: 'farpoint', NORTHFLANK_UMAMI_SERVICE_ID: 'umami',
    NORTHFLANK_UMAMI_SERVICE_UID: config.serviceUid, UMAMI_URL: 'http://umami:3000' };
  assert.deepEqual(loadNorthflankLifecycleConfig(env), config);
  for (const extra of [{ UMAMI_URL: 'https://example.com' }, { UMAMI_URL: 'http://user:pass@umami:3000' },
    { NORTHFLANK_API_TOKEN: `${token}\nsecret` }, { NORTHFLANK_UMAMI_SERVICE_ID: '../collector' }, { NORTHFLANK_UMAMI_SERVICE_UID: '' }]) {
    assert.throws(() => loadNorthflankLifecycleConfig({ ...env, ...extra }), /Umami lifecycle/);
  }
});
