import { operations } from './feature-routes.mjs';

export type RequestEvent = {
  requestId: string;
  traceId?: string;
  operation: string;
  status: number;
  durationMs: number;
  outcome: 'ok' | 'upstream_error' | 'timeout' | 'transport_error' | 'invalid_response';
};
export function safeRequestRecord(event: RequestEvent) {
  const status = Number.isInteger(event.status) && event.status >= 100 && event.status <= 599 ? event.status : 503;
  return {
    time: new Date().toISOString(),
    level: status >= 500 ? 'error' : 'info',
    service: 'web',
    event: 'api.request',
    requestId: /^[0-9a-f-]{36}$/.test(event.requestId) ? event.requestId : 'invalid',
    ...(event.traceId && /^[0-9a-f]{32}$/.test(event.traceId) && !/^0+$/.test(event.traceId)
      ? { traceId: event.traceId }
      : {}),
    operation: operations.includes(event.operation) ? event.operation : 'unknown',
    status,
    durationMs: Number.isFinite(event.durationMs) ? Math.max(0, Math.round(event.durationMs)) : 0,
    outcome: ['ok', 'upstream_error', 'timeout', 'transport_error', 'invalid_response'].includes(event.outcome)
      ? event.outcome
      : 'transport_error',
  };
}
