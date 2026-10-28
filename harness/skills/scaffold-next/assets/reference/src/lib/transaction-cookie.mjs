import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
// The pre-login OIDC transaction (PKCE verifier, state, nonce, return path) travels in the browser's transaction cookie,
// sealed with AES-256-GCM, so starting a sign-in stores nothing on the server. Every replica derives the same key from
// AUTH_TRANSACTION_SECRET. Rotating the secret makes cookies sealed with the old one fail: in-flight sign-ins restart.
export const TRANSACTION_SECONDS = 300;
const VERSION = 1,
  PREFIX = 'v1.',
  IV_BYTES = 12,
  TAG_BYTES = 16,
  MAX_COOKIE_CHARS = 3072,
  CLOCK_SKEW_MS = 30000;
const token = /^[A-Za-z0-9_-]{16,128}$/;
// reason is one of the fixed values 'invalid_transaction' or 'expired_transaction'; it never carries input.
export class TransactionError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'TransactionError';
    this.reason = reason;
  }
}
// secret: AUTH_TRANSACTION_SECRET (base64url, at least 32 bytes; validated at startup by scripts/runtime-config.mjs).
export function transactionKey(secret) {
  return Buffer.from(
    hkdfSync('sha256', Buffer.from(secret, 'base64url'), 'oidc-transaction-cookie', 'aes-256-gcm key v1', 32),
  );
}
// Associated data: a cookie sealed for one cookie name or app origin never opens under another.
const associated = (binding) => Buffer.from(binding.name + '\n' + binding.origin, 'utf8');
// Exported for tests that need a payload begin() never writes (another version, an old issue time).
export function sealPayload(key, binding, payload) {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(associated(binding));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  return PREFIX + Buffer.concat([iv, body, cipher.getAuthTag()]).toString('base64url');
}
export function sealTransaction(key, binding, transaction, now = Date.now()) {
  const { verifier, state, nonce, returnTo } = transaction;
  return sealPayload(key, binding, { v: VERSION, verifier, state, nonce, returnTo, iat: now });
}
export function openTransaction(key, binding, value, now = Date.now()) {
  const invalid = () => new TransactionError('invalid_transaction');
  if (typeof value !== 'string' || value.length > MAX_COOKIE_CHARS || !value.startsWith(PREFIX)) throw invalid();
  const encoded = value.slice(PREFIX.length);
  const raw = Buffer.from(encoded, 'base64url');
  // Only the canonical encoding is accepted, so one sealed value has exactly one cookie spelling.
  if (raw.length <= IV_BYTES + TAG_BYTES || raw.toString('base64url') !== encoded) throw invalid();
  let payload;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, IV_BYTES), { authTagLength: TAG_BYTES });
    decipher.setAAD(associated(binding));
    decipher.setAuthTag(raw.subarray(raw.length - TAG_BYTES));
    const plain = Buffer.concat([decipher.update(raw.subarray(IV_BYTES, raw.length - TAG_BYTES)), decipher.final()]);
    payload = JSON.parse(plain.toString('utf8'));
  } catch {
    throw invalid();
  }
  if (
    !payload ||
    typeof payload !== 'object' ||
    payload.v !== VERSION ||
    !token.test(payload.verifier) ||
    !token.test(payload.state) ||
    !token.test(payload.nonce) ||
    typeof payload.returnTo !== 'string' ||
    payload.returnTo.length > 512 ||
    !Number.isSafeInteger(payload.iat) ||
    payload.iat > now + CLOCK_SKEW_MS
  )
    throw invalid();
  // The lifetime comes from the sealed issue time, not only the cookie's Max-Age, which the browser controls.
  if (now - payload.iat > TRANSACTION_SECONDS * 1000) throw new TransactionError('expired_transaction');
  return {
    verifier: payload.verifier,
    state: payload.state,
    nonce: payload.nonce,
    returnTo: payload.returnTo,
    issuedAt: payload.iat,
  };
}
