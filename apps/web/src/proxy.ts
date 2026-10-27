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
  const type = request.headers.get('content-type') ?? '';
  if (request.headers.has('next-action') && type.startsWith('multipart/form-data')) {
    try {
      await request.clone().formData();
    } catch {
      return reject(400, 'Malformed form submission');
    }
  }
  return undefined;
}

// Private pages stream as soon as rendering starts, so an expired or deleted session must be caught before that:
// redirect to sign-in (returning here afterwards) instead of rendering a 200 "sign in" page.
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
  const login = new URL('/auth/login', identity.settings.origin);
  login.searchParams.set('returnTo', request.nextUrl.pathname + request.nextUrl.search);
  const response = NextResponse.redirect(login, 307);
  // A __Host- cookie is only replaced by one with the same attributes; a bare clearing cookie is ignored by browsers.
  if (cookie)
    response.cookies.set(identity.settings.sessionCookie, '', {
      path: '/',
      maxAge: 0,
      httpOnly: true,
      secure: !identity.settings.insecure,
      sameSite: 'lax',
    });
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
