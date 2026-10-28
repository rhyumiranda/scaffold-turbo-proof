import type { Server } from 'node:http';
import { logEvent } from './logging.js';
export function installShutdown(server: Server, close: () => Promise<void>, deadlineMs: number) {
  let stopping = false;
  server.on('request', (_request, response) => {
    response.once('finish', () => {
      if (stopping) setImmediate(() => server.closeIdleConnections());
    });
  });
  const stop = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    server.keepAliveTimeout = 1;
    logEvent('shutdown.start', { signal });
    const deadline = setTimeout(() => {
      logEvent('shutdown.deadline', { signal });
      server.closeAllConnections();
      process.exit(1);
    }, deadlineMs);
    try {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await close();
      clearTimeout(deadline);
      logEvent('shutdown.complete', { signal });
      process.exitCode = 0;
    } catch {
      clearTimeout(deadline);
      logEvent('shutdown.failure', { signal });
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => {
    void stop('SIGTERM');
  });
  process.on('SIGINT', () => {
    void stop('SIGINT');
  });
}
