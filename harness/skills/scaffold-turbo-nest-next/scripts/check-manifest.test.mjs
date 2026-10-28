import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scaffold = fileURLToPath(new URL('./scaffold.mjs', import.meta.url));
const check = fileURLToPath(new URL('./check-manifest.mjs', import.meta.url));
test('generated manifest validates and detects changed files', async () => {
  const base = await mkdtemp(join(tmpdir(), 'turbo-manifest-'));
  try {
    const destination = join(base, 'workspace');
    assert.equal(spawnSync(process.execPath, [scaffold, '--destination', destination, '--name', 'example'], { encoding: 'utf8', timeout: 30000 }).status, 0);
    const manifest = join(destination, 'scaffold-manifest.json');
    assert.equal(spawnSync(process.execPath, [check, manifest], { encoding: 'utf8' }).status, 0);
    const packagePath = join(destination, 'package.json');
    const original = await readFile(packagePath, 'utf8');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(packagePath, `${original}\n`));
    assert.notEqual(spawnSync(process.execPath, [check, manifest], { encoding: 'utf8' }).status, 0);
  } finally { await rm(base, { recursive: true, force: true }); }
});
