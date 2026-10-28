import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
export const spec = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ strict: false, allErrors: true });
addFormats(ajv);
export function assertResponse(path, method, status, body) {
  const response = spec.paths[path][method].responses[status];
  assert.ok(response, `Undocumented response: ${method} ${path} ${status}`);
  const schema = Object.values(response.content ?? {})[0]?.schema;
  assert.ok(schema, 'Response must have an explicit schema');
  const validate = ajv.compile({ ...schema, components: spec.components });
  assert.ok(validate(body), JSON.stringify(validate.errors));
}
