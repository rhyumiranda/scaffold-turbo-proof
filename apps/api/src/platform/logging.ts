import { trace } from '@opentelemetry/api';
export function classifyError(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
  if (typeof code === 'string' && /^(?:[A-Z0-9]{5}|ECONNREFUSED|ECONNRESET|ETIMEDOUT)$/.test(code)) return code;
  return error instanceof Error ? 'APPLICATION_ERROR' : 'UNKNOWN_ERROR';
}
type Fields = {
  method?: string;
  variable?: string;
  reason?: string;
  requestId?: string;
  status?: number;
  durationMs?: number;
  errorType?: string;
  signal?: string;
  route?: string;
};
// The same name is the telemetry service.name, so logs and traces from one service match.
const configuredService = process.env.OTEL_SERVICE_NAME ?? '';
export const service = /^[a-zA-Z0-9._-]{1,64}$/.test(configuredService) ? configuredService : 'api';
// Every line: time, level, service, event. Only the allowlisted fields above may follow; never raw messages.
export function logEvent(event: string, fields: Fields = {}) {
  const traceId = trace.getActiveSpan()?.spanContext().traceId;
  const level = /\.(failure|deadline)$/.test(event) || (fields.status ?? 0) >= 500 ? 'error' : 'info';
  console.info(
    JSON.stringify({
      time: new Date().toISOString(),
      level,
      service,
      event,
      ...fields,
      ...(traceId ? { traceId } : {}),
    }),
  );
}
