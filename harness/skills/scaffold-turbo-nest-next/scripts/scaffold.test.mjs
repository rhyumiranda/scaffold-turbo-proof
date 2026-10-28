import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access, cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./scaffold.mjs', import.meta.url));
const skill = fileURLToPath(new URL('..', import.meta.url));
function call(...args) { return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 30000 }); }

test('dry run writes nothing', async () => {
  const base = await mkdtemp(join(tmpdir(), 'turbo-skill-dry-'));
  try {
    const destination = join(base, 'workspace');
    const result = call('--destination', destination, '--name', 'example', '--dry-run');
    assert.equal(result.status, 0, result.stderr);
    await assert.rejects(access(destination));
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('generation composes workspace and refuses overwrite', async () => {
  const base = await mkdtemp(join(tmpdir(), 'turbo-skill-generate-'));
  try {
    const destination = join(base, 'workspace');
    const result = call('--destination', destination, '--name', 'example');
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(await readFile(join(destination, 'package.json'))).name, '@repo/example');
    const apiPackage = JSON.parse(await readFile(join(destination, 'apps/api/package.json')));
    assert.equal(apiPackage.name, '@repo/api');
    assert.equal(apiPackage.dependencies.express, '5.3.0');
    assert.equal(apiPackage.overrides, undefined);
    assert.equal(JSON.parse(await readFile(join(destination, 'apps/web/package.json'))).dependencies['@repo/api-client'], 'workspace:*');
    assert.match(await readFile(join(destination, 'pnpm-workspace.yaml'), 'utf8'), /overrides:\n  multer: 2\.5\.0/);
    for (const app of ['api', 'web']) {
      const containerCheck = await readFile(join(destination, `apps/${app}/scripts/check-container.mjs`), 'utf8');
      assert.match(containerCheck, /const workspaceRoot = /);
      assert.match(containerCheck, new RegExp(`'-f', 'apps/${app}/Dockerfile'`));
    }
    const nextConfig = await readFile(join(destination, 'apps/web/next.config.ts'), 'utf8');
    assert.match(nextConfig, /\.\.\.deploymentSettings\(\)/, 'companion deployment guard must survive composition');
    assert.deepEqual(JSON.parse(await readFile(join(destination, 'apps/web/turbo.json'))).tasks.build.env.sort(), ['APP_DEPLOYMENT_ID', 'DEPLOYMENT_REPLICAS', 'NEXT_SERVER_ACTIONS_ENCRYPTION_KEY']);
    const manifest = JSON.parse(await readFile(join(destination, 'scaffold-manifest.json')));
    assert.deepEqual([manifest.companions.nest.referenceVersion, manifest.companions.next.referenceVersion], ['1.4.0', '1.4.0']);
    const ci = await readFile(join(destination, '.github/workflows/verify.yml'), 'utf8');
    for (const gate of ['pnpm boundaries', 'test:identity', 'test:profiles', 'test:telemetry', 'test:recovery', '@repo/api test:container', '@repo/web test:container', 'git diff --exit-code -- apps/api/openapi.json'])
      assert.ok(ci.includes(gate), `CI must run ${gate}`);
    await access(join(destination, '.github/dependabot.yml'));
    assert.equal(apiPackage.devDependencies.typescript, 'catalog:');
    assert.deepEqual(apiPackage.files, ['dist'], 'API image ships compiled output only');
    assert.match(apiPackage.scripts['test:e2e'], /--import \.\/test\/test-database\.mjs/);
    assert.ok(Object.keys(manifest.requirements).length > 100 && Object.values(manifest.requirements).every(entry => entry.status === 'not_run'));
    const turbo = JSON.parse(await readFile(join(destination, 'turbo.json')));
    for (const task of ['contract:check', 'contract:compat', 'test:e2e', 'migrate']) assert.ok(turbo.tasks[task], `turbo task ${task}`);
    assert.equal(turbo.tasks['test:e2e'].cache, false); assert.equal(turbo.tasks.migrate.cache, false);
    for (const app of ['api', 'web']) {
      const dockerfile = await readFile(join(destination, `apps/${app}/Dockerfile`), 'utf8');
      assert.match(dockerfile, new RegExp(`turbo run build --filter=@repo/${app}`));
      assert.match(dockerfile, /corepack prepare pnpm@12\.15\.0 --activate/, 'pnpm must be executable for turbo inside the image');
      assert.doesNotMatch(dockerfile, /npm install --global[^\n]*pnpm@/, 'an ignore-scripts npm install leaves pnpm 12 unexecutable');
    }
    await assert.rejects(access(join(destination, 'apps/api/package-lock.json')));
    await assert.rejects(access(join(destination, 'apps/web/package-lock.json')));
    const before = await readFile(join(destination, 'package.json'), 'utf8');
    const second = call('--destination', destination, '--name', 'example');
    assert.notEqual(second.status, 0);
    assert.equal(await readFile(join(destination, 'package.json'), 'utf8'), before);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('rejects traversal, invalid names, and symlink destinations', async () => {
  const base = await mkdtemp(join(tmpdir(), 'turbo-skill-invalid-'));
  try {
    assert.notEqual(call('--destination', `${base}/../escape`, '--name', 'valid', '--dry-run').status, 0);
    assert.notEqual(call('--destination', join(base, 'bad'), '--name', 'Bad Name', '--dry-run').status, 0);
    const target = join(base, 'target');
    await writeFile(target, 'not a directory');
    assert.notEqual(call('--destination', target, '--name', 'valid', '--dry-run').status, 0);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('rejects a bundled lockfile that does not match generated packages', async () => {
  const base = await mkdtemp(join(tmpdir(), 'turbo-skill-lock-'));
  try {
    const copiedSkill = join(base, 'skill');
    await cp(skill, copiedSkill, { recursive: true });
    const lockfile = join(copiedSkill, 'assets/workspace-root/pnpm-lock.yaml');
    const original = await readFile(lockfile, 'utf8');
    await writeFile(lockfile, original.replace('specifier: 2.11.10', 'specifier: 2.11.9'));
    // The copy has no sibling companions, so point at the ones installed beside the real skill.
    const companions = ['--nest-skill', join(skill, '..', 'scaffold-nest'), '--next-skill', join(skill, '..', 'scaffold-next')];
    const result = spawnSync(process.execPath, [join(copiedSkill, 'scripts/scaffold.mjs'), '--destination', join(base, 'workspace'), '--name', 'example', ...companions], { encoding: 'utf8', timeout: 30000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Bundled lockfile does not match/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('refuses a companion that pins a different version than the catalog', async () => {
  const base = await mkdtemp(join(tmpdir(), 'turbo-skill-catalog-'));
  try {
    const copiedSkill = join(base, 'skill');
    await cp(skill, copiedSkill, { recursive: true });
    const workspace = join(copiedSkill, 'assets/workspace-root/pnpm-workspace.yaml');
    await writeFile(workspace, (await readFile(workspace, 'utf8')).replace('typescript: 5.9.3', 'typescript: 5.9.2'));
    const companions = ['--nest-skill', join(skill, '..', 'scaffold-nest'), '--next-skill', join(skill, '..', 'scaffold-next')];
    const result = spawnSync(process.execPath, [join(copiedSkill, 'scripts/scaffold.mjs'), '--destination', join(base, 'workspace'), '--name', 'example', ...companions], { encoding: 'utf8', timeout: 30000 });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /pins typescript@5\.9\.3; the workspace catalog has 5\.9\.2/);
  } finally { await rm(base, { recursive: true, force: true }); }
});

test('records validated intake answers and rejects invalid ones', async () => {
  const base = await mkdtemp(join(tmpdir(), 'turbo-skill-intake-'));
  try {
    const answers = { journey: 'Owners rename projects', actors: ['owner'], auth: 'oidc', database: 'postgresql', deletion: 'none', deployment: 'containers', optionalProfiles: [] };
    const good = join(base, 'intake.json'); await writeFile(good, JSON.stringify(answers));
    const preview = call('--destination', join(base, 'preview'), '--name', 'example', '--intake', good, '--dry-run');
    assert.equal(preview.status, 0, preview.stderr); assert.deepEqual(JSON.parse(preview.stdout).intake, answers);
    const destination = join(base, 'workspace');
    const result = call('--destination', destination, '--name', 'example', '--intake', good);
    assert.equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(await readFile(join(destination, 'scaffold-manifest.json')));
    assert.deepEqual(manifest.intake, answers); assert.equal(manifest.authIntegration, 'oidc-selected-provider-unverified');
    for (const bad of [{ ...answers, auth: 'magic' }, { ...answers, extra: 1 }, { ...answers, actors: [] }]) {
      const file = join(base, 'bad.json'); await writeFile(file, JSON.stringify(bad));
      const refused = call('--destination', join(base, 'never'), '--name', 'example', '--intake', file, '--dry-run');
      assert.notEqual(refused.status, 0); assert.match(refused.stderr, /Invalid --intake/);
      await assert.rejects(access(join(base, 'never')));
    }
  } finally { await rm(base, { recursive: true, force: true }); }
});
