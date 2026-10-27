import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, dirname, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export function checkArchitecture(files) {
  const errors = [],
    graph = new Map();
  for (const [file, source] of Object.entries(files)) {
    const edges = [],
      owner = file.includes('/') ? file.split('/')[0] : null;
    graph.set(file, edges);
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
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
        if (owner !== 'platform' && ['pg', 'node:http', 'node:https'].includes(value) && owner)
          errors.push(`${file}: transport/database dependencies belong to platform`);
        if (value.startsWith('.')) {
          const target = posix.normalize(posix.join(posix.dirname(file), value)).replace(/\.js$/, '.ts');
          if (!Object.hasOwn(files, target)) errors.push(`${file}: unresolved local import ${value}`);
          else {
            edges.push(target);
            const targetOwner = target.includes('/') ? target.split('/')[0] : null;
            if (owner === 'platform' && targetOwner && targetOwner !== 'platform')
              errors.push(`${file}: platform cannot depend on feature ${targetOwner}`);
            if (owner && targetOwner && owner !== targetOwner && !target.endsWith('/index.ts'))
              errors.push(`${file}: import ${targetOwner} through its public index.ts`);
          }
        }
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

async function filesUnder(root) {
  const files = {};
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile() && entry.name.endsWith('.ts'))
        files[relative(root, path).split('\\').join('/')] = await readFile(path, 'utf8');
    }
  }
  await walk(root);
  return files;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const errors = checkArchitecture(await filesUnder(resolve(dirname(fileURLToPath(import.meta.url)), '../src')));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.info('Architecture boundaries and cycles passed');
}
