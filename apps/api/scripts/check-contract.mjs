import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

// Compares the accepted (released) OpenAPI document with the current one and reports only changes that can break
// an existing client. Requests may widen (accept more); responses may narrow (promise more). Anything this checker
// does not understand is reported as breaking, so unknown changes always get a human review.
const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'];
const cosmetic = new Set([
  'description',
  'summary',
  'example',
  'examples',
  'externalDocs',
  'tags',
  'operationId',
  'title',
  'deprecated',
]);
// Keys of these objects are user-chosen names (a property may be called "title"), never documentation keywords.
const nameMaps = new Set([
  'paths',
  'schemas',
  'properties',
  'patternProperties',
  'definitions',
  '$defs',
  'dependentSchemas',
  'responses',
  'content',
  'headers',
  'securitySchemes',
  'callbacks',
  'links',
  'encoding',
  'variables',
]);
function expand(value, document, stack = [], namesOnly = false) {
  if (Array.isArray(value)) return value.map((item) => expand(item, document, stack));
  if (!value || typeof value !== 'object') return value;
  if ('$ref' in value) {
    const ref = value.$ref;
    if (!ref.startsWith('#/') || stack.includes(ref))
      throw new Error('Unsupported external or cyclic schema reference: ' + ref);
    const target = ref
      .slice(2)
      .split('/')
      .reduce((node, key) => node?.[key.replace(/~1/g, '/').replace(/~0/g, '~')], document);
    if (!target) throw new Error('Unresolved schema reference: ' + ref);
    return expand(target, document, [...stack, ref]);
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => namesOnly || !cosmetic.has(key))
      .map(([key, child]) => [key, expand(child, document, stack, !namesOnly && nameMaps.has(key))]),
  );
}

// For each bound: which direction is wider (accepts more values).
const widerWhenLarger = ['maxLength', 'maximum', 'exclusiveMaximum', 'maxItems', 'maxProperties'];
const widerWhenSmaller = ['minLength', 'minimum', 'exclusiveMinimum', 'minItems', 'minProperties'];
const handled = new Set([
  'type',
  'nullable',
  'enum',
  'format',
  'pattern',
  'properties',
  'required',
  'additionalProperties',
  'items',
  ...widerWhenLarger,
  ...widerWhenSmaller,
]);
const types = (schema) => {
  const list = schema.type === undefined ? [] : [schema.type].flat();
  return schema.nullable ? [...list, 'null'] : list;
};
const subset = (a, b) => a.every((value) => b.some((other) => isDeepStrictEqual(value, other)));

// direction 'request': the current schema must accept everything the accepted one did.
// direction 'response': the current schema must only produce what the accepted one promised.
function compareSchema(before = {}, after = {}, direction, at, errors) {
  if (isDeepStrictEqual(before, after)) return;
  const report = (what) => errors.push(`${at}: ${what}`);
  const request = direction === 'request';
  const [t0, t1] = [types(before), types(after)];
  if (t0.length || t1.length) {
    const ok = request ? t1.length === 0 || (t0.length > 0 && subset(t0, t1)) : t0.length === 0 || subset(t1, t0);
    if (!ok) report(`type changed ${JSON.stringify(t0)} -> ${JSON.stringify(t1)}`);
  }
  if (before.enum || after.enum) {
    const ok = request
      ? !after.enum || (before.enum && subset(before.enum, after.enum))
      : !before.enum || (after.enum && subset(after.enum, before.enum));
    if (!ok) report(request ? 'enum no longer accepts an accepted value' : 'enum may return a new value');
  }
  for (const key of ['format', 'pattern']) {
    if (before[key] === after[key]) continue;
    if (request && after[key] === undefined) continue;
    report(`${key} changed ${JSON.stringify(before[key])} -> ${JSON.stringify(after[key])}`);
  }
  for (const key of [...widerWhenLarger, ...widerWhenSmaller]) {
    const [b, a] = [before[key], after[key]];
    if (b === a) continue;
    const largerIsWider = widerWhenLarger.includes(key);
    // Undefined means unbounded, which is the widest possible value.
    const wider = a === undefined || (b !== undefined && (largerIsWider ? a > b : a < b));
    if (request ? !wider : wider) report(`${key} ${request ? 'narrowed' : 'widened'} ${b} -> ${a}`);
  }
  const p0 = before.properties ?? {};
  const p1 = after.properties ?? {};
  const r0 = new Set(before.required ?? []);
  const r1 = new Set(after.required ?? []);
  for (const [name, schema] of Object.entries(p0)) {
    if (!(name in p1)) {
      if (!request || after.additionalProperties === false) report(`property "${name}" removed`);
      continue;
    }
    compareSchema(schema, p1[name], direction, `${at}.${name}`, errors);
  }
  if (request) {
    for (const name of r1) if (!r0.has(name)) report(`property "${name}" is now required`);
    if (before.additionalProperties !== false && after.additionalProperties === false)
      report('unknown properties are now rejected');
  } else {
    for (const name of r0) if (!r1.has(name)) report(`property "${name}" is no longer guaranteed`);
    if (before.additionalProperties === false && after.additionalProperties !== false)
      report('may now return undeclared properties');
  }
  if (before.items || after.items) compareSchema(before.items, after.items, direction, `${at}[]`, errors);
  // Composition keywords and anything else not modelled above must stay identical.
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)]))
    if (!handled.has(key) && !isDeepStrictEqual(before[key], after[key])) report(`${key} changed`);
}

