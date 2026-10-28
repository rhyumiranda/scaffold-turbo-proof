import { Injectable } from '@nestjs/common';
import { isIP } from 'node:net';
import { ConfigurationError, parseUrl } from './configuration-error.js';
function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new ConfigurationError(name, 'missing');
  return value;
}
@Injectable()
export class Config {
  readonly databaseUrl = required('DATABASE_URL');
  readonly issuer = required('AUTH_ISSUER');
  readonly audience = required('AUTH_AUDIENCE');
  readonly jwksUrl = parseUrl('AUTH_JWKS_URL', process.env.AUTH_JWKS_URL);
  readonly port = Number(process.env.PORT ?? '4100');
  readonly webOrigin = process.env.WEB_ORIGIN;
  readonly shutdownMs = Number(process.env.SHUTDOWN_TIMEOUT_MS ?? '8000');
  readonly maxInFlight = Number(process.env.MAX_IN_FLIGHT ?? '100');
  readonly rateLimit = Number(process.env.RATE_LIMIT ?? '100');
  readonly rateWindowMs = Number(process.env.RATE_WINDOW_MS ?? '60000');
  readonly limiterMode = process.env.LIMITER_MODE ?? 'memory';
  readonly redisUrl = process.env.LIMITER_REDIS_URL;
  readonly limiterNamespace = process.env.LIMITER_NAMESPACE ?? 'api';
  readonly jwksCooldownMs = Number(process.env.AUTH_JWKS_COOLDOWN_MS ?? '30000');
  readonly jwksCacheMs = Number(process.env.AUTH_JWKS_CACHE_MS ?? '600000');
  readonly trustedProxies = process.env.TRUST_PROXY_CIDRS?.split(',').map((value) => value.trim()) ?? [];
  constructor() {
    const database = parseUrl('DATABASE_URL', this.databaseUrl);
    if (!['postgres:', 'postgresql:'].includes(database.protocol))
      throw new ConfigurationError('DATABASE_URL', 'must use postgres: or postgresql:');
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535)
      throw new ConfigurationError('PORT', 'must be an integer from 1 to 65535');
    if (!Number.isInteger(this.shutdownMs) || this.shutdownMs < 100 || this.shutdownMs > 30000)
      throw new ConfigurationError('SHUTDOWN_TIMEOUT_MS', 'must be an integer from 100 to 30000');
    for (const [name, value, max] of [
      ['MAX_IN_FLIGHT', this.maxInFlight, 10000],
      ['RATE_LIMIT', this.rateLimit, 100000],
      ['RATE_WINDOW_MS', this.rateWindowMs, 3600000],
      ['AUTH_JWKS_COOLDOWN_MS', this.jwksCooldownMs, 600000],
      ['AUTH_JWKS_CACHE_MS', this.jwksCacheMs, 3600000],
    ] as const)
      if (!Number.isInteger(value) || value < 1 || value > max)
        throw new ConfigurationError(name, `must be an integer from 1 to ${max}`);
    if (!['memory', 'redis'].includes(this.limiterMode))
      throw new ConfigurationError('LIMITER_MODE', 'must be memory or redis');
    if (
      this.trustedProxies.some((value) => {
        const [ip, prefix] = value.split('/');
        const version = isIP(ip ?? '');
        return (
          !version || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) > (version === 4 ? 32 : 128)))
        );
      })
    )
      throw new ConfigurationError('TRUST_PROXY_CIDRS', 'must list explicit IPs or CIDRs');
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(this.limiterNamespace))
      throw new ConfigurationError('LIMITER_NAMESPACE', 'must be 1-64 letters, digits, _ or -');
    if (this.limiterMode === 'redis') {
      const url = parseUrl('LIMITER_REDIS_URL', this.redisUrl);
      if (
        url.protocol !== 'rediss:' &&
        !(url.protocol === 'redis:' && ['127.0.0.1', 'localhost'].includes(url.hostname))
      )
        throw new ConfigurationError('LIMITER_REDIS_URL', 'must use rediss: except on loopback');
    }
    const issuer = parseUrl('AUTH_ISSUER', this.issuer);
    for (const [name, url] of [
      ['AUTH_ISSUER', issuer],
      ['AUTH_JWKS_URL', this.jwksUrl],
    ] as const) {
      const localTest = process.env.NODE_ENV === 'test' && ['127.0.0.1', 'localhost'].includes(url.hostname);
      if (url.protocol !== 'https:' && !localTest) throw new ConfigurationError(name, 'must use https:');
    }
    if (this.webOrigin && parseUrl('WEB_ORIGIN', this.webOrigin).origin !== this.webOrigin)
      throw new ConfigurationError('WEB_ORIGIN', 'must be an origin without a path');
  }
}
