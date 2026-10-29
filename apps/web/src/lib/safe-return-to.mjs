import { homePath } from './feature-routes.mjs';

// Where to land after sign-in: only a same-origin path, never another host, scheme or protocol-relative URL.
export function safeReturnTo(value, origin) {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\') || value.length > 512)
    return homePath;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin || url.pathname.startsWith('/auth/')) return homePath;
    return url.pathname + url.search;
  } catch {
    return homePath;
  }
}
