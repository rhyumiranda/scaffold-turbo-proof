import { Injectable, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { Pool, type QueryResultRow } from 'pg';
import { Config } from './config.js';
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import { logEvent, classifyError } from './logging.js';
// The database is unavailable or too slow, not the request wrong: answer 503 + Retry-After instead of 500.
const transientCodes = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENOTFOUND',
  'EPIPE',
  '57P01',
  '57P02',
  '57P03',
  '57014',
  '53300',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
]);
const transientMessages =
  /timeout exceeded when trying to connect|Connection terminated|Query read timeout|Client has encountered a connection error/;
export function isTransientDatabaseError(error: unknown): boolean {
  const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  return transientCodes.has(code) || (error instanceof Error && transientMessages.test(error.message));
}
@Injectable()
export class Database implements OnApplicationShutdown {
  readonly pool: Pool;
  constructor(config: Config) {
    this.pool = new Pool({
      connectionString: config.databaseUrl,
      max: 5,
      connectionTimeoutMillis: 2000,
      idleTimeoutMillis: 10000,
      statement_timeout: 3000,
      query_timeout: 4000,
      application_name: 'nest-reference',
    });
    this.pool.on('error', (error) => {
      logEvent('database.connection_failure', { errorType: classifyError(error) });
    });
    const meter = metrics.getMeter('scaffold-api');
    meter
      .createObservableGauge('db.pool.active')
      .addCallback((result) => result.observe(this.pool.totalCount - this.pool.idleCount));
    meter.createObservableGauge('db.pool.waiting').addCallback((result) => result.observe(this.pool.waitingCount));
  }
  async query<T extends QueryResultRow = QueryResultRow>(sql: string, values?: unknown[]) {
    return trace.getTracer('scaffold-api').startActiveSpan('postgres.query', async (span) => {
      try {
        return await this.pool.query<T>(sql, values);
      } catch (error) {
        const transient = isTransientDatabaseError(error);
        const errorType =
          transient && classifyError(error) === 'APPLICATION_ERROR' ? 'DATABASE_TIMEOUT' : classifyError(error);
        span.setAttribute('error.type', errorType);
        span.setStatus({ code: SpanStatusCode.ERROR });
        logEvent('database.query_failure', { errorType });
        if (transient) throw new ServiceUnavailableException('Database unavailable', { cause: error });
        throw error;
      } finally {
        span.end();
      }
    });
  }
  async onApplicationShutdown() {
    await this.pool.end();
  }
}
