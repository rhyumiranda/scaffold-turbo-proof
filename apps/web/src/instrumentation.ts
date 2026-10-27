export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { identitySettings } = await import('./lib/identity');
    identitySettings();
  }
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.OTEL_EXPORTER_OTLP_ENDPOINT) {
    const endpoint = new URL(process.env.OTEL_EXPORTER_OTLP_ENDPOINT);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash)
      throw new Error('Invalid telemetry endpoint');
    if (
      endpoint.protocol !== 'https:' &&
      !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname))
    )
      throw new Error('Telemetry endpoint must use HTTPS except loopback');
    const { registerOTel, OTLPHttpJsonTraceExporter } = await import('@vercel/otel');
    const { safeSpan } = await import('./lib/trace-export');
    const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics');
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
    const serviceName = process.env.OTEL_SERVICE_NAME ?? 'api-backed-web';
    if (!/^[a-zA-Z0-9._-]{1,64}$/.test(serviceName)) throw new Error('Invalid OTEL_SERVICE_NAME');
    const exporter = new OTLPHttpJsonTraceExporter({ url: endpoint.href.replace(/\/$/, '') + '/v1/traces' });
    // spanProcessors:[] is required: @vercel/otel otherwise adds its own unredacted exporter when OTLP env vars are set.
    registerOTel({
      serviceName,
      spanProcessors: [],
      traceExporter: {
        export: (spans, done) =>
          exporter.export(
            spans.map((span) => safeSpan(span, serviceName)),
            done,
          ),
        shutdown: () => exporter.shutdown(),
      },
      metricReaders: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ timeoutMillis: 2000 }),
          exportIntervalMillis: 5000,
          exportTimeoutMillis: 3000,
        }),
      ],
    });
  }
}
