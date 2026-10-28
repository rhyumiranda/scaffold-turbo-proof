import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
  docker(['build', '--label', 'scaffold.check=' + id, '-f', 'apps/api/Dockerfile', '-t', image, '.'], 180000);
  built = true;
  const missing = spawnSync('docker', ['run', '--rm', '--name', id + '-invalid', image], {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (missing.status === 0 || missing.error) throw new Error('Missing configuration must fail promptly');
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
  docker(['build', '--label', 'scaffold.check=' + id, '-f', 'apps/api/Dockerfile', ...migrateTarget], 180000);
  migrateBuilt = true;
  if (['', 'root', '0'].includes(docker(['image', 'inspect', '--format', '{{.Config.User}}', migrateImage])))
    throw new Error('Migrate image must run without root');
  const migrateMissing = spawnSync('docker', ['run', '--rm', '--name', id + '-migrate', migrateImage], {
    encoding: 'utf8',
    timeout: 10000,
  });
  if (migrateMissing.status === 0 || migrateMissing.error || !migrateMissing.stderr.includes('DATABASE_URL'))
    throw new Error('Migrate image must fail promptly and name DATABASE_URL when it is missing');
  console.log(
    JSON.stringify({
      passed: true,
      checks: ['image build', 'missing configuration', 'non-root', 'HTTP smoke', 'SIGTERM', 'migrate image'],
      scope: 'Local container only; no deployment, real-provider or capacity claim',
    }),
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (created) spawnSync('docker', ['rm', '-f', id], { stdio: 'ignore', timeout: 15000 });
  spawnSync('docker', ['rm', '-f', id + '-invalid', id + '-migrate'], { stdio: 'ignore', timeout: 15000 });
  if (built) spawnSync('docker', ['image', 'rm', image], { stdio: 'ignore', timeout: 15000 });
  if (migrateBuilt) spawnSync('docker', ['image', 'rm', migrateImage], { stdio: 'ignore', timeout: 15000 });
}
