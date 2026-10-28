import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = process.cwd();
const required = [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'turbo.json',
  'apps/api/package.json',
  'apps/web/package.json',
  'packages/api-client/package.json',
];
for (const file of required) await access(join(root, file));
for (const app of ['api', 'web']) {
  const directory = join(root, 'apps', app);
  const entries = new Set(await readdir(directory));
  for (const forbidden of ['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock']) {
    if (entries.has(forbidden)) throw new Error(`Nested lockfile forbidden: apps/${app}/${forbidden}`);
  }
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  if (manifest.packageManager) throw new Error(`Nested packageManager forbidden: apps/${app}`);
  if (!manifest.private) throw new Error(`Application must be private: apps/${app}`);
}
const web = JSON.parse(await readFile(join(root, 'apps/web/package.json'), 'utf8'));
if (web.dependencies?.['@repo/api-client'] !== 'workspace:*')
  throw new Error('Web must declare @repo/api-client through workspace:*');
console.log('Workspace structure and ownership checks passed.');
