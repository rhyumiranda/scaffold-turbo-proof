import { NextRequest, NextResponse } from 'next/server';
import { identityClient } from '@/lib/session.server';
export const runtime = 'nodejs';
function fail(status: number) {
  return NextResponse.json(
    { error: status === 503 ? 'Sign-in service unavailable' : 'Sign-in request rejected' },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}
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
    try {
      const start = await identity.begin(request.nextUrl.searchParams.get('returnTo') ?? undefined);
      const response = NextResponse.redirect(start.url, 303);
      response.cookies.set(settings.transactionCookie, start.id, { ...options, maxAge: 300 });
      response.headers.set('cache-control', 'no-store');
      return response;
    } catch {
      return problemPage(settings.origin, 'unavailable');
    }
  }
  if (operation !== 'callback') return fail(405);
  const transaction = request.cookies.get(settings.transactionCookie)?.value ?? '';
  // Use configured public origin, never forwarded host headers as authority.
  const url = new URL('/auth/callback' + request.nextUrl.search, settings.origin);
  let response: NextResponse;
  try {
    const { sessionId, returnTo } = await identity.complete(transaction, url);
    const old = request.cookies.get(settings.sessionCookie)?.value;
    if (old) await identity.logout(old);
    response = NextResponse.redirect(new URL(returnTo, settings.origin), 303);
    response.cookies.set(settings.sessionCookie, sessionId, { ...options, maxAge: settings.ttl });
  } catch {
    response = problemPage(settings.origin, 'rejected');
  }
  response.cookies.set(settings.transactionCookie, '', { ...options, maxAge: 0 });
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
