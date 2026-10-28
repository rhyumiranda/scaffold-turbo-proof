// Liveness for orchestrators and smoke checks: no session, no API call, never cached.
// It stays 200 while the API or identity provider is down; /projects shows those outages to users.
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'cache-control': 'no-store' } });
}
