import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { deploymentSettings } from '../src/lib/deployment.ts';
test('multi-instance profile requires stable deployment identity and shared valid action key', () => {
  assert.deepEqual(deploymentSettings({}), {});
  assert.ok(!('deploymentId' in deploymentSettings({})), 'unset id must be absent, not undefined');
  for (const env of [
    { DEPLOYMENT_REPLICAS: 'NaN' },
    { DEPLOYMENT_REPLICAS: '2' },
    { DEPLOYMENT_REPLICAS: '2', APP_DEPLOYMENT_ID: 'release', NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: 'invalid' },
  ])
    assert.throws(() => deploymentSettings(env));
  assert.deepEqual(
    deploymentSettings({
      DEPLOYMENT_REPLICAS: '2',
      APP_DEPLOYMENT_ID: 'release',
      NEXT_SERVER_ACTIONS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    }),
    { deploymentId: 'release' },
  );
});
