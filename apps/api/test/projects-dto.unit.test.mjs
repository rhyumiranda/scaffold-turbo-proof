import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationPipe } from '@nestjs/common';
import { CreateProject, RenameProject } from '../dist/projects/dto.js';
import { assertResponse, spec } from './schema.mjs';
test('pagination and version schemas match integer runtime validation', () => {
  for (const parameter of spec.paths['/v1/projects'].get.parameters) assert.equal(parameter.schema.type, 'integer');
  assert.equal(spec.components.schemas.RenameProject.properties.expectedVersion.type, 'integer');
  assertResponse('/v1/projects', 'get', 200, []);
  assert.throws(() => assertResponse('/v1/projects', 'get', 200, [{ id: 'bad' }]));
});
test('expected version fits PostgreSQL integer before application work', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const expectedVersion of [0, -1, 1.5, 2147483648, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(
      pipe.transform({ name: 'Valid', expectedVersion }, { type: 'body', metatype: RenameProject }),
      (error) => error.getStatus() === 400,
    );
  }
  const accepted = await pipe.transform(
    { name: 'Valid', expectedVersion: 2147483647 },
    { type: 'body', metatype: RenameProject },
  );
  assert.equal(accepted.expectedVersion, 2147483647);
});
test('create and rename reject NUL before application/database work and preserve Unicode', async () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  for (const metatype of [CreateProject, RenameProject]) {
    const extra = metatype === RenameProject ? { expectedVersion: 1 } : {};
    await assert.rejects(
      pipe.transform({ name: 'a\u0000b', ...extra }, { type: 'body', metatype }),
      (error) =>
        error.getStatus() === 400 && error.getResponse().message.some((message) => message.includes('null character')),
    );
    const result = await pipe.transform({ name: ' 😀漢字é ', ...extra }, { type: 'body', metatype });
    assert.equal(result.name, '😀漢字é');
  }
});
