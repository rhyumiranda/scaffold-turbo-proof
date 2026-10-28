import { Injectable, OnApplicationShutdown, ServiceUnavailableException } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { trace, SpanStatusCode, metrics } from '@opentelemetry/api';
import { PrismaClient } from '../generated/prisma/client.js';
import { Config } from './config.js';
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
  // Prisma's codes for an unreachable server, a connection timeout, an operation timeout and a closed connection.
  'P1001',
  'P1002',
  'P1008',
  'P1017',
]);
// Kinds the Prisma pg driver adapter assigns to connection-level failures.
const transientKinds = new Set(['DatabaseNotReachable', 'ConnectionClosed', 'SocketTimeout', 'TooManyConnections']);
const transientMessages =
  /timeout exceeded when trying to connect|Connection terminated|Query read timeout|Client has encountered a connection error/;
// Prisma wraps the driver's error (error.cause, error.meta.driverAdapterError and its cause), so the whole chain is
// searched. Bounded, so a cyclic or very deep object cannot hang the request.
function errorChain(error: unknown): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();
  while (queue.length && found.length < 16) {
    const item = queue.shift();
    if (typeof item !== 'object' || item === null || seen.has(item)) continue;
    seen.add(item);
    const record = item as Record<string, unknown>;
    found.push(record);
    const meta = record['meta'];
    queue.push(
      record['cause'],
      meta,
      typeof meta === 'object' && meta ? (meta as Record<string, unknown>)['driverAdapterError'] : undefined,
    );
  }
  return found;
}
export function isTransientDatabaseError(error: unknown): boolean {
  return errorChain(error).some((item) => {
    for (const key of ['code', 'originalCode']) if (transientCodes.has(String(item[key] ?? ''))) return true;
    if (transientKinds.has(String(item['kind'] ?? ''))) return true;
    const message = item['message'] ?? item['originalMessage'];
    return typeof message === 'string' && transientMessages.test(message);
  });
}
// The PostgreSQL SQLSTATE (or socket code) behind a Prisma error, for value-free log fields.
export function databaseErrorCode(error: unknown): string | undefined {
  for (const item of errorChain(error))
    for (const key of ['originalCode', 'code']) {
      const code = item[key];
      if (typeof code === 'string' && /^(?:[0-9A-Z]{5}|E[A-Z]+)$/.test(code) && !/^P\d{4}$/.test(code)) return code;
    }
  return undefined;
}
function createClient(pool: pg.Pool, schema: string | undefined) {
  const tracer = trace.getTracer('scaffold-api');
  // Prisma uses this pool: its size, connection timeout and statement/query timeouts are the budget.
  const adapter = new PrismaPg(pool, schema ? { schema } : undefined);
  return new PrismaClient({ adapter }).$extends({
    query: {
      // One span per database operation (model operations and raw queries), and the 503 mapping.
      async $allOperations({ model, operation, args, query }) {
        return tracer.startActiveSpan('postgres.query', async (span) => {
          span.setAttribute('db.system.name', 'postgresql');
          span.setAttribute('db.operation.name', operation);
          if (model) span.setAttribute('db.collection.name', model);
          try {
            return await query(args);
          } catch (error) {
            const transient = isTransientDatabaseError(error);
            const code = databaseErrorCode(error);
            const classified = classifyError(code ? { code } : error);
            const errorType = transient && classified === 'APPLICATION_ERROR' ? 'DATABASE_TIMEOUT' : classified;
            span.setAttribute('error.type', errorType);
            span.setStatus({ code: SpanStatusCode.ERROR });
            logEvent('database.query_failure', { errorType });
            if (transient) throw new ServiceUnavailableException('Database unavailable', { cause: error });
            throw error;
          } finally {
            span.end();
          }
        });
      },
    },
  });
}
export type DatabaseClient = ReturnType<typeof createClient>;
// Only the platform builds the client. Each feature module reaches its own models through `client`
// (check:arch enforces that a module touches only the models in its prisma/schema/<module>/ folder).
@Injectable()
export class Database implements OnApplicationShutdown {
  readonly pool: pg.Pool;
  readonly client: DatabaseClient;
  constructor(config: Config) {
    const url = new URL(config.databaseUrl);
    // Prisma CLI reads `?schema=`; node-postgres does not, so the adapter receives it explicitly.
    const schema = url.searchParams.get('schema') ?? undefined;
    url.searchParams.delete('schema');
    this.pool = new pg.Pool({
      connectionString: url.href,
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
    this.client = createClient(this.pool, schema);
  }
  // Readiness: one round trip through the same client, pool and budget as real requests.
  async ping() {
    await this.client.$queryRaw`SELECT 1`;
  }
  async onApplicationShutdown() {
    await this.client.$disconnect();
    await this.pool.end();
  }
}
