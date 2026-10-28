import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { createRequire } from 'node:module';
// Shared by the start scripts (before the port opens) and by src/lib/identity.ts at runtime.
// Messages name the variable and the rule, never the value, so they are safe to print.
export class ConfigurationError extends Error {
  constructor(variable, reason) {
    super(`${variable}: ${reason}`);
    this.variable = variable;
    this.reason = reason;
  }
}
const parseUrl = (variable, value) => {
  if (!value) throw new ConfigurationError(variable, 'missing');
  try {
    return new URL(value);
  } catch {
    throw new ConfigurationError(variable, 'must be an absolute URL');
  }
};
const loopback = (url) => ['127.0.0.1', 'localhost'].includes(url.hostname);

export function validateRuntime(environment = process.env) {
  const base = parseUrl('API_BASE_URL', environment.API_BASE_URL);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback(base)))
    throw new ConfigurationError('API_BASE_URL', 'must use https: except on loopback');
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw new ConfigurationError('API_BASE_URL', 'must be an origin without credentials, path, query or fragment');
  identitySettings(environment);
  return base;
}

export function identitySettings(env = process.env) {
  const mode = env.AUTH_MODE ?? 'external-cookie';
  if (!['external-cookie', 'oidc'].includes(mode))
    throw new ConfigurationError('AUTH_MODE', 'must be external-cookie or oidc');
  if (mode === 'external-cookie') return undefined;
  const origin = parseUrl('AUTH_APP_ORIGIN', env.AUTH_APP_ORIGIN);
  const issuer = parseUrl('AUTH_ISSUER', env.AUTH_ISSUER);
  const redis = parseUrl('AUTH_REDIS_URL', env.AUTH_REDIS_URL);
  // Insecure loopback mode is for local development only: every identity host must be loopback, and the first one that
  // is not is named, so a single remote host is never blamed on another variable.
  const insecure = env.AUTH_INSECURE_LOOPBACK === 'true';
  if (insecure)
    for (const [variable, url] of [
      ['AUTH_APP_ORIGIN', origin],
      ['AUTH_ISSUER', issuer],
      ['AUTH_REDIS_URL', redis],
    ])
      if (!loopback(url))
        throw new ConfigurationError(variable, 'must be a loopback host when AUTH_INSECURE_LOOPBACK=true');
  if (origin.origin !== env.AUTH_APP_ORIGIN || origin.username || origin.password)
    throw new ConfigurationError('AUTH_APP_ORIGIN', 'must be an exact origin without credentials or path');
  if (origin.protocol !== 'https:' && !(insecure && origin.protocol === 'http:'))
    throw new ConfigurationError(
      'AUTH_APP_ORIGIN',
      'must use https: (http: only with AUTH_INSECURE_LOOPBACK=true on loopback)',
    );
  if (issuer.username || issuer.password || issuer.search || issuer.hash || issuer.pathname.includes('.well-known'))
    throw new ConfigurationError('AUTH_ISSUER', 'must be the issuer identifier, not a discovery URL');
  if (issuer.protocol !== 'https:' && !(insecure && issuer.protocol === 'http:'))
    throw new ConfigurationError(
      'AUTH_ISSUER',
      'must use https: (http: only with AUTH_INSECURE_LOOPBACK=true on loopback)',
    );
  if (redis.protocol !== 'rediss:' && !(redis.protocol === 'redis:' && loopback(redis)))
    throw new ConfigurationError('AUTH_REDIS_URL', 'must use rediss: except on loopback');
  if (!env.AUTH_CLIENT_ID) throw new ConfigurationError('AUTH_CLIENT_ID', 'missing');
  const namespace = env.AUTH_NAMESPACE ?? 'web';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(namespace))
    throw new ConfigurationError('AUTH_NAMESPACE', 'must be 1-64 letters, digits, _ or -');
  const ttl = Number(env.AUTH_SESSION_SECONDS ?? '3600');
  if (!Number.isInteger(ttl) || ttl < 60 || ttl > 86400)
    throw new ConfigurationError('AUTH_SESSION_SECONDS', 'must be an integer from 60 to 86400');
  const scope = env.AUTH_SCOPE ?? 'openid';
  if (!scope.split(' ').includes('openid')) throw new ConfigurationError('AUTH_SCOPE', 'must include openid');
  return {
    origin: origin.origin,
    issuer,
    redis: redis.href,
    namespace,
    ttl,
    scope,
    insecure,
    clientId: env.AUTH_CLIENT_ID,
    clientSecret: env.AUTH_CLIENT_SECRET,
    sessionCookie: insecure ? 'app_session' : '__Host-app_session',
    transactionCookie: insecure ? 'oidc_transaction' : '__Host-oidc_transaction',
  };
}

// Every output line is one JSON object. Framework lines that are not JSON (banners, warnings) are wrapped, not dropped.
function jsonLines(stream, level) {
  const write = stream.write.bind(stream);
  stream.write = (chunk, ...rest) => {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    const out = text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => {
        try {
          JSON.parse(line);
          return line;
        } catch {
          const message = line.replace(/\u001b\[[0-9;]*m/g, '').slice(0, 2000);
          return JSON.stringify({
            time: new Date().toISOString(),
            level,
            service: 'web',
            event: 'framework.log',
            message,
          });
        }
      })
      .join('\n');
    return out ? write(out + '\n', ...rest) : true;
  };
}
const log = (level, event, fields = {}) =>
  (level === 'error' ? console.error : console.info)(
    JSON.stringify({ time: new Date().toISOString(), level, service: 'web', event, ...fields }),
  );

