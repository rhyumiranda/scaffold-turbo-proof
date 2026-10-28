import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(ignoreScripts) {
  const root = mkdtempSync(join(tmpdir(), 'npm-policy-'));
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
    if (ignoreScripts) writeFileSync(join(root, '.npmrc'), readFileSync('.npmrc'));
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^npm_config_/i.test(key)) delete env[key];
    env.npm_config_userconfig = join(root, 'empty-user-config');
    env.npm_config_globalconfig = join(root, 'empty-global-config');
    const run = (args) => {
      const result = spawnSync('npm', args, { cwd: root, env, encoding: 'utf8', timeout: 30000 });
      assert.equal(result.status, 0, result.stderr);
    };
    run(['install', '--package-lock-only', '--ignore-scripts', '--offline', '--no-audit']);
    run(['ci', '--offline', '--no-audit']);
    return existsSync(join(root, 'lifecycle-ran'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}
test('container install context suppresses lifecycle scripts', () => {
  const beforeInstall = readFileSync('Dockerfile', 'utf8').split(/^RUN npm ci\s*$/m)[0];
  const includesConfig = /^COPY .*\.npmrc .*\.\//m.test(beforeInstall);
  assert.equal(fixture(includesConfig), false, 'Docker install must receive .npmrc before npm ci');
});
test('inert negative fixture detects lifecycle execution when config is omitted', () => {
  assert.equal(fixture(false), true);
});
