import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
const config = JSON.parse(readFileSync(new URL('../verification.config.json', import.meta.url)));
const workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));
const id = 'scaffold-check-' + randomUUID(),
  image = id + ':local',
  migrateImage = id + '-migrate:local';
function docker(args, timeout = 30000) {
  const result = spawnSync('docker', args, {
    cwd: workspaceRoot,
    env: process.env,
    encoding: 'utf8',
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      'Docker verification command failed: ' + args[0] + ' (output withheld; inspect locally without secrets)',
    );
  return result.stdout.trim();
}
let built = false,
  created = false,
  migrateBuilt = false;
try {
  docker(['info', '--format', '{{.ServerVersion}}']);
  // A cold build also generates the Prisma client and fetches the schema engine: allow up to 10 minutes.
  docker(['build', '--label', 'scaffold.check=' + id, '-f', 'apps/api/Dockerfile', '-t', image, '.'], 600000);
  built = true;
  const missing = spawnSync('docker', ['run', '--rm', '--name', id + '-invalid', image], {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (missing.status === 0 || missing.error) throw new Error('Missing configuration must fail promptly');
  // The API process never runs migrations: the Prisma CLI ships only in the migrate image.
  const cli = spawnSync(
    'docker',
    ['run', '--rm', '--entrypoint', 'node', image, '-e', "require.resolve('prisma/build/index.js')"],
    { encoding: 'utf8', timeout: 30000 },
  );
  if (cli.status === 0) throw new Error('The runtime image must not contain the Prisma CLI');
  const args = [
    'run',
    '-d',
    '--name',
    id,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '-p',
    '127.0.0.1::' + config.container.port,
  ];
  for (const name of config.container.environment) {
    if (!/^[A-Z][A-Z0-9_]*$/.test(name) || !process.env[name])
      throw new Error('Missing container environment: ' + name);
    args.push('--env', name);
  }
  docker([...args, image]);
  created = true;
  if (docker(['exec', id, 'id', '-u']) === '0') throw new Error('Container must run without root');
  const port = docker(['port', id, String(config.container.port)])
    .split(':')
    .at(-1);
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + config.container.path, {
        redirect: 'manual',
        signal: AbortSignal.timeout(1000),
      });
      await response.arrayBuffer();
      if (response.status === 200) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!ready) throw new Error('Container smoke failed');
  docker(['stop', '--time', '10', id], 15000);
  if (docker(['inspect', '--format', '{{.State.ExitCode}}', id]) !== '0')
    throw new Error('Container did not shut down cleanly');
  // The migrate image ships separately and the default build skips its stage, so build and check it here too.
  const migrateTarget = ['--target', 'migrate', '-t', migrateImage, '.'];
  docker(['build', '--label', 'scaffold.check=' + id, '-f', 'apps/api/Dockerfile', ...migrateTarget], 600000);
  migrateBuilt = true;
  if (['', 'root', '0'].includes(docker(['image', 'inspect', '--format', '{{.Config.User}}', migrateImage])))
    throw new Error('Migrate image must run without root');
  const migrateMissing = spawnSync('docker', ['run', '--rm', '--name', id + '-migrate', migrateImage], {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (migrateMissing.status === 0 || migrateMissing.error || !migrateMissing.stderr.includes('DATABASE_URL'))
    throw new Error('Migrate image must fail promptly and name DATABASE_URL when it is missing');
  // Against the disposable _test database only: the migrate image runs `prisma migrate deploy` (read-only root
  // filesystem, no capabilities), then the runtime image answers readiness through Prisma. Host networking reaches
  // the loopback database; the API listens on a free port so it never collides with another local service.
  const database = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : undefined;
  if (process.env.NODE_ENV !== 'test' || !/^\/[A-Za-z0-9_]+_test$/.test(database?.pathname ?? ''))
    throw new Error('NODE_ENV=test and a disposable DATABASE_URL (database name ending in _test) are required');
  const hardened = ['--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--network', 'host'];
  const migrated = spawnSync(
    'docker',
    ['run', '--rm', '--name', id + '-migrate', ...hardened, '--env', 'DATABASE_URL', migrateImage],
    { env: process.env, encoding: 'utf8', timeout: 120000 },
  );
  if (migrated.status !== 0 || !migrated.stdout.includes('Migrations applied'))
    throw new Error('Migrate image could not apply migrations to the disposable database (output withheld)');
  const probe = createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const readyPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  const readyArgs = ['run', '-d', '--name', id + '-ready', ...hardened, '--env', 'PORT=' + readyPort];
  for (const name of config.container.environment) readyArgs.push('--env', name);
  docker([...readyArgs, image]);
  let databaseReady = false;
  for (let i = 0; i < 100 && !databaseReady; i++) {
    try {
      const response = await fetch('http://127.0.0.1:' + readyPort + '/health/ready', {
        signal: AbortSignal.timeout(1000),
      });
      await response.arrayBuffer();
      databaseReady = response.status === 200;
    } catch {}
    if (!databaseReady) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!databaseReady || docker(['inspect', '--format', '{{.State.Running}}', id + '-ready']) !== 'true')
    throw new Error('Runtime image did not report ready against the disposable database');
  console.log(
    JSON.stringify({
      passed: true,
      checks: [
        'image build',
        'missing configuration',
        'non-root',
        'HTTP smoke',
        'SIGTERM',
        'migrate image',
        'migrate deploy on the disposable database',
        'runtime readiness through Prisma',
      ],
      scope: 'Local container only; no deployment, real-provider or capacity claim',
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (created) spawnSync('docker', ['rm', '-f', id], { stdio: 'ignore', timeout: 15000 });
  spawnSync('docker', ['rm', '-f', id + '-invalid', id + '-migrate', id + '-ready'], {
    stdio: 'ignore',
    timeout: 15000,
  });
  if (built) spawnSync('docker', ['image', 'rm', image], { stdio: 'ignore', timeout: 15000 });
  if (migrateBuilt) spawnSync('docker', ['image', 'rm', migrateImage], { stdio: 'ignore', timeout: 15000 });
}
