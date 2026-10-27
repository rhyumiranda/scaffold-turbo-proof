import * as oidc from 'openid-client';
import { createClient } from '@redis/client';
import { createHash, randomBytes } from 'node:crypto';

// One rule set for startup validation (scripts/start.mjs) and runtime use.
export { identitySettings } from '../../scripts/runtime-config.mjs';
import { identitySettings } from '../../scripts/runtime-config.mjs';
import { homePath } from './feature-routes.mjs';
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
export class Identity {
  readonly settings: Settings;
  private redis: ReturnType<typeof createClient>;
  private connecting: Promise<unknown> | undefined;
  private configuration: Promise<oidc.Configuration> | undefined;
  constructor(settings: Settings) {
    this.settings = settings;
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
  async begin(returnTo = homePath) {
    await this.ensureReachable();
    const config = await this.config();
    const verifier = oidc.randomPKCECodeVerifier(),
      state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      id = opaque();
    await (
      await this.store()
    ).set(
      this.key('transaction', id),
      JSON.stringify({ verifier, state, nonce, returnTo: safeReturnTo(returnTo, this.settings.origin) }),
      { EX: 300 },
    );
    return {
      id,
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
  async complete(id: string, url: URL) {
    if (!validId(id) || url.origin !== this.settings.origin || url.pathname !== '/auth/callback')
      throw new Error('Invalid callback');
    const saved = await (await this.store()).getDel(this.key('transaction', id));
    if (!saved) throw new Error('Expired transaction');
    const transaction = JSON.parse(saved) as { verifier: string; state: string; nonce: string; returnTo?: string };
    const tokens = await oidc.authorizationCodeGrant(await this.config(), url, {
      pkceCodeVerifier: transaction.verifier,
      expectedState: transaction.state,
      expectedNonce: transaction.nonce,
      idTokenExpected: true,
    });
    const subject = tokens.claims()?.sub;
    if (!subject || !tokens.access_token || !tokens.expires_in || tokens.expires_in <= 0)
      throw new Error('Provider token contract incomplete');
    const session: Session = {
      accessToken: tokens.access_token,
      expires: Date.now() + tokens.expires_in * 1000,
      until: Date.now() + this.settings.ttl * 1000,
      subject,
      ...(tokens.refresh_token ? { refreshToken: tokens.refresh_token } : {}),
    };
    const sessionId = opaque();
    await (await this.store()).set(this.key('session', sessionId), JSON.stringify(session), { EX: this.settings.ttl });
    return { sessionId, returnTo: safeReturnTo(transaction.returnTo, this.settings.origin) };
  }
  // Cheap check used by the proxy before a private page starts streaming.
  async hasSession(id: string | undefined): Promise<boolean> {
    if (!id || !validId(id)) return false;
    const value = await (await this.store()).get(this.key('session', id));
    if (!value) return false;
    return (JSON.parse(value) as Session).until > Date.now();
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
    if (!value) return;
    const session = JSON.parse(value) as Session;
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
