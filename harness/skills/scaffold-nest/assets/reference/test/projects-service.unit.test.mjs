import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectsService } from '../dist/projects/service.js';
const row = {
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Example',
  version: 2,
  created_at: new Date('2026-01-01T00:00:00Z'),
  owner_id: 'private-owner',
};
test('application operations scope identity and minimize output without HTTP', async () => {
  const calls = [];
  const service = new ProjectsService({
    query: async (sql, args) => {
      calls.push({ sql, args });
      return { rows: [row] };
    },
  });
  const created = await service.create('alice', 'Example');
  assert.deepEqual(Object.keys(created).sort(), ['createdAt', 'id', 'name', 'version']);
  assert.equal(created.createdAt, '2026-01-01T00:00:00.000Z');
  assert.deepEqual(calls[0].args.slice(1), ['alice', 'Example']);
  await service.list('bob', 25, 50);
  assert.match(calls[1].sql, /WHERE owner_id=\$1/);
  assert.deepEqual(calls[1].args, ['bob', 25, 50]);
  await service.read('alice', row.id);
  assert.match(calls[2].sql, /id=\$1 AND owner_id=\$2/);
  assert.deepEqual(calls[2].args, [row.id, 'alice']);
  const saved = await service.rename('alice', row.id, 'New', 1);
  assert.match(calls[3].sql, /owner_id=\$2 AND version=\$4/);
  assert.deepEqual(calls[3].args, [row.id, 'alice', 'New', 1]);
  assert.equal(saved.version, 2);
});
test('rename distinguishes an owned version conflict from an inaccessible record', async () => {
  for (const readable of [false, true]) {
    let count = 0;
    const service = new ProjectsService({ query: async () => ({ rows: ++count === 2 && readable ? [row] : [] }) });
    await assert.rejects(
      service.rename('bob', row.id, 'Changed', 1),
      (error) => error.getStatus() === (readable ? 409 : 404),
    );
    assert.equal(count, 2);
  }
});
