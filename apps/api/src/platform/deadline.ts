import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  ServiceUnavailableException,
} from '@nestjs/common';
import { catchError, throwError, timeout, TimeoutError } from 'rxjs';
import type { Request, Response, NextFunction } from 'express';
import { logEvent } from './logging.js';
import { problem } from './problem.js';
export function requestDeadline(request: Request, response: Response, next: NextFunction) {
  response.locals.deadline = Date.now() + 6000;
  const timer = setTimeout(() => {
    if (response.writableEnded) return;
    const requestId = String(response.getHeader('x-request-id'));
    // An unfinished HTTP message is a client upload timeout; completed requests can time out on a dependency.
    const status = request.complete ? 503 : 408;
    logEvent('request.deadline', { requestId, status });
    response.once('finish', () => request.destroy());
    response.statusCode = status;
    if (status === 503) response.setHeader('retry-after', '5');
    response.setHeader('content-type', 'application/problem+json');
    response.end(JSON.stringify(problem(status, requestId, request.originalUrl.split('?')[0])));
  }, 6000);
  response.once('finish', () => clearTimeout(timer));
  response.once('close', () => clearTimeout(timer));
  next();
}
@Injectable()
export class DeadlineInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const response = context.switchToHttp().getResponse<Response>();
    const remaining = Number(response.locals.deadline) - Date.now();
    if (response.writableEnded || remaining <= 0) throw new ServiceUnavailableException('Request deadline exceeded');
    return next.handle().pipe(
      timeout(Math.min(5000, remaining)),
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof TimeoutError ? new ServiceUnavailableException('Request deadline exceeded') : error,
        ),
      ),
    );
  }
}
