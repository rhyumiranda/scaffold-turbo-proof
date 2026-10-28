import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
export async function runIntegration(project, bootstrap = resolve(project, 'tests/integration-bootstrap.mjs')) {
  const module = await import(pathToFileURL(bootstrap));
  if (typeof module.run !== 'function')
    throw new Error('Integration bootstrap must export async run({webDirectory}); see docs/testing.md.');
  const result = await module.run({ webDirectory: project });
  if (result !== 0)
    throw new Error(
      'Real API integration failed; bootstrap must resolve 0 only after browser tests pass and resources are closed.',
    );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--identity')) process.env.TEST_OIDC = 'true';
  if (process.argv.includes('--telemetry')) process.env.TEST_TELEMETRY = 'true';
  if (process.argv.includes('--replicas')) process.env.TEST_REPLICAS = '2';
  try {
    await runIntegration(process.cwd());
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Integration failed');
    process.exitCode = 1;
  }
}
