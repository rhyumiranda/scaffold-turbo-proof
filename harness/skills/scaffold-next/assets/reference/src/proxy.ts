import { NextRequest, NextResponse } from 'next/server';
import { privatePaths } from '@/lib/feature-routes.mjs';
import { identityClient } from '@/lib/session.server';

const MAX_BODY_BYTES = 1024 * 1024;
const readOnly = new Set(['GET', 'HEAD', 'OPTIONS']);

function reject(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: { 'cache-control': 'no-store' } });
}

// True when the browser-sent Origin is this app. In OIDC mode the full origin is configured. Otherwise compare hosts
// with the Host header (a TLS proxy in front may hide the scheme). X-Forwarded-Host is never trusted here: a browser
// cannot forge Host, but any client can send X-Forwarded-Host.
function sameApp(request: NextRequest, origin: string) {
  const configured = identityClient()?.settings.origin;
  if (configured) return origin === configured;
  try {
    return new URL(origin).host === request.headers.get('host');
  } catch {
    return false;
  }
}

// State-changing requests (Server Actions, sign-out) must come from this app in the user's browser.
async function guardWrite(request: NextRequest): Promise<NextResponse | undefined> {
  const origin = request.headers.get('origin');
  const site = request.headers.get('sec-fetch-site');
  if (origin ? !sameApp(request, origin) : site !== 'same-origin') return reject(403, 'Cross-site request rejected');
  if (site && site !== 'same-origin') return reject(403, 'Cross-site request rejected');
  // Browsers always send Content-Length for form posts and Server Actions. A streamed body without it cannot be
  // size-checked here, so it is refused rather than read.
  const length = request.headers.get('content-length');
  if (length === null && request.body) return reject(411, 'Content-Length required');
  if (Number(length ?? 0) > MAX_BODY_BYTES) return reject(413, 'Request body too large');
  // The framework also compares the Origin with the forwarded host (or Host) for Server Actions, and answers a
  // mismatch with a 500. Refuse it here with 403 instead. Behind a proxy, keep Host or X-Forwarded-Host intact.
  if (request.headers.has('next-action')) {
    const forwarded = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || request.headers.get('host');
    if (!origin || new URL(origin).host !== forwarded) return reject(403, 'Cross-site request rejected');
  }
  return guardActionArguments(request);
}

// Server Actions are public endpoints, and the framework's argument decoder answers malformed input with a 500.
// Every action in this app takes a form and is submitted by script, so a browser sends exactly one shape:
// multipart/form-data with the arguments as a JSON array in field "0" and the form's fields as "_<n>_<name>".
// The proxy parses the raw bytes itself and accepts only that shape, so it never approves a body that the framework
// would read differently. Pages stream behind loading.tsx and need JavaScript, so script-free action posts are not
// a supported path. If you add an action called with plain arguments, extend this check instead of removing it.
async function guardActionArguments(request: NextRequest): Promise<NextResponse | undefined> {
  const type = request.headers.get('content-type') ?? '';
  const multipart = /^multipart\/form-data/i.test(type);
  const scripted = request.headers.has('next-action');
  if (!scripted && !multipart) return undefined;
  if (!scripted || !multipart) return reject(400, 'Server Actions accept script-submitted forms only');
  try {
    const fields = browserMultipart(type, new Uint8Array(await request.clone().arrayBuffer()));
    const encoded = fields?.get('0');
    if (encoded === undefined) return reject(400, 'Malformed form submission');
    const args: unknown = JSON.parse(encoded);
    if (!Array.isArray(args) || args.length > 1000 || !plainArguments(args))
      return reject(400, 'Malformed form submission');
    return undefined;
  } catch {
    return reject(400, 'Malformed form submission');
  }
}