// Validates configuration, then starts the Next.js standalone server with bounded socket timeouts and a
// graceful SIGTERM/SIGINT drain that exits 0 once in-flight requests finish (1 if the deadline passes).
export async function startServer(serverModule, environment = process.env) {
  try {
    validateRuntime(environment);
  } catch (error) {
    if (error instanceof ConfigurationError)
      log('error', 'startup.failure', {
        errorType: 'INVALID_CONFIGURATION',
        variable: error.variable,
        reason: error.reason,
      });
    else log('error', 'startup.failure', { errorType: 'STARTUP_ERROR' });
    process.exit(1);
  }
  jsonLines(process.stdout, 'info');
  jsonLines(process.stderr, 'error');
  const deadline = Number(environment.SHUTDOWN_TIMEOUT_MS ?? '8000');
  // The framework's own validator for the Next-Router-State-Tree header (an internal module, pinned with the exact
  // Next.js version). Without it, a malformed header reaches the renderer and gets a 500.
  let validateRouterState;
  try {
    validateRouterState = createRequire(serverModule)(
      'next/dist/server/app-render/parse-and-validate-flight-router-state',
    ).parseAndValidateFlightRouterState;
  } catch {
    log('error', 'startup.warning', { reason: 'router-state validator not found; malformed headers may get a 500' });
  }
  const servers = [];
  const createServer = http.createServer;
  // One completion record per request: method, path without query, status, duration, request id.
  const withRecord = (listener) => (request, response) => {
    const started = performance.now();
    response.once('close', () => {
      const id = String(response.getHeader('x-request-id') ?? '');
      // Static files bypass the proxy that assigns request ids; give their records one so every line is traceable.
      log(response.statusCode >= 500 ? 'error' : 'info', 'request.complete', {
        requestId: /^[0-9a-f-]{36}$/.test(id) ? id : randomUUID(),
        method: request.method,
        route: (request.url ?? '/').split('?')[0].slice(0, 200),
        status: response.writableFinished ? response.statusCode : 499,
        durationMs: Math.round(performance.now() - started),
      });
    });
    // Browsers send only normalized paths. The framework normalizes again before routing, and answers several
    // non-normal forms with a 500 (dot segments, encoded dots, malformed escapes, request targets that are not
    // paths). So any target whose path is not already normal is refused here, as is a malformed router-state header.
    const raw = (request.url ?? '').split('?')[0];
    let path;
    try {
      decodeURIComponent(raw);
      path = new URL(raw, 'http://localhost').pathname;
      validateRouterState?.(request.headers['next-router-state-tree']);
    } catch {
      path = undefined;
    }
    const reply = (status, headers = {}) => {
      response.writeHead(status, { 'cache-control': 'no-store', ...headers });
      response.end();
    };
    if (!raw.startsWith('/') || path !== raw) return reply(400);
    // The framework's internal error page answers direct requests with a 500.
    if (path === '/_global-error') return reply(404);
    // Static files are skipped by the proxy (its matcher), so a POST there would reach the framework's Server Action
    // handling without the proxy's checks. Nothing in the app accepts a POST on these paths.
    if (request.method === 'POST' && /^\/(favicon\.ico|_next\/)/.test(path)) return reply(405, { allow: 'GET, HEAD' });
    // The framework fails with a 500 on methods it does not implement (TRACE, CONNECT, ...). The app serves only these.
    if (!['GET', 'HEAD', 'OPTIONS', 'POST'].includes(request.method ?? '')) {
      response.writeHead(405, { allow: 'GET, HEAD, OPTIONS, POST', 'cache-control': 'no-store' });
      response.end();
      return;
    }
    return listener(request, response);
  };
  http.createServer = (...args) => {
    const index = args.findIndex((arg) => typeof arg === 'function');
    if (index >= 0) args[index] = withRecord(args[index]);
    const server = createServer(...args);
    server.headersTimeout = 10000; // slow or stalled headers are cut off
    server.requestTimeout = 30000; // whole request, including a trickled body
    // Node enforces both timeouts only when it sweeps connections (default every 30 s); sweep every second.
    server.connectionsCheckingInterval = 1000;
    // The app serves no WebSockets, and the framework leaves upgrade requests open forever; answer them at once.
    server.on('upgrade', (request, socket) => {
      if (!socket.destroyed) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
    });
    servers.push(server);
    return server;
  };
  environment.NEXT_MANUAL_SIG_HANDLE = 'true';
  let stopping = false;
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    log('info', 'shutdown.start', { signal });
    setTimeout(() => {
      log('error', 'shutdown.deadline', { signal });
      process.exit(1);
    }, deadline).unref();
    let open = servers.length;
    if (open === 0) process.exit(0);
    for (const server of servers) {
      server.close(() => {
        open -= 1;
        if (open === 0) {
          log('info', 'shutdown.complete', { signal });
          process.exit(0);
        }
      });
      server.closeIdleConnections();
    }
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));
  await import(serverModule);
}
