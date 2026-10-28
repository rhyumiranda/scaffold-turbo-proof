import type { NextFunction, Request, Response } from 'express';
import { metrics } from '@opentelemetry/api';
import { problem } from './problem.js';

export function capacityLimit(maximum: number) {
  let active = 0;
  const rejected = metrics.getMeter('scaffold-api').createCounter('http.server.overloaded');
  return (request: Request, response: Response, next: NextFunction) => {
    if (request.method === 'GET' && request.path === '/health/live') return next();
    if (active >= maximum) {
      rejected.add(1);
      response.setHeader('retry-after', '1');
      response
        .status(503)
        .type('application/problem+json')
        .json(problem(503, String(response.getHeader('x-request-id')), request.originalUrl.split('?')[0]));
      return;
    }
    active++;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        active--;
      }
    };
    response.once('finish', release);
    response.once('close', release);
    next();
  };
}
