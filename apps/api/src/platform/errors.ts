import { applyDecorators, ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { ApiResponse } from '@nestjs/swagger';
import type { ErrorRequestHandler, Request, RequestHandler, Response } from 'express';
import type { ValidationError } from 'class-validator';
import { randomUUID } from 'node:crypto';
import { classifyError, logEvent } from './logging.js';
import { problem, type FieldError } from './problem.js';
// Registered immediately after the body parser, before business handlers.
// Only this trusted boundary may translate parser status; arbitrary application errors stay 500.
// A body that is not JSON is the wrong media type (415), not invalid JSON (400).
export const requireJsonBody: RequestHandler = (request, _response, next) => {
  const hasBody =
    Number(request.headers['content-length'] ?? 0) > 0 || request.headers['transfer-encoding'] !== undefined;
  if (['POST', 'PUT', 'PATCH'].includes(request.method) && hasBody && !request.is('application/json'))
    next(new HttpException('Unsupported media type', 415));
  else next();
};
// Deeply nested JSON exhausts the validator's recursion (a 500). Real payloads here are shallow, so reject early.
export const MAX_JSON_DEPTH = 32;
export function jsonDepth(value: unknown): number {
  let deepest = 0;
  const stack: [unknown, number][] = [[value, 1]];
  while (stack.length) {
    const [node, depth] = stack.pop()!;
    if (node === null || typeof node !== 'object') continue;
    deepest = Math.max(deepest, depth);
    if (deepest > MAX_JSON_DEPTH) return deepest;
    for (const child of Object.values(node)) stack.push([child, depth + 1]);
  }
  return deepest;
}
export const limitJsonDepth: RequestHandler = (request, _response, next) => {
  if (jsonDepth(request.body) > MAX_JSON_DEPTH) next(new HttpException('Request body nested too deeply', 400));
  else next();
};
// Responses to authenticated API calls are private: never stored by browsers or shared caches.
export const privateNoStore: RequestHandler = (_request, response, next) => {
  response.setHeader('cache-control', 'no-store');
  next();
};
export const bodyParserErrors: ErrorRequestHandler = (error: unknown, _request, _response, next) => {
  const status = error instanceof Error && 'status' in error ? error.status : undefined;
  if (typeof status === 'number' && [400, 413, 415].includes(status))
    next(new HttpException('Request body rejected', status));
  else next(error);
};
// RFC 9457 problem details. `type` stays about:blank, so `title` is the HTTP status phrase;
// `code`, `requestId` and `errors` are extension members.
export const problemSchema = {
  type: 'object' as const,
  required: ['type', 'title', 'status', 'detail', 'code', 'requestId'],
  additionalProperties: false,
  properties: {
    type: { type: 'string' as const, enum: ['about:blank'] },
    title: { type: 'string' as const },
    status: { type: 'integer' as const },
    detail: { type: 'string' as const },
    instance: { type: 'string' as const },
    code: { type: 'string' as const },
    requestId: { type: 'string' as const, format: 'uuid' },
    errors: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        required: ['field', 'code', 'message'],
        additionalProperties: false,
        properties: {
          field: { type: 'string' as const },
          code: { type: 'string' as const },
          message: { type: 'string' as const },
        },
      },
    },
  },
};
// Used as the ValidationPipe exceptionFactory. Messages name the field and rule, never the submitted value.
export function fieldErrors(errors: ValidationError[], parent = ''): FieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const own = Object.entries(error.constraints ?? {}).map(([code, message]) => ({ field, code, message }));
    return [...own, ...fieldErrors(error.children ?? [], field)];
  });
}
export function ApiProblems(...statuses: number[]) {
  return applyDecorators(
    ...statuses.map((status) =>
      ApiResponse({
        status,
        description: 'Safe problem response',
        content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } },
      }),
    ),
  );
}
@Catch()
export class ProblemFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = typeof http.getRequest === 'function' ? http.getRequest<Request>() : undefined;
    if (response.writableEnded) return;
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const requestId = String(response.getHeader('x-request-id') ?? randomUUID());
    if (status >= 500) logEvent('request.failure', { requestId, status, errorType: classifyError(error) });
    const body = error instanceof HttpException ? error.getResponse() : undefined;
    const message = typeof body === 'object' && body !== null && 'message' in body ? body.message : undefined;
    const errors =
      status === 400 &&
      Array.isArray(message) &&
      message.every((item) => typeof item === 'object' && item !== null && 'field' in item)
        ? (message as FieldError[])
        : undefined;
    if ((status === 503 || status === 429) && !response.getHeader('retry-after'))
      response.setHeader('retry-after', '5');
    response
      .status(status)
      .type('application/problem+json')
      .json(problem(status, requestId, request?.originalUrl?.split('?')[0], errors));
  }
}
