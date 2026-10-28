import { run as runNest } from './adapters/nest.mjs';
export async function run({ webDirectory }) {
  if (process.env.NEST_TEST_PROJECT) return runNest({ webDirectory });
  throw new Error(
    'BLOCKED: isolated API bootstrap not configured. Implement tests/integration-bootstrap.mjs for your API, or set NEST_TEST_PROJECT to the compiled paired reference and DATABASE_URL to a disposable test database. Never supply production credentials. See docs/testing.md.',
  );
}
