import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { requestTelemetry } from '../dist/platform/telemetry.js';

test('authenticated request completion logs the verified subject', () => {
  const lines = [],
    previous = console.info,
    response = Object.assign(new EventEmitter(), {
      writableFinished: true,
      statusCode: 201,
      setHeader() {},
    });
  console.info = (value) => lines.push(value);
  try {
    requestTelemetry(
      {
        headers: {},
        method: 'POST',
        route: { path: '/v1/projects' },
        identity: { subject: 'keycloak-alice-subject' },
      },
      response,
      () => {},
    );
    response.emit('finish');
  } finally {
    console.info = previous;
  }
  assert.equal(lines.length, 1);
  const record = JSON.parse(lines[0]);
  assert.equal(record.event, 'request.complete');
  assert.equal(record.subject, 'keycloak-alice-subject');
});
