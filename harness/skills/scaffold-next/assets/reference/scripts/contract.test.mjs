import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareContracts } from './check-contract.mjs';
const base = {
  openapi: '3.0.0',
  paths: {
    '/projects': {
      get: {
        responses: { 200: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Project' } } } } },
      },
    },
  },
  components: {
    schemas: { Project: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } } },
  },
};
test('compatibility rejects response narrowing/removal and auth changes behind refs', () => {
  const changed = structuredClone(base);
  changed.components.schemas.Project.properties.name = { type: 'number' };
  assert.ok(compareContracts(base, changed).length);
  const removed = structuredClone(base);
  delete removed.paths['/projects'];
  assert.ok(compareContracts(base, removed).length);
  const secured = structuredClone(base);
  secured.security = [{ bearer: [] }];
  assert.ok(compareContracts(base, secured).length);
  const authBefore = structuredClone(base);
  authBefore.components.securitySchemes = { bearer: { type: 'http', scheme: 'bearer' } };
  const authAfter = structuredClone(authBefore);
  authAfter.components.securitySchemes.bearer = { type: 'apiKey', in: 'header', name: 'x-key' };
  assert.ok(compareContracts(authBefore, authAfter).length);
});
test('compatibility permits new operations and ignores cosmetic descriptions', () => {
  const changed = structuredClone(base);
  changed.paths['/new'] = { get: { responses: { 200: { description: 'ok' } } } };
  changed.components.schemas.Project.description = 'Explained';
  assert.deepEqual(compareContracts(base, changed), []);
});
test('compatibility compares properties named like documentation keywords instead of stripping them', () => {
  for (const name of [
    'title',
    'description',
    'summary',
    'tags',
    'example',
    'examples',
    'operationId',
    'externalDocs',
  ]) {
    const withField = structuredClone(base);
    withField.components.schemas.Project.properties[name] = { type: 'string' };
    withField.components.schemas.Project.required = ['name', name];
    assert.ok(
      compareContracts(withField, base).some((e) => e.includes(`property "${name}" removed`)),
      name,
    );
  }
});
test('compatibility allows an additive optional response field', () => {
  const added = structuredClone(base);
  added.components.schemas.Project.properties.label = { type: 'string' };
  assert.deepEqual(compareContracts(base, added), []);
});
