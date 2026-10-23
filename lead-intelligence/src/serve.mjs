import { refreshEnrichmentHealth } from './enrichment.mjs';
import { setHealth } from './db.mjs';
import { createServer } from './server.mjs';
import { drainOutbox } from './outbox.mjs';
import { createReportHandlers } from './jobs.mjs';

/** Own every serve-mode resource from initialization through shutdown. */
export async function startCollector({ pool, config, onReady = () => {}, dependencies = {} }) {
  const {
    refreshHealth = refreshEnrichmentHealth, recordHealth = setHealth,
    makeServer = createServer, makeReportHandlers = createReportHandlers,
    forwardOutbox = drainOutbox, processControl = process,
    schedule = setInterval, cancelSchedule = clearInterval,
  } = dependencies;
  const listenController = new AbortController();
  let server, timer, drainTask, shutdownTask;
  let closing = false, initialized = false, listened = false;
  const assertOpen = () => { if (closing) throw new Error('Collector startup interrupted'); };

  function drain() {
    if (!initialized || closing || drainTask) return drainTask;
    drainTask = Promise.resolve().then(() => forwardOutbox(pool, config))
      .catch(() => recordHealth(pool, 'outbox', 'degraded', { reason: 'worker_failed' }).catch(() => {}))
      .finally(() => { drainTask = undefined; });
    return drainTask;
  }
  function shutdown(reason = 'shutdown') {
    if (shutdownTask) return shutdownTask;
    closing = true;
    listenController.abort();
    if (timer) cancelSchedule(timer);
    processControl.removeListener('SIGTERM', signalShutdown);
    processControl.removeListener('SIGINT', signalShutdown);
    shutdownTask = (async () => {
      const deadline = setTimeout(() => {
        server?.closeAllConnections?.();
        processControl.exit(1);
      }, 15000);
      deadline.unref();
      try {
        try {
          if (server) {
            await new Promise((resolve, reject) => server.close(error => {
              if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
              else resolve();
            }));
          }
          await drainTask;
          await recordHealth(pool, 'collector', 'degraded', { reason }).catch(() => {});
        } finally { await pool.end(); }
      } catch (error) {
        server?.closeAllConnections?.();
        // A failed close must not leave a process alive with a partly running service.
        processControl.exit(1);
        throw error;
      } finally {
        clearTimeout(deadline);
        server?.removeListener('error', serverFailure);
      }
    })();
    return shutdownTask;
  }
  function signalShutdown() { void shutdown().catch(() => {}); }
  function serverFailure() {
    processControl.exitCode = 1;
    void shutdown(initialized ? 'listener_failed' : 'startup_failed').catch(() => {});
  }

  try {
    processControl.once('SIGTERM', signalShutdown);
    processControl.once('SIGINT', signalShutdown);
    const schema = await pool.query('SELECT max(version)::int AS version FROM schema_migrations');
    assertOpen();
    if (schema.rows[0]?.version !== 1) throw new Error('Migrate before startup');
    await refreshHealth(pool, config);
    assertOpen();
    // Required database writes finish before there is any externally reachable listener.
    await recordHealth(pool, 'collector', 'ok', { ready: true }, true);
    assertOpen();
    server = makeServer({ pool, config, reportHandlers: makeReportHandlers({ pool, config }) });
    server.on('error', serverFailure);
    timer = schedule(drain, 30000);
    timer.unref?.();
    initialized = true;
    await new Promise((resolve, reject) => {
      const cleanup = () => {
        server.removeListener('error', failed); server.removeListener('listening', listening);
        listenController.signal.removeEventListener('abort', aborted);
      };
      const failed = error => { cleanup(); reject(error); };
      const listening = () => { cleanup(); resolve(); };
      const aborted = () => { cleanup(); reject(new Error('Collector startup interrupted')); };
      server.once('error', failed);
      server.once('listening', listening);
      listenController.signal.addEventListener('abort', aborted, { once: true });
      try { server.listen({ port: config.port, host: config.host, signal: listenController.signal }); }
      catch (error) { failed(error); }
    });
    assertOpen();
    listened = true;
    await onReady();
    assertOpen();
    void drain();
    return { server, shutdown, drain };
  } catch (error) {
    await shutdown('startup_failed').catch(() => {});
    throw error;
  }
}
