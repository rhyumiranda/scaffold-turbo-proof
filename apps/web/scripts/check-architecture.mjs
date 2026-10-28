import ts from 'typescript';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { posix, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function inspectArchitecture(files, { publicEnv = [] } = {}) {
  const errors = [],
    graph = new Map(),
    facts = new Map();
  const feature = (file) => file.match(/^src\/features\/([^/]+)\//)?.[1];
  const layer = (file) => file.match(/^src\/features\/[^/]+\/([^/]+)\//)?.[1];
  const resolveImport = (file, specifier) => {
    const base = specifier.startsWith('@/')
      ? 'src/' + specifier.slice(2)
      : specifier.startsWith('.')
        ? posix.normalize(posix.join(posix.dirname(file), specifier))
        : null;
    if (!base) return null;
    return [base, base + '.ts', base + '.tsx', base + '/index.ts', base + '/index.tsx'].find((candidate) =>
      files.has(candidate),
    );
  };
  for (const [file, source] of files) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const client = ast.statements.some(
      (node) => ts.isExpressionStatement(node) && node.expression.text === 'use client',
    );
    const action = ast.statements.some(
      (node) => ts.isExpressionStatement(node) && node.expression.text === 'use server',
    );
    const ownLayer = layer(file),
      imports = [],
      edges = [];
    const report = (node, message) =>
      errors.push(`${file}:${ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1} ${message}`);
    const checkImport = (node, specifier, typeOnly = false) => {
      // Applies to type-only imports too: an app never reaches into another app's source.
      if (specifier.startsWith('.') && /^\.\.(\/|$)/.test(posix.normalize(posix.join(posix.dirname(file), specifier))))
        report(
          node,
          'Imports must stay inside this application; share code only through a declared workspace package.',
        );
      if (/^@repo\/(api|web)(\/|$)/.test(specifier))
        report(node, 'Applications are leaves; never import another application package.');
      if (typeOnly) return;
      imports.push(specifier);
      const target = resolveImport(file, specifier);
      if (target) {
        edges.push(target);
        const featureIndex =
          feature(target) &&
          [`src/features/${feature(target)}/index.ts`, `src/features/${feature(target)}/index.tsx`].includes(target);
        if (feature(file) && feature(target) && feature(file) !== feature(target) && !featureIndex)
          report(node, 'Cross-feature imports must use the owning feature index.ts; do not import private files.');
        if (!feature(file) && feature(target) && !featureIndex)
          report(
            node,
            'Routes and shared code import a feature only through its index.ts; do not import private files.',
          );
        const targetLayer = layer(target);
        if (client && (ownLayer === 'components' || file.startsWith('src/app/')) && targetLayer === 'services')
          report(node, 'Client/presentation reads must use a hook; type-only imports are allowed.');
        if (client && (ownLayer === 'components' || file.startsWith('src/app/')) && targetLayer === 'actions')
          report(node, 'Client mutations must use a hook; the hook imports the Server Action, never the component.');
        if (ownLayer === 'services' && ['hooks', 'actions', 'components'].includes(targetLayer))
          report(node, 'Services must not depend on components, hooks, or actions.');
        if (ownLayer === 'actions' && ['hooks', 'components'].includes(targetLayer))
          report(node, 'Actions must not depend on client hooks or presentation.');
      }
      if (
        (ownLayer === 'hooks' || client) &&
        (/\.server(?:\.|$)/.test(specifier) || /^(server-only|next\/headers|node:|pg$|@prisma\/client)/.test(specifier))
      )
        report(node, 'Client boundaries cannot import server runtime; use an action or browser service.');
      if (/^(pg$|@prisma\/client)/.test(specifier))
        report(node, 'This API-backed frontend cannot own a database client.');
      if (['components', 'hooks'].includes(ownLayer) && /^(axios|undici|node:http|node:https)/.test(specifier))
        report(node, 'Transport belongs in a service, not a component/hook.');
    };
    const actionNames = new Set();
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const clause = node.importClause;
        const onlyTypes =
          clause?.isTypeOnly ||
          (clause &&
            !clause.name &&
            clause.namedBindings &&
            ts.isNamedImports(clause.namedBindings) &&
            clause.namedBindings.elements.length > 0 &&
            clause.namedBindings.elements.every((e) => e.isTypeOnly));
        checkImport(node, node.moduleSpecifier.text, onlyTypes);
        // Remember Server Action bindings so JSX can be checked for actions passed as props.
        const target = resolveImport(file, node.moduleSpecifier.text);
        if (
          !onlyTypes &&
          (layer(target ?? '') === 'actions' || /(^|\/)actions(\/|$)/.test(node.moduleSpecifier.text))
        ) {
          if (clause?.name) actionNames.add(clause.name.text);
          if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings))
            for (const element of clause.namedBindings.elements)
              if (!element.isTypeOnly) actionNames.add(element.name.text);
        }
      }
      if (
        ts.isJsxAttribute(node) &&
        node.initializer &&
        ts.isJsxExpression(node.initializer) &&
        node.initializer.expression
      ) {
        const value = node.initializer.expression;
        const base =
          ts.isCallExpression(value) &&
          ts.isPropertyAccessExpression(value.expression) &&
          value.expression.name.text === 'bind'
            ? value.expression.expression
            : value;
        const attribute = node.name.getText(ast);
        // Only the native elements may receive an action: <form action> and <button|input formAction>. A component
        // prop that happens to be named "action" would hand the action to client code.
        const element = node.parent.parent;
        const tag =
          ts.isJsxOpeningElement(element) || ts.isJsxSelfClosingElement(element) ? element.tagName.getText(ast) : '';
        const native =
          (attribute === 'action' && tag === 'form') ||
          (attribute === 'formAction' && ['button', 'input'].includes(tag));
        if (ts.isIdentifier(base) && actionNames.has(base.text) && !native)
          report(
            node,
            'Pass a Server Action only to <form action> or formAction; client components get actions from their hook.',
          );
      }
      // Public variables are inlined into the browser bundle at build time, so each one must be declared.
      const publicName =
        ts.isPropertyAccessExpression(node) && node.expression.getText(ast) === 'process.env'
          ? node.name.text
          : ts.isElementAccessExpression(node) &&
              node.expression.getText(ast) === 'process.env' &&
              ts.isStringLiteral(node.argumentExpression)
            ? node.argumentExpression.text
            : undefined;
      if (publicName?.startsWith('NEXT_PUBLIC_') && !publicEnv.includes(publicName))
        report(
          node,
          `${publicName} is inlined into the browser bundle; declare it in public-env.json and the web build env first.`,
        );
      if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier))
        checkImport(node, node.moduleSpecifier.text, node.isTypeOnly);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
      ) {
        const argument = node.arguments[0];
        if (!argument || !ts.isStringLiteral(argument))
          report(node, 'Dynamic module names cannot be checked; use explicit literal imports.');
        else checkImport(node, argument.text);
      }
      if (
        ts.isIdentifier(node) &&
        ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'].includes(node.text) &&
        ownLayer !== 'services'
      )
        report(
          node,
          'Raw transport belongs in a service. Server Components may call server services, not fetch directly.',
        );
      ts.forEachChild(node, visit);
    };
    visit(ast);
    graph.set(file, edges);
    facts.set(file, { client, action, imports });
  }
  const active = new Set(),
    complete = new Set();
  function cycles(file, chain = []) {
    if (active.has(file)) {
      errors.push(`${file}:1 Import cycle: ${[...chain, file].join(' -> ')}`);
      return;
    }
    if (complete.has(file)) return;
    active.add(file);
    for (const target of graph.get(file) ?? []) cycles(target, [...chain, file]);
    active.delete(file);
    complete.add(file);
  }
  for (const file of files.keys()) cycles(file);
  function clientClosure(file, seen = new Set()) {
    if (seen.has(file)) return;
    seen.add(file);
    const info = facts.get(file);
    if (!info || info.action) return;
    if (layer(file) === 'components' && (graph.get(file) ?? []).some((target) => layer(target) === 'services'))
      errors.push(
        `${file}:1 Client-reachable presentation reads must use a hook; server components may read server services.`,
      );
    if (layer(file) === 'components' && (graph.get(file) ?? []).some((target) => layer(target) === 'actions'))
      errors.push(
        `${file}:1 Client-reachable presentation mutations must use a hook; server-only forms may pass actions to <form action>.`,
      );
    if (info.imports.some((spec) => /^(server-only|next\/headers|node:|pg$|@prisma\/client)/.test(spec)))
      errors.push(
        `${file}:1 Server runtime is reachable from a client import graph; split server/browser entrypoints.`,
      );
    for (const target of graph.get(file) ?? []) clientClosure(target, seen);
  }
  for (const [file, info] of facts) if (info.client) clientClosure(file);
  return [...new Set(errors)];
}
function collect(directory, root = process.cwd(), files = new Map()) {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) collect(path, root, files);
    else if (/\.tsx?$/.test(item.name) && !item.name.endsWith('.d.ts'))
      files.set(relative(root, path).split('\\').join('/'), readFileSync(path, 'utf8'));
  }
  return files;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const listed = existsSync(resolve('public-env.json'))
    ? JSON.parse(readFileSync(resolve('public-env.json'), 'utf8'))
    : [];
  const errors = inspectArchitecture(collect(resolve('src')), { publicEnv: listed });
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log('Architecture passed: layers, feature exports, client closure, import cycles.');
}
