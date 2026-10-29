import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectsService } from '../dist/projects/service.js';
import { ProjectsRepository } from '../dist/projects/repository.js';
const row = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Example',
  version: 2,
  createdAt: new Date('2026-01-01T00:00:00Z'),
};
// A Prisma client double that records every model call. Rows never carry owner_id back to callers.
function fakeDatabase(result = () => row) {
  const calls = [];
  const record = (operation) => async (args) => {
    calls.push({ operation, args });
    const value = result(operation, calls.length);
    if (operation === 'findMany') return value ? [value] : [];
    if (operation === 'updateManyAndReturn')
      return value ? [{ id: value.id, name: args.data.name, version: args.where.version + 1 }] : [];
    return value;
  };
  const project = Object.fromEntries(
    ['create', 'findMany', 'findFirst', 'updateManyAndReturn'].map((name) => [name, record(name)]),
  );
  return { calls, db: { client: { project } } };
}
test('application operations scope identity and minimize output without HTTP', async () => {
  const { calls, db } = fakeDatabase();
  const service = new ProjectsService(new ProjectsRepository(db));
  const created = await service.create('alice', 'Example');
  assert.deepEqual(Object.keys(created).sort(), ['createdAt', 'id', 'name', 'version']);
  assert.equal(created.createdAt, '2026-01-01T00:00:00.000Z');
  assert.equal(calls[0].operation, 'create');
  assert.equal(calls[0].args.data.ownerId, 'alice');
  assert.equal(calls[0].args.data.name, 'Example');
  assert.match(calls[0].args.data.id, /^[0-9a-f-]{36}$/);
  assert.deepEqual(calls[0].args.select, { id: true, name: true, version: true, createdAt: true });
  await service.list('bob', 25, 50);
  assert.deepEqual(calls[1].args.where, { ownerId: 'bob' });
  assert.deepEqual(calls[1].args.orderBy, [{ createdAt: 'desc' }, { id: 'desc' }]);
  assert.equal(calls[1].args.take, 25);
  assert.equal(calls[1].args.skip, 50);
  await service.read('alice', row.id);
  assert.deepEqual(calls[2].args.where, { id: row.id, ownerId: 'alice' });
  const saved = await service.rename('alice', row.id, 'New', 1);
  assert.deepEqual(calls[3].args.where, { id: row.id, ownerId: 'alice', version: 1 });
  assert.deepEqual(calls[3].args.data, { name: 'New', version: { increment: 1 } });
  assert.deepEqual(calls[3].args.select, { id: true, name: true, version: true });
  assert.deepEqual(Object.keys(saved).sort(), ['id', 'name', 'version']);
  assert.equal(saved.name, 'New');
  assert.equal(saved.version, 2);
  for (const call of calls) assert.ok(!('ownerId' in (call.args.select ?? {})), 'owner never selected');
});
test('rename distinguishes an owned version conflict from an inaccessible record', async () => {
  for (const readable of [false, true]) {
    const { calls, db } = fakeDatabase((operation) => (operation === 'findFirst' && readable ? row : null));
    const service = new ProjectsService(new ProjectsRepository(db));
    await assert.rejects(
      service.rename('bob', row.id, 'Changed', 1),
      (error) => error.getStatus() === (readable ? 409 : 404),
    );
    assert.deepEqual(
      calls.map((call) => call.operation),
      ['updateManyAndReturn', 'findFirst'],
    );
  }
});

test('rename rethrows database failures other than a missing conditional row', async () => {
  const failure = Object.assign(new Error('connection failed'), { code: 'P1001' });
  const { db } = fakeDatabase((operation) => {
    if (operation === 'updateManyAndReturn') throw failure;
    return row;
  });
  const service = new ProjectsService(new ProjectsRepository(db));
  await assert.rejects(service.rename('alice', row.id, 'Changed', 1), (error) => error === failure);
});
