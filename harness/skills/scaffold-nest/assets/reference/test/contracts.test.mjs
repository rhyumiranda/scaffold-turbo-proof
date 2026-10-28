import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareContracts } from '../scripts/check-contract.mjs';
import { spec } from './schema.mjs';
// A small self-contained document, so these rules stay tested after the Projects example is replaced.
const base = {
  openapi: '3.0.0',
  components: {
    securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
    schemas: {
      CreateItem: {
        type: 'object',
        additionalProperties: false,
        required: ['name'],
        properties: { name: { type: 'string', minLength: 1, maxLength: 100 } },
      },
      Item: {
        type: 'object',
        required: ['id', 'name', 'version', 'createdAt'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          name: { type: 'string' },
          version: { type: 'integer', minimum: 1 },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/v1/items': {
      post: {
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/CreateItem' } } },
        },
        responses: { 201: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } } } },
      },
    },
  },
};
const clone = () => structuredClone(base);
const schemas = (doc) => doc.components.schemas;
const breaks = (before, after, text) =>
  assert.ok(
    compareContracts(before, after).some((error) => error.includes(text)),
    `expected a breaking change containing "${text}", got ${JSON.stringify(compareContracts(before, after))}`,
  );
const compatible = (before, after) => assert.deepEqual(compareContracts(before, after), []);
test('compatibility: identical, documentation-only, additive and widening changes pass', () => {
  compatible(base, clone());
  const docs = clone();
  schemas(docs).CreateItem.description = 'Reworded documentation only';
  schemas(docs).CreateItem.title = 'CreateItemRenamed';
  compatible(base, docs);
  const newOperation = clone();
  newOperation.paths['/v1/new'] = { get: { responses: { 200: { description: 'ok' } } } };
  compatible(base, newOperation);
  const optionalResponseField = clone();
  schemas(optionalResponseField).Item.properties.label = { type: 'string' };
  compatible(base, optionalResponseField);
  const widened = clone();
  schemas(widened).CreateItem.properties.name.maxLength = 200;
  compatible(base, widened);
});
test('compatibility: removals and narrowing break clients', () => {
  const removedOperation = clone();
  delete removedOperation.paths['/v1/items'].post;
  breaks(base, removedOperation, 'POST /v1/items: accepted operation removed');
  const removedResponseField = clone();
  delete schemas(removedResponseField).Item.properties.version;
  schemas(removedResponseField).Item.required = ['id', 'name', 'createdAt'];
  breaks(base, removedResponseField, 'property "version" removed');
  const responseType = clone();
  schemas(responseType).Item.properties.version.type = 'string';
  breaks(base, responseType, 'type changed');
  const noLongerGuaranteed = clone();
  schemas(noLongerGuaranteed).Item.required = ['id', 'name', 'version'];
  breaks(base, noLongerGuaranteed, 'property "createdAt" is no longer guaranteed');
  const narrowed = clone();
  schemas(narrowed).CreateItem.properties.name.maxLength = 99;
  breaks(base, narrowed, 'maxLength narrowed 100 -> 99');
  const newRequired = clone();
  schemas(newRequired).CreateItem.properties.label = { type: 'string' };
  schemas(newRequired).CreateItem.required = ['name', 'label'];
  breaks(base, newRequired, 'property "label" is now required');
  const removedRequestField = clone();
  delete schemas(removedRequestField).CreateItem.properties.name;
  schemas(removedRequestField).CreateItem.required = [];
  breaks(base, removedRequestField, 'property "name" removed');
  const enumBefore = clone();
  schemas(enumBefore).CreateItem.properties.kind = { type: 'string', enum: ['a', 'b'] };
  const enumAfter = structuredClone(enumBefore);
  schemas(enumAfter).CreateItem.properties.kind.enum = ['a'];
  breaks(enumBefore, enumAfter, 'enum no longer accepts an accepted value');
  const security = clone();
  security.components.securitySchemes.bearer = { type: 'apiKey', in: 'header', name: 'x-api-key' };
  breaks(base, security, 'security schemes changed');
});
test('compatibility: properties named like documentation keywords are compared, not stripped', () => {
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
    const required = clone();
    schemas(required).CreateItem.properties[name] = { type: 'string' };
    schemas(required).CreateItem.required = ['name', name];
    breaks(base, required, `property "${name}" is now required`);
    const withResponse = clone();
    schemas(withResponse).Item.properties[name] = { type: 'string' };
    breaks(withResponse, clone(), `property "${name}" removed`);
  }
});
test('checked-in schema equals fresh compiled Swagger metadata without database access', async () => {
  const fixture = {
    DATABASE_URL: 'postgresql://127.0.0.1:1/metadata_only',
    AUTH_ISSUER: 'https://example.invalid',
    AUTH_AUDIENCE: 'metadata',
    AUTH_JWKS_URL: 'https://example.invalid/jwks',
  };
  const previous = Object.fromEntries(Object.keys(fixture).map((key) => [key, process.env[key]]));
  Object.assign(process.env, fixture);
  let app;
  try {
    const { createApp, contract } = await import('../dist/app.js');
    app = await createApp();
    const fresh = JSON.parse(JSON.stringify(contract(app)));
    // Two short strings keep this line stable when the workspace generator rewrites the command.
    const fix = 'Run npm run contract, then review the openapi.json diff';
    const hint = `openapi.json does not match the compiled API. ${fix}`;
    assert.deepEqual(fresh, spec, hint);
  } finally {
    if (app) await app.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
