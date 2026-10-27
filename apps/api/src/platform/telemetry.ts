import { context, metrics, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { ConfigurationError, parseUrl } from './configuration-error.js';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { ConsoleSpanExporter } from '@opentelemetry/sdk-trace';
import { ConsoleMetricExporter, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { logEvent, service } from './logging.js';

export function startTelemetry() {
  // Default off: the console exporter writes multi-line, non-JSON output that breaks log parsing. Use otlp in production.
  const mode = process.env.TELEMETRY_EXPORTER ?? 'none';
  if (!['console', 'otlp', 'none'].includes(mode))
    throw new ConfigurationError('TELEMETRY_EXPORTER', 'must be console, otlp or none');
  if (mode === 'none') return { shutdown: async () => {} };
  if (mode === 'otlp') {
    const endpoint = parseUrl('OTEL_EXPORTER_OTLP_ENDPOINT', process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      throw new ConfigurationError('OTEL_EXPORTER_OTLP_ENDPOINT', 'must not contain credentials, query or fragment');
    const localHttp = endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname);
    if (endpoint.protocol !== 'https:' && !localHttp)
      throw new ConfigurationError('OTEL_EXPORTER_OTLP_ENDPOINT', 'must use https: except on loopback');
  }
  const sdk = new NodeSDK({
    serviceName: service,
    autoDetectResources: false,
    logRecordProcessors: [],
    traceExporter: mode === 'otlp' ? new OTLPTraceExporter({ timeoutMillis: 2000 }) : new ConsoleSpanExporter(),
    metricReaders: [
      new PeriodicExportingMetricReader({
        exporter: mode === 'otlp' ? new OTLPMetricExporter({ timeoutMillis: 2000 }) : new ConsoleMetricExporter(),
        exportIntervalMillis: 5000,
        exportTimeoutMillis: 3000,
      }),
    ],
  });
  sdk.start();
  return sdk;
}

export function requestTelemetry(request: Request, response: Response, next: NextFunction) {
  const incomingId = request.headers['x-request-id'];
  const requestId =
    typeof incomingId === 'string' &&
    /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(incomingId)
      ? incomingId
      : randomUUID();
  const started = performance.now();
  const parent = propagation.extract(context.active(), request.headers);
  const span = trace.getTracer('scaffold-api').startSpan('http.request', { kind: SpanKind.SERVER }, parent);
  const active = trace.setSpan(parent, span);
  const meter = metrics.getMeter('scaffold-api');
  const requests = meter.createCounter('http.server.requests');
  const duration = meter.createHistogram('http.server.duration', { unit: 'ms' });
  response.setHeader('x-request-id', requestId);
  const traceId = span.spanContext().traceId;
  // With telemetry off the span is a no-op whose trace id is all zeros; omit the header instead of sending it.
  if (/^[0-9a-f]{32}$/.test(traceId) && !/^0+$/.test(traceId)) response.setHeader('x-trace-id', traceId);
  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    // Route templates only; raw URLs, bodies, query strings and headers may contain secrets.
    const route = typeof request.route?.path === 'string' ? request.route.path : 'unmatched';
    const status = response.writableFinished ? response.statusCode : 499;
    const attrs = { 'http.route': route, 'http.response.status_code': status, 'http.request.method': request.method };
    span.setAttributes(attrs);
    if (status >= 500) span.setStatus({ code: SpanStatusCode.ERROR });
    const durationMs = Math.round(performance.now() - started);
    context.with(active, () => {
      requests.add(1, attrs);
      duration.record(durationMs, attrs);
      logEvent('request.complete', { requestId, method: request.method, route, status, durationMs });
    });
    span.end();
  };
  response.once('finish', end);
  response.once('close', end);
  context.with(active, next);
}
