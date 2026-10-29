export type SessionPreflight = 'ready' | 'expired' | 'unavailable';

export async function preflightSession(): Promise<SessionPreflight> {
  try {
    const response = await fetch('/auth/refresh', { method: 'POST' });
    if (response.status === 204) return 'ready';
    if (response.status === 401) return 'expired';
  } catch {
    // The Server Action remains authoritative when the advisory preflight is unavailable.
  }
  return 'unavailable';
}
