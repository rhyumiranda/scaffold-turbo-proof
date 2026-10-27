import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkArchitecture } from '../scripts/check-architecture.mjs';
test('architecture accepts public feature entrypoints', () => {
  assert.deepEqual(
    checkArchitecture({ 'a/service.ts': "import {b} from '../b/index.js';", 'b/index.ts': 'export const b=1;' }),
    [],
  );
});
test('architecture rejects private, inverted, computed and cyclic imports', () => {
  assert.ok(
    checkArchitecture({ 'a/service.ts': "import '../b/service.js';", 'b/service.ts': '' }).some((x) =>
      x.includes('public index'),
    ),
  );
  assert.ok(
    checkArchitecture({ 'platform/service.ts': "import '../a/index.js';", 'a/index.ts': '' }).some((x) =>
      x.includes('cannot depend'),
    ),
  );
  assert.ok(
    checkArchitecture({ 'a/index.ts': "import './service.js';", 'a/service.ts': "import './index.js';" }).some((x) =>
      x.includes('cycle'),
    ),
  );
  assert.ok(checkArchitecture({ 'a/index.ts': 'import(variable);' }).some((x) => x.includes('computed')));
  assert.ok(checkArchitecture({ 'a/index.ts': "import pg from 'pg';" }).some((x) => x.includes('belong to platform')));
});
