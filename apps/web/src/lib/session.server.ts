import 'server-only';
import { cookies } from 'next/headers';
import { Identity, identitySettings } from './identity';
let client: Identity | undefined;
export function identityClient() {
  const settings = identitySettings();
  if (!settings) return undefined;
  return (client ??= new Identity(settings));
}
export async function accessSession() {
  const identity = identityClient(),
    jar = await cookies();
  if (!identity) {
    const token = jar.get('api_session')?.value;
    return token ? { token, scope: token } : undefined;
  }
  const id = jar.get(identity.settings.sessionCookie)?.value;
  if (!id) return undefined;
  const token = await identity.token(id);
  if (!token) return undefined;
  // Drafts belong to the user, not the session: signing in again keeps them, and they never cross users.
  return { token, scope: 'sub:' + ((await identity.subject(id)) ?? id) };
}
