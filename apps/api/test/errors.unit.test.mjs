import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyParserErrors, ProblemFilter } from '../dist/platform/errors.js';
test('parser boundary normalizes trusted client failures but does not hide server failures', () => {
  for (const status of [400, 413, 415]) {
    const error = Object.assign(new Error('untrusted body text'), { status });
    let translated;
    bodyParserErrors(error, {}, {}, (result) => {
      translated = result;
    });
    assert.equal(translated.getStatus(), status);
    assert.ok(!translated.message.includes('untrusted'));
  }
  const unexpected = Object.assign(new Error('internal issue'), { status: 500 });
  let unchanged;
  bodyParserErrors(unexpected, {}, {}, (result) => {
    unchanged = result;
  });
  assert.equal(unchanged, unexpected);
  const applicationError = Object.assign(new Error('private data'), { status: 400 });
  let actualStatus, payload;
  const response = {
    writableEnded: false,
    getHeader: () => undefined,
    status(value) {
      actualStatus = value;
      return this;
    },
    type() {
      return this;
    },
    json(value) {
      payload = value;
    },
  };
  new ProblemFilter().catch(applicationError, { switchToHttp: () => ({ getResponse: () => response }) });
  assert.equal(actualStatus, 500);
  assert.equal(payload.code, 'INTERNAL_ERROR');
  assert.equal(payload.title, 'Internal Server Error');
  assert.equal(payload.type, 'about:blank');
  assert.ok(!JSON.stringify(payload).includes('private data'));
});
