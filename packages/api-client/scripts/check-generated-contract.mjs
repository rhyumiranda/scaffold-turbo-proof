import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const directory = await mkdtemp(join(tmpdir(), 'api-client-contract-check-'));
try {
  const destination = join(directory, 'api.d.ts');
  const result = spawnSync(
    process.execPath,
    ['node_modules/openapi-typescript/bin/cli.js', 'contract/openapi.json', '-o', destination],
    { encoding: 'utf8', timeout: 15000 },
  );
  if (result.status !== 0) throw new Error(`Contract generation failed: ${result.stderr}`);
  const generated = await readFile(destination, 'utf8');
  const committed = await readFile('src/api.d.ts', 'utf8');
  if (generated !== committed)
    throw new Error('Generated contract drift: run pnpm contract:generate and review the change.');
  console.log('Generated API client matches its source schema.');
} finally {
  await rm(directory, { recursive: true, force: true });
}
