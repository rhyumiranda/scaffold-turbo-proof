// Builds the migrate image's node_modules (used by apps/api/Dockerfile only).
// usage: node scripts/migrate-bundle.mjs <pnpm deploy output> <bundle directory>
// The migrate job needs `prisma migrate deploy` and the history check (pg), not the API's runtime packages.
// This copies the dependency closure of `prisma` and `pg` out of a `pnpm deploy` (same lockfile, same files),
// leaving out what only `prisma studio` and `prisma dev` load, so the image stays under its size budget.
// The migrate image test (`pnpm --filter @repo/api test:container`) runs `prisma migrate deploy` from the result.
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const [from, to] = process.argv.slice(2);
if (!from || !to) throw new Error('usage: node scripts/migrate-bundle.mjs <deploy-dir> <bundle-dir>');
const roots = ['prisma', 'pg'];
// Loaded only by `prisma studio` (UI), `prisma dev` (embedded PostgreSQL) or `prisma init` (TypeScript); never by
// `prisma migrate deploy`. TypeScript must not ship in an image at all.
const skipPackages = new Set([
  '@electric-sql/pglite',
  'react',
  'react-dom',
  '@types/react',
  '@types/react-dom',
  'typescript',
]);
const skipFiles = [
  ['prisma', 'build', /^query_compiler_/],
  ['prisma', 'build', /^studio\./],
  ['@prisma/studio-core', 'dist', /^(ui|metafile-.*\.json)$/],
];
const store = join(from, 'node_modules', '.pnpm');
const entries = (directory) =>
  readdirSync(directory).flatMap((name) =>
    name.startsWith('@') ? readdirSync(join(directory, name)).map((child) => `${name}/${child}`) : [name],
  );
const containers = new Map(); // .pnpm entry -> package name
const queue = roots.map((name) => [name, realpathSync(join(from, 'node_modules', name))]);
while (queue.length) {
  const [name, real] = queue.shift();
  const id = relative(store, real).split(sep)[0];
  if (containers.has(id)) continue;
  containers.set(id, name);
  const container = join(store, id, 'node_modules');
  for (const dependency of entries(container)) {
    const path = join(container, dependency);
    if (dependency === name || dependency === '.bin' || !lstatSync(path).isSymbolicLink()) continue;
    if (skipPackages.has(dependency) || !existsSync(path)) continue;
    queue.push([dependency, realpathSync(path)]);
  }
}
for (const [id, name] of containers) {
  const target = join(to, 'node_modules', '.pnpm', id);
  cpSync(join(store, id), target, { recursive: true, verbatimSymlinks: true });
  for (const [owner, folder, pattern] of skipFiles) {
    if (owner !== name) continue;
    const directory = join(target, 'node_modules', name, folder);
    for (const file of readdirSync(directory))
      if (pattern.test(file)) rmSync(join(directory, file), { recursive: true });
  }
}
for (const name of roots) {
  const id = relative(store, realpathSync(join(from, 'node_modules', name))).split(sep)[0];
  mkdirSync(join(to, 'node_modules'), { recursive: true });
  symlinkSync(join('.pnpm', id, 'node_modules', name), join(to, 'node_modules', name));
}
console.log(`migrate bundle: ${containers.size} packages from ${roots.join(', ')}`);
