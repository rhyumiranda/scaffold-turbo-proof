import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(ignoreScripts) {
  const root = mkdtempSync(join(tmpdir(), 'pnpm-policy-'));
  try {
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'inert-policy-fixture',
        version: '1.0.0',
        scripts: { postinstall: 'node lifecycle.cjs' },
      }),
    );
    writeFileSync(join(root, 'lifecycle.cjs'), "require('node:fs').writeFileSync('lifecycle-ran','inert fixture')");
    writeFileSync(join(root, 'empty-user-config'), '');
    writeFileSync(join(root, 'empty-global-config'), '');
    if (ignoreScripts) {
      const workspaceConfig = readFileSync(resolve('../../pnpm-workspace.yaml'), 'utf8');
      assert.match(workspaceConfig, /^ignoreScripts: true$/m);
      writeFileSync(join(root, 'pnpm-workspace.yaml'), 'ignoreScripts: true\n');
    }
    const env = {
      ...process.env,
      npm_config_userconfig: join(root, 'empty-user-config'),
      npm_config_globalconfig: join(root, 'empty-global-config'),
    };
    const executable = process.env.npm_execpath;
    assert.ok(executable, 'pnpm executable provenance is missing');
    const result = spawnSync(executable, ['install', '--offline'], {
      cwd: root,
      env,
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr ?? result.error?.message ?? 'pnpm failed');
    return existsSync(join(root, 'lifecycle-ran'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test('workspace install policy suppresses lifecycle scripts', () => assert.equal(fixture(true), false));
test('inert negative fixture detects lifecycle execution when config is omitted', () =>
  assert.equal(fixture(false), true));
