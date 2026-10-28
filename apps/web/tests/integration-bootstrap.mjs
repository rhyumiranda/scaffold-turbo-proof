import { resolve } from 'node:path';
import { run as runNest } from './adapters/nest.mjs';

export async function run({ webDirectory }) {
  if (!process.env.DATABASE_URL) throw new Error('Workspace integration needs a disposable DATABASE_URL.');
  const previous = process.env.NEST_TEST_PROJECT;
  process.env.NEST_TEST_PROJECT = resolve(webDirectory, '../api');
  try {
    return await runNest({ webDirectory });
  } finally {
    if (previous === undefined) delete process.env.NEST_TEST_PROJECT;
    else process.env.NEST_TEST_PROJECT = previous;
  }
}
