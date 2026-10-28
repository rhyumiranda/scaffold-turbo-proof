import { access, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, unlink, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const options = new Map();
for (let index = 2; index < process.argv.length; index++) {
  const key = process.argv[index];
  if (key === '--dry-run') options.set(key, true);
  else if (['--destination', '--name', '--nest-skill', '--next-skill', '--intake'].includes(key) && process.argv[index + 1]) options.set(key, process.argv[++index]);
  else throw new Error('Usage: node scaffold.mjs --destination /absolute/new-directory --name repository-name [--nest-skill /absolute/path] [--next-skill /absolute/path] [--intake /absolute/intake.json] [--dry-run]');
}

const requested = options.get('--destination');
const name = options.get('--name');
if (typeof requested !== 'string' || typeof name !== 'string' || !requested.startsWith('/') || requested.split('/').includes('..')) throw new Error('Supply an absolute destination without traversal and a name.');
if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error(`Invalid name ${JSON.stringify(name)}: use 1 to 64 characters, start with a lowercase letter, then only lowercase letters, digits or hyphens${name.length > 64 ? ` (it has ${name.length} characters)` : ''}.`);

const skill = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Phase 1 answers. Optional, but when given they are validated and recorded so they are never silently dropped.
const intakeShape = {
  journey: value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200,
  actors: value => Array.isArray(value) && value.length > 0 && value.every(actor => typeof actor === 'string' && actor.trim() && actor.length <= 80),
  auth: value => ['external-cookie', 'oidc', 'unresolved'].includes(value),
  database: value => value === 'postgresql',
  deletion: value => ['none', 'owner-only', 'policy-defined'].includes(value),
  deployment: value => ['none', 'containers'].includes(value),
  optionalProfiles: value => Array.isArray(value) && value.every(profile => ['tenancy', 'jobs', 'uploads', 'realtime', 'ai'].includes(profile)) && new Set(value).size === value.length,
};
async function readIntake(file) {
  if (file === undefined) return null;
  if (!file.startsWith('/')) throw new Error('--intake must be an absolute path');
  let data;
  try { data = JSON.parse(await readFile(file, 'utf8')); } catch (error) { throw new Error(`--intake is not readable JSON: ${error.message}`); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('--intake must be a JSON object');
  const problems = [];
  for (const key of Object.keys(data)) if (!(key in intakeShape)) problems.push(`unknown field ${key}`);
  for (const [key, valid] of Object.entries(intakeShape)) if (!valid(data[key])) problems.push(`invalid or missing ${key}`);
  if (problems.length) throw new Error(`Invalid --intake: ${problems.join('; ')}. See references/intake.md.`);
  return data;
}
const intake = await readIntake(options.get('--intake'));
const authIntegration = { 'external-cookie': 'external-cookie-selected-provider-unverified', oidc: 'oidc-selected-provider-unverified' }[intake?.auth] ?? 'provider-configuration-required';
const template = join(skill, 'assets', 'workspace-root');
// Default to the companions installed beside this skill, so one install never mixes versions from another.
const nestSkill = resolve(options.get('--nest-skill') ?? join(skill, '..', 'scaffold-nest'));
const nextSkill = resolve(options.get('--next-skill') ?? join(skill, '..', 'scaffold-next'));
const parent = await realpath(dirname(resolve(requested))).catch((error) => {
  if (error.code === 'ENOENT') throw new Error(`Destination parent folder does not exist: ${dirname(resolve(requested))}. Create it first.`);
  throw error;
});
const destination = join(parent, basename(requested));
if (destination === parent) throw new Error('Destination must be a new child directory.');
try { await lstat(destination); throw new Error('Destination exists. Refusing overwrite or automatic upgrade.'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }

for (const directory of [template, nestSkill, nextSkill]) await access(directory);
for (const companion of [nestSkill, nextSkill]) await access(join(companion, 'scripts', 'scaffold.mjs'));
await access(join(template, 'pnpm-lock.yaml'));

const excluded = new Set([
  'package-lock.json', 'scaffold-manifest.json', '.gitignore', '.npmrc', '.nvmrc', '.dockerignore',
  'Dockerfile', 'eslint.config.mjs', 'tsconfig.json', 'next.config.ts', '.prettierrc.json', '.prettierignore'
]);
const webExcludedPrefixes = ['.github/', 'contract/', 'src/generated/', 'scripts/check-generated-contract.mjs', 'scripts/check-contract.mjs', 'scripts/contract.test.mjs'];
const apiExcludedPrefixes = ['.github/'];
const preview = {
  skill: basename(skill), destination, name,
  companions: { nest: nestSkill, next: nextSkill },
  versions: { runtime: '24.22.1', packageManager: 'pnpm@12.15.0', turbo: '2.11.10', nestReference: '1.4.0', nextReference: '1.4.0' },
  layout: ['apps/api', 'apps/web', 'packages/api-client', 'packages/eslint-config', 'packages/typescript-config'],
  intake: intake ?? 'not recorded; pass --intake to record Phase 1 answers',
  installs: false, commits: false, deployment: false
};
if (options.has('--dry-run')) { console.log(JSON.stringify(preview, null, 2)); process.exit(0); }

const staging = await mkdtemp(join(tmpdir(), 'scaffold-turbo-nest-next-'));
const nestStage = join(staging, 'api');
const nextStage = join(staging, 'web');

function run(file, args, cwd = staging) {
  const result = spawnSync(file, args, { cwd, encoding: 'utf8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`Command failed: ${file} ${args.join(' ')}\n${result.stderr || result.stdout}`);
}

async function collect(directory, base = directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink forbidden in generated source: ${relative(base, path)}`);
    if (entry.isDirectory()) files.push(...await collect(path, base));
    else if (entry.isFile()) files.push(relative(base, path));
  }
  return files.sort();
}

async function copyTree(source, target, shouldExclude = () => false) {
  for (const path of await collect(source)) {
    if (shouldExclude(path)) continue;
    const output = join(target, path);
    await mkdir(dirname(output), { recursive: true });
    await copyFile(join(source, path), output);
  }
}

function appExclusion(prefixes) {
  return path => excluded.has(path) || prefixes.some(prefix => path === prefix || path.startsWith(prefix));
}

async function adaptText(directory) {
  const textExtensions = new Set(['.md', '.mjs', '.ts', '.tsx']);
  for (const path of await collect(directory)) {
    if (!textExtensions.has(extname(path)) && basename(path) !== 'AGENTS.md') continue;
    const absolute = join(directory, path);
    let text = await readFile(absolute, 'utf8');
    text = text
      // Image builds run from the workspace root with the app's Dockerfile; docs/operations.md says where to run them.
      .replaceAll('docker build --target runtime -t app-runtime .', 'docker build -f apps/api/Dockerfile --target runtime -t app-runtime .')
      .replaceAll('docker build --target migrate -t app-migrate .', 'docker build -f apps/api/Dockerfile --target migrate -t app-migrate .')
      .replace(/\bnpm install --frozen-lockfile\b/g, 'pnpm install --frozen-lockfile')
      .replace(/\bnpm ci\b/g, 'pnpm install --frozen-lockfile')
      .replace(/\bnpm run /g, 'pnpm ')
      .replace(/\bnpm start\b/g, 'pnpm start')
      .replace(/\bnpm test\b/g, 'pnpm test')
      .replace(/\bnpm audit\b/g, 'pnpm audit')
      .replaceAll('npm 11.17.0', 'pnpm 12.15.0')
      // The workspace has no .npmrc; pnpm reads its install policy from the root pnpm-workspace.yaml.
      .replaceAll('Installation scripts are disabled by .npmrc', 'Installation scripts are disabled by `ignoreScripts` in the root pnpm-workspace.yaml');
    await writeFile(absolute, text);
  }
}

async function readCatalog() {
  const text = await readFile(join(template, 'pnpm-workspace.yaml'), 'utf8');
  const block = text.split(/^catalog:\n/m)[1]?.split(/^\S/m)[0] ?? '';
  return new Map([...block.matchAll(/^ {2}(?:'([^'\n]+)'|([^\s:']+)): (\S+)$/gm)].map(match => [match[1] ?? match[2], match[3]]));
}
const catalog = await readCatalog();
function useCatalog(data, label) {
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
    for (const [dependency, version] of Object.entries(data[section] ?? {})) {
      if (!catalog.has(dependency)) continue;
      if (catalog.get(dependency) !== version) throw new Error(`${label} pins ${dependency}@${version}; the workspace catalog has ${catalog.get(dependency)}. Update the catalog and bundled lockfile together.`);
      data[section][dependency] = 'catalog:';
    }
  }
}

async function adaptPackage(path, kind) {
  const data = JSON.parse(await readFile(path, 'utf8'));
  data.name = kind === 'api' ? '@repo/api' : '@repo/web';
  data.version = '0.0.0';
  data.private = true;
  delete data.packageManager;
  delete data.overrides;
  data.devDependencies = { ...data.devDependencies, '@repo/eslint-config': 'workspace:*', '@repo/typescript-config': 'workspace:*' };
  delete data.devDependencies['typescript-eslint'];
  // Formatting is owned by the workspace root.
  delete data.devDependencies.prettier;
  delete data.scripts.format;
  delete data.scripts['format:check'];
  if (kind === 'api') {
    data.dependencies = { ...data.dependencies, express: '5.3.0' };
    data.scripts.dev = 'node scripts/dev.mjs';
    data.scripts.test = 'pnpm test:unit && pnpm test:integration && pnpm test:runtime';
    data.scripts['test:e2e'] = 'node --import ./test/test-database.mjs test/with-web.mjs ../web';
    // Only compiled output ships through `pnpm deploy`; the migrate image copies migrations explicitly.
    data.files = ['dist'];
  } else {
    data.type = 'module';
    data.dependencies = { ...data.dependencies, '@repo/api-client': 'workspace:*' };
    data.scripts.lint = 'eslint . --max-warnings 0 && pnpm check:arch';
    data.scripts['test:unit'] = data.scripts['test:unit'].replace(' scripts/contract.test.mjs', '');
    delete data.scripts.contract;
    delete data.scripts['contract:check'];
    delete data.scripts['contract:compat'];
    delete data.devDependencies['openapi-typescript'];
  }
  useCatalog(data, `apps/${kind}`);
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}

async function adaptContainerCheck(path, kind) {
  let text = await readFile(path, 'utf8');
  const childProcessCall = "spawnSync('docker', args, { env: process.env, encoding: 'utf8', timeout, maxBuffer: 4 * 1024 * 1024 })";
  const buildCall = "docker(['build', '--label', 'scaffold.check=' + id, '-t', image, '.'], 180000)";
  if (!text.includes(childProcessCall) || !text.includes(buildCall)) throw new Error(`Unsupported ${kind} container check; update the workspace adapter.`);
  text = text
    .replace("import { readFileSync } from 'node:fs';", "import { readFileSync } from 'node:fs';\nimport { fileURLToPath } from 'node:url';")
    .replace("const config = JSON.parse(readFileSync(new URL('../verification.config.json', import.meta.url)));", "const config = JSON.parse(readFileSync(new URL('../verification.config.json', import.meta.url)));\nconst workspaceRoot = fileURLToPath(new URL('../../..', import.meta.url));")
    .replace(childProcessCall, "spawnSync('docker', args, {\n    cwd: workspaceRoot,\n    env: process.env,\n    encoding: 'utf8',\n    timeout,\n    maxBuffer: 4 * 1024 * 1024,\n  })")
    .replace(buildCall, `docker(['build', '--label', 'scaffold.check=' + id, '-f', 'apps/${kind}/Dockerfile', '-t', image, '.'], 180000)`);
  await writeFile(path, text);
}

function unquoteYaml(value) {
  if (value.startsWith("'") && value.endsWith("'")) return value.slice(1, -1).replaceAll("''", "'");
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value);
  return value;
}

async function verifyLockfile(directory) {
  const text = await readFile(join(directory, 'pnpm-lock.yaml'), 'utf8');
  const documents = [];
  let importers;
  let active = false, importer, section, dependency;
  for (const line of text.split('\n')) {
    if (line === 'importers:') { active = true; importers = new Map(); documents.push(importers); continue; }
    if (active && /^\S/.test(line)) { active = false; continue; }
    if (!active) continue;
    let match = line.match(/^ {2}(\S.*): \{\}$/);
    if (match) { importers.set(unquoteYaml(match[1]), new Map()); importer = undefined; section = undefined; dependency = undefined; continue; }
    match = line.match(/^ {2}(\S.*):$/);
    if (match) { importer = unquoteYaml(match[1]); importers.set(importer, new Map()); section = undefined; dependency = undefined; continue; }
    match = line.match(/^    (dependencies|devDependencies|optionalDependencies):$/);
    if (match) { section = match[1]; dependency = undefined; continue; }
    match = line.match(/^ {6}(\S.*):$/);
    if (match && section) { dependency = unquoteYaml(match[1]); continue; }
    match = line.match(/^        specifier: (.+)$/);
    if (match && importer && dependency) importers.get(importer).set(dependency, unquoteYaml(match[1]));
  }
  importers = documents.find(document => document.has('apps/api')) ?? documents.at(-1);
  if (!importers) throw new Error('Bundled lockfile has no importers. Regenerate the bundled root lockfile.');
  for (const importer of ['.', 'apps/api', 'apps/web', 'packages/api-client', 'packages/eslint-config', 'packages/typescript-config']) {
    const manifest = JSON.parse(await readFile(join(directory, importer === '.' ? 'package.json' : `${importer}/package.json`), 'utf8'));
    const expected = new Map(Object.entries({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.optionalDependencies, ...manifest.peerDependencies }));
    const actual = importers.get(importer);
    if (!actual) throw new Error(`Lockfile is missing importer ${importer}. Regenerate the bundled root lockfile.`);
    const differences = [];
    for (const [name, specifier] of expected) if (actual.get(name) !== specifier) differences.push(`${name}: expected ${specifier}, found ${actual.get(name) ?? 'missing'}`);
    for (const name of actual.keys()) if (!expected.has(name)) differences.push(`${name}: stale lockfile entry`);
    if (differences.length) throw new Error(`Bundled lockfile does not match ${importer}: ${differences.join('; ')}`);
  }
}

async function hashFiles(directory) {
  const output = {};
  for (const path of await collect(directory)) {
    if (path === '.scaffold-in-progress' || path === 'scaffold-manifest.json') continue;
    output[path] = createHash('sha256').update(await readFile(join(directory, path))).digest('hex');
  }
  return output;
}

try {
  run(process.execPath, [join(nestSkill, 'scripts', 'scaffold.mjs'), '--destination', nestStage, '--name', 'staged-api']);
  run(process.execPath, [join(nextSkill, 'scripts', 'scaffold.mjs'), '--destination', nextStage, '--name', 'staged-web']);
  const nestManifest = JSON.parse(await readFile(join(nestStage, 'scaffold-manifest.json'), 'utf8'));
  const nextManifest = JSON.parse(await readFile(join(nextStage, 'scaffold-manifest.json'), 'utf8'));
  for (const [label, manifest, referenceVersion] of [['nest', nestManifest, '1.4.0'], ['next', nextManifest, '1.4.0']]) {
    if (manifest.referenceVersion !== referenceVersion || manifest.runtime !== '24.22.1' || manifest.packageManager !== 'npm@11.17.0') throw new Error(`Unsupported ${label} reference: ${manifest.referenceVersion}/${manifest.runtime}/${manifest.packageManager}`);
  }
  const apiContract = JSON.parse(await readFile(join(nestStage, 'openapi.json'), 'utf8'));
  const webContract = JSON.parse(await readFile(join(nextStage, 'contract', 'openapi.json'), 'utf8'));
  if (JSON.stringify(apiContract) !== JSON.stringify(webContract)) throw new Error('Companion OpenAPI schemas differ; resolve compatibility before composition.');

  await mkdir(destination);
  await writeFile(join(destination, '.scaffold-in-progress'), 'Generation interrupted if this file remains. Review files; do not rerun over edits.\n', { flag: 'wx' });
  await copyTree(nestStage, join(destination, 'apps', 'api'), appExclusion(apiExcludedPrefixes));
  await copyTree(nextStage, join(destination, 'apps', 'web'), appExclusion(webExcludedPrefixes));
  await copyTree(template, destination);
  await adaptPackage(join(destination, 'apps', 'api', 'package.json'), 'api');
  await adaptPackage(join(destination, 'apps', 'web', 'package.json'), 'web');
  await adaptContainerCheck(join(destination, 'apps', 'api', 'scripts', 'check-container.mjs'), 'api');
  await adaptContainerCheck(join(destination, 'apps', 'web', 'scripts', 'check-container.mjs'), 'web');
  await adaptText(join(destination, 'apps', 'api'));
  await adaptText(join(destination, 'apps', 'web'));

  await mkdir(join(destination, 'packages', 'api-client', 'contract'), { recursive: true });
  await mkdir(join(destination, 'packages', 'api-client', 'src'), { recursive: true });
  await copyFile(join(nestStage, 'openapi.json'), join(destination, 'packages', 'api-client', 'contract', 'openapi.json'));
  await copyFile(join(nestStage, 'contracts', 'accepted.openapi.json'), join(destination, 'packages', 'api-client', 'contract', 'accepted.openapi.json'));
  await copyFile(join(nextStage, 'src', 'generated', 'api.d.ts'), join(destination, 'packages', 'api-client', 'src', 'api.d.ts'));
  const typesPath = join(destination, 'apps', 'web', 'src', 'features', 'projects', 'services', 'types.ts');
  const types = (await readFile(typesPath, 'utf8')).replace("from '@/generated/api'", "from '@repo/api-client'");
  await writeFile(typesPath, types);
  const rootPackagePath = join(destination, 'package.json');
  const rootPackage = JSON.parse(await readFile(rootPackagePath, 'utf8'));
  rootPackage.name = '@repo/' + name; // every workspace package, the root included, is named under @repo/
  await writeFile(rootPackagePath, JSON.stringify(rootPackage, null, 2) + '\n');
  await verifyLockfile(destination);

  const checksums = await hashFiles(destination);
  const manifest = {
    schemaVersion: 1,
    skill: basename(skill),
    referenceVersion: '1.4.0',
    status: 'generated',
    runtime: '24.22.1',
    packageManager: 'pnpm@12.15.0',
    turbo: '2.11.10',
    generatedAt: new Date().toISOString(),
    generatorCommand: ['node', ...process.argv.slice(1)],
    companions: {
      nest: { skill: nestManifest.skill, referenceVersion: nestManifest.referenceVersion, sourceChecksums: nestManifest.checksums },
      next: { skill: nextManifest.skill, referenceVersion: nextManifest.referenceVersion, sourceChecksums: nextManifest.checksums }
    },
    transformations: ['standalone-to-workspace', 'npm-to-pnpm', 'shared-tooling-config', 'generated-api-client-package', 'workspace-container-context'],
    checksums,
    intake: intake ?? null,
    requirements: Object.fromEntries((await readFile(join(skill, 'references', 'requirements.md'), 'utf8')).match(/^- ([A-Z]\d{2}) /gm).map(line => [line.slice(2, 5), { status: 'not_run', evidence: [] }])),
    authIntegration,
    databaseIntegration: 'disposable-test-database-required',
    remoteCache: 'unconfigured',
    deployment: 'unverified',
    gates: Object.fromEntries(Array.from({ length: 9 }, (_, index) => [`G${String(index + 1).padStart(2, '0')}`, { status: 'not_run', evidence: [] }]))
  };
  await writeFile(join(destination, 'scaffold-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  await unlink(join(destination, '.scaffold-in-progress'));
  console.log(JSON.stringify({ ...preview, status: 'generated', next: 'Use Node 24.22.1; run pnpm install --frozen-lockfile, then follow references/verification.md from the installed skill.' }, null, 2));
} finally {
  await rm(staging, { recursive: true, force: true });
}
