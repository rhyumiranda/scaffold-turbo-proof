import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTransientDatabaseError, databaseErrorCode } from '../dist/platform/database.js';
test('database outages and timeouts are transient (503); integrity errors are not', () => {
  for (const code of ['ECONNREFUSED', 'ECONNRESET', '57P01', '57014', '53300', '08006'])
    assert.equal(isTransientDatabaseError(Object.assign(new Error('x'), { code })), true, code);
  assert.equal(isTransientDatabaseError(new Error('timeout exceeded when trying to connect')), true);
  assert.equal(isTransientDatabaseError(new Error('Connection terminated unexpectedly')), true);
  for (const code of ['23505', '23514', '23502', '22P02', '42P01'])
    assert.equal(isTransientDatabaseError(Object.assign(new Error('x'), { code })), false, code);
  assert.equal(isTransientDatabaseError(new Error('application bug')), false);
});
// Prisma wraps driver failures: a Prisma error carries the driver adapter error in meta.driverAdapterError,
// whose cause holds the PostgreSQL SQLSTATE (originalCode) or a connection-level kind.
const adapterError = (cause) => Object.assign(new Error('driver'), { name: 'DriverAdapterError', cause });
const prismaError = (code, cause) =>
  Object.assign(new Error('prisma'), { code, meta: { modelName: 'Project', driverAdapterError: adapterError(cause) } });
test('wrapped Prisma driver errors keep the transient (503) classification', () => {
  const statementTimeout = { kind: 'postgres', code: '57014', originalCode: '57014', severity: 'ERROR', message: 'x' };
  assert.equal(isTransientDatabaseError(prismaError('P2010', statementTimeout)), true);
  assert.equal(databaseErrorCode(prismaError('P2010', statementTimeout)), '57014');
  for (const kind of ['DatabaseNotReachable', 'ConnectionClosed', 'SocketTimeout', 'TooManyConnections'])
    assert.equal(isTransientDatabaseError(adapterError({ kind })), true, kind);
  for (const code of ['P1001', 'P1002', 'P1008', 'P1017'])
    assert.equal(isTransientDatabaseError(Object.assign(new Error('x'), { code })), true, code);
  assert.equal(
    isTransientDatabaseError(Object.assign(new Error('wrapped'), { cause: new Error('Query read timeout') })),
    true,
  );
  const unique = { kind: 'UniqueConstraintViolation', originalCode: '23505', constraint: { fields: ['id'] } };
  assert.equal(isTransientDatabaseError(prismaError('P2002', unique)), false);
  assert.equal(databaseErrorCode(prismaError('P2002', unique)), '23505');
  const check = { kind: 'postgres', code: '23514', originalCode: '23514', severity: 'ERROR', message: 'x' };
  assert.equal(isTransientDatabaseError(prismaError('P2010', check)), false);
  // A self-referencing error object cannot hang classification.
  const cyclic = new Error('loop');
  cyclic.cause = cyclic;
  assert.equal(isTransientDatabaseError(cyclic), false);
});