function compareContent(before = {}, after = {}, direction, at, errors) {
  for (const [type, media] of Object.entries(before)) {
    if (!after[type]) {
      errors.push(`${at}: media type ${type} removed`);
      continue;
    }
    compareSchema(media.schema, after[type].schema, direction, `${at} ${type}`, errors);
  }
}

function parameters(route, operation) {
  const merged = new Map();
  for (const parameter of [...(route.parameters ?? []), ...(operation.parameters ?? [])])
    merged.set(`${parameter.in}:${parameter.name}`, parameter);
  return merged;
}

function compareOperation(before, after, at, errors) {
  const [q0, q1] = [parameters(before.route, before.operation), parameters(after.route, after.operation)];
  for (const [key, parameter] of q0) {
    const next = q1.get(key);
    if (!next) {
      errors.push(`${at}: parameter ${key} removed`);
      continue;
    }
    if (!parameter.required && next.required) errors.push(`${at}: parameter ${key} is now required`);
    compareSchema(parameter.schema, next.schema, 'request', `${at} parameter ${key}`, errors);
  }
  for (const [key, parameter] of q1)
    if (!q0.has(key) && parameter.required) errors.push(`${at}: new required parameter ${key}`);

  const [b0, b1] = [before.operation.requestBody, after.operation.requestBody];
  if (b0 && !b1) errors.push(`${at}: request body removed`);
  if (!b0 && b1?.required) errors.push(`${at}: request body is now required`);
  if (b0 && b1) {
    if (!b0.required && b1.required) errors.push(`${at}: request body is now required`);
    compareContent(b0.content, b1.content, 'request', `${at} request body`, errors);
  }

  const [s0, s1] = [before.operation.responses ?? {}, after.operation.responses ?? {}];
  for (const [status, response] of Object.entries(s0)) {
    const next = s1[status];
    if (!next) {
      errors.push(`${at}: response ${status} removed`);
      continue;
    }
    compareContent(response.content, next.content, 'response', `${at} response ${status}`, errors);
    for (const header of Object.keys(response.headers ?? {}))
      if (!next.headers?.[header]) errors.push(`${at}: response ${status} header ${header} removed`);
  }
  if (!isDeepStrictEqual(before.operation.security, after.operation.security))
    errors.push(`${at}: operation security changed`);
}

export function compareContracts(previousDocument, currentDocument) {
  const previous = expand(previousDocument, previousDocument);
  const current = expand(currentDocument, currentDocument);
  const errors = [];
  if (previous.openapi !== current.openapi) errors.push('OpenAPI version changed; review compatibility explicitly');
  if (!isDeepStrictEqual(previous.security ?? [], current.security ?? []))
    errors.push('global security requirements changed');
  if (!isDeepStrictEqual(previous.components?.securitySchemes ?? {}, current.components?.securitySchemes ?? {}))
    errors.push('security schemes changed');
  for (const [path, route] of Object.entries(previous.paths ?? {}))
    for (const method of methods) {
      if (!route[method]) continue;
      const at = `${method.toUpperCase()} ${path}`;
      const nextRoute = current.paths?.[path];
      if (!nextRoute?.[method]) {
        errors.push(`${at}: accepted operation removed`);
        continue;
      }
      compareOperation(
        { route, operation: route[method] },
        { route: nextRoute, operation: nextRoute[method] },
        at,
        errors,
      );
    }
  return errors;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const previous = JSON.parse(
    await readFile(process.argv[2] ?? new URL('../contracts/accepted.openapi.json', import.meta.url), 'utf8'),
  );
  const current = JSON.parse(await readFile(process.argv[3] ?? new URL('../openapi.json', import.meta.url), 'utf8'));
  const errors = compareContracts(previous, current);
  if (errors.length) {
    console.error('Breaking changes against the accepted contract:\n' + errors.map((e) => '- ' + e).join('\n'));
    process.exitCode = 1;
  } else console.info('No breaking changes against the accepted contract; additive changes allowed');
}
