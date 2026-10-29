import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, relative, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Packages that open database or network connections, or build the Prisma client: platform code only.
const platformPackages = ['pg', 'node:http', 'node:https', 'prisma', '@prisma/client', '@prisma/adapter-pg'];
// Prisma Client model operations; `<client>.<model>.<operation>` is how a module reads or writes a model.
const modelOperations = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'create',
  'createMany',
  'createManyAndReturn',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'upsert',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
]);
// Raw SQL can reach any table, so ownership cannot be checked; only platform (readiness) may use it.
const rawOperations = new Set([
  '$queryRaw',
  '$queryRawUnsafe',
  '$executeRaw',
  '$executeRawUnsafe',
  '$queryRawTyped',
  '$runCommandRaw',
]);
const ownerOf = (file) => (file.includes('/') ? file.split('/')[0] : null);
const delegateOf = (model) => model[0].toLowerCase() + model.slice(1);
const stripSqlComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');

// Prisma schema rules. `schema` maps paths under prisma/schema/ to file contents.
export function checkSchema(schema = {}, migrations = {}, featureModules) {
  const errors = [],
    models = new Map(); // model name -> { module, file, body }
  for (const [file, source] of Object.entries(schema)) {
    const blocks = [...source.matchAll(/^\s*(model|view)\s+(\w+)\s*\{([\s\S]*?)^\s*\}/gm)];
    const module = ownerOf(file);
    if (!module) {
      if (blocks.length)
        errors.push(`prisma/schema/${file}: models belong in prisma/schema/<module>/, not the shared base`);
      continue;
    }
    if (['platform', 'generated'].includes(module))
      errors.push(`prisma/schema/${file}: "${module}" is not a feature module; put models in their module's folder`);
    else if (featureModules && !featureModules.has(module))
      errors.push(`prisma/schema/${file}: no src/${module}/ module owns these models`);
    for (const [, , name, body] of blocks) {
      if (models.has(name))
        errors.push(`prisma/schema/${file}: model ${name} is also defined in ${models.get(name).file}`);
      const table = body.match(/@@map\(\s*"([^"]+)"\s*\)/)?.[1] ?? name;
      models.set(name, { module, file: `prisma/schema/${file}`, body, table });
    }
  }
  const datasource =
    Object.values(schema)
      .join('\n')
      .match(/datasource\s+\w+\s*\{([\s\S]*?)\}/)?.[1] ?? '';
  if (!/^\s*relationMode\s*=\s*"prisma"/m.test(datasource))
    errors.push(
      'prisma/schema: the datasource must set relationMode = "prisma" so relations never create foreign keys',
    );
  for (const [name, { module, file, body }] of models) {
    const indexes = [...body.matchAll(/@@(?:index|unique|id)\(\s*\[([^\]]*)\]/g)].map((match) =>
      match[1].split(',').map((field) => field.replace(/\(.*$/s, '').trim()),
    );
    for (const line of body.split('\n')) {
      const field = line.trim().match(/^(\w+)\s+(\w+)(\[\])?\??(.*)$/);
      if (!field || !models.has(field[2])) continue;
      const target = models.get(field[2]);
      if (target.module !== module) {
        errors.push(
          `${file}: ${name}.${field[1]} is a relation to ${field[2]} owned by module ${target.module}; store a plain ID and read it through that module's service`,
        );
        continue;
      }
      const keys = field[4].match(/@relation\([^)]*fields:\s*\[([^\]]*)\]/)?.[1];
      if (!keys) continue;
      const columns = keys.split(',').map((key) => key.trim());
      const single =
        columns.length === 1 && new RegExp(`^\\s*${columns[0]}\\s+\\S+.*@(?:id|unique)\\b`, 'm').test(body);
      if (!single && !indexes.some((index) => columns.every((column, at) => index[at] === column)))
        errors.push(
          `${file}: ${name}.${field[1]} needs an index starting with [${columns.join(', ')}] (relationMode "prisma" creates none)`,
        );
    }
  }
  for (const [file, sql] of Object.entries(migrations)) {
    // `prisma migrate deploy` runs a migration without a transaction: wrap each one so a failure changes nothing.
    const statements = stripSqlComments(sql).trim();
    if (!/^BEGIN\s*;/i.test(statements) || !/COMMIT\s*;$/i.test(statements))
      errors.push(
        `prisma/migrations/${file}: wrap the migration in BEGIN; … COMMIT; so a failing statement rolls back the whole migration`,
      );
    if (/\bFOREIGN\s+KEY\b|\bREFERENCES\b/i.test(stripSqlComments(sql)))
      errors.push(`prisma/migrations/${file}: foreign keys are not allowed; modules reference each other by plain IDs`);
  }
  return { errors, models };
}

