import { STATUS_CODES } from 'node:http';
// RFC 9457 problem details, built in one place for the exception filter, deadline and capacity middleware.
// `type` stays about:blank, so `title` is the HTTP status phrase. `code`, `requestId` and `errors` are extensions.
export type FieldError = { field: string; code: string; message: string };
export const problemCodes: Record<number, string> = {
  400: 'INVALID_INPUT',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  408: 'REQUEST_TIMEOUT',
  409: 'VERSION_CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  429: 'RATE_LIMITED',
  503: 'UNAVAILABLE',
};
const details: Record<number, string> = {
  400: 'The request is invalid. Check the listed fields.',
  401: 'Sign in again; the credentials are missing, expired or invalid.',
  403: 'You are not allowed to do this.',
  404: 'The resource does not exist or you cannot access it.',
  408: 'The request body was not received in time. Send the complete request and retry.',
  409: 'The resource changed since you read it. Reload, then retry.',
  413: 'The request body is too large.',
  415: 'Send JSON with a supported encoding.',
  429: 'Too many requests. Retry after the period in Retry-After.',
  503: 'The service is temporarily unavailable. Retry shortly.',
};
export function problem(status: number, requestId: string, instance?: string, errors?: FieldError[]) {
  return {
    type: 'about:blank',
    title: STATUS_CODES[status] ?? 'Internal Server Error',
    status,
    detail: details[status] ?? 'An unexpected error occurred. Quote the requestId when reporting it.',
    ...(instance ? { instance } : {}),
    code: problemCodes[status] ?? 'INTERNAL_ERROR',
    requestId,
    ...(errors?.length ? { errors } : {}),
  };
}
