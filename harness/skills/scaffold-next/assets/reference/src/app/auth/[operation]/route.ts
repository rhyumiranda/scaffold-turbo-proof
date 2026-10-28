import { NextRequest, NextResponse } from 'next/server';
import { identityClient } from '@/lib/session.server';
import { SignInError, signInRecord } from '@/lib/identity';
import { TRANSACTION_SECONDS } from '@/lib/transaction-cookie.mjs';
export const runtime = 'nodejs';
function fail(status: number) {
  return NextResponse.json(
    { error: status === 503 ? 'Sign-in service unavailable' : 'Sign-in request rejected' },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}
// One structured line per refused or unavailable sign-in. signInRecord keeps only fixed codes, never request values.
function logSignIn(event: Parameters<typeof signInRecord>[0], error: unknown, request: NextRequest) {
  console.warn(JSON.stringify(signInRecord(event, error, request.headers.get('x-request-id'))));
}
// Only a top-level browser navigation starts a sign-in. Link prefetches, client-router (RSC) fetches and scripted
// requests must not create a transaction or set a cookie: run concurrently with a real sign-in, they would leave
// cookies that no callback ever uses. A non-RSC 204 makes the client router fall back to a full page navigation.
function startsSignIn(request: NextRequest) {
  const headers = request.headers;
  if (headers.has('rsc') || headers.has('next-router-prefetch') || headers.has('next-router-state-tree')) return false;
  if (/prefetch|prerender/i.test(headers.get('sec-purpose') ?? headers.get('purpose') ?? '')) return false;
  const mode = headers.get('sec-fetch-mode');
  return mode === null || mode === 'navigate';
}
const noEffect = () => new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } });
const transactionCookies = (request: NextRequest, prefix: string) =>
  Object.fromEntries(
    request.cookies
      .getAll()
      .filter((cookie) => cookie.name.startsWith(prefix))
      .map((cookie) => [cookie.name, cookie.value]),
  );
// Browser navigations get an HTML recovery page, never raw JSON or a stack trace.
function problemPage(origin: string, reason: 'unavailable' | 'rejected') {
  const response = NextResponse.redirect(new URL('/sign-in-problem?reason=' + reason, origin), 303);
  response.headers.set('cache-control', 'no-store');
  return response;
}
export async function GET(request: NextRequest, { params }: { params: Promise<{ operation: string }> }) {
  const operation = (await params).operation;
  const identity = identityClient();
  if (!identity) return fail(404);
  const settings = identity.settings;
  const options = { httpOnly: true, secure: !settings.insecure, sameSite: 'lax' as const, path: '/' };
  if (operation === 'login') {
    if (!startsSignIn(request)) return noEffect();
    try {
      const start = await identity.begin(request.nextUrl.searchParams.get('returnTo') ?? undefined);
      const response = NextResponse.redirect(start.url, 303);
      for (const name of identity.staleTransactions(transactionCookies(request, settings.transactionCookiePrefix)))
        response.cookies.set(name, '', { ...options, maxAge: 0 });
      response.cookies.set(start.name, start.cookie, { ...options, maxAge: TRANSACTION_SECONDS });
      response.headers.set('cache-control', 'no-store');
      return response;
    } catch (error) {
      logSignIn('identity.login.unavailable', error, request);
      return problemPage(settings.origin, 'unavailable');
    }
  }
  if (operation !== 'callback') return fail(405);
  const transactions = transactionCookies(request, settings.transactionCookiePrefix);
  // Use configured public origin, never forwarded host headers as authority.
  const url = new URL('/auth/callback' + request.nextUrl.search, settings.origin);
  let response: NextResponse;
  try {
    const { sessionId, subject, returnTo } = await identity.complete(transactions, url);
    const old = request.cookies.get(settings.sessionCookie)?.value;
    if (old)
      await identity.replace(old, subject).catch((error: unknown) => {
        throw new SignInError('session_store_unavailable', error);
      });
    response = NextResponse.redirect(new URL(returnTo, settings.origin), 303);
    response.cookies.set(settings.sessionCookie, sessionId, { ...options, maxAge: settings.ttl });
  } catch (error) {
    logSignIn('identity.callback.rejected', error, request);
    response = problemPage(settings.origin, 'rejected');
  }
  // Cleared whatever the outcome: a transaction cookie is good for one callback attempt in this browser. Only the cookie
  // for this callback's state: another tab's sign-in keeps its own.
  const name = identity.transactionCookieName(url.searchParams.get('state') ?? '');
  if (Object.hasOwn(transactions, name)) response.cookies.set(name, '', { ...options, maxAge: 0 });
  response.headers.set('cache-control', 'no-store');
  return response;
}
export async function POST(request: NextRequest, { params }: { params: Promise<{ operation: string }> }) {
  try {
    const identity = identityClient();
    if (!identity) return fail(404);
    const settings = identity.settings,
      operation = (await params).operation;
    if (request.headers.get('origin') !== settings.origin) return fail(403);
    const id = request.cookies.get(settings.sessionCookie)?.value ?? '';
    if (operation === 'refresh')
      return (await identity.token(id))
        ? new NextResponse(null, { status: 204, headers: { 'cache-control': 'no-store' } })
        : fail(401);
    if (operation !== 'logout') return fail(405);
    await identity.logout(id);
    const response = NextResponse.redirect(new URL('/signed-out', settings.origin), 303);
    response.cookies.set(settings.sessionCookie, '', {
      httpOnly: true,
      secure: !settings.insecure,
      sameSite: 'lax',
      path: '/',
      maxAge: 0,
    });
    response.headers.set('cache-control', 'no-store');
    return response;
  } catch {
    return fail(503);
  }
}
