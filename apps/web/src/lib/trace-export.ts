import type { ReadableSpan } from '@opentelemetry/sdk-trace-base';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { operations } from './feature-routes.mjs';
export function safeSpan(span: ReadableSpan, serviceName: string): ReadableSpan {
  const name = operations.includes(span.name) ? span.name : 'framework.request';
  const status = span.attributes['http.response.status_code'];
  return {
    ...span,
    spanContext: () => span.spanContext(),
    name,
    resource: resourceFromAttributes({ 'service.name': serviceName }),
    attributes: typeof status === 'number' ? { 'http.response.status_code': status } : {},
    events: [],
    links: [],
    status: { code: span.status.code },
  };
}
