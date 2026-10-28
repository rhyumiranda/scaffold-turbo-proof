import * as oidc from 'openid-client';
import { createClient } from '@redis/client';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

// One rule set for startup validation (scripts/start.mjs) and runtime use.
export { identitySettings } from '../../scripts/runtime-config.mjs';
import { identitySettings } from '../../scripts/runtime-config.mjs';
import { homePath } from './feature-routes.mjs';
import { openTransaction, sealTransaction, transactionKey, TransactionError } from './transaction-cookie.mjs';
type Settings = NonNullable<ReturnType<typeof identitySettings>>;
type Session = { accessToken: string; refreshToken?: string; expires: number; until: number; subject: string };
const opaque = () => randomBytes(32).toString('base64url');
// Where to land after sign-in: only a same-origin path, never another host, scheme or protocol-relative URL.
export function safeReturnTo(value: string | null | undefined, origin: string): string {
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
const validId = (id: string) => /^[a-zA-Z0-9_-]{43}$/.test(id);
const same = (a: string, b: string) => {
  const left = Buffer.from(a),
    right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
// Why a sign-in was refused or could not start. Every field is a fixed code or a validated provider error code: never a
// token, authorization code, cookie, secret, verifier, state, nonce or URL, so the record is safe to log as is.
export type SignInReason =
  | 'invalid_callback'
  | 'missing_transaction'
  | 'invalid_transaction'
  | 'expired_transaction'
  | 'provider_error'
  | 'state_mismatch'
  | 'provider_unavailable'
  | 'token_exchange_failed'
  | 'token_contract_incomplete'
  | 'session_store_unavailable';
const code = (value: unknown, pattern: RegExp) =>
  typeof value === 'string' && pattern.test(value) ? value : undefined;
export class SignInError extends Error {
  readonly reason: SignInReason;
  readonly providerError?: string;
  readonly errorCode?: string;
  constructor(reason: SignInReason, cause?: unknown, providerError?: unknown) {
    super(reason);
    this.name = 'SignInError';
    this.reason = reason;
    // OAuth error codes are short ASCII words (RFC 6749 section 4.1.2.1); anything else is reported as unrecognized.
    if (providerError !== undefined && providerError !== null)
      this.providerError = code(providerError, /^[A-Za-z0-9_.-]{1,64}$/) ?? 'unrecognized';
    if (cause && typeof cause === 'object') {
      const { code: errorCode, name } = cause as { code?: unknown; name?: unknown };
      const safe = code(errorCode, /^[A-Z][A-Z0-9_]{1,63}$/) ?? code(name, /^[A-Za-z]{1,40}$/);
      if (safe) this.errorCode = safe;
    }
  }
}
export function signInRecord(
  event: 'identity.callback.rejected' | 'identity.login.unavailable',
  error: unknown,
  requestId?: string | null,
) {
  const failure =
    error instanceof SignInError
      ? error
      : new SignInError(event === 'identity.login.unavailable' ? 'provider_unavailable' : 'invalid_callback', error);
  return {
    time: new Date().toISOString(),
    level: event === 'identity.login.unavailable' ? 'error' : 'warn',
    service: 'web',
    event,
    requestId: requestId && /^[0-9a-f-]{36}$/.test(requestId) ? requestId : undefined,
    reason: failure.reason,
    ...(failure.providerError ? { providerError: failure.providerError } : {}),
    ...(failure.errorCode ? { errorCode: failure.errorCode } : {}),
  };
}
export class Identity {
  readonly settings: Settings;
  private redis: ReturnType<typeof createClient>;
  private connecting: Promise<unknown> | undefined;
  private configuration: Promise<oidc.Configuration> | undefined;
  private readonly sealKey: Buffer;
  constructor(settings: Settings) {
    this.settings = settings;
    this.sealKey = transactionKey(settings.transactionSecret);
    this.redis = createClient({
      url: settings.redis,
      socket: { connectTimeout: 1000, reconnectStrategy: false },
      disableOfflineQueue: true,
    });
    this.redis.on('error', () => {});
  }
  private async store() {
    if (!this.redis.isOpen) {
      this.connecting ??= this.redis.connect().finally(() => {
        this.connecting = undefined;
      });
      await this.connecting;
    }
    if (this.connecting) await this.connecting;
    return this.redis.withCommandOptions({ abortSignal: AbortSignal.timeout(1500) });
  }
  // Each sign-in in progress has its own cookie, named after a hash of its state: the callback reads the cookie for the
  // state it carries, so two tabs (or a double click) never overwrite each other's transaction.
  transactionCookieName(state: string) {
    return this.settings.transactionCookiePrefix + createHash('sha256').update(state).digest('hex').slice(0, 16);
  }
  private binding(name: string) {
    return { name, origin: this.settings.origin };
  }
  // Transaction cookies to clear before a new sign-in starts: unreadable or expired ones, and the oldest beyond four
  // so that, with the new one, a browser never holds more than five. cookies maps cookie name to value.
  staleTransactions(cookies: Record<string, string>, now = Date.now()) {
    const live: { name: string; issuedAt: number }[] = [],
      stale: string[] = [];
    for (const [name, value] of Object.entries(cookies)) {
      if (!name.startsWith(this.settings.transactionCookiePrefix)) continue;
      try {
        live.push({ name, issuedAt: openTransaction(this.sealKey, this.binding(name), value, now).issuedAt });
      } catch {
        stale.push(name);
      }
    }
    live.sort((a, b) => b.issuedAt - a.issuedAt);
    return [...stale, ...live.slice(4).map((entry) => entry.name)];
  }
  private key(kind: string, id: string) {
    return this.settings.namespace + ':' + kind + ':' + createHash('sha256').update(id).digest('hex');
  }
  private config() {
    this.configuration ??= oidc
      .discovery(this.settings.issuer, this.settings.clientId, this.settings.clientSecret, undefined, {
        timeout: 3,
        execute: [oidc.enableNonRepudiationChecks, ...(this.settings.insecure ? [oidc.allowInsecureRequests] : [])],
      })
      .catch((error) => {
        this.configuration = undefined;
        throw error;
      });
    return this.configuration;
  }
  private reachableUntil = 0;
  // Discovery is cached, so re-run it (at most every 5 s) before sending the browser to the provider. If the
  // provider is down, login fails here with our recovery page instead of the browser's connection-error page.
  private async ensureReachable() {
    if (Date.now() < this.reachableUntil) return;
    this.configuration = undefined;
    await this.config();
    this.reachableUntil = Date.now() + 5000;
  }
  // Starts a sign-in without writing server state: the transaction is returned sealed, for the transaction cookie.
  async begin(returnTo = homePath) {
    let config: oidc.Configuration;
    try {
      await this.ensureReachable();
      config = await this.config();
    } catch (error) {
      throw new SignInError('provider_unavailable', error);
    }
    const verifier = oidc.randomPKCECodeVerifier(),
      state = oidc.randomState(),
      nonce = oidc.randomNonce();
    const name = this.transactionCookieName(state);
    const cookie = sealTransaction(this.sealKey, this.binding(name), {
      verifier,
      state,
      nonce,
      returnTo: safeReturnTo(returnTo, this.settings.origin),
    });
    return {
      name,
      cookie,
      url: oidc.buildAuthorizationUrl(config, {
        redirect_uri: this.settings.origin + '/auth/callback',
        scope: this.settings.scope,
        state,
        nonce,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
      }).href,
    };
  }
  // Every refusal is a SignInError with a fixed reason. cookies maps the request's cookie names to values.
  async complete(cookies: Record<string, string>, url: URL) {
    if (url.origin !== this.settings.origin || url.pathname !== '/auth/callback')
      throw new SignInError('invalid_callback');
    if (url.searchParams.has('error'))
      throw new SignInError('provider_error', undefined, url.searchParams.get('error'));
    const state = url.searchParams.get('state') ?? '';
    const name = this.transactionCookieName(state),
      cookie = Object.hasOwn(cookies, name) ? cookies[name] : undefined;
    // No cookie for this state: a sign-in for another state in progress means the state does not match.
    if (!cookie)
      throw new SignInError(
        Object.keys(cookies).some((other) => other.startsWith(this.settings.transactionCookiePrefix))
          ? 'state_mismatch'
          : 'missing_transaction',
      );
    let transaction;
    try {
      transaction = openTransaction(this.sealKey, this.binding(name), cookie);
    } catch (error) {
      throw new SignInError(error instanceof TransactionError ? error.reason : 'invalid_transaction');
    }
    // The cookie name already follows from the state; compare the sealed value too. The library checks it again below.
    if (!same(state, transaction.state)) throw new SignInError('state_mismatch');
    let config: oidc.Configuration;
    try {
      config = await this.config();
    } catch (error) {
      throw new SignInError('provider_unavailable', error);
    }
    let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
    try {
      tokens = await oidc.authorizationCodeGrant(config, url, {
        pkceCodeVerifier: transaction.verifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      });
    } catch (error) {
      if (error instanceof oidc.AuthorizationResponseError) throw new SignInError('provider_error', error, error.error);
      if (error instanceof oidc.ResponseBodyError) throw new SignInError('token_exchange_failed', error, error.error);
      throw new SignInError('token_exchange_failed', error);
    }
    const subject = tokens.claims()?.sub;
    if (!subject || !tokens.access_token || !tokens.expires_in || tokens.expires_in <= 0)
      throw new SignInError('token_contract_incomplete');
    const session: Session = {
      accessToken: tokens.access_token,
      expires: Date.now() + tokens.expires_in * 1000,
      until: Date.now() + this.settings.ttl * 1000,
      subject,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    };
    const sessionId = opaque();
    try {
      await (
        await this.store()
      ).set(this.key('session', sessionId), JSON.stringify(session), { EX: this.settings.ttl });
    } catch (error) {
      throw new SignInError('session_store_unavailable', error);
    }
    return { sessionId, subject, returnTo: safeReturnTo(transaction.returnTo, this.settings.origin) };
  }
  // Cheap check used by the proxy before a private page starts streaming.
  async hasSession(id: string | undefined): Promise<boolean> {
    if (!id || !validId(id)) return false;
    const value = await (await this.store()).get(this.key('session', id));
    if (!value) return false;
    return (JSON.parse(value) as Session).until > Date.now();
  }
  // The signed-in user's subject, without refreshing tokens; undefined when the session does not exist.
  async subject(id: string): Promise<string | undefined> {
    if (!validId(id)) return undefined;
    const value = await (await this.store()).get(this.key('session', id));
    return value ? (JSON.parse(value) as Session).subject : undefined;
  }
  async token(id: string): Promise<string | undefined> {
    if (!validId(id)) return undefined;
    const store = await this.store(),
      key = this.key('session', id);
    const value = await store.get(key);
    if (!value) return undefined;
    const session = JSON.parse(value) as Session;
    if (session.until <= Date.now()) {
      await store.del(key);
      return undefined;
    }
    if (session.expires > Date.now() + 30000) return session.accessToken;
    if (!session.refreshToken) return session.expires > Date.now() ? session.accessToken : undefined;
    const lockKey = this.key('refresh', id),
      lock = opaque();
    if (!(await store.set(lockKey, lock, { NX: true, PX: 10000 }))) {
      // Never reuse a rotating refresh token. Read the winner's persisted session.
      for (let attempt = 0; attempt < 35; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        const current = await (await this.store()).get(key);
        if (!current) return undefined;
        if (current !== value) {
          const updated = JSON.parse(current) as Session;
          return updated.expires > Date.now() && updated.until > Date.now() ? updated.accessToken : undefined;
        }
      }
      throw new Error('Session refresh busy');
    }
    try {
      // Logout may have removed the record while this request waited for the lock.
      if ((await store.get(key)) !== value) return this.token(id);
      const tokens = await oidc.refreshTokenGrant(await this.config(), session.refreshToken);
      if (
        !tokens.access_token ||
        !tokens.expires_in ||
        tokens.expires_in <= 0 ||
        (tokens.claims() && tokens.claims()!.sub !== session.subject)
      )
        throw new Error('Invalid refresh');
      const updated = {
        ...session,
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? session.refreshToken,
        expires: Date.now() + tokens.expires_in * 1000,
      };
      const remaining = Math.floor((session.until - Date.now()) / 1000);
      if (remaining <= 0) return undefined;
      // Compare-and-set prevents an in-flight refresh resurrecting a logged-out session.
      const changed = await store.eval(
        "if redis.call('GET',KEYS[1])==ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]);return 1 end return 0",
        { keys: [key], arguments: [value, JSON.stringify(updated), String(remaining)] },
      );
      return changed === 1 ? updated.accessToken : undefined;
    } catch {
      await (await this.store()).del(key);
      return undefined;
    } finally {
      await (
        await this.store()
      ).eval("if redis.call('GET',KEYS[1])==ARGV[1] then return redis.call('DEL',KEYS[1]) end return 0", {
        keys: [lockKey],
        arguments: [lock],
      });
    }
  }
  async logout(id: string) {
    if (!validId(id)) return;
    const value = await (await this.store()).getDel(this.key('session', id));
    if (value) await this.revoke(JSON.parse(value) as Session);
  }
  // Signing in again in the same browser replaces its previous session. The old record is deleted at once. Its provider
  // tokens are revoked only when it belonged to another account: for the same account they share the provider's
  // single sign-on session, and revoking them would end that session and break the new session's first refresh.
  async replace(id: string, subject: string) {
    if (!validId(id)) return;
    const value = await (await this.store()).getDel(this.key('session', id));
    if (!value) return;
    const session = JSON.parse(value) as Session;
    if (session.subject !== subject) await this.revoke(session);
  }
  private async revoke(session: Session) {
    try {
      const config = await this.config();
      if (config.serverMetadata().revocation_endpoint)
        await oidc.tokenRevocation(config, session.refreshToken ?? session.accessToken);
    } catch {
      /* Local session is already revoked. Provider outage cannot restore it. */
    }
  }
  close() {
    if (this.redis.isOpen) this.redis.destroy();
  }
}