export function checkArchitecture(files, { schema, migrations } = {}) {
  const errors = [],
    graph = new Map();
  const featureModules = new Set(
    Object.keys(files)
      .map(ownerOf)
      .filter((owner) => owner && owner !== 'platform'),
  );
  const checked = schema ? checkSchema(schema, migrations, featureModules) : { errors: [], models: new Map() };
  errors.push(...checked.errors);
  const delegates = new Map([...checked.models].map(([name, { module }]) => [delegateOf(name), { name, module }]));
  const tablesByModule = new Map();
  for (const { module, table } of checked.models.values()) {
    const tables = tablesByModule.get(module) ?? new Set();
    tables.add(table);
    tablesByModule.set(module, tables);
  }
  for (const [file, source] of Object.entries(files)) {
    const edges = [],
      owner = ownerOf(file);
    graph.set(file, edges);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const modelAccess = (node, member) => {
      const model = delegates.get(member);
      if (model && model.module !== owner)
        errors.push(
          `${file}: ${owner ?? 'top-level code'} may only use its own models; ${model.name} belongs to module ${model.module} (call its service)`,
        );
    };
    const inspect = (node) => {
      let specifier;
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        specifier = node.arguments[0];
        if (!specifier || !ts.isStringLiteral(specifier))
          errors.push(`${file}: computed imports cannot be checked; use a literal module path`);
      }
      if (specifier && ts.isStringLiteral(specifier)) {
        const value = specifier.text;
        if (
          owner &&
          owner !== 'platform' &&
          platformPackages.some((name) => value === name || value.startsWith(name + '/'))
        )
          errors.push(`${file}: transport/database dependencies belong to platform`);
        if (value.startsWith('.')) {
          const target = posix.normalize(posix.join(posix.dirname(file), value)).replace(/\.js$/, '.ts');
          const targetOwner = ownerOf(target);
          if (targetOwner === 'generated') {
            // The generated Prisma client is built and configured by platform only.
            if (owner !== 'platform') errors.push(`${file}: only platform may import the generated Prisma client`);
          } else if (!Object.hasOwn(files, target)) errors.push(`${file}: unresolved local import ${value}`);
          else {
            edges.push(target);
            if (owner === 'platform' && targetOwner && targetOwner !== 'platform')
              errors.push(`${file}: platform cannot depend on feature ${targetOwner}`);
            if (owner && targetOwner && owner !== targetOwner && !target.endsWith('/index.ts'))
              errors.push(`${file}: import ${targetOwner} through its public index.ts`);
            if (
              owner &&
              owner !== 'platform' &&
              file === `${owner}/index.ts` &&
              ts.isExportDeclaration(node) &&
              /(^|\/)repository\.ts$/.test(target)
            )
              errors.push(`${file}: a module's repository stays private; export its service instead`);
          }
        }
      }
      // <expression>.<model>.<operation>(...) and <expression>['<model>'].<operation>(...)
      if (ts.isPropertyAccessExpression(node) && modelOperations.has(node.name.text)) {
        const target = node.expression;
        if (ts.isPropertyAccessExpression(target)) modelAccess(target, target.name.text);
        else if (ts.isElementAccessExpression(target) && ts.isStringLiteralLike(target.argumentExpression))
          modelAccess(target, target.argumentExpression.text);
      }
      if (ts.isPropertyAccessExpression(node) && rawOperations.has(node.name.text) && owner !== 'platform') {
        const tagged = node.parent;
        const template =
          ts.isTaggedTemplateExpression(tagged) && tagged.tag === node
            ? ts.isNoSubstitutionTemplateLiteral(tagged.template)
              ? tagged.template.text
              : tagged.template.head.text + tagged.template.templateSpans.map((span) => span.literal.text).join(' ')
            : null;
        const tables = template
          ? [...template.matchAll(/\b(?:UPDATE|FROM|JOIN|INTO)\s+(?:"([^"]+)"|([A-Za-z_][\w$]*))/gi)].map(
              (match) => match[1] ?? match[2],
            )
          : [];
        const ownedTables = tablesByModule.get(owner) ?? new Set();
        const safeOwnedQuery =
          node.name.text === '$queryRaw' &&
          file === `${owner}/repository.ts` &&
          tables.length > 0 &&
          tables.every((table) => ownedTables.has(table));
        if (!safeOwnedQuery)
          errors.push(
            `${file}: raw SQL (${node.name.text}) must be a parameterized $queryRaw tag in the private repository and may reference only ${owner}'s mapped tables`,
          );
      }
      ts.forEachChild(node, inspect);
    };
    inspect(tree);
  }
  const visited = new Set(),
    visiting = new Set();
  function visit(file, chain) {
    if (visiting.has(file)) {
      errors.push(`Import cycle: ${[...chain, file].join(' -> ')}`);
      return;
    }
    if (visited.has(file)) return;
    visiting.add(file);
    for (const next of graph.get(file) ?? []) visit(next, [...chain, file]);
    visiting.delete(file);
    visited.add(file);
  }
  for (const file of graph.keys()) visit(file, []);
  return errors;
}

async function filesUnder(root, keep, skip = () => false) {
  const files = {};
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const key = relative(root, path).split('\\').join('/');
      if (skip(key)) continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && keep(entry.name)) files[key] = await readFile(path, 'utf8');
    }
  }
  if (existsSync(root)) await walk(root);
  return files;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const errors = checkArchitecture(
    // src/generated is the Prisma client output (generated, not reviewed source).
    await filesUnder(
      resolve(app, 'src'),
      (name) => name.endsWith('.ts'),
      (key) => key === 'generated',
    ),
    {
      schema: await filesUnder(resolve(app, 'prisma/schema'), (name) => name.endsWith('.prisma')),
      migrations: await filesUnder(resolve(app, 'prisma/migrations'), (name) => name.endsWith('.sql')),
    },
  );
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.info('Architecture boundaries, module data ownership, foreign-key ban and cycles passed');
}
