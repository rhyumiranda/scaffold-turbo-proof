import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
test('secret scanner rejects synthetic credentials in dotfiles and masks output', () => {
  const directory = mkdtempSync(join(tmpdir(), 'secretlint-regression-'));
  const token = 'ghp_' + 'A'.repeat(36);
  try {
    writeFileSync(join(directory, '.fixture-env'), 'TOKEN=' + token);
    const run = spawnSync(process.execPath, ['node_modules/secretlint/bin/secretlint.js', directory + '/**/*'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(run.status, 1, run.stderr);
    assert.ok((run.stdout + run.stderr).includes('github'));
    assert.ok(!(run.stdout + run.stderr).includes(token), 'Do not expose detected secrets');
    writeFileSync(join(directory, '.fixture-env'), 'TOKEN=example-placeholder');
    const clean = spawnSync(process.execPath, ['node_modules/secretlint/bin/secretlint.js', directory + '/**/*'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(clean.status, 0, clean.stderr);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
