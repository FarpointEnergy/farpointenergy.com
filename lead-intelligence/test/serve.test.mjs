import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter, once } from 'node:events';
import http from 'node:http';
import { startCollector } from '../src/serve.mjs';

function fixture(overrides = {}) {
  const calls = [], timers = new Set(), servers = [];
  const control = new EventEmitter();
  control.exit = code => calls.push(`exit:${code}`);
  let ended = 0;
  const pool = {
    async query() { calls.push('schema'); return { rows: [{ version: 1 }] }; },
    async end() { ended++; calls.push('end'); },
  };
  const dependencies = {
    processControl: control,
    async refreshHealth() { calls.push('enrichment'); },
    async recordHealth(_pool, name, status) { calls.push(`${name}:${status}`); },
    makeReportHandlers() { calls.push('handlers'); return {}; },
    makeServer() {
      calls.push('server');
      const server = http.createServer((_request, response) => response.end('ready'));
      servers.push(server);
      return server;
    },
    async forwardOutbox() { calls.push('drain'); },
    schedule(fn, delay) { const timer = setInterval(fn, delay); timers.add(timer); return timer; },
    cancelSchedule(timer) { clearInterval(timer); timers.delete(timer); },
    ...overrides,
  };
  return { pool, dependencies, control, calls, timers, servers, get ended() { return ended; }, config: { port: 0, host: '127.0.0.1' } };
}
async function reusablePort(port) {
  const server = http.createServer();
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  await new Promise(resolve => server.close(resolve));
}

test('schema/enrichment/collector-health failure closes the pool without opening a listener', async t => {
  for (const failure of ['schema', 'enrichment', 'collector']) {
    await t.test(failure, async () => {
      const f = fixture();
      if (failure === 'schema') f.pool.query = async () => { throw new Error('synthetic database unavailable'); };
      if (failure === 'enrichment') f.dependencies.refreshHealth = async () => { throw new Error('synthetic health failure'); };
      if (failure === 'collector') f.dependencies.recordHealth = async () => { throw new Error('synthetic health failure'); };
      await assert.rejects(startCollector(f), /synthetic/);
      assert.equal(f.servers.length, 0);
      assert.equal(f.ended, 1);
      assert.equal(f.timers.size, 0);
      assert.equal(f.control.listenerCount('SIGTERM'), 0);
      assert.equal(f.control.listenerCount('SIGINT'), 0);
    });
  }
});
test('failure after binding closes the actual port, timer, handlers and pool', async () => {
  const f = fixture();
  let port;
  await assert.rejects(startCollector({ ...f, onReady: () => {
    port = f.servers[0].address().port;
    throw new Error('synthetic final bootstrap failure');
  } }), /synthetic final bootstrap failure/);
  assert.equal(f.servers[0].listening, false);
  assert.equal(f.ended, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.control.listenerCount('SIGTERM'), 0);
  assert.equal(f.calls.includes('drain'), false);
  assert.equal(f.calls.at(-2), 'collector:degraded');
  await reusablePort(port);
});
test('bind failure cleans the partially created server and every owned resource', async () => {
  const occupied = http.createServer();
  occupied.listen(0, '127.0.0.1'); await once(occupied, 'listening');
  try {
    const f = fixture(); f.config.port = occupied.address().port;
    await assert.rejects(startCollector(f));
    assert.equal(f.servers[0].listening, false);
    assert.equal(f.ended, 1);
    assert.equal(f.timers.size, 0);
    assert.equal(f.control.listenerCount('SIGTERM'), 0);
  } finally { await new Promise(resolve => occupied.close(resolve)); }
});
test('successful startup initializes health first; shutdown waits for its one outbox attempt before ending the pool', async () => {
  let releaseDrain;
  const pending = new Promise(resolve => { releaseDrain = resolve; });
  const f = fixture({ forwardOutbox: async () => { f.calls.push('drain'); await pending; f.calls.push('drain-finished'); } });
  const service = await startCollector(f);
  const port = service.server.address().port;
  assert.ok(f.calls.indexOf('collector:ok') < f.calls.indexOf('server'));
  assert.ok(f.calls.indexOf('enrichment') < f.calls.indexOf('collector:ok'));
  assert.equal((await fetch(`http://127.0.0.1:${port}/readyz`)).status, 200);
  service.drain(); service.drain();
  assert.equal(f.calls.filter(value => value === 'drain').length, 1);
  const shutdown = service.shutdown();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.ended, 0);
  releaseDrain(); await shutdown; await service.shutdown();
  assert.equal(f.ended, 1);
  assert.ok(f.calls.indexOf('drain-finished') < f.calls.indexOf('end'));
  assert.equal(f.timers.size, 0);
  assert.equal(f.control.listenerCount('SIGTERM'), 0);
  await reusablePort(port);
});
test('shutdown during initialization never resumes into a newly bound listener', async () => {
  let releaseQuery;
  const f = fixture();
  f.pool.query = () => new Promise(resolve => { releaseQuery = resolve; });
  const starting = startCollector(f);
  f.control.emit('SIGTERM');
  releaseQuery({ rows: [{ version: 1 }] });
  await assert.rejects(starting, /startup interrupted/);
  assert.equal(f.servers.length, 0);
  assert.equal(f.ended, 1);
  assert.equal(f.timers.size, 0);
});