const FIELD_NAME = /^(0|_[1-9]\d{0,3}_[A-Za-z][A-Za-z0-9]{0,63})$/;
// Exactly what browsers send: lowercase type and an unquoted boundary of letters, digits and hyphens. Other
// spellings and boundary characters are read differently by the framework's parser.
const BOUNDARY = /^multipart\/form-data; boundary=([0-9A-Za-z-]{1,70})$/;
// Parses multipart/form-data exactly as browsers write text fields: UTF-8, one Content-Disposition header per part,
// no filenames, unique field names. Returns undefined for anything else.
function browserMultipart(type: string, body: Uint8Array) {
  const match = BOUNDARY.exec(type);
  if (!match) return undefined;
  const delimiter = '--' + match[1];
  const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
  const close = text.lastIndexOf('\r\n' + delimiter + '--');
  if (!text.startsWith(delimiter + '\r\n') || close < 0) return undefined;
  if (!/^(\r\n)?$/.test(text.slice(close + delimiter.length + 4))) return undefined;
  const fields = new Map<string, string>();
  for (const part of text.slice(delimiter.length + 2, close).split('\r\n' + delimiter + '\r\n')) {
    const split = part.indexOf('\r\n\r\n');
    const named =
      split < 0 ? null : /^Content-Disposition: form-data; name="([^"\\\r\n]{1,80})"$/i.exec(part.slice(0, split));
    if (!named?.[1] || !FIELD_NAME.test(named[1]) || fields.has(named[1])) return undefined;
    fields.set(named[1], part.slice(split + 4));
  }
  // Browsers choose a boundary that never occurs inside a value; any extra occurrence means a crafted body.
  return text.split(delimiter).length - 1 === fields.size + 1 ? fields : undefined;
}

// Strings starting with "$" are references in the framework's encoding. Allow only escaped text ("$$..."),
// "$undefined" and form references ("$K<n>"). Depth and size are capped so a crafted body cannot exhaust resources.
function plainArguments(root: unknown) {
  const pending: [unknown, number][] = [[root, 0]];
  for (let seen = 0; pending.length; seen++) {
    const [value, depth] = pending.pop()!;
    if (depth > 32 || seen > 10000) return false;
    if (typeof value === 'string') {
      if (value.startsWith('$') && !/^\$(\$|undefined$|K\d+$)/.test(value)) return false;
    } else if (value && typeof value === 'object') {
      for (const child of Object.values(value)) pending.push([child, depth + 1]);
    }
  }
  return true;
}

// Private pages stream as soon as rendering starts, so an expired or deleted session must be caught before that:
// redirect to sign-in (returning here afterwards) instead of rendering a 200 "sign in" page.
// The session cookie is never cleared here. Sessions live on the server, so an unknown cookie grants nothing, and a
// request still in flight with an old cookie (a link prefetch racing a new sign-in) would otherwise delete the cookie
// the sign-in just set. Only sign-out clears it, and the next sign-in replaces it.
async function guardSession(request: NextRequest): Promise<NextResponse | undefined> {
  const identity = identityClient();
  if (!identity || !privatePaths.some((path) => path.test(request.nextUrl.pathname))) return undefined;
  const cookie = request.cookies.get(identity.settings.sessionCookie)?.value;
  let valid: boolean;
  try {
    valid = await identity.hasSession(cookie);
  } catch {
    return undefined; // Session store unavailable: let the page show its outage state.
  }
  if (valid) return undefined;
  // Only a document navigation is sent to sign-in. Prefetches, client-router (RSC) fetches and script fetches get an
  // empty 204 with no side effect (no redirect, no cookie, no data): it is not an RSC payload, so the router drops a
  // prefetch and turns a navigation fetch into a full page load, which then gets the redirect below. Next.js strips its RSC headers before this proxy runs, so the browser's Fetch Metadata is used: a
  // router fetch is Sec-Fetch-Mode cors, a speculative prefetch carries Sec-Purpose prefetch. Clients that send no
  // Fetch Metadata (curl, monitors) keep getting the redirect.
  const mode = request.headers.get('sec-fetch-mode');
  const purpose = request.headers.get('sec-purpose') ?? request.headers.get('purpose') ?? '';
  if ((mode !== null && mode !== 'navigate') || /prefetch|prerender/i.test(purpose))
    return new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
  const login = new URL('/auth/login', identity.settings.origin);
  login.searchParams.set('returnTo', request.nextUrl.pathname + request.nextUrl.search);
  const response = NextResponse.redirect(login, 307);
  response.headers.set('cache-control', 'no-store');
  return response;
}

export async function proxy(request: NextRequest) {
  const early = readOnly.has(request.method) ? await guardSession(request) : await guardWrite(request);
  if (early) return early;
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const requestId = crypto.randomUUID();
  const development = process.env.NODE_ENV === 'development';
  const secure = request.nextUrl.protocol === 'https:';
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(secure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-request-id', requestId);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  response.headers.set('x-request-id', requestId);
  if (secure) response.headers.set('strict-transport-security', 'max-age=31536000');
  return response;
}
export const config = { matcher: '/((?!_next/static|_next/image|favicon.ico).*)' };
