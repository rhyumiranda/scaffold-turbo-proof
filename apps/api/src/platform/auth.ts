import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Request } from 'express';
import { Config } from './config.js';
export interface IdentityRequest extends Request {
  identity: { subject: string };
  authFailure?: string;
}
export const Public = () => SetMetadata('publicEndpoint', true);
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly keys: ReturnType<typeof createRemoteJWKSet>;
  constructor(
    private readonly config: Config,
    private readonly reflector: Reflector,
  ) {
    this.keys = createRemoteJWKSet(config.jwksUrl, {
      timeoutDuration: 2000,
      cooldownDuration: config.jwksCooldownMs,
      cacheMaxAge: config.jwksCacheMs,
    });
  }
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>('publicEndpoint', [context.getHandler(), context.getClass()]))
      return true;
    // Records the outcome instead of rejecting, so the rate limiter can count failed attempts per IP first.
    // RequireIdentityGuard rejects afterwards. Guard order is fixed in app.ts.
    const request = context.switchToHttp().getRequest<IdentityRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      request.authFailure = 'Sign in required';
      return true;
    }
    try {
      const { payload } = await jwtVerify(header.slice(7), this.keys, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      if (!payload.sub || payload.sub.length > 200) throw new Error('Invalid subject');
      request.identity = { subject: payload.sub };
      return true;
    } catch {
      request.authFailure = 'Invalid or expired session';
      return true;
    }
  }
}
@Injectable()
export class RequireIdentityGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    if (this.reflector.getAllAndOverride<boolean>('publicEndpoint', [context.getHandler(), context.getClass()]))
      return true;
    const request = context.switchToHttp().getRequest<IdentityRequest>();
    if (!request.identity) throw new UnauthorizedException(request.authFailure ?? 'Sign in required');
    return true;
  }
}
