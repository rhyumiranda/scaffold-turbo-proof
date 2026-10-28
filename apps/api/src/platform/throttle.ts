import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { createHash } from 'node:crypto';
// Runs after AuthGuard, so quotas follow the verified user rather than a shared client IP (one office NAT must not
// throttle everyone behind it). Public routes without an identity fall back to the client IP. The subject is hashed so
// the limiter store never holds raw identities.
@Injectable()
export class IdentityThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(request: Record<string, unknown>): Promise<string> {
    const subject = (request.identity as { subject?: string } | undefined)?.subject;
    if (subject) return 'sub:' + createHash('sha256').update(subject).digest('hex').slice(0, 32);
    return 'ip:' + String(request.ip ?? 'unknown');
  }
}
