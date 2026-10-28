import 'server-only';
import { cache } from 'react';
import { createHash } from 'node:crypto';
import { headers } from 'next/headers';
import { accessSession } from '@/lib/session.server';
import { context, propagation, trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import { safeRequestRecord, type RequestEvent } from '@/lib/telemetry';
import { z } from 'zod';
import { projectSchema, projectsSchema, renamedProjectSchema } from './types';
export class ApiError extends Error {
  constructor(readonly status: number) {
    super('API request failed');
  }
}
export async function projectDraftScope() {
  const session = await accessSession();
  if (!session) throw new ApiError(401);
  // One-way identifier only; the bearer credential never crosses the server boundary.
  return createHash('sha256').update(session.scope).digest('hex');
}
const latency = metrics.getMeter('web.api').createHistogram('api.request.duration', { unit: 'ms' });
const requests = metrics.getMeter('web.api').createCounter('api.request.count');
async function request<T>(
  operation: RequestEvent['operation'],
  path: string,
  schema: z.ZodType<T>,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const token = (await accessSession())?.token;
  if (!token) throw new ApiError(401);
  const configured = process.env.API_BASE_URL;
  if (!configured) throw new Error('Missing configuration: API_BASE_URL');
  const base = new URL(configured);
  const local = ['127.0.0.1', 'localhost'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && local))
    throw new Error('API_BASE_URL requires HTTPS except loopback');
  if (base.username || base.password || base.search || base.hash || base.pathname !== '/')
    throw new Error('API_BASE_URL must be an origin');
  const requestId = (await headers()).get('x-request-id') ?? crypto.randomUUID();
  return trace.getTracer('web.api').startActiveSpan(operation, async (span) => {
    const started = performance.now();
    let status = 503;
    let outcome: RequestEvent['outcome'] = 'transport_error';
    try {
      const traceHeaders: Record<string, string> = {};
      propagation.inject(context.active(), traceHeaders);
      const response = await fetch(new URL(path, base), {
        method,
        cache: 'no-store',
        redirect: 'error',
        signal: AbortSignal.timeout(4000),
        headers: {
          ...traceHeaders,
          'x-request-id': requestId,
          authorization: 'Bearer ' + token,
          ...(body ? { 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      status = response.status;
      if (!response.ok) {
        outcome = 'upstream_error';
        throw new ApiError(response.status);
      }
      const payload: unknown = await response.json();
      const parsed = schema.parse(payload);
      outcome = 'ok';
      return parsed;
    } catch (error) {
      if (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name)) outcome = 'timeout';
      else if (error instanceof SyntaxError || error instanceof z.ZodError) outcome = 'invalid_response';
      span.setStatus({ code: SpanStatusCode.ERROR, message: outcome });
      if (error instanceof ApiError) throw error;
      throw new ApiError(503);
    } finally {
      const durationMs = performance.now() - started;
      console.info(
        JSON.stringify(
          safeRequestRecord({ requestId, traceId: span.spanContext().traceId, operation, status, durationMs, outcome }),
        ),
      );
      latency.record(durationMs, { operation, status });
      requests.add(1, { operation, status });
      span.setAttribute('http.response.status_code', status);
      span.end();
    }
  });
}
// cache(): metadata and the page read the same list page once per request.
export const listProjects = cache(async (page: number = 1) => {
  z.number().int().min(1).max(401).parse(page);
  return request('projects.list', '/v1/projects?limit=25&offset=' + (page - 1) * 25, projectsSchema);
});
// cache(): metadata and the page read the same project once per request.
export const readProject = cache(async (id: string) => {
  z.uuid().parse(id);
  return request('projects.read', '/v1/projects/' + id, projectSchema);
});
export async function createProject(name: string) {
  return request('projects.create', '/v1/projects', projectSchema, 'POST', { name });
}
export async function renameProject(id: string, name: string, expectedVersion: number) {
  z.uuid().parse(id);
  return request('projects.rename', '/v1/projects/' + id, renamedProjectSchema, 'PATCH', { name, expectedVersion });
}
