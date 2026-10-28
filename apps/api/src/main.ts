import { startTelemetry } from './platform/telemetry.js';
import { installShutdown } from './platform/shutdown.js';
import { classifyError, logEvent } from './platform/logging.js';
import { ConfigurationError } from './platform/configuration-error.js';
import type { Server } from 'node:http';
try {
  const telemetry = startTelemetry();
  const { createApp } = await import('./app.js');
  const { Config } = await import('./platform/config.js');
  const app = await createApp();
  await app.listen(app.get(Config).port, '0.0.0.0');
  installShutdown(
    app.getHttpServer() as Server,
    async () => {
      await app.close();
      await telemetry.shutdown();
    },
    app.get(Config).shutdownMs,
  );
  logEvent('startup.ready');
} catch (error) {
  // Name the bad setting (never its value); other startup failures keep a safe category only.
  if (error instanceof ConfigurationError)
    logEvent('startup.failure', { errorType: 'INVALID_CONFIGURATION', variable: error.variable, reason: error.reason });
  else logEvent('startup.failure', { errorType: classifyError(error) });
  process.exit(1);
}
